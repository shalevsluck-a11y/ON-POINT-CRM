// Regressions for Pointy's dates:
//  - "tomorrow" landed two days out: the server built "today" with toISOString() (UTC),
//    which is already the next day after 8 PM in New York.
//  - "next Sunday" (said on Mon 2026-09-14) came back as Mon 2026-09-21: the model
//    counted weekdays itself. It now copies from a calendar, and the server snaps.
const assert = require('assert');
const { nyDate, nyDateLine, snapToNamedWeekday, keepPrices, aiCost, summarizeUsage } = require('../src/ai-usage');

// Sun 2026-09-13 9:50 PM ET = 2026-09-14 01:50 UTC (the operator's screenshot)
const sunNight = new Date('2026-09-14T01:50:00Z');
assert.strictEqual(nyDate(0, sunNight), '2026-09-13');
assert.strictEqual(nyDate(1, sunNight), '2026-09-14');
const line = nyDateLine(sunNight);
assert.ok(line.startsWith('Today is Sunday 2026-09-13 (New York time). Tomorrow is 2026-09-14. Calendar: Sun 2026-09-13 (today), Mon 2026-09-14 (tomorrow), Tue 2026-09-15'), line);
assert.ok(line.includes('Sun 2026-09-20') && line.includes('Sun 2026-09-27'), line);
// the old buggy path, kept as proof of the failure mode
assert.strictEqual(sunNight.toISOString().slice(0, 10), '2026-09-14');
// DST ends 2026-11-01 at 2 AM: 00:30 EDT starts a 25-hour day, so "+24h" would still be Nov 1
assert.strictEqual(nyDate(1, new Date('2026-11-01T04:30:00Z')), '2026-11-02');
// month rollover, 7 PM ET on Sep 30
assert.strictEqual(nyDate(1, new Date('2026-09-30T23:00:00Z')), '2026-10-01');

// Mon 2026-09-14 3:40 PM ET (the second screenshot)
const monday = new Date('2026-09-14T19:40:00Z');
const snap = (msg, iso) => snapToNamedWeekday(msg, iso, monday);
assert.strictEqual(snap('1078 Post Horn Run Lawrenceville, GA 30045 6789005760 Samuel next sunday 12-2', '2026-09-21'), '2026-09-20');
assert.strictEqual(snap('next sunday', '2026-09-20'), '2026-09-20');          // already right
assert.strictEqual(snap('sunday after next', '2026-09-27'), '2026-09-27');    // a Sunday: left alone
assert.strictEqual(snap('Tomorrow 10-12', '2026-09-15'), '2026-09-15');       // no weekday named
assert.strictEqual(snap('move him from tuesday to friday', '2026-09-19'), '2026-09-19'); // two weekdays: ambiguous
assert.strictEqual(snap('he called monday, book 9/25', '2026-09-25'), '2026-09-25');     // explicit date wins
assert.strictEqual(snap('sunday', '2026-09-14'), '2026-09-20');               // nearest Sunday is yesterday: go forward
assert.strictEqual(snap('friday', ''), '');

// Haiku 4.5: $1/M input, $5/M output
assert.strictEqual(aiCost({ input_tokens: 1e6, output_tokens: 1e6 }), 6);
assert.strictEqual(aiCost(null), 0);

const s = summarizeUsage([
  { created_at: '2026-09-14T01:00:00Z', cost_usd: 0.01 }, // Sep 13 ET = today
  { created_at: '2026-09-02T15:00:00Z', cost_usd: '0.02' }, // earlier this month (numeric comes back as a string)
  { created_at: '2026-08-31T15:00:00Z', cost_usd: 0.04 }, // last month
], sunNight);
assert.deepStrictEqual([s.today.calls, s.month.calls, s.all.calls], [1, 2, 3]);
assert.ok(Math.abs(s.all.cost - 0.07) < 1e-9);
assert.strictEqual(s.since, '2026-08-31');

// Prices the operator types must survive into the details (Haiku dropped "-99$")
assert.strictEqual(keepPrices('72 Mansel Dr ANA OSORIO Tomorrow 10-12 cleaning+ inspection -99$', 'cleaning + inspection'), 'cleaning + inspection - $99');
assert.strictEqual(keepPrices('spring $150', 'spring replacement $150'), 'spring replacement $150'); // already there
assert.strictEqual(keepPrices('cleaning 99$', 'cleaning 99$'), 'cleaning 99$');                    // already there, other side
assert.strictEqual(keepPrices('tune up 89.99$', ''), '$89.99');
assert.strictEqual(keepPrices('new door $1,200 and opener $350', 'new door'), 'new door - $1,200, $350');
assert.strictEqual(keepPrices('close Zachary 250 zelle', 'x'), 'x');                               // no $ sign: not a price
assert.strictEqual(keepPrices('quote $99', 'was $990 before'), 'was $990 before - $99');           // $990 is not $99

console.log('ai-usage: PASS');
