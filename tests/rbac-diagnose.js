/* Diagnostic script to understand what role the dispatcher user actually sees */

const { chromium } = require('playwright');
const BASE_URL = 'https://crm.onpointprodoors.com';

async function diagnose() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console messages
  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto(BASE_URL);
  // Wait for login screen
  await page.waitForSelector('#login-email', { timeout: 15000 });

  // Login as dispatcher
  await page.fill('#login-email', 'dispatcher@onpointprodoors.com');
  await page.fill('#login-password', 'TestDisp123!');
  await page.click('#login-btn');

  // Wait for app to load
  await page.waitForTimeout(5000);

  const state = await page.evaluate(() => {
    const user = typeof Auth !== 'undefined' ? Auth.getUser() : null;
    const role = typeof Auth !== 'undefined' ? Auth.getRole() : null;
    const isAdmin = typeof Auth !== 'undefined' ? Auth.isAdmin() : null;
    const isDispatcher = typeof Auth !== 'undefined' ? Auth.isDispatcher() : null;
    const isTech = typeof Auth !== 'undefined' ? Auth.isTech() : null;
    const canSeeFinancials = typeof Auth !== 'undefined' ? Auth.canSeeFinancials() : null;
    const canCreateJobs = typeof Auth !== 'undefined' ? Auth.canCreateJobs() : null;

    // Check what's visible
    const revSection = document.getElementById('revenue-section');
    const techPerfSection = document.getElementById('tech-perf-section');
    const navAdd = document.querySelector('.nav-add');
    const settingsTaxCard = document.getElementById('settings-tax-card');
    const settingsTechCard = document.getElementById('settings-tech-card');

    // Check current view
    const views = ['dashboard', 'jobs', 'new-job', 'settings'];
    const activeView = views.find(v => {
      const el = document.getElementById('view-' + v);
      return el && !el.classList.contains('hidden');
    });

    return {
      user,
      role,
      isAdmin,
      isDispatcher,
      isTech,
      canSeeFinancials,
      canCreateJobs,
      revSectionHidden: revSection ? revSection.classList.contains('hidden') : 'not found',
      techPerfHidden: techPerfSection ? techPerfSection.classList.contains('hidden') : 'not found',
      navAddHidden: navAdd ? navAdd.classList.contains('hidden') : 'not found',
      settingsTaxHidden: settingsTaxCard ? settingsTaxCard.classList.contains('hidden') : 'not found',
      settingsTechHidden: settingsTechCard ? settingsTechCard.classList.contains('hidden') : 'not found',
      activeView,
    };
  });

  console.log('\n=== DISPATCHER ROLE DIAGNOSIS ===');
  console.log(JSON.stringify(state, null, 2));

  // Check DB jobs
  const dbJobs = await page.evaluate(() => {
    if (typeof DB !== 'undefined') {
      const jobs = DB.getJobs();
      return { count: jobs.length, firstJob: jobs[0] };
    }
    return { error: 'DB not defined' };
  });
  console.log('\n=== DB JOBS ===');
  console.log(JSON.stringify(dbJobs, null, 2));

  // Now navigate to settings and check
  await page.evaluate(() => {
    if (typeof App !== 'undefined' && App.showView) App.showView('settings');
  });
  await page.waitForTimeout(1000);

  const settingsState = await page.evaluate(() => {
    const adminSections = [
      'settings-tax-card', 'settings-tech-card',
      'settings-sources-card', 'settings-sync-card', 'settings-data-card',
      'settings-defaultstate-group'
    ];
    return adminSections.reduce((acc, id) => {
      const el = document.getElementById(id);
      if (el) acc[id] = el.classList.contains('hidden') ? 'HIDDEN' : 'VISIBLE';
      else acc[id] = 'NOT FOUND';
      return acc;
    }, {});
  });
  console.log('\n=== SETTINGS SECTIONS (dispatcher) ===');
  console.log(JSON.stringify(settingsState, null, 2));

  // Console logs
  console.log('\n=== CONSOLE LOGS ===');
  consoleLogs.slice(0, 30).forEach(l => console.log(l));

  await browser.close();
}

diagnose().catch(console.error);
