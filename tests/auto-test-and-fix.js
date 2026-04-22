const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'https://crm.onpointprodoors.com';
const TEST_RESULTS = [];
const ALL_LOGS = [];

function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${type}] ${message}`;
  ALL_LOGS.push(entry);
  console.log(entry);
}

function addTestResult(test, passed, details) {
  TEST_RESULTS.push({ test, passed, details, timestamp: new Date().toISOString() });
  log(`TEST: ${test} - ${passed ? '✅ PASS' : '❌ FAIL'} - ${details}`, passed ? 'PASS' : 'FAIL');
}

async function captureConsoleLogs(page, userType) {
  const consoleLogs = [];

  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    log(`[${userType}] ${text}`, 'CONSOLE');
  });

  page.on('pageerror', error => {
    log(`[${userType}] PAGE ERROR: ${error.message}`, 'ERROR');
    consoleLogs.push(`ERROR: ${error.message}`);
  });

  return consoleLogs;
}

async function testDispatcherView(page) {
  log('=== TESTING DISPATCHER VIEW ===', 'TEST');

  try {
    // Navigate to app
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    log('Loaded app homepage');

    // Take initial screenshot
    await page.screenshot({ path: 'test-results/01-dispatcher-login.png' });

    // Check if we're on login screen
    const loginInput = await page.locator('#login-email').isVisible({ timeout: 5000 });

    if (loginInput) {
      log('On login screen - need manual login for full test', 'WARN');
      addTestResult('Dispatcher - Automatic Login', false, 'Cannot auto-login without valid magic token');

      // Wait for manual login
      log('Waiting 30 seconds for manual login...', 'WARN');
      await page.waitForTimeout(30000);
    }

    // Check if logged in
    const dashboard = await page.locator('.nav-item[data-view="dashboard"]').isVisible({ timeout: 5000 });

    if (!dashboard) {
      log('Not logged in after 30 seconds', 'ERROR');
      addTestResult('Dispatcher - Login Status', false, 'User not logged in');
      return;
    }

    log('User is logged in!');
    addTestResult('Dispatcher - Login Status', true, 'Successfully logged in');

    // Click New Job
    log('Clicking New Job...');
    const newJobBtn = page.locator('.nav-item[data-view="new-job"]');
    await newJobBtn.click();
    await page.waitForTimeout(3000); // Wait for settings sync

    await page.screenshot({ path: 'test-results/02-dispatcher-new-job.png' });

    // Get all console logs related to source dropdown
    await page.waitForTimeout(1000);

    // Check dropdown options
    const sourceDropdown = page.locator('#f-source');
    const isDisabled = await sourceDropdown.isDisabled();

    log(`Dropdown disabled: ${isDisabled}`);
    addTestResult('Dispatcher - Dropdown Disabled', isDisabled, isDisabled ? 'Dropdown is correctly disabled' : 'Dropdown should be disabled!');

    const options = await sourceDropdown.locator('option').allTextContents();
    log(`Dropdown options: ${JSON.stringify(options)}`);

    // Check if only SONART CONSTRUCTION is shown (no My Lead)
    const hasMyLead = options.some(opt => opt.includes('My Lead'));
    const hasSonart = options.some(opt => opt.includes('SONART CONSTRUCTION'));

    addTestResult('Dispatcher - No My Lead Option', !hasMyLead, hasMyLead ? 'ERROR: My Lead is visible!' : 'Correct: No My Lead shown');
    addTestResult('Dispatcher - SONART CONSTRUCTION Visible', hasSonart, hasSonart ? 'Correct: SONART shown' : 'ERROR: SONART not shown!');
    addTestResult('Dispatcher - Only One Option', options.length === 1, `Found ${options.length} options (should be 1)`);

    // Try to create a job
    log('Attempting to create test job...');
    await page.locator('#f-customer-name, input[name="customerName"]').fill(`Test Dispatcher ${Date.now()}`);
    await page.locator('#f-phone, input[name="phone"]').fill('555-TEST');
    await page.locator('#f-address, input[name="address"]').fill('123 Test St');

    // Take screenshot before save
    await page.screenshot({ path: 'test-results/03-dispatcher-filled-form.png' });

    // Check for console errors before saving
    await page.waitForTimeout(500);

  } catch (error) {
    log(`Dispatcher test error: ${error.message}`, 'ERROR');
    addTestResult('Dispatcher - Overall Test', false, error.message);
  }
}

async function testAdminView(page) {
  log('=== TESTING ADMIN VIEW ===', 'TEST');

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'test-results/04-admin-login.png' });

    const loginInput = await page.locator('#login-email').isVisible({ timeout: 5000 });

    if (loginInput) {
      log('On login screen - waiting for manual login...', 'WARN');
      await page.waitForTimeout(30000);
    }

    const dashboard = await page.locator('.nav-item[data-view="dashboard"]').isVisible({ timeout: 5000 });

    if (!dashboard) {
      addTestResult('Admin - Login Status', false, 'User not logged in');
      return;
    }

    log('Admin logged in!');
    addTestResult('Admin - Login Status', true, 'Successfully logged in');

    // Click New Job
    const newJobBtn = page.locator('.nav-item[data-view="new-job"]');
    await newJobBtn.click();
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'test-results/05-admin-new-job.png' });

    // Check dropdown
    const sourceDropdown = page.locator('#f-source');
    const isDisabled = await sourceDropdown.isDisabled();

    log(`Admin dropdown disabled: ${isDisabled}`);
    addTestResult('Admin - Dropdown Enabled', !isDisabled, isDisabled ? 'ERROR: Should be enabled!' : 'Correct: Dropdown enabled');

    const options = await sourceDropdown.locator('option').allTextContents();
    log(`Admin dropdown options: ${JSON.stringify(options)}`);

    const hasMyLead = options.some(opt => opt.includes('My Lead'));
    const hasSonart = options.some(opt => opt.includes('SONART CONSTRUCTION'));

    addTestResult('Admin - Has My Lead', hasMyLead, hasMyLead ? 'Correct: My Lead shown' : 'ERROR: My Lead missing!');
    addTestResult('Admin - Has SONART CONSTRUCTION', hasSonart, hasSonart ? 'Correct: SONART shown' : 'ERROR: SONART missing!');
    addTestResult('Admin - Multiple Options', options.length >= 2, `Found ${options.length} options (should be >= 2)`);

  } catch (error) {
    log(`Admin test error: ${error.message}`, 'ERROR');
    addTestResult('Admin - Overall Test', false, error.message);
  }
}

async function analyzeLogs() {
  log('=== ANALYZING CONSOLE LOGS ===', 'TEST');

  const newJobLogs = ALL_LOGS.filter(l => l.includes('[NEW JOB]'));
  const sourceDropdownLogs = ALL_LOGS.filter(l => l.includes('[SOURCE DROPDOWN]'));
  const dbLogs = ALL_LOGS.filter(l => l.includes('[DB]'));
  const errorLogs = ALL_LOGS.filter(l => l.includes('ERROR') || l.includes('error'));

  log(`Found ${newJobLogs.length} [NEW JOB] logs`);
  log(`Found ${sourceDropdownLogs.length} [SOURCE DROPDOWN] logs`);
  log(`Found ${dbLogs.length} [DB] logs`);
  log(`Found ${errorLogs.length} error logs`);

  // Check for critical logs
  const hasSettingsSync = newJobLogs.some(l => l.includes('Force syncing settings'));
  const hasSyncComplete = newJobLogs.some(l => l.includes('Settings sync complete'));
  const hasSourcesLoaded = sourceDropdownLogs.some(l => l.includes('All sources from settings'));

  addTestResult('Debug - Settings Sync Started', hasSettingsSync, hasSettingsSync ? 'Settings sync was triggered' : 'NO settings sync found!');
  addTestResult('Debug - Settings Sync Complete', hasSyncComplete, hasSyncComplete ? 'Settings sync completed' : 'Settings sync did NOT complete!');
  addTestResult('Debug - Sources Loaded', hasSourcesLoaded, hasSourcesLoaded ? 'Sources were logged' : 'NO sources in logs!');

  // Look for specific issues
  const noSourcesWarning = ALL_LOGS.some(l => l.includes('NO LEAD SOURCES IN SETTINGS'));
  if (noSourcesWarning) {
    log('⚠️ CRITICAL: NO LEAD SOURCES IN SETTINGS warning found!', 'ERROR');
    addTestResult('Debug - Settings Not Loaded', false, 'Settings sync may have failed - no sources loaded');
  }

  return { newJobLogs, sourceDropdownLogs, dbLogs, errorLogs };
}

async function generateReport() {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: TEST_RESULTS.length,
      passed: TEST_RESULTS.filter(t => t.passed).length,
      failed: TEST_RESULTS.filter(t => !t.passed).length
    },
    tests: TEST_RESULTS,
    logs: ALL_LOGS,
    recommendations: []
  };

  // Generate recommendations based on failures
  const failures = TEST_RESULTS.filter(t => !t.passed);

  if (failures.some(f => f.test.includes('My Lead'))) {
    report.recommendations.push('FIX NEEDED: Dispatcher can see "My Lead" - check allowed_lead_sources in profile');
  }

  if (failures.some(f => f.test.includes('SONART'))) {
    report.recommendations.push('FIX NEEDED: Lead source not showing correctly - check settings sync');
  }

  if (failures.some(f => f.test.includes('Dropdown Disabled'))) {
    report.recommendations.push('FIX NEEDED: Dropdown not disabled for dispatcher - check auto-disable logic');
  }

  if (failures.some(f => f.test.includes('Settings Sync'))) {
    report.recommendations.push('CRITICAL FIX: Settings not syncing - check _syncSettingsDown() function');
  }

  // Save report
  fs.writeFileSync('test-results/auto-test-report.json', JSON.stringify(report, null, 2));
  fs.writeFileSync('test-results/all-logs.txt', ALL_LOGS.join('\n'));

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Tests: ${report.summary.total}`);
  console.log(`✅ Passed: ${report.summary.passed}`);
  console.log(`❌ Failed: ${report.summary.failed}`);
  console.log('='.repeat(80));

  if (report.recommendations.length > 0) {
    console.log('\n🔧 RECOMMENDED FIXES:');
    report.recommendations.forEach((rec, i) => console.log(`${i + 1}. ${rec}`));
  } else {
    console.log('\n✅ ALL TESTS PASSED - NO FIXES NEEDED!');
  }

  console.log('\nDetailed report saved to: test-results/auto-test-report.json');
  console.log('Full logs saved to: test-results/all-logs.txt\n');

  return report;
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  try {
    // Create test results directory
    if (!fs.existsSync('test-results')) {
      fs.mkdirSync('test-results');
    }

    log('Starting automated testing...', 'TEST');

    // Test 1: Dispatcher View
    const dispatcherContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const dispatcherPage = await dispatcherContext.newPage();
    await captureConsoleLogs(dispatcherPage, 'DISPATCHER');
    await testDispatcherView(dispatcherPage);

    log('\n' + '='.repeat(80) + '\n');

    // Test 2: Admin View
    const adminContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const adminPage = await adminContext.newPage();
    await captureConsoleLogs(adminPage, 'ADMIN');
    await testAdminView(adminPage);

    // Analyze all logs
    await analyzeLogs();

    // Generate report
    const report = await generateReport();

    // Keep browser open for manual inspection
    log('\n⏸️ Browser staying open for manual inspection...', 'INFO');
    log('Press Ctrl+C when done\n', 'INFO');

    await new Promise(() => {}); // Wait indefinitely

  } catch (error) {
    log(`Fatal error: ${error.message}`, 'ERROR');
    console.error(error);
  } finally {
    // Don't close browser automatically - let user inspect
  }
}

main();
