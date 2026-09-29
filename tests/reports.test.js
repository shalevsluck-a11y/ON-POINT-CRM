// Self-check for js/reports.js — periods, attribution, KPIs, breakdowns. Run: node tests/reports.test.js
const assert = require('assert');
global.Pipeline = require('../js/pipeline.js');
const R = require('../js/reports.js');

// ── periods (Sunday-start week; 2026-09-29 is a Tuesday) ──
const T = '2026-09-29';
assert.deepStrictEqual([R.range('today', T).from, R.range('today', T).to], [T, T]);
assert.deepStrictEqual([R.range('week', T).from, R.range('week', T).to], ['2026-09-27', T]);
assert.deepStrictEqual([R.range('month', T).from, R.range('month', T).to], ['2026-09-01', T]);
assert.deepStrictEqual([R.range('last_month', T).from, R.range('last_month', T).to], ['2026-08-01', '2026-08-31']);
assert.deepStrictEqual([R.range('90d', T).from, R.range('90d', T).to], ['2026-07-02', T]);
assert.deepStrictEqual([R.range('year', T).from, R.range('year', T).to], ['2026-01-01', T]);
assert.strictEqual(R.range('custom', T, { from: '2026-05-01', to: '2026-05-31' }).to, '2026-05-31');
assert.strictEqual(R.range('last_month', '2026-01-15').from, '2025-12-01');   // year roll-back

// ── a small book of jobs (no PayoutEngine in node → the fallback math: parts off the top, then %) ──
const jobs = [
  // paid this month by Orel (40%), $500 total, $100 parts → labor 400 → tech 160, owner 240
  { jobId: 'a', status: 'paid', paidAt: '2026-09-10T15:00:00Z', jobTotal: 500, partsCost: 100, techPercent: 40, contractorPct: 0, assignedTechId: 'orel', assignedTechName: 'Orel', source: 'my_lead', jobType: 'spring', createdByName: 'Solomon', paymentMethod: 'cash', createdAt: '2026-09-09T12:00:00Z' },
  // paid this month, self-assigned owner (50%), $200 → tech 100 + owner 100 = keep 200
  { jobId: 'b', status: 'paid', paidAt: '2026-09-12T15:00:00Z', jobTotal: 200, partsCost: 0, techPercent: 50, contractorPct: 0, isSelfAssigned: true, assignedTechId: 'me', assignedTechName: 'Shalev', source: 'SONART', jobType: 'opener', createdByName: 'Dispatcher D', paymentMethod: 'zelle', createdAt: '2026-09-11T12:00:00Z' },
  // paid LAST month — must not count this month
  { jobId: 'c', status: 'paid', paidAt: '2026-08-20T15:00:00Z', jobTotal: 1000, partsCost: 0, techPercent: 40, assignedTechId: 'orel', assignedTechName: 'Orel', source: 'my_lead', jobType: 'new_door', createdAt: '2026-08-19T12:00:00Z' },
  // lost this month, price
  { jobId: 'd', status: 'lost', lostAt: '2026-09-15T15:00:00Z', lostReason: 'price', estimatedTotal: 900, assignedTechId: 'orel', assignedTechName: 'Orel', source: 'my_lead', jobType: 'spring', createdByName: 'Solomon', createdAt: '2026-09-14T12:00:00Z' },
  // lost this month, no reason recorded (old data)
  { jobId: 'e', status: 'lost', updatedAt: '2026-09-16T15:00:00Z', assignedTechName: 'orel', source: 'my_lead', createdAt: '2026-09-16T12:00:00Z' },
  // open + overdue (date passed, not closed), not dispatched
  { jobId: 'f', status: 'scheduled', scheduledDate: '2026-09-25', assignedTechId: 'orel', assignedTechName: 'Orel', createdAt: '2026-09-24T12:00:00Z' },
  // open, tomorrow, not dispatched
  { jobId: 'g', status: 'scheduled', scheduledDate: '2026-09-30', dispatchedAt: null, createdAt: '2026-09-29T10:00:00Z' },
  // estimate open
  { jobId: 'h', status: 'follow_up', estimatedTotal: 2000, createdAt: '2026-09-17T12:00:00Z' },
];
const res = R.compute(jobs, { range: R.range('month', T), today: T, settings: {} });
const k = res.kpis;

assert.strictEqual(k.done, 2);
assert.strictEqual(k.lost, 2);
assert.strictEqual(k.revenue, 700);
assert.strictEqual(k.parts, 100);
assert.strictEqual(k.techPay, 260);           // 160 + 100
assert.strictEqual(k.profit, 440);            // 240 + (100 owner + 100 self tech)
assert.strictEqual(k.avgTicket, 350);
assert.strictEqual(k.closeRate, 50);          // 2 won / 2 lost
assert.strictEqual(k.margin, 63);             // 440 / 700
assert.strictEqual(k.leads, 7);               // created this month: a b d e f g h (c was August)

// right-now snapshot
assert.strictEqual(res.now.open, 2);
assert.strictEqual(res.now.overdue, 1);
assert.strictEqual(res.now.undispatched, 1);  // g (f is overdue, not "upcoming")
assert.strictEqual(res.now.estimates, 1);
assert.strictEqual(res.now.estimateValue, 2000);

// by tech: Orel groups by id, and the old name-only "orel" job is a separate key (never merged by guess)
const orel = res.byTech.find(x => x.key === 'orel');
assert.strictEqual(orel.done, 1); assert.strictEqual(orel.lost, 1); assert.strictEqual(orel.revenue, 500); assert.strictEqual(orel.profit, 240); assert.strictEqual(orel.closeRate, 50);
assert.strictEqual(res.byTech[0].key, 'orel');   // sorted by collected
const me = res.byTech.find(x => x.key === 'me');
assert.strictEqual(me.profit, 200);

// by source / type / lost reason / dispatcher / payment
assert.strictEqual(res.bySource.find(x => x.key === 'my_lead').name, 'My leads');
assert.strictEqual(res.bySource.find(x => x.key === 'SONART').revenue, 200);
assert.strictEqual(res.byType.find(x => x.key === 'spring').lost, 1);
assert.strictEqual(res.byType.find(x => x.key === 'spring').closeRate, 50);
assert.strictEqual(res.byLost.find(x => x.key === 'price').atRisk, 900);
assert.strictEqual(res.byLost.find(x => x.key === '').name, 'No reason');
assert.strictEqual(res.byDispatcher.find(x => x.key === 'Solomon').leads, 2);   // a, d
assert.strictEqual(res.byDispatcher.find(x => x.key === 'Solomon').done, 1);
assert.strictEqual(res.byPay.find(x => x.key === 'zelle').revenue, 200);

// months: 6 entries ending this month; August has c
assert.strictEqual(res.byMonth.length, 6);
assert.strictEqual(res.byMonth[5].key, '2026-09');
assert.strictEqual(res.byMonth[4].revenue, 1000);
assert.strictEqual(res.byMonth[5].revenue, 700);

// filters narrow everything
const onlyOrel = R.compute(jobs, { range: R.range('month', T), today: T, settings: {}, tech: 'orel' });
assert.strictEqual(onlyOrel.kpis.revenue, 500);
assert.strictEqual(onlyOrel.now.overdue, 1);
const onlySpring = R.compute(jobs, { range: R.range('month', T), today: T, settings: {}, type: 'spring' });
assert.strictEqual(onlySpring.kpis.done, 1);

// all time picks up August too
assert.strictEqual(R.compute(jobs, { range: R.range('all', T), today: T, settings: {} }).kpis.revenue, 1700);

// empty period → zeros, not NaN
const empty = R.compute(jobs, { range: R.range('custom', T, { from: '2025-01-01', to: '2025-01-31' }), today: T, settings: {} });
assert.strictEqual(empty.kpis.revenue, 0); assert.strictEqual(empty.kpis.closeRate, null); assert.strictEqual(empty.kpis.avgTicket, 0);

console.log('reports: all checks pass');
