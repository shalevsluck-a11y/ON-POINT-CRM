// Probe: who rewrites a job's status after Save Estimate, and why Create Dispatcher fails.
const { chromium } = require('playwright');
const URL = 'https://crm.onpointprodoors.com/';
const OWNER_CODE = process.env.OWNER_CODE;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  await page.goto(URL, { waitUntil: 'networkidle' });
  const box = page.getByRole('textbox').first(); await box.fill(OWNER_CODE); await box.press('Enter');
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 25000 }); await sleep(1500);
  console.log('LS KEYS after login:', await page.evaluate(() => Object.keys(localStorage).join(',')));

  await page.getByRole('button', { name: 'Add job' }).click();
  await page.locator('#f-name').waitFor();
  await page.locator('#f-name').fill('QA PROBE DELETE ME'); await page.locator('#f-phone').fill('2125550198');
  await page.locator('#f-address').fill('2 Test St'); await page.locator('#f-city').fill('Brooklyn'); await page.locator('#f-zip').fill('11201');
  await page.locator('#btn-save-job').click(); await sleep(3000);
  const id = await page.evaluate(() => (DB.getJobs().find(j => j.customerName === 'QA PROBE DELETE ME') || {}).jobId);
  console.log('job', id);
  await page.evaluate(i => App.openJobDetail(i), id); await sleep(1000);
  logs.length = 0;
  await page.getByRole('button', { name: 'Estimate' }).click();
  await page.locator('#est-amount').waitFor(); await page.locator('#est-amount').fill('450');
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Save Estimate' }).click();
  let last = null;
  for (let i = 0; i < 24; i++) {
    const st = await page.evaluate(i2 => { const j = DB.getJobById(i2); return j ? j.status + '@' + j.updatedAt : 'none'; }, id);
    if (st !== last) { console.log('T+' + (Date.now() - t0) + 'ms status', st); last = st; }
    await sleep(300);
  }
  const rel = logs.filter(l => l.includes(id) || /Realtime|stale|rollback|optimistic|offline|queue|_syncJobsDown\] (Using|KEEP)|saveJob START/i.test(l)).map(l => l.slice(0, 160));
  console.log('--- relevant console lines (' + rel.length + ')'); rel.slice(0, 40).forEach(l => console.log('  ' + l));

  // Invite flow
  await page.evaluate(() => App.navigate('settings')); await sleep(1200);
  await page.getByRole('button', { name: /Create Dispatcher/ }).click();
  await page.locator('#invite-name').waitFor(); await page.locator('#invite-name').fill('QA Dispatcher');
  logs.length = 0;
  await page.locator('#invite-submit-btn').click(); await sleep(6000);
  console.log('invite-error:', await page.locator('#invite-error').innerText().catch(() => '(none)'));
  console.log('success visible:', await page.locator('#invite-success-body').isVisible());
  console.log('invite console:', logs.filter(l => /invite|create|user|error/i.test(l)).slice(0, 8).map(l => l.slice(0, 160)).join('\n  '));

  // cleanup probe job
  await page.evaluate(async i => { await DB.deleteJob(i); }, id); await sleep(1500);
  await browser.close();
})().catch(e => { console.error('PROBE ERROR', e.message); process.exit(1); });
