const { test, expect } = require('@playwright/test');

test('create and delete dispatcher', async ({ page }) => {
  // Navigate to app
  await page.goto('https://crm.onpointprodoors.com');

  // Wait for app to load
  await page.waitForLoadState('networkidle');

  // Check if we need to log in
  const loginForm = await page.locator('#login-form').count();

  if (loginForm > 0) {
    console.log('Not logged in. You need to log in manually first.');
    console.log('1. Open https://crm.onpointprodoors.com in your browser');
    console.log('2. Log in as admin');
    console.log('3. Then run this test again');
    throw new Error('Please log in manually first');
  }

  // Navigate to Settings
  await page.click('a[href="#settings"]');
  await page.waitForTimeout(1000);

  // Click Invite User button
  await page.click('button:has-text("Invite User")');
  await page.waitForTimeout(500);

  // Fill in the name field
  const testName = `Test Dispatcher ${Date.now()}`;
  await page.fill('#invite-name', testName);

  // Submit the form
  await page.click('button:has-text("Send Invite")');

  // Wait for success message
  await page.waitForSelector('.invite-success', { timeout: 10000 });

  // Verify the magic link is displayed
  const magicLinkInput = await page.locator('#generated-magic-link');
  const magicLink = await magicLinkInput.inputValue();
  console.log('✓ Magic link generated:', magicLink.substring(0, 50) + '...');

  // Close the modal
  await page.click('button:has-text("Done")');
  await page.waitForTimeout(500);

  // Find the newly created user in the list
  const userRow = page.locator(`tr:has-text("${testName}")`);
  await expect(userRow).toBeVisible();
  console.log('✓ User created and appears in list');

  // Click the delete button for this user
  await userRow.locator('button.btn-danger').click();

  // Confirm deletion
  page.once('dialog', dialog => {
    console.log('✓ Delete confirmation dialog appeared');
    dialog.accept();
  });
  await page.waitForTimeout(500);

  // Wait for the user to be removed from the list
  await page.waitForTimeout(2000);

  // Verify user is gone
  const userStillExists = await page.locator(`tr:has-text("${testName}")`).count();
  expect(userStillExists).toBe(0);
  console.log('✓ User deleted successfully');

  console.log('\n✅ ALL TESTS PASSED');
});
