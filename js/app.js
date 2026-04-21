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

  let _initialized = false;
  let _jobsChannel = null;
  let _settingsChannel = null;
  let _profilesChannel = null;
  let _firstSetupInProgress = false;
  let _lastInvite = { name: '', email: '', phone: '' }; // for WA button after invite
  let _jobsViewMode = localStorage.getItem('op_jobs_view') || 'list'; // 'list' | 'kanban'
  let _ptr = { startY: 0, pulling: false };

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════

  // Called by boot once Auth confirms a valid session
  function _removeAppShell() {
    document.getElementById('app-shell')?.remove();
  }

  async function _onAuthenticated() {
    if (_initialized) return;
    _initialized = true;

    // Show app immediately from localStorage cache — do NOT await DB.init() first
    LoginScreen.hide();
    _removeAppShell();

    // Set header avatar / name / role
    _updateHeaderUser();

    // Show/hide nav + header items based on role
    _applyRoleUI();

    // Init dark mode from saved preference
    _initDarkMode();

    // Init pull-to-refresh
    _initPullToRefresh();

    // Render immediately from localStorage cache so the app feels instant
    _loadSettingsForm();
    renderDashboard();
    renderJobList();
    _renderTechSelector();
    _populateSourceDropdown();
    _checkDraft();

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const dateField = document.getElementById('f-date');
    if (dateField && !dateField.value) dateField.value = dateStr;

    // Sync fresh data from Supabase in background, then re-render
    try { await DB.init(); } catch(e) {
      console.warn('DB.init error:', e.message);
      showToast('Connection error — showing cached data. Pull to refresh.', 'warning');
    }
    renderDashboard();
    renderJobList();
    _loadSettingsForm();
    _renderTechSelector();
    _populateSourceDropdown();

    // Always land on dashboard after login — never restore a previous session's screen
    navigate('dashboard');

    // Start notification bell + real-time banner toasts
    try { await Notifications.init(); } catch(e) { console.warn('Notifications.init error:', e.message); }

    // Start background overdue-job checker (admin/dispatcher only)
    Reminders.init();

    // Subscribe to live job changes from other sessions
    _jobsChannel = DB.subscribeToJobs(
      () => { renderDashboard(); renderJobList(); if (_jobsViewMode === 'kanban' && _state.currentView === 'jobs') renderKanban(); },
      () => { renderDashboard(); renderJobList(); if (_jobsViewMode === 'kanban' && _state.currentView === 'jobs') renderKanban(); if (_state.currentView === 'job-detail') openJobDetail(_state.currentJobId); },
      (deletedJobId) => {
        renderDashboard();
        renderJobList();
        if (_jobsViewMode === 'kanban' && _state.currentView === 'jobs') renderKanban();
        if (_state.currentView === 'job-detail' && _state.currentJobId === deletedJobId) {
          navigate('jobs');
        }
      },
    );

    // Subscribe to settings/profile changes from other devices
    _settingsChannel = DB.subscribeToSettings(() => {
      _renderTechSelector();
      _populateSourceDropdown();
      if (_state.currentView === 'settings') _loadSettingsForm();
    });
    _profilesChannel = DB.subscribeToProfiles(() => {
      _renderTechSelector();
      _populateSourceDropdown();
      if (_state.currentView === 'settings') _loadSettingsForm();
    });

    // Auto-sync Google Sheets on load if URL configured
    const settings = DB.getSettings();
    if (settings.appsScriptUrl) setTimeout(() => SyncManager.syncAll(), 3000);

  }

  function _updateHeaderUser() {
    const user = Auth.getUser();
    if (!user) return;

    const initials = _initials(user.name);
    const avatarSpan = document.getElementById('user-avatar-initials');
    if (avatarSpan) avatarSpan.textContent = initials;
    const avatarBtn = document.getElementById('btn-user');
    if (avatarBtn) avatarBtn.style.background = user.color || 'var(--color-primary)';

    const nameEl = document.getElementById('user-menu-name');
    if (nameEl) nameEl.textContent = user.name;

    const roleEl = document.getElementById('user-menu-role');
    if (roleEl) roleEl.textContent = user.role;
  }

  function closeUserMenu() {
    const menu = document.getElementById('user-menu');
    if (menu) menu.classList.add('hidden');
  }

  function _applyRoleUI() {
    // Hide "New Job" button from tech/contractor users (they don't create jobs)
    document.querySelectorAll('.nav-add').forEach(el => {
      el.classList.toggle('hidden', Auth.isTechOrContractor());
    });
  }

  function toggleUserMenu() {
    const menu = document.getElementById('user-menu');
    if (!menu) return;
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) {
      menu.classList.add('hidden');
    } else {
      menu.classList.remove('hidden');
      // Close when clicking outside
      setTimeout(() => {
        const close = (e) => {
          if (!menu.contains(e.target)) { menu.classList.add('hidden'); document.removeEventListener('click', close); }
        };
        document.addEventListener('click', close);
      }, 10);
    }
  }

  async function logout() {
    _initialized = false;
    Reminders.destroy();
    Notifications.destroy();
    if (_jobsChannel)     { SupabaseClient.removeChannel(_jobsChannel);     _jobsChannel = null; }
    if (_settingsChannel) { SupabaseClient.removeChannel(_settingsChannel); _settingsChannel = null; }
    if (_profilesChannel) { SupabaseClient.removeChannel(_profilesChannel); _profilesChannel = null; }
    await Auth.logout();
    LoginScreen.show();
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

    // Sync view toggle button state when entering jobs view
    if (viewName === 'jobs') {
      const toggleEl = document.getElementById('btn-toggle-view');
      if (toggleEl) {
        toggleEl.innerHTML = _jobsViewMode === 'kanban'
          ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="5" height="14" rx="1"/><rect x="10" y="1" width="5" height="14" rx="1"/></svg>'
          : '&#9776;';
      }
    }

    // On-enter actions per view
    if (viewName === 'dashboard')  renderDashboard();
    if (viewName === 'jobs') {
      // Restore saved view mode
      const listEl  = document.getElementById('jobs-list-container');
      const boardEl = document.getElementById('jobs-kanban-board');
      if (_jobsViewMode === 'kanban') {
        if (listEl)  listEl.classList.add('hidden');
        if (boardEl) boardEl.classList.remove('hidden');
        renderKanban();
      } else {
        if (listEl)  listEl.classList.remove('hidden');
        if (boardEl) boardEl.classList.add('hidden');
        renderJobList();
      }
    }
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
    const jobs = DB.getJobs();
    const today = _todayStr();
    const weekStart = _daysAgoStr(6);
    const monthStart = _monthStartStr();

    const paidOnly = j => j.status === 'paid';
    const todayJobs  = jobs.filter(j => j.scheduledDate === today);
    const weekJobs   = jobs.filter(j => j.scheduledDate >= weekStart);
    const monthJobs  = jobs.filter(j => j.scheduledDate >= monthStart);

    // Only admin sees revenue section
    const revSection = document.getElementById('revenue-section');
    if (revSection) revSection.classList.toggle('hidden', !Auth.isAdmin());

    // Only admin sees technician performance section
    const techPerfTitle = document.getElementById('tech-perf-section');
    if (techPerfTitle) techPerfTitle.classList.toggle('hidden', !Auth.isAdmin());

    if (Auth.canSeeFinancials()) {
      // Admin: show owner revenue (ownerPayout + selfBonus for self-assigned)
      const toOwnerRev = arr => arr.reduce((s, j) => {
        const ownerCut  = parseFloat(j.ownerPayout) || 0;
        const selfBonus = (j.isSelfAssigned === true || j.isSelfAssigned === 'true')
          ? (parseFloat(j.techPayout) || 0) : 0;
        return s + ownerCut + selfBonus;
      }, 0);
      const toSales = arr => arr.reduce((s, j) => s + (parseFloat(j.jobTotal) || 0), 0);
      _setText('rev-today-amount', _fmt(toOwnerRev(todayJobs.filter(paidOnly))));
      _setText('rev-week-amount',  _fmt(toOwnerRev(weekJobs.filter(paidOnly))));
      _setText('rev-month-amount', _fmt(toSales(monthJobs.filter(paidOnly))));

      // Month-over-month comparison
      const now = new Date();
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
      const lastMonthJobs  = jobs.filter(j => j.scheduledDate >= lastMonthStart && j.scheduledDate <= lastMonthEnd);
      const thisMonthSales = toSales(monthJobs.filter(paidOnly));
      const lastMonthSales = toSales(lastMonthJobs.filter(paidOnly));
      const momEl = document.getElementById('mom-stats');
      if (momEl && (thisMonthSales > 0 || lastMonthSales > 0)) {
        const diff = thisMonthSales - lastMonthSales;
        const pct  = lastMonthSales > 0 ? Math.round((diff / lastMonthSales) * 100) : null;
        const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
        const color = diff > 0 ? 'var(--color-success)' : diff < 0 ? 'var(--color-error)' : 'var(--color-text-muted)';
        const pctLabel = pct !== null ? ` (${pct > 0 ? '+' : ''}${pct}%)` : '';
        const lastMonthName = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString('en-US', { month: 'short' });
        momEl.innerHTML = `<span style="color:var(--color-text-muted);font-size:12px">vs ${lastMonthName}: ${_fmt(lastMonthSales)}</span><span style="color:${color};font-size:12px;font-weight:700;margin-left:8px">${arrow} ${_fmt(Math.abs(diff))}${pctLabel}</span>`;
        momEl.classList.remove('hidden');
      } else if (momEl) {
        momEl.classList.add('hidden');
      }
    }

    _setText('rev-today-count', `${todayJobs.length} job${todayJobs.length !== 1 ? 's' : ''}`);
    _setText('rev-week-count',  `${weekJobs.length} job${weekJobs.length !== 1 ? 's' : ''}`);
    _setText('rev-month-count', `${monthJobs.length} job${monthJobs.length !== 1 ? 's' : ''}`);

    // Status counts
    const counts = { new:0, scheduled:0, in_progress:0, closed:0, paid:0, follow_up:0 };
    jobs.forEach(j => { if (counts[j.status] !== undefined) counts[j.status]++; });
    _setText('count-new',        counts.new);
    _setText('count-scheduled',  counts.scheduled);
    _setText('count-inprogress', counts.in_progress);
    _setText('count-closed',     counts.closed);
    _setText('count-paid',       counts.paid);
    _setText('count-followup',   counts.follow_up);

    // Tech performance (admin/dispatcher only)
    if (Auth.canSeeFinancials()) _renderTechPerformance(jobs);

    // Role-specific dashboard sections
    if (Auth.isTechOrContractor()) {
      _renderTechTodaySection(jobs);
    } else if (Auth.isAdminOrDisp() && !Auth.canSeeFinancials() /* dispatcher */) {
      _renderDispatcherSection(jobs);
    } else if (Auth.isAdmin()) {
      _renderDispatcherSection(jobs); // admins also see urgent queue
    }

    // Recent jobs (last 8) — hide for tech (they have their own section)
    const recentEl = document.getElementById('recent-jobs-list');
    const recentWrap = document.getElementById('recent-jobs-wrap');
    if (Auth.isTechOrContractor()) {
      if (recentWrap) recentWrap.classList.add('hidden');
    } else {
      if (recentWrap) recentWrap.classList.remove('hidden');
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
    }
  }

  function _renderTechTodaySection(allJobs) {
    const container = document.getElementById('tech-today-section');
    if (!container) return;
    const user = Auth.getUser();
    const today = _todayStr();
    const myJobs = allJobs.filter(j => j.assignedTechId === user?.id);
    const todayJobs = myJobs.filter(j =>
      j.scheduledDate === today && !['paid', 'closed'].includes(j.status)
    );
    const thisWeekPaid = myJobs.filter(j =>
      j.status === 'paid' && j.scheduledDate >= _daysAgoStr(6)
    );
    const weekEarnings = thisWeekPaid.reduce((s, j) => s + (parseFloat(j.techPayout) || 0), 0);

    const jobCards = todayJobs.length > 0
      ? todayJobs.map(j => {
          const statusLbl = { new:'New', scheduled:'Sched', in_progress:'Active', follow_up:'Follow-Up' }[j.status] || j.status;
          const statusCls = { new:'sb-new', scheduled:'sb-scheduled', in_progress:'sb-inprogress', follow_up:'sb-follow_up' }[j.status] || 'sb-new';
          return `<div class="tech-today-card" onclick="App.openJobDetail('${j.jobId}')">
            <div class="ttc-left">
              <div class="ttc-time">${j.scheduledTime ? _formatTime(j.scheduledTime) : 'TBD'}</div>
              <div class="ttc-name">${_esc(j.customerName || 'Unknown')}</div>
              <div class="ttc-addr">${_esc(j.address || '')}${j.city ? ', ' + _esc(j.city) : ''}</div>
            </div>
            <div class="ttc-right">
              <span class="status-badge ${statusCls}">${statusLbl}</span>
              ${j.status !== 'in_progress'
                ? `<button class="btn btn-sm btn-primary ttc-btn" onclick="event.stopPropagation();App.setJobStatus('${j.jobId}','in_progress')">Start</button>`
                : `<button class="btn btn-sm btn-success ttc-btn" onclick="event.stopPropagation();App.openJobDetail('${j.jobId}')">Close</button>`}
            </div>
          </div>`;
        }).join('')
      : '<div class="empty-state-sm">No jobs scheduled for today ✓</div>';

    container.innerHTML = `
      <div class="dash-role-card">
        <div class="dash-role-header">Today's Jobs
          <span class="dash-role-badge">${todayJobs.length}</span>
        </div>
        <div class="tech-today-list">${jobCards}</div>
      </div>
      <div class="revenue-grid" style="margin-top:12px">
        <div class="revenue-card">
          <div class="rev-label">This Week Earnings</div>
          <div class="rev-amount" style="color:var(--color-success)">${_fmt(weekEarnings)}</div>
          <div class="rev-count">${thisWeekPaid.length} paid job${thisWeekPaid.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="revenue-card">
          <div class="rev-label">My Total Jobs</div>
          <div class="rev-amount">${myJobs.length}</div>
          <div class="rev-count">all time</div>
        </div>
      </div>`;
    container.classList.remove('hidden');
  }

  function _renderDispatcherSection(allJobs) {
    const container = document.getElementById('dispatcher-section');
    if (!container) return;

    const urgent = allJobs.filter(j => j.status === 'follow_up');
    const unassigned = allJobs.filter(j =>
      ['new', 'scheduled'].includes(j.status) && !j.assignedTechId
    );
    const today = _todayStr();
    const todayJobs = allJobs.filter(j =>
      j.scheduledDate === today && ['scheduled', 'in_progress', 'new'].includes(j.status)
    );

    const urgentHTML = urgent.length > 0
      ? urgent.slice(0, 5).map(j => {
          const daysAgo = j.scheduledDate
            ? Math.floor((Date.now() - new Date(j.scheduledDate+'T00:00:00').getTime()) / 86400000)
            : null;
          const reason = !j.assignedTechId ? 'No tech assigned'
            : daysAgo !== null && daysAgo > 0 ? `Follow-up · ${daysAgo}d overdue`
            : 'Follow-up needed';
          return `
          <div class="urgent-job-row" onclick="App.openJobDetail('${j.jobId}')">
            <div class="urgent-dot"></div>
            <div class="urgent-info">
              <div class="urgent-name">${_esc(j.customerName || 'Unknown')}</div>
              <div class="urgent-addr">${_esc(j.address || '')} · <span style="color:var(--color-warning);font-weight:700">${reason}</span></div>
            </div>
            ${j.phone ? `<button class="btn btn-sm btn-secondary urgent-wa" onclick="event.stopPropagation();App.sendFollowUpWhatsApp('${j.jobId}')" title="Send follow-up WhatsApp">&#128172;</button>` : ''}
          </div>`;
        }).join('')
      : '<div class="empty-state-sm" style="color:var(--color-success)">✓ No follow-ups needed</div>';

    const unassignedHTML = unassigned.length > 0
      ? `<div class="dash-alert-badge">&#9888; ${unassigned.length} unassigned job${unassigned.length > 1 ? 's' : ''}</div>`
      : '';

    container.innerHTML = `
      ${unassignedHTML}
      <div class="dash-role-card" style="${urgent.length > 0 ? 'border-color:rgba(239,68,68,0.3)' : ''}">
        <div class="dash-role-header">
          Needs Attention
          ${urgent.length > 0 ? `<span class="dash-role-badge" style="background:rgba(239,68,68,0.15);color:var(--color-error)">${urgent.length}</span>` : ''}
        </div>
        ${urgentHTML}
      </div>
      <div class="dash-role-card" style="margin-top:12px">
        <div class="dash-role-header">
          Today's Schedule
          <span class="dash-role-badge">${todayJobs.length}</span>
        </div>
        ${todayJobs.length > 0
          ? todayJobs.slice(0, 5).map(j => {
              const tech = j.assignedTechId ? DB.getSettings().technicians.find(t => t.id === j.assignedTechId) : null;
              return `<div class="urgent-job-row" onclick="App.openJobDetail('${j.jobId}')">
                ${tech ? `<div class="urgent-dot" style="background:${tech.color||'#64748B'}"></div>` : '<div class="urgent-dot"></div>'}
                <div class="urgent-info">
                  <div class="urgent-name">${_esc(j.customerName || 'Unknown')}</div>
                  <div class="urgent-addr">${j.scheduledTime ? _formatTime(j.scheduledTime) + ' · ' : ''}${_esc(j.address || '')}${j.city ? ', ' + _esc(j.city) : ''}</div>
                </div>
                <span class="status-badge ${{ new:'sb-new', scheduled:'sb-scheduled', in_progress:'sb-inprogress' }[j.status]||'sb-new'}" style="font-size:10px">${{ new:'New', scheduled:'Sched', in_progress:'Active' }[j.status]||j.status}</span>
              </div>`;
            }).join('')
          : '<div class="empty-state-sm">No jobs today</div>'}
        ${todayJobs.length > 5 ? `<button class="btn-link" style="width:100%;text-align:center" onclick="App.navigate('calendar')">View all ${todayJobs.length} →</button>` : ''}
      </div>`;
    container.classList.remove('hidden');
  }

  function _renderTechPerformance(jobs) {
    const settings  = DB.getSettings();
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

  // ══════════════════════════════════════════════════════════
  // JOB LIST
  // ══════════════════════════════════════════════════════════

  function renderJobList() {
    const container = document.getElementById('jobs-list-container');
    let jobs = DB.searchJobs(_state.jobSearch);

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

    // If kanban view is also open, keep it in sync
    if (_jobsViewMode === 'kanban' && _state.currentView === 'jobs') renderKanban();
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
    const settings = DB.getSettings();
    const statusClass = {
      new: 'jc-new', scheduled: 'jc-scheduled',
      in_progress: 'jc-inprogress', closed: 'jc-closed', paid: 'jc-paid',
      follow_up: 'jc-follow_up',
    }[job.status] || 'jc-new';

    const badgeClass = {
      new: 'sb-new', scheduled: 'sb-scheduled',
      in_progress: 'sb-inprogress', closed: 'sb-closed', paid: 'sb-paid',
      follow_up: 'sb-follow_up',
    }[job.status] || 'sb-new';

    const statusLabel = {
      new: 'New', scheduled: 'Scheduled',
      in_progress: 'In Progress', closed: 'Closed', paid: 'Paid',
      follow_up: 'Follow-Up',
    }[job.status] || job.status;

    const followUpBadge = job.status === 'follow_up'
      ? `<span class="follow-up-badge">&#9888; Follow-Up</span>`
      : '';

    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const techColor = tech?.color || '#64748B';

    // Tech users don't see job total (company margin hidden)
    const total = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;
    const totalStr = Auth.canSeeFinancials() && total > 0 ? _fmt(total) : '—';

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

    const waBtn = Auth.isAdminOrDisp() && job.phone
      ? `<button class="wa-btn" onclick="event.stopPropagation();App.openWhatsApp('${job.jobId}')" title="WhatsApp">&#128172;</button>`
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
            ${followUpBadge}
          </div>
          <div class="job-card-actions">
            ${callBtn}
            ${waBtn}
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

    // Pre-select state from configured default
    const stateField = document.getElementById('f-state');
    if (stateField) {
      const defState = DB.getSettings().defaultState || 'NY';
      stateField.value = defState;
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
      const nameEl  = document.getElementById('f-name');
      const phoneEl = document.getElementById('f-phone');
      const name  = nameEl?.value?.trim();
      const phone = phoneEl?.value?.trim();
      const _highlight = (el) => {
        if (!el) return;
        el.style.borderColor = 'var(--color-error)';
        el.focus();
        setTimeout(() => el.style.borderColor = '', 2500);
      };
      if (!name)  { _highlight(nameEl);  showToast('Customer name is required', 'warning'); return false; }
      if (!phone) { _highlight(phoneEl); showToast('Phone number is required', 'warning');  return false; }
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
    const result = DB.detectReturningCustomer(phone);
    const banner = document.getElementById('returning-banner');
    if (!banner) return;

    if (result && result.isReturning) {
      banner.textContent = `🔄 Returning customer — ${result.jobCount} previous job${result.jobCount > 1 ? 's' : ''}`;
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
    const settings = DB.getSettings();
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
    const settings = DB.getSettings();
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
    const settings = DB.getSettings();
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
    const settings = DB.getSettings();
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
      const settings = DB.getSettings();
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

    const settings = DB.getSettings();

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
      contractorPct: contrPct, taxOption: 'none',
      taxRateNY: settings.taxRateNY, taxRateNJ: settings.taxRateNJ,
    });

    // Use outerHTML but preserve the id so subsequent calls still find it
    previewEl.outerHTML = PayoutEngine.renderBreakdownHTML(calc, techName, 'payout-preview');
  }

  // ── SAVE JOB ─────────────────────────────────────────

  async function saveNewJob() {
    if (!Auth.canCreateJobs()) {
      showToast('Only admins and dispatchers can create jobs', 'error');
      return;
    }
    const name   = document.getElementById('f-name')?.value?.trim();
    const phone  = document.getElementById('f-phone')?.value?.trim();
    const techId = document.getElementById('f-tech-id')?.value;

    if (!name)  { showToast('Enter customer name', 'warning'); return; }
    if (!phone) { showToast('Enter phone number', 'warning');  return; }
    if (!techId){ showToast('Select a technician', 'warning'); return; }

    const total = parseFloat(document.getElementById('f-total-est')?.value) || 0;

    const settings = DB.getSettings();
    const tech = settings.technicians.find(t => t.id === techId);
    const source = document.getElementById('f-source')?.value || 'my_lead';
    const state  = document.getElementById('f-state')?.value  || settings.defaultState || 'NY';

    const parts    = parseFloat(document.getElementById('f-parts-est')?.value) || 0;
    const techPct  = parseFloat(document.getElementById('f-tech-pct')?.value)  || tech?.percent || 0;
    const contrPct = source === 'my_lead' ? 0 : parseFloat(document.getElementById('f-contractor-pct')?.value) || 0;
    const isSelf   = tech?.isOwner || false;

    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parts, techPercent: techPct,
      contractorPct: contrPct, taxOption: 'none',
      taxRateNY: settings.taxRateNY, taxRateNJ: settings.taxRateNJ,
    });

    const job = {
      jobId:           DB.generateId(),
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

    await DB.saveJob(job);

    // Push to Google Sheets immediately
    SyncManager.queueJob(job.jobId);
    SyncManager.syncJob(job).then(r => {
      if (!r.success) showToast('Saved — Sheets sync pending (check Settings URL)', 'warning');
    }).catch(() => {});

    // Clear draft
    DB.clearDraft();

    showToast(`Job saved — ${name}`, 'success');

    // Navigate to job detail
    navigate('job-detail');
    openJobDetail(job.jobId);
  }

  function _autosaveDraft() {
    DB.saveDraft({
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
    const draft = DB.getDraft();
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
    const job = DB.getJobById(jobId);
    if (!job) { showToast('Job not found', 'error'); return; }

    _state.currentJobId = jobId;
    navigate('job-detail');

    const container = document.getElementById('job-detail-content');
    container.innerHTML = _buildJobDetailHTML(job);
  }

  function _buildJobDetailHTML(job) {
    const settings  = DB.getSettings();
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
      taxOption: job.taxOption || 'none',
      isSelfAssigned: job.isSelfAssigned,
      taxRateNY: settings.taxRateNY,
      taxRateNJ: settings.taxRateNJ,
    });

    // Photos
    const photos = job.photos || [];
    const photoHTML = _buildPhotoGrid(job.jobId, photos);

    // Status actions
    const statusActions = _buildStatusActions(job);

    // Close job button (admin/dispatcher only)
    let closeBtn = '';
    if (Auth.canEditAllJobs()) {
      closeBtn = (job.status !== 'paid')
        ? `<button class="quick-close-btn" onclick="App.showCloseJobModal('${job.jobId}')">
             &#10003; Close Job
           </button>`
        : `<div class="quick-close-btn" style="background:var(--color-surface-3);color:var(--color-text-faint);cursor:default;box-shadow:none">
             &#10003; Paid on ${_formatDate(job.paidAt || '')}
           </div>`;
    }

    // WhatsApp — confirmation/appointment msg for customer; financial receipt for paid jobs
    const _waPhone = _cleanPhoneForWA(job.phone);
    const _waMsgCustomer = _waPhone ? encodeURIComponent(_buildWhatsAppConfirmationMsg(job)) : '';
    const _waMsgReceipt  = _waPhone ? encodeURIComponent(_buildWhatsAppJobText(job)) : '';
    const _waHref = _waPhone && job.status === 'paid'
      ? `https://wa.me/${_waPhone}?text=${_waMsgReceipt}`
      : _waPhone
        ? `https://wa.me/${_waPhone}?text=${_waMsgCustomer}`
        : '';
    const waLink = _waPhone
      ? `<a href="${_waHref}" class="detail-action-btn${job.status === 'paid' ? ' dab-green' : ''}" onclick="event.stopPropagation()" target="_blank" rel="noopener noreferrer">
      <span class="dab-icon">&#128172;</span><span class="dab-label">${job.status === 'paid' ? 'Receipt' : 'WhatsApp'}</span>
    </a>`
      : '';

    const callLink = job.phone
      ? `<a href="tel:${job.phone.replace(/\D/g,'')}" class="detail-action-btn dab-green">
           <span class="dab-icon">&#128222;</span><span class="dab-label">Call</span>
         </a>`
      : '';

    const followUpBtn = job.status === 'follow_up' && Auth.isAdminOrDisp() && job.phone
      ? `<button class="detail-action-btn dab-warn" onclick="App.sendFollowUpWhatsApp('${job.jobId}')">
           <span class="dab-icon">&#128172;</span><span class="dab-label">Remind</span>
         </button>`
      : job.status === 'follow_up' && Auth.isAdminOrDisp() && !job.phone
        ? `<div class="detail-action-btn" style="opacity:0.45;cursor:default" title="No phone on file">
             <span class="dab-icon">&#128241;</span><span class="dab-label">No Phone</span>
           </div>`
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
        ${followUpBtn}
        ${job.address ? `<button class="detail-action-btn" onclick="App.navigateToJob('${job.jobId}')"><span class="dab-icon">&#128205;</span><span class="dab-label">Navigate</span></button>` : ''}
        ${Auth.isAdmin() && (parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal)) ? `<button class="detail-action-btn dab-green" onclick="App.openZelleRequest('${job.jobId}')"><span class="dab-icon">&#128178;</span><span class="dab-label">Zelle</span></button>` : ''}
        ${Auth.canEditAllJobs() ? `<button class="detail-action-btn" onclick="App.showEditJobModal('${job.jobId}')"><span class="dab-icon">&#9998;</span><span class="dab-label">Edit</span></button>` : ''}
      </div>

      <!-- Status Actions (change job status) -->
      ${statusActions}

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

      <!-- Financials (admin sees full breakdown; tech sees only their payout) -->
      ${Auth.canSeeFinancials() ? `
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
      </div>` : Auth.isTechOrContractor() && (parseFloat(job.techPayout) > 0 || parseFloat(job.contractorFee) > 0) ? `
      <div class="detail-section collapsed" id="ds-financials">
        <div class="detail-section-title" onclick="App.toggleDetailSection('ds-financials')">
          Your Payout <span class="section-chevron">›</span>
        </div>
        <div class="detail-section-body">
          <div class="detail-row">
            <div class="detail-row-label">Your Payout</div>
            <div class="detail-row-value" style="font-weight:800;color:var(--color-success)">${_fmt(Auth.isContractor() ? parseFloat(job.contractorFee)||0 : parseFloat(job.techPayout)||0)}</div>
          </div>
          <div class="detail-row">
            <div class="detail-row-label">Payment</div>
            <div class="detail-row-value" style="text-transform:capitalize">${job.paymentMethod || '—'}</div>
          </div>
        </div>
      </div>` : ''}

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

      <!-- Danger (admin only) -->
      ${Auth.isAdmin() ? `
      <div style="margin-top:var(--sp-md)">
        <button class="btn btn-danger btn-full" onclick="App.confirmDeleteJob('${job.jobId}')">
          Delete Job
        </button>
      </div>` : ''}
    `;
  }

  function _buildStatusActions(job) {
    const allStatuses = [
      { val:'new',        label:'New',         cls:'sab-new' },
      { val:'scheduled',  label:'Scheduled',   cls:'sab-scheduled' },
      { val:'in_progress',label:'In Progress', cls:'sab-inprogress' },
      { val:'follow_up',  label:'Follow-Up',   cls:'sab-follow_up' },
      { val:'closed',     label:'Closed',      cls:'sab-closed' },
      { val:'paid',       label:'Paid',        cls:'sab-paid' },
    ];

    // Techs can only transition to In Progress or Closed
    const techStatuses = [
      { val:'in_progress',label:'In Progress', cls:'sab-inprogress' },
      { val:'closed',     label:'Closed',      cls:'sab-closed' },
    ];

    const statuses = Auth.isTechOrContractor() ? techStatuses : allStatuses;

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
    const thumbs = photos.map((photo, idx) => {
      const safeSrc = typeof photo.data === 'string' && photo.data.startsWith('data:image/')
        ? photo.data : '';
      return `<img class="photo-thumb" src="${safeSrc}" alt="Photo ${idx+1}"
           onclick="App.viewPhoto('${jobId}', ${idx})">`;
    }).join('');

    const addBtn = `
      <div class="photo-add-btn" onclick="document.getElementById('photo-input-${jobId}').click()">
        <span class="photo-add-icon">+</span>
        <span>Add</span>
      </div>
    `;

    return `<div class="photo-grid">${thumbs}${addBtn}</div>`;
  }

  function setJobStatus(jobId, status) {
    // Techs/contractors can only update status on jobs assigned to them
    if (Auth.isTechOrContractor()) {
      const user = Auth.getUser();
      const j    = DB.getJobById(jobId);
      if (!j || j.assignedTechId !== user?.id) {
        showToast('Not authorized to update this job', 'error');
        return;
      }
      const allowedForTech = ['in_progress', 'closed'];
      if (!allowedForTech.includes(status)) {
        showToast('Techs can only set status to In Progress or Closed', 'warning');
        return;
      }
    } else if (!Auth.canEditAllJobs()) {
      showToast('Not authorized to change job status', 'error');
      return;
    }

    const job = DB.getJobById(jobId);
    if (!job) return;
    if (job.status === 'paid' && status !== 'paid') {
      showToast('Cannot change status of a paid job', 'warning');
      return;
    }

    DB.saveJob({ ...job, status });
    SyncManager.queueJob(jobId);
    showToast(`Status → ${status.replace('_',' ')}`, 'success');

    // Re-render detail
    const container = document.getElementById('job-detail-content');
    const updated = DB.getJobById(jobId);
    if (container && updated) container.innerHTML = _buildJobDetailHTML(updated);
  }

  // ══════════════════════════════════════════════════════════
  // PHOTO UPLOAD
  // ══════════════════════════════════════════════════════════

  function handlePhotoUpload(event, jobId) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    let processed = 0;
    const job = DB.getJobById(jobId);
    if (!job) return;

    const photos = [...(job.photos || [])];
    const MAX_PHOTOS = 5;

    if (photos.length >= MAX_PHOTOS) {
      showToast(`Maximum ${MAX_PHOTOS} photos per job`, 'warning');
      return;
    }

    const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const allowedFiles = files.filter(f => {
      if (!ALLOWED_TYPES.includes(f.type)) {
        showToast(`${f.name}: only JPEG, PNG, WebP, and GIF allowed`, 'warning');
        return false;
      }
      return true;
    }).slice(0, MAX_PHOTOS - photos.length);

    if (!allowedFiles.length) return;
    allowedFiles.forEach(file => {

      const reader = new FileReader();
      reader.onload = (e) => {
        _compressImage(e.target.result, 800, 0.75, (compressed) => {
          photos.push({
            data:  compressed,
            name:  file.name,
            addedAt: new Date().toISOString(),
          });
          processed++;

          if (processed === allowedFiles.length) {
            DB.saveJob({ ...job, photos });
            showToast(`${allowedFiles.length} photo${allowedFiles.length > 1 ? 's' : ''} added`, 'success');
            const updated = DB.getJobById(jobId);
            const container = document.getElementById('job-detail-content');
            if (container && updated) container.innerHTML = _buildJobDetailHTML(updated);
            SyncManager.queueJob(jobId);
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
    const job = DB.getJobById(jobId);
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
    const job = DB.getJobById(jobId);
    if (!job || !job.photos) return;
    const photos = [...job.photos];
    photos.splice(idx, 1);
    DB.saveJob({ ...job, photos });
    closeModal();
    showToast('Photo deleted', 'success');
    // Refresh detail
    const container = document.getElementById('job-detail-content');
    const updated = DB.getJobById(jobId);
    if (container && updated) container.innerHTML = _buildJobDetailHTML(updated);
  }

  // ══════════════════════════════════════════════════════════
  // CLOSE JOB MODAL
  // ══════════════════════════════════════════════════════════

  function showCloseJobModal(jobId) {
    if (!Auth.canEditAllJobs()) {
      showToast('Not authorized to close jobs', 'error');
      return;
    }
    const job = DB.getJobById(jobId);
    if (!job) return;
    if (job.status === 'paid') { showToast('Job already paid', 'info'); return; }

    _state.closeJobId = jobId;

    const settings = DB.getSettings();
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
                 placeholder="0.00" step="0.01" min="0" value="${job.partsCost || ''}"
                 oninput="App._updateClosePreview()">
        </div>
      </div>

      <div class="field-group">
        <label class="field-label">Tax</label>
        <div class="payment-methods" id="close-tax-picker">
          <button class="pay-btn ${!job.taxOption||job.taxOption==='none'?'active':''}" data-tax="none" onclick="App._closeTaxSelect(this)">No Tax</button>
          <button class="pay-btn ${job.taxOption==='ny'?'active':''}" data-tax="ny" onclick="App._closeTaxSelect(this)">NY Tax</button>
          <button class="pay-btn ${job.taxOption==='nj'?'active':''}" data-tax="nj" onclick="App._closeTaxSelect(this)">NJ Tax</button>
        </div>
        <input type="hidden" id="close-tax-option" value="${job.taxOption||'none'}">
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

  function _closeTaxSelect(btn) {
    document.querySelectorAll('#close-tax-picker .pay-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const h = document.getElementById('close-tax-option');
    if (h) h.value = btn.dataset.tax;
    _updateClosePreview();
  }

  function _updateClosePreview() {
    const job  = _state.closeJobId ? DB.getJobById(_state.closeJobId) : null;
    if (!job)  return;

    const settings = DB.getSettings();
    const total  = parseFloat(document.getElementById('close-total')?.value) || 0;
    const parts  = parseFloat(document.getElementById('close-parts')?.value) || 0;

    if (total === 0) {
      const prev = document.getElementById('close-payout-preview');
      if (prev) prev.innerHTML = '<div class="empty-state-sm">Enter job total above</div>';
      return;
    }

    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const taxOption = document.getElementById('close-tax-option')?.value || 'none';
    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parts,
      techPercent: parseFloat(job.techPercent) || 0,
      contractorPct: parseFloat(job.contractorPct) || 0,
      taxOption,
      isSelfAssigned: job.isSelfAssigned,
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
    if (!Auth.canEditAllJobs()) {
      showToast('Not authorized to close jobs', 'error');
      return;
    }
    const job = DB.getJobById(jobId);
    if (!job) return;

    const total     = parseFloat(document.getElementById('close-total')?.value) || 0;
    const parts     = parseFloat(document.getElementById('close-parts')?.value) || 0;
    const method    = document.getElementById('close-pay-method')?.value || 'cash';
    const taxOption = document.getElementById('close-tax-option')?.value || 'none';

    const settings = DB.getSettings();
    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;

    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parts,
      techPercent: parseFloat(job.techPercent) || 0,
      contractorPct: parseFloat(job.contractorPct) || 0,
      taxOption,
      isSelfAssigned: job.isSelfAssigned,
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
      taxOption,
      taxAmount:     calc.taxAmount,
      techPayout:    calc.techPayout,
      ownerPayout:   calc.ownerPayout,
      contractorFee: calc.contractorFee,
      paymentMethod: method,
      paidAt:        new Date().toISOString(),
      zelleMemo,
    };

    DB.saveUndo(DB.getJobById(jobId));
    DB.saveJob(updated);
    SyncManager.queueJob(jobId);

    // Push to Google Sheets immediately, show result
    SyncManager.syncJob(updated).then(r => {
      if (r.success) showToast('Synced to Google Sheets', 'success');
      else showToast('Saved — Sheets sync pending (check Settings URL)', 'warning');
    }).catch(() => {});

    closeModal();
    const _myTake = calc.isSelfAssigned
      ? calc.ownerPayout + calc.techPayout
      : calc.ownerPayout;
    showToast(calc.isSelfAssigned
      ? `Paid! Your take: ${_fmt(_myTake)}`
      : `Paid! Owner: ${_fmt(calc.ownerPayout)} · Tech: ${_fmt(calc.techPayout)}`,
      'success');

    // Refresh detail view
    const container = document.getElementById('job-detail-content');
    const refreshed = DB.getJobById(jobId);
    if (container && refreshed) container.innerHTML = _buildJobDetailHTML(refreshed);

    // Offer Zelle memo to admin only
    if (Auth.canSeeZelleMemo() && tech && calc.techPayout > 0) {
      setTimeout(() => showZelleMemo(jobId), 600);
    }
  }

  // ══════════════════════════════════════════════════════════
  // ZELLE DEEP LINK (customer payment request)
  function openZelleRequest(jobId) {
    const job = DB.getJobById(jobId);
    if (!job) return;
    const amount = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;
    if (!amount) { showToast('No amount set on this job', 'warning'); return; }
    const dateStr = job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const service = job.description ? job.description.substring(0, 40) : 'Service';
    const memo = `On Point Pro Doors${dateStr ? ' · ' + dateStr : ''} · ${service}`;
    const zelleUrl = `zelle://send?amount=${amount.toFixed(2)}&memo=${encodeURIComponent(memo)}`;
    window.location.href = zelleUrl;
  }

  // ZELLE MEMO
  // ══════════════════════════════════════════════════════════

  function showZelleMemo(jobId) {
    if (!Auth.canSeeZelleMemo()) return;
    const job = DB.getJobById(jobId);
    if (!job) return;

    const settings = DB.getSettings();
    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const memo = job.zelleMemo || '';

    const _zelleWaPhone = _cleanPhoneForWA(job.phone) || '';
    const waMsg  = encodeURIComponent(_buildWhatsAppJobText(job));
    const waHref = `https://wa.me/${_zelleWaPhone}?text=${waMsg}`;

    const body = document.getElementById('modal-zelle-body');
    body.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
        Memo for ${tech ? _esc(tech.name) : 'Tech'}
      </div>
      <div class="zelle-memo-box" style="white-space:pre-wrap;user-select:all">${_esc(memo)}</div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-primary" style="flex:1" onclick="App._copyZelleMemo('${jobId}')">
          &#128203; Copy Memo
        </button>
        <a href="${waHref}" class="btn btn-secondary" style="flex:1;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px">
          &#128196; Receipt
        </a>
      </div>
    `;

    showModal('modal-zelle');
  }

  function _copyZelleMemo(jobId) {
    const job = DB.getJobById(jobId);
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
    if (!Auth.canEditAllJobs()) {
      showToast('Not authorized to edit jobs', 'error');
      return;
    }
    const job = DB.getJobById(jobId);
    if (!job) return;
    if (job.status === 'paid') { showToast('Cannot edit a paid job', 'warning'); return; }

    const settings = DB.getSettings();

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
            ${['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map(s => `<option value="${s}" ${(job.state||'NY')===s?'selected':''}>${s}</option>`).join('')}
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
    if (!Auth.canEditAllJobs()) {
      showToast('Not authorized to edit jobs', 'error');
      return;
    }
    const job = DB.getJobById(jobId);
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

    DB.saveJob(updated);
    SyncManager.queueJob(jobId);
    closeModal();
    showToast('Job updated', 'success');

    // Refresh detail
    const container = document.getElementById('job-detail-content');
    const refreshed = DB.getJobById(jobId);
    if (container && refreshed) container.innerHTML = _buildJobDetailHTML(refreshed);
  }

  // ══════════════════════════════════════════════════════════
  // DELETE JOB
  // ══════════════════════════════════════════════════════════

  function confirmDeleteJob(jobId) {
    if (!Auth.isAdmin()) {
      showToast('Only admins can delete jobs', 'error');
      return;
    }
    const job = DB.getJobById(jobId);
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
    if (!Auth.isAdmin()) return; // second guard
    const job = DB.getJobById(jobId);
    DB.saveUndo(job);
    DB.deleteJob(jobId);
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

    const jobs = DB.getJobsByDate(dateStr);
    const settings = DB.getSettings();
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
    const job = DB.getJobById(jobId);
    if (!job) { showToast('Job not found', 'error'); return; }

    const parts = [job.address, job.city, job.state, job.zip].filter(Boolean);
    if (!parts.length) { showToast('No address on this job', 'warning'); return; }

    const encoded = encodeURIComponent(parts.join(', '));
    window.open('https://maps.apple.com/?daddr=' + encoded, '_blank');
  }

  function exportJobPDF(jobId) {
    const job = DB.getJobById(jobId);
    if (!job) { showToast('Job not found', 'error'); return; }

    const settings = DB.getSettings();
    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const total = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;

    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parseFloat(job.partsCost)||0,
      techPercent: parseFloat(job.techPercent)||0,
      contractorPct: parseFloat(job.contractorPct)||0,
      taxOption: job.taxOption || 'none',
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
    const s = DB.getSettings();
    const user = Auth.getUser();
    const isAdmin = Auth.isAdmin();

    // MY INFO — non-admin sees their own profile; admin sees business settings
    if (isAdmin) {
      _setVal('s-owner-name',  s.ownerName);
      _setVal('s-owner-phone', s.ownerPhone);
      _setVal('s-owner-zelle', s.ownerZelle);
    } else {
      _setVal('s-owner-name',  user?.name  || '');
      _setVal('s-owner-phone', user?.phone || '');
    }

    // Admin-only settings
    _setVal('s-tax-ny',          s.taxRateNY);
    _setVal('s-tax-nj',          s.taxRateNJ);
    _setVal('s-apps-script-url', s.appsScriptUrl);
    _setVal('s-default-state',   s.defaultState);

    // Zelle handle visible to admin only
    const zelleGroup = document.getElementById('s-zelle-group');
    if (zelleGroup) zelleGroup.classList.toggle('hidden', !Auth.canSeeZelleMemo());

    // Hide all admin-only settings sections from tech/contractor/dispatcher
    ['settings-tax-card','settings-tech-card','settings-sources-card',
     'settings-sync-card','settings-data-card','settings-defaultstate-group'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !isAdmin);
    });

    // Save button label differs by role
    const saveBtn = document.getElementById('settings-save-btn');
    if (saveBtn) saveBtn.textContent = isAdmin ? 'Save Settings' : 'Update My Profile';

    if (isAdmin) {
      _renderTechList(s.technicians);
      _renderSourceList(s.leadSources);
      _renderAdminUsersSection().catch(() => {});
    }
  }

  async function _renderAdminUsersSection() {
    const container = document.getElementById('admin-users-section');
    if (!container) return;

    container.innerHTML = `<div class="settings-card">
      <div class="settings-section-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Users</span>
        <button class="btn btn-primary" style="padding:6px 14px;font-size:13px" onclick="App.showInviteModal()">+ Invite User</button>
      </div>
      <div id="admin-users-list"><div class="empty-state-sm">Loading users...</div></div>
    </div>`;
    container.classList.remove('hidden');

    try {
      const users = await Auth.getUsersForAdmin();
      const currentUserId = Auth.getUser()?.id;
      const listEl = document.getElementById('admin-users-list');
      if (!listEl) return;

      listEl.innerHTML = users.map(u => `
        <div class="user-list-item">
          <div class="user-item-avatar" style="background:${u.color||'#3B82F6'}">${_initials(u.name||u.id)}</div>
          <div class="user-item-info">
            <div class="user-item-name">${_esc(u.name || 'Unknown')}</div>
            <div class="user-item-email">${_esc(u.email||'')}</div>
          </div>
          <div class="user-item-role" style="display:flex;align-items:center;gap:6px">
            <select class="field-input" style="font-size:12px;padding:4px 8px;height:32px"
                    onchange="App._changeUserRole('${u.id}', this.value)">
              <option value="admin"      ${u.role==='admin'      ?'selected':''}>Admin</option>
              <option value="dispatcher" ${u.role==='dispatcher' ?'selected':''}>Dispatcher</option>
              <option value="tech"       ${u.role==='tech'       ?'selected':''}>Tech</option>
              <option value="contractor" ${u.role==='contractor' ?'selected':''}>Contractor</option>
            </select>
            ${u.phone ? `<button class="btn-icon" style="color:#25D366;font-size:18px" title="Send app link on WhatsApp"
              onclick="App._sendUserWALink(${JSON.stringify(u.name||'')},${JSON.stringify(u.email||'')},${JSON.stringify(u.phone||'')})">&#128241;</button>` : ''}
            ${u.id !== currentUserId ? `<button class="btn-icon" style="color:var(--color-error);font-size:16px"
              onclick="App._confirmRemoveUser('${u.id}','${_esc(u.name||u.email)}')" title="Remove user">&#128465;</button>` : ''}
          </div>
        </div>
      `).join('') || '<div class="empty-state-sm">No users found</div>';
    } catch (e) {
      const listEl = document.getElementById('admin-users-list');
      if (listEl) listEl.innerHTML = `<div class="empty-state-sm" style="color:var(--color-error)">${_esc(e.message)}</div>`;
    }
  }

  function showInviteModal() {
    if (!Auth.isAdmin()) return;
    const modal = document.getElementById('invite-modal');
    if (!modal) return;
    document.getElementById('invite-name').value  = '';
    document.getElementById('invite-email').value = '';
    document.getElementById('invite-phone').value = '';
    document.getElementById('invite-role').value  = 'tech';
    document.getElementById('invite-error').classList.add('hidden');
    document.getElementById('invite-form-body').classList.remove('hidden');
    document.getElementById('invite-success-body').classList.add('hidden');
    const btn = document.getElementById('invite-submit-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Send Invite'; }
    modal.classList.remove('hidden');
  }

  function closeInviteModal() {
    document.getElementById('invite-modal')?.classList.add('hidden');
  }

  function _buildWAAppLinkMsg(name, email) {
    return `Hi ${name}, welcome to OnPoint Pro Doors CRM!\n\n` +
      `Download and install the app on your phone:\n\n` +
      `1. Open this link: https://crm.onpointprodoors.com\n` +
      `2. Tap the Share button \u2191 at the bottom\n` +
      `3. Tap Add to Home Screen\n` +
      `4. The app installs like a real app\n\n` +
      (email ? `Check your email (${email}) for your invite link to set your password.\n\nOnce you set your password, open the app and log in.\n\n` : '') +
      `Any questions call (929) 429-2429.\n\n` +
      `- OnPoint Pro Doors`;
  }

  function _openWAWithMsg(phone, msg) {
    const digits = String(phone).replace(/\D/g, '');
    const waPhone = digits.length === 10 ? '1' + digits : digits;
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function _sendInviteWA() {
    const msg = _buildWAAppLinkMsg(_lastInvite.name, _lastInvite.email);
    _openWAWithMsg(_lastInvite.phone, msg);
  }

  function _sendInviteWAFromInput() {
    const phone = document.getElementById('invite-wa-phone-input')?.value?.trim() || '';
    if (!phone.replace(/\D/g, '')) { showToast('Enter a phone number', 'warning'); return; }
    const msg = _buildWAAppLinkMsg(_lastInvite.name, _lastInvite.email);
    _openWAWithMsg(phone, msg);
  }

  function _sendUserWALink(name, email, phone) {
    const msg = _buildWAAppLinkMsg(name || 'there', email || null);
    _openWAWithMsg(phone, msg);
  }

  async function submitInvite() {
    if (!Auth.isAdmin()) { showToast('Not authorized', 'error'); return; }
    const name  = document.getElementById('invite-name')?.value?.trim();
    const email = document.getElementById('invite-email')?.value?.trim();
    const phone = document.getElementById('invite-phone')?.value?.trim() || '';
    const role  = document.getElementById('invite-role')?.value;
    const errEl = document.getElementById('invite-error');
    const btn   = document.getElementById('invite-submit-btn');

    errEl.classList.add('hidden');

    if (!name) {
      errEl.textContent = 'Full name is required.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!email || !email.includes('@')) {
      errEl.textContent = 'A valid email address is required.';
      errEl.classList.remove('hidden');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Sending invite\u2026';

    try {
      await Auth.inviteUser(email, name, role, phone);

      _lastInvite = { name, email, phone };
      _renderAdminUsersSection().catch(() => {});

      document.getElementById('invite-form-body').classList.add('hidden');
      document.getElementById('invite-success-body').classList.remove('hidden');
      document.getElementById('invite-success-email').textContent = email;

      const hasPhone = phone.replace(/\D/g, '').length >= 7;
      document.getElementById('invite-wa-with-phone').classList.toggle('hidden', !hasPhone);
      document.getElementById('invite-wa-no-phone').classList.toggle('hidden', hasPhone);

    } catch (e) {
      errEl.textContent = e.message || 'Invite failed.';
      errEl.classList.remove('hidden');
      btn.disabled    = false;
      btn.textContent = 'Send Invite';
    }
  }

  async function _confirmRemoveUser(userId, userName) {
    showConfirm({
      icon:    '&#128465;',
      title:   'Remove User',
      message: `Remove ${userName} from the app? This cannot be undone.`,
      okLabel: 'Remove',
      okClass: 'btn-danger',
      onOk: async () => {
        try {
          await Auth.removeUser(userId);
          showToast(`${userName} removed`, 'success');
          _renderAdminUsersSection();
        } catch (e) {
          showToast(e.message, 'error');
        }
      },
    });
  }

  async function _changeUserRole(userId, role) {
    try {
      await Auth.updateUserRole(userId, role);
      showToast(`Role updated to ${role}`, 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function saveSettings() {
    // Non-admin: save only their own profile (name + phone)
    if (!Auth.isAdmin()) {
      const name  = document.getElementById('s-owner-name')?.value?.trim()  || '';
      const phone = document.getElementById('s-owner-phone')?.value?.trim() || '';
      if (!name) { showToast('Name is required', 'warning'); return; }
      try {
        await Auth.updateProfile({ name, phone });
        showToast('Profile updated', 'success');
        _updateHeaderUser();
      } catch (e) {
        showToast('Failed to update profile: ' + (e.message || 'unknown error'), 'error');
      }
      return;
    }
    const settings = {
      ownerName:     document.getElementById('s-owner-name')?.value?.trim()      || '',
      ownerPhone:    document.getElementById('s-owner-phone')?.value?.trim()     || '',
      ownerZelle:    document.getElementById('s-owner-zelle')?.value?.trim()     || '',
      taxRateNY:     parseFloat(document.getElementById('s-tax-ny')?.value)       || 8.875,
      taxRateNJ:     parseFloat(document.getElementById('s-tax-nj')?.value)       || 6.625,
      appsScriptUrl: document.getElementById('s-apps-script-url')?.value?.trim() || '',
      defaultState:  document.getElementById('s-default-state')?.value           || 'NY',
    };

    if (settings.taxRateNY < 0 || settings.taxRateNY > 20) {
      showToast('NY tax rate must be between 0-20%', 'warning'); return;
    }
    if (settings.taxRateNJ < 0 || settings.taxRateNJ > 20) {
      showToast('NJ tax rate must be between 0-20%', 'warning'); return;
    }

    try {
      await DB.saveSettings(settings);
      showToast('Settings saved', 'success');
    } catch (e) {
      showToast('Failed to save settings: ' + (e.message || 'unknown error'), 'error');
    }
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
    // New technicians are added via the Invite User flow, not the tech modal
    if (!techId) { showInviteModal(); return; }
    const settings = DB.getSettings();
    const tech = techId ? settings.technicians.find(t => t.id === techId) : null;
    const title = document.getElementById('tech-modal-title');
    if (title) title.textContent = tech ? 'Edit Technician' : 'Add Technician';

    document.getElementById('m-tech-id').value         = tech?.id        || '';
    document.getElementById('m-tech-name').value       = tech?.name      || '';
    document.getElementById('m-tech-phone').value      = tech?.phone     || '';
    document.getElementById('m-tech-pct').value        = tech?.percent   || '';
    document.getElementById('m-tech-zelle').value      = tech?.zelle || '';
    document.getElementById('m-tech-zips').value       = tech?.zipCodes?.join(', ') || '';
    document.getElementById('m-tech-color').value      = tech?.color     || '#3B82F6';
    document.getElementById('m-tech-is-owner').checked = tech?.isOwner   || false;

    showModal('modal-tech');
  }

  async function saveTech() {
    if (!Auth.isAdmin()) {
      showToast('Only admins can manage technicians', 'error');
      return;
    }
    const name = document.getElementById('m-tech-name')?.value?.trim();
    if (!name) { showToast('Enter technician name', 'warning'); return; }

    const pct = parseFloat(document.getElementById('m-tech-pct')?.value) || 0;
    if (pct < 0 || pct > 100) { showToast('Payout % must be 0-100', 'warning'); return; }

    const existingId = document.getElementById('m-tech-id')?.value;
    if (!existingId) {
      showToast('To add a technician, use the Invite User button above', 'warning');
      return;
    }

    const zipsRaw  = document.getElementById('m-tech-zips')?.value || '';
    const zipCodes = zipsRaw.split(',').map(z => z.trim()).filter(z => /^\d{5}$/.test(z));
    const isOwner  = document.getElementById('m-tech-is-owner')?.checked || false;
    const zelle    = document.getElementById('m-tech-zelle')?.value?.trim()  || '';
    const phone    = document.getElementById('m-tech-phone')?.value?.trim()  || '';
    const color    = document.getElementById('m-tech-color')?.value          || '#3B82F6';

    try {
      await DB.updateTechProfile(existingId, { name, phone, color, percent: pct, zelle, zipCodes, isOwner });

      const settings = DB.getSettings();
      const techs = [...(settings.technicians || [])];
      if (isOwner) techs.forEach(t => { if (t.id !== existingId) t.isOwner = false; });
      const idx = techs.findIndex(t => t.id === existingId);
      const updated = { id: existingId, name, phone, color, percent: pct, zelle, zipCodes, isOwner };
      if (idx >= 0) techs[idx] = updated; else techs.push(updated);
      Storage.saveSettings({ ...settings, technicians: techs });

      _renderTechList(techs);
      _renderTechSelector();
      closeModal();
      showToast(`${name} saved`, 'success');
    } catch (e) {
      showToast('Failed to save technician: ' + (e.message || 'unknown error'), 'error');
    }
  }

  function deleteTech(techId) {
    if (!Auth.isAdmin()) {
      showToast('Only admins can manage technicians', 'error');
      return;
    }
    const settings = DB.getSettings();
    const tech = (settings.technicians || []).find(t => t.id === techId);
    showConfirm({
      icon: '&#128465;',
      title: 'Remove Technician?',
      message: `Remove ${tech ? tech.name : 'this person'} from the technician list? This also removes their profile from the system.`,
      okLabel: 'Remove',
      onOk: async () => {
        try {
          await DB.deleteProfile(techId);
          const updated = (settings.technicians || []).filter(t => t.id !== techId);
          const s = DB.getSettings();
          Storage.saveSettings({ ...s, technicians: updated });
          _renderTechList(updated);
          _renderTechSelector();
          showToast('Technician removed', 'success');
        } catch (e) {
          showToast('Failed to remove: ' + (e.message || 'unknown error'), 'error');
        }
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
    const settings = DB.getSettings();
    const source = sourceId ? settings.leadSources.find(s => s.id === sourceId) : null;
    const title = document.getElementById('source-modal-title');
    if (title) title.textContent = source ? 'Edit Lead Source' : 'Add Lead Source';

    document.getElementById('m-source-id').value   = source?.id   || '';
    document.getElementById('m-source-name').value = source?.name || '';
    document.getElementById('m-source-pct').value  = source?.contractorPercent || '';

    showModal('modal-source');
  }

  async function saveSource() {
    if (!Auth.isAdmin()) {
      showToast('Only admins can manage lead sources', 'error');
      return;
    }
    const name = document.getElementById('m-source-name')?.value?.trim();
    if (!name) { showToast('Enter source name', 'warning'); return; }

    const pct = parseFloat(document.getElementById('m-source-pct')?.value) || 0;
    const settings = DB.getSettings();
    const sources = [...(settings.leadSources || [])];
    const existingId = document.getElementById('m-source-id')?.value;

    const data = {
      id: existingId || DB.generateId(),
      name,
      contractorPercent: pct,
    };

    if (existingId) {
      const idx = sources.findIndex(s => s.id === existingId);
      if (idx >= 0) sources[idx] = data; else sources.push(data);
    } else {
      sources.push(data);
    }

    await DB.saveSettings({ leadSources: sources });
    _renderSourceList(sources);
    _populateSourceDropdown();
    closeModal();
    showToast(`${name} saved`, 'success');
  }

  function deleteSource(sourceId) {
    if (!Auth.isAdmin()) {
      showToast('Only admins can manage lead sources', 'error');
      return;
    }
    showConfirm({
      icon: '&#128465;',
      title: 'Delete Source?',
      message: 'Remove this lead source?',
      okLabel: 'Delete',
      onOk: async () => {
        const settings = DB.getSettings();
        const sources = (settings.leadSources || []).filter(s => s.id !== sourceId);
        await DB.saveSettings({ leadSources: sources });
        _renderSourceList(sources);
        _populateSourceDropdown();
        showToast('Source deleted', 'success');
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  // KANBAN PIPELINE VIEW
  // ══════════════════════════════════════════════════════════

  function toggleJobsView() {
    _jobsViewMode = _jobsViewMode === 'list' ? 'kanban' : 'list';
    localStorage.setItem('op_jobs_view', _jobsViewMode);
    const listEl   = document.getElementById('jobs-list-container');
    const boardEl  = document.getElementById('jobs-kanban-board');
    const toggleEl = document.getElementById('btn-toggle-view');
    if (_jobsViewMode === 'kanban') {
      if (listEl)   listEl.classList.add('hidden');
      if (boardEl)  boardEl.classList.remove('hidden');
      if (toggleEl) toggleEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="5" height="14" rx="1"/><rect x="10" y="1" width="5" height="14" rx="1"/></svg>';
      renderKanban();
    } else {
      if (listEl)   listEl.classList.remove('hidden');
      if (boardEl)  boardEl.classList.add('hidden');
      if (toggleEl) toggleEl.innerHTML = '&#9776;';
      renderJobList();
    }
  }

  function renderKanban() {
    const board = document.getElementById('jobs-kanban-board');
    if (!board) return;

    let jobs = DB.searchJobs(_state.jobSearch);

    const statuses = [
      { val: 'new',         label: 'New',         cls: 'kc-new' },
      { val: 'scheduled',   label: 'Scheduled',   cls: 'kc-scheduled' },
      { val: 'in_progress', label: 'In Progress', cls: 'kc-inprogress' },
      { val: 'follow_up',   label: 'Follow-Up',   cls: 'kc-followup' },
      { val: 'closed',      label: 'Closed',      cls: 'kc-closed' },
      { val: 'paid',        label: 'Paid',         cls: 'kc-paid' },
    ];

    board.innerHTML = statuses.map(s => {
      const colJobs = jobs.filter(j => j.status === s.val);
      return _kanbanColumn(s.val, s.label, s.cls, colJobs);
    }).join('');

    // Wire drag-and-drop
    board.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', card.dataset.jobId);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    board.querySelectorAll('.kanban-column').forEach(col => {
      col.addEventListener('dragover', e => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', e => {
        if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
      });
      col.addEventListener('drop', e => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const jobId    = e.dataTransfer.getData('text/plain');
        const newStatus = col.dataset.status;
        if (!jobId || !newStatus) return;
        const job = DB.getJobById(jobId);
        if (!job) return;
        if (job.status === newStatus) return;
        if (job.status === 'paid') { showToast('Cannot change status of a paid job', 'warning'); return; }
        if (newStatus === 'paid')  { showToast('Use "Close Job" to mark as paid', 'info'); return; }
        if (Auth.isTechOrContractor()) {
          const allowed = ['in_progress', 'closed'];
          if (!allowed.includes(newStatus)) { showToast('Techs can only move to In Progress or Closed', 'warning'); return; }
        }
        DB.saveJob({ ...job, status: newStatus });
        SyncManager.queueJob(jobId);
        showToast(`${_esc(job.customerName || 'Job')} → ${newStatus.replace('_', ' ')}`, 'success');
        renderKanban();
      });

      // Touch drag support (simplified: tap to open, long-press not needed for touch)
      col.addEventListener('touchend', () => col.classList.remove('drag-over'));
    });
  }

  function _kanbanColumn(status, label, cls, jobs) {
    const cards = jobs.map(j => _kanbanCard(j)).join('');
    return `<div class="kanban-column ${cls}" data-status="${status}">
      <div class="kanban-col-header">
        <span class="kanban-col-title">${label}</span>
        <span class="kanban-col-count">${jobs.length}</span>
      </div>
      <div class="kanban-col-body">
        ${jobs.length === 0 ? '<div class="kanban-empty">Empty</div>' : cards}
      </div>
    </div>`;
  }

  function _kanbanCard(job) {
    const settings = DB.getSettings();
    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const total = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;
    const totalStr = Auth.canSeeFinancials() && total > 0 ? _fmt(total) : '';
    const timeStr = job.scheduledTime ? _formatTime(job.scheduledTime) : '';
    const dateStr = job.scheduledDate ? _formatDate(job.scheduledDate) : '';
    const isFollowUp = job.status === 'follow_up';
    return `<div class="kanban-card${isFollowUp ? ' kanban-card-urgent' : ''}" draggable="true" data-job-id="${job.jobId}"
         onclick="App.openJobDetail('${job.jobId}')">
      <div class="kanban-card-name">${_esc(job.customerName || 'Unknown')}</div>
      ${job.address ? `<div class="kanban-card-addr">${_esc(job.address)}${job.city ? ', ' + _esc(job.city) : ''}</div>` : ''}
      ${dateStr ? `<div class="kanban-card-date">${dateStr}${timeStr ? ' · ' + timeStr : ''}</div>` : ''}
      <div class="kanban-card-footer">
        ${tech ? `<span class="kanban-card-tech" style="color:${tech.color || '#64748B'}">● ${_esc(tech.name)}</span>` : '<span></span>'}
        ${totalStr ? `<span class="kanban-card-total">${totalStr}</span>` : ''}
      </div>
    </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // DARK MODE
  // ══════════════════════════════════════════════════════════

  function _initDarkMode() {
    // Dark navy is the default — only apply light if user explicitly chose it
    const savedMode = localStorage.getItem('op_dark_mode');
    if (savedMode === '0') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme'); // default = dark navy
    }
    _updateDarkModeBtn();
  }

  function _updateDarkModeBtn() {
    const btn = document.getElementById('btn-dark-mode');
    if (!btn) return;
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    btn.innerHTML = isLight
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  }

  function toggleDarkMode() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
      document.documentElement.removeAttribute('data-theme'); // back to dark navy
      localStorage.setItem('op_dark_mode', '1');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('op_dark_mode', '0');
    }
    _updateDarkModeBtn();
  }

  // ══════════════════════════════════════════════════════════
  // PULL TO REFRESH
  // ══════════════════════════════════════════════════════════

  function _initPullToRefresh() {
    const mainContent = document.getElementById('main-content');
    const indicator   = document.getElementById('ptr-indicator');
    if (!mainContent || !indicator) return;

    const THRESHOLD = 70;

    mainContent.addEventListener('touchstart', e => {
      const active = document.querySelector('.view.active');
      if (active && active.scrollTop === 0) {
        _ptr.startY  = e.touches[0].clientY;
        _ptr.pulling = true;
        indicator.classList.remove('ptr-loading', 'ptr-ready');
      }
    }, { passive: true });

    mainContent.addEventListener('touchmove', e => {
      if (!_ptr.pulling) return;
      const delta = e.touches[0].clientY - _ptr.startY;
      if (delta > THRESHOLD) {
        indicator.classList.add('ptr-ready');
      } else {
        indicator.classList.remove('ptr-ready');
      }
    }, { passive: true });

    mainContent.addEventListener('touchend', async () => {
      if (!_ptr.pulling) return;
      _ptr.pulling = false;
      if (!indicator.classList.contains('ptr-ready')) return;
      indicator.classList.remove('ptr-ready');
      indicator.classList.add('ptr-loading');
      try {
        await DB._syncJobsDown();
        renderDashboard();
        renderJobList();
        if (_jobsViewMode === 'kanban') renderKanban();
        showToast('Refreshed', 'success', 1500);
      } finally {
        setTimeout(() => indicator.classList.remove('ptr-loading'), 600);
      }
    }, { passive: true });
  }

  // ══════════════════════════════════════════════════════════
  // FOLLOW-UP WHATSAPP REMIND
  // ══════════════════════════════════════════════════════════

  function sendFollowUpWhatsApp(jobId) {
    const job = DB.getJobById(jobId);
    if (!job) return;
    if (!job.phone) { showToast('No phone number on file', 'warning'); return; }

    const cleanPhone = _cleanPhoneForWA(job.phone);
    if (!cleanPhone) { showToast('Invalid phone number', 'warning'); return; }

    const settings = DB.getSettings();
    const ownerPhone = settings.ownerPhone || '(929) 429-2429';

    const firstName = (job.customerName || 'there').split(' ')[0];
    const serviceNote = job.description ? ` regarding your ${_esc(job.description)}` : '';
    const msg = [
      `Hi ${_esc(firstName)}! 👋`,
      '',
      `This is On Point Pro Doors checking in${serviceNote}.`,
      '',
      `We want to make sure your garage door issue is fully resolved. Is everything working properly, or would you like to schedule a follow-up visit?`,
      '',
      `We're available 7 days a week — just reply here or give us a call:`,
      `📞 ${ownerPhone}`,
      '',
      `Thank you for choosing On Point Pro Doors! 🏠`,
    ].join('\n');

    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  }

  // ══════════════════════════════════════════════════════════
  // SYNC
  // ══════════════════════════════════════════════════════════

  async function syncAll() {
    if (SyncManager.isSyncing()) { showToast('Sync already in progress', 'info'); return; }

    // Force-mark ALL jobs as pending so they all get pushed regardless of prior sync status
    const allJobs = DB.getJobs();
    allJobs.forEach(j => DB.saveJob({ ...j, syncStatus: 'pending' }));

    const syncBtn = document.getElementById('btn-sync');
    if (syncBtn) syncBtn.classList.add('syncing');
    showToast(`Syncing ${allJobs.length} jobs to Google Sheets...`, 'info');

    try {
      const result = await SyncManager.syncAll();
      if (result.success) {
        showToast(`Synced ${result.synced || 0} jobs to Google Sheets`, 'success');
      } else {
        showToast(result.error || 'Sync failed — check Apps Script URL in Settings', 'error');
      }
    } catch (e) {
      showToast('Sync error — check Apps Script URL in Settings', 'error');
      console.warn('syncAll error:', e.message);
    } finally {
      if (syncBtn) syncBtn.classList.remove('syncing');
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
    const data = DB.exportAll();
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
        Storage.clearAll(); // local cache clear only
        showToast('Local cache cleared', 'warning');
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
    const settings  = DB.getSettings();
    const tech      = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;
    const total     = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;
    const address   = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');

    const lines = [
      '*ON POINT HOME SERVICES*',
      `Ref: #${(job.jobId || '').slice(-6).toUpperCase()}`,
      '',
      `*Customer:* ${_esc(job.customerName || '—')}`,
      job.phone   ? `*Phone:* ${_esc(job.phone)}` : '',
      address     ? `*Address:* ${_esc(address)}` : '',
      '',
      job.scheduledDate ? `*Date:* ${_formatDate(job.scheduledDate)}${job.scheduledTime ? ' @ ' + _formatTime(job.scheduledTime) : ''}` : '',
      job.description   ? `*Job:* ${_esc(job.description)}` : '',
      job.notes         ? `*Notes:* ${_esc(job.notes)}` : '',
    ];

    // For paid jobs add the full financial breakdown
    if (job.status === 'paid') {
      const jobTotal     = parseFloat(job.jobTotal)     || 0;
      const parts        = parseFloat(job.partsCost)    || 0;
      const taxAmt       = parseFloat(job.taxAmount)    || 0;
      const techPayout   = parseFloat(job.techPayout)   || 0;
      const ownerPayout  = parseFloat(job.ownerPayout)  || 0;
      const contrFee     = parseFloat(job.contractorFee)|| 0;
      const isSelf       = job.isSelfAssigned === true || job.isSelfAssigned === 'true';
      const myTotal      = isSelf ? ownerPayout + techPayout : ownerPayout;

      lines.push('');
      lines.push('*── Financials ──*');
      lines.push(`*Job Total:* $${jobTotal.toFixed(2)}`);
      if (taxAmt > 0)    lines.push(`*Tax:* -$${taxAmt.toFixed(2)}`);
      if (parts > 0)     lines.push(`*Parts:* -$${parts.toFixed(2)}`);
      if (tech && !isSelf) lines.push(`*Tech (${tech.name}):* $${techPayout.toFixed(2)}`);
      if (contrFee > 0)  lines.push(`*Contractor Fee:* $${contrFee.toFixed(2)}`);
      lines.push(`*My Revenue:* $${myTotal.toFixed(2)}`);
      if (job.paymentMethod) lines.push(`*Payment:* ${job.paymentMethod.charAt(0).toUpperCase() + job.paymentMethod.slice(1)}`);
    } else {
      lines.push('');
      if (total > 0)  lines.push(`*Est. Total:* $${total.toFixed(2)}`);
      if (tech)       lines.push(`*Tech:* ${tech.name}`);
    }

    return lines.filter(l => l !== undefined).join('\n');
  }

  // Clean a phone number to E.164-style digits for wa.me URLs
  function _cleanPhoneForWA(phone) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return '1' + digits;        // US number — prepend country code
    if (digits.length === 11 && digits[0] === '1') return digits; // already has +1
    if (digits.length > 7) return digits;                 // international — pass as-is
    return null;
  }

  // Customer-facing appointment confirmation (used for wa.me outbound)
  function _buildWhatsAppConfirmationMsg(job) {
    const settings = DB.getSettings();
    const tech = job.assignedTechId
      ? settings.technicians.find(t => t.id === job.assignedTechId)
      : null;

    const dateLine = job.scheduledDate
      ? _formatDate(job.scheduledDate)
      : 'Date to be confirmed';
    const timeLine = job.scheduledTime
      ? _formatTime(job.scheduledTime)
      : 'Time to be confirmed';
    const techLine = tech ? tech.name : 'assigned shortly';
    const ownerPhone = settings.ownerPhone || '(929) 429-2429';

    return [
      `Hello ${job.customerName || 'there'}!`,
      '',
      `This is On Point Pro Doors confirming your appointment:`,
      '',
      `Service: ${job.description || 'Garage Door Service'}`,
      `Date: ${dateLine}`,
      `Time: ${timeLine}`,
      `Technician: ${techLine}`,
      `Address: ${[job.address, job.city, job.state].filter(Boolean).join(', ') || 'on file'}`,
      '',
      `If you need to reschedule or have any questions, please call us at ${ownerPhone}.`,
      '',
      `Thank you for choosing On Point Pro Doors!`,
    ].join('\n');
  }

  // Open WhatsApp with customer appointment confirmation
  function openWhatsApp(jobId) {
    if (!Auth.isAdminOrDisp()) return;
    const job = DB.getJobById(jobId);
    if (!job) { showToast('Job not found', 'error'); return; }

    if (!job.phone) {
      showToast('No phone number on file for this job', 'warning');
      return;
    }

    const cleanPhone = _cleanPhoneForWA(job.phone);
    if (!cleanPhone) {
      showToast('Invalid phone number', 'warning');
      return;
    }

    const msg = _buildWhatsAppConfirmationMsg(job);
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
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

  // Public boot entry point — sets up auth and wires session listener
  async function init() {
    // Safety net: if something goes wrong during init, remove shell after 4s max
    setTimeout(_removeAppShell, 4000);

    // Detect invite link before Auth.init fires (hash cleared by Supabase after use)
    const isInviteFlow = window.location.hash.includes('type=invite') ||
                         window.location.hash.includes('type=recovery');

    const currentUser = await Auth.init(async (user) => {
      if (user) {
        if (_firstSetupInProgress) return; // setup screen handles completion
        if (isInviteFlow) {
          _removeAppShell();
          SetPasswordScreen.show();
        } else {
          await _onAuthenticated();
        }
      } else {
        _initialized = false;
        await _checkAndShowFirstSetup();
      }
    });

    if (!currentUser) {
      await _checkAndShowFirstSetup();
    }
  }

  let _setupCheckInProgress = false;
  async function _checkAndShowFirstSetup() {
    if (_setupCheckInProgress) return; // prevent duplicate call from auth callback + init()
    _setupCheckInProgress = true;
    try {
      const needed = await Auth.checkFirstSetupNeeded();
      _removeAppShell();
      if (needed) {
        SetupScreen.show();
      } else {
        LoginScreen.show();
      }
    } catch (_e) {
      _removeAppShell();
      LoginScreen.show();
    }
  }

  function setFirstSetupInProgress(v) {
    _firstSetupInProgress = v;
  }

  async function completeFirstSetup() {
    _firstSetupInProgress = false;
    SetupScreen.hide();
    await _onAuthenticated();
  }

  return {
    init,

    // Auth
    logout,
    toggleUserMenu,
    closeUserMenu,

    navigate,
    goBack,

    // Dashboard
    renderDashboard,

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
    _closeTaxSelect,
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

    // Admin invite
    showInviteModal,
    closeInviteModal,
    submitInvite,
    _changeUserRole,
    _confirmRemoveUser,
    _sendInviteWA,
    _sendInviteWAFromInput,
    _sendUserWALink,

    // WhatsApp
    openWhatsApp,

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

    // Kanban / view toggle
    toggleJobsView,
    renderKanban,

    // Dark mode
    toggleDarkMode,

    // Follow-up
    sendFollowUpWhatsApp,

    // Zelle
    openZelleRequest,

    // Modals
    showModal,
    closeModal,

    // Toast
    showToast,

    // PWA
    pwaInstall: () => window._pwaInstall && window._pwaInstall(),
    pwaDismiss: () => window._pwaDismiss && window._pwaDismiss(),

    // First-admin setup
    setFirstSetupInProgress,
    completeFirstSetup,
  };

})();

// ══════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
