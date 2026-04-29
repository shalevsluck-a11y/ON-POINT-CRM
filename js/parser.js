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
    // 1) Labeled name: "Name: John Smith" / "Customer: ..." / "Contact: ..."
    //    Allow apostrophes, hyphens, ALL CAPS, lowercase, mixed.
    const labelRe = /(?:customer(?:\s+name)?|client|name|contact|caller|homeowner)[:\-\s]+([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,4})/i;
    const lm = text.match(labelRe);
    if (lm) {
      const name = lm[1].trim().replace(/\s+/g, ' ');
      if (_isPlausibleName(name)) return { value: _titleCase(name), confidence: 'high' };
    }

    // 2) Scan ALL lines (not just first 3). Skip lines that look like other fields.
    //    Score each candidate; prefer earlier lines and label-free pure-name lines.
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (_looksLikePhone(line))   continue;
      if (_looksLikeAddress(line)) continue;
      if (_looksLikeZipOrState(line)) continue;
      if (_looksLikeEmail(line))   continue;
      if (_looksLikeUrl(line))     continue;
      if (_looksLikeDateOrTime(line)) continue;
      if (_looksLikeJobDesc(line)) continue;

      // Strip common label prefixes ("Mr.", "Mrs.", "Ms.", "Dr.")
      const stripped = line.replace(/^(?:mr|mrs|ms|dr|miss)\.?\s+/i, '');
      // Allow letters, spaces, apostrophes, hyphens, periods (initials).
      const clean = stripped.replace(/[^A-Za-z'\-\.\s]/g, '').replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      const words = clean.split(/\s+/).filter(Boolean);
      if (words.length < 1 || words.length > 5) continue;
      // Each word must be alphabetic (allow apostrophe/hyphen/period)
      if (!words.every(w => /^[A-Za-z][A-Za-z'\-\.]*$/.test(w))) continue;
      if (!_isPlausibleName(clean)) continue;

      // Score: shorter line + earlier position + 2-3 words = better
      let score = 100;
      score -= i * 10;                          // earlier lines preferred
      if (words.length === 2) score += 30;      // first + last typical
      if (words.length === 3) score += 15;
      if (words.length === 1) score -= 20;      // single-word names rarer
      if (clean.length === line.length) score += 10; // pure (no stripped chars)
      // Penalize ALL CAPS slightly (still accepted, but lower)
      if (clean === clean.toUpperCase() && clean !== clean.toLowerCase()) score -= 5;
      // Penalize all lowercase slightly
      if (clean === clean.toLowerCase()) score -= 8;

      if (score > bestScore) { bestScore = score; best = clean; }
    }

    if (best) {
      const conf = bestScore >= 100 ? 'high' : bestScore >= 60 ? 'medium' : 'low';
      return { value: _titleCase(best), confidence: conf };
    }

    return { value: '', confidence: 'low' };
  }

  // ─── helpers used by name parser to skip non-name lines ───
  function _looksLikePhone(line) {
    const digits = line.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 11) {
      // Has parens/dashes typical of phone, OR is mostly digits
      if (/[\(\)\-\.]/.test(line) || /\b\d{10,11}\b/.test(line)) return true;
      const nonDigit = line.replace(/[\d\s\-\.\(\)\+]/g, '');
      if (nonDigit.length <= 2) return true;
    }
    return false;
  }
  function _looksLikeAddress(line) {
    // House number followed by street word
    return /^\s*\d{1,6}\s+\S+/.test(line) && !/^\d{5}(-\d{4})?\s*$/.test(line.trim());
  }
  function _looksLikeZipOrState(line) {
    const t = line.trim();
    if (/^\d{5}(-\d{4})?$/.test(t)) return true;
    if (/^[A-Z]{2}$/.test(t)) return true;
    // City, ST ZIP
    if (/[A-Za-z],?\s*[A-Z]{2}\s+\d{5}/.test(t)) return true;
    return false;
  }
  function _looksLikeEmail(line) { return /\S+@\S+\.\S+/.test(line); }
  function _looksLikeUrl(line)   { return /https?:\/\/|www\./i.test(line); }
  function _looksLikeDateOrTime(line) {
    if (/\b\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\b/.test(line)) return true;
    if (/\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(line)) return true;
    if (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(line)) return true;
    if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d/i.test(line)) return true;
    return false;
  }
  function _looksLikeJobDesc(line) {
    const kws = ['spring','opener','cable','panel','sensor','garage door','broken','stuck','off track','torsion','keypad','remote','motor','roller','hinge','noisy','replace','install','repair','not working'];
    const ll = line.toLowerCase();
    return kws.some(k => ll.includes(k));
  }

  // Words that should never be treated as a person's name
  const _NAME_BLOCKLIST = new Set([
    'sunday','monday','tuesday','wednesday','thursday','friday','saturday',
    'january','february','march','april','may','june','july','august',
    'september','october','november','december',
    'today','tomorrow','morning','afternoon','evening','night','noon',
    'contracting','contractor','contractors','construction','services',
    'service','company','group','associates','enterprises','management',
    'llc','inc','corp','co','ltd',
    // Field labels — never a name even if they appear bare
    'name','customer','client','contact','phone','cell','mobile','tel',
    'address','street','city','state','zip','email',
    // Common job-description nouns
    'garage','door','spring','opener','cable','panel','sensor','remote',
    'keypad','motor','roller','hinge','torsion','extension',
    // Filler
    'new','old','urgent','asap','please','thanks','thank',
  ]);

  function _isPlausibleName(str) {
    if (!str) return false;
    if (/\d/.test(str)) return false;
    // Strip apostrophes/hyphens/periods for word splitting (counts O'Brien as one word)
    const words = str.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 5 || str.length < 2) return false;
    // Reject if ANY word is a known non-name term
    if (words.some(w => _NAME_BLOCKLIST.has(w.toLowerCase().replace(/[\.\-']/g,'')))) return false;
    // At least one word must be 2+ letters (avoid single-letter junk)
    if (!words.some(w => w.replace(/[\.\-']/g,'').length >= 2)) return false;
    return true;
  }

  function _titleCase(str) {
    // Capitalize after start, whitespace, hyphen, or apostrophe (handles O'Brien, Smith-Jones, Mary Anne)
    return str.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }

  // ────────────────────────────────────────────
  // PHONE PARSER
  // ────────────────────────────────────────────

  function _parsePhone(text) {
    // Match: (516) 555-1234, 516-555-1234, 5165551234, +15165551234
    // IMPORTANT: Only match 10-digit phone numbers, NOT 5-digit ZIPs
    const patterns = [
      /(?:phone|cell|mobile|tel|call)[:\s#]*([\+1]?\s*\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/i,
      /\b(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})\b/,
      /\b(\d{10})\b/,
      /\b(\+1\d{10})\b/,
    ];

    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        const raw = m[1];
        // Skip if this looks like a ZIP code (exactly 5 digits with no separators)
        const digitsOnly = raw.replace(/\D/g, '');
        if (digitsOnly.length === 5) continue;

        const phone = _formatPhone(raw);
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
      // Skip lines that look like phone numbers (contain parentheses or dashes with digits)
      if (/\(\d{3}\)|\d{3}[\-\.]\d{3}[\-\.]\d{4}/.test(line)) continue;

      if (/^\d+\s+/.test(line) && line.length < 80) {
        // Remove city/state/zip from the line first
        const addr = line.replace(/,?\s*[A-Z]{2}\s+\d{5}(-\d{4})?$/, '')
                        .replace(/,?\s*(?:NY|NJ|CT|PA|FL|TX|CA|MA|GA|OH|MI|IN)\b/gi, '')
                        .trim();

        // Reject lines that are phone numbers.
        // A phone number has 7–11 digits and almost no non-digit, non-separator chars.
        // Real house numbers have at most 5 digits and are surrounded by street words.
        const digitsOnly     = addr.replace(/\D/g, '');
        const nonDigitNonSep = addr.replace(/[\d\s\-\.\(\)\+]/g, '');
        if (digitsOnly.length >= 7 && digitsOnly.length <= 11 && nonDigitNonSep.length <= 2) continue;

        // Also reject if it's just 5 digits (ZIP code)
        if (digitsOnly.length === 5 && nonDigitNonSep.length === 0) continue;

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
        try {
          if (new RegExp(`\\b${esc}\\b`, 'i').test(text)) {
            return { value: abbr, confidence: 'high' };
          }
        } catch (_) {
          if (text.toLowerCase().includes(name.toLowerCase())) {
            return { value: abbr, confidence: 'high' };
          }
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
