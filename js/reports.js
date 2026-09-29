/* ============================================================
   REPORTS.JS — the numbers behind the business, computed from the job list.
   Pure compute (testable in node) + a renderer for the Reports tab.
   Attribution rules, in plain words:
     - money, jobs done, avg ticket, parts, tech pay:  PAID jobs, by the day they were paid
     - lost:                                           by the day they were marked lost
     - leads (new jobs):                               by the day they were created
     - close rate = done / (done + lost) in the period
     - "right now" tiles are a snapshot of today, not the period
   ============================================================ */

const Reports = (() => {

  const PRESETS = [
    { id: 'today',      label: 'Today' },
    { id: 'week',       label: 'This week' },
    { id: 'month',      label: 'This month' },
    { id: 'last_month', label: 'Last month' },
    { id: '90d',        label: '90 days' },
    { id: 'year',       label: 'This year' },
    { id: 'all',        label: 'All time' },
  ];

  const TABS = [
    { id: 'tech',   label: 'Tech' },
    { id: 'source', label: 'Company' },
    { id: 'type',   label: 'Job type' },
    { id: 'lost',   label: 'Lost why' },
    { id: 'dispatcher', label: 'Booked by' },
    { id: 'month',  label: 'Months' },
    { id: 'pay',    label: 'Paid by' },
  ];

  // ── dates as YYYY-MM-DD strings (compare as text) ──
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parse(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function dayOf(ts) { return ts ? String(ts).slice(0, 10) : ''; }

  // Sunday-start week, like the dashboard.
  function range(presetId, today, custom) {
    const t = parse(today);
    if (presetId === 'custom' && custom && custom.from && custom.to) return { from: custom.from, to: custom.to, label: fmtDay(custom.from) + ' – ' + fmtDay(custom.to) };
    if (presetId === 'today')      return { from: today, to: today, label: 'Today' };
    if (presetId === 'week')       { const s = new Date(t); s.setDate(t.getDate() - t.getDay()); return { from: iso(s), to: today, label: 'This week' }; }
    if (presetId === 'last_month') { const s = new Date(t.getFullYear(), t.getMonth() - 1, 1); const e = new Date(t.getFullYear(), t.getMonth(), 0); return { from: iso(s), to: iso(e), label: 'Last month' }; }
    if (presetId === '90d')        return { from: addDays(today, -89), to: today, label: 'Last 90 days' };
    if (presetId === 'year')       return { from: t.getFullYear() + '-01-01', to: today, label: 'This year' };
    if (presetId === 'all')        return { from: '2000-01-01', to: today, label: 'All time' };
    /* month */                    return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: today, label: 'This month' };
  }
  function inRange(day, r) { return !!day && day >= r.from && day <= r.to; }

  // The day a job counts on, per its outcome.
  function paidDay(j) { return dayOf(j.paidAt) || j.scheduledDate || dayOf(j.createdAt); }
  function lostDay(j) { return dayOf(j.lostAt) || dayOf(j.updatedAt) || j.scheduledDate || dayOf(j.createdAt); }
  function leadDay(j) { return dayOf(j.createdAt) || j.scheduledDate; }

  function calc(j, settings) {
    if (typeof PayoutEngine === 'undefined') {
      const total = +j.jobTotal || 0, parts = Math.min(+j.partsCost || 0, total);
      const net = total - parts, tech = net * ((+j.techPercent || 0) / 100), fee = net * ((+j.contractorPct || 0) / 100);
      return { jobTotal: total, partsCost: parts, netAfterParts: net, techPayout: tech, contractorFee: fee, ownerPayout: Math.max(0, net - tech - fee) };
    }
    return PayoutEngine.calculate({
      jobTotal: j.jobTotal || 0, partsCost: j.partsCost || 0, techPercent: j.techPercent || 0,
      contractorPct: j.contractorPct || 0, taxOption: j.taxOption || 'none', isSelfAssigned: !!j.isSelfAssigned,
      taxRateNY: (settings && settings.taxRateNY) || 8.875, taxRateNJ: (settings && settings.taxRateNJ) || 6.625,
    });
  }
  // What he keeps: the owner cut, plus the tech cut on jobs he did himself (same rule as the home screen).
  function profitOf(j, c) { return (c.ownerPayout || 0) + ((j.isSelfAssigned === true || j.isSelfAssigned === 'true') ? (c.techPayout || 0) : 0); }

  function techKey(j)  { return j.assignedTechId || ('name:' + String(j.assignedTechName || '').trim().toLowerCase()); }
  function techName(j) { return String(j.assignedTechName || '').trim() || 'No tech'; }
  function sourceName(j) { return (!j.source || j.source === 'my_lead') ? 'My leads' : j.source; }

  function newRow(key, name) {
    return { key, name, done: 0, lost: 0, leads: 0, revenue: 0, parts: 0, labor: 0, techPay: 0, fees: 0, profit: 0, doneIds: [], lostIds: [], leadIds: [] };
  }
  function finishRow(r) {
    const decided = r.done + r.lost;
    r.closeRate = decided ? Math.round(r.done / decided * 100) : null;
    r.avgTicket = r.done ? r.revenue / r.done : 0;
    return r;
  }
  function bump(map, key, name, kind, j, c) {
    const r = map[key] || (map[key] = newRow(key, name));
    if (kind === 'done') {
      r.done++; r.revenue += c.jobTotal; r.parts += c.partsCost; r.labor += c.netAfterParts;
      r.techPay += c.techPayout; r.fees += c.contractorFee; r.profit += profitOf(j, c); r.doneIds.push(j.jobId);
    } else if (kind === 'lost') { r.lost++; r.lostIds.push(j.jobId); }
    else if (kind === 'lead') { r.leads++; r.leadIds.push(j.jobId); }
  }
  function sortRows(map, by) { return Object.values(map).map(finishRow).sort((a, b) => (b[by] || 0) - (a[by] || 0) || (b.done - a.done) || (b.lost - a.lost)); }

  /**
   * compute(jobs, opts) → everything the Reports tab shows.
   * opts: { range:{from,to,label}, today, settings, tech, source, type }
   */
  function compute(jobs, opts) {
    const r = opts.range, today = opts.today, settings = opts.settings || {};
    const P = (typeof Pipeline !== 'undefined') ? Pipeline : null;
    const typeName = id => (P ? P.typeName(id, settings) : id) || 'No type';
    const reasonName = id => (P ? P.reasonName(id, settings) : id) || 'No reason';

    // Optional filters (apply to everything, including the snapshot).
    let all = jobs.filter(j => j && j.jobId);
    if (opts.tech)   all = all.filter(j => techKey(j) === opts.tech);
    if (opts.source) all = all.filter(j => (j.source || 'my_lead') === opts.source);
    if (opts.type)   all = all.filter(j => (j.jobType || '') === opts.type);

    const paid = all.filter(j => j.status === 'paid' && inRange(paidDay(j), r));
    const lost = all.filter(j => j.status === 'lost' && inRange(lostDay(j), r));
    const leads = all.filter(j => inRange(leadDay(j), r));

    const k = { revenue: 0, parts: 0, labor: 0, techPay: 0, fees: 0, profit: 0, tax: 0, done: paid.length, lost: lost.length, leads: leads.length };
    const byTech = {}, bySource = {}, byType = {}, byLost = {}, byDisp = {}, byPay = {};
    paid.forEach(j => {
      const c = calc(j, settings);
      k.revenue += c.jobTotal; k.parts += c.partsCost; k.labor += c.netAfterParts; k.techPay += c.techPayout; k.fees += c.contractorFee; k.profit += profitOf(j, c); k.tax += (c.taxAmount || 0);
      bump(byTech, techKey(j), techName(j), 'done', j, c);
      bump(bySource, j.source || 'my_lead', sourceName(j), 'done', j, c);
      bump(byType, j.jobType || '', typeName(j.jobType), 'done', j, c);
      bump(byDisp, j.createdByName || '', j.createdByName || 'Unknown', 'done', j, c);
      bump(byPay, j.paymentMethod || 'cash', cap(j.paymentMethod || 'cash'), 'done', j, c);
    });
    lost.forEach(j => {
      const c = { jobTotal: 0, partsCost: 0, netAfterParts: 0, techPayout: 0, contractorFee: 0, ownerPayout: 0 };
      bump(byTech, techKey(j), techName(j), 'lost', j, c);
      bump(bySource, j.source || 'my_lead', sourceName(j), 'lost', j, c);
      bump(byType, j.jobType || '', typeName(j.jobType), 'lost', j, c);
      bump(byDisp, j.createdByName || '', j.createdByName || 'Unknown', 'lost', j, c);
      const row = byLost[j.lostReason || ''] || (byLost[j.lostReason || ''] = Object.assign(newRow(j.lostReason || '', reasonName(j.lostReason)), { atRisk: 0 }));
      row.lost++; row.lostIds.push(j.jobId); row.atRisk += (+j.estimatedTotal || 0);
    });
    leads.forEach(j => {
      const c = { jobTotal: 0, partsCost: 0, netAfterParts: 0, techPayout: 0, contractorFee: 0, ownerPayout: 0 };
      bump(byDisp, j.createdByName || '', j.createdByName || 'Unknown', 'lead', j, c);
      bump(bySource, j.source || 'my_lead', sourceName(j), 'lead', j, c);
    });
    const decided = k.done + k.lost;
    k.closeRate = decided ? Math.round(k.done / decided * 100) : null;
    k.avgTicket = k.done ? k.revenue / k.done : 0;
    k.margin = k.revenue ? Math.round(k.profit / k.revenue * 100) : null;

    // Snapshot of right now (not period-bound).
    const open = all.filter(j => P ? P.isOpen(j) : ['new', 'scheduled', 'in_progress'].includes(j.status));
    const now = {
      open: open.length,
      estimates: all.filter(j => j.status === 'follow_up').length,
      estimateValue: all.filter(j => j.status === 'follow_up').reduce((s, j) => s + (+j.estimatedTotal || 0), 0),
      overdue: open.filter(j => j.scheduledDate && j.scheduledDate < today).length,
      undispatched: open.filter(j => j.scheduledDate && !j.dispatchedAt && j.scheduledDate >= today).length,
      reviewAsked: paid.filter(j => j.reviewRequestedAt).length,
    };

    // Monthly trend: the last 6 months (independent of the range and filters other than tech/source/type).
    const months = [];
    const t = parse(today);
    for (let i = 5; i >= 0; i--) {
      const s = new Date(t.getFullYear(), t.getMonth() - i, 1);
      const from = iso(s), to = iso(new Date(s.getFullYear(), s.getMonth() + 1, 0));
      const mr = { from, to };
      const mp = all.filter(j => j.status === 'paid' && inRange(paidDay(j), mr));
      const ml = all.filter(j => j.status === 'lost' && inRange(lostDay(j), mr));
      let rev = 0, prof = 0;
      mp.forEach(j => { const c = calc(j, settings); rev += c.jobTotal; prof += profitOf(j, c); });
      months.push({ key: from.slice(0, 7), name: s.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), done: mp.length, lost: ml.length, revenue: rev, profit: prof,
        avgTicket: mp.length ? rev / mp.length : 0, closeRate: (mp.length + ml.length) ? Math.round(mp.length / (mp.length + ml.length) * 100) : null, doneIds: mp.map(j => j.jobId), lostIds: ml.map(j => j.jobId) });
    }

    return {
      range: r, kpis: k, now,
      byTech: sortRows(byTech, 'revenue'), bySource: sortRows(bySource, 'revenue'), byType: sortRows(byType, 'revenue'),
      byLost: Object.values(byLost).sort((a, b) => b.lost - a.lost), byDispatcher: sortRows(byDisp, 'done'),
      byMonth: months, byPay: sortRows(byPay, 'revenue'),
      ids: { done: paid.map(j => j.jobId), lost: lost.map(j => j.jobId), leads: leads.map(j => j.jobId) },
    };
  }

  // ── formatting ──
  function cap(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }
  function money(n) { return '$' + (Math.round(n || 0)).toLocaleString('en-US'); }
  function money2(n) { return '$' + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pct(n) { return n == null ? '—' : n + '%'; }
  function fmtDay(s) { if (!s) return ''; const d = parse(s); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // ── UI state (remembered per device) ──
  let _s = { preset: 'month', from: '', to: '', tech: '', source: '', type: '', tab: 'tech' };
  try { Object.assign(_s, JSON.parse(localStorage.getItem('op_reports') || '{}')); } catch (_) {}
  function _save() { try { localStorage.setItem('op_reports', JSON.stringify(_s)); } catch (_) {} }
  let _last = null;   // last computed result, for exports and drilldowns

  function todayStr() { return iso(new Date()); }

  function set(k, v) { _s[k] = v; if (k === 'preset' && v !== 'custom') { _s.from = ''; _s.to = ''; } _save(); render(); }
  function setCustom() {
    const f = document.getElementById('rp-from')?.value, t = document.getElementById('rp-to')?.value;
    if (!f || !t) return; _s.from = f <= t ? f : t; _s.to = f <= t ? t : f; _s.preset = 'custom'; _save(); render();
  }

  function render(container) {
    const el = container || document.getElementById('reports-dashboard');
    if (!el) return;
    if (typeof Auth !== 'undefined' && !Auth.isAdmin()) { el.innerHTML = ''; return; }
    const settings = DB.getSettings();
    const today = todayStr();
    const r = range(_s.preset, today, { from: _s.from, to: _s.to });
    const jobs = DB.getJobs();
    const res = compute(jobs, { range: r, today, settings, tech: _s.tech, source: _s.source, type: _s.type });
    _last = res;
    const k = res.kpis, n = res.now;

    const techOpts = {}; jobs.forEach(j => { if (j.assignedTechName || j.assignedTechId) techOpts[techKey(j)] = techName(j); });
    const sourceOpts = {}; jobs.forEach(j => { sourceOpts[j.source || 'my_lead'] = sourceName(j); });
    const types = (typeof Pipeline !== 'undefined') ? Pipeline.jobTypes(settings) : [];

    const tiles = [
      { label: 'Collected', value: money(k.revenue), sub: `${k.done} job${k.done === 1 ? '' : 's'} paid`, cls: 'rp-t-rev' },
      { label: 'You keep', value: money(k.profit), sub: k.margin == null ? '—' : k.margin + '% of collected', cls: 'rp-t-profit' },
      { label: 'Avg ticket', value: money(k.avgTicket), sub: 'per paid job', cls: '' },
      { label: 'Close rate', value: pct(k.closeRate), sub: `${k.done} won · ${k.lost} lost`, cls: '' },
      { label: 'Tech pay', value: money(k.techPay), sub: `parts ${money(k.parts)}`, cls: '' },
      { label: 'Company fees', value: money(k.fees), sub: 'paid to lead companies', cls: '' },
    ];
    const rowsHTML = _tabRows(res, settings);

    el.innerHTML = `
      <div class="rp">
        <div class="rp-presets">
          ${PRESETS.map(p => `<button class="rp-chip${_s.preset === p.id ? ' on' : ''}" onclick="Reports.set('preset','${p.id}')">${p.label}</button>`).join('')}
          <button class="rp-chip${_s.preset === 'custom' ? ' on' : ''}" onclick="document.getElementById('rp-custom').classList.toggle('hidden')">Custom</button>
        </div>
        <div id="rp-custom" class="rp-custom${_s.preset === 'custom' ? '' : ' hidden'}">
          <input type="date" id="rp-from" class="field-input" value="${esc(_s.from || r.from)}" onchange="Reports.setCustom()">
          <span>to</span>
          <input type="date" id="rp-to" class="field-input" value="${esc(_s.to || r.to)}" onchange="Reports.setCustom()">
        </div>
        <div class="rp-filters">
          <select class="balance-select" onchange="Reports.set('tech',this.value)"><option value="">All techs</option>${Object.entries(techOpts).sort((a, b) => a[1].localeCompare(b[1])).map(([k2, v]) => `<option value="${esc(k2)}"${_s.tech === k2 ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
          <select class="balance-select" onchange="Reports.set('source',this.value)"><option value="">All companies</option>${Object.entries(sourceOpts).map(([k2, v]) => `<option value="${esc(k2)}"${_s.source === k2 ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
          <select class="balance-select" onchange="Reports.set('type',this.value)"><option value="">All types</option>${types.map(t => `<option value="${esc(t.id)}"${_s.type === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        </div>
        <div class="rp-period">${esc(r.label)}${_s.preset === 'all' ? '' : ' · ' + esc(fmtDay(r.from)) + ' – ' + esc(fmtDay(r.to))}</div>

        <div class="rp-tiles">
          ${tiles.map((t, i) => `<div class="rp-tile ${t.cls}" ${i < 2 ? `onclick="Reports.drill('done')"` : ''}><div class="rp-tile-label">${t.label}</div><div class="rp-tile-value">${t.value}</div><div class="rp-tile-sub">${esc(t.sub)}</div></div>`).join('')}
        </div>

        <div class="rp-now">
          <div class="rp-now-title">Right now</div>
          <div class="rp-now-row">
            <div onclick="App.navigate('jobs',{filter:'open'})"><b>${n.open}</b><span>open</span></div>
            <div onclick="App.navigate('jobs',{filter:'estimate'})"><b>${n.estimates}</b><span>estimates${n.estimateValue ? ' · ' + money(n.estimateValue) : ''}</span></div>
            <div class="${n.overdue ? 'rp-bad' : ''}" onclick="App.navigate('dashboard')"><b>${n.overdue}</b><span>overdue</span></div>
            <div class="${n.undispatched ? 'rp-warn' : ''}" onclick="App.navigate('dashboard')"><b>${n.undispatched}</b><span>not dispatched</span></div>
          </div>
        </div>

        <div class="rp-tabs">${TABS.map(t => `<button class="rp-tab${_s.tab === t.id ? ' on' : ''}" onclick="Reports.set('tab','${t.id}')">${t.label}</button>`).join('')}</div>
        <div class="rp-table">${rowsHTML}</div>

        <div class="rp-export">
          <button class="btn btn-secondary" onclick="Reports.copy()">Copy</button>
          <button class="btn btn-secondary" onclick="Reports.whatsapp()">WhatsApp</button>
          <button class="btn btn-secondary" onclick="Reports.pdf()">PDF</button>
          <button class="btn btn-secondary" onclick="Reports.csv()">CSV</button>
        </div>
      </div>`;
  }

  function _tabRows(res, settings) {
    const tab = _s.tab;
    const head = (cols) => `<div class="rp-row rp-head">${cols.map(c => `<span>${c}</span>`).join('')}</div>`;
    const bar = (v, max) => `<i class="rp-bar"><b style="width:${max ? Math.round(v / max * 100) : 0}%"></b></i>`;
    if (tab === 'lost') {
      const rows = res.byLost; const max = Math.max(1, ...rows.map(x => x.lost));
      if (!rows.length) return '<div class="rp-empty">No lost jobs in this period.</div>';
      return head(['Why lost', 'Jobs', 'Quoted $']) + rows.map(x => `<div class="rp-row" onclick="Reports.drillRow('byLost','${esc(x.key)}','lost')"><span class="rp-name">${esc(x.name)}${bar(x.lost, max)}</span><span>${x.lost}</span><span>${x.atRisk ? money(x.atRisk) : '—'}</span></div>`).join('');
    }
    if (tab === 'month') {
      const rows = res.byMonth; const max = Math.max(1, ...rows.map(x => x.revenue));
      return head(['Month', 'Collected', 'You keep', 'Done / lost']) + rows.map(x => `<div class="rp-row" onclick="Reports.drillRow('byMonth','${esc(x.key)}','done')"><span class="rp-name">${esc(x.name)}${bar(x.revenue, max)}</span><span>${money(x.revenue)}</span><span>${money(x.profit)}</span><span>${x.done} / ${x.lost}${x.closeRate != null ? ' · ' + x.closeRate + '%' : ''}</span></div>`).join('');
    }
    if (tab === 'pay') {
      const rows = res.byPay; const max = Math.max(1, ...rows.map(x => x.revenue));
      if (!rows.length) return '<div class="rp-empty">No paid jobs in this period.</div>';
      return head(['Paid by', 'Collected', 'Jobs']) + rows.map(x => `<div class="rp-row" onclick="Reports.drillRow('byPay','${esc(x.key)}','done')"><span class="rp-name">${esc(x.name)}${bar(x.revenue, max)}</span><span>${money(x.revenue)}</span><span>${x.done}</span></div>`).join('');
    }
    if (tab === 'dispatcher') {
      const rows = res.byDispatcher;
      if (!rows.length) return '<div class="rp-empty">Nothing booked in this period.</div>';
      return head(['Booked by', 'Leads', 'Done', 'Close']) + rows.map(x => `<div class="rp-row" onclick="Reports.drillRow('byDispatcher','${esc(x.key)}','done')"><span class="rp-name">${esc(x.name)}</span><span>${x.leads}</span><span>${x.done}</span><span>${pct(x.closeRate)}</span></div>`).join('');
    }
    const key = tab === 'source' ? 'bySource' : tab === 'type' ? 'byType' : 'byTech';
    const rows = res[key]; const max = Math.max(1, ...rows.map(x => x.revenue));
    if (!rows.length) return '<div class="rp-empty">Nothing in this period.</div>';
    const first = tab === 'source' ? 'Company' : tab === 'type' ? 'Job type' : 'Tech';
    return head([first, 'Collected', 'Avg', 'Close']) + rows.map(x =>
      `<div class="rp-row" onclick="Reports.drillRow('${key}','${esc(x.key)}','done')"><span class="rp-name">${esc(x.name)}${bar(x.revenue, max)}</span><span>${money(x.revenue)}<small>keep ${money(x.profit)}</small></span><span>${x.done ? money(x.avgTicket) : '—'}<small>${x.done} done</small></span><span>${pct(x.closeRate)}<small>${x.lost} lost</small></span></div>`).join('');
  }

  // ── drilldowns: the jobs behind a number ──
  function drill(kind) { if (!_last) return; _showJobs(_last.ids[kind] || [], kind === 'done' ? 'Paid jobs' : kind === 'lost' ? 'Lost jobs' : 'Jobs'); }
  function drillRow(listKey, key, kind) {
    if (!_last) return;
    const row = (_last[listKey] || []).find(x => String(x.key) === String(key));
    if (!row) return;
    const ids = kind === 'lost' ? row.lostIds : row.doneIds;
    const alt = kind === 'lost' ? row.doneIds : row.lostIds;
    _showJobs(ids, row.name + (kind === 'lost' ? ' · lost' : ' · paid'), alt && alt.length ? { ids: alt, label: kind === 'lost' ? `Show ${alt.length} paid` : `Show ${alt.length} lost` } : null);
  }
  function _showJobs(ids, title, alt) {
    const titleEl = document.getElementById('customer-history-title');
    const body = document.getElementById('modal-customer-history-body');
    if (!titleEl || !body) return;
    const settings = DB.getSettings();
    const jobs = ids.map(id => DB.getJobById(id)).filter(Boolean);
    titleEl.textContent = `${title} · ${jobs.length}`;
    let total = 0, profit = 0;
    const items = jobs.sort((a, b) => (paidDay(b) || lostDay(b)).localeCompare(paidDay(a) || lostDay(a))).map(j => {
      const c = j.status === 'paid' ? calc(j, settings) : null;
      if (c) { total += c.jobTotal; profit += profitOf(j, c); }
      const line2 = j.status === 'lost'
        ? `${fmtDay(lostDay(j))} · ${esc(typeof Pipeline !== 'undefined' ? Pipeline.reasonName(j.lostReason, settings) || 'no reason' : j.lostReason || '')}${j.lostNote ? ' — ' + esc(j.lostNote) : ''}`
        : `${fmtDay(paidDay(j))} · ${esc(j.assignedTechName || '—')}${c ? ' · keep ' + money(profitOf(j, c)) : ''}`;
      return `<div onclick="App.closeModal();App.openJobDetail('${j.jobId}')" style="background:var(--color-surface-2);border-radius:12px;padding:12px;cursor:pointer;border-left:3px solid ${j.status === 'lost' ? '#e11d48' : '#22c55e'}">
          <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700"><span>${esc(j.customerName || 'Unknown')}</span><span>${c ? money2(c.jobTotal) : (j.estimatedTotal ? 'est ' + money(j.estimatedTotal) : '')}</span></div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px">${line2}</div>
          ${j.description ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(j.description)}</div>` : ''}
        </div>`;
    });
    body.innerHTML = `
      ${total ? `<div style="background:rgba(99,102,241,0.08);border-radius:12px;padding:12px 14px;margin-bottom:12px;display:flex;gap:16px;font-size:12px;color:var(--color-text-muted)"><div><b style="display:block;font-size:18px;color:var(--color-text)">${money(total)}</b>collected</div><div><b style="display:block;font-size:18px;color:var(--color-success)">${money(profit)}</b>you keep</div></div>` : ''}
      ${alt ? `<button class="btn btn-secondary btn-full" style="margin-bottom:10px" onclick="Reports._alt()">${esc(alt.label)}</button>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto">${items.join('') || '<div class="empty-state-sm">No jobs</div>'}</div>`;
    _altIds = alt ? alt.ids : null; _altTitle = title;
    App.showModal('modal-customer-history');
  }
  let _altIds = null, _altTitle = '';
  function _alt() { if (_altIds) _showJobs(_altIds, _altTitle.replace(/ · (paid|lost)$/, '') + (_altTitle.endsWith('lost') ? ' · paid' : ' · lost'), null); }

  // ── exports ──
  function text() {
    if (!_last) return '';
    const k = _last.kpis, r = _last.range;
    const L = [`ON POINT — ${r.label}${_s.preset === 'all' ? '' : ' (' + fmtDay(r.from) + ' – ' + fmtDay(r.to) + ')'}`, '',
      `Collected: ${money2(k.revenue)} (${k.done} jobs)`, `You keep: ${money2(k.profit)}${k.margin != null ? ' (' + k.margin + '%)' : ''}`,
      `Tech pay: ${money2(k.techPay)} · Parts: ${money2(k.parts)} · Company fees: ${money2(k.fees)}`,
      `Avg ticket: ${money2(k.avgTicket)} · Close rate: ${pct(k.closeRate)} (${k.done} won / ${k.lost} lost)`, ''];
    const sec = (title, rows, f) => { if (!rows.length) return; L.push(title.toUpperCase()); rows.slice(0, 12).forEach(x => L.push('  ' + f(x))); L.push(''); };
    sec('By tech', _last.byTech, x => `${x.name}: ${money(x.revenue)} · keep ${money(x.profit)} · ${x.done} done / ${x.lost} lost · avg ${money(x.avgTicket)}`);
    sec('By company', _last.bySource, x => `${x.name}: ${money(x.revenue)} · fees ${money(x.fees)} · ${x.done} done / ${x.lost} lost`);
    sec('By job type', _last.byType, x => `${x.name}: ${money(x.revenue)} · avg ${money(x.avgTicket)} · ${x.done} done / ${x.lost} lost · close ${pct(x.closeRate)}`);
    sec('Why lost', _last.byLost, x => `${x.name}: ${x.lost}${x.atRisk ? ' · quoted ' + money(x.atRisk) : ''}`);
    sec('Months', _last.byMonth, x => `${x.name}: ${money(x.revenue)} · keep ${money(x.profit)} · ${x.done} done / ${x.lost} lost`);
    return L.join('\n');
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text()); App.showToast('Report copied', 'success'); }
    catch (e) { App.showToast('Copy failed', 'error'); }
  }
  function whatsapp() { const t = text(); if (!t) return; window.open(window.waUrl ? window.waUrl('', t) : 'https://wa.me/?text=' + encodeURIComponent(t), '_blank'); }
  function csv() {
    if (!_last) return;
    const rows = [['Section', 'Name', 'Collected', 'You keep', 'Tech pay', 'Parts', 'Fees', 'Done', 'Lost', 'Avg ticket', 'Close rate']];
    const push = (sec, list) => list.forEach(x => rows.push([sec, x.name, (x.revenue || 0).toFixed(2), (x.profit || 0).toFixed(2), (x.techPay || 0).toFixed(2), (x.parts || 0).toFixed(2), (x.fees || 0).toFixed(2), x.done || 0, x.lost || 0, (x.avgTicket || 0).toFixed(2), x.closeRate == null ? '' : x.closeRate]));
    push('Tech', _last.byTech); push('Company', _last.bySource); push('Job type', _last.byType); push('Month', _last.byMonth); push('Paid by', _last.byPay);
    _last.byLost.forEach(x => rows.push(['Lost why', x.name, '', '', '', '', '', 0, x.lost, '', '']));
    const body = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
    a.download = `onpoint-report-${_last.range.from}-to-${_last.range.to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function pdf() {
    if (!_last) return;
    if (!window.jspdf || !window.jspdf.jsPDF) { App.showToast('PDF library still loading — try again', 'warning'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const k = _last.kpis, r = _last.range;
    doc.setFillColor(15, 23, 42); doc.rect(0, 0, W, 64, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.text('On Point — Business Report', 40, 30);
    doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.text(`${r.label} · ${fmtDay(r.from)} – ${fmtDay(r.to)}`, 40, 48);
    doc.setTextColor(15, 23, 42);
    let y = 92;
    const kp = [['Collected', money2(k.revenue)], ['You keep', money2(k.profit) + (k.margin != null ? ` (${k.margin}%)` : '')], ['Jobs done', String(k.done)], ['Avg ticket', money2(k.avgTicket)], ['Close rate', `${pct(k.closeRate)} (${k.done} won / ${k.lost} lost)`], ['Tech pay', money2(k.techPay)], ['Parts', money2(k.parts)], ['Company fees', money2(k.fees)]];
    doc.autoTable({ startY: y, head: [['Metric', 'Value']], body: kp, theme: 'grid', styles: { fontSize: 10 }, headStyles: { fillColor: [15, 23, 42] }, margin: { left: 40, right: 40 } });
    y = doc.lastAutoTable.finalY + 18;
    const table = (title, head, body) => {
      if (!body.length) return;
      if (y > 700) { doc.addPage(); y = 50; }
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.text(title, 40, y); y += 8;
      doc.autoTable({ startY: y, head: [head], body, theme: 'striped', styles: { fontSize: 9 }, headStyles: { fillColor: [15, 23, 42] }, margin: { left: 40, right: 40 } });
      y = doc.lastAutoTable.finalY + 18;
    };
    table('By tech', ['Tech', 'Collected', 'You keep', 'Done', 'Lost', 'Avg ticket', 'Close'], _last.byTech.map(x => [x.name, money2(x.revenue), money2(x.profit), x.done, x.lost, money2(x.avgTicket), pct(x.closeRate)]));
    table('By company', ['Company', 'Collected', 'Fees', 'Done', 'Lost', 'Close'], _last.bySource.map(x => [x.name, money2(x.revenue), money2(x.fees), x.done, x.lost, pct(x.closeRate)]));
    table('By job type', ['Type', 'Collected', 'Avg ticket', 'Done', 'Lost', 'Close'], _last.byType.map(x => [x.name, money2(x.revenue), money2(x.avgTicket), x.done, x.lost, pct(x.closeRate)]));
    table('Why lost', ['Reason', 'Jobs', 'Quoted'], _last.byLost.map(x => [x.name, x.lost, x.atRisk ? money2(x.atRisk) : '']));
    table('Months', ['Month', 'Collected', 'You keep', 'Done', 'Lost', 'Close'], _last.byMonth.map(x => [x.name, money2(x.revenue), money2(x.profit), x.done, x.lost, pct(x.closeRate)]));
    doc.save(`onpoint-report-${r.from}-to-${r.to}.pdf`);
  }

  return { PRESETS, TABS, range, compute, render, set, setCustom, drill, drillRow, _alt, text, copy, whatsapp, pdf, csv, techKey };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Reports;
if (typeof window !== 'undefined') window.Reports = Reports;
