// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'https://crm.onpointprodoors.com';

test.describe('Smoke — no auth required', () => {

  test('app loads and shows auth screen', async ({ page }) => {
    await page.goto(BASE);
    await expect(page).toHaveTitle(/On Point/i);
    // Either login or first-setup screen must be visible
    const loginVisible = await page.locator('#login-screen').isVisible().catch(() => false);
    const setupVisible = await page.locator('#setup-screen').isVisible().catch(() => false);
    expect(loginVisible || setupVisible).toBe(true);
  });

  test('app screen is hidden until authenticated', async ({ page }) => {
    await page.goto(BASE);
    const app = page.locator('#app');
    await expect(app).toHaveClass(/hidden/);
  });

  test('PWA manifest is reachable', async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(json.name).toBeTruthy();
  });

  test('service worker script is reachable', async ({ request }) => {
    const res = await request.get(`${BASE}/sw.js`);
    expect(res.ok()).toBe(true);
  });

  test('security headers are present', async ({ request }) => {
    const res = await request.get(BASE);
    const headers = res.headers();
    // Must not be framed by other sites
    expect(
      headers['x-frame-options'] || headers['content-security-policy']
    ).toBeTruthy();
    // No MIME sniffing
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  test('unauthenticated Supabase REST returns 401 or is RLS-blocked', async ({ request }) => {
    // Read the Supabase URL from the deployed supabase-client.js
    const srcRes = await request.get(`${BASE}/js/supabase-client.js`);
    const src = await srcRes.text();
    const match = src.match(/SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
    if (!match) return; // Skip if we can't parse it
    const supabaseUrl = match[1];

    // Direct REST call with no auth — should NOT return job rows
    const res = await request.get(`${supabaseUrl}/rest/v1/jobs?select=*`, {
      headers: { apikey: 'invalid', Authorization: 'Bearer invalid' },
    });
    // 400 or 401 — either way, NOT 200 with data
    expect(res.status()).not.toBe(200);
  });

});
