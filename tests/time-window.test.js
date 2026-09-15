// Regression: "today between 2-5" was saved as 2 AM-5 AM. A window written with no
// am/pm is a service visit, so 1-5 means PM. Tests the real function from js/app.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const m = src.match(/function _normTimeWindow\(str\)\{[\s\S]*?\n  \}\n/);
assert.ok(m, '_normTimeWindow not found in js/app.js');
const norm = new Function(m[0] + '\nreturn _normTimeWindow;')();

assert.strictEqual(norm('2-5'), '14-17');            // the operator's case
assert.strictEqual(norm('between 2-5'), '14-17');
assert.strictEqual(norm('12-2'), '12-14');
assert.strictEqual(norm('10-12'), '10-12');
assert.strictEqual(norm('11-2'), '11-14');           // crosses noon
assert.strictEqual(norm('9-11'), '09-11');
assert.strictEqual(norm('7-9'), '07-09');            // 7 stays morning
assert.strictEqual(norm('6-8'), '06-08');            // 6-9 = morning, matching parser.js _to24Ambiguous
assert.strictEqual(norm('5-7'), '17-19');
assert.strictEqual(norm('2pm-5pm'), '14-17');
assert.strictEqual(norm('2am-4am'), '02-04');        // an explicit am is respected
assert.strictEqual(norm('11am-2'), '11-14');
assert.strictEqual(norm('4pm'), '16-18');
assert.strictEqual(norm('14-16'), '14-16');          // stored 24h values pass through unchanged
assert.strictEqual(norm('09-11'), '09-11');
assert.strictEqual(norm(''), '');

console.log('time-window: PASS');
