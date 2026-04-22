const { test } = require('@playwright/test');
const path = require('path');

test('save admin auth state', async ({ page, context }) => {
  await page.goto('https://crm.onpointprodoors.com');

  console.log('\n==========================================');
  console.log('PLEASE LOG IN AS ADMIN NOW');
  console.log('==========================================');
  console.log('Waiting for login... (up to 5 minutes)\n');

  // Wait for navigation bar to appear (sign of successful login)
  await page.waitForSelector('nav', { timeout: 300000 });

  console.log('✓ Login detected');
  console.log('Saving authentication state...\n');

  // Save storage state
  const authFile = path.join(__dirname, '..', 'auth-state.json');
  await context.storageState({ path: authFile });

  console.log('✓ Auth state saved to:', authFile);
  console.log('\nYou can now run the user management test:');
  console.log('  npx playwright test tests/e2e/test-user-management-with-auth.spec.js');
});
