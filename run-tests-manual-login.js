const { chromium } = require('playwright');
const fs = require('fs');

console.log(`
╔════════════════════════════════════════════════════════════════╗
║  AUTOMATED TEST WITH MANUAL LOGIN                              ║
║  This script will open TWO browser windows                     ║
║  Please login manually in each window, then tests will run     ║
╚════════════════════════════════════════════════════════════════╝
`);

async function waitForLogin(page, userType) {
  console.log(`\n[${userType}] Waiting for you to login...`);
  console.log(`[${userType}] Please login at: ${page.url()}`);

  // Wait for dashboard to appear (indicates successful login)
  try {
    await page.waitForSelector('.nav-item[data-view="dashboard"]', { timeout: 120000 }); // 2 min timeout
    console.log(`[${userType}] ✅ Login detected!`);
    return true;
  } catch (e) {
    console.log(`[${userType}] ❌ Login timeout - no dashboard found`);
    return false;
  }
}

async function runTest(page, userType) {
  const logs = [];
  const results = [];

  // Capture console
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

  console.log(`\n[${userType}] Running tests...`);

  // Click New Job
  await page.click('.nav-item[data-view="new-job"]');
  console.log(`[${userType}] Clicked New Job`);

  // Wait for settings sync
  await page.waitForTimeout(4000);

  // Take screenshot
  await page.screenshot({ path: `test-results/${userType.toLowerCase()}-new-job.png` });

  // Execute test script in browser
  const result = await page.evaluate(() => {
    const dropdown = document.getElementById('f-source');
    const options = Array.from(dropdown.options).map(o => o.textContent);
    const user = window.Auth?.getUser();
    const settings = window.DB?.getSettings();

    return {
      user: {
        role: user?.role,
        name: user?.name,
        allowedLeadSources: user?.allowedLeadSources
      },
      settings: {
        leadSourcesCount: settings?.leadSources?.length || 0,
        leadSources: settings?.leadSources?.map(s => s.name) || []
      },
      dropdown: {
        disabled: dropdown.disabled,
        options: options,
        optionsCount: options.length
      }
    };
  });

  console.log(`\n[${userType}] TEST RESULTS:`);
  console.log(JSON.stringify(result, null, 2));

  // Validate results
  if (userType === 'DISPATCHER') {
    const pass1 = result.dropdown.disabled;
    const pass2 = result.dropdown.optionsCount === 1;
    const pass3 = !result.dropdown.options.some(o => o.includes('My Lead'));
    const pass4 = result.dropdown.options.some(o => o.includes('SONART'));

    results.push({ test: 'Dropdown Disabled', passed: pass1 });
    results.push({ test: 'Only One Option', passed: pass2 });
    results.push({ test: 'No My Lead', passed: pass3 });
    results.push({ test: 'Has SONART', passed: pass4 });

    console.log(`  ${pass1 ? '✅' : '❌'} Dropdown Disabled: ${result.dropdown.disabled}`);
    console.log(`  ${pass2 ? '✅' : '❌'} Only One Option: ${result.dropdown.optionsCount}`);
    console.log(`  ${pass3 ? '✅' : '❌'} No My Lead: ${!result.dropdown.options.some(o => o.includes('My Lead'))}`);
    console.log(`  ${pass4 ? '✅' : '❌'} Has SONART: ${result.dropdown.options.some(o => o.includes('SONART'))}`);
  } else if (userType === 'ADMIN') {
    const pass1 = !result.dropdown.disabled;
    const pass2 = result.dropdown.optionsCount >= 2;
    const pass3 = result.dropdown.options.some(o => o.includes('My Lead'));
    const pass4 = result.dropdown.options.some(o => o.includes('SONART'));

    results.push({ test: 'Dropdown Enabled', passed: pass1 });
    results.push({ test: 'Multiple Options', passed: pass2 });
    results.push({ test: 'Has My Lead', passed: pass3 });
    results.push({ test: 'Has SONART', passed: pass4 });

    console.log(`  ${pass1 ? '✅' : '❌'} Dropdown Enabled: ${!result.dropdown.disabled}`);
    console.log(`  ${pass2 ? '✅' : '❌'} Multiple Options: ${result.dropdown.optionsCount}`);
    console.log(`  ${pass3 ? '✅' : '❌'} Has My Lead: ${result.dropdown.options.some(o => o.includes('My Lead'))}`);
    console.log(`  ${pass4 ? '✅' : '❌'} Has SONART: ${result.dropdown.options.some(o => o.includes('SONART'))}`);
  }

  // Save logs
  fs.writeFileSync(`test-results/${userType.toLowerCase()}-logs.txt`, logs.join('\n'));

  return { result, results };
}

async function main() {
  const browser = await chromium.launch({ headless: false });

  // Create results directory
  if (!fs.existsSync('test-results')) {
    fs.mkdirSync('test-results');
  }

  try {
    // Test Dispatcher
    console.log('\n' + '='.repeat(80));
    console.log('STEP 1: TESTING AS DISPATCHER');
    console.log('='.repeat(80));

    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await page1.goto('https://crm.onpointprodoors.com');

    const loggedIn1 = await waitForLogin(page1, 'DISPATCHER');
    let dispatcher Result = null;

    if (loggedIn1) {
      dispatcherResult = await runTest(page1, 'DISPATCHER');
    }

    // Test Admin
    console.log('\n' + '='.repeat(80));
    console.log('STEP 2: TESTING AS ADMIN');
    console.log('='.repeat(80));

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto('https://crm.onpointprodoors.com');

    const loggedIn2 = await waitForLogin(page2, 'ADMIN');
    let adminResult = null;

    if (loggedIn2) {
      adminResult = await runTest(page2, 'ADMIN');
    }

    // Final Summary
    console.log('\n' + '='.repeat(80));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(80));

    let totalTests = 0;
    let passedTests = 0;

    if (dispatcherResult) {
      totalTests += dispatcherResult.results.length;
      passedTests += dispatcherResult.results.filter(r => r.passed).length;
    }

    if (adminResult) {
      totalTests += adminResult.results.length;
      passedTests += adminResult.results.filter(r => r.passed).length;
    }

    console.log(`Total Tests: ${totalTests}`);
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`❌ Failed: ${totalTests - passedTests}`);

    if (passedTests === totalTests) {
      console.log('\n🎉 ALL TESTS PASSED! 🎉');
    } else {
      console.log('\n⚠️ SOME TESTS FAILED - Check results above');
    }

    console.log('\nPress Ctrl+C to close browsers...');
    await new Promise(() => {}); // Keep open

  } catch (error) {
    console.error('Error:', error);
  }
}

main();
