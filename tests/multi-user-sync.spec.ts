import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'https://crm.onpointprodoors.com';
const ADMIN_TOKEN = 'ADMIN-SOLOMON'; // Update with actual token
const DISPATCHER_TOKEN = 'DISPATCHER-MAMI'; // Update with actual token

// Helper: Login via magic token
async function loginAs(page: Page, userType: 'admin' | 'dispatcher') {
  const token = userType === 'admin' ? ADMIN_TOKEN : DISPATCHER_TOKEN;

  await page.goto(BASE_URL);
  await page.waitForTimeout(1000);

  // Enter magic token
  const loginInput = page.locator('#login-email');
  await loginInput.fill(token);

  // Click continue
  await page.locator('#login-submit').click();

  // Wait for auth to complete
  await page.waitForTimeout(3000);

  // Verify logged in by checking for dashboard
  await expect(page.locator('.nav-item[data-view="dashboard"]')).toBeVisible({ timeout: 10000 });

  console.log(`✓ Logged in as ${userType}`);
}

// Helper: Capture console logs
function captureConsoleLogs(page: Page, logs: string[]) {
  page.on('console', msg => {
    const text = `[${msg.type().toUpperCase()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });

  page.on('pageerror', error => {
    const text = `[ERROR] ${error.message}`;
    logs.push(text);
    console.log(text);
  });
}

// Helper: Get debug panel content
async function captureDebugPanel(page: Page, screenshotName: string) {
  try {
    // Look for debug panel button
    const debugBtn = page.locator('#debug-toggle, .debug-btn, button:has-text("Debug")').first();
    if (await debugBtn.isVisible({ timeout: 2000 })) {
      await debugBtn.click();
      await page.waitForTimeout(500);

      // Screenshot the debug panel
      await page.screenshot({
        path: `test-results/${screenshotName}-debug.png`,
        fullPage: true
      });

      // Get debug content as text
      const debugPanel = page.locator('#debug-panel, .debug-panel').first();
      if (await debugPanel.isVisible({ timeout: 1000 })) {
        const content = await debugPanel.textContent();
        return content || 'Debug panel empty';
      }
    }
  } catch (e) {
    console.log('Could not capture debug panel:', e);
  }
  return 'Debug panel not available';
}

// Helper: Create a job
async function createJob(page: Page, jobData: {
  customerName: string;
  phone: string;
  address: string;
  leadSource?: string; // If omitted, uses default
}) {
  // Click New Job
  await page.locator('.btn-primary:has-text("New Job"), button:has-text("New Job")').first().click();
  await page.waitForTimeout(1000);

  // Fill form
  await page.locator('#f-customer-name, input[name="customerName"]').fill(jobData.customerName);
  await page.locator('#f-phone, input[name="phone"]').fill(jobData.phone);
  await page.locator('#f-address, input[name="address"]').fill(jobData.address);

  // Set lead source if provided
  if (jobData.leadSource) {
    const sourceDropdown = page.locator('#f-source, select[name="source"]');
    await sourceDropdown.selectOption({ label: jobData.leadSource });
  }

  // Submit
  await page.locator('#job-save-btn, button:has-text("Save Job")').click();

  // Wait for job to save
  await page.waitForTimeout(2000);

  console.log(`✓ Created job for ${jobData.customerName}`);
}

// Helper: Get list of jobs visible on screen
async function getVisibleJobs(page: Page): Promise<string[]> {
  await page.waitForTimeout(1000);

  const jobCards = page.locator('.job-card, .job-item, [data-job-id]');
  const count = await jobCards.count();

  const jobs: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await jobCards.nth(i).textContent();
    if (text) jobs.push(text.trim());
  }

  return jobs;
}

test.describe('Multi-User Real-Time Sync Tests', () => {
  let browser: Browser;
  let adminContext: BrowserContext;
  let dispatcherContext: BrowserContext;
  let adminPage: Page;
  let dispatcherPage: Page;

  const adminLogs: string[] = [];
  const dispatcherLogs: string[] = [];

  test.beforeAll(async ({ browser: b }) => {
    browser = b;

    // Create isolated contexts for each user
    adminContext = await browser.newContext({
      storageState: undefined,
      viewport: { width: 1280, height: 720 }
    });

    dispatcherContext = await browser.newContext({
      storageState: undefined,
      viewport: { width: 1280, height: 720 }
    });

    adminPage = await adminContext.newPage();
    dispatcherPage = await dispatcherContext.newPage();

    // Capture console logs
    captureConsoleLogs(adminPage, adminLogs);
    captureConsoleLogs(dispatcherPage, dispatcherLogs);

    // Login both users
    await loginAs(adminPage, 'admin');
    await loginAs(dispatcherPage, 'dispatcher');

    console.log('\n✓ Both users logged in and ready\n');
  });

  test.afterAll(async () => {
    // Save logs to files
    fs.writeFileSync('test-results/admin-logs.txt', adminLogs.join('\n'));
    fs.writeFileSync('test-results/dispatcher-logs.txt', dispatcherLogs.join('\n'));

    await adminContext.close();
    await dispatcherContext.close();
  });

  test('Test A: Admin adds job → Dispatcher sees it (Real-Time)', async () => {
    console.log('\n=== TEST A: Admin → Dispatcher Real-Time ===\n');

    // Admin creates job
    const jobName = `Test-Admin-${Date.now()}`;
    await createJob(adminPage, {
      customerName: jobName,
      phone: '555-0001',
      address: '123 Test St',
      leadSource: 'SONART CONSTRUCTION' // Dispatcher's assigned source
    });

    // Wait for real-time sync
    console.log('Waiting 10 seconds for real-time sync...');
    await dispatcherPage.waitForTimeout(10000);

    // Check if job appears on dispatcher screen
    const dispatcherJobs = await getVisibleJobs(dispatcherPage);
    const jobFound = dispatcherJobs.some(j => j.includes(jobName));

    if (!jobFound) {
      console.error('❌ Job NOT visible to dispatcher!');
      await dispatcherPage.screenshot({ path: 'test-results/test-a-failed.png', fullPage: true });
      await captureDebugPanel(dispatcherPage, 'test-a');

      // Check realtime logs
      const realtimeLogs = dispatcherLogs.filter(l => l.includes('[Realtime]') || l.includes('INSERT'));
      console.log('Realtime logs:', realtimeLogs);
    }

    expect(jobFound, 'Dispatcher should see job added by admin in real-time').toBe(true);
  });

  test('Test B: Dispatcher adds job → Admin sees it (Real-Time)', async () => {
    console.log('\n=== TEST B: Dispatcher → Admin Real-Time ===\n');

    // Dispatcher creates job
    const jobName = `Test-Dispatcher-${Date.now()}`;

    // First check: Lead source should be auto-selected and disabled
    await dispatcherPage.locator('button:has-text("New Job")').first().click();
    await dispatcherPage.waitForTimeout(1000);

    const sourceDropdown = dispatcherPage.locator('#f-source');
    const isDisabled = await sourceDropdown.isDisabled();

    expect(isDisabled, 'Lead source dropdown should be disabled for dispatcher').toBe(true);

    // Create job
    await createJob(dispatcherPage, {
      customerName: jobName,
      phone: '555-0002',
      address: '456 Test Ave'
    });

    // Wait for real-time sync
    console.log('Waiting 10 seconds for real-time sync...');
    await adminPage.waitForTimeout(10000);

    // Check if job appears on admin screen
    const adminJobs = await getVisibleJobs(adminPage);
    const jobFound = adminJobs.some(j => j.includes(jobName));

    if (!jobFound) {
      console.error('❌ Job NOT visible to admin!');
      await adminPage.screenshot({ path: 'test-results/test-b-failed.png', fullPage: true });
      await captureDebugPanel(adminPage, 'test-b');

      const realtimeLogs = adminLogs.filter(l => l.includes('[Realtime]') || l.includes('INSERT'));
      console.log('Realtime logs:', realtimeLogs);
    }

    expect(jobFound, 'Admin should see job added by dispatcher in real-time').toBe(true);
  });

  test('Test C: Dispatcher cannot see jobs from other lead sources', async () => {
    console.log('\n=== TEST C: Lead Source Filtering ===\n');

    // Admin creates job with DIFFERENT lead source
    const jobName = `Test-Other-Source-${Date.now()}`;
    await createJob(adminPage, {
      customerName: jobName,
      phone: '555-0003',
      address: '789 Other St',
      leadSource: 'My Lead' // NOT assigned to dispatcher
    });

    await dispatcherPage.waitForTimeout(10000);

    // Dispatcher should NOT see this job
    const dispatcherJobs = await getVisibleJobs(dispatcherPage);
    const jobFound = dispatcherJobs.some(j => j.includes(jobName));

    expect(jobFound, 'Dispatcher should NOT see jobs from other lead sources').toBe(false);

    // Admin SHOULD see it
    const adminJobs = await getVisibleJobs(adminPage);
    const adminSees = adminJobs.some(j => j.includes(jobName));

    expect(adminSees, 'Admin should see all jobs').toBe(true);
  });

  test('Test D: Lead source dropdown shows correct options', async () => {
    console.log('\n=== TEST D: Lead Source Dropdown ===\n');

    // Admin: should see ALL sources
    await adminPage.locator('button:has-text("New Job")').first().click();
    await adminPage.waitForTimeout(1000);

    const adminSourceOptions = await adminPage.locator('#f-source option').allTextContents();
    console.log('Admin sees sources:', adminSourceOptions);

    expect(adminSourceOptions.length, 'Admin should see multiple lead sources').toBeGreaterThan(1);
    expect(adminSourceOptions.some(o => o.includes('My Lead')), 'Admin should see "My Lead"').toBe(true);

    // Close admin dialog
    await adminPage.keyboard.press('Escape');

    // Dispatcher: should see ONLY assigned source
    await dispatcherPage.locator('button:has-text("New Job")').first().click();
    await dispatcherPage.waitForTimeout(1000);

    const dispatcherSourceOptions = await dispatcherPage.locator('#f-source option').allTextContents();
    console.log('Dispatcher sees sources:', dispatcherSourceOptions);

    expect(dispatcherSourceOptions.length, 'Dispatcher should see only 1 source').toBe(1);
    expect(dispatcherSourceOptions[0].includes('SONART CONSTRUCTION'), 'Dispatcher should see assigned source').toBe(true);

    // Close dispatcher dialog
    await dispatcherPage.keyboard.press('Escape');
  });

  test('Test E: Full App Exploration - Find ALL bugs', async () => {
    console.log('\n=== TEST E: Comprehensive Bug Hunt ===\n');

    const bugs: string[] = [];

    // Check all navigation links (Admin)
    console.log('Testing navigation links...');
    const navItems = ['dashboard', 'settings'];
    for (const nav of navItems) {
      try {
        await adminPage.locator(`.nav-item[data-view="${nav}"]`).click();
        await adminPage.waitForTimeout(1000);

        // Check for errors
        const hasError = await adminPage.locator('.error-message, .toast-error').isVisible({ timeout: 2000 });
        if (hasError) {
          bugs.push(`Navigation to ${nav} shows error`);
        }
      } catch (e) {
        bugs.push(`Failed to navigate to ${nav}: ${e}`);
      }
    }

    // Test Settings page visibility
    console.log('Testing Settings page permissions...');
    await adminPage.locator('.nav-item[data-view="settings"]').click();
    await adminPage.waitForTimeout(1000);

    // Admin should see Google Sheets sync
    const adminSeesSheets = await adminPage.locator('#settings-sync-card').isVisible({ timeout: 2000 });
    expect(adminSeesSheets, 'Admin should see Google Sheets sync section').toBe(true);

    // Dispatcher should NOT see Google Sheets sync
    await dispatcherPage.locator('.nav-item[data-view="settings"]').click();
    await dispatcherPage.waitForTimeout(1000);

    const dispatcherSeesSheets = await dispatcherPage.locator('#settings-sync-card').isVisible({ timeout: 2000 });
    expect(dispatcherSeesSheets, 'Dispatcher should NOT see Google Sheets sync').toBe(false);

    // Dispatcher SHOULD see notification settings
    const dispatcherSeesNotifs = await dispatcherPage.locator('#settings-notifications-card').isVisible({ timeout: 2000 });
    expect(dispatcherSeesNotifs, 'Dispatcher should see notification settings').toBe(true);

    // Test network errors
    console.log('Checking for network errors...');
    const failedRequests = adminLogs.filter(l => l.includes('Failed to') || l.includes('error') || l.includes('ERROR'));
    if (failedRequests.length > 0) {
      console.log('Network errors found:', failedRequests);
    }

    // Report bugs
    if (bugs.length > 0) {
      console.log('\n⚠️ BUGS FOUND:');
      bugs.forEach((bug, i) => console.log(`${i + 1}. ${bug}`));
      fs.writeFileSync('test-results/bugs-found.txt', bugs.join('\n'));
    } else {
      console.log('\n✅ No bugs found in exploration!');
    }
  });
});

// Generate report
test.afterAll(async () => {
  const report = {
    timestamp: new Date().toISOString(),
    summary: 'Multi-user sync and permissions testing complete',
    adminLogs: adminLogs.length,
    dispatcherLogs: dispatcherLogs.length,
  };

  fs.writeFileSync('test-results/test-report.json', JSON.stringify(report, null, 2));
  console.log('\n✅ Test report saved to test-results/test-report.json');
});
