// Professional-looking job fields, one implementation for both sides:
//   - the server runs it on Pointy's add_job / update_job params and on parse-job,
//     so the confirm card already shows "Thomas Diblasi, Pine Island, NY 10969"
//   - the browser runs it in DB.saveJob, so every other path (manual form, AI paste,
//     edits) is covered too.
// Operator 2026-09-21: "THOMAS DIBLASI pine island, ny, 10969" must never be saved
// as typed. Only touches the fields that are present; never invents a value.
(function (root) {
  'use strict';

  const STATES = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
    connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
    illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
    maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
    mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
    pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
    tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
    'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
  };
  // Words that stay upper-case inside an address ("12 NW 3rd St", "PO Box 9").
  const KEEP_UPPER = /^(n|s|e|w|ne|nw|se|sw|po|nyc|us|usa)$/i;

  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // "THOMAS DIBLASI" -> "Thomas Diblasi", "o'brien-smith" -> "O'Brien-Smith",
  // "mcdonald" -> "McDonald". ponytail: no rules for "van der"/"de la" particles or
  // Roman numerals - add them when a real name shows up wrong.
  function word(w) {
    if (!w) return w;
    if (/^\d/.test(w)) return w.toLowerCase();                 // 1st, 2nd, 10969
    return w.split(/([-'’])/).map(p => {
      if (p === '-' || p === "'" || p === '’' || !p) return p;
      const t = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
      return /^Mc[a-z]/.test(t) ? 'Mc' + t.charAt(2).toUpperCase() + t.slice(3) : t;
    }).join('');
  }
  function titleCase(s) { return clean(s).split(' ').map(word).join(' '); }

  function name(s) { return titleCase(s); }
  function city(s) { return titleCase(s); }
  function address(s) {
    return clean(s).split(' ').map(w => KEEP_UPPER.test(w) ? w.toUpperCase() : word(w)).join(' ');
  }
  function state(s) {
    const t = clean(s).replace(/\./g, '').toLowerCase();
    if (!t) return '';
    if (STATES[t]) return STATES[t];
    return t.length === 2 ? t.toUpperCase() : clean(s);
  }
  function zip(s) {
    const t = clean(s);
    const m = t.match(/^(\d{5})(?:[-\s]?(\d{4}))?$/);
    return m ? (m[2] ? m[1] + '-' + m[2] : m[1]) : t;
  }

  // Mutates and returns the object. Touches only the keys that exist and are strings.
  function apply(job) {
    if (!job || typeof job !== 'object') return job;
    if (typeof job.customerName === 'string') job.customerName = name(job.customerName);
    if (typeof job.city === 'string')         job.city = city(job.city);
    if (typeof job.address === 'string')      job.address = address(job.address);
    if (typeof job.state === 'string')        job.state = state(job.state);
    if (typeof job.zip === 'string')          job.zip = zip(job.zip);
    return job;
  }

  const TidyJob = { apply, name, city, address, state, zip, titleCase };
  if (typeof module !== 'undefined' && module.exports) module.exports = TidyJob;
  root.TidyJob = TidyJob;
})(typeof window !== 'undefined' ? window : globalThis);
