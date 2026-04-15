/* ============================================================
   APP.JS — On Point Home Services
   Main application: router, all views, all logic, all handlers
   ============================================================ */

const App = (() => {

  // ══════════════════════════════════════════════════════════
  // STATE
  // ══════════════════════════════════════════════════════════

  let _state = {
    currentView:    'dashboard',
    previousView:   null,
    currentStep:    1,
    currentJobId:   null,   // job detail view
    calendarDate:   new Date(),
    jobFilter:      'all',
    jobSearch:      '',
    parsedLead:     null,
    newJobDraft:    {},
    selectedPayMethod: 'cash',
    photoViewerJobId: null,
    photoViewerIdx:  0,
    closeJobId:      null,
    confirmCallback: null,
  };

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════

  function init() {
    // Load settings into form
    _loadSettingsForm();

    // Render dashboard
    renderDashboard();

    // Render job list
    renderJobList();

    // Render tech selector in new job
    _renderTechSelector();

    // Populate lead source dropdown
    _populateSourceDropdown();

    // Check for saved draft
    _checkDraft();

    // Set today's date as default on date field
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const dateField = document.getElementById('f-date');
    if (dateField && !dateField.value) dateField.value = dateStr;

    console.log('On Point Home Services initialized');
  }

  // ══════════════════════════════════════════════════════════
  // NAVIGATION / ROUTER
  // ══════════════════════════════════════════════════════════

  const VIEW_TITLES = {
    'dashboard':  'Dashboard',
    'jobs':       'All Jobs',
    'new-job':    'New Job',
    'calendar':   'Calendar',
    'settings':   'Settings',
    'job-detail': 'Job Detail',
  };

  function navigate(viewName, opts = {}) {
    // Handle special options
    if (opts && opts.filter) {
      _state.jobFilter = opts.filter;
      setJobFilter(opts.filter, null);
    }

    _state.previousView = _state.currentView;
    _state.currentView  = viewName;

    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    // Show target view
    const viewEl = document.getElementById(`view-${viewName}`);
    if (!viewEl) { console.error('View not found:', viewName); return; }
    viewEl.classList.add('active');

    // Update header
    const titleEl = document.getElementById('header-title');
    if (titleEl) titleEl.textContent = VIEW_TITLES[viewName] || '';

    // Show/hide back button
    const backBtn = document.getElementById('btn-back');
    const brandEl = document.getElementById('header-brand');
    const isSubView = viewName === 'job-detail';
    backBtn.classList.toggle('hidden', !isSubView);
    brandEl.classList.toggle('hidden', isSubView);

    // Update bottom nav
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === viewName);
    });

    // On-enter actions per view
    if (viewName === 'dashboard')  renderDashboard();
    if (viewName === 'jobs')       renderJobList();
    if (viewName === 'calendar')   renderCalendar();
    if (viewName === 'settings')   _loadSettingsForm();
    if (viewName === 'new-job')    _initNewJobView();

    // Scroll to top
    if (viewEl) viewEl.scrollTop = 0;
  }

  function goBack() {
    const prev = _state.previousView || 'dashboard';
    navigate(prev);
  }

  // ══════════════════════════════════════════════════════════
  // DASHBOARD
  // ══════════════════════════════════════════════════════════

  function renderDashboard() {
    const jobs = Storage.getJobs();
    const today = _todayStr();
    const weekStart = _daysAgoStr(6);
    const monthStart = _monthStartStr();

    // Revenue helpers
    const toTotal = arr => arr.reduce((s, j) => s + (parseFloat(j.jobTotal) || 0), 0);
    const paidOrClosed = j => j.status === 'paid' || j.status === 'closed';

    const todayJobs  = jobs.filter(j => j.scheduledDate === today);
    const weekJobs   = jobs.filter(j => j.scheduledDate >= weekStart);
    const monthJobs  = jobs.filter(j => j.scheduledDate >= monthStart);

    const todayRev   = toTotal(todayJobs.filter(paidOrClosed));
    const weekRev    = toTotal(weekJobs.filter(paidOrClosed));
    const monthRev   = toTotal(monthJobs.filter(paidOrClosed));

    _setText('rev-today-amount', _fmt(todayRev));
    _setText('rev-week-amount',  _fmt(weekRev));
    _setText('rev-month-amount', _fmt(monthRev));

    _setText('rev-today-count', `${todayJobs.length} job${todayJobs.length !== 1 ? 's' : ''}`);
    _setText('rev-week-count',  `${weekJobs.length} job${weekJobs.length !== 1 ? 's' : ''}`);
    _setText('rev-month-count', `${monthJobs.length} job${monthJobs.length !== 1 ? 's' : ''}`);

    // Status counts
    const counts = { new:0, scheduled:0, in_progress:0, closed:0, paid:0 };
    jobs.forEach(j => { if (counts[j.status] !== undefined) counts[j.status]++; });
    _setText('count-new',        counts.new);
    _setText('count-scheduled',  counts.scheduled);
    _setText('count-inprogress', counts.in_progress);
    _setText('count-closed',     counts.closed);
    _setText('count-paid',       counts.paid);

    // Tech performance
    _renderTechPerformance(jobs);

    // Recent jobs (last 8)
    const recentEl = document.getElementById('recent-jobs-list');
    const recent = jobs.slice(0, 8);
    if (recent.length === 0) {
      recentEl.innerHTML = `<div class="empty-state">
        <div class="empty-icon">&#128295;</div>
        <div class="empty-title">No jobs yet</div>
        <div class="empty-sub">Tap + to add your first job</div>
      </div>`;
    } else {
      recentEl.innerHTML = recent.map(j => _jobCardHTML(j)).join('');
    }

    // Next job strip
    _renderNextJobStrip(jobs);
  }

  function _renderTechPerformance(jobs) {
    const settings  = Storage.getSettings();
    const techs     = settings.technicians;
    const container = document.getElementById('tech-performance-list');

    if (!techs || techs.length === 0) {
      container.innerHTML = '<div class="empty-state-sm">Add technicians in Settings</div>';
      return;
    }

    const stats = techs.map(tech => {
      const techJobs = jobs.filter(j => j.assignedTechId === tech.id);
      const paidJobs = techJobs.filter(j => j.status === 'paid');
      const totalPayout = paidJobs.reduce((s, j) => s + (parseFloat(j.techPayout) || 0), 0);
      const avgPayout   = paidJobs.length > 0 ? totalPayout / paidJobs.length : 0;
      const estVsActual = techJobs.filter(j => j.estimatedTotal && j.jobTotal)
        .map(j => ({ est: parseFloat(j.estimatedTotal), actual: parseFloat(j.jobTotal) }));

      return { tech, techJobs, paidJobs, totalPayout, avgPayout, estVsActual };
    });

    container.innerHTML = stats.map(s => `
      <div class="tech-perf-card" onclick="App.navigate('jobs',{filter:'all'})">
        <div class="tech-perf-avatar" style="background:${s.tech.color || '#3B82F6'}">
          ${_initials(s.tech.name)}
        </div>
        <div class="tech-perf-info">
          <div class="tech-perf-name">${_esc(s.tech.name)}${s.tech.isOwner?' ★':''}</div>
          <div class="tech-perf-sub">${s.techJobs.length} jobs · avg $${s.avgPayout.toFixed(0)}/job</div>
        </div>
        <div class="tech-perf-stats">
          <div class="tech-perf-payout">${_fmt(s.totalPayout)}</div>
          <div class="tech-perf-jobs">${s.paidJobs.length} paid</div>
        </div>
      </div>
    `).join('');
  }

  function _renderNextJobStrip(jobs) {
    const strip = document.getElementById('next-job-strip');
    const now = new Date();
    const todayStr = _todayStr();

    // Find the next upcoming scheduled job
    const upcoming = jobs
      .filter(j => j.status === 'scheduled' || j.status === 'new')
      .filter(j => j.scheduledDate >= todayStr)
      .sort((a, b) => {
        const da = (a.scheduledDate || '9999') + (a.scheduledTime || '99:99');
        const db = (b.scheduledDate || '9999') + (b.scheduledTime || '99:99');
        return da.localeCompare(db);
      });

    if (upcoming.length === 0) { strip.classList.add('hidden'); return; }
    strip.classList.remove('hidden');

    const next = upcoming[0];
    const infoEl = document.getElementById('next-job-info');
    const timeStr = next.scheduledTime ? _formatTime(next.scheduledTime) : '';
    const dateStr = next.scheduledDate === todayStr ? 'Today' : _formatDate(next.scheduledDate);
    infoEl.textContent = `${next.customerName || 'Unknown'} · ${dateStr}${timeStr ? ' at '+timeStr : ''} · ${next.address || ''}`;
    strip.dataset.jobId = next.jobId;
  }

  function openNextJob() {
    const strip = document.getElementById('next-job-strip');
    const jobId = strip.dataset.jobId;
    if (jobId) openJobDetail(jobId);
  }

  // ══════════════════════════════════════════════════════════
  // JOB LIST
  // ══════════════════════════════════════════════════════════

  function renderJobList() {
    const container = document.getElementById('jobs-list-container');
    let jobs = Storage.searchJobs(_state.jobSearch);

    // Apply status filter
    if (_state.jobFilter && _state.jobFilter !== 'all') {
      jobs = jobs.filter(j => j.status === _state.jobFilter);
    }

    if (jobs.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon">&#128269;</div>
        <div class="empty-title">No jobs found</div>
        <div class="empty-sub">${_state.jobSearch ? 'Try a different search' : 'No jobs with this status'}</div>
      </div>`;
      return;
    }

    // Sort: newest first
    jobs = jobs.sort((a, b) => {
      const da = a.scheduledDate || a.createdAt || '';
      const db = b.scheduledDate || b.createdAt || '';
      return db.localeCompare(da);
    });

    container.innerHTML = jobs.map(j => _jobCardHTML(j)).join('');
  }

  function setJobFilter(filter, btn) {
    _state.jobFilter = filter;

    // Update chip states
    document.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('active', c.dataset.filter === filter);
    });

    if (_state.currentView === 'jobs') renderJobList();
  }

  function filterJobs() {
    _state.jobSearch = document.getElementById('job-search')?.value || '';
    renderJobList();
  }

  // ══════════════════════════════════════════════════════════
  // JOB CARD HTML
  // ══════════════════════════════════════════════════════════

  function _jobCardHTML(job) {
    const settings = Storage.getSettings();
    const statusClass = {
      new: 'jc-new', scheduled: 'jc-scheduled',
      in_progress: 'jc-inprogress', closed: 'jc-closed', paid: 'jc-paid',
    }[job.status] || 'jc-new';

    const badgeClass = {
      new: 'sb-new', scheduled: 'sb-scheduled',
      in_progress: 'sb-inprogress', closed: 'sb-closed', paid: 'sb-paid',
    }[job.status] || 'sb-new';

    const statusLabel = {
      new: 'New', scheduled: 'Scheduled',
      in_progress: 'In Progress', closed: 'Closed', paid: 'Paid',
    }[job.status] || job.status;

    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const techColor = tech?.color || '#64748B';

    const total = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;
    const totalStr = total > 0 ? _fmt(total) : '—';

    const dateStr = job.scheduledDate ? _formatDate(job.scheduledDate) : '';
    const timeStr = job.scheduledTime ? _formatTime(job.scheduledTime) : '';
    const dateTimeStr = [dateStr, timeStr].filter(Boolean).join(' · ');

    const returningBadge = job.isRecurringCustomer
      ? `<span class="returning-badge">&#128260; Returning</span>`
      : '';

    const phoneHref = job.phone ? `tel:${job.phone.replace(/\D/g,'')}` : '#';
    const callBtn = job.phone
      ? `<a class="call-btn" href="${phoneHref}" onclick="event.stopPropagation()" title="Call ${_esc(job.customerName)}">&#128222;</a>`
      : '';

    return `<div class="job-card ${statusClass}" onclick="App.openJobDetail('${job.jobId}')">
      <div class="job-card-inner">
        <div class="job-card-top">
          <div class="job-card-name">${_esc(job.customerName || 'Unknown Customer')}</div>
          <div class="job-card-right">
            <div class="job-card-total">${totalStr}</div>
            <span class="status-badge ${badgeClass}">${statusLabel}</span>
          </div>
        </div>
        <div class="job-card-mid">
          <span class="job-card-address">${_esc(job.address || '')}${job.city ? ', '+_esc(job.city) : ''}</span>
          <span class="job-card-date">${dateTimeStr}</span>
        </div>
        <div class="job-card-bottom">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${tech ? `<span class="job-card-tech"><span class="tech-dot" style="background:${techColor}"></span>${_esc(tech.name)}</span>` : ''}
            ${returningBadge}
          </div>
          <div class="job-card-actions">
            ${callBtn}
          </div>
        </div>
      </div>
    </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // NEW JOB FLOW
  // ══════════════════════════════════════════════════════════

  function _initNewJobView() {
    _state.currentStep = 1;
    _state.newJobDraft = {};
    _state.parsedLead  = null;

    _updateStepIndicator(1);

    // Show step 1, hide others
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById(`step-${i}`);
      if (el) el.classList.toggle('active', i === 1);
    }

    // Reset textarea
    const textarea = document.getElementById('raw-lead-input');
    if (textarea) textarea.value = '';

    // Reset form fields for new job
    ['f-name','f-phone','f-address','f-city','f-zip','f-description','f-notes',
     'f-tech-pct','f-parts-est','f-contractor','f-contractor-pct'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // Reset tech selection
    document.querySelectorAll('.tech-btn').forEach(b => b.classList.remove('selected'));
    const techHidden = document.getElementById('f-tech-id');
    if (techHidden) techHidden.value = '';

    // Reset source
    const sourceEl = document.getElementById('f-source');
    if (sourceEl) { sourceEl.value = 'my_lead'; onSourceChange(); }

    // Reset payment method
    document.querySelectorAll('.pay-btn').forEach(b => b.classList.toggle('active', b.dataset.method === 'cash'));
    _state.selectedPayMethod = 'cash';

    // Set today as default date
    const dateField = document.getElementById('f-date');
    if (dateField) {
      const t = new Date();
      dateField.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    }

    // Check for saved draft
    _checkDraft();

    // Repopulate source dropdown in case settings changed
    _populateSourceDropdown();
    _renderTechSelector();
  }

  function goToStep(stepNum) {
    // Validate current step before advancing
    if (stepNum > _state.currentStep) {
      const valid = _validateStep(_state.currentStep);
      if (!valid) return;
    }

    const oldEl = document.getElementById(`step-${_state.currentStep}`);
    const newEl = document.getElementById(`step-${stepNum}`);

    if (oldEl) oldEl.classList.remove('active');
    if (newEl) newEl.classList.add('active');

    _state.currentStep = stepNum;
    _updateStepIndicator(stepNum);

    // (no step 3/4 — merged into step 2)

    // Auto-save draft
    _autosaveDraft();
  }

  function _validateStep(step) {
    if (step === 2) {
      const name = document.getElementById('f-name')?.value?.trim();
      const phone = document.getElementById('f-phone')?.value?.trim();
      if (!name) { showToast('Enter customer name', 'warning'); return false; }
      if (!phone) { showToast('Enter phone number', 'warning'); return false; }
    }
    return true;
  }

  function _updateStepIndicator(active) {
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
      const step = i + 1;
      dot.classList.remove('active', 'done');
      if (step < active)       dot.classList.add('done');
      else if (step === active) dot.classList.add('active');
    });
    document.querySelectorAll('.step-line').forEach((line, i) => {
      line.classList.toggle('done', i + 1 < active);
    });
  }

  // ── PARSE LEAD ──────────────────────────────────────────

  function parseLead() {
    const raw = document.getElementById('raw-lead-input')?.value?.trim();
    if (!raw) {
      showToast('Paste some lead text first', 'warning');
      return;
    }

    const parsed = LeadParser.parse(raw);
    _state.parsedLead  = parsed;
    _state.newJobDraft.rawLead = raw;

    // Fill form fields
    _fillField('f-name',        parsed.customerName);
    _fillField('f-phone',       parsed.phone);
    _fillField('f-address',     parsed.address);
    _fillField('f-city',        parsed.city);
    _fillField('f-zip',         parsed.zip);
    _fillField('f-date',        parsed.scheduledDate);
    _fillField('f-time',        parsed.scheduledTime);
    _fillField('f-description', parsed.description);

    // State dropdown
    if (parsed.state?.value) {
      const stateEl = document.getElementById('f-state');
      if (stateEl) stateEl.value = parsed.state.value;
    }

    // Update confidence badges
    _setConf('conf-name',    parsed.customerName);
    _setConf('conf-phone',   parsed.phone);
    _setConf('conf-address', parsed.address);
    _setConf('conf-zip',     parsed.zip);
    _setConf('conf-date',    parsed.scheduledDate);
    _setConf('conf-time',    parsed.scheduledTime);
    _setConf('conf-desc',    parsed.description);

    // Check returning customer
    checkReturningCustomer();

    // Suggest technician by ZIP
    _suggestTechByZip(parsed.zip?.value || '');

    goToStep(2);
  }

  function startBlankJob() {
    // Clear any parsed data and go directly to step 2
    _state.parsedLead = null;
    // Set today as default date
    const dateField = document.getElementById('f-date');
    if (dateField && !dateField.value) {
      const t = new Date();
      dateField.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    }
    // Clear conf badges
    ['conf-name','conf-phone','conf-address','conf-zip','conf-date','conf-time','conf-desc'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ''; el.className = 'conf-badge'; }
    });
    goToStep(2);
  }

  function _fillField(id, fieldResult) {
    const el = document.getElementById(id);
    if (!el || !fieldResult) return;
    if (fieldResult.value !== undefined) {
      el.value = fieldResult.value;
    }
  }

  function _setConf(badgeId, fieldResult) {
    const el = document.getElementById(badgeId);
    if (!el || !fieldResult) return;
    if (!fieldResult.value) { el.textContent = ''; el.className = 'conf-badge'; return; }
    const cls = LeadParser.confidenceClass(fieldResult.confidence);
    const lbl = LeadParser.confidenceLabel(fieldResult.confidence);
    el.textContent = lbl;
    el.className = `conf-badge ${cls}`;
  }

  function checkReturningCustomer() {
    const phone = document.getElementById('f-phone')?.value || '';
    const result = Storage.detectReturningCustomer(phone);
    const banner = document.getElementById('returning-banner');
    if (!banner) return;

    if (result && result.isReturning) {
      banner.textContent = `&#128260; Returning customer — ${result.jobCount} previous job${result.jobCount > 1 ? 's' : ''}`;
      banner.classList.remove('hidden');
      _state.newJobDraft.isRecurringCustomer = true;
    } else {
      banner.classList.add('hidden');
      _state.newJobDraft.isRecurringCustomer = false;
    }
  }

  function onZipChange() {
    const zip = document.getElementById('f-zip')?.value || '';
    if (zip.length === 5) _suggestTechByZip(zip);
  }

  function _suggestTechByZip(zip) {
    if (!zip || zip.length < 5) return;
    const settings = Storage.getSettings();
    const techs = settings.technicians;
    const suggestion = document.getElementById('zip-suggestion');
    if (!suggestion) return;

    const match = techs.find(t => t.zipCodes && t.zipCodes.includes(zip));
    if (match) {
      suggestion.textContent = `ZIP ${zip} matches ${match.name}'s service area`;
      suggestion.classList.remove('hidden');
      // Auto-select this tech
      _selectTech(match.id);
    } else {
      suggestion.classList.add('hidden');
    }
  }

  // ── TECH SELECTOR ─────────────────────────────────────

  function _renderTechSelector() {
    const container = document.getElementById('tech-selector');
    if (!container) return;
    const settings = Storage.getSettings();
    const techs = settings.technicians;

    if (!techs || techs.length === 0) {
      container.innerHTML = '<div class="empty-state-sm">No technicians — add them in Settings first</div>';
      return;
    }

    container.innerHTML = techs.map(t => `
      <button class="tech-btn" data-tech-id="${t.id}" onclick="App._selectTech('${t.id}')">
        <span class="tech-btn-dot" style="background:${t.color || '#3B82F6'}"></span>
        ${_esc(t.name)}
        <span class="tech-btn-pct">${t.percent || 0}%</span>
        ${t.isOwner ? '★' : ''}
      </button>
    `).join('');
  }

  function _selectTech(techId) {
    const settings = Storage.getSettings();
    const tech = settings.technicians.find(t => t.id === techId);
    if (!tech) return;

    // Update hidden field
    const hiddenField = document.getElementById('f-tech-id');
    if (hiddenField) hiddenField.value = techId;

    // Update button states
    document.querySelectorAll('.tech-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.techId === techId);
    });

    // Auto-fill payout %
    const pctField = document.getElementById('f-tech-pct');
    if (pctField && (!pctField.value || pctField.value === '0')) {
      pctField.value = tech.percent || 0;
    }

    _state.newJobDraft.assignedTechId   = techId;
    _state.newJobDraft.assignedTechName = tech.name;
    _state.newJobDraft.isSelfAssigned   = !!tech.isOwner;

    updatePayoutPreview();
  }

  // ── SOURCE DROPDOWN ──────────────────────────────────

  function _populateSourceDropdown() {
    const select = document.getElementById('f-source');
    if (!select) return;
    const settings = Storage.getSettings();
    const sources  = settings.leadSources || [];

    // Keep "My Lead" as first option
    select.innerHTML = `<option value="my_lead">My Lead (Direct)</option>`;
    sources.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.contractorPercent || 0}%)`;
      select.appendChild(opt);
    });
  }

  function onSourceChange() {
    const val = document.getElementById('f-source')?.value;
    const contractorSection = document.getElementById('contractor-section');
    if (!contractorSection) return;

    if (!val || val === 'my_lead') {
      contractorSection.classList.add('hidden');
      const pctField = document.getElementById('f-contractor-pct');
      if (pctField) pctField.value = '0';
    } else {
      contractorSection.classList.remove('hidden');
      // Pre-fill contractor % from preset
      const settings = Storage.getSettings();
      const source = settings.leadSources.find(s => s.id === val);
      if (source) {
        const pctField = document.getElementById('f-contractor-pct');
        if (pctField) pctField.value = source.contractorPercent || 0;
        const nameField = document.getElementById('f-contractor');
        if (nameField) nameField.value = source.name || '';
      }
    }
    updatePayoutPreview();
  }

  // ── PAYMENT METHOD ───────────────────────────────────

  function selectPayMethod(btn) {
    document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _state.selectedPayMethod = btn.dataset.method;
    const hidden = document.getElementById('f-pay-method');
    if (hidden) hidden.value = btn.dataset.method;
  }

  // ── PAYOUT PREVIEW ──────────────────────────────────

  function updatePayoutPreview() {
    const previewEl = document.getElementById('payout-preview');
    if (!previewEl) return;

    const settings = Storage.getSettings();

    const total    = parseFloat(document.getElementById('f-total-est')?.value) || 0;
    const parts    = parseFloat(document.getElementById('f-parts-est')?.value) || 0;
    const techPct  = parseFloat(document.getElementById('f-tech-pct')?.value)  || 0;
    const contrPct = parseFloat(document.getElementById('f-contractor-pct')?.value) || 0;
    const state    = document.getElementById('f-state')?.value || settings.defaultState || 'NY';

    const techId   = document.getElementById('f-tech-id')?.value || '';
    const techData = settings.technicians.find(t => t.id === techId);
    const isSelf   = techData?.isOwner || false;
    const techName = techData?.name || 'Tech';

    if (total === 0) {
      previewEl.classList.add('hidden');
      return;
    }

    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parts, techPercent: techPct,
      contractorPct: contrPct, isSelfAssigned: isSelf, state,
      taxRateNY: settings.taxRateNY, taxRateNJ: settings.taxRateNJ,
    });

    // Use outerHTML but preserve the id so subsequent calls still find it
    previewEl.outerHTML = PayoutEngine.renderBreakdownHTML(calc, techName, 'payout-preview');
  }

  // ── SAVE JOB ─────────────────────────────────────────

  function saveNewJob() {
    const name   = document.getElementById('f-name')?.value?.trim();
    const phone  = document.getElementById('f-phone')?.value?.trim();
    const techId = document.getElementById('f-tech-id')?.value;

    if (!name)  { showToast('Enter customer name', 'warning'); return; }
    if (!phone) { showToast('Enter phone number', 'warning');  return; }
    if (!techId){ showToast('Select a technician', 'warning'); return; }

    const total = 0; // Actual total is entered when closing the job

    const settings = Storage.getSettings();
    const tech = settings.technicians.find(t => t.id === techId);
    const source = document.getElementById('f-source')?.value || 'my_lead';
    const state  = document.getElementById('f-state')?.value  || settings.defaultState || 'NY';

    const parts    = parseFloat(document.getElementById('f-parts-est')?.value) || 0;
    const techPct  = parseFloat(document.getElementById('f-tech-pct')?.value)  || tech?.percent || 0;
    const contrPct = source === 'my_lead' ? 0 : parseFloat(document.getElementById('f-contractor-pct')?.value) || 0;
    const isSelf   = tech?.isOwner || false;

    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parts, techPercent: techPct,
      contractorPct: contrPct, isSelfAssigned: isSelf, state,
      taxRateNY: settings.taxRateNY, taxRateNJ: settings.taxRateNJ,
    });

    const job = {
      jobId:           Storage.generateId(),
      status:          'new',
      customerName:    name,
      phone:           LeadParser.formatPhone(phone),
      address:         document.getElementById('f-address')?.value?.trim() || '',
      city:            document.getElementById('f-city')?.value?.trim()    || '',
      state,
      zip:             document.getElementById('f-zip')?.value?.trim()     || '',
      scheduledDate:   document.getElementById('f-date')?.value            || '',
      scheduledTime:   document.getElementById('f-time')?.value            || '',
      description:     document.getElementById('f-description')?.value?.trim() || '',
      notes:           document.getElementById('f-notes')?.value?.trim()   || '',
      rawLead:         _state.newJobDraft.rawLead || '',
      source:          source,
      contractorName:  source === 'my_lead' ? '' : (document.getElementById('f-contractor')?.value?.trim() || ''),
      contractorPct:   contrPct,
      assignedTechId:  techId,
      assignedTechName:tech?.name || '',
      isSelfAssigned:  isSelf,
      techPercent:     techPct,
      estimatedTotal:  total,
      jobTotal:        0,
      partsCost:       parts,
      taxAmount:       calc.taxAmount,
      techPayout:      calc.techPayout,
      ownerPayout:     calc.ownerPayout,
      contractorFee:   calc.contractorFee,
      paymentMethod:   _state.selectedPayMethod || 'cash',
      photos:          [],
      isRecurringCustomer: _state.newJobDraft.isRecurringCustomer || false,
      syncStatus:      'pending',
    };

    // Update status based on whether scheduled
    if (job.scheduledDate) job.status = 'scheduled';

    const saved = Storage.saveJob(job);
    if (!saved) { showToast('Failed to save job', 'error'); return; }

    // Queue for sync
    SyncManager.queueJob(job.jobId);

    // Clear draft
    Storage.clearDraft();

    showToast(`Job saved — ${name}`, 'success');

    // Navigate to job detail
    navigate('job-detail');
    openJobDetail(job.jobId);
  }

  function _autosaveDraft() {
    Storage.saveDraft({
      rawLead:      document.getElementById('raw-lead-input')?.value,
      name:         document.getElementById('f-name')?.value,
      phone:        document.getElementById('f-phone')?.value,
      address:      document.getElementById('f-address')?.value,
      city:         document.getElementById('f-city')?.value,
      state:        document.getElementById('f-state')?.value,
      zip:          document.getElementById('f-zip')?.value,
      date:         document.getElementById('f-date')?.value,
      time:         document.getElementById('f-time')?.value,
      description:  document.getElementById('f-description')?.value,
      notes:        document.getElementById('f-notes')?.value,
      source:       document.getElementById('f-source')?.value,
      techId:       document.getElementById('f-tech-id')?.value,
      techPct:      document.getElementById('f-tech-pct')?.value,
      total:        document.getElementById('f-total-est')?.value,
      parts:        document.getElementById('f-parts-est')?.value,
      step:         _state.currentStep,
    });
  }

  function _checkDraft() {
    const draft = Storage.getDraft();
    if (!draft) return;
    // Only show if user is already on step > 1 or has meaningful data
    if (draft.name && draft.step > 1) {
      showToast('Draft restored', 'info');
      // Restore fields
      if (draft.rawLead)     { const el = document.getElementById('raw-lead-input'); if(el) el.value = draft.rawLead; }
      if (draft.name)        { const el = document.getElementById('f-name');         if(el) el.value = draft.name; }
      if (draft.phone)       { const el = document.getElementById('f-phone');        if(el) el.value = draft.phone; }
      if (draft.address)     { const el = document.getElementById('f-address');      if(el) el.value = draft.address; }
      if (draft.city)        { const el = document.getElementById('f-city');         if(el) el.value = draft.city; }
      if (draft.state)       { const el = document.getElementById('f-state');        if(el) el.value = draft.state; }
      if (draft.zip)         { const el = document.getElementById('f-zip');          if(el) el.value = draft.zip; }
      if (draft.date)        { const el = document.getElementById('f-date');         if(el) el.value = draft.date; }
      if (draft.time)        { const el = document.getElementById('f-time');         if(el) el.value = draft.time; }
      if (draft.description) { const el = document.getElementById('f-description'); if(el) el.value = draft.description; }
      if (draft.notes)       { const el = document.getElementById('f-notes');        if(el) el.value = draft.notes; }
      if (draft.source)      { const el = document.getElementById('f-source');       if(el) el.value = draft.source; }
      if (draft.techId)      { const el = document.getElementById('f-tech-id');      if(el) el.value = draft.techId; _selectTech(draft.techId); }
      if (draft.techPct)     { const el = document.getElementById('f-tech-pct');     if(el) el.value = draft.techPct; }
      if (draft.total)       { const el = document.getElementById('f-total-est');    if(el) el.value = draft.total; }
      if (draft.parts)       { const el = document.getElementById('f-parts-est');    if(el) el.value = draft.parts; }
      if (draft.step)        goToStep(Math.min(draft.step, 2));
    }
  }

  // ══════════════════════════════════════════════════════════
  // JOB DETAIL VIEW
  // ══════════════════════════════════════════════════════════

  function openJobDetail(jobId) {
    const job = Storage.getJobById(jobId);
    if (!job) { showToast('Job not found', 'error'); return; }

    _state.currentJobId = jobId;
    navigate('job-detail');

    const container = document.getElementById('job-detail-content');
    container.innerHTML = _buildJobDetailHTML(job);
  }

  function _buildJobDetailHTML(job) {
    const settings  = Storage.getSettings();
    const tech      = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const isPaid    = job.status === 'paid';

    const statusBadgeClass = {
      new: 'sb-new', scheduled: 'sb-scheduled',
      in_progress: 'sb-inprogress', closed: 'sb-closed', paid: 'sb-paid',
    }[job.status] || 'sb-new';

    const statusLabel = {
      new:'New', scheduled:'Scheduled', in_progress:'In Progress', closed:'Closed', paid:'Paid',
    }[job.status] || job.status;

    const total = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;

    // Payout calc display
    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parseFloat(job.partsCost) || 0,
      techPercent: parseFloat(job.techPercent) || 0,
      contractorPct: parseFloat(job.contractorPct) || 0,
      isSelfAssigned: job.isSelfAssigned,
      state: job.state || 'NY',
      taxRateNY: settings.taxRateNY,
      taxRateNJ: settings.taxRateNJ,
    });

    // Photos
    const photos = job.photos || [];
    const photoHTML = _buildPhotoGrid(job.jobId, photos);

    // Status actions
    const statusActions = _buildStatusActions(job);

    // Close job button
    const closeBtn = (job.status !== 'paid')
      ? `<button class="quick-close-btn" onclick="App.showCloseJobModal('${job.jobId}')">
           &#10003; Close Job
         </button>`
      : `<div class="quick-close-btn" style="background:var(--color-surface-3);color:var(--color-text-faint);cursor:default;box-shadow:none">
           &#10003; Paid on ${_formatDate(job.paidAt || '')}
         </div>`;

    // WhatsApp — format full job details, let user pick contact
    const waMsg = encodeURIComponent(_buildWhatsAppJobText(job));
    const waLink = `<a href="https://wa.me/?text=${waMsg}" class="detail-action-btn" onclick="event.stopPropagation()">
      <span class="dab-icon">&#128172;</span><span class="dab-label">WhatsApp</span>
    </a>`;

    const callLink = job.phone
      ? `<a href="tel:${job.phone.replace(/\D/g,'')}" class="detail-action-btn dab-green">
           <span class="dab-icon">&#128222;</span><span class="dab-label">Call</span>
         </a>`
      : '';

    return `
      <!-- Hero -->
      <div class="detail-hero">
        <div class="detail-name">${_esc(job.customerName || 'Unknown Customer')}</div>
        <div class="detail-hero-row">
          <span class="status-badge ${statusBadgeClass}">${statusLabel}</span>
          ${job.isRecurringCustomer ? '<span class="returning-badge">&#128260; Returning</span>' : ''}
          ${job.photos?.length ? `<span style="font-size:12px;color:var(--color-text-muted)">&#128247; ${job.photos.length} photo${job.photos.length!==1?'s':''}</span>` : ''}
        </div>
      </div>

      <!-- Action Bar -->
      <div class="detail-action-bar">
        ${callLink}
        ${waLink}
        ${job.address ? `<button class="detail-action-btn" onclick="App.navigateToJob('${job.jobId}')"><span class="dab-icon">&#128205;</span><span class="dab-label">Navigate</span></button>` : ''}
        <button class="detail-action-btn" onclick="App.showEditJobModal('${job.jobId}')"><span class="dab-icon">&#9998;</span><span class="dab-label">Edit</span></button>
      </div>

      <!-- Close Job -->
      ${closeBtn}

      <!-- Customer Info -->
      <div class="detail-section" id="ds-customer">
        <div class="detail-section-title" onclick="App.toggleDetailSection('ds-customer')">
          Customer <span class="section-chevron">›</span>
        </div>
        <div class="detail-section-body">
          <div class="detail-row">
            <div class="detail-row-label">Name</div>
            <div class="detail-row-value">${_esc(job.customerName || '—')}</div>
          </div>
          <div class="detail-row">
            <div class="detail-row-label">Phone</div>
            <div class="detail-row-value">
              ${job.phone ? `<a href="tel:${job.phone.replace(/\D/g,'')}">${_esc(job.phone)}</a>` : '—'}
            </div>
          </div>
          <div class="detail-row">
            <div class="detail-row-label">Address</div>
            <div class="detail-row-value">${_esc([job.address, job.city, job.state, job.zip].filter(Boolean).join(', ')) || '—'}</div>
          </div>
        </div>
      </div>

      <!-- Schedule -->
      <div class="detail-section" id="ds-schedule">
        <div class="detail-section-title" onclick="App.toggleDetailSection('ds-schedule')">
          Schedule <span class="section-chevron">›</span>
        </div>
        <div class="detail-section-body">
          <div class="detail-row">
            <div class="detail-row-label">Date</div>
            <div class="detail-row-value">${job.scheduledDate ? _formatDate(job.scheduledDate) : '—'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-row-label">Time</div>
            <div class="detail-row-value">${job.scheduledTime ? _formatTime(job.scheduledTime) : '—'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-row-label">Description</div>
            <div class="detail-row-value" style="white-space:pre-wrap">${_esc(job.description || '—')}</div>
          </div>
        </div>
      </div>

      <!-- Assignment -->
      <div class="detail-section collapsed" id="ds-assignment">
        <div class="detail-section-title" onclick="App.toggleDetailSection('ds-assignment')">
          Assignment <span class="section-chevron">›</span>
        </div>
        <div class="detail-section-body">
          <div class="detail-row">
            <div class="detail-row-label">Technician</div>
            <div class="detail-row-value" style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
              ${tech ? `<span class="tech-dot" style="background:${tech.color||'#60A5FA'}"></span>` : ''}
              ${_esc(job.assignedTechName || '—')}${job.isSelfAssigned ? ' ★' : ''}
            </div>
          </div>
          <div class="detail-row">
            <div class="detail-row-label">Lead Source</div>
            <div class="detail-row-value">${job.source === 'my_lead' ? 'My Lead (Direct)' : _esc(job.contractorName || job.source || '—')}</div>
          </div>
          ${job.contractorPct > 0 ? `
          <div class="detail-row">
            <div class="detail-row-label">Contractor %</div>
            <div class="detail-row-value">${job.contractorPct}%</div>
          </div>` : ''}
          <div class="detail-row">
            <div class="detail-row-label">Payment</div>
            <div class="detail-row-value" style="text-transform:capitalize">${job.paymentMethod || '—'}</div>
          </div>
        </div>
      </div>

      <!-- Financials -->
      <div class="detail-section collapsed" id="ds-financials">
        <div class="detail-section-title" onclick="App.toggleDetailSection('ds-financials')">
          Financials <span class="section-chevron">›</span>
        </div>
        <div class="detail-section-body">
          ${total > 0 ? PayoutEngine.renderBreakdownHTML(calc, job.assignedTechName || 'Tech') : `
            <div class="detail-row">
              <div class="detail-row-label">Status</div>
              <div class="detail-row-value" style="color:var(--color-text-faint)">Enter total when closing job</div>
            </div>
          `}
        </div>
      </div>

      <!-- Notes -->
      ${job.notes ? `
      <div class="detail-section collapsed" id="ds-notes">
        <div class="detail-section-title" onclick="App.toggleDetailSection('ds-notes')">
          Notes <span class="section-chevron">›</span>
        </div>
        <div class="detail-section-body">
          <div style="padding:var(--sp-md);font-size:var(--font-sm);line-height:1.6;white-space:pre-wrap;color:var(--color-text)">
            ${_esc(job.notes)}
          </div>
        </div>
      </div>` : ''}

      <!-- Photos -->
      <div class="detail-section collapsed" id="ds-photos">
        <div class="detail-section-title" onclick="App.toggleDetailSection('ds-photos')">
          Photos (${photos.length}) <span class="section-chevron">›</span>
        </div>
        <div class="detail-section-body">
          ${photoHTML}
          <input type="file" id="photo-input-${job.jobId}" accept="image/*" multiple capture="environment"
                 style="display:none" onchange="App.handlePhotoUpload(event, '${job.jobId}')">
        </div>
      </div>

      <!-- Danger -->
      <div style="margin-top:var(--sp-md)">
        <button class="btn btn-danger btn-full" onclick="App.confirmDeleteJob('${job.jobId}')">
          Delete Job
        </button>
      </div>
    `;
  }

  function _buildStatusActions(job) {
    const statuses = [
      { val:'new',        label:'New',         cls:'sab-new' },
      { val:'scheduled',  label:'Scheduled',   cls:'sab-scheduled' },
      { val:'in_progress',label:'In Progress', cls:'sab-inprogress' },
      { val:'closed',     label:'Closed',      cls:'sab-closed' },
      { val:'paid',       label:'Paid',        cls:'sab-paid' },
    ];

    const btns = statuses.map(s => `
      <button class="status-action-btn ${s.cls} ${job.status === s.val ? 'current' : ''}"
              onclick="App.setJobStatus('${job.jobId}', '${s.val}')"
              ${job.status === 'paid' && s.val !== 'paid' ? 'disabled style="opacity:0.4"' : ''}>
        ${s.label}
      </button>
    `).join('');

    return `<div class="status-action-row">${btns}</div>`;
  }

  function _buildPhotoGrid(jobId, photos) {
    const thumbs = photos.map((photo, idx) => `
      <img class="photo-thumb" src="${photo.data}" alt="Photo ${idx+1}"
           onclick="App.viewPhoto('${jobId}', ${idx})">
    `).join('');

    const addBtn = `
      <div class="photo-add-btn" onclick="document.getElementById('photo-input-${jobId}').click()">
        <span class="photo-add-icon">+</span>
        <span>Add</span>
      </div>
    `;

    return `<div class="photo-grid">${thumbs}${addBtn}</div>`;
  }

  function setJobStatus(jobId, status) {
    const job = Storage.getJobById(jobId);
    if (!job) return;
    if (job.status === 'paid' && status !== 'paid') {
      showToast('Cannot change status of a paid job', 'warning');
      return;
    }

    Storage.saveJob({ ...job, status });
    SyncManager.queueJob(jobId);
    showToast(`Status → ${status.replace('_',' ')}`, 'success');

    // Re-render detail
    const container = document.getElementById('job-detail-content');
    const updated = Storage.getJobById(jobId);
    if (container && updated) container.innerHTML = _buildJobDetailHTML(updated);
  }

  // ══════════════════════════════════════════════════════════
  // PHOTO UPLOAD
  // ══════════════════════════════════════════════════════════

  function handlePhotoUpload(event, jobId) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    let processed = 0;
    const job = Storage.getJobById(jobId);
    if (!job) return;

    const photos = [...(job.photos || [])];

    files.forEach(file => {
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        _compressImage(e.target.result, 800, 0.75, (compressed) => {
          photos.push({
            data:  compressed,
            name:  file.name,
            addedAt: new Date().toISOString(),
          });
          processed++;

          if (processed === files.length) {
            const saved = Storage.saveJob({ ...job, photos });
            if (saved) {
              showToast(`${files.length} photo${files.length > 1 ? 's' : ''} added`, 'success');
              // Re-render detail
              const updated = Storage.getJobById(jobId);
              const container = document.getElementById('job-detail-content');
              if (container && updated) container.innerHTML = _buildJobDetailHTML(updated);
              SyncManager.queueJob(jobId);
            } else {
              showToast('Storage full — some photos not saved', 'error');
            }
          }
        });
      };
      reader.readAsDataURL(file);
    });

    // Clear input
    event.target.value = '';
  }

  function _compressImage(dataUrl, maxWidth, quality, callback) {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width  = maxWidth;
      }
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  }

  function viewPhoto(jobId, idx) {
    const job = Storage.getJobById(jobId);
    if (!job || !job.photos || !job.photos[idx]) return;

    _state.photoViewerJobId = jobId;
    _state.photoViewerIdx   = idx;

    const photo = job.photos[idx];
    const body  = document.getElementById('modal-photo-body');
    const title = document.getElementById('photo-modal-title');

    if (title) title.textContent = `Photo ${idx+1} of ${job.photos.length}`;
    if (body) {
      body.innerHTML = `
        <img src="${photo.data}" alt="Photo" style="width:100%;border-radius:8px;display:block">
        <div class="photo-action-row">
          ${idx > 0 ? `<button class="btn btn-secondary" style="flex:1" onclick="App.viewPhoto('${jobId}', ${idx-1})">&#8249; Prev</button>` : '<div style="flex:1"></div>'}
          <button class="btn btn-danger" style="flex:1" onclick="App.deletePhoto('${jobId}', ${idx})">Delete</button>
          ${idx < job.photos.length-1 ? `<button class="btn btn-secondary" style="flex:1" onclick="App.viewPhoto('${jobId}', ${idx+1})">Next &#8250;</button>` : '<div style="flex:1"></div>'}
        </div>
        <div style="text-align:center;font-size:11px;color:var(--color-text-faint);margin-top:8px">
          Added ${_formatDate(photo.addedAt || '')}
        </div>
      `;
    }

    showModal('modal-photo');
  }

  function deletePhoto(jobId, idx) {
    const job = Storage.getJobById(jobId);
    if (!job || !job.photos) return;
    const photos = [...job.photos];
    photos.splice(idx, 1);
    Storage.saveJob({ ...job, photos });
    closeModal();
    showToast('Photo deleted', 'success');
    // Refresh detail
    const container = document.getElementById('job-detail-content');
    const updated = Storage.getJobById(jobId);
    if (container && updated) container.innerHTML = _buildJobDetailHTML(updated);
  }

  // ══════════════════════════════════════════════════════════
  // CLOSE JOB MODAL
  // ══════════════════════════════════════════════════════════

  function showCloseJobModal(jobId) {
    const job = Storage.getJobById(jobId);
    if (!job) return;
    if (job.status === 'paid') { showToast('Job already paid', 'info'); return; }

    _state.closeJobId = jobId;

    const settings = Storage.getSettings();
    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const currentTotal = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;

    const body = document.getElementById('modal-close-job-body');
    body.innerHTML = `
      <div class="close-job-summary">
        <div class="close-job-customer">${_esc(job.customerName || '')}</div>
        <div class="close-job-address">${_esc(job.address || '')} · ${_esc(job.phone || '')}</div>
      </div>

      <div class="field-group">
        <label class="field-label">Final Job Total (what customer paid)</label>
        <div class="currency-input">
          <span class="currency-symbol">$</span>
          <input type="number" id="close-total" class="field-input currency-field"
                 placeholder="0.00" step="0.01" min="0" value="${currentTotal || ''}"
                 oninput="App._updateClosePreview()">
        </div>
      </div>

      <div class="field-group">
        <label class="field-label">Parts / Materials Cost</label>
        <div class="currency-input">
          <span class="currency-symbol">$</span>
          <input type="number" id="close-parts" class="field-input currency-field"
                 placeholder="0.00" step="0.01" min="0" value="${job.partsCost || 0}"
                 oninput="App._updateClosePreview()">
        </div>
      </div>

      <div id="close-payout-preview" class="payout-preview">
        <div class="empty-state-sm">Enter job total above</div>
      </div>

      <div class="field-group">
        <label class="field-label">Payment Method</label>
        <div class="payment-methods" id="close-pay-methods">
          <button class="pay-btn ${job.paymentMethod==='cash'  ?'active':''}" data-method="cash"  onclick="App._closeSelectPay(this)">Cash</button>
          <button class="pay-btn ${job.paymentMethod==='zelle' ?'active':''}" data-method="zelle" onclick="App._closeSelectPay(this)">Zelle</button>
          <button class="pay-btn ${job.paymentMethod==='check' ?'active':''}" data-method="check" onclick="App._closeSelectPay(this)">Check</button>
          <button class="pay-btn ${job.paymentMethod==='card'  ?'active':''}" data-method="card"  onclick="App._closeSelectPay(this)">Card</button>
        </div>
        <input type="hidden" id="close-pay-method" value="${job.paymentMethod || 'cash'}">
      </div>

      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-secondary" style="flex:1" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-success" style="flex:1;font-size:16px;font-weight:800"
                onclick="App.finalizeJob('${jobId}')">
          &#10003; Close Job
        </button>
      </div>

      ${tech && tech.zelleHandle ? `
        <div style="margin-top:var(--sp-md)">
          <button class="btn btn-ghost btn-full" onclick="App.showZelleMemo('${jobId}')">
            &#128196; Generate Zelle Memo for ${_esc(tech.name)}
          </button>
        </div>` : ''}
    `;

    if (currentTotal > 0) _updateClosePreview();

    showModal('modal-close-job');
  }

  function _closeSelectPay(btn) {
    document.querySelectorAll('#close-pay-methods .pay-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const h = document.getElementById('close-pay-method');
    if (h) h.value = btn.dataset.method;
  }

  function _updateClosePreview() {
    const job  = _state.closeJobId ? Storage.getJobById(_state.closeJobId) : null;
    if (!job)  return;

    const settings = Storage.getSettings();
    const total  = parseFloat(document.getElementById('close-total')?.value) || 0;
    const parts  = parseFloat(document.getElementById('close-parts')?.value) || 0;

    if (total === 0) {
      const prev = document.getElementById('close-payout-preview');
      if (prev) prev.innerHTML = '<div class="empty-state-sm">Enter job total above</div>';
      return;
    }

    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parts,
      techPercent: parseFloat(job.techPercent) || 0,
      contractorPct: parseFloat(job.contractorPct) || 0,
      isSelfAssigned: job.isSelfAssigned,
      state: job.state || 'NY',
      taxRateNY: settings.taxRateNY,
      taxRateNJ: settings.taxRateNJ,
    });

    const prev = document.getElementById('close-payout-preview');
    if (prev) {
      // Preserve id so re-renders on subsequent keystrokes still find the element
      prev.outerHTML = PayoutEngine.renderBreakdownHTML(calc, tech?.name || 'Tech', 'close-payout-preview');
    }
  }

  function finalizeJob(jobId) {
    const job = Storage.getJobById(jobId);
    if (!job) return;

    const total  = parseFloat(document.getElementById('close-total')?.value) || 0;
    const parts  = parseFloat(document.getElementById('close-parts')?.value) || 0;
    const method = document.getElementById('close-pay-method')?.value || 'cash';

    if (total <= 0) { showToast('Enter the final job total', 'warning'); return; }

    const settings = Storage.getSettings();
    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;

    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parts,
      techPercent: parseFloat(job.techPercent) || 0,
      contractorPct: parseFloat(job.contractorPct) || 0,
      isSelfAssigned: job.isSelfAssigned,
      state: job.state || 'NY',
      taxRateNY: settings.taxRateNY,
      taxRateNJ: settings.taxRateNJ,
    });

    const zelleMemo = tech ? PayoutEngine.generateZelleMemo({
      techName: tech.name,
      customerName: job.customerName,
      address: job.address,
      jobDate: job.scheduledDate ? _formatDate(job.scheduledDate) : '',
      techPayout: calc.techPayout,
      jobId: job.jobId,
    }) : '';

    const updated = {
      ...job,
      status:        'paid',
      jobTotal:      total,
      partsCost:     parts,
      taxAmount:     calc.taxAmount,
      techPayout:    calc.techPayout,
      ownerPayout:   calc.ownerPayout,
      contractorFee: calc.contractorFee,
      paymentMethod: method,
      paidAt:        new Date().toISOString(),
      zelleMemo,
    };

    Storage.saveUndo(Storage.getJobById(jobId));
    Storage.saveJob(updated);
    SyncManager.queueJob(jobId);

    closeModal();
    showToast(`Paid! Owner: ${_fmt(calc.ownerPayout)} · Tech: ${_fmt(calc.techPayout)}`, 'success');

    // Refresh detail view
    const container = document.getElementById('job-detail-content');
    const refreshed = Storage.getJobById(jobId);
    if (container && refreshed) container.innerHTML = _buildJobDetailHTML(refreshed);

    // If tech has Zelle handle, show Zelle memo
    if (tech && tech.zelleHandle && calc.techPayout > 0) {
      setTimeout(() => showZelleMemo(jobId), 600);
    }
  }

  // ══════════════════════════════════════════════════════════
  // ZELLE MEMO
  // ══════════════════════════════════════════════════════════

  function showZelleMemo(jobId) {
    const job = Storage.getJobById(jobId);
    if (!job) return;

    const settings = Storage.getSettings();
    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;

    const payout = parseFloat(job.techPayout) || 0;
    const memo   = job.zelleMemo || '';
    const handle = tech?.zelleHandle || '';

    const body = document.getElementById('modal-zelle-body');
    body.innerHTML = `
      ${handle ? `
        <div class="zelle-handle-display">Send to: <span class="zelle-handle-val">${_esc(handle)}</span></div>
      ` : ''}
      <div style="font-size:32px;font-weight:900;color:var(--color-success);text-align:center;padding:16px 0">
        ${_fmt(payout)}
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Memo / Notes</div>
      <div class="zelle-memo-box">${_esc(memo)}</div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-secondary" style="flex:1" onclick="App._copyZelleMemo('${jobId}')">
          &#128203; Copy Memo
        </button>
        ${handle ? `
          <a href="tel:${handle.replace(/\D/g,'')}" class="btn btn-primary" style="flex:1">
            Open Zelle
          </a>` : ''}
      </div>
    `;

    showModal('modal-zelle');
  }

  function _copyZelleMemo(jobId) {
    const job = Storage.getJobById(jobId);
    if (!job || !job.zelleMemo) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(job.zelleMemo)
        .then(() => showToast('Copied to clipboard', 'success'))
        .catch(() => showToast('Could not copy', 'error'));
    } else {
      showToast('Long-press to copy', 'info');
    }
  }

  // ══════════════════════════════════════════════════════════
  // EDIT JOB MODAL (inline edit on detail view)
  // ══════════════════════════════════════════════════════════

  function showEditJobModal(jobId) {
    const job = Storage.getJobById(jobId);
    if (!job) return;
    if (job.status === 'paid') { showToast('Cannot edit a paid job', 'warning'); return; }

    const settings = Storage.getSettings();

    // Build modal using close-job modal slot (reuse)
    const body = document.getElementById('modal-close-job-body');
    const titleEl = document.querySelector('#modal-close-job .modal-title');
    if (titleEl) titleEl.textContent = 'Edit Job';

    body.innerHTML = `
      <div class="field-group">
        <label class="field-label">Customer Name</label>
        <input type="text" id="edit-name" class="field-input" value="${_esc(job.customerName || '')}">
      </div>
      <div class="field-group">
        <label class="field-label">Phone</label>
        <input type="tel" id="edit-phone" class="field-input" value="${_esc(job.phone || '')}">
      </div>
      <div class="field-group">
        <label class="field-label">Address</label>
        <input type="text" id="edit-address" class="field-input" value="${_esc(job.address || '')}">
      </div>
      <div class="field-row">
        <div class="field-group" style="flex:2">
          <label class="field-label">City</label>
          <input type="text" id="edit-city" class="field-input" value="${_esc(job.city || '')}">
        </div>
        <div class="field-group" style="flex:1">
          <label class="field-label">State</label>
          <select id="edit-state" class="field-input">
            ${['NY','NJ','CT','PA','FL','TX'].map(s => `<option value="${s}" ${job.state===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="field-group" style="flex:1">
          <label class="field-label">ZIP</label>
          <input type="text" id="edit-zip" class="field-input" value="${_esc(job.zip || '')}" maxlength="5">
        </div>
      </div>
      <div class="field-row">
        <div class="field-group" style="flex:1">
          <label class="field-label">Date</label>
          <input type="date" id="edit-date" class="field-input" value="${job.scheduledDate || ''}">
        </div>
        <div class="field-group" style="flex:1">
          <label class="field-label">Time</label>
          <input type="time" id="edit-time" class="field-input" value="${job.scheduledTime || ''}">
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Description</label>
        <textarea id="edit-desc" class="field-input field-textarea" rows="2">${_esc(job.description || '')}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Notes</label>
        <textarea id="edit-notes" class="field-input field-textarea" rows="2">${_esc(job.notes || '')}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Tech Payout %</label>
        <input type="number" id="edit-tech-pct" class="field-input" value="${job.techPercent || 0}" min="0" max="100">
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-secondary" style="flex:1" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" style="flex:1" onclick="App._saveEditedJob('${jobId}')">Save Changes</button>
      </div>
    `;

    showModal('modal-close-job');
  }

  function _saveEditedJob(jobId) {
    const job = Storage.getJobById(jobId);
    if (!job) return;

    const updated = {
      ...job,
      customerName:  document.getElementById('edit-name')?.value?.trim()    || job.customerName,
      phone:         document.getElementById('edit-phone')?.value?.trim()   || job.phone,
      address:       document.getElementById('edit-address')?.value?.trim() || job.address,
      city:          document.getElementById('edit-city')?.value?.trim()    || job.city,
      state:         document.getElementById('edit-state')?.value           || job.state,
      zip:           document.getElementById('edit-zip')?.value?.trim()     || job.zip,
      scheduledDate: document.getElementById('edit-date')?.value            || job.scheduledDate,
      scheduledTime: document.getElementById('edit-time')?.value            || job.scheduledTime,
      description:   document.getElementById('edit-desc')?.value?.trim()   || job.description,
      notes:         document.getElementById('edit-notes')?.value?.trim()   || job.notes,
      techPercent:   parseFloat(document.getElementById('edit-tech-pct')?.value) || job.techPercent,
    };

    Storage.saveJob(updated);
    SyncManager.queueJob(jobId);
    closeModal();
    showToast('Job updated', 'success');

    // Refresh detail
    const container = document.getElementById('job-detail-content');
    const refreshed = Storage.getJobById(jobId);
    if (container && refreshed) container.innerHTML = _buildJobDetailHTML(refreshed);
  }

  // ══════════════════════════════════════════════════════════
  // DELETE JOB
  // ══════════════════════════════════════════════════════════

  function confirmDeleteJob(jobId) {
    const job = Storage.getJobById(jobId);
    if (!job) return;
    showConfirm({
      icon:    '&#128465;',
      title:   'Delete Job?',
      message: `Delete job for ${job.customerName || 'this customer'}? This cannot be undone.`,
      okLabel: 'Delete',
      onOk:    () => _deleteJob(jobId),
    });
  }

  function _deleteJob(jobId) {
    const job = Storage.getJobById(jobId);
    Storage.saveUndo(job);
    Storage.deleteJob(jobId);
    showToast('Job deleted', 'success');
    navigate('jobs');
  }

  // ══════════════════════════════════════════════════════════
  // CALENDAR
  // ══════════════════════════════════════════════════════════

  function renderCalendar() {
    const d = _state.calendarDate;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    // Update header date
    const label = document.getElementById('cal-date-label');
    const today = _todayStr();
    if (label) {
      const isToday = dateStr === today;
      label.textContent = isToday ? 'Today — ' + _formatDateLong(d) : _formatDateLong(d);
    }

    const jobs = Storage.getJobsByDate(dateStr);
    const settings = Storage.getSettings();
    const container = document.getElementById('calendar-content');

    if (jobs.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon">&#128197;</div>
        <div class="empty-title">No jobs scheduled</div>
        <div class="empty-sub">This day is clear</div>
      </div>`;
      return;
    }

    // Group jobs by tech
    const byTech = {};
    jobs.forEach(j => {
      const key = j.assignedTechId || '__unassigned__';
      if (!byTech[key]) byTech[key] = [];
      byTech[key].push(j);
    });

    // Sort jobs within each tech by time
    Object.values(byTech).forEach(arr => arr.sort((a,b) => (a.scheduledTime||'').localeCompare(b.scheduledTime||'')));

    let html = '';

    for (const [techId, techJobs] of Object.entries(byTech)) {
      const tech = techId !== '__unassigned__'
        ? settings.technicians.find(t => t.id === techId)
        : null;

      // Detect conflicts
      const conflicts = _detectConflicts(techJobs);

      const rows = techJobs.map((job, i) => {
        const conflictWarn = conflicts.includes(i)
          ? `<div class="cal-conflict-warn">&#9888; Time conflict detected</div>` : '';

        return `${conflictWarn}
          <div class="cal-job-row" onclick="App.openJobDetail('${job.jobId}')">
            <div class="cal-job-time">${job.scheduledTime ? _formatTime(job.scheduledTime) : 'TBD'}</div>
            <div class="cal-job-info">
              <div class="cal-job-name">${_esc(job.customerName || 'Unknown')}</div>
              <div class="cal-job-addr">${_esc(job.address || '')}${job.zip ? ' '+job.zip : ''}</div>
            </div>
            <span class="status-badge ${{new:'sb-new',scheduled:'sb-scheduled',in_progress:'sb-inprogress',closed:'sb-closed',paid:'sb-paid'}[job.status]||'sb-new'}" style="font-size:10px">${{new:'New',scheduled:'Sched',in_progress:'Active',closed:'Done',paid:'Paid'}[job.status]||''}</span>
          </div>`;
      }).join('');

      html += `
        <div class="cal-tech-block">
          <div class="cal-tech-header">
            <div class="cal-tech-avatar" style="background:${tech?.color||'#64748B'}">${tech ? _initials(tech.name) : '?'}</div>
            <div class="cal-tech-name">${tech ? _esc(tech.name) : 'Unassigned'}</div>
            <div class="cal-tech-count">${techJobs.length} job${techJobs.length!==1?'s':''}</div>
          </div>
          ${rows}
        </div>
      `;
    }

    container.innerHTML = html;
  }

  function _detectConflicts(jobs) {
    const conflictIdxs = [];
    for (let i = 0; i < jobs.length - 1; i++) {
      const a = jobs[i];
      const b = jobs[i+1];
      if (!a.scheduledTime || !b.scheduledTime) continue;
      const [ah, am] = a.scheduledTime.split(':').map(Number);
      const [bh, bm] = b.scheduledTime.split(':').map(Number);
      const aMin = ah * 60 + am;
      const bMin = bh * 60 + bm;
      // Consider conflict if within 90 minutes
      if (bMin - aMin < 90) { conflictIdxs.push(i); conflictIdxs.push(i+1); }
    }
    return conflictIdxs;
  }

  function calendarShift(delta) {
    const d = _state.calendarDate;
    d.setDate(d.getDate() + delta);
    _state.calendarDate = new Date(d);
    renderCalendar();
  }

  function calendarToday() {
    _state.calendarDate = new Date();
    renderCalendar();
  }

  // ══════════════════════════════════════════════════════════
  // PDF EXPORT
  // ══════════════════════════════════════════════════════════

  function toggleDetailSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) section.classList.toggle('collapsed');
  }

  function navigateToJob(jobId) {
    const job = Storage.getJobById(jobId);
    if (!job) { showToast('Job not found', 'error'); return; }

    const parts = [job.address, job.city, job.state, job.zip].filter(Boolean);
    if (!parts.length) { showToast('No address on this job', 'warning'); return; }

    const encoded = encodeURIComponent(parts.join(', '));
    window.open('https://maps.apple.com/?daddr=' + encoded, '_blank');
  }

  function exportJobPDF(jobId) {
    const job = Storage.getJobById(jobId);
    if (!job) { showToast('Job not found', 'error'); return; }

    const settings = Storage.getSettings();
    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const total = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;

    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parseFloat(job.partsCost)||0,
      techPercent: parseFloat(job.techPercent)||0,
      contractorPct: parseFloat(job.contractorPct)||0,
      isSelfAssigned: job.isSelfAssigned,
      state: job.state || 'NY',
      taxRateNY: settings.taxRateNY,
      taxRateNJ: settings.taxRateNJ,
    });

    const statusLabel = {new:'New',scheduled:'Scheduled',in_progress:'In Progress',closed:'Closed',paid:'Paid'}[job.status]||job.status;

    const printArea = document.getElementById('print-area');
    printArea.innerHTML = `
      <div class="print-header">
        <div class="print-company">On Point Home Services</div>
        <div class="print-subtitle">Garage Door &amp; Home Services</div>
        <div style="margin-top:8px"><span class="print-status-badge">${statusLabel}</span></div>
        <div class="print-job-id">Job #${job.jobId} · Created ${_formatDate(job.createdAt)}</div>
      </div>

      <div class="print-section">
        <div class="print-section-title">Customer</div>
        <div class="print-row"><span class="print-label">Name</span><span class="print-value">${_esc(job.customerName||'')}</span></div>
        <div class="print-row"><span class="print-label">Phone</span><span class="print-value">${_esc(job.phone||'')}</span></div>
        <div class="print-row"><span class="print-label">Address</span><span class="print-value">${_esc([job.address,job.city,job.state,job.zip].filter(Boolean).join(', '))}</span></div>
      </div>

      <div class="print-section">
        <div class="print-section-title">Schedule</div>
        <div class="print-row"><span class="print-label">Date</span><span class="print-value">${job.scheduledDate ? _formatDate(job.scheduledDate) : '—'}</span></div>
        <div class="print-row"><span class="print-label">Time</span><span class="print-value">${job.scheduledTime ? _formatTime(job.scheduledTime) : '—'}</span></div>
        <div class="print-row"><span class="print-label">Service</span><span class="print-value">${_esc(job.description||'—')}</span></div>
      </div>

      <div class="print-section">
        <div class="print-section-title">Assignment</div>
        <div class="print-row"><span class="print-label">Technician</span><span class="print-value">${_esc(job.assignedTechName||'—')}${job.isSelfAssigned?' (Owner)':''}</span></div>
        <div class="print-row"><span class="print-label">Lead Source</span><span class="print-value">${job.source === 'my_lead' ? 'My Lead' : _esc(job.contractorName||job.source||'—')}</span></div>
      </div>

      <div class="print-section">
        <div class="print-section-title">Financials</div>
        <div class="print-row"><span class="print-label">Job Total</span><span class="print-value">${_fmt(calc.jobTotal)}</span></div>
        ${calc.taxAmount > 0 ? `<div class="print-row"><span class="print-label">Tax (${calc.taxRatePercent}%)</span><span class="print-value">-${_fmt(calc.taxAmount)}</span></div>` : ''}
        ${calc.partsCost > 0 ? `<div class="print-row"><span class="print-label">Parts</span><span class="print-value">-${_fmt(calc.partsCost)}</span></div>` : ''}
        ${calc.contractorFee > 0 ? `<div class="print-row"><span class="print-label">Contractor Fee (${calc.contractorPct}%)</span><span class="print-value">-${_fmt(calc.contractorFee)}</span></div>` : ''}
        <div class="print-row"><span class="print-label">${_esc(job.assignedTechName||'Tech')} Payout (${calc.techPercent}%)</span><span class="print-value">${_fmt(calc.techPayout)}</span></div>
        <div class="print-row print-total-row"><span class="print-label">Owner Payout</span><span class="print-value">${_fmt(calc.ownerPayout)}</span></div>
      </div>

      ${job.notes ? `
      <div class="print-section">
        <div class="print-section-title">Notes</div>
        <div class="print-notes">${_esc(job.notes)}</div>
      </div>` : ''}

      ${job.zelleMemo ? `
      <div class="print-section">
        <div class="print-section-title">Zelle Payment Memo</div>
        <div class="print-zelle-memo">
          <div class="print-zelle-title">&#128196; Send via Zelle to: ${_esc(tech?.zelleHandle||'')}</div>
          ${_esc(job.zelleMemo)}
        </div>
      </div>` : ''}

      <div class="print-footer">
        Printed ${new Date().toLocaleDateString()} · On Point Home Services · Internal Record
      </div>
    `;

    window.print();
    showToast('Opening print dialog...', 'info');
  }

  // ══════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════

  function _loadSettingsForm() {
    const s = Storage.getSettings();
    _setVal('s-owner-name',        s.ownerName);
    _setVal('s-owner-phone',       s.ownerPhone);
    _setVal('s-owner-zelle',       s.ownerZelle);
    _setVal('s-tax-ny',            s.taxRateNY);
    _setVal('s-tax-nj',            s.taxRateNJ);
    _setVal('s-apps-script-url',   s.appsScriptUrl);
    _setVal('s-default-state',     s.defaultState);

    _renderTechList(s.technicians);
    _renderSourceList(s.leadSources);
  }

  function saveSettings() {
    const settings = {
      ownerName:     document.getElementById('s-owner-name')?.value?.trim()      || '',
      ownerPhone:    document.getElementById('s-owner-phone')?.value?.trim()     || '',
      ownerZelle:    document.getElementById('s-owner-zelle')?.value?.trim()     || '',
      taxRateNY:     parseFloat(document.getElementById('s-tax-ny')?.value)       || 8.875,
      taxRateNJ:     parseFloat(document.getElementById('s-tax-nj')?.value)       || 6.625,
      appsScriptUrl: document.getElementById('s-apps-script-url')?.value?.trim() || '',
      defaultState:  document.getElementById('s-default-state')?.value           || 'NY',
    };

    // Validate tax rates
    if (settings.taxRateNY < 0 || settings.taxRateNY > 20) {
      showToast('NY tax rate must be between 0-20%', 'warning'); return;
    }
    if (settings.taxRateNJ < 0 || settings.taxRateNJ > 20) {
      showToast('NJ tax rate must be between 0-20%', 'warning'); return;
    }

    Storage.saveSettings(settings);
    showToast('Settings saved', 'success');
  }

  // ── TECHNICIANS ────────────────────────────────────────

  function _renderTechList(techs = []) {
    const list = document.getElementById('tech-list');
    if (!list) return;

    if (!techs || techs.length === 0) {
      list.innerHTML = '<div class="empty-state-sm">No technicians yet. Add your first one above.</div>';
      return;
    }

    list.innerHTML = techs.map(t => `
      <div class="settings-list-item">
        <span class="settings-item-dot" style="background:${t.color||'#3B82F6'}"></span>
        <div class="settings-item-info">
          <div class="settings-item-name">${_esc(t.name)} ${t.isOwner ? '★ Owner' : ''}</div>
          <div class="settings-item-sub">${t.percent||0}% · ${t.zipCodes?.join(', ')||'No ZIPs'}</div>
        </div>
        <div class="settings-item-actions">
          <button class="btn-icon" onclick="App.showTechModal('${t.id}')" title="Edit">&#9998;</button>
          <button class="btn-icon" onclick="App.deleteTech('${t.id}')" title="Delete" style="color:var(--color-error)">&#128465;</button>
        </div>
      </div>
    `).join('');
  }

  function showTechModal(techId) {
    const settings = Storage.getSettings();
    const tech = techId ? settings.technicians.find(t => t.id === techId) : null;
    const title = document.getElementById('tech-modal-title');
    if (title) title.textContent = tech ? 'Edit Technician' : 'Add Technician';

    document.getElementById('m-tech-id').value         = tech?.id        || '';
    document.getElementById('m-tech-name').value       = tech?.name      || '';
    document.getElementById('m-tech-phone').value      = tech?.phone     || '';
    document.getElementById('m-tech-pct').value        = tech?.percent   || '';
    document.getElementById('m-tech-zelle').value      = tech?.zelleHandle || '';
    document.getElementById('m-tech-zips').value       = tech?.zipCodes?.join(', ') || '';
    document.getElementById('m-tech-color').value      = tech?.color     || '#3B82F6';
    document.getElementById('m-tech-is-owner').checked = tech?.isOwner   || false;

    showModal('modal-tech');
  }

  function saveTech() {
    const name = document.getElementById('m-tech-name')?.value?.trim();
    if (!name) { showToast('Enter technician name', 'warning'); return; }

    const pct = parseFloat(document.getElementById('m-tech-pct')?.value) || 0;
    if (pct < 0 || pct > 100) { showToast('Payout % must be 0-100', 'warning'); return; }

    const settings = Storage.getSettings();
    const techs = [...(settings.technicians || [])];
    const existingId = document.getElementById('m-tech-id')?.value;

    const isOwner = document.getElementById('m-tech-is-owner')?.checked;

    // Only one tech can be owner
    if (isOwner) {
      techs.forEach(t => { if (t.id !== existingId) t.isOwner = false; });
    }

    const zipsRaw = document.getElementById('m-tech-zips')?.value || '';
    const zipCodes = zipsRaw.split(',').map(z => z.trim()).filter(z => /^\d{5}$/.test(z));

    const techData = {
      id:          existingId || Storage.generateId(),
      name,
      phone:       document.getElementById('m-tech-phone')?.value?.trim()  || '',
      percent:     pct,
      zelleHandle: document.getElementById('m-tech-zelle')?.value?.trim()  || '',
      zipCodes,
      color:       document.getElementById('m-tech-color')?.value          || '#3B82F6',
      isOwner,
    };

    if (existingId) {
      const idx = techs.findIndex(t => t.id === existingId);
      if (idx >= 0) techs[idx] = techData; else techs.push(techData);
    } else {
      techs.push(techData);
    }

    Storage.saveSettings({ technicians: techs });
    _renderTechList(techs);
    _renderTechSelector();
    closeModal();
    showToast(`${name} saved`, 'success');
  }

  function deleteTech(techId) {
    showConfirm({
      icon: '&#128465;',
      title: 'Delete Technician?',
      message: 'This will remove the technician from all future jobs.',
      okLabel: 'Delete',
      onOk: () => {
        const settings = Storage.getSettings();
        const techs = (settings.technicians || []).filter(t => t.id !== techId);
        Storage.saveSettings({ technicians: techs });
        _renderTechList(techs);
        _renderTechSelector();
        showToast('Technician deleted', 'success');
      }
    });
  }

  // ── LEAD SOURCES ─────────────────────────────────────

  function _renderSourceList(sources = []) {
    const list = document.getElementById('source-list');
    if (!list) return;

    if (!sources || sources.length === 0) {
      list.innerHTML = '<div class="empty-state-sm">No custom sources. "My Lead" is always available.</div>';
      return;
    }

    list.innerHTML = sources.map(s => `
      <div class="settings-list-item">
        <div class="settings-item-info">
          <div class="settings-item-name">${_esc(s.name)}</div>
          <div class="settings-item-sub">Contractor: ${s.contractorPercent||0}%</div>
        </div>
        <div class="settings-item-actions">
          <button class="btn-icon" onclick="App.showSourceModal('${s.id}')" title="Edit">&#9998;</button>
          <button class="btn-icon" onclick="App.deleteSource('${s.id}')" title="Delete" style="color:var(--color-error)">&#128465;</button>
        </div>
      </div>
    `).join('');
  }

  function showSourceModal(sourceId) {
    const settings = Storage.getSettings();
    const source = sourceId ? settings.leadSources.find(s => s.id === sourceId) : null;
    const title = document.getElementById('source-modal-title');
    if (title) title.textContent = source ? 'Edit Lead Source' : 'Add Lead Source';

    document.getElementById('m-source-id').value   = source?.id   || '';
    document.getElementById('m-source-name').value = source?.name || '';
    document.getElementById('m-source-pct').value  = source?.contractorPercent || '';

    showModal('modal-source');
  }

  function saveSource() {
    const name = document.getElementById('m-source-name')?.value?.trim();
    if (!name) { showToast('Enter source name', 'warning'); return; }

    const pct = parseFloat(document.getElementById('m-source-pct')?.value) || 0;
    const settings = Storage.getSettings();
    const sources = [...(settings.leadSources || [])];
    const existingId = document.getElementById('m-source-id')?.value;

    const data = {
      id: existingId || Storage.generateId(),
      name,
      contractorPercent: pct,
    };

    if (existingId) {
      const idx = sources.findIndex(s => s.id === existingId);
      if (idx >= 0) sources[idx] = data; else sources.push(data);
    } else {
      sources.push(data);
    }

    Storage.saveSettings({ leadSources: sources });
    _renderSourceList(sources);
    _populateSourceDropdown();
    closeModal();
    showToast(`${name} saved`, 'success');
  }

  function deleteSource(sourceId) {
    showConfirm({
      icon: '&#128465;',
      title: 'Delete Source?',
      message: 'Remove this lead source?',
      okLabel: 'Delete',
      onOk: () => {
        const settings = Storage.getSettings();
        const sources = (settings.leadSources || []).filter(s => s.id !== sourceId);
        Storage.saveSettings({ leadSources: sources });
        _renderSourceList(sources);
        _populateSourceDropdown();
        showToast('Source deleted', 'success');
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  // SYNC
  // ══════════════════════════════════════════════════════════

  async function syncAll() {
    if (SyncManager.isSyncing()) { showToast('Sync already in progress', 'info'); return; }

    const syncBtn = document.getElementById('btn-sync');
    if (syncBtn) syncBtn.classList.add('syncing');
    showToast('Syncing to Google Sheets...', 'info');

    const result = await SyncManager.syncAll();

    if (syncBtn) syncBtn.classList.remove('syncing');

    if (result.success) {
      showToast(`Synced ${result.synced || 0} jobs`, 'success');
    } else {
      showToast(result.error || 'Sync failed — check Apps Script URL in Settings', 'error');
    }
  }

  async function testSync() {
    showToast('Testing connection...', 'info');
    const result = await SyncManager.testConnection();
    if (result.success) {
      showToast('Connection successful!', 'success');
    } else {
      showToast(result.error || 'Connection failed', 'error');
    }
  }

  // ══════════════════════════════════════════════════════════
  // DATA MANAGEMENT
  // ══════════════════════════════════════════════════════════

  function exportData() {
    const data = Storage.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `onpoint-backup-${_todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup exported', 'success');
  }

  function clearAllData() {
    showConfirm({
      icon: '&#9888;',
      title: 'Clear ALL Data?',
      message: 'This will permanently delete all jobs and settings. This cannot be undone.',
      okLabel: 'Clear Everything',
      onOk: () => {
        Storage.clearAll();
        showToast('All data cleared', 'warning');
        _loadSettingsForm();
        renderDashboard();
        renderJobList();
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  // MODAL SYSTEM
  // ══════════════════════════════════════════════════════════

  function showModal(modalId) {
    const overlay = document.getElementById('modal-overlay');
    const modal   = document.getElementById(modalId);
    if (!overlay || !modal) return;

    // Hide all modals first
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));

    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.add('hidden');
    document.body.style.overflow = '';

    // Reset close-job modal title
    const title = document.querySelector('#modal-close-job .modal-title');
    if (title) title.textContent = 'Close Job';
  }

  function showConfirm({ icon, title, message, okLabel = 'Confirm', okClass = 'btn-danger', onOk }) {
    _state.confirmCallback = onOk;

    document.getElementById('confirm-icon').innerHTML  = icon || '&#9888;';
    document.getElementById('confirm-title').textContent = title || 'Confirm?';
    document.getElementById('confirm-msg').textContent   = message || '';

    const okBtn = document.getElementById('confirm-ok-btn');
    if (okBtn) {
      okBtn.textContent = okLabel;
      okBtn.className   = `btn ${okClass}`;
      okBtn.onclick = () => {
        if (_state.confirmCallback) _state.confirmCallback();
        closeModal();
      };
    }

    showModal('modal-confirm');
  }

  // ══════════════════════════════════════════════════════════
  // TOAST SYSTEM
  // ══════════════════════════════════════════════════════════

  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }

  // ══════════════════════════════════════════════════════════
  // FORMATTING UTILITIES
  // ══════════════════════════════════════════════════════════

  function _fmt(amount) {
    if (isNaN(amount)) return '$0';
    return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      // Parse as local date (avoid UTC offset issues)
      const [y, m, d] = (dateStr.includes('T') ? dateStr.split('T')[0] : dateStr).split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return dateStr; }
  }

  function _formatDateLong(date) {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function _formatTime(timeStr) {
    if (!timeStr) return '';
    try {
      const [h, m] = timeStr.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
      return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
    } catch (e) { return timeStr; }
  }

  function _todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function _daysAgoStr(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function _monthStartStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  }

  function _initials(name) {
    if (!name) return '?';
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  function _buildWhatsAppJobText(job) {
    const settings  = Storage.getSettings();
    const tech      = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const total     = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;
    const statusMap = { new:'New', scheduled:'Scheduled', in_progress:'In Progress', closed:'Closed', paid:'Paid' };
    const address   = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');

    const lines = [
      '*ON POINT HOME SERVICES*',
      `Ref: #${(job.jobId || '').slice(-6).toUpperCase()}`,
      '',
      `*Customer:* ${job.customerName || '—'}`,
      job.phone   ? `*Phone:* ${job.phone}` : '',
      address     ? `*Address:* ${address}` : '',
      '',
      job.scheduledDate ? `*Date:* ${_formatDate(job.scheduledDate)}${job.scheduledTime ? ' @ ' + _formatTime(job.scheduledTime) : ''}` : '',
      job.description   ? `*Job:* ${job.description}` : '',
      job.notes         ? `*Notes:* ${job.notes}` : '',
      '',
      total > 0         ? `*Total:* $${total.toFixed(2)}` : '',
      tech              ? `*Tech:* ${tech.name}` : '',
      `*Status:* ${statusMap[job.status] || job.status}`,
    ].filter(line => line !== '');

    return lines.join('\n');
  }

  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '';
  }

  function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════

  return {
    init,
    navigate,
    goBack,

    // Dashboard
    renderDashboard,
    openNextJob,

    // Job List
    renderJobList,
    setJobFilter,
    filterJobs,

    // New Job
    parseLead,
    startBlankJob,
    goToStep,
    checkReturningCustomer,
    onZipChange,
    onSourceChange,
    selectPayMethod,
    updatePayoutPreview,
    saveNewJob,
    _selectTech,

    // Job Detail
    openJobDetail,
    setJobStatus,
    showCloseJobModal,
    showEditJobModal,
    finalizeJob,
    _updateClosePreview,
    _closeSelectPay,
    _saveEditedJob,
    confirmDeleteJob,

    // Zelle
    showZelleMemo,
    _copyZelleMemo,

    // Photos
    handlePhotoUpload,
    viewPhoto,
    deletePhoto,

    // Calendar
    renderCalendar,
    calendarShift,
    calendarToday,

    // PDF
    navigateToJob,
    toggleDetailSection,
    exportJobPDF,

    // Settings
    saveSettings,
    showTechModal,
    saveTech,
    deleteTech,
    showSourceModal,
    saveSource,
    deleteSource,

    // Sync
    syncAll,
    testSync,

    // Data
    exportData,
    clearAllData,

    // Modals
    showModal,
    closeModal,

    // Toast
    showToast,
  };

})();

// ══════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  App.init();

  // Auto-sync on load (if URL configured)
  const settings = Storage.getSettings();
  if (settings.appsScriptUrl) {
    setTimeout(() => SyncManager.syncAll(), 3000);
  }
});
