/* ============================================================
   RBAC TEST — Role-Based Access Control for On Point CRM
   Tests: dispatcher, tech, contractor roles
   ============================================================ */

const { chromium } = require('playwright');

const BASE_URL = 'https://crm.onpointprodoors.com';

const USERS = {
  admin:      { email: 'shalevsluck@gmail.com',          password: 'admin_password_here', role: 'admin' },
  dispatcher: { email: 'dispatcher@onpointprodoors.com', password: 'TestDisp123!', role: 'dispatcher' },
  tech:       { email: 'tech@onpointprodoors.com',       password: 'TestTech123!', role: 'tech' },
  contractor: { email: 'contractor@onpointprodoors.com', password: 'TestContr123!', role: 'contractor' },
};

const results = [];
let currentRole = '';

function pass(test, detail = '') {
  results.push({ status: 'PASS', role: currentRole, test, detail });
  console.log(`  [PASS] ${test}${detail ? ' — ' + detail : ''}`);
}

function fail(test, detail = '') {
  results.push({ status: 'FAIL', role: currentRole, test, detail });
  console.log(`  [FAIL] ${test}${detail ? ' — ' + detail : ''}`);
}

async function login(page, user) {
  await page.goto(BASE_URL);
  await page.waitForSelector('#login-email, #app-shell', { timeout: 15000 });
  // Wait for app shell to disappear or login to appear
  await page.waitForFunction(() => {
    const shell = document.getElementById('app-shell');
    const loginEmail = document.getElementById('login-email');
    return !shell || shell.style.display === 'none' || loginEmail;
  }, { timeout: 15000 });

  await page.waitForSelector('#login-email', { timeout: 10000 });
  await page.fill('#login-email', user.email);
  await page.fill('#login-password', user.password);
  await page.click('#login-btn');

  // Wait for login to complete (app shell gone, or dashboard appears)
  await page.waitForFunction(() => {
    const shell = document.getElementById('app-shell');
    const dashView = document.getElementById('view-dashboard');
    return (!shell || !shell.isConnected) ||
           (dashView && !dashView.classList.contains('hidden'));
  }, { timeout: 15000 });

  // Also wait for any loading to settle
  await page.waitForTimeout(2000);
}

async function logout(page) {
  try {
    // Navigate to settings and find logout
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('settings');
    });
    await page.waitForTimeout(500);
    const logoutBtn = await page.$('#logout-btn, [onclick*="logout"], button:has-text("Log Out"), button:has-text("Logout"), button:has-text("Sign Out")');
    if (logoutBtn) await logoutBtn.click();
    await page.waitForSelector('#login-email', { timeout: 8000 });
  } catch(e) {
    // Force logout via JS
    await page.evaluate(() => {
      if (typeof Auth !== 'undefined') Auth.logout();
    }).catch(() => {});
    await page.waitForTimeout(1000);
  }
}

// ── DISPATCHER TESTS ──────────────────────────────────────

async function testDispatcher(browser) {
  currentRole = 'dispatcher';
  console.log('\n=== DISPATCHER TESTS ===');
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, USERS.dispatcher);

    // 1. Check dashboard loads
    const dashVisible = await page.evaluate(() => {
      const dash = document.getElementById('view-dashboard');
      return dash && (dash.classList.contains('active') || !dash.classList.contains('hidden'));
    });
    if (dashVisible) pass('Dashboard loads');
    else fail('Dashboard loads', 'Dashboard view not visible after login');

    // 2. Revenue section hidden for dispatcher
    const revHidden = await page.evaluate(() => {
      const rev = document.getElementById('revenue-section');
      return !rev || rev.classList.contains('hidden');
    });
    if (revHidden) pass('Revenue section hidden');
    else fail('Revenue section hidden', 'Revenue card with dollar amounts IS visible to dispatcher — should be hidden');

    // 3. Tech performance section hidden for dispatcher
    const techPerfHidden = await page.evaluate(() => {
      const tp = document.getElementById('tech-perf-section');
      return !tp || tp.classList.contains('hidden');
    });
    if (techPerfHidden) pass('Tech Performance section hidden');
    else fail('Tech Performance section hidden', 'Technician Performance section IS visible to dispatcher');

    // 4. Dispatcher CAN create jobs — check + button visible
    const addBtnVisible = await page.evaluate(() => {
      const addBtns = document.querySelectorAll('.nav-add');
      return Array.from(addBtns).some(btn => !btn.classList.contains('hidden'));
    });
    if (addBtnVisible) pass('Create job button visible for dispatcher');
    else fail('Create job button visible for dispatcher', 'Nav add button is hidden for dispatcher — should be visible');

    // 5. Try to create a job
    await page.evaluate(() => {
      const addBtn = document.querySelector('.nav-add:not(.hidden)');
      if (addBtn) addBtn.click();
    });
    await page.waitForTimeout(1000);
    const newJobFormVisible = await page.evaluate(() => {
      const form = document.getElementById('view-new-job');
      return form && form.classList.contains('active');
    });
    if (newJobFormVisible) pass('New job form opens for dispatcher');
    else fail('New job form opens for dispatcher', 'New job form did not open');

    // Close new job modal if open
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('dashboard');
    });
    await page.waitForTimeout(500);

    // 6. Navigate to settings
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('settings');
    });
    await page.waitForTimeout(1000);

    // 7. Settings: only My Info visible (no admin sections)
    const settingsAdminSections = await page.evaluate(() => {
      const adminSections = [
        'settings-tax-card',
        'settings-tech-card',
        'settings-sources-card',
        'settings-sync-card',
        'settings-data-card'
      ];
      return adminSections.filter(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
      });
    });
    if (settingsAdminSections.length === 0) {
      pass('Settings: only My Info visible (no admin sections)');
    } else {
      fail('Settings: only My Info visible', `Admin sections visible: ${settingsAdminSections.join(', ')}`);
    }

    // 8. URL manipulation test — try to trigger admin-only features
    // Navigate back to dashboard and try to directly call admin function
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('dashboard');
    });
    await page.waitForTimeout(500);

    // Try calling confirmDeleteJob (admin only)
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.confirmDeleteJob) {
        App.confirmDeleteJob('TEST-DISP-001');
      }
    });

    // Check if an error toast appeared (not a delete confirmation)
    await page.waitForTimeout(500);
    const deleteToastText = await page.evaluate(() => {
      const toast = document.getElementById('toast');
      return toast ? toast.textContent : '';
    });
    if (deleteToastText.toLowerCase().includes('admin') || deleteToastText.toLowerCase().includes('authorized')) {
      pass('Admin-only feature blocked (delete job)');
    } else {
      // Check if confirm modal appeared (bad) vs nothing happened
      // Look for visible confirm/bottom-sheet modal
      const confirmModalVisible = await page.evaluate(() => {
        // modal-confirm is the confirm dialog; modal-overlay shows when any modal is open
        const overlay = document.getElementById('modal-overlay');
        const confirmModal = document.getElementById('modal-confirm');
        return overlay && !overlay.classList.contains('hidden') &&
               confirmModal && !confirmModal.classList.contains('hidden') &&
               (confirmModal.textContent.includes('Delete') || confirmModal.textContent.includes('delete'));
      });
      if (confirmModalVisible) {
        fail('Admin-only feature blocked (delete job)', 'Delete confirmation modal appeared for dispatcher — should be blocked');
      } else {
        pass('Admin-only feature blocked (delete job)', 'No delete modal shown (function blocked)');
      }
    }

    // 9. Tech selector on job form works
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('new-job');
    });
    await page.waitForTimeout(1000);
    const techSelectorExists = await page.evaluate(() => {
      // Look for tech selector in the new job form
      const selectors = ['#f-tech', 'select[id*="tech"]', '.tech-selector'];
      return selectors.some(sel => document.querySelector(sel));
    });
    if (techSelectorExists) pass('Tech selector exists in new job form');
    else fail('Tech selector exists in new job form', 'No tech selector found in new job form');

  } catch(e) {
    fail('Dispatcher test suite', `Exception: ${e.message}`);
  }

  await context.close();
}

// ── TECH TESTS ────────────────────────────────────────────

async function testTech(browser) {
  currentRole = 'tech';
  console.log('\n=== TECH TESTS ===');
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, USERS.tech);

    // 1. Dashboard: only their jobs visible
    await page.waitForTimeout(2000);
    const jobVisibility = await page.evaluate(() => {
      // Check if the tech section is shown and recent-jobs-wrap is hidden
      const techSection = document.getElementById('tech-today-section');
      const recentWrap = document.getElementById('recent-jobs-wrap');
      return {
        techSectionVisible: techSection && !techSection.classList.contains('hidden'),
        recentWrapHidden: !recentWrap || recentWrap.classList.contains('hidden'),
      };
    });
    if (jobVisibility.recentWrapHidden) {
      pass('Dashboard: recent-jobs (all jobs) hidden for tech');
    } else {
      fail('Dashboard: recent-jobs (all jobs) hidden for tech', 'recent-jobs-wrap is visible — tech can see all jobs');
    }

    // 2. Revenue section hidden
    const revHidden = await page.evaluate(() => {
      const rev = document.getElementById('revenue-section');
      return !rev || rev.classList.contains('hidden');
    });
    if (revHidden) pass('Revenue section hidden for tech');
    else fail('Revenue section hidden for tech', 'Revenue/financial data IS visible to tech');

    // 3. Tech performance section hidden
    const techPerfHidden = await page.evaluate(() => {
      const tp = document.getElementById('tech-perf-section');
      return !tp || tp.classList.contains('hidden');
    });
    if (techPerfHidden) pass('Tech Performance section hidden for tech');
    else fail('Tech Performance section hidden for tech');

    // 4. No create job button
    const addBtnHidden = await page.evaluate(() => {
      const addBtns = document.querySelectorAll('.nav-add');
      return Array.from(addBtns).every(btn => btn.classList.contains('hidden'));
    });
    if (addBtnHidden) pass('Create job button hidden for tech');
    else fail('Create job button hidden for tech', 'Nav add button is visible for tech — should be hidden');

    // 5. Navigate to job list and find assigned job
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('jobs');
    });
    await page.waitForTimeout(1500);

    // Look for the test job assigned to tech
    const techJobVisible = await page.evaluate(() => {
      const jobCards = document.querySelectorAll('.job-card, [data-job-id]');
      const allText = document.getElementById('view-jobs')?.textContent || '';
      return allText.includes('Alice Smith') || allText.includes('TEST-TECH-001');
    });
    if (techJobVisible) pass('Tech can see their assigned job (Alice Smith)');
    else fail('Tech can see their assigned job', 'TEST-TECH-001 / Alice Smith not visible in job list');

    // Check tech does NOT see unassigned dispatcher job
    const dispJobHidden = await page.evaluate(() => {
      const allText = document.getElementById('view-jobs')?.textContent || '';
      return !allText.includes('Bob Jones') && !allText.includes('TEST-DISP-001');
    });
    if (dispJobHidden) pass('Tech cannot see unassigned jobs (Bob Jones hidden)');
    else fail('Tech cannot see unassigned jobs', 'Bob Jones / TEST-DISP-001 IS visible to tech — should be hidden');

    // 6. Open an assigned job detail
    // Click on the tech's job
    const jobOpened = await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.openJobDetail) {
        App.openJobDetail('TEST-TECH-001');
        return true;
      }
      return false;
    });
    await page.waitForTimeout(1500);

    const jobDetailVisible = await page.evaluate(() => {
      const detail = document.getElementById('view-job-detail');
      return detail && detail.classList.contains('active');
    });
    if (jobDetailVisible) pass('Tech can open assigned job detail');
    else fail('Tech can open assigned job detail', 'Job detail view did not open');

    // 7. Status buttons: only In Progress and Closed visible (not Scheduled, Follow Up, Paid)
    const statusButtons = await page.evaluate(() => {
      const buttons = document.querySelectorAll('.status-action-btn');
      return Array.from(buttons).map(b => b.textContent.trim().toLowerCase());
    });
    const allowedStatuses = ['in progress', 'in-progress', 'closed', 'inprogress'];
    const forbiddenStatuses = ['scheduled', 'follow up', 'follow-up', 'paid', 'new'];
    const hasOnlyAllowed = statusButtons.every(s => {
      const normalized = s.replace(/\s+/g, ' ').trim();
      return allowedStatuses.some(a => normalized.includes(a));
    });
    const hasForbidden = statusButtons.some(s => forbiddenStatuses.some(f => s.includes(f)));

    if (hasForbidden) {
      fail('Status buttons restricted for tech', `Forbidden statuses visible: ${statusButtons.filter(s => forbiddenStatuses.some(f => s.includes(f))).join(', ')}`);
    } else if (statusButtons.length > 0) {
      pass('Status buttons restricted for tech', `Only: ${statusButtons.join(', ')}`);
    } else {
      fail('Status buttons restricted for tech', 'No status buttons found');
    }

    // 8. No Close Job button
    const closeJobBtn = await page.evaluate(() => {
      const btn = document.querySelector('.quick-close-btn');
      return btn ? !btn.closest('.hidden') : false;
    });
    if (!closeJobBtn) pass('Close Job button not visible to tech');
    else fail('Close Job button not visible to tech', 'Close Job button IS visible to tech');

    // 9. Tech sees their payout amount
    const payoutVisible = await page.evaluate(() => {
      const detailHTML = document.getElementById('view-job-detail')?.innerHTML || '';
      return detailHTML.includes('Your Payout') || detailHTML.includes('payout') || detailHTML.includes('210');
    });
    if (payoutVisible) pass('Tech sees their payout amount');
    else fail('Tech sees their payout amount', 'Payout section not visible in job detail');

    // 10. Tech does NOT see full financials (company profit, job total)
    const financialsHidden = await page.evaluate(() => {
      const finSection = document.querySelector('#ds-financials .detail-section-title');
      if (!finSection) return true; // no financials section at all - good
      return finSection.textContent.includes('Your Payout'); // only their payout, not full financials
    });
    if (financialsHidden) pass('Tech does not see full financials section');
    else fail('Tech does not see full financials section', 'Full financials section visible to tech');

    // 11. Settings: only My Info
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('settings');
    });
    await page.waitForTimeout(1000);

    const settingsAdminSections = await page.evaluate(() => {
      const adminSections = [
        'settings-tax-card', 'settings-tech-card',
        'settings-sources-card', 'settings-sync-card', 'settings-data-card'
      ];
      return adminSections.filter(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
      });
    });
    if (settingsAdminSections.length === 0) {
      pass('Settings: only My Info visible for tech');
    } else {
      fail('Settings: only My Info visible for tech', `Admin sections visible: ${settingsAdminSections.join(', ')}`);
    }

    // 12. Try to create a job via JS (should be blocked by navigate guard)
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('dashboard');
    });
    await page.waitForTimeout(500);

    // Try calling navigate('new-job') directly — should be blocked by role guard
    const navResult = await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) {
        App.navigate('new-job');
      }
      const form = document.getElementById('view-new-job');
      return form ? form.classList.contains('active') : false;
    });
    await page.waitForTimeout(500);

    const newJobFormForTech = await page.evaluate(() => {
      const form = document.getElementById('view-new-job');
      return form && form.classList.contains('active');
    });
    if (!newJobFormForTech) pass('New job form blocked for tech (navigate guard works)');
    else fail('New job form blocked for tech', 'New job form opened for tech user — navigate guard missing');

  } catch(e) {
    fail('Tech test suite', `Exception: ${e.message}`);
  }

  await context.close();
}

// ── CONTRACTOR TESTS ──────────────────────────────────────

async function testContractor(browser) {
  currentRole = 'contractor';
  console.log('\n=== CONTRACTOR TESTS ===');
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, USERS.contractor);
    await page.waitForTimeout(2000);

    // 1. Open assigned job
    const jobOpened = await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.openJobDetail) {
        App.openJobDetail('TEST-CONT-001');
        return true;
      }
      return false;
    });
    await page.waitForTimeout(1500);

    const jobDetailVisible = await page.evaluate(() => {
      const detail = document.getElementById('view-job-detail');
      return detail && detail.classList.contains('active');
    });
    if (jobDetailVisible) pass('Contractor can open assigned job detail');
    else fail('Contractor can open assigned job detail');

    // 2. Contractor sees their cut (contractorFee)
    const contractorPayoutVisible = await page.evaluate(() => {
      const detailHTML = document.getElementById('view-job-detail')?.innerHTML || '';
      // contractor fee is $320, should appear as payout
      return detailHTML.includes('Your Payout') || detailHTML.includes('320') || detailHTML.includes('Payout');
    });
    if (contractorPayoutVisible) pass('Contractor sees their payout/cut');
    else fail('Contractor sees their payout/cut', 'Contractor payout not visible in job detail');

    // 3. Contractor does NOT see full job total ($800) or company profit
    const fullFinancialsHidden = await page.evaluate(() => {
      const finTitle = document.querySelector('#ds-financials .detail-section-title');
      if (!finTitle) return true;
      return finTitle.textContent.includes('Your Payout');
    });
    if (fullFinancialsHidden) pass('Contractor does not see full job total/margins');
    else fail('Contractor does not see full job total/margins', 'Full Financials section visible to contractor');

    // 4. Revenue section hidden
    const revHidden = await page.evaluate(() => {
      const rev = document.getElementById('revenue-section');
      return !rev || rev.classList.contains('hidden');
    });
    if (revHidden) pass('Revenue section hidden for contractor');
    else fail('Revenue section hidden for contractor');

    // 5. Settings: only My Info
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('settings');
    });
    await page.waitForTimeout(1000);

    const settingsAdminSections = await page.evaluate(() => {
      const adminSections = [
        'settings-tax-card', 'settings-tech-card',
        'settings-sources-card', 'settings-sync-card', 'settings-data-card'
      ];
      return adminSections.filter(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
      });
    });
    if (settingsAdminSections.length === 0) {
      pass('Settings: only My Info visible for contractor');
    } else {
      fail('Settings: only My Info visible for contractor', `Admin sections visible: ${settingsAdminSections.join(', ')}`);
    }

    // 6. No create job button
    const addBtnHidden = await page.evaluate(() => {
      const addBtns = document.querySelectorAll('.nav-add');
      return Array.from(addBtns).every(btn => btn.classList.contains('hidden'));
    });
    if (addBtnHidden) pass('Create job button hidden for contractor');
    else fail('Create job button hidden for contractor');

    // 7. Status buttons restricted
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.openJobDetail) App.openJobDetail('TEST-CONT-001');
    });
    await page.waitForTimeout(1000);
    const statusButtons = await page.evaluate(() => {
      const buttons = document.querySelectorAll('.status-action-btn');
      return Array.from(buttons).map(b => b.textContent.trim().toLowerCase());
    });
    const hasForbiddenStatuses = statusButtons.some(s =>
      ['scheduled', 'follow up', 'paid', 'new'].some(f => s.includes(f))
    );
    if (!hasForbiddenStatuses && statusButtons.length > 0) {
      pass('Status buttons restricted for contractor', `Only: ${statusButtons.join(', ')}`);
    } else if (hasForbiddenStatuses) {
      fail('Status buttons restricted for contractor', `Forbidden statuses visible: ${statusButtons.join(', ')}`);
    } else {
      fail('Status buttons restricted for contractor', 'No status buttons found');
    }

  } catch(e) {
    fail('Contractor test suite', `Exception: ${e.message}`);
  }

  await context.close();
}

// ── ADMIN TESTS ───────────────────────────────────────────

async function testAdmin(browser) {
  currentRole = 'admin';
  console.log('\n=== ADMIN TESTS ===');
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, USERS.admin);
    await page.waitForTimeout(2000);

    // 1. Dashboard: all sections visible
    const dashboardSections = await page.evaluate(() => {
      return {
        revenue: !!document.getElementById('revenue-section') && !document.getElementById('revenue-section').classList.contains('hidden'),
        techPerf: !!document.getElementById('tech-perf-section') && !document.getElementById('tech-perf-section').classList.contains('hidden'),
        recentJobs: !!document.getElementById('recent-jobs-wrap') && !document.getElementById('recent-jobs-wrap').classList.contains('hidden'),
      };
    });
    if (dashboardSections.revenue) pass('Revenue section visible for admin');
    else fail('Revenue section visible for admin', 'Revenue section hidden for admin');

    if (dashboardSections.techPerf) pass('Tech Performance section visible for admin');
    else fail('Tech Performance section visible for admin', 'Tech Performance section hidden for admin');

    // 2. Can create jobs
    const createJobBtn = await page.evaluate(() => {
      const addBtns = document.querySelectorAll('.nav-add');
      return Array.from(addBtns).some(btn => !btn.classList.contains('hidden'));
    });
    if (createJobBtn) pass('Create job button visible for admin');
    else fail('Create job button visible for admin', 'Add button hidden for admin');

    // 3. Try to create a new job
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('new-job');
    });
    await page.waitForTimeout(1500);

    const newJobFormVisible = await page.evaluate(() => {
      const form = document.getElementById('view-new-job');
      return form && form.classList.contains('active');
    });
    if (newJobFormVisible) pass('New job form opens for admin');
    else fail('New job form opens for admin', 'New job form did not open');

    // 4. Check payout preview with owner % field
    const ownerPctField = await page.evaluate(() => {
      const field = document.getElementById('f-owner-pct');
      const display = document.getElementById('owner-pct-display');
      return field && display && display.style.display !== 'none';
    });
    if (ownerPctField) pass('Owner % field visible in job form for admin');
    else fail('Owner % field visible in job form', 'Owner % field not visible or hidden');

    // 5. Navigate back and open an existing paid job
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('jobs');
    });
    await page.waitForTimeout(1000);

    // Find a paid job
    const paidJobId = await page.evaluate(() => {
      // Look for TEST-TECH-001 which should be paid
      if (typeof App !== 'undefined' && App.openJobDetail) {
        App.openJobDetail('TEST-TECH-001');
        return 'TEST-TECH-001';
      }
      return null;
    });
    await page.waitForTimeout(1500);

    // 6. Check financials section shows full breakdown
    const financialsVisible = await page.evaluate(() => {
      const finSection = document.getElementById('ds-financials');
      if (!finSection) return { visible: false, title: '' };
      const title = finSection.querySelector('.detail-section-title')?.textContent || '';
      return {
        visible: !finSection.classList.contains('hidden'),
        title: title,
        hasFinancialsTitle: title.includes('Financials'),
      };
    });
    if (financialsVisible.hasFinancialsTitle) pass('Admin sees "Financials" section (not just "Your Payout")');
    else fail('Admin sees "Financials" section', `Title: ${financialsVisible.title}`);

    // 7. Check payout breakdown shows all three splits
    const payoutBreakdown = await page.evaluate(() => {
      const finBody = document.querySelector('#ds-financials .detail-section-body');
      if (!finBody) return { found: false };
      const html = finBody.innerHTML;
      return {
        found: true,
        hasTechPayout: html.includes('Tech') || html.includes('210'),
        hasContractorFee: html.includes('Contractor') || html.includes('320'),
        hasOwnerPayout: html.includes('Owner') || html.includes('Your Payout') || html.includes('Your Total'),
      };
    });
    if (payoutBreakdown.hasTechPayout && payoutBreakdown.hasOwnerPayout) {
      pass('Admin sees full payout breakdown (tech + owner splits)');
    } else {
      fail('Admin sees full payout breakdown', `Tech: ${payoutBreakdown.hasTechPayout}, Owner: ${payoutBreakdown.hasOwnerPayout}`);
    }

    // 8. Settings: all sections visible
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('settings');
    });
    await page.waitForTimeout(1000);

    const settingsSections = await page.evaluate(() => {
      const sections = [
        'settings-tax-card',
        'settings-tech-card',
        'settings-sources-card',
        'settings-sync-card',
        'settings-data-card'
      ];
      return sections.map(id => {
        const el = document.getElementById(id);
        return { id, visible: el && !el.classList.contains('hidden') };
      });
    });
    const allVisible = settingsSections.every(s => s.visible);
    if (allVisible) pass('Settings: all admin sections visible');
    else {
      const hidden = settingsSections.filter(s => !s.visible).map(s => s.id);
      fail('Settings: all admin sections visible', `Hidden: ${hidden.join(', ')}`);
    }

    // 9. Can delete jobs (admin-only feature)
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.navigate) App.navigate('jobs');
    });
    await page.waitForTimeout(1000);

    // Try to open a job and look for delete option
    await page.evaluate(() => {
      if (typeof App !== 'undefined' && App.openJobDetail) App.openJobDetail('TEST-TECH-001');
    });
    await page.waitForTimeout(1000);

    const deleteOptionExists = await page.evaluate(() => {
      // Look for delete button or option
      const btns = document.querySelectorAll('button, .btn, .detail-action-btn');
      return Array.from(btns).some(b =>
        b.textContent.toLowerCase().includes('delete') ||
        b.getAttribute('onclick')?.includes('deleteJob')
      );
    });
    if (deleteOptionExists) pass('Delete job option available for admin');
    else fail('Delete job option available for admin', 'Delete option not found in job detail');

    // 10. Can close jobs (mark as paid)
    const closeJobBtn = await page.evaluate(() => {
      const btn = document.querySelector('.quick-close-btn');
      return btn && !btn.closest('.hidden');
    });
    if (closeJobBtn) pass('Close Job button visible for admin');
    else fail('Close Job button visible for admin', 'Close Job button not found');

  } catch(e) {
    fail('Admin test suite', `Exception: ${e.message}`);
  }

  await context.close();
}

// ── RUN ALL TESTS ─────────────────────────────────────────

async function runAll() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    await testAdmin(browser);
    await testDispatcher(browser);
    await testTech(browser);
    await testContractor(browser);
  } finally {
    await browser.close();
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('RBAC TEST RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════');

  const byRole = {};
  for (const r of results) {
    if (!byRole[r.role]) byRole[r.role] = { pass: 0, fail: 0, failures: [] };
    if (r.status === 'PASS') byRole[r.role].pass++;
    else { byRole[r.role].fail++; byRole[r.role].failures.push(r); }
  }

  for (const [role, stats] of Object.entries(byRole)) {
    console.log(`\n${role.toUpperCase()}: ${stats.pass} PASS / ${stats.fail} FAIL`);
    if (stats.failures.length > 0) {
      stats.failures.forEach(f => console.log(`  [FAIL] ${f.test}: ${f.detail}`));
    }
  }

  const totalPass = results.filter(r => r.status === 'PASS').length;
  const totalFail = results.filter(r => r.status === 'FAIL').length;
  console.log(`\nTOTAL: ${totalPass} PASS / ${totalFail} FAIL`);

  return results;
}

runAll().catch(console.error);
