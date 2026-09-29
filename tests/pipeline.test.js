// Self-check for js/pipeline.js — stages, job-type guesser, lost reasons, follow-up cadence.
// Run: node tests/pipeline.test.js
const assert = require('assert');
const P = require('../js/pipeline.js');

// ── stages are derived, status is untouched ──
assert.strictEqual(P.stageOf({ status: 'new' }), 'lead');
assert.strictEqual(P.stageOf({ status: 'new', scheduledDate: '2026-09-30' }), 'booked');
assert.strictEqual(P.stageOf({ status: 'scheduled', scheduledDate: '2026-09-30' }), 'booked');
assert.strictEqual(P.stageOf({ status: 'scheduled', scheduledDate: '2026-09-30', dispatchedAt: '2026-09-29T12:00:00Z' }), 'dispatched');
assert.strictEqual(P.stageOf({ status: 'in_progress' }), 'dispatched');
assert.strictEqual(P.stageOf({ status: 'follow_up' }), 'estimate');
assert.strictEqual(P.stageOf({ status: 'closed' }), 'done');
assert.strictEqual(P.stageOf({ status: 'paid' }), 'done');
assert.strictEqual(P.stageOf({ status: 'lost' }), 'lost');
assert.strictEqual(P.stageOf(null), 'lead');

// ── overdue = open + date passed; estimates and done jobs never are ──
assert.strictEqual(P.isOverdue({ status: 'scheduled', scheduledDate: '2026-09-24' }, '2026-09-29'), true);
assert.strictEqual(P.isOverdue({ status: 'scheduled', scheduledDate: '2026-09-29' }, '2026-09-29'), false);
assert.strictEqual(P.isOverdue({ status: 'follow_up', scheduledDate: '2026-09-01' }, '2026-09-29'), false);
assert.strictEqual(P.isOverdue({ status: 'paid', scheduledDate: '2026-09-01' }, '2026-09-29'), false);
assert.strictEqual(P.isOverdue({ status: 'new' }, '2026-09-29'), false);

// ── job type guesser, on real descriptions from the database ──
const g = P.guessType;
assert.strictEqual(g('Spring broken need fixing'), 'spring');
assert.strictEqual(g('Replace single garage door for new black door with electric opener - price quote'), 'new_door');
assert.strictEqual(g('Estimate to replace doors 2 doors'), 'new_door');
assert.strictEqual(g('Door installation repair - gaps and won\'t close properly'), 'new_door');
assert.strictEqual(g('tune up + free inspection and free estimate to fix if something is broken -$89'), 'tune_up');
assert.strictEqual(g('Chimney cleaning + inspection -99$'), 'chimney');
assert.strictEqual(g('1 deadbolt isn\'t working, 1 door can\'t open at all need replacing of locks'), 'locksmith');
assert.strictEqual(g('House lockout $200'), 'locksmith');
assert.strictEqual(g('Rekey business - can\'t get copies elsewhere'), 'locksmith');
assert.strictEqual(g('I need to have the eye aligned so I don\'t have to hold the button down to close the door.'), 'remote_keypad');
assert.strictEqual(g('Motor not working'), 'opener');
assert.strictEqual(g('opener install'), 'opener');
assert.strictEqual(g('door came off track'), 'off_track');
assert.strictEqual(g('cable snapped'), 'cable');
assert.strictEqual(g('remote stopped working'), 'remote_keypad');
assert.strictEqual(g('bottom rubber seal torn'), 'weather_seal');
assert.strictEqual(g('automatic gate opener repair'), 'commercial');
assert.strictEqual(g('garage door won\'t open'), 'tune_up');   // a service call, not a part
assert.strictEqual(g(''), '');
assert.strictEqual(g('Cleaning only 200$'), '');                  // nothing to go on — leave blank, never 'other'

// ── lost reasons from Pointy's free text ──
const r = P.reasonFromText;
assert.strictEqual(r('price too high'), 'price');
assert.strictEqual(r('never answered'), 'other');                 // "never answered" alone is not in the rules
assert.strictEqual(r('no answer'), 'no_answer');
assert.strictEqual(r('went with another company'), 'competitor');
assert.strictEqual(r('fixed it themselves'), 'diy');
assert.strictEqual(r('tech no-show'), 'no_tech');
assert.strictEqual(r('customer cancelled'), 'cancelled');
assert.strictEqual(r('too far'), 'out_of_area');
assert.strictEqual(r('spam'), 'duplicate');
assert.strictEqual(r('because reasons'), 'other');
assert.strictEqual(r(''), '');

// ── follow-up cadence: +1, +3, +7, +14 days, then stop ──
assert.strictEqual(P.nextFollowUpDay('2026-09-29', 0), '2026-09-30');
assert.strictEqual(P.nextFollowUpDay('2026-09-29', 1), '2026-10-02');
assert.strictEqual(P.nextFollowUpDay('2026-09-29', 2), '2026-10-06');
assert.strictEqual(P.nextFollowUpDay('2026-09-29', 3), '2026-10-13');
assert.strictEqual(P.nextFollowUpDay('2026-09-29', 4), '');
assert.strictEqual(P.nextFollowUpDay('2026-12-31', 0), '2027-01-01');  // year roll-over
assert.strictEqual(P.nextFollowUpDay('bad', 0), '');
assert.strictEqual(P.followUpDue({ status: 'follow_up', followUpAt: '2026-09-29T12:00:00Z' }, '2026-09-29'), true);
assert.strictEqual(P.followUpDue({ status: 'follow_up', followUpAt: '2026-09-30T12:00:00Z' }, '2026-09-29'), false);
assert.strictEqual(P.followUpDue({ status: 'follow_up' }, '2026-09-29'), true);
assert.strictEqual(P.followUpDue({ status: 'scheduled' }, '2026-09-29'), false);

// ── lists fall back to the defaults, names resolve ──
assert.strictEqual(P.jobTypes({}).length, P.JOB_TYPES.length);
assert.strictEqual(P.jobTypes({ jobTypes: [{ id: 'x', name: 'X' }] })[0].id, 'x');
assert.strictEqual(P.typeName('spring', {}), 'Spring');
assert.strictEqual(P.typeName('', {}), '');
assert.strictEqual(P.reasonName('price', {}), 'Price too high');
assert.strictEqual(P.stageLabel('dispatched'), 'Dispatched');

console.log('pipeline: all checks pass');
