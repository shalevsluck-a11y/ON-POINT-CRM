// Regression: dispatchTechSchedule printed the wrong weekday because
// new Date('YYYY-MM-DD') parses as UTC midnight (= previous evening in ET).
const assert = require('assert');

function formatDispatchDate(dateStr, now) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const pretty = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return 'TODAY (' + weekday + ') - ' + pretty;
  if (diff === 1) return 'TOMORROW (' + weekday + ') - ' + pretty;
  return weekday + ', ' + pretty;
}

// Thu 2026-09-03 sending Friday's schedule
assert.strictEqual(formatDispatchDate('2026-09-04', new Date(2026, 8, 3)), 'TOMORROW (Friday) - Sep 4, 2026');
assert.strictEqual(formatDispatchDate('2026-09-03', new Date(2026, 8, 3)), 'TODAY (Thursday) - Sep 3, 2026');
assert.strictEqual(formatDispatchDate('2026-09-11', new Date(2026, 8, 3)), 'Friday, Sep 11, 2026');
// the old buggy path, kept as proof of the failure mode
assert.strictEqual(new Date('2026-09-04').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }), 'Thursday');

console.log('dispatch-date: PASS');
