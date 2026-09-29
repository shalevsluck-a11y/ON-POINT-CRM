/* ============================================================
   PIPELINE.JS — the funnel, job types, lost reasons, follow-up cadence.
   Pure helpers, no DOM. The browser loads it before db.js; node tests
   require() it. Stages are DERIVED from job fields — job.status keeps
   its 7 values (new/scheduled/in_progress/follow_up/closed/paid/lost).
   ============================================================ */

const Pipeline = (() => {

  // Funnel order for the board and the reports. Estimates and Lost are side exits.
  const STAGES = [
    { id: 'lead',       label: 'Leads',      hint: 'No date yet' },
    { id: 'booked',     label: 'Booked',     hint: 'Has a date, not sent to a tech yet' },
    { id: 'dispatched', label: 'Dispatched', hint: 'Sent to the tech' },
    { id: 'done',       label: 'Done',       hint: 'Closed or paid' },
    { id: 'estimate',   label: 'Estimates',  hint: 'Quoted, waiting on the customer' },
    { id: 'lost',       label: 'Lost',       hint: 'Did not happen' },
  ];
  const OPEN_STATUSES = ['new', 'scheduled', 'in_progress'];

  function stageOf(job) {
    if (!job) return 'lead';
    const s = job.status;
    if (s === 'lost') return 'lost';
    if (s === 'paid' || s === 'closed') return 'done';
    if (s === 'follow_up') return 'estimate';
    if (s === 'in_progress') return 'dispatched';
    if (s === 'scheduled' || job.scheduledDate) return job.dispatchedAt ? 'dispatched' : 'booked';
    return 'lead';
  }

  function isOpen(job) { return !!job && OPEN_STATUSES.includes(job.status); }

  // The date passed and nobody closed it. today = 'YYYY-MM-DD' (device-local, like App._todayStr).
  function isOverdue(job, today) {
    return isOpen(job) && !!job.scheduledDate && job.scheduledDate < today;
  }

  // ── JOB TYPES ─────────────────────────────────────────────
  // Defaults; Settings can replace the list. Jobs store the id.
  const JOB_TYPES = [
    { id: 'spring',        name: 'Spring' },
    { id: 'opener',        name: 'Opener / motor' },
    { id: 'cable',         name: 'Cable' },
    { id: 'roller',        name: 'Rollers / hinges' },
    { id: 'off_track',     name: 'Off track' },
    { id: 'panel',         name: 'Panel / section' },
    { id: 'new_door',      name: 'New door' },
    { id: 'tune_up',       name: 'Tune-up / inspection' },
    { id: 'remote_keypad', name: 'Remote / keypad / sensor' },
    { id: 'weather_seal',  name: 'Weather seal' },
    { id: 'commercial',    name: 'Commercial / gate' },
    { id: 'chimney',       name: 'Chimney' },
    { id: 'locksmith',     name: 'Locksmith' },
    { id: 'other',         name: 'Other' },
  ];

  // First match wins: trades first, then the specific part, then the generic words.
  const TYPE_RULES = [
    ['chimney',       /chimney|fireplace|flue|creosote|air duct|dryer vent/],
    ['locksmith',     /\block(ed|s|out|outs|smith)?\b|rekey|re-key|deadbolt|\bkeys?\b|safe open/],
    ['commercial',    /commercial|rolling steel|roll[- ]?up|\bgates?\b|storefront|loading dock/],
    ['spring',        /spring/],
    ['cable',         /cable/],
    ['off_track',     /off[- ]?track|off the track|derail|crooked|\btrack\b/],
    ['roller',        /roller|hinge|wheel/],
    ['panel',         /panel|section|dent/],
    ['new_door',      /new (garage |black |white |steel )?door|replace\b.*\bdoors?\b|door replacement|door install|install\b.*\bdoors?\b|(\b\d+|two|both|three) doors\b/],
    ['opener',        /opener|motor|liftmaster|chamberlain|genie|belt drive|chain drive|logic board|circuit board|wall button/],
    ['remote_keypad', /remote|keypad|clicker|sensor|photo ?eye|\beyes?\b|safety beam|program/],
    ['weather_seal',  /weather|\bseal\b|rubber|astragal|bottom strip|gap/],
    ['tune_up',       /tune|maintenance|inspection|lube|lubric|noisy|noise|adjust|service call|check ?up|won'?t (open|close)|doesn'?t (open|close)|not (opening|closing)|stuck/],
  ];

  // Best-guess type id from free text, '' when nothing matches (never guess 'other').
  function guessType(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return '';
    for (const [id, re] of TYPE_RULES) if (re.test(t)) return id;
    return '';
  }

  // ── LOST REASONS ──────────────────────────────────────────
  const LOST_REASONS = [
    { id: 'no_answer',   name: 'No answer / ghosted' },
    { id: 'price',       name: 'Price too high' },
    { id: 'competitor',  name: 'Went with someone else' },
    { id: 'diy',         name: 'Fixed it themselves' },
    { id: 'no_tech',     name: 'No tech available / no-show' },
    { id: 'cancelled',   name: 'Customer cancelled' },
    { id: 'out_of_area', name: 'Out of area' },
    { id: 'duplicate',   name: 'Duplicate / spam' },
    { id: 'other',       name: 'Other' },
  ];

  const REASON_RULES = [
    ['no_answer',   /no answer|no reply|ghost|didn'?t (pick|answer|respond)|not answering|unreachable|voicemail|stopped responding/],
    ['price',       /price|expensive|too much|cheaper|budget|cost/],
    ['competitor',  /someone else|another (company|guy)|competitor|went with|already (fixed|hired|done)|found another/],
    ['diy',         /themselves|himself|herself|diy|fixed it (him|her|them)self|on (his|her|their) own/],
    ['no_tech',     /no tech|no one (available|to send)|couldn'?t cover|no[- ]show|tech (never|didn'?t) (show|come)|nobody (came|showed)/],
    ['cancelled',   /cancel|changed (his|her|their) mind|not interested anymore|no longer need/],
    ['out_of_area', /out of (our )?area|too far|don'?t (service|cover)|not in (our|the) area|wrong (state|city)/],
    ['duplicate',   /duplicate|spam|test|wrong number|fake/],
  ];

  // Pointy passes free text ("price too high"); map it to a reason id, 'other' as the fallback.
  function reasonFromText(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return '';
    for (const [id, re] of REASON_RULES) if (re.test(t)) return id;
    return 'other';
  }

  // ── FOLLOW-UP CADENCE (estimates) ─────────────────────────
  // Days after the last touch. After the 4th reminder the cadence is exhausted
  // and the job should be won or lost, not nagged forever.
  const FOLLOW_UP_DAYS = [1, 3, 7, 14];

  function addDays(day, n) {
    const [y, m, d] = String(day).split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }

  // Next reminder day after `fromDay`, given how many reminders were already sent. '' = stop.
  function nextFollowUpDay(fromDay, count) {
    const gap = FOLLOW_UP_DAYS[Math.max(0, parseInt(count, 10) || 0)];
    if (!gap || !/^\d{4}-\d{2}-\d{2}$/.test(String(fromDay))) return '';
    return addDays(fromDay, gap);
  }

  // An estimate whose reminder day is today or earlier (or was never set).
  function followUpDue(job, today) {
    if (!job || job.status !== 'follow_up') return false;
    const day = (job.followUpAt || '').slice(0, 10);
    return !day || day <= today;
  }

  // ── LISTS FROM SETTINGS (with defaults) ───────────────────
  function jobTypes(settings)    { const l = settings && settings.jobTypes;    return Array.isArray(l) && l.length ? l : JOB_TYPES; }
  function lostReasons(settings) { const l = settings && settings.lostReasons; return Array.isArray(l) && l.length ? l : LOST_REASONS; }
  function typeName(id, settings)   { if (!id) return ''; const t = jobTypes(settings).find(x => x.id === id);    return t ? t.name : id; }
  function reasonName(id, settings) { if (!id) return ''; const r = lostReasons(settings).find(x => x.id === id); return r ? r.name : id; }
  function stageLabel(id) { const s = STAGES.find(x => x.id === id); return s ? s.label : id; }

  return {
    STAGES, OPEN_STATUSES, JOB_TYPES, LOST_REASONS, FOLLOW_UP_DAYS,
    stageOf, stageLabel, isOpen, isOverdue,
    guessType, reasonFromText,
    addDays, nextFollowUpDay, followUpDue,
    jobTypes, lostReasons, typeName, reasonName,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Pipeline;
if (typeof window !== 'undefined') window.Pipeline = Pipeline;
