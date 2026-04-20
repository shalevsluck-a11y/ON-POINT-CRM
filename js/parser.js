/* ============================================================
   PARSER.JS — Smart Lead Text Parser
   Extracts structured fields from raw pasted lead text
   Returns fields + confidence scores per field
   ============================================================ */

const LeadParser = (() => {

  // ────────────────────────────────────────────
  // MAIN PARSE FUNCTION
  // ────────────────────────────────────────────

  function parse(rawText) {
    if (!rawText || !rawText.trim()) return _emptyResult();

    const text = rawText.trim();
    const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

    const result = {
      customerName:  _parseName(text, lines),
      phone:         _parsePhone(text),
      address:       _parseAddress(text, lines),
      city:          _parseCity(text),
      state:         _parseState(text),
      zip:           _parseZip(text),
      scheduledDate: _parseDate(text),
      scheduledTime: _parseTime(text),
      description:   _parseDescription(text, lines),
    };

    return result;
  }

  // ────────────────────────────────────────────
  // NAME PARSER
  // ────────────────────────────────────────────

  function _parseName(text, lines) {
    // Common patterns: "Name: John Smith", "Customer: ...", or first line of text
    const labelPatterns = [
      /(?:customer|client|name|contact)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*(?:[-–]|\n|$)/m,
    ];

    for (const pat of labelPatterns) {
      const m = text.match(pat);
      if (m) {
        const name = m[1].trim();
        if (_isPlausibleName(name)) return { value: _titleCase(name), confidence: 'high' };
      }
    }

    // Try first line if it looks like a name (no numbers, 1-4 words, blocklist checked)
    for (const line of lines.slice(0, 3)) {
      const clean = line.replace(/[^a-zA-Z\s]/g, '').trim();
      const words = clean.split(/\s+/).filter(Boolean);
      if (words.length >= 1 && words.length <= 4 && words.every(w => /^[A-Z][a-z]{1,}$/.test(w)) && _isPlausibleName(clean)) {
        return { value: clean, confidence: 'medium' };
      }
    }

    return { value: '', confidence: 'low' };
  }

  // Words that should never be treated as a person's name
  const _NAME_BLOCKLIST = new Set([
    'sunday','monday','tuesday','wednesday','thursday','friday','saturday',
    'january','february','march','april','may','june','july','august',
    'september','october','november','december',
    'today','tomorrow','morning','afternoon','evening','night',
    'contracting','contractor','contractors','construction','services',
    'service','company','group','associates','enterprises','management',
    'llc','inc','corp','co','ltd',
  ]);

  function _isPlausibleName(str) {
    if (!str) return false;
    if (/\d/.test(str)) return false;
    const words = str.split(/\s+/);
    if (words.length < 1 || words.length > 5 || str.length < 2) return false;
    // Reject if any word is a day, month, or known non-name term
    if (words.some(w => _NAME_BLOCKLIST.has(w.toLowerCase()))) return false;
    return true;
  }

  function _titleCase(str) {
    return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }

  // ────────────────────────────────────────────
  // PHONE PARSER
  // ────────────────────────────────────────────

  function _parsePhone(text) {
    // Match: (516) 555-1234, 516-555-1234, 5165551234, +15165551234
    const patterns = [
      /(?:phone|cell|mobile|tel|call)[:\s#]*([\+1]?\s*\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/i,
      /\b(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})\b/,
      /\b(\d{10})\b/,
      /\b(\+1\d{10})\b/,
    ];

    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        const phone = _formatPhone(m[1]);
        if (phone) return { value: phone, confidence: 'high' };
      }
    }
    return { value: '', confidence: 'low' };
  }

  function _formatPhone(raw) {
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    // Remove leading 1 if 11 digits
    const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
    if (d.length !== 10) return raw; // Return as-is if not standard
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  }

  // ────────────────────────────────────────────
  // ADDRESS PARSER
  // ────────────────────────────────────────────

  function _parseAddress(text, lines) {
    // Look for lines containing a house number + street.
    // Middle words must start with a letter or be a short ordinal (4th, 21st) —
    // this prevents phone number digits (555, 1234) from matching as street words.
    const streetTypes = 'St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Terr|Terrace|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Loop|Trail|Trl';
    const midWord = '(?:[A-Za-z][A-Za-z0-9\\.]*|\\d{1,2}(?:st|nd|rd|th)?)';
    const addrPattern = new RegExp(
      `\\b(\\d{1,6}(?:\\s+${midWord}){1,4}\\s+(?:${streetTypes}))(?:[,\\s]|$)`,
      'i'
    );

    // Check full text
    const m = text.match(addrPattern);
    if (m) return { value: _titleCase(m[1].trim()), confidence: 'high' };

    // Check each line
    for (const line of lines) {
      if (/^\d+\s+/.test(line) && line.length < 80) {
        // Remove city/state/zip from the line first
        const addr = line.replace(/,?\s*[A-Z]{2}\s+\d{5}(-\d{4})?$/, '')
                        .replace(/,?\s*(?:NY|NJ|CT|PA|FL|TX)\b/gi, '')
                        .trim();

        // Reject lines that are phone numbers.
        // A phone number has 7–11 digits and almost no non-digit, non-separator chars.
        // Real house numbers have at most 5 digits and are surrounded by street words.
        const digitsOnly     = addr.replace(/\D/g, '');
        const nonDigitNonSep = addr.replace(/[\d\s\-\.\(\)\+]/g, '');
        if (digitsOnly.length >= 7 && digitsOnly.length <= 11 && nonDigitNonSep.length <= 2) continue;

        if (addr.length > 5 && /\d/.test(addr)) {
          return { value: _titleCase(addr), confidence: 'medium' };
        }
      }
    }

    // Labeled address
    const labeled = text.match(/(?:address|location|addr)[:\s]+(.+?)(?:\n|,\s*[A-Z]{2}|$)/i);
    if (labeled) {
      return { value: _titleCase(labeled[1].trim()), confidence: 'medium' };
    }

    return { value: '', confidence: 'low' };
  }

  // ────────────────────────────────────────────
  // CITY PARSER
  // ────────────────────────────────────────────

  function _parseCity(text) {
    // Pattern: "City, ST ZIP" or "City, ST" or common city names
    const m = text.match(/([A-Za-z\s]{2,25}),?\s*(?:ME|NH|VT|MA|RI|CT|NY|NJ|PA|DE|MD|DC|VA|WV|NC|SC|GA|FL|OH|KY|TN|IN|MI|CA|TX)\b/i);
    if (m) {
      // Isolate city part — take last word group before state
      const cityRaw = m[1].replace(/\d+\s+/g, '').trim();
      const words = cityRaw.split(/\s+/).slice(-3).join(' ');
      if (words.length >= 2) return { value: _titleCase(words), confidence: 'high' };
    }

    // City: label
    const labeled = text.match(/(?:city)[:\s]+([A-Za-z\s]{2,25})/i);
    if (labeled) return { value: _titleCase(labeled[1].trim()), confidence: 'medium' };

    return { value: '', confidence: 'low' };
  }

  // ────────────────────────────────────────────
  // STATE PARSER
  // ────────────────────────────────────────────

  function _parseState(text) {
    const stateMap = {
      'ME': ['Maine', 'ME'],
      'NH': ['New Hampshire', 'NH'],
      'VT': ['Vermont', 'VT'],
      'MA': ['Massachusetts', 'MA'],
      'RI': ['Rhode Island', 'RI'],
      'CT': ['Connecticut', 'CT'],
      'NY': ['New York', 'NY'],
      'NJ': ['New Jersey', 'NJ'],
      'PA': ['Pennsylvania', 'PA'],
      'DE': ['Delaware', 'DE'],
      'MD': ['Maryland', 'MD'],
      'DC': ['Washington DC', 'DC'],
      'VA': ['Virginia', 'VA'],
      'WV': ['West Virginia', 'WV'],
      'NC': ['North Carolina', 'NC'],
      'SC': ['South Carolina', 'SC'],
      'GA': ['Georgia', 'GA'],
      'FL': ['Florida', 'FL'],
      'OH': ['Ohio', 'OH'],
      'KY': ['Kentucky', 'KY'],
      'TN': ['Tennessee', 'TN'],
      'IN': ['Indiana', 'IN'],
      'MI': ['Michigan', 'MI'],
    };

    for (const [abbr, names] of Object.entries(stateMap)) {
      for (const name of names) {
        const esc = name.replace(/\s/g, '\\s*');
        if (new RegExp(`\\b${esc}\\b`, 'i').test(text)) {
          return { value: abbr, confidence: 'high' };
        }
      }
    }
    return { value: '', confidence: 'low' };
  }

  // ────────────────────────────────────────────
  // ZIP PARSER
  // ────────────────────────────────────────────

  function _parseZip(text) {
    // US ZIP: 5 digits, optionally +4
    const m = text.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (m) return { value: m[1], confidence: 'high' };
    return { value: '', confidence: 'low' };
  }

  // ────────────────────────────────────────────
  // DATE PARSER
  // ────────────────────────────────────────────

  function _parseDate(text) {
    const today = new Date();
    today.setHours(0,0,0,0);

    // Relative keywords
    if (/\btoday\b/i.test(text)) {
      return { value: _dateToStr(today), confidence: 'high' };
    }
    if (/\btomorrow\b/i.test(text)) {
      const d = new Date(today); d.setDate(d.getDate() + 1);
      return { value: _dateToStr(d), confidence: 'high' };
    }
    if (/\bday after tomorrow\b/i.test(text)) {
      const d = new Date(today); d.setDate(d.getDate() + 2);
      return { value: _dateToStr(d), confidence: 'high' };
    }

    // Day names → next occurrence
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    for (let i = 0; i < days.length; i++) {
      if (new RegExp(`\\b${days[i]}\\b`, 'i').test(text)) {
        const d = _nextDayOfWeek(i, today);
        return { value: _dateToStr(d), confidence: 'high' };
      }
    }

    // Explicit date formats
    const datePatterns = [
      // MM/DD/YYYY or M/D/YY
      { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/, handler: m => {
        const y = m[3].length === 2 ? '20'+m[3] : m[3];
        return new Date(+y, +m[1]-1, +m[2]);
      }},
      // Month DD, YYYY — "January 15, 2025"
      { re: /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/i,
        handler: m => {
          const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
          const mo = months[m[1].slice(0,3).toLowerCase()];
          const yr = m[3] ? +m[3] : today.getFullYear();
          const d = new Date(yr, mo, +m[2]);
          // If date is in the past, assume next year
          if (d < today && !m[3]) d.setFullYear(d.getFullYear()+1);
          return d;
        }
      },
      // DD Month YYYY
      { re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*(\d{4})?\b/i,
        handler: m => {
          const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
          const mo = months[m[2].slice(0,3).toLowerCase()];
          const yr = m[3] ? +m[3] : today.getFullYear();
          return new Date(yr, mo, +m[1]);
        }
      },
      // YYYY-MM-DD
      { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, handler: m => new Date(+m[1], +m[2]-1, +m[3]) },
    ];

    for (const { re, handler } of datePatterns) {
      const m = text.match(re);
      if (m) {
        try {
          const d = handler(m);
          if (!isNaN(d.getTime())) {
            return { value: _dateToStr(d), confidence: 'high' };
          }
        } catch (e) {}
      }
    }

    return { value: '', confidence: 'low' };
  }

  function _nextDayOfWeek(targetDay, from) {
    const d = new Date(from);
    const current = d.getDay();
    let diff = targetDay - current;
    if (diff <= 0) diff += 7; // Always next occurrence, not today
    d.setDate(d.getDate() + diff);
    return d;
  }

  function _dateToStr(d) {
    if (!d || isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  // ────────────────────────────────────────────
  // TIME PARSER
  // ────────────────────────────────────────────

  function _parseTime(text) {
    const patterns = [
      // Explicit AM/PM — highest confidence, check these first
      { re: /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, handler: m => _to24(+m[1], +(m[2]||0), m[3]) },
      { re: /\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i,           handler: m => _to24(+m[1], +m[2], m[3]) },
      { re: /\b(\d{1,2})\s*(am|pm)\b/i,                   handler: m => _to24(+m[1], 0, m[2]) },
      // 24-hour "14:00" or "08:30"
      { re: /\b([0-1]?\d|2[0-3]):([0-5]\d)\b/,            handler: m => `${String(+m[1]).padStart(2,'0')}:${m[2]}` },
      // Ambiguous hour with minutes: "at 2:30" — no AM/PM
      { re: /\bat\s+(\d{1,2}):(\d{2})\b/i,                handler: m => _to24Ambiguous(+m[1], +m[2]) },
      // Ambiguous bare hour: "at 2" or "around 3" — no AM/PM
      { re: /\b(?:at|around|@)\s+(\d{1,2})\b/i,           handler: m => _to24Ambiguous(+m[1], 0) },
      // "between 8 and 10" → use start (8 AM for typical morning window)
      { re: /\bbetween\s+(\d{1,2})(?:\s*(?:am|pm))?\s+and\b/i, handler: m => _to24Ambiguous(+m[1], 0) },
      // Time of day keywords
      { re: /\bmorning\b/i,   handler: () => '09:00' },
      { re: /\bafternoon\b/i, handler: () => '13:00' },
      { re: /\bevening\b/i,   handler: () => '17:00' },
      { re: /\bnoon\b/i,      handler: () => '12:00' },
    ];

    for (const { re, handler } of patterns) {
      const m = text.match(re);
      if (m) {
        try {
          const t = handler(m);
          if (t) return { value: t, confidence: 'high' };
        } catch (e) {}
      }
    }

    return { value: '', confidence: 'low' };
  }

  function _to24(hours, minutes, ampm) {
    if (!ampm) return null;
    let h = hours;
    const isAM = ampm.toLowerCase() === 'am';
    const isPM = ampm.toLowerCase() === 'pm';
    if (isPM && h !== 12) h += 12;
    if (isAM && h === 12) h = 0;
    if (h > 23 || h < 0) return null;
    return `${String(h).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
  }

  // Business rule: no AM/PM context — home service window is 6am–8pm
  // Hours 1–5  → assume PM (1pm–5pm is prime service time)
  // Hours 6–9  → assume AM (morning window)
  // All others → assume PM
  function _to24Ambiguous(hours, minutes) {
    if (hours < 1 || hours > 12) return null;
    let h = hours;
    if (hours >= 1 && hours <= 5) {
      h = hours + 12; // PM
    } else if (hours >= 6 && hours <= 9) {
      h = hours;      // AM — already correct
    } else {
      // 10, 11, 12 — assume PM context unless clearly AM
      h = hours < 12 ? hours + 12 : hours; // 10→22, 11→23, 12→12
      // 22/23 would be 10pm/11pm — clamp to reasonable business hours
      if (h > 20) h = hours; // fall back to AM (10am, 11am)
    }
    return `${String(h).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
  }

  // ────────────────────────────────────────────
  // DESCRIPTION PARSER
  // ────────────────────────────────────────────

  function _parseDescription(text, lines) {
    const jobKeywords = [
      'spring', 'opener', 'cable', 'panel', 'sensor', 'door', 'garage',
      'broken', 'stuck', 'not working', 'replace', 'install', 'repair',
      'off track', 'noisy', 'motor', 'remote', 'keypad', 'torsion',
      'extension', 'roller', 'hinge', 'weatherstrip', 'bottom seal',
    ];

    const lower = text.toLowerCase();
    const foundKeywords = jobKeywords.filter(kw => lower.includes(kw));

    if (foundKeywords.length === 0) return { value: '', confidence: 'low' };

    // Find the line(s) with job description keywords
    const descLines = lines.filter(line => {
      const ll = line.toLowerCase();
      return jobKeywords.some(kw => ll.includes(kw));
    });

    if (descLines.length > 0) {
      const desc = descLines.slice(0, 3).join(' — ').trim();
      return { value: _titleCase(desc), confidence: 'high' };
    }

    return { value: foundKeywords.join(', '), confidence: 'medium' };
  }

  // ────────────────────────────────────────────
  // EMPTY RESULT
  // ────────────────────────────────────────────

  function _emptyResult() {
    return {
      customerName:  { value: '', confidence: 'low' },
      phone:         { value: '', confidence: 'low' },
      address:       { value: '', confidence: 'low' },
      city:          { value: '', confidence: 'low' },
      state:         { value: '', confidence: 'low' },
      zip:           { value: '', confidence: 'low' },
      scheduledDate: { value: '', confidence: 'low' },
      scheduledTime: { value: '', confidence: 'low' },
      description:   { value: '', confidence: 'low' },
    };
  }

  // ────────────────────────────────────────────
  // CONFIDENCE LABEL helper
  // ────────────────────────────────────────────
  // Returns CSS class string for the confidence badge

  function confidenceClass(level) {
    return level === 'high' ? 'conf-high' : level === 'medium' ? 'conf-medium' : 'conf-low';
  }

  function confidenceLabel(level) {
    return level === 'high' ? 'Auto' : level === 'medium' ? 'Check' : 'Manual';
  }

  // ────────────────────────────────────────────
  // PHONE FORMAT UTILITY (public)
  // ────────────────────────────────────────────

  function formatPhone(raw) {
    if (!raw) return '';
    return _formatPhone(raw);
  }

  return {
    parse,
    formatPhone,
    confidenceClass,
    confidenceLabel,
    dateToStr: _dateToStr,
  };

})();
