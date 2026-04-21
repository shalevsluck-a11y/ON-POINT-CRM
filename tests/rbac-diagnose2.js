/* More thorough diagnostic — wait for auth to settle */

const { chromium } = require('playwright');
const BASE_URL = 'https://crm.onpointprodoors.com';

async function diagnose() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('response', resp => {
    if (!resp.ok()) console.log(`HTTP ${resp.status()} ${resp.url()}`);
  });

  await page.goto(BASE_URL);
  await page.waitForSelector('#login-email', { timeout: 15000 });

  console.log('Logging in as dispatcher...');
  await page.fill('#login-email', 'dispatcher@onpointprodoors.com');
  await page.fill('#login-password', 'TestDisp123!');
  await page.click('#login-btn');

  // Wait longer for auth to settle
  await page.waitForTimeout(8000);

  // Check for error messages on login screen
  const loginError = await page.evaluate(() => {
    const err = document.getElementById('login-error');
    return err ? err.textContent.trim() : '';
  });
  if (loginError) console.log('LOGIN ERROR:', loginError);

  // Check if still on login screen
  const onLoginScreen = await page.evaluate(() => {
    const loginScreen = document.getElementById('login-screen');
    return loginScreen && !loginScreen.classList.contains('hidden');
  });
  console.log('Still on login screen?', onLoginScreen);

  const state = await page.evaluate(() => {
    const user = typeof Auth !== 'undefined' ? Auth.getUser() : 'Auth undefined';
    return {
      user,
      appShellExists: !!document.getElementById('app-shell'),
      loginScreenHidden: document.getElementById('login-screen')?.classList.contains('hidden'),
      dashboardHidden: document.getElementById('view-dashboard')?.classList.contains('hidden'),
    };
  });
  console.log('\n=== STATE AFTER 8s ===');
  console.log(JSON.stringify(state, null, 2));

  // Try waiting for user to be set
  try {
    await page.waitForFunction(() => {
      return typeof Auth !== 'undefined' && Auth.getUser() !== null;
    }, { timeout: 10000 });
    console.log('Auth user loaded!');
  } catch(e) {
    console.log('Auth user never loaded:', e.message);
  }

  const finalState = await page.evaluate(() => {
    return {
      user: typeof Auth !== 'undefined' ? Auth.getUser() : null,
      role: typeof Auth !== 'undefined' ? Auth.getRole() : null,
    };
  });
  console.log('\n=== FINAL STATE ===');
  console.log(JSON.stringify(finalState, null, 2));

  // Check network errors
  console.log('\n=== ALL CONSOLE LOGS ===');
  consoleLogs.forEach(l => console.log(l));

  await browser.close();
}

diagnose().catch(console.error);
