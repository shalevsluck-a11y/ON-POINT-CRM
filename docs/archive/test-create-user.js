const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Enable network monitoring
  page.on('response', async response => {
    if (response.url().includes('admin') || response.url().includes('create') || response.url().includes('delete')) {
      const body = await response.text().catch(() => 'Unable to read body');
      console.log('\n=== RESPONSE ===');
      console.log('URL:', response.url());
      console.log('Status:', response.status());
      console.log('Body:', body.substring(0, 500));
    }
  });

  console.log('Navigating to app...');
  await page.goto('https://crm.onpointprodoors.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  console.log('Waiting 3 seconds for page to load...');
  await page.waitForTimeout(3000);

  console.log('Taking screenshot...');
  await page.screenshot({ path: 'test-login-screen.png', fullPage: true });
  console.log('Screenshot saved to test-login-screen.png');

  await browser.close();
})();
