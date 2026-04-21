/* Diagnose specific failures */

const { chromium } = require('playwright');
const BASE_URL = 'https://crm.onpointprodoors.com';

async function loginAndDiagnose(email, password, label, diagFn) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(BASE_URL);
  await page.waitForSelector('#login-email', { timeout: 15000 });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#login-btn');

  await page.waitForFunction(() => {
    return typeof Auth !== 'undefined' && Auth.getUser() !== null;
  }, { timeout: 20000 });
  await page.waitForTimeout(3000);

  console.log(`\n=== ${label} DIAGNOSIS ===`);
  await diagFn(page);

  await browser.close();
}

async function main() {
  // 1. Diagnose dispatcher delete job
  await loginAndDiagnose('dispatcher@onpointprodoors.com', 'TestDisp123!', 'DISPATCHER DELETE', async (page) => {
    await page.evaluate(() => App.showView('dashboard'));
    await page.waitForTimeout(500);

    // Call confirmDeleteJob
    const result = await page.evaluate(() => {
      const toast = document.getElementById('toast');
      App.confirmDeleteJob('TEST-DISP-001');
      return {
        toastText: toast ? toast.textContent : 'no toast',
        confirmModalVisible: (() => {
          const modals = document.querySelectorAll('[id*="modal"], [id*="confirm"], .modal, .bottom-sheet');
          return Array.from(modals)
            .filter(m => !m.classList.contains('hidden') && !m.classList.contains('sheet-hidden'))
            .map(m => ({ id: m.id, class: m.className.substring(0, 50) }));
        })(),
        isAdmin: Auth.isAdmin(),
        role: Auth.getRole(),
      };
    });
    await page.waitForTimeout(500);
    console.log('Dispatcher delete result:', JSON.stringify(result, null, 2));

    // Check the actual confirmDeleteJob source
    const funcSource = await page.evaluate(() => {
      return App.confirmDeleteJob.toString().substring(0, 300);
    });
    console.log('confirmDeleteJob source:', funcSource);
  });

  // 2. Diagnose tech status buttons and payout
  await loginAndDiagnose('tech@onpointprodoors.com', 'TestTech123!', 'TECH STATUS/PAYOUT', async (page) => {
    // Open job detail
    await page.evaluate(() => App.showJobDetail('TEST-TECH-001'));
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => {
      const detail = document.getElementById('view-job-detail');
      if (!detail) return { error: 'no detail view' };

      const statusBtns = Array.from(detail.querySelectorAll('.status-action-btn, [class*="status-btn"], button[onclick*="changeStatus"]'));
      const allBtns = Array.from(detail.querySelectorAll('button'));
      const finSection = detail.querySelector('#ds-financials');

      return {
        detailVisible: !detail.classList.contains('hidden'),
        detailHTML: detail.innerHTML.substring(0, 2000),
        statusButtonsFound: statusBtns.map(b => ({ text: b.textContent.trim(), class: b.className })),
        allButtons: allBtns.map(b => ({ text: b.textContent.trim().substring(0, 30), class: b.className.substring(0, 40) })),
        finSectionExists: !!finSection,
        finSectionHTML: finSection ? finSection.innerHTML.substring(0, 500) : 'not found',
        user: Auth.getUser(),
      };
    });

    console.log('Detail visible:', result.detailVisible);
    console.log('Status buttons:', JSON.stringify(result.statusButtonsFound));
    console.log('All buttons:', JSON.stringify(result.allButtons));
    console.log('Financials section:', result.finSectionHTML);
    console.log('\nFirst 2000 chars of detail HTML:');
    console.log(result.detailHTML);
  });

  // 3. Diagnose tech new-job form access
  await loginAndDiagnose('tech@onpointprodoors.com', 'TestTech123!', 'TECH NEW JOB ACCESS', async (page) => {
    // Try showView directly
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.showView) App.showView('new-job');
    });
    await page.waitForTimeout(1000);

    const result = await page.evaluate(() => {
      const newJobView = document.getElementById('view-new-job');
      const navAdd = document.querySelector('.nav-add');
      return {
        newJobVisible: newJobView ? !newJobView.classList.contains('hidden') : false,
        navAddHidden: navAdd ? navAdd.classList.contains('hidden') : 'not found',
        // Check if showView checks role
        showViewSource: typeof App.showView === 'function' ? App.showView.toString().substring(0, 500) : 'n/a',
      };
    });
    console.log('New job form visible after showView("new-job"):', result.newJobVisible);
    console.log('Nav add hidden:', result.navAddHidden);
    console.log('showView source (first 500):', result.showViewSource);
  });
}

main().catch(console.error);
