// Operator rule (2026-09-15): the 50% dispatch / copy is exactly 3 lines, with a blank
// line between each:  city, state ZIP  /  date + time  /  service in WhatsApp bold.
// No "NEW JOB ASSIGNMENT" header, ref, name, street, phone, notes or payout.
// Runs the real functions out of js/app.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const grab = name => {
  const m = src.match(new RegExp('  function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}\\n'));
  assert.ok(m, name + ' not found in js/app.js');
  return m[0];
};
const build = new Function(
  grab('_scrubPhones') + grab('_formatDispatchDate') + grab('_formatTime') + grab('_buildWhatsAppTechDispatchMsg') +
  '\nreturn _buildWhatsAppTechDispatchMsg;'
)();
const lines = msg => msg.split('\n\n');

const job = {
  jobId: 'mu2x8fajEBJR4', customerName: 'ANA OSORIO', phone: '9738762863',
  address: '72 Mansel Dr', city: 'Landing', state: 'NJ', zip: '07850',
  scheduledDate: '2030-01-15', scheduledTime: '14-17',
  description: 'cleaning + inspection $99, call 973-876-2863', notes: 'gate code 1234'
};

const half = build(job, 'half');
assert.strictEqual(half, 'Landing, NJ 07850\n\nTuesday, Jan 15, 2030  ·  2-5 PM\n\n*cleaning + inspection $99, call [hidden]*');
assert.strictEqual(lines(half).length, 3);
for (const leak of ['NEW JOB', 'Ref', 'ANA', 'OSORIO', 'Mansel', '9738762863', 'gate code', 'Payout', 'K?']) {
  assert.ok(!half.includes(leak), '50% message leaked: ' + leak);
}
// multi-line description stays ONE bold line; stray * can't break the bold
assert.strictEqual(lines(build({ ...job, description: 'new spring\n**urgent**' }, 'half'))[2], '*new spring urgent*');
// today / tomorrow: just the word, not the date (operator 2026-09-15)
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date(), tmrw = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
assert.strictEqual(lines(build({ ...job, scheduledDate: iso(now) }, 'half'))[1], 'TODAY  ·  2-5 PM');
assert.strictEqual(lines(build({ ...job, scheduledDate: iso(tmrw) }, 'half'))[1], 'TOMORROW  ·  2-5 PM');
// no time yet: date alone; no description: two blocks
assert.strictEqual(build({ ...job, scheduledTime: '', description: '' }, 'half'), 'Landing, NJ 07850\n\nTuesday, Jan 15, 2030');

console.log('dispatch-half: PASS');
