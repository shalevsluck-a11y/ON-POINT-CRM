// Operator rule (2026-09-15): the 50% dispatch / copy is ONLY description, city + ZIP,
// and date. No "NEW JOB ASSIGNMENT" header, ref, name, street, phone, notes or payout.
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
  grab('_scrubPhones') + grab('_formatDispatchDate') + grab('_buildWhatsAppTechDispatchMsg') +
  '\nreturn _buildWhatsAppTechDispatchMsg;'
)();

const job = {
  jobId: 'mu2x8fajEBJR4', customerName: 'ANA OSORIO', phone: '9738762863',
  address: '72 Mansel Dr', city: 'Landing', state: 'NJ', zip: '07850',
  scheduledDate: '2030-01-15', scheduledTime: '10-12',
  description: 'cleaning + inspection $99, call 973-876-2863', notes: 'gate code 1234'
};

const half = build(job, 'half');
assert.strictEqual(half, '*cleaning + inspection $99, call [hidden]*\nLanding 07850\nTuesday, Jan 15, 2030'); // service in WhatsApp bold
// multi-line description: bold each line; stray * can't break the formatting
assert.strictEqual(build({ ...job, description: 'new spring\n**urgent**' }, 'half'), '*new spring*\n*urgent*\nLanding 07850\nTuesday, Jan 15, 2030');
for (const leak of ['NEW JOB', 'Ref', 'ANA', 'OSORIO', 'Mansel', '9738762863', 'gate code', 'Payout', 'K?']) {
  assert.ok(!half.includes(leak), '50% message leaked: ' + leak);
}
// no description: just where + when
assert.strictEqual(build({ ...job, description: '' }, 'half'), 'Landing 07850\nTuesday, Jan 15, 2030');

console.log('dispatch-half: PASS');
