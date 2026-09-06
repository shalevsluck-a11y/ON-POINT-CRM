// A lost job must be recoverable. reopenJob() puts it back into the pipeline:
// scheduled if it has a date, otherwise a new lead. Guarded to lost + admin/disp.
const assert = require('assert');

function reopenTarget(job, isAdminOrDisp) {
  if (!isAdminOrDisp) return null;          // not authorized
  if (job.status !== 'lost') return null;    // only lost is reopenable here
  return job.scheduledDate ? 'scheduled' : 'new';
}

assert.strictEqual(reopenTarget({status:'lost', scheduledDate:'2026-09-10'}, true), 'scheduled');
assert.strictEqual(reopenTarget({status:'lost', scheduledDate:''}, true), 'new');
assert.strictEqual(reopenTarget({status:'lost'}, true), 'new');
assert.strictEqual(reopenTarget({status:'lost', scheduledDate:'2026-09-10'}, false), null); // tech blocked
assert.strictEqual(reopenTarget({status:'scheduled', scheduledDate:'2026-09-10'}, true), null); // not lost
console.log('reopen-lost: PASS');
