// Regression: Pointy put "tomorrow" jobs two days out. The server built "today"
// with toISOString() (UTC), which is already the next day after 8 PM in New York.
const assert = require('assert');
const { nyDate, nyDateLine, aiCost, summarizeUsage } = require('../src/ai-usage');

// Sun 2026-09-13 9:50 PM ET = 2026-09-14 01:50 UTC (the operator's screenshot)
const sunNight = new Date('2026-09-14T01:50:00Z');
assert.strictEqual(nyDate(0, sunNight), '2026-09-13');
assert.strictEqual(nyDate(1, sunNight), '2026-09-14');
assert.strictEqual(nyDateLine(sunNight), 'Today is Sunday 2026-09-13 (New York time). Tomorrow is 2026-09-14.');
// the old buggy path, kept as proof of the failure mode
assert.strictEqual(sunNight.toISOString().slice(0, 10), '2026-09-14');
// DST ends 2026-11-01 at 2 AM: 00:30 EDT starts a 25-hour day, so "+24h" would still be Nov 1
assert.strictEqual(nyDate(1, new Date('2026-11-01T04:30:00Z')), '2026-11-02');
// month rollover, 7 PM ET on Sep 30
assert.strictEqual(nyDate(1, new Date('2026-09-30T23:00:00Z')), '2026-10-01');

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

console.log('ai-usage: PASS');
