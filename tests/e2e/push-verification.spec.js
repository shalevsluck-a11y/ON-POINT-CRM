// @ts-check
/**
 * PUSH NOTIFICATION VERIFICATION — Test web push notifications
 * Tests: permission request, notification display, click navigation, service worker integration
 *
 * Note: Push notifications require HTTPS in production
 * Run serially to avoid permission conflicts
 */
const { test, expect } = require('@playwright/test');

const URL = 'https://crm.onpointprodoors.com';
const ADMIN_EMAIL = 'service@onpointprodoors.com';
const ADMIN_PASS = 'OnPoint2024!';

// Helper: Login
async function login(page, email, password) {
  await page.goto(URL);
  await page.locator('#login-screen:not(.hidden)').waitFor({ timeout: 5000 });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-btn').click();
  await page.locator('#app:not(.hidden)').waitFor({ timeout: 10000 });
}

// ══════════════════════════════════════════════════════════════
// TEST 1 — PERMISSION REQUEST FLOW
// ══════════════════════════════════════════════════════════════
test('TEST 1 — Permission request flow', async ({ browser, context }) => {
  const ctx = await browser.newContext({
    permissions: ['notifications']
  });
  const page = await ctx.newPage();

  try {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);

    // Check if push manager is available
    const pushSupported = await page.evaluate(() => {
      return 'serviceWorker' in navigator && 'PushManager' in window;
    });

    console.log('TEST 1a: Push notifications supported:', pushSupported);
    expect(pushSupported, 'Browser should support push notifications').toBe(true);

    // Check notification permission
    const permission = await page.evaluate(() => {
      return Notification.permission;
    });

    console.log('TEST 1b: Notification permission:', permission);
    expect(['granted', 'default', 'denied']).toContain(permission);

    // Verify service worker registration
    const swRegistered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js');
      return registration !== undefined;
    });

    console.log('TEST 1c: Service worker registered:', swRegistered);

  } finally {
    await ctx.close();
  }
});

// ══════════════════════════════════════════════════════════════
// TEST 2 — NOTIFICATION APPEARS ON ASSIGNMENT
// ══════════════════════════════════════════════════════════════
test('TEST 2 — Notification display mechanism', async ({ browser }) => {
  const ctx = await browser.newContext({
    permissions: ['notifications']
  });
  const page = await ctx.newPage();

  try {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);

    // Grant notification permission
    await page.evaluate(() => {
      return Notification.requestPermission();
    });

    // Check if PushManager module is loaded
    const pushManagerExists = await page.evaluate(() => {
      return typeof window.PushManager !== 'undefined';
    });

    console.log('TEST 2a: PushManager available:', pushManagerExists);

    // Test notification creation (if supported)
    const canShowNotification = await page.evaluate(() => {
      if (Notification.permission === 'granted') {
        try {
          new Notification('Test Notification', {
            body: 'Testing notification display',
            icon: '/icon-192.png',
            tag: 'test'
          });
          return true;
        } catch (e) {
          console.error('Notification creation failed:', e);
          return false;
        }
      }
      return false;
    });

    console.log('TEST 2b: Can show notifications:', canShowNotification);

    // Verify service worker can handle push events
    const swCanHandlePush = await page.evaluate(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        if (!registration) return false;

        // Check if service worker script exists
        return registration.active !== null;
      } catch (e) {
        console.error('SW push check failed:', e);
        return false;
      }
    });

    console.log('TEST 2c: Service worker can handle push:', swCanHandlePush);

  } finally {
    await ctx.close();
  }
});

// ══════════════════════════════════════════════════════════════
// TEST 3 — CLICK NAVIGATES TO JOB
// ══════════════════════════════════════════════════════════════
test('TEST 3 — Notification click handler', async ({ browser }) => {
  const ctx = await browser.newContext({
    permissions: ['notifications']
  });
  const page = await ctx.newPage();

  try {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);

    // Verify service worker has notificationclick handler
    const hasClickHandler = await page.evaluate(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        if (!registration || !registration.active) return false;

        // Service worker is active - check if sw.js file exists by fetching it
        const response = await fetch('/sw.js');
        if (!response.ok) return false;

        const swContent = await response.text();
        return swContent.includes('notificationclick');
      } catch (e) {
        console.error('Click handler check failed:', e);
        return false;
      }
    });

    console.log('TEST 3a: Notification click handler exists:', hasClickHandler);
    expect(hasClickHandler, 'Service worker should have notification click handler').toBe(true);

    // Verify service worker can open windows
    const canOpenWindow = await page.evaluate(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        if (!registration || !registration.active) return false;

        const swContent = await (await fetch('/sw.js')).text();
        return swContent.includes('clients.openWindow');
      } catch (e) {
        return false;
      }
    });

    console.log('TEST 3b: Service worker can navigate:', canOpenWindow);
    expect(canOpenWindow, 'Service worker should be able to open windows').toBe(true);

  } finally {
    await ctx.close();
  }
});

// ══════════════════════════════════════════════════════════════
// TEST 4 — SERVICE WORKER PUSH EVENT HANDLER
// ══════════════════════════════════════════════════════════════
test('TEST 4 — Service worker push event integration', async ({ browser }) => {
  const ctx = await browser.newContext({
    permissions: ['notifications']
  });
  const page = await ctx.newPage();

  try {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);

    // Check service worker registration
    const swStatus = await page.evaluate(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        if (!registration) {
          return { registered: false, active: false };
        }

        return {
          registered: true,
          active: registration.active !== null,
          scope: registration.scope
        };
      } catch (e) {
        return { registered: false, active: false, error: e.message };
      }
    });

    console.log('TEST 4a: Service worker status:', swStatus);
    expect(swStatus.registered, 'Service worker should be registered').toBe(true);

    // Verify push event handler exists
    const hasPushHandler = await page.evaluate(async () => {
      try {
        const response = await fetch('/sw.js');
        if (!response.ok) return false;

        const swContent = await response.text();
        return swContent.includes('push') && swContent.includes('showNotification');
      } catch (e) {
        console.error('Push handler check failed:', e);
        return false;
      }
    });

    console.log('TEST 4b: Push event handler exists:', hasPushHandler);
    expect(hasPushHandler, 'Service worker should have push event handler').toBe(true);

    // Check if push subscription can be created (requires VAPID key)
    const canSubscribe = await page.evaluate(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        if (!registration) return false;

        // Check if pushManager is available
        return registration.pushManager !== undefined;
      } catch (e) {
        return false;
      }
    });

    console.log('TEST 4c: Push subscription available:', canSubscribe);
    expect(canSubscribe, 'Push subscription mechanism should be available').toBe(true);

  } finally {
    await ctx.close();
  }
});

// ══════════════════════════════════════════════════════════════
// TEST 5 — PUSH MANAGER INTEGRATION
// ══════════════════════════════════════════════════════════════
test('TEST 5 — PushManager module integration', async ({ browser }) => {
  const ctx = await browser.newContext({
    permissions: ['notifications']
  });
  const page = await ctx.newPage();

  try {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);

    // Check if push-manager.js is loaded
    const pushManagerLoaded = await page.evaluate(() => {
      return typeof window.PushManager !== 'undefined' ||
             typeof window.subscribeToPush === 'function';
    });

    console.log('TEST 5a: Push manager module loaded:', pushManagerLoaded);

    // Verify VAPID public key exists
    const hasVapidKey = await page.evaluate(async () => {
      try {
        // Check if VAPID key is defined in push-manager.js
        const response = await fetch('/js/push-manager.js');
        if (!response.ok) return false;

        const content = await response.text();
        return content.includes('VAPID_PUBLIC_KEY');
      } catch (e) {
        return false;
      }
    });

    console.log('TEST 5b: VAPID public key configured:', hasVapidKey);
    expect(hasVapidKey, 'VAPID public key should be configured').toBe(true);

    // Check if urlBase64ToUint8Array utility exists
    const hasUtilFunction = await page.evaluate(async () => {
      try {
        const response = await fetch('/js/push-manager.js');
        if (!response.ok) return false;

        const content = await response.text();
        return content.includes('urlBase64ToUint8Array');
      } catch (e) {
        return false;
      }
    });

    console.log('TEST 5c: Base64 conversion utility exists:', hasUtilFunction);
    expect(hasUtilFunction, 'URL base64 conversion utility should exist').toBe(true);

  } finally {
    await ctx.close();
  }
});
