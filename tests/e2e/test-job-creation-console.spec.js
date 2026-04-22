// @ts-check
/**
 * JOB CREATION CONSOLE ERROR TEST
 * Creates a job and captures ALL console errors to debug the "record 'new' has no field 'id'" error
 */
const { test, expect } = require('@playwright/test');

const URL = process.env.BASE_URL || 'https://crm.onpointprodoors.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'service@onpointprodoors.com';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'OnPoint2024!';

test('Create job and capture console errors', async ({ page }) => {
  const consoleMessages = [];
  const consoleErrors = [];

  // Capture all console messages
  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push(text);
    if (msg.type() === 'error') {
      consoleErrors.push(text);
      console.log(`[CONSOLE ERROR] ${text}`);
    } else {
      console.log(`[CONSOLE ${msg.type()}] ${text}`);
    }
  });

  // Capture page errors
  page.on('pageerror', error => {
    consoleErrors.push(error.message);
    console.log(`[PAGE ERROR] ${error.message}`);
  });

  // Navigate and login
  console.log('[TEST] Navigating to app...');
  await page.goto(URL);

  // Wait for any login screen to appear
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/step1-loaded.png' });

  // Check if we have the email/password fields
  const hasEmailField = await page.isVisible('#login-email');
  const hasPasswordField = await page.isVisible('#login-password');

  console.log(`[TEST] Login screen state: email=${hasEmailField}, password=${hasPasswordField}`);

  if (hasEmailField && hasPasswordField) {
    console.log('[TEST] Logging in with email/password...');
    await page.fill('#login-email', ADMIN_EMAIL);
    await page.fill('#login-password', ADMIN_PASS);
    await page.click('#login-btn');
    await page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  } else {
    console.log('[TEST] Email/password login not available, cannot proceed');
    throw new Error('Cannot login - email/password fields not found');
  }

  console.log('[TEST] Waiting for app to initialize...');
  await page.waitForTimeout(3000);

  console.log('[TEST] Opening New Job modal...');
  await page.click('.nav-add');
  await page.waitForSelector('#modal-new-job:not(.hidden)');

  console.log('[TEST] Filling job form...');
  const timestamp = Date.now();
  await page.fill('#f-name', `Console Test ${timestamp}`);
  await page.fill('#f-phone', '555-9999');
  await page.fill('#f-address', '456 Debug Ave');
  await page.fill('#f-city', 'Brooklyn');
  await page.fill('#f-zip', '11201');

  // Select source (dispatcher will only see their allowed source)
  await page.waitForTimeout(500);

  console.log('[TEST] Saving job...');
  await page.click('#btn-save-new-job');

  // Wait for either success or error
  await page.waitForTimeout(3000);

  console.log('\n========================================');
  console.log('CONSOLE MESSAGES SUMMARY');
  console.log('========================================');
  console.log(`Total messages: ${consoleMessages.length}`);
  console.log(`Total errors: ${consoleErrors.length}`);

  if (consoleErrors.length > 0) {
    console.log('\n=== ALL ERRORS ===');
    consoleErrors.forEach((err, i) => {
      console.log(`${i + 1}. ${err}`);
    });
  }

  // Check for the specific database error
  const hasDbError = consoleErrors.some(err =>
    err.includes('record "new" has no field "id"') ||
    err.includes('42703')
  );

  if (hasDbError) {
    console.log('\n❌ DATABASE ERROR DETECTED: record "new" has no field "id"');

    // Find and print the full error context
    const dbError = consoleErrors.find(err =>
      err.includes('record "new" has no field "id"') ||
      err.includes('42703')
    );
    console.log('\nFull error:', dbError);
  } else {
    console.log('\n✓ No database errors detected');
  }

  // Check if modal closed (indicates success)
  const modalVisible = await page.isVisible('#modal-new-job:not(.hidden)');
  console.log(`\nModal still visible: ${modalVisible}`);

  // Check for debug panel
  const debugText = await page.textContent('#debug-notes').catch(() => '');
  if (debugText) {
    console.log(`\nDebug panel: ${debugText}`);
  }

  // Fail test if database error exists
  expect(hasDbError).toBe(false);
});
