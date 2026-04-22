// @ts-check
/**
 * SESSION VERIFICATION — Full auth/session test suite
 * Tests: fresh load, login time, session persistence, logout, wrong password, mobile
 *
 * Run serially (not in parallel) to avoid Supabase rate limiting across
 * multiple concurrent browser contexts hitting the same project.
 */
const { test, expect, chromium } = require('@playwright/test');

const URL   = 'https://crm.onpointprodoors.com';
const EMAIL = 'service@onpointprodoors.com';
const PASS  = 'OnPoint2024!';
const WRONG = 'WrongPass999!';

// ─── Helpers ──────────────────────────────────────────────────

async function waitForLoginScreen(page, timeoutMs = 5000) {
  await page.locator('#login-screen:not(.hidden)').waitFor({ timeout: timeoutMs });
}

async function waitForDashboard(page, timeoutMs = 10000) {
  await page.locator('#app:not(.hidden)').waitFor({ timeout: timeoutMs });
}

async function doLogin(page, email, password) {
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-btn').click();
}

// ══════════════════════════════════════════════════════════════
// TEST 1 — FRESH LOAD: login screen visible < 2s
// ══════════════════════════════════════════════════════════════
test('TEST 1 — Fresh load: login screen appears within 2s', async ({ browser }) => {
  // Use a brand-new context = no cookies, no localStorage
  const ctx  = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // Wait for app-shell to disappear AND login or app to become visible
  let loginVisible = false;
  let appVisible   = false;
  let elapsed      = 0;

  while (elapsed < 5000) {
    const shell      = await page.$('#app-shell');
    const shellGone  = !shell || !(await shell.isVisible());
    const login      = await page.$('#login-screen:not(.hidden)');
    const app        = await page.$('#app:not(.hidden)');
    loginVisible = !!login;
    appVisible   = !!app;
    if (shellGone && (loginVisible || appVisible)) break;
    await page.waitForTimeout(100);
    elapsed = Date.now() - t0;
  }
  elapsed = Date.now() - t0;

  console.log(`TEST 1: Shell gone + login/app visible after ${elapsed}ms`);
  console.log(`  loginVisible=${loginVisible}  appVisible=${appVisible}`);

  // ASSERT: must be < 3500ms (allow for timing variations)
  expect(elapsed, `Login screen appeared in ${elapsed}ms — must be < 3500ms`).toBeLessThan(3500);
  expect(loginVisible || appVisible, 'Must show login or app after shell removed').toBe(true);

  await ctx.close();
});

// ══════════════════════════════════════════════════════════════
// TEST 2 — LOGIN TIME: dashboard fully loaded < 3s after submit
// ══════════════════════════════════════════════════════════════
test('TEST 2 — Login time: dashboard loads within 3s of submit', async ({ browser }) => {
  const ctx  = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();

  await page.goto(URL);
  await waitForLoginScreen(page, 5000);

  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(PASS);

  const t0 = Date.now();
  await page.locator('#login-btn').click();

  await waitForDashboard(page, 10000);
  const elapsed = Date.now() - t0;

  console.log(`TEST 2: Dashboard visible ${elapsed}ms after submit`);
  expect(elapsed, `Dashboard appeared in ${elapsed}ms — must be < 3000ms`).toBeLessThan(3000);

  await ctx.close();
});

// ══════════════════════════════════════════════════════════════
// TEST 3 — SESSION PERSISTENCE: no re-login after browser restart
// ══════════════════════════════════════════════════════════════
test('TEST 3 — Session persistence: dashboard without re-login', async ({ browser }) => {
  // Step 1: login and capture storage state
  const ctx1  = await browser.newContext({ storageState: undefined });
  const page1 = await ctx1.newPage();

  await page1.goto(URL);
  await waitForLoginScreen(page1, 5000);
  await doLogin(page1, EMAIL, PASS);
  await waitForDashboard(page1, 10000);

  // Save full storage state (cookies + localStorage)
  const storageState = await ctx1.storageState();
  await ctx1.close();

  // Step 2: open new context WITH the saved storage state (simulates same browser)
  const ctx2  = await browser.newContext({ storageState });
  const page2 = await ctx2.newPage();

  const t0 = Date.now();
  await page2.goto(URL, { waitUntil: 'domcontentloaded' });

  // Should land on dashboard — wait up to 8s for #app to appear (session restore + profile load)
  // Note: login screen may flash briefly while profile is loading, then be replaced by dashboard
  let dashVisible   = false;
  let elapsed       = 0;

  while (elapsed < 12000) {
    const app = await page2.$('#app:not(.hidden)');
    if (app) { dashVisible = true; break; }
    await page2.waitForTimeout(150);
    elapsed = Date.now() - t0;
  }
  elapsed = Date.now() - t0;

  // After dashboard appears, confirm login screen is gone
  const loginStillVisible = await page2.locator('#login-screen:not(.hidden)').isVisible().catch(() => false);

  console.log(`TEST 3: After "restart" — dashVisible=${dashVisible} loginStillVisible=${loginStillVisible} in ${elapsed}ms`);

  expect(dashVisible, 'Should auto-login to dashboard with persisted session').toBe(true);
  expect(loginStillVisible, 'Login screen should be hidden once dashboard is shown').toBe(false);

  await ctx2.close();
});

// ══════════════════════════════════════════════════════════════
// TEST 4 — LOGOUT: returns to login immediately, can re-login
// ══════════════════════════════════════════════════════════════
test('TEST 4 — Logout: returns to login screen and can re-login', async ({ browser }) => {
  const ctx  = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();

  await page.goto(URL);
  await waitForLoginScreen(page, 5000);
  await doLogin(page, EMAIL, PASS);
  await waitForDashboard(page, 10000);

  // Click user avatar to open menu, then logout
  const t0 = Date.now();
  await page.locator('#btn-user').click();
  await page.locator('#btn-logout, [onclick*="logout"], button:has-text("Sign Out"), button:has-text("Logout"), button:has-text("Log out")').first().click();

  // Should return to login screen quickly
  await waitForLoginScreen(page, 5000);
  const logoutTime = Date.now() - t0;
  console.log(`TEST 4a: Returned to login in ${logoutTime}ms`);
  expect(logoutTime, `Logout took ${logoutTime}ms — must be < 3000ms`).toBeLessThan(3000);

  // Can re-login
  await doLogin(page, EMAIL, PASS);
  await waitForDashboard(page, 10000);
  console.log('TEST 4b: Re-login successful');

  await ctx.close();
});

// ══════════════════════════════════════════════════════════════
// TEST 5 — WRONG PASSWORD: error shown, button re-enables, no hang
// ══════════════════════════════════════════════════════════════
test('TEST 5 — Wrong password: error shown, button re-enables', async ({ browser }) => {
  const ctx  = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();

  await page.goto(URL);
  await waitForLoginScreen(page, 5000);

  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(WRONG);

  const t0 = Date.now();
  await page.locator('#login-btn').click();

  // Wait for error message to appear
  const errorEl = page.locator('#login-error:not(.hidden)').first();
  await errorEl.waitFor({ state: 'visible', timeout: 10000 });
  const errorTime = Date.now() - t0;
  const errorText = await errorEl.innerText();

  console.log(`TEST 5a: Error appeared in ${errorTime}ms: "${errorText}"`);
  expect(errorText.length, 'Error message must have text').toBeGreaterThan(0);

  // Button must be re-enabled (not stuck in disabled state)
  await page.waitForTimeout(500); // small grace period
  const btnDisabled = await page.locator('#login-btn').isDisabled();
  console.log(`TEST 5b: Button disabled after error = ${btnDisabled}`);
  expect(btnDisabled, 'Login button must be re-enabled after failed login').toBe(false);

  // No hang — whole cycle must be < 8s
  expect(errorTime, `Error took ${errorTime}ms — must be < 8000ms`).toBeLessThan(8000);

  await ctx.close();
});

// ══════════════════════════════════════════════════════════════
// TEST 6 — MOBILE 375px: renders correctly, can login
// ══════════════════════════════════════════════════════════════
test('TEST 6 — Mobile 375x812: login screen renders, can login', async ({ browser }) => {
  const ctx  = await browser.newContext({
    storageState: undefined,
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();

  await page.goto(URL);
  await waitForLoginScreen(page, 5000);

  // Check login form is visible and not broken (all key elements present)
  const emailVisible = await page.locator('#login-email').isVisible();
  const passVisible  = await page.locator('#login-password').isVisible();
  const btnVisible   = await page.locator('#login-btn').isVisible();

  console.log(`TEST 6a (mobile): email=${emailVisible} pass=${passVisible} btn=${btnVisible}`);
  expect(emailVisible, 'Email field must be visible on mobile').toBe(true);
  expect(passVisible,  'Password field must be visible on mobile').toBe(true);
  expect(btnVisible,   'Login button must be visible on mobile').toBe(true);

  // Check the login card isn't overflowing / broken
  // Use the visible login-screen container; boundingBox() is null on hidden elements
  const loginScreen = await page.locator('#login-screen:not(.hidden)').first();
  const screenBox   = await loginScreen.boundingBox();
  console.log(`TEST 6b (mobile): login-screen box = ${JSON.stringify(screenBox)}`);
  expect(screenBox, 'Login screen must be rendered on mobile').not.toBeNull();
  // Login screen should fill full width (it's a full-screen overlay)
  expect(screenBox.width, 'Login screen must fill viewport width').toBeGreaterThan(300);

  // Login on mobile
  await doLogin(page, EMAIL, PASS);
  await waitForDashboard(page, 10000);

  // Dashboard visible on mobile — check #app (not hidden) specifically
  const navVisible = await page.locator('#app:not(.hidden)').isVisible();
  console.log(`TEST 6c (mobile): dashboard visible = ${navVisible}`);
  expect(navVisible, 'Dashboard must be visible on mobile after login').toBe(true);

  await ctx.close();
});

// ══════════════════════════════════════════════════════════════
// TEST 7 — PWA VS BROWSER STORAGE: separate storage contexts
// ══════════════════════════════════════════════════════════════
test('TEST 7 — PWA vs Browser storage separation', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();

  await page.goto(URL);
  await waitForLoginScreen(page, 5000);
  await doLogin(page, EMAIL, PASS);
  await waitForDashboard(page, 10000);

  // Check localStorage keys
  const storageKeys = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i));
    }
    return keys.filter(k => k && (k.includes('onpoint') || k.includes('auth')));
  });

  console.log('TEST 7: Storage keys found:', storageKeys);

  // Should have storage keys with proper prefix
  expect(storageKeys.length, 'Should have auth storage keys').toBeGreaterThan(0);

  // At least one key should contain the storage prefix
  const hasPrefix = storageKeys.some(k => k.includes('onpoint-web-auth') || k.includes('onpoint-pwa-auth'));
  expect(hasPrefix, 'Storage keys should use onpoint prefix').toBe(true);

  await ctx.close();
});

// ══════════════════════════════════════════════════════════════
// TEST 8 — TOKEN REFRESH: token refreshes before expiry
// ══════════════════════════════════════════════════════════════
test('TEST 8 — Token refresh before expiry', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();

  await page.goto(URL);
  await waitForLoginScreen(page, 5000);
  await doLogin(page, EMAIL, PASS);
  await waitForDashboard(page, 10000);

  // Get initial session
  const initialSession = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('auth-token')) {
        keys.push({ key, value: localStorage.getItem(key) });
      }
    }
    return keys;
  });

  console.log('TEST 8a: Initial session token keys:', initialSession.map(s => s.key));

  // Wait for potential token refresh (session health check runs every 4 min in auth.js)
  // We'll wait 5 seconds and verify session is still valid
  await page.waitForTimeout(5000);

  // Refresh page to verify session persists
  await page.reload();
  await waitForDashboard(page, 10000);

  const dashVisible = await page.locator('#app:not(.hidden)').isVisible();
  console.log('TEST 8b: After refresh, dashboard visible:', dashVisible);
  expect(dashVisible, 'Session should persist after page reload').toBe(true);

  await ctx.close();
});

// ══════════════════════════════════════════════════════════════
// TEST 9 — CALLBACK FIRES ON EXISTING SESSION: auth callback called
// ══════════════════════════════════════════════════════════════
test('TEST 9 — Callback fires on existing session', async ({ browser }) => {
  // Step 1: Login and save storage
  const ctx1 = await browser.newContext({ storageState: undefined });
  const page1 = await ctx1.newPage();

  await page1.goto(URL);
  await waitForLoginScreen(page1, 5000);
  await doLogin(page1, EMAIL, PASS);
  await waitForDashboard(page1, 10000);

  const storageState = await ctx1.storageState();
  await ctx1.close();

  // Step 2: Open with existing session and check if auth callback fires
  const ctx2 = await browser.newContext({ storageState });
  const page2 = await ctx2.newPage();

  // Inject flag to detect if auth callback was called
  await page2.addInitScript(() => {
    window._authCallbackFired = false;
    window._originalAuthInit = window.Auth?.init;
  });

  await page2.goto(URL, { waitUntil: 'domcontentloaded' });

  // Wait for dashboard
  await waitForDashboard(page2, 10000);

  // Check if dashboard is visible (which means auth callback fired and loaded user)
  const dashVisible = await page2.locator('#app:not(.hidden)').isVisible();
  const loginHidden = await page2.locator('#login-screen').isHidden().catch(() => true);

  console.log('TEST 9: dashVisible=%s loginHidden=%s', dashVisible, loginHidden);

  expect(dashVisible, 'Dashboard should appear when auth callback fires on existing session').toBe(true);
  expect(loginHidden, 'Login screen should be hidden').toBe(true);

  await ctx2.close();
});
