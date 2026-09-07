const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];

  // Capture ALL console messages
  page.on('console', msg => {
    const text = `[${new Date().toISOString()}] [${msg.type().toUpperCase()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });

  // Capture page errors
  page.on('pageerror', error => {
    const text = `[${new Date().toISOString()}] [PAGE ERROR] ${error.message}`;
    logs.push(text);
    console.log(text);
  });

  // Capture network failures
  page.on('requestfailed', request => {
    const text = `[${new Date().toISOString()}] [NETWORK FAILED] ${request.url()} - ${request.failure().errorText}`;
    logs.push(text);
    console.log(text);
  });

  try {
    console.log('Opening app...');
    await page.goto('https://crm.onpointprodoors.com', { waitUntil: 'networkidle' });

    console.log('\nWaiting 5 seconds for app to load...');
    await page.waitForTimeout(5000);

    // Take screenshot
    await page.screenshot({ path: 'debug-screenshots/01-initial-load.png', fullPage: true });

    console.log('\nSaving all logs to debug-logs.txt...');
    fs.writeFileSync('debug-logs.txt', logs.join('\n'));

    console.log('\n✅ Logs captured! Check debug-logs.txt');
    console.log(`Total log entries: ${logs.length}`);

    // Keep browser open for manual inspection
    console.log('\n⏸️ Browser staying open for manual inspection...');
    console.log('Press Ctrl+C when done\n');

    // Wait indefinitely
    await new Promise(() => {});

  } catch (error) {
    console.error('Error:', error);
    fs.writeFileSync('debug-logs.txt', logs.join('\n'));
  }
})();
