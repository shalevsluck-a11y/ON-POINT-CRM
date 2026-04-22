# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: test-user-management.spec.js >> create and delete dispatcher
- Location: tests\e2e\test-user-management.spec.js:3:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('a[href="#settings"]')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - img "Logo" [ref=e4]
  - heading "Welcome to On Point CRM" [level=1] [ref=e5]
  - paragraph [ref=e6]: Paste your magic link below to continue
  - textbox "Paste your magic link here" [active] [ref=e7]
  - button "Continue" [ref=e8] [cursor=pointer]
  - paragraph [ref=e9]: Don't have a link? Contact your administrator
```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test');
  2  | 
  3  | test('create and delete dispatcher', async ({ page }) => {
  4  |   // Navigate to app
  5  |   await page.goto('https://crm.onpointprodoors.com');
  6  | 
  7  |   // Wait for app to load
  8  |   await page.waitForLoadState('networkidle');
  9  | 
  10 |   // Check if we need to log in
  11 |   const loginForm = await page.locator('#login-form').count();
  12 | 
  13 |   if (loginForm > 0) {
  14 |     console.log('Not logged in. You need to log in manually first.');
  15 |     console.log('1. Open https://crm.onpointprodoors.com in your browser');
  16 |     console.log('2. Log in as admin');
  17 |     console.log('3. Then run this test again');
  18 |     throw new Error('Please log in manually first');
  19 |   }
  20 | 
  21 |   // Navigate to Settings
> 22 |   await page.click('a[href="#settings"]');
     |              ^ Error: page.click: Test timeout of 30000ms exceeded.
  23 |   await page.waitForTimeout(1000);
  24 | 
  25 |   // Click Invite User button
  26 |   await page.click('button:has-text("Invite User")');
  27 |   await page.waitForTimeout(500);
  28 | 
  29 |   // Fill in the name field
  30 |   const testName = `Test Dispatcher ${Date.now()}`;
  31 |   await page.fill('#invite-name', testName);
  32 | 
  33 |   // Submit the form
  34 |   await page.click('button:has-text("Send Invite")');
  35 | 
  36 |   // Wait for success message
  37 |   await page.waitForSelector('.invite-success', { timeout: 10000 });
  38 | 
  39 |   // Verify the magic link is displayed
  40 |   const magicLinkInput = await page.locator('#generated-magic-link');
  41 |   const magicLink = await magicLinkInput.inputValue();
  42 |   console.log('✓ Magic link generated:', magicLink.substring(0, 50) + '...');
  43 | 
  44 |   // Close the modal
  45 |   await page.click('button:has-text("Done")');
  46 |   await page.waitForTimeout(500);
  47 | 
  48 |   // Find the newly created user in the list
  49 |   const userRow = page.locator(`tr:has-text("${testName}")`);
  50 |   await expect(userRow).toBeVisible();
  51 |   console.log('✓ User created and appears in list');
  52 | 
  53 |   // Click the delete button for this user
  54 |   await userRow.locator('button.btn-danger').click();
  55 | 
  56 |   // Confirm deletion
  57 |   page.once('dialog', dialog => {
  58 |     console.log('✓ Delete confirmation dialog appeared');
  59 |     dialog.accept();
  60 |   });
  61 |   await page.waitForTimeout(500);
  62 | 
  63 |   // Wait for the user to be removed from the list
  64 |   await page.waitForTimeout(2000);
  65 | 
  66 |   // Verify user is gone
  67 |   const userStillExists = await page.locator(`tr:has-text("${testName}")`).count();
  68 |   expect(userStillExists).toBe(0);
  69 |   console.log('✓ User deleted successfully');
  70 | 
  71 |   console.log('\n✅ ALL TESTS PASSED');
  72 | });
  73 | 
```