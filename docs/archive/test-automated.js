const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Starting automated test...');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture all console messages
  const consoleLogs = [];
  page.on('console', msg => {
    const text = `[${msg.type().toUpperCase()}] ${msg.text()}`;
    consoleLogs.push(text);
    console.log(text);
  });

  // Navigate to site
  console.log('\n📱 Navigating to CRM...');
  await page.goto('https://crm.onpointprodoors.com', { waitUntil: 'networkidle' });

  // Wait a bit for service worker to install
  await page.waitForTimeout(3000);

  console.log('\n📊 Console logs so far:');
  console.log('Total messages:', consoleLogs.length);

  // Check if on login page
  const loginVisible = await page.locator('#login-email').isVisible({ timeout: 5000 }).catch(() => false);

  if (loginVisible) {
    console.log('\n⚠️  On login page - need to login manually');
    console.log('Please login and press Enter...');
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }

  // Wait for dashboard
  await page.waitForSelector('.nav-item[data-view="dashboard"]', { timeout: 30000 });
  console.log('\n✅ Logged in!');

  // Click New Job
  console.log('\n📝 Clicking New Job...');
  await page.click('.nav-item[data-view="new-job"]');

  // Wait for form to load and settings to sync
  await page.waitForTimeout(5000);

  // Get dropdown state
  const dropdownInfo = await page.evaluate(() => {
    const dropdown = document.getElementById('f-source');
    if (!dropdown) return { error: 'Dropdown not found' };

    return {
      disabled: dropdown.disabled,
      options: Array.from(dropdown.options).map(o => ({
        value: o.value,
        text: o.textContent
      })),
      selectedValue: dropdown.value,
      user: window.Auth?.getUser(),
      settings: {
        leadSourcesCount: window.DB?.getSettings()?.leadSources?.length || 0,
        leadSources: window.DB?.getSettings()?.leadSources || []
      }
    };
  });

  console.log('\n📋 DROPDOWN STATE:');
  console.log(JSON.stringify(dropdownInfo, null, 2));

  // Try to add a test job
  console.log('\n💾 Testing job creation...');

  await page.fill('#f-customer-name, input[name="customerName"]', 'AUTOMATED TEST ' + Date.now());
  await page.fill('#f-phone, input[name="phone"]', '555-TEST');
  await page.fill('#f-address, input[name="address"]', '123 Test St');

  // Wait a bit
  await page.waitForTimeout(1000);

  // Get final console logs
  console.log('\n📊 FINAL CONSOLE LOGS:');
  const settingsSyncLogs = consoleLogs.filter(l => l.includes('[DB._syncSettingsDown]'));
  const dropdownLogs = consoleLogs.filter(l => l.includes('[SOURCE DROPDOWN]'));
  const newJobLogs = consoleLogs.filter(l => l.includes('[NEW JOB]'));

  console.log('\n[NEW JOB] logs:', newJobLogs.length);
  newJobLogs.forEach(log => console.log(log));

  console.log('\n[DB._syncSettingsDown] logs:', settingsSyncLogs.length);
  settingsSyncLogs.forEach(log => console.log(log));

  console.log('\n[SOURCE DROPDOWN] logs:', dropdownLogs.length);
  dropdownLogs.forEach(log => console.log(log));

  // Check for errors
  const errorLogs = consoleLogs.filter(l => l.includes('[ERROR]'));
  console.log('\n❌ ERROR logs:', errorLogs.length);
  errorLogs.forEach(log => console.log(log));

  console.log('\n✅ TEST COMPLETE - Browser will stay open for inspection');
  console.log('Press Ctrl+C to close\n');

  // Keep browser open
  await new Promise(() => {});
})();
