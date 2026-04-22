const { chromium } = require('playwright');

async function getAdminToken() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Opening CRM...');
  await page.goto('https://crm.onpointprodoors.com');

  console.log('\n==========================================');
  console.log('PLEASE LOG IN AS ADMIN NOW');
  console.log('==========================================');
  console.log('This script will wait for you to log in...\n');

  // Wait for the user to log in by checking for the navigation bar
  try {
    await page.waitForSelector('nav', { timeout: 300000 }); // 5 minutes
    console.log('✓ Login detected\n');
  } catch (e) {
    console.log('✗ Timeout waiting for login');
    await browser.close();
    process.exit(1);
  }

  // Extract the JWT token
  console.log('Extracting JWT token...');
  const token = await page.evaluate(async () => {
    try {
      const session = await window.supabase.auth.getSession();
      return session.data.session?.access_token || null;
    } catch (e) {
      return null;
    }
  });

  if (!token) {
    console.log('✗ Failed to extract token');
    await browser.close();
    process.exit(1);
  }

  console.log('✓ Token extracted\n');

  await browser.close();
  return token;
}

(async () => {
  try {
    const token = await getAdminToken();
    console.log('==========================================');
    console.log('JWT TOKEN:');
    console.log('==========================================');
    console.log(token);
    console.log('==========================================\n');
    console.log('Now run: tests/test-user-api.sh "' + token + '"');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
