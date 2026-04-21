/* Debug script to test Create User flow and capture errors */
const { chromium } = require('playwright');

const BASE_URL = 'https://crm.onpointprodoors.com';
const ADMIN_USER = { email: 'shalevsluck@gmail.com', password: 'admin_password_here' };

async function debugCreateUser() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const networkResponses = [];
  const consoleMessages = [];
  const errors = [];

  // Capture network responses
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('create-user') || url.includes('invite-user')) {
      try {
        const body = await response.text();
        networkResponses.push({
          url,
          status: response.status(),
          statusText: response.statusText(),
          headers: Object.fromEntries(response.headers()),
          body,
        });
        console.log(`[NETWORK] ${response.status()} ${url}`);
        console.log(`[RESPONSE BODY] ${body}`);
      } catch (e) {
        console.log(`[NETWORK ERROR] Could not read response: ${e.message}`);
      }
    }
  });

  // Capture console messages
  page.on('console', (msg) => {
    const text = msg.text();
    consoleMessages.push({ type: msg.type(), text });
    if (msg.type() === 'error') {
      console.log(`[CONSOLE ERROR] ${text}`);
    }
  });

  // Capture page errors
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.log(`[PAGE ERROR] ${error.message}`);
  });

  try {
    console.log('Logging in as admin...');
    await page.goto(BASE_URL);
    await page.waitForSelector('#login-email', { timeout: 10000 });
    await page.fill('#login-email', ADMIN_USER.email);
    await page.fill('#login-password', ADMIN_USER.password);
    await page.click('#login-btn');
    await page.waitForTimeout(3000);

    console.log('Navigating to Settings...');
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('settings');
    });
    await page.waitForTimeout(2000);

    console.log('Opening Create User modal...');
    const createUserBtn = await page.$('button:has-text("Create User"), button:has-text("Add User"), #btn-add-user, [onclick*="showInviteModal"]');
    if (createUserBtn) {
      await createUserBtn.click();
    } else {
      // Try via JS
      await page.evaluate(() => {
        if (typeof App !== 'undefined' && App.showInviteModal) App.showInviteModal();
      });
    }
    await page.waitForTimeout(1000);

    console.log('Filling in user details...');
    await page.fill('#invite-name', 'Test User Debug');
    await page.fill('#invite-email', `testdebug${Date.now()}@test.com`);
    await page.fill('#invite-password', 'TestPass123!');

    // Select role
    await page.selectOption('#invite-role', 'tech');
    await page.waitForTimeout(500);

    console.log('Clicking Create Account button...');
    const submitBtn = await page.$('#invite-submit-btn');
    if (submitBtn) {
      await submitBtn.click();
      console.log('Waiting 20 seconds for response...');

      // Wait and watch for button state changes
      for (let i = 0; i < 20; i++) {
        const btnText = await page.evaluate(() => {
          const btn = document.getElementById('invite-submit-btn');
          return btn ? btn.textContent : 'not found';
        });
        const btnDisabled = await page.evaluate(() => {
          const btn = document.getElementById('invite-submit-btn');
          return btn ? btn.disabled : null;
        });
        console.log(`[${i}s] Button: "${btnText}" (disabled: ${btnDisabled})`);
        await page.waitForTimeout(1000);

        // Check if success screen appeared
        const successVisible = await page.evaluate(() => {
          const el = document.getElementById('invite-success-body');
          return el && !el.classList.contains('hidden');
        });
        if (successVisible) {
          console.log('SUCCESS! User created successfully.');
          break;
        }

        // Check if error appeared
        const errorVisible = await page.evaluate(() => {
          const el = document.getElementById('invite-error');
          return el && !el.classList.contains('hidden') ? el.textContent : null;
        });
        if (errorVisible) {
          console.log(`ERROR MESSAGE: ${errorVisible}`);
          break;
        }
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Network responses: ${networkResponses.length}`);
    console.log(`Console messages: ${consoleMessages.length}`);
    console.log(`Page errors: ${errors.length}`);

    if (networkResponses.length > 0) {
      console.log('\n=== NETWORK RESPONSES ===');
      networkResponses.forEach(r => console.log(JSON.stringify(r, null, 2)));
    }

    if (errors.length > 0) {
      console.log('\n=== ERRORS ===');
      errors.forEach(e => console.log(e));
    }

  } catch (e) {
    console.error('Test failed:', e.message);
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

debugCreateUser();
