// One-time: give every job with no job_type the type the description implies,
// using the SAME guesser the app uses (js/pipeline.js). Only fills blanks.
//   dry run:  node scripts/backfill-job-types.js
//   write:    node scripts/backfill-job-types.js --write
// Needs SUPABASE_DIRECT_URL + SUPABASE_DIRECT_SERVICE_KEY in the env (pm2 env 0 on the VPS).
const { createClient } = require('@supabase/supabase-js');
const Pipeline = require('../js/pipeline.js');

const url = process.env.SUPABASE_DIRECT_URL || 'https://nmmpemjcnncjfpooytpv.supabase.co';
const key = process.env.SUPABASE_DIRECT_SERVICE_KEY;
if (!key) { console.error('SUPABASE_DIRECT_SERVICE_KEY missing'); process.exit(1); }
const write = process.argv.includes('--write');
const db = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  const { data: jobs, error } = await db.from('jobs').select('job_id, description, notes, job_type').is('job_type', null);
  if (error) { console.error(error.message); process.exit(1); }
  const counts = {};
  const updates = [];
  for (const j of jobs) {
    const t = Pipeline.guessType(j.description || '') || Pipeline.guessType(j.notes || '');
    if (!t) { counts['(blank)'] = (counts['(blank)'] || 0) + 1; continue; }
    counts[t] = (counts[t] || 0) + 1;
    updates.push({ job_id: j.job_id, job_type: t });
  }
  console.log(`${jobs.length} jobs without a type; guessed ${updates.length}:`, counts);
  if (!write) { console.log('dry run — add --write to save'); return; }
  let n = 0;
  for (const u of updates) {
    const { error: e } = await db.from('jobs').update({ job_type: u.job_type }).eq('job_id', u.job_id);
    if (e) console.error(u.job_id, e.message); else n++;
  }
  console.log(`updated ${n} jobs`);
})();
