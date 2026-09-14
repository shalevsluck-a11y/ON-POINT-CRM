// Server-side helpers for Pointy: New York dates for the AI and Anthropic cost tracking.
// Outside the PUBLIC_ASSET whitelist in server.js, so it is never served to browsers.

const NY = 'America/New_York';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// YYYY-MM-DD in New York, offset by whole calendar days. toISOString() is UTC,
// which is already tomorrow after 8 PM ET - that turned "tomorrow" into two days out.
// Day math via Date.UTC (not +24h) so a DST-change day can't skip or repeat a date.
function nyDate(offsetDays = 0, now = new Date()) {
  const [y, m, d] = now.toLocaleDateString('en-CA', { timeZone: NY }).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

function weekdayOf(iso) {
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}

// "Mon 2026-09-14 (today), Tue 2026-09-15 (tomorrow), ..." - the model copies a date from
// this list instead of counting weekdays, which it got wrong ("next Sunday" -> a Monday).
function nyCalendar(days = 15, now = new Date()) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const iso = nyDate(i, now);
    const name = WEEKDAYS[weekdayOf(iso)];
    out.push(name[0].toUpperCase() + name.slice(1, 3) + ' ' + iso + (i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''));
  }
  return out.join(', ');
}

function nyDateLine(now = new Date()) {
  const today = nyDate(0, now);
  const weekday = WEEKDAYS[weekdayOf(today)];
  return 'Today is ' + weekday[0].toUpperCase() + weekday.slice(1) + ' ' + today +
    ' (New York time). Tomorrow is ' + nyDate(1, now) + '. Calendar: ' + nyCalendar(15, now) + '.';
}

// Safety net: if the user named exactly one weekday and the model's date falls on another
// weekday, move it to the nearest date that IS that weekday (never into the past).
// Skipped when the message also has an explicit date (9/25, Sep 25, 25th) - the weekday
// word may be about something else then.
function snapToNamedWeekday(message, iso, now = new Date()) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const text = String(message || '').toLowerCase();
  if (/\b\d{1,2}\/\d{1,2}\b|\b\d{1,2}(st|nd|rd|th)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/.test(text)) return iso;
  const named = [...new Set(text.match(/\b(sun|mon|tues|wednes|thurs|fri|satur)day\b/g) || [])];
  if (named.length !== 1) return iso;
  let diff = WEEKDAYS.indexOf(named[0]) - weekdayOf(iso);
  if (diff > 3) diff -= 7;
  if (diff < -3) diff += 7;
  if (diff === 0) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  let out = new Date(Date.UTC(y, m - 1, d + diff)).toISOString().slice(0, 10);
  if (out < nyDate(0, now)) out = new Date(Date.UTC(y, m - 1, d + diff + 7)).toISOString().slice(0, 10);
  return out;
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

module.exports = { nyDate, nyCalendar, nyDateLine, snapToNamedWeekday, aiCost, summarizeUsage, HAIKU_45 };
