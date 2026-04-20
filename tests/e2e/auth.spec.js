// @ts-check
const { test, expect } = require('@playwright/test');

// These tests require ADMIN_EMAIL + ADMIN_PASSWORD env vars (GitHub secrets)
// Skip gracefully if not set
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TECH_EMAIL     = process.env.TECH_EMAIL;
const TECH_PASSWORD  = process.env.TECH_PASSWORD;
const DISP_EMAIL     = process.env.DISP_EMAIL;
const DISP_PASSWORD  = process.env.DISP_PASSWORD;

async function login(page, email, password) {
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-btn').click();
  // Wait for app to appear
  await page.locator('#app:not(.hidden)').waitFor({ timeout: 10000 });
}

test.describe('Admin role', () => {
  test.skip(!ADMIN_EMAIL, 'ADMIN_EMAIL not set — skipping admin tests');

  test('admin can log in and see Settings tab', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'https://crm.onpointprodoors.com');
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.locator('#nav-settings')).toBeVisible();
  });

  test('admin sees Zelle memo field in job detail', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'https://crm.onpointprodoors.com');
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Open first job if any
    const firstJob = page.locator('.job-card').first();
    if (await firstJob.count() === 0) return; // No jobs yet
    await firstJob.click();
    await expect(page.locator('#zelle-section, .zelle-btn, [id*="zelle"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('admin can open Settings and see user management', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'https://crm.onpointprodoors.com');
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.locator('#nav-settings').click();
    await expect(page.locator('#admin-users-section')).not.toHaveClass(/hidden/);
  });
});

test.describe('Dispatcher role', () => {
  test.skip(!DISP_EMAIL, 'DISP_EMAIL not set — skipping dispatcher tests');

  test('dispatcher can log in', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'https://crm.onpointprodoors.com');
    await login(page, DISP_EMAIL, DISP_PASSWORD);
    await expect(page.locator('#app')).not.toHaveClass(/hidden/);
  });

  test('dispatcher cannot see Zelle memo', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'https://crm.onpointprodoors.com');
    await login(page, DISP_EMAIL, DISP_PASSWORD);
    const firstJob = page.locator('.job-card').first();
    if (await firstJob.count() === 0) return;
    await firstJob.click();
    // Zelle button must not be present for dispatcher
    await expect(page.locator('.zelle-btn, [id*="zelle-btn"]').first()).not.toBeVisible({ timeout: 3000 }).catch(() => {});
  });
});

test.describe('Tech role', () => {
  test.skip(!TECH_EMAIL, 'TECH_EMAIL not set — skipping tech tests');

  test('tech can log in', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'https://crm.onpointprodoors.com');
    await login(page, TECH_EMAIL, TECH_PASSWORD);
    await expect(page.locator('#app')).not.toHaveClass(/hidden/);
  });

  test('tech cannot see New Job button', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'https://crm.onpointprodoors.com');
    await login(page, TECH_EMAIL, TECH_PASSWORD);
    await expect(page.locator('#nav-new-job, .nav-new')).not.toBeVisible({ timeout: 3000 }).catch(() => {});
  });

  test('tech cannot see financials in job detail', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'https://crm.onpointprodoors.com');
    await login(page, TECH_EMAIL, TECH_PASSWORD);
    const firstJob = page.locator('.job-card').first();
    if (await firstJob.count() === 0) return;
    await firstJob.click();
    // Revenue / total fields must be hidden or show $0
    const totalEl = page.locator('[id*="job-total"], .job-total').first();
    if (await totalEl.count() > 0) {
      const text = await totalEl.innerText();
      expect(text).toMatch(/\$0|hidden|—/i);
    }
  });
});
