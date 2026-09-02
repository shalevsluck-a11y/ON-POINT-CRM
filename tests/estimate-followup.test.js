/* Self-check for the Estimate follow-up logic.  Run: node tests/estimate-followup.test.js */
const assert = require('assert');

// Mirrors App._followUpDay + the renderCalendar split.
const followUpDay = j => (j.followUpAt || '').slice(0, 10);

function splitCalendar(allJobs, jobsOnDate, dateStr) {
  const followUps   = allJobs.filter(j => j.status === 'follow_up' && followUpDay(j) === dateStr);
  const followUpIds = new Set(followUps.map(j => j.jobId));
  return { followUps, jobs: jobsOnDate.filter(j => !followUpIds.has(j.jobId)) };
}

// Noon-UTC stamp keeps the day stable in every timezone (the bug we're avoiding).
assert.strictEqual(followUpDay({ followUpAt: '2026-09-10T12:00:00+00:00' }), '2026-09-10');
assert.strictEqual(followUpDay({ followUpAt: null }), '');

const est   = { jobId:'A', status:'follow_up', followUpAt:'2026-09-10T12:00:00Z', scheduledDate:'2026-09-10' };
const work  = { jobId:'B', status:'scheduled', scheduledDate:'2026-09-10' };
const later = { jobId:'C', status:'follow_up', followUpAt:'2026-09-11T12:00:00Z' };
const noRem = { jobId:'D', status:'follow_up', followUpAt:null, scheduledDate:'2026-09-10' };

const r = splitCalendar([est, work, later, noRem], [est, work, noRem], '2026-09-10');

// The estimate shows once, as a follow-up — never also as a job.
assert.deepStrictEqual(r.followUps.map(j => j.jobId), ['A']);
assert.deepStrictEqual(r.jobs.map(j => j.jobId), ['B', 'D']);

// A reminder set for another day stays off today.
assert.deepStrictEqual(splitCalendar([later], [], '2026-09-10').followUps, []);

console.log('estimate-followup: all checks pass');
