// Every job must look professional, whichever way it came in (operator 2026-09-21:
// "THOMAS DIBLASI pine island, ny, 10969" is not acceptable). Runs the real js/tidy.js.
const assert = require('assert');
const T = require('../js/tidy.js');

// the exact case he sent
const j = T.apply({ customerName: 'THOMAS DIBLASI', address: '12 main st', city: 'pine island', state: 'ny', zip: '10969' });
assert.deepStrictEqual(j, { customerName: 'Thomas Diblasi', address: '12 Main St', city: 'Pine Island', state: 'NY', zip: '10969' });

// names
assert.strictEqual(T.name("o'brien-smith"), "O'Brien-Smith");
assert.strictEqual(T.name('MCDONALD'), 'McDonald');
assert.strictEqual(T.name('  anna   lee '), 'Anna Lee');
assert.strictEqual(T.name('House lockout'), 'House Lockout');

// address keeps directions / PO and ordinals
assert.strictEqual(T.address('98 HEMPSTEAD AVE NW'), '98 Hempstead Ave NW');
assert.strictEqual(T.address('po box 12'), 'PO Box 12');
assert.strictEqual(T.address('1ST AVENUE'), '1st Avenue');

// state: full name, dotted, two letters, garbage left alone
assert.strictEqual(T.state('new york'), 'NY');
assert.strictEqual(T.state('N.J.'), 'NJ');
assert.strictEqual(T.state('ct'), 'CT');
assert.strictEqual(T.state('Long Island'), 'Long Island');
assert.strictEqual(T.state(''), '');

// zip
assert.strictEqual(T.zip('10969'), '10969');
assert.strictEqual(T.zip('10969 1234'), '10969-1234');
assert.strictEqual(T.zip('abc'), 'abc');

// phone + description + the town-copied-into-address case from the live Pointy test
assert.strictEqual(T.phone('9175550100'), '(917) 555-0100');
assert.strictEqual(T.phone('+1 917.555.0100'), '(917) 555-0100');
assert.strictEqual(T.phone('555-0100'), '555-0100');
assert.strictEqual(T.sentence("garage door won't open $99"), "Garage door won't open $99");
assert.deepStrictEqual(
  T.apply({ customerName: 'THOMAS DIBLASI', address: 'pine island', city: 'pine island', state: 'ny', zip: '10969', phone: '9175550100', description: "garage door won't open" }),
  { customerName: 'Thomas Diblasi', address: '', city: 'Pine Island', state: 'NY', zip: '10969', phone: '(917) 555-0100', description: "Garage door won't open" });

// never invents fields, never touches non-strings, idempotent
const partial = T.apply({ customerName: 'jo', phone: 5551234, jobTotal: 200 });
assert.deepStrictEqual(partial, { customerName: 'Jo', phone: 5551234, jobTotal: 200 });
assert.deepStrictEqual(T.apply(T.apply({ customerName: 'THOMAS DIBLASI', city: 'PINE ISLAND' })), { customerName: 'Thomas Diblasi', city: 'Pine Island' });
assert.strictEqual(T.apply(null), null);

console.log('tidy.test.js: all assertions passed');
