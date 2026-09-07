// End-to-end verification against the LIVE app as the owner and as a freshly created dispatcher.
// Creates clearly-named test data and deletes it at the end. Run: node tests/e2e-verify-roles.js
const { chromium } = require('playwright');
const URL = process.env.CRM_URL || 'https://crm.onpointprodoors.com/';
const OWNER_CODE = process.env.OWNER_CODE;
if (!OWNER_CODE) { console.error('OWNER_CODE env var required'); process.exit(2); }
const SHOT = process.env.SHOT_DIR || '.';
const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function login(page, code) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  const box = page.getByRole('textbox').first();
  await box.fill(code); await box.press('Enter');
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 25000 });
  await sleep(1500);
}
async function serverJobs(page) {
  return page.evaluate(async () => {
    const s = await SupabaseClient.auth.getSession();
    const r = await fetch('/api/load-jobs', { headers: { Authorization: 'Bearer ' + s.data.session.access_token } });
    const d = await r.json(); return { status: r.status, n: (d.jobs || []).length, names: (d.jobs || []).map(j => j.customer_name) };
  });
}
async function addJob(page, name) {
  await page.getByRole('button', { name: 'Add job' }).click();
  await page.locator('#f-name').waitFor({ timeout: 10000 });
  await page.locator('#f-name').fill(name);
  await page.locator('#f-phone').fill('2125550199');
  await page.locator('#f-address').fill('1 Test St');
  await page.locator('#f-city').fill('Brooklyn');
  await page.locator('#f-zip').fill('11201');
  await page.locator('#f-description').fill('QA verification job, safe to delete');
  await page.locator('#btn-save-job').click();
  await page.getByText(/Job saved/).first().waitFor({ timeout: 15000 }).catch(() => {});
  await sleep(2500);
  return page.evaluate(n => { const j = (DB.getJobs() || []).find(x => x.customerName === n); return j ? { jobId: j.jobId, status: j.status } : null; }, name);
}
async function pointy(page, text, { confirm = false } = {}) {
  await page.getByRole('button', { name: 'Pointy' }).click();
  const before = await page.evaluate(() => (document.querySelector('main').innerText.match(/✦/g) || []).length);
  const msg = page.getByPlaceholder(/Message Pointy/);
  await msg.fill(text); await msg.press('Enter');
  await page.waitForFunction(b => (document.querySelector('main').innerText.match(/✦/g) || []).length > b, before, { timeout: 45000 });
  await sleep(1200);
  if (confirm) {
    const btn = page.locator('button.pointy-btn-do').last();
    if (await btn.count()) { await btn.click(); await sleep(3000); }
    else return { reply: await lastBubble(page), confirmed: false };
    return { reply: await lastBubble(page), confirmed: true };
  }
  return { reply: await lastBubble(page), confirmed: false };
}
async function lastBubble(page) {
  return page.evaluate(() => { const t = document.querySelector('main').innerText; const parts = t.split('✦').map(s => s.trim()).filter(Boolean); return parts[parts.length - 1].replace(/\s+/g, ' ').slice(0, 400); });
}

(async () => {
  const browser = await chromium.launch();
  const ownerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ownerCtx.newPage();
  const errs = []; page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  // ── OWNER ─────────────────────────────────────────────────────────
  await login(page, OWNER_CODE);
  const me = await page.evaluate(() => Auth.getUser() && (Auth.getUser().name + '/' + Auth.getUser().role));
  ok('owner login', me === 'solomon/admin', me);
  const counts0 = await page.evaluate(() => { const j = DB.getJobs(); const b = s => s === 'lost' ? 'lost' : (s === 'closed' || s === 'paid') ? 'closed' : s === 'follow_up' ? 'estimate' : 'open'; const c = { open: 0, estimate: 0, closed: 0, lost: 0 }; j.forEach(x => c[b(x.status)]++); return { total: j.length, ...c }; });
  const srv0 = await serverJobs(page);
  ok('owner sees every job (cache == server)', counts0.total === srv0.n, JSON.stringify(counts0) + ' server=' + srv0.n);

  const QA1 = 'QA TEST DELETE ME';
  const j1 = await addJob(page, QA1);
  ok('owner: add job via form', !!j1, JSON.stringify(j1));
  const srv1 = await serverJobs(page);
  ok('owner: new job reached the server', srv1.names.includes(QA1), 'server n=' + srv1.n);

  await page.evaluate(id => App.openJobDetail(id), j1.jobId);
  await sleep(1200);
  const detailBtns = await page.evaluate(() => [...document.querySelectorAll('#view-job-detail button')].map(b => b.textContent.trim().replace(/\s+/g, ' ')));
  ok('owner: detail shows Dispatch/Copy/Estimate/Mark Lost/Close/Delete', ['Dispatch', 'Copy Details', 'Estimate', 'Mark Lost', 'Close Job', 'Delete Job'].every(t => detailBtns.some(b => b.includes(t))), detailBtns.join(' | '));
  await page.screenshot({ path: SHOT + '/qa-owner-detail.png' });

  // Estimate
  await page.getByRole('button', { name: 'Estimate' }).click();
  await page.locator('#est-amount').waitFor({ timeout: 8000 });
  await page.locator('#est-amount').fill('450');
  await page.getByRole('button', { name: 'Save Estimate' }).click(); await sleep(2500);
  let st = await page.evaluate(id => DB.getJobById(id).status, j1.jobId);
  ok('owner: Estimate → follow_up', st === 'follow_up', st);

  // Mark lost, then reopen
  await page.evaluate(id => App.setJobStatus(id, 'lost'), j1.jobId); await sleep(3500);
  st = await page.evaluate(id => DB.getJobById(id).status, j1.jobId);
  let srvSt = (await serverJobs(page)).names.length && await page.evaluate(async id => { const s = await SupabaseClient.auth.getSession(); const r = await fetch('/api/load-jobs', { headers: { Authorization: 'Bearer ' + s.data.session.access_token } }); const d = await r.json(); return (d.jobs.find(x => x.job_id === id) || {}).status; }, j1.jobId);
  ok('owner: Mark Lost → lost (cache and server agree)', st === 'lost' && srvSt === 'lost', 'cache=' + st + ' server=' + srvSt);
  await page.evaluate(id => App.openJobDetail(id), j1.jobId); await sleep(800);
  const reopen = page.getByRole('button', { name: /Reopen Job/ });
  ok('owner: lost job offers Reopen', await reopen.count() > 0);
  if (await reopen.count()) { await reopen.click(); await sleep(800); const okb = page.locator('.modal:not(.hidden) button:visible, #confirm-modal button:visible').filter({ hasText: /Reopen|OK|Yes|Confirm/ }); if (await okb.count()) await okb.first().click(); await sleep(3000); }
  st = await page.evaluate(id => DB.getJobById(id).status, j1.jobId);
  ok('owner: Reopen → open again', st !== 'lost' && st !== 'follow_up', st);

  // Close with money
  await page.evaluate(id => App.openJobDetail(id), j1.jobId); await sleep(800);
  await page.getByRole('button', { name: /Close Job/ }).click();
  await page.locator('#close-total').waitFor({ timeout: 8000 });
  await page.locator('#close-total').fill('300');
  if (await page.locator('#close-parts').count()) await page.locator('#close-parts').fill('20');
  await page.locator('button.btn-success:visible', { hasText: 'Close Job' }).last().click();
  await sleep(3000);
  const closed = await page.evaluate(id => { const j = DB.getJobById(id); return { status: j.status, total: j.jobTotal, parts: j.partsCost, techPayout: j.techPayout, ownerPayout: j.ownerPayout, contractorFee: j.contractorFee }; }, j1.jobId);
  ok('owner: Close Job stores total 300 / parts 20 and a payout', (closed.status === 'paid' || closed.status === 'closed') && +closed.total === 300 && +closed.parts === 20, JSON.stringify(closed));
  const srvClosed = await page.evaluate(async id => { const s = await SupabaseClient.auth.getSession(); const r = await fetch('/api/load-jobs', { headers: { Authorization: 'Bearer ' + s.data.session.access_token } }); const d = await r.json(); const j = d.jobs.find(x => x.job_id === id); return j && { status: j.status, job_total: j.job_total, parts_cost: j.parts_cost }; }, j1.jobId);
  ok('owner: closed job persisted on server', srvClosed && +srvClosed.job_total === 300, JSON.stringify(srvClosed));

  // Balance + Schedule render
  await page.evaluate(() => App.navigate('balance')); await sleep(2000);
  const balVisible = await page.evaluate(() => { const v = document.getElementById('view-balance'); return v && getComputedStyle(v).display !== 'none' && v.innerText.length > 50; });
  ok('owner: Balance view renders', balVisible);
  await page.screenshot({ path: SHOT + '/qa-owner-balance.png' });
  await page.evaluate(() => App.navigate('calendar')); await sleep(1500);
  const calVisible = await page.evaluate(() => { const v = document.getElementById('view-calendar'); return v && getComputedStyle(v).display !== 'none' && v.innerText.length > 20; });
  ok('owner: Schedule view renders', calVisible);

  // Dispatch modal
  await page.evaluate(id => App.openDispatchModal(id), j1.jobId); await sleep(1200);
  const dispatchHasWA = await page.evaluate(() => !!document.querySelector('a[href*="wa.me"], a[href*="whatsapp"], a[href^="https://api.whatsapp.com"]') || /whatsapp/i.test(document.body.innerText));
  ok('owner: Dispatch modal opens with a WhatsApp action', dispatchHasWA);
  await page.evaluate(() => { try { App.closeModal(); } catch (e) {} });

  // Pointy write with confirm
  const p1 = await pointy(page, 'add a note to QA TEST DELETE ME: verified by QA', { confirm: true });
  await sleep(1500);
  const notes = await page.evaluate(id => DB.getJobById(id).notes || '', j1.jobId);
  ok('owner: Pointy add_note asks to confirm, then writes', p1.confirmed && /verified by QA/i.test(notes), 'confirmed=' + p1.confirmed + ' notes=' + notes.slice(0, 60) + ' reply=' + p1.reply.slice(0, 80));

  // Create dispatcher via Settings UI
  await page.evaluate(() => App.navigate('settings')); await sleep(1500);
  await page.getByRole('button', { name: /Create Dispatcher/ }).click();
  await page.locator('#invite-name').waitFor({ timeout: 8000 });
  await page.locator('#invite-name').fill('QA Dispatcher');
  await page.locator('#invite-submit-btn').click();
  await page.locator('#invite-success-body').waitFor({ state: 'visible', timeout: 20000 });
  const successText = await page.locator('#invite-success-body').innerText();
  const dispCode = (successText.match(/DISPATCHER-[A-Z0-9]{4}/) || [])[0];
  ok('owner: Create Dispatcher gives a login code', !!dispCode, dispCode || successText.slice(0, 120));
  await page.screenshot({ path: SHOT + '/qa-owner-invite.png' });
  await page.evaluate(() => { try { document.getElementById('invite-modal').classList.add('hidden'); } catch (e) {} });
  const users = await page.evaluate(async () => { const r = await SupabaseClient.rpc('get_users_for_admin'); return (r.data || []).map(u => u.name + ':' + u.role); });
  ok('owner: users list shows the dispatcher', users.some(u => u.startsWith('QA Dispatcher:dispatcher')), users.join(', '));

  // ── DISPATCHER ────────────────────────────────────────────────────
  const dCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const d = await dCtx.newPage(); const derrs = []; d.on('pageerror', e => derrs.push(e.message));
  let dOK = false;
  try { await login(d, dispCode); dOK = true; } catch (e) { ok('dispatcher login', false, e.message); }
  if (dOK) {
    const dme = await d.evaluate(() => Auth.getUser() && (Auth.getUser().name + '/' + Auth.getUser().role));
    ok('dispatcher login', dme === 'QA Dispatcher/dispatcher', dme);
    const dsrv = await serverJobs(d);
    const osrv = await serverJobs(page);
    ok('dispatcher sees ALL jobs (operator rule)', dsrv.status === 200 && dsrv.n === osrv.n, 'dispatcher=' + dsrv.n + ' owner=' + osrv.n);
    const QA2 = 'QA DISP JOB DELETE ME';
    const j2 = await addJob(d, QA2);
    ok('dispatcher: add job via form', !!j2, JSON.stringify(j2));
    const dsrv2 = await serverJobs(d);
    ok('dispatcher: new job reached the server', dsrv2.names.includes(QA2));
    const osrv2 = await serverJobs(page);
    ok('owner sees the dispatcher\'s job', osrv2.names.includes(QA2));
    if (j2) {
      await d.evaluate(id => App.openJobDetail(id), j2.jobId); await sleep(1200);
      const dBtns = await d.evaluate(() => [...document.querySelectorAll('#view-job-detail button')].map(b => b.textContent.trim().replace(/\s+/g, ' ')));
      ok('dispatcher: can Dispatch/Close, cannot Delete', dBtns.some(b => b.includes('Dispatch')) && dBtns.some(b => b.includes('Close Job')) && !dBtns.some(b => b.includes('Delete Job')), dBtns.join(' | '));
      await d.screenshot({ path: SHOT + '/qa-dispatcher-detail.png' });
      const delTry = await d.evaluate(async id => { const s = await SupabaseClient.auth.getSession(); const r = await fetch('/api/delete-job/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + s.data.session.access_token } }); return r.status; }, j2.jobId);
      ok('dispatcher: DELETE /api/delete-job is refused (403)', delTry === 403, 'status ' + delTry);
      const pd = await pointy(d, 'How many open jobs do I have?');
      ok('dispatcher: Pointy answers', /\d/.test(pd.reply), pd.reply.slice(0, 100));
      const pdel = await pointy(d, 'delete QA DISP JOB DELETE ME', { confirm: true });
      const stillThere = await d.evaluate(id => !!DB.getJobById(id), j2.jobId);
      ok('dispatcher: Pointy refuses delete (owner-only) and job survives', stillThere && !pdel.confirmed, pdel.reply.slice(0, 100));
    }
    await d.evaluate(() => App.navigate('settings')); await sleep(1200);
    const adminSectionHidden = await d.evaluate(() => { const el = document.getElementById('admin-users-section'); return !el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || el.innerText.trim() === ''; });
    ok('dispatcher: no user-management section', adminSectionHidden);
    await d.evaluate(() => Auth.logout()); await sleep(1500);
    const afterLogout = await d.evaluate(() => ({ jobsKey: localStorage.getItem('op_jobs'), token: localStorage.getItem('magic_token') }));
    ok('dispatcher: logout clears cached jobs + code', !afterLogout.jobsKey && !afterLogout.token);
    ok('dispatcher: no page errors', derrs.length === 0, derrs.slice(0, 2).join(' | '));
  }

  // ── CLEANUP (owner) ───────────────────────────────────────────────
  await page.evaluate(() => App.navigate('jobs')); await sleep(1000);
  const qaIds = await page.evaluate(() => (DB.getJobs() || []).filter(j => /^QA (TEST|DISP JOB) DELETE ME$/.test(j.customerName)).map(j => j.jobId));
  for (const id of qaIds) { await page.evaluate(async i => { await DB.deleteJob(i); }, id); await sleep(1500); }
  const srvEnd = await serverJobs(page);
  ok('cleanup: QA jobs deleted on the server', !srvEnd.names.some(n => /DELETE ME/.test(n)), 'server n=' + srvEnd.n + ' (started ' + srv0.n + ')');
  const dispId = await page.evaluate(async () => { const r = await SupabaseClient.rpc('get_users_for_admin'); const u = (r.data || []).find(x => x.name === 'QA Dispatcher'); return u && u.id; });
  if (dispId) {
    const delStatus = await page.evaluate(async (id, code) => { const r = await fetch('/admin/delete-user/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + code } }); return r.status; }, dispId, OWNER_CODE);
    const usersEnd = await page.evaluate(async () => { const r = await SupabaseClient.rpc('get_users_for_admin'); return (r.data || []).map(u => u.name); });
    ok('cleanup: QA Dispatcher deleted', delStatus === 200 && !usersEnd.includes('QA Dispatcher'), 'status ' + delStatus + ' users=' + usersEnd.join(','));
  }
  ok('owner: no page errors during the run', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  const fails = results.filter(r => !r.pass);
  console.log('\nRESULT: ' + (results.length - fails.length) + '/' + results.length + ' passed' + (fails.length ? '; FAILED: ' + fails.map(f => f.name).join('; ') : ''));
  process.exit(fails.length ? 1 : 0);
})().catch(async e => { console.error('SCRIPT ERROR', e.message); console.log('partial: ' + results.filter(r => r.pass).length + '/' + results.length); process.exit(1); });
