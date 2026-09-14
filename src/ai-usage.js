// Server-side helpers for Pointy: New York "today" and Anthropic cost tracking.
// Outside the PUBLIC_ASSET whitelist in server.js, so it is never served to browsers.

const NY = 'America/New_York';

// YYYY-MM-DD in New York, offset by whole calendar days. toISOString() is UTC,
// which is already tomorrow after 8 PM ET - that turned "tomorrow" into two days out.
// Day math via Date.UTC (not +24h) so a DST-change day can't skip or repeat a date.
function nyDate(offsetDays = 0, now = new Date()) {
  const [y, m, d] = now.toLocaleDateString('en-CA', { timeZone: NY }).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

function nyDateLine(now = new Date()) {
  const today = nyDate(0, now);
  const weekday = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return 'Today is ' + weekday + ' ' + today + ' (New York time). Tomorrow is ' + nyDate(1, now) + '.';
}

// Claude Haiku 4.5 list prices, USD per million tokens
// (platform.claude.com/docs/en/about-claude/pricing, checked 2026-09-13).
const HAIKU_45 = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 };

function aiCost(usage, p = HAIKU_45) {
  if (!usage) return 0;
  return ((usage.input_tokens || 0) * p.input + (usage.output_tokens || 0) * p.output +
          (usage.cache_creation_input_tokens || 0) * p.cacheWrite +
          (usage.cache_read_input_tokens || 0) * p.cacheRead) / 1e6;
}

// Totals for the Settings card, bucketed by New York date. rows: [{ created_at, cost_usd }]
function summarizeUsage(rows, now = new Date()) {
  const today = nyDate(0, now), month = today.slice(0, 7);
  const out = { today: { calls: 0, cost: 0 }, month: { calls: 0, cost: 0 }, all: { calls: 0, cost: 0 }, since: null };
  for (const r of rows) {
    const day = nyDate(0, new Date(r.created_at));
    const c = Number(r.cost_usd) || 0;
    out.all.calls++; out.all.cost += c;
    if (day.slice(0, 7) === month) { out.month.calls++; out.month.cost += c; }
    if (day === today) { out.today.calls++; out.today.cost += c; }
    if (!out.since || day < out.since) out.since = day;
  }
  return out;
}

module.exports = { nyDate, nyDateLine, aiCost, summarizeUsage, HAIKU_45 };
