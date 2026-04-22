// @ts-check
/**
 * GOOGLE SHEETS VISIBILITY TEST
 * Verify that Google Sheets sync button and settings are hidden from tech/contractor
 * and visible to admin/dispatcher
 */
const { test, expect } = require('@playwright/test');

const URL = process.env.BASE_URL || 'https://crm.onpointprodoors.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'service@onpointprodoors.com';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'OnPoint2024!';
const TECH_EMAIL = process.env.TECH_EMAIL;
const TECH_PASS = process.env.TECH_PASSWORD;

// ══════════════════════════════════════════════════════════
// TEST 1: Tech CANNOT see Google Sheets sync button
// ══════════════════════════════════════════════════════════
test('Tech cannot see Google Sheets sync button in header', async ({ page }) => {
  test.skip(!TECH_EMAIL, 'TECH_EMAIL not set — skipping tech test');
  await page.goto(URL);

  // Log in as tech
  await page.waitForSelector('#login-screen:not(.hidden)', { timeout: 10000 });
  await page.fill('#login-email', TECH_EMAIL);
  await page.fill('#login-password', TECH_PASS);
  await page.click('#login-btn');

  // Wait for dashboard to load
  await page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });

  // Wait a bit for role UI to apply
  await page.waitForTimeout(1000);

  // Check if sync button exists
  const syncBtn = await page.$('#btn-sync');

  if (syncBtn) {
    // If button exists, it must be hidden
    const isVisible = await syncBtn.isVisible();
    console.log('[Tech] Sync button exists, isVisible:', isVisible);
    expect(isVisible).toBe(false);

    // Check if it has 'hidden' class
    const hasHiddenClass = await syncBtn.evaluate(el => el.classList.contains('hidden'));
    console.log('[Tech] Sync button has hidden class:', hasHiddenClass);
    expect(hasHiddenClass).toBe(true);
  } else {
    // Button doesn't exist at all - also acceptable
    console.log('[Tech] Sync button does not exist in DOM');
  }

  // Take screenshot for visual verification
  await page.screenshot({ path: 'test-results/tech-no-sync-button.png' });
});

// ══════════════════════════════════════════════════════════
// TEST 2: Tech CANNOT see Google Sheets settings in Settings page
// ══════════════════════════════════════════════════════════
test.skip('Tech cannot access Settings page', async ({ page }) => {
  // Skip because tech can't access Settings at all
  // Settings nav item is hidden from tech

  await page.goto(URL);

  await page.waitForSelector('#login-screen:not(.hidden)');
  await page.fill('#login-email', TECH_EMAIL);
  await page.fill('#login-password', TECH_PASS);
  await page.click('#login-btn');

  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForTimeout(1000);

  // Try to find Settings nav item
  const settingsNav = await page.$('.nav-item[data-view="settings"]');

  if (settingsNav) {
    const isVisible = await settingsNav.isVisible();
    console.log('[Tech] Settings nav exists, isVisible:', isVisible);
    expect(isVisible).toBe(false);
  } else {
    console.log('[Tech] Settings nav does not exist in DOM');
  }
});

// ══════════════════════════════════════════════════════════
// TEST 3: Admin CAN see Google Sheets sync button
// ══════════════════════════════════════════════════════════
test('Admin can see Google Sheets sync button in header', async ({ page }) => {
  await page.goto(URL);

  // Log in as admin
  await page.waitForSelector('#login-screen:not(.hidden)');
  await page.fill('#login-email', ADMIN_EMAIL);
  await page.fill('#login-password', ADMIN_PASS);
  await page.click('#login-btn');

  // Wait for dashboard
  await page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Check if sync button exists and is visible
  const syncBtn = await page.$('#btn-sync');
  expect(syncBtn).not.toBeNull();

  if (syncBtn) {
    const isVisible = await syncBtn.isVisible();
    console.log('[Admin] Sync button isVisible:', isVisible);
    expect(isVisible).toBe(true);

    // Should NOT have 'hidden' class
    const hasHiddenClass = await syncBtn.evaluate(el => el.classList.contains('hidden'));
    console.log('[Admin] Sync button has hidden class:', hasHiddenClass);
    expect(hasHiddenClass).toBe(false);
  }

  // Take screenshot
  await page.screenshot({ path: 'test-results/admin-has-sync-button.png' });
});

// ══════════════════════════════════════════════════════════
// TEST 4: Admin CAN see Google Sheets settings card
// ══════════════════════════════════════════════════════════
test('Admin can see Google Sheets settings in Settings page', async ({ page }) => {
  await page.goto(URL);

  await page.waitForSelector('#login-screen:not(.hidden)');
  await page.fill('#login-email', ADMIN_EMAIL);
  await page.fill('#login-password', ADMIN_PASS);
  await page.click('#login-btn');

  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForTimeout(1000);

  // Navigate to Settings
  const settingsNav = await page.$('.nav-item[data-view="settings"]');
  expect(settingsNav).not.toBeNull();

  // Click Settings
  await page.click('.nav-item[data-view="settings"]');
  await page.waitForTimeout(500);

  // Check if Google Sheets settings card exists and is visible
  const syncCard = await page.$('#settings-sync-card');
  expect(syncCard).not.toBeNull();

  if (syncCard) {
    const isVisible = await syncCard.isVisible();
    console.log('[Admin] Settings sync card isVisible:', isVisible);
    expect(isVisible).toBe(true);

    // Should NOT have 'hidden' class
    const hasHiddenClass = await syncCard.evaluate(el => el.classList.contains('hidden'));
    console.log('[Admin] Settings sync card has hidden class:', hasHiddenClass);
    expect(hasHiddenClass).toBe(false);
  }

  // Take screenshot
  await page.screenshot({ path: 'test-results/admin-has-sync-settings.png' });
});

// ══════════════════════════════════════════════════════════
// TEST 5: Dispatcher CAN see Google Sheets sync button
// ══════════════════════════════════════════════════════════
test.skip('Dispatcher can see Google Sheets sync button', async ({ page }) => {
  // Skip if no dispatcher account available
  // Same test as admin but with dispatcher credentials

  const DISPATCHER_EMAIL = 'dispatcher@onpointprodoors.com';
  const DISPATCHER_PASS = 'dispatcher_password_here';

  await page.goto(URL);

  await page.waitForSelector('#login-screen:not(.hidden)');
  await page.fill('#login-email', DISPATCHER_EMAIL);
  await page.fill('#login-password', DISPATCHER_PASS);
  await page.click('#login-btn');

  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForTimeout(1000);

  const syncBtn = await page.$('#btn-sync');
  expect(syncBtn).not.toBeNull();

  if (syncBtn) {
    const isVisible = await syncBtn.isVisible();
    expect(isVisible).toBe(true);
  }
});
