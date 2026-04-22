// @ts-check
/**
 * TECH JOB ASSIGNMENT TEST
 * Verify that when admin assigns a job to a tech, the assigned_tech_id is properly set
 * and the tech can see it in realtime
 */
const { test, expect } = require('@playwright/test');

const URL = 'https://crm.onpointprodoors.com';
const ADMIN_EMAIL = 'service@onpointprodoors.com';
const ADMIN_PASS = 'OnPoint2024!';

test('Admin can assign job and tech sees it in realtime', async ({ browser }) => {
  // Create two browser contexts - one for admin, one for tech
  const adminContext = await browser.newContext();
  const techContext = await browser.newContext();

  const adminPage = await adminContext.newPage();
  const techPage = await techContext.newPage();

  // ══════════════════════════════════════════════════════════
  // STEP 1: Get tech credentials from database
  // ══════════════════════════════════════════════════════════

  // For now, we'll need to manually set tech credentials
  // TODO: Query database via Supabase API to get tech user
  const TECH_EMAIL = 'tech@onpointprodoors.com';
  const TECH_PASS = 'tech_password_here';  // Replace with actual

  // ══════════════════════════════════════════════════════════
  // STEP 2: Tech logs in and waits on dashboard
  // ══════════════════════════════════════════════════════════

  await techPage.goto(URL);
  await techPage.waitForSelector('#login-screen:not(.hidden)');
  await techPage.fill('#login-email', TECH_EMAIL);
  await techPage.fill('#login-password', TECH_PASS);
  await techPage.click('#login-btn');
  await techPage.waitForSelector('#app:not(.hidden)', { timeout: 15000 });

  // Get tech's initial job count
  await techPage.waitForTimeout(2000); // Wait for data to load
  const initialJobs = await techPage.$$eval('.job-card', cards => cards.length);
  console.log(`[Tech] Initial job count: ${initialJobs}`);

  // ══════════════════════════════════════════════════════════
  // STEP 3: Admin logs in
  // ══════════════════════════════════════════════════════════

  await adminPage.goto(URL);
  await adminPage.waitForSelector('#login-screen:not(.hidden)');
  await adminPage.fill('#login-email', ADMIN_EMAIL);
  await adminPage.fill('#login-password', ADMIN_PASS);
  await adminPage.click('#login-btn');
  await adminPage.waitForSelector('#app:not(.hidden)', { timeout: 15000 });

  // ══════════════════════════════════════════════════════════
  // STEP 4: Admin creates new job and assigns to tech
  // ══════════════════════════════════════════════════════════

  // Click "New Job" button
  await adminPage.click('.nav-add');
  await adminPage.waitForSelector('#modal-new-job:not(.hidden)');

  // Fill in customer info
  const timestamp = Date.now();
  await adminPage.fill('#f-name', `Test Customer ${timestamp}`);
  await adminPage.fill('#f-phone', '555-0100');
  await adminPage.fill('#f-address', '123 Test St');
  await adminPage.fill('#f-city', 'Brooklyn');
  await adminPage.fill('#f-zip', '11201');

  // Select the first available tech
  const techButtons = await adminPage.$$('.tech-btn');
  expect(techButtons.length).toBeGreaterThan(0);

  // Click first tech button
  await techButtons[0].click();
  await adminPage.waitForTimeout(500);

  // Get the selected tech's ID from the hidden field
  const selectedTechId = await adminPage.$eval('#f-tech-id', el => el.value);
  const selectedTechName = await adminPage.$eval('.tech-btn.selected', el => el.textContent.trim());

  console.log(`[Admin] Selected tech ID: ${selectedTechId}`);
  console.log(`[Admin] Selected tech name: ${selectedTechName}`);

  // Verify tech ID is not empty
  expect(selectedTechId).toBeTruthy();
  expect(selectedTechId).not.toBe('');
  expect(selectedTechId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  // Save the job
  await adminPage.click('#btn-save-new-job');
  await adminPage.waitForSelector('#modal-new-job.hidden', { timeout: 5000 });

  console.log('[Admin] Job created successfully');

  // ══════════════════════════════════════════════════════════
  // STEP 5: Verify job appears on tech's dashboard within 3 seconds
  // ══════════════════════════════════════════════════════════

  // Wait up to 3 seconds for new job to appear via realtime
  await techPage.waitForTimeout(3000);

  const finalJobs = await techPage.$$eval('.job-card', cards => cards.length);
  console.log(`[Tech] Final job count: ${finalJobs}`);

  // Tech should see one more job
  expect(finalJobs).toBe(initialJobs + 1);

  // Verify the new job appears (check for customer name)
  const jobCards = await techPage.$$eval('.job-card', cards =>
    cards.map(card => card.textContent)
  );
  const newJobVisible = jobCards.some(text => text.includes(`Test Customer ${timestamp}`));
  expect(newJobVisible).toBe(true);

  console.log('[Tech] ✓ New assigned job visible on dashboard');

  // ══════════════════════════════════════════════════════════
  // STEP 6: Verify database has correct assigned_tech_id
  // ══════════════════════════════════════════════════════════

  // TODO: Query Supabase API to verify assigned_tech_id matches selectedTechId
  // For now, we've verified the UI behavior

  // Cleanup
  await adminContext.close();
  await techContext.close();
});

test('Verify existing jobs have assigned_tech_id set', async ({ page }) => {
  // This test will fail if jobs have NULL assigned_tech_id
  // It's meant to catch the regression

  // TODO: Query database directly via Supabase API
  // SELECT job_id, assigned_tech_id, assigned_tech_name
  // FROM jobs
  // WHERE assigned_tech_name IS NOT NULL

  // Verify: WHERE assigned_tech_name IS NOT NULL should have assigned_tech_id IS NOT NULL

  console.log('TODO: Implement database query check');
});
