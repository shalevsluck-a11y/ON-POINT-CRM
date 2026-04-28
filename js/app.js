/* ============================================================
   APP.JS — On Point Home Services
   Main application: router, all views, all logic, all handlers
   Version: 2026-04-27-DEBUG-v2
   ============================================================ */
console.log('[APP.JS] 🔧 Version: 2026-04-27-DEBUG-v2 loaded');

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
    calendarTechFilter: '',  // filter calendar by tech
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
  let _lastInvite = { name: '', phone: '', setupLink: '', loginEmail: '' };
  let _jobsViewMode = localStorage.getItem('op_jobs_view') || 'list'; // 'list' | 'kanban'
  let _ptr = { startY: 0, pulling: false };
  const _statusChangingJobs = new Set(); // debounce rapid status taps

  // Disable a button, run an async fn, re-enable when done
  function _withLoading(btnId, asyncFn) {
    const btn = document.getElementById(btnId);
    if (btn && btn.disabled) return Promise.resolve(); // already in flight
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
    return Promise.resolve().then(() => asyncFn()).finally(() => {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    });
  }

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════

  // Called by boot once Auth confirms a valid session
  function _removeAppShell() {
    document.getElementById('app-shell')?.remove();
  }

  // Force service worker to check for updates
  function _checkServiceWorkerUpdate() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          console.log('[App] Checking for service worker updates...');
          reg.update();
        }
      });

      // Listen for service worker update messages
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'SW_UPDATED') {
          console.log('[App] Service worker updated to version:', event.data.version);
          console.log('[App] Reloading to apply updates...');
          window.location.reload();
        }
      });
    }
  }

  async function _onAuthenticated() {
    if (_initialized) return;
    _initialized = true;

    // Force service worker update check
    _checkServiceWorkerUpdate();

    // Show app immediately from localStorage cache — do NOT await DB.init() first
    LoginScreen.hide();
    _removeAppShell();

    // Set header avatar / name / role
    _updateHeaderUser();
    _updatePushBanner();

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

    // Always land on dashboard after login
    navigate('dashboard');

    // Background sync - don't block UI
    DB.init().then(() => {
      console.log('[App] ✅ DB.init completed - refreshing UI with synced data');
      renderDashboard();
      renderJobList();
      _loadSettingsForm();
      _renderTechSelector();
      _populateSourceDropdown();

      // CRITICAL FIX: Refresh Balance dropdown after settings sync completes
      if (window.Balance && window.Balance.populateLeadSourceSelector) {
        console.log('[App] 🔄 Refreshing Balance dropdown after settings sync');
        Balance.populateLeadSourceSelector();
      }
    }).catch(e => {
      console.warn('DB.init error:', e.message);
      showToast('Connection error — showing cached data', 'warning');
    });

    // Background sync jobs - don't block
    DB.syncJobsFromRemote().then(() => {
      renderDashboard();
      renderJobList();
    }).catch(e => console.warn('Job sync error:', e));

    // Background init - don't block
    Notifications.init().catch(e => console.warn('Notifications error:', e));

    // Non-blocking inits
    if (window.PushSubscriptionEnforcer) {
      setTimeout(() => PushSubscriptionEnforcer.init(), 2000);
    }

    Reminders.init();

    if (window.Balance) {
      Balance.init();
    }

    if (window.RealtimeManager) {
      RealtimeManager.init();
    }

    if (window.OfflineQueue) {
      OfflineQueue.init().catch(e => console.warn('OfflineQueue error:', e));
    }

    // Subscribe to live job changes from other sessions
    _jobsChannel = DB.subscribeToJobs(
      (newJob) => {
        // Only play sound if the job was NOT created/closed by current user
        const currentUser = Auth.getUser();
        const isOwnAction = currentUser && (
          newJob.created_by === currentUser.id ||
          newJob.closed_by === currentUser.id
        );

        if (!isOwnAction) {
          _playNotificationSound();

          // Show in-app notification when app is in foreground
          // iOS suppresses system notifications when PWA is active, so show banner instead
          if (document.visibilityState === 'visible') {
            console.log('[Foreground Notification] Job:', newJob);
            console.log('[Foreground Notification] Customer:', newJob.customerName, 'Job ID:', newJob.jobId);
            showToast(`New Job: ${newJob.customerName || 'Unidentified'} - #${newJob.jobId}`, 'info', 5000);
          }
        }

        renderDashboard();
        renderJobList();
        if (_jobsViewMode === 'kanban' && _state.currentView === 'jobs') renderKanban();
      },
      () => { renderDashboard(); renderJobList(); if (_jobsViewMode === 'kanban' && _state.currentView === 'jobs') renderKanban(); if (_state.currentView === 'job-detail') openJobDetail(_state.currentJobId); },
      (deletedJobId) => {
        renderDashboard();
        renderJobList();
        if (_jobsViewMode === 'kanban' && _state.currentView === 'jobs') renderKanban();
        if (_state.currentView === 'job-detail' && _state.currentJobId === deletedJobId) {
          navigate('jobs');
        }
      },
      (status) => _updateRealtimeStatus(status)
    );

    // Subscribe to settings/profile changes from other devices
    _settingsChannel = DB.subscribeToSettings(() => {
      _renderTechSelector();
      _populateSourceDropdown();
      if (_state.currentView === 'settings') _loadSettingsForm();
    });
    _profilesChannel = DB.subscribeToProfiles(async (payload) => {
      // Check if the changed profile is the current user
      const currentUser = Auth.getUser();
      const changedUserId = payload?.new?.id || payload?.old?.id;

      if (currentUser && changedUserId === currentUser.id) {
        console.log('[App] Current user profile changed, refreshing permissions...');
        await Auth.refreshCurrentUserProfile();

        // Re-apply role-based UI
        _applyRoleUI();

        // Show toast to notify user
        showToast('Your permissions have been updated', 'info');

        // Re-render current view to reflect new permissions
        if (_state.currentView === 'dashboard') renderDashboard();
        if (_state.currentView === 'jobs') renderJobList();
      }

      // Always refresh UI elements that depend on profiles
      _renderTechSelector();
      _populateSourceDropdown();
      if (_state.currentView === 'settings') _loadSettingsForm();
    });

    // Notifications are already subscribed in Notifications module - don't duplicate

    // Auto-sync Google Sheets on load if URL configured
    const settings = DB.getSettings();
    if (settings.appsScriptUrl) setTimeout(() => SyncManager.syncAll(), 3000);

    // Background polling: refresh jobs every 30 seconds as fallback
    setInterval(async () => {
      try {
        await DB.syncJobsFromRemote();
        renderDashboard();
        renderJobList();
        if (_jobsViewMode === 'kanban' && _state.currentView === 'jobs') renderKanban();
      } catch (e) {
        console.warn('Background sync error:', e.message);
      }
    }, 30000);

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

    // Hide Google Sheets sync button from tech/contractor (admin + dispatcher only)
    const syncBtn = document.getElementById('btn-sync');
    if (syncBtn) syncBtn.classList.toggle('hidden', !Auth.isAdminOrDisp());

    // Show Balance to admin and dispatcher (in More menu)
    const moreBalance = document.getElementById('more-balance');
    if (moreBalance) moreBalance.classList.toggle('hidden', !Auth.isAdminOrDisp());

    // Show Settings to admin and dispatcher (for notification settings)
    const isAdmin = Auth.isAdmin();
    const canAccessSettings = Auth.isAdminOrDisp();
    const settingsNav = document.querySelector('.nav-item[data-view="settings"]');
    if (settingsNav) settingsNav.classList.toggle('hidden', !canAccessSettings);

    const settingsMenu = document.getElementById('nav-settings');
    if (settingsMenu) settingsMenu.classList.toggle('hidden', !canAccessSettings);
  }

  function _updateRealtimeStatus(status) {
    const indicator = document.getElementById('realtime-status');
    if (!indicator) return;

    if (status === 'SUBSCRIBED') {
      indicator.style.background = '#10b981'; // Green
      indicator.title = 'Live updates active';
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      indicator.style.background = '#f59e0b'; // Orange
      indicator.title = 'Reconnecting...';
    } else if (status === 'CLOSED') {
      indicator.style.background = '#ef4444'; // Red
      indicator.title = 'Disconnected';
    }
  }

  function _playNotificationSound() {
    try {
      // Get user's selected notification sound (default: tritone)
      const sound = localStorage.getItem('notif-sound') || 'tritone';
      if (sound !== 'none' && sound !== 'silent' && window.NotificationSounds) {
        window.NotificationSounds.play(sound);
      }
    } catch (e) {
      console.warn('Could not play notification sound:', e);
    }
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

  function toggleMoreMenu(event) {
    event?.stopPropagation();
    const menu = document.getElementById('more-menu');
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

  function hideMoreMenu() {
    const menu = document.getElementById('more-menu');
    if (menu) menu.classList.add('hidden');
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
    'calendar':   'Schedule',
    'balance':    'Balance Reports',
    'settings':   'Settings',
    'job-detail': 'Job Detail',
  };

  function navigate(viewName, opts = {}) {
    // Hide more menu when navigating
    hideMoreMenu();

    // Ignore 'more' view (it's just a menu toggle, not a real view)
    if (viewName === 'more') return;

    // Role guard: only admins and dispatchers can access the new-job view
    if (viewName === 'new-job' && !Auth.canCreateJobs()) {
      showToast('Only admins and dispatchers can create jobs', 'error');
      return;
    }

    // Role guard: only admins and dispatchers can access balance reports
    if (viewName === 'balance' && !Auth.isAdminOrDisp()) {
      showToast('You do not have permission to access Balance reports', 'error');
      navigate('dashboard');
      return;
    }

    // Role guard: only admins and dispatchers can access settings
    // Dispatcher sees only notification settings, admin sees everything
    if (viewName === 'settings' && !Auth.isAdminOrDisp()) {
      showToast('You do not have permission to access Settings', 'error');
      navigate('dashboard');
      return;
    }

    // Handle special options
    if (opts && opts.filter) {
      _state.jobFilter = opts.filter;
      setJobFilter(opts.filter, null);
    }

    _state.previousView = _state.currentView;
    _state.currentView  = viewName;

    // Reset users list fetch flag when leaving settings
    if (_state.previousView === 'settings' && viewName !== 'settings') {
      _usersListFetchInProgress = false;
    }

    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    // Show target view
    const viewEl = document.getElementById(`view-${viewName}`);
    if (!viewEl) { console.error('View not found:', viewName); return; }
    viewEl.classList.add('active');
    // Initialize notification settings UI if settings view
    if (viewName === 'settings' && typeof NotificationSettings !== 'undefined') {
      setTimeout(() => NotificationSettings.showInSettings(), 100);
    }

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
      // Populate filter dropdowns
      _populateJobFilters();
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
    if (viewName === 'new-job')    _initNewJobView().catch(e => console.error('[NEW JOB] Init error:', e));

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
    const weekStart = _thisWeekSundayStr(); // Sunday to Sunday

    const paidOnly = j => j.status === 'paid';
    const todayJobs  = jobs.filter(j => j.scheduledDate === today);
    const weekJobs   = jobs.filter(j => j.scheduledDate >= weekStart);

    // For revenue, filter by paidAt date (when job was actually paid)
    const paidToday = jobs.filter(j => j.status === 'paid' && j.paidAt && j.paidAt.slice(0, 10) === today);
    const paidWeek = jobs.filter(j => j.status === 'paid' && j.paidAt && j.paidAt.slice(0, 10) >= weekStart);

    // Only admin sees revenue section
    const revSection = document.getElementById('revenue-section');
    if (revSection) revSection.classList.toggle('hidden', !Auth.isAdmin());

    if (Auth.canSeeFinancials()) {
      // Admin: show owner revenue (ownerPayout + selfBonus for self-assigned)
      const toOwnerRev = arr => arr.reduce((s, j) => {
        const ownerCut  = parseFloat(j.ownerPayout) || 0;
        const selfBonus = (j.isSelfAssigned === true || j.isSelfAssigned === 'true')
          ? (parseFloat(j.techPayout) || 0) : 0;
        return s + ownerCut + selfBonus;
      }, 0);
      _setText('rev-day-amount', _fmt(toOwnerRev(paidToday)));
      _setText('rev-week-amount',  _fmt(toOwnerRev(paidWeek)));
    }

    _setText('rev-day-count', `${paidToday.length} paid job${paidToday.length !== 1 ? 's' : ''}`);
    _setText('rev-week-count',  `${paidWeek.length} paid job${paidWeek.length !== 1 ? 's' : ''}`);

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
        <div class="revenue-card revenue-card-static">
          <div class="rev-label">This Week Earnings</div>
          <div class="rev-amount" style="color:var(--color-success)">${_fmt(weekEarnings)}</div>
          <div class="rev-count">${thisWeekPaid.length} paid job${thisWeekPaid.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="revenue-card revenue-card-static">
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
    const today = _todayStr();
    const todayJobs = allJobs.filter(j =>
      j.scheduledDate === today && ['scheduled', 'in_progress', 'new'].includes(j.status)
    );

    const urgentHTML = urgent.length > 0
      ? urgent.slice(0, 5).map(j => {
          const daysAgo = j.scheduledDate
            ? Math.floor((Date.now() - new Date(j.scheduledDate+'T00:00:00').getTime()) / 86400000)
            : null;
          const reason = daysAgo !== null && daysAgo > 0 ? `Follow-up · ${daysAgo}d overdue`
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

    container.innerHTML = `
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
  async function showDispatcherPermissions(userId) {
    if (!Auth.isAdmin()) return;
    const modal = document.getElementById('dispatcher-permissions-modal');
    if (!modal) return;

    document.getElementById('dp-user-id').value = userId;

    // Get current user's permissions
    const { data: profile } = await SupabaseClient
      .from('profiles')
      .select('allowed_lead_sources')
      .eq('id', userId)
      .single();

    const allowed = profile?.allowed_lead_sources || [];

    // Get all lead sources + always include "Direct" (owner's leads)
    const settings = DB.getSettings();
    const leadSources = settings.leadSources || [];

    const list = document.getElementById('dp-lead-sources-list');
    // First add "Direct" option (stored as "my_lead" in database)
    let html = `
      <label class="checkbox-label" style="padding:12px;margin:4px 0;background:var(--color-surface-2);border-radius:8px">
        <input type="checkbox" value="my_lead" ${allowed.includes('my_lead') ? 'checked' : ''}>
        <span>Direct</span>
      </label>
    `;
    // Then add all other lead sources
    html += leadSources.map(ls => `
      <label class="checkbox-label" style="padding:12px;margin:4px 0;background:var(--color-surface-2);border-radius:8px">
        <input type="checkbox" value="${_esc(ls.name)}" ${allowed.includes(ls.name) ? 'checked' : ''}>
        <span>${_esc(ls.name)}</span>
      </label>
    `).join('');
    list.innerHTML = html;

    modal.classList.remove('hidden');
  }

  async function saveDispatcherPermissions() {
    if (!Auth.isAdmin()) return;
    const userId = document.getElementById('dp-user-id')?.value;
    if (!userId) return;

    const checkboxes = document.querySelectorAll('#dp-lead-sources-list input[type="checkbox"]:checked');
    const allowedSources = Array.from(checkboxes).map(cb => cb.value);

    try {
      await SupabaseClient
        .from('profiles')
        .update({
          allowed_lead_sources: allowedSources,
          assigned_lead_source: allowedSources.length > 0 ? allowedSources[0] : null
        })
        .eq('id', userId);

      showToast('Permissions updated', 'success');
      closeModal();
      _renderAdminUsersSection();
    } catch (e) {
      showToast('Failed to update permissions: ' + (e.message || 'unknown error'), 'error');
    }
  }


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
      if (_state.jobFilter === 'unpaid') {
        jobs = jobs.filter(j => j.status !== 'paid');
      } else {
        jobs = jobs.filter(j => j.status === _state.jobFilter);
      }
    }

    // Apply tech filter
    if (_state.jobFilterTech) {
      jobs = jobs.filter(j => j.assignedTechId === _state.jobFilterTech);
    }

    // Apply lead source filter
    if (_state.jobFilterSource) {
      jobs = jobs.filter(j => j.source === _state.jobFilterSource);
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
    _state.jobFilterTech = document.getElementById('job-filter-tech')?.value || '';
    _state.jobFilterSource = document.getElementById('job-filter-source')?.value || '';
    renderJobList();
  }

  function _populateJobFilters() {
    const settings = DB.getSettings();
    const techSelect = document.getElementById('job-filter-tech');
    const sourceSelect = document.getElementById('job-filter-source');

    if (!techSelect || !sourceSelect) return;

    // Populate tech filter
    const currentTech = _state.jobFilterTech || '';
    techSelect.innerHTML = '<option value="">Tech</option>' +
      (settings.technicians || []).map(t =>
        `<option value="${t.id}" ${t.id === currentTech ? 'selected' : ''}>${t.name}</option>`
      ).join('');

    // Populate lead source filter
    const currentSource = _state.jobFilterSource || '';
    sourceSelect.innerHTML = '<option value="">Source</option>' +
      (settings.leadSources || []).map(s =>
        `<option value="${s.name}" ${s.name === currentSource ? 'selected' : ''}>${s.name}</option>`
      ).join('');
  }

  // ══════════════════════════════════════════════════════════
  // JOB CARD HTML
  // ══════════════════════════════════════════════════════════

  function _jobCardHTML(job) {
    const settings = DB.getSettings();
    const statusClass = {
      new: 'jc-new', scheduled: 'jc-scheduled',
      in_progress: 'jc-inprogress', closed: 'jc-closed', paid: 'jc-paid',
      follow_up: 'jc-follow_up', lost: 'jc-lost',
    }[job.status] || 'jc-new';

    const badgeClass = {
      new: 'sb-new', scheduled: 'sb-scheduled',
      in_progress: 'sb-inprogress', closed: 'sb-closed', paid: 'sb-paid',
      follow_up: 'sb-follow_up', lost: 'sb-lost',
    }[job.status] || 'sb-new';

    const statusLabel = {
      new: 'New', scheduled: 'Scheduled',
      in_progress: 'In Progress', closed: 'Closed', paid: 'Paid',
      follow_up: 'Follow-Up', lost: 'Lost',
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

    const waBtn = Auth.isAdminOrDisp()
      ? `<button class="wa-btn" onclick="event.stopPropagation();App.openWhatsApp('${job.jobId}')" title="Dispatch to Tech">&#128172;</button>`
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

  async function _initNewJobView() {
    console.log('[NEW JOB] Initializing new job view...');

    // CRITICAL: Force settings sync before showing the form
    // This ensures lead sources are loaded before populating dropdown
    console.log('[NEW JOB] Force syncing settings from database...');

    // Add loading state to dropdown
    const sourceEl = document.getElementById('f-source');
    if (sourceEl) {
      sourceEl.innerHTML = '<option>Loading...</option>';
      sourceEl.disabled = true;
    }

    try {
      await DB.syncSettingsFromRemote();
      console.log('[NEW JOB] ✓ Settings sync complete');

      // VERIFY settings actually loaded - retry up to 5 times
      let retries = 0;
      let settings = DB.getSettings();
      while ((!settings.leadSources || settings.leadSources.length === 0) && retries < 5) {
        console.log('[NEW JOB] Settings not loaded yet, retrying...', retries + 1);
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
        await DB.syncSettingsFromRemote();
        settings = DB.getSettings();
        retries++;
      }

      if (settings.leadSources && settings.leadSources.length > 0) {
        console.log('[NEW JOB] ✓ Settings verified - leadSources loaded:', settings.leadSources.length);
      } else {
        console.error('[NEW JOB] ⚠️ WARNING: Settings sync completed but NO leadSources loaded!');
      }
    } catch (e) {
      console.error('[NEW JOB] Settings sync failed:', e);
    }

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

    // Reset source (sourceEl already declared at top of function)
    if (sourceEl) {
      if (Auth.isContractor()) {
        // Contractors: auto-set to their assigned lead source and lock the field
        const user = Auth.getUser();
        const assignedLeadSource = user?.assignedLeadSource;
        if (assignedLeadSource) {
          // Find the lead source ID by name
          const settings = DB.getSettings();
          const leadSource = (settings.leadSources || []).find(ls => ls.name === assignedLeadSource);
          sourceEl.value = leadSource?.id || 'my_lead';
          sourceEl.disabled = true;
        }
      } else {
        // Admin/dispatcher: editable
        sourceEl.value = 'my_lead';
        sourceEl.disabled = false;
      }
      onSourceChange();
    }

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
  }

  // ── SOURCE DROPDOWN ──────────────────────────────────

  function _populateSourceDropdown() {
    const select = document.getElementById('f-source');
    if (!select) return;
    const settings = DB.getSettings();
    const sources  = settings.leadSources || [];
    const user = Auth.getUser();

    console.log('[SOURCE DROPDOWN] === POPULATING SOURCE DROPDOWN ===');
    console.log('[SOURCE DROPDOWN] Current user:', user);
    console.log('[SOURCE DROPDOWN] User role:', user?.role);
    console.log('[SOURCE DROPDOWN] Is dispatcher?', Auth.isDispatcher());
    console.log('[SOURCE DROPDOWN] Is admin?', Auth.isAdmin());
    console.log('[SOURCE DROPDOWN] Settings object:', settings);
    console.log('[SOURCE DROPDOWN] All sources from settings:', sources);
    console.log('[SOURCE DROPDOWN] Sources count:', sources.length);

    // CRITICAL CHECK: If no sources loaded, settings might not be synced yet
    if (sources.length === 0) {
      console.error('[SOURCE DROPDOWN] ⚠️ NO LEAD SOURCES IN SETTINGS! This will cause dropdown to show only My Lead');
      console.error('[SOURCE DROPDOWN] Settings sync may have failed or not completed yet');
    }

    // Filter sources based on dispatcher permissions
    let filteredSources = sources;
    let allowedSourceNames = null;

    if (Auth.isDispatcher()) {
      const user = Auth.getUser();
      allowedSourceNames = user?.allowedLeadSources || null;

      console.log('[SOURCE FILTER] Dispatcher detected');
      console.log('[SOURCE FILTER] User:', user);
      console.log('[SOURCE FILTER] Allowed sources:', allowedSourceNames);
      console.log('[SOURCE FILTER] All sources:', sources.map(s => s.name));

      if (allowedSourceNames && allowedSourceNames.length > 0) {
        // Filter to only show allowed sources (case-insensitive)
        const allowedNamesLower = allowedSourceNames.map(n => n.toLowerCase());
        filteredSources = sources.filter(s => allowedNamesLower.includes(s.name.toLowerCase()));
        console.log('[SOURCE FILTER] Filtered to:', filteredSources.map(s => s.name));
      } else {
        console.log('[SOURCE FILTER] WARNING: No allowed sources set - blocking all sources');
        filteredSources = []; // Don't show any sources if none are allowed
      }
    }

    // Build dropdown with filtered sources
    console.log('[SOURCE DROPDOWN] Filtered sources:', filteredSources);
    console.log('[SOURCE DROPDOWN] Building dropdown...');
    select.innerHTML = '';

    // Add "My Lead" if allowed
    const shouldShowMyLead = !Auth.isDispatcher() || !allowedSourceNames || allowedSourceNames.includes('my_lead');
    console.log('[SOURCE DROPDOWN] Should show My Lead?', shouldShowMyLead);
    if (shouldShowMyLead) {
      select.innerHTML = `<option value="my_lead">My Lead (Direct)</option>`;
      console.log('[SOURCE DROPDOWN] Added "My Lead" option');
    }

    console.log('[SOURCE DROPDOWN] Adding', filteredSources.length, 'source options...');
    filteredSources.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.contractorPercent || 0}%)`;
      select.appendChild(opt);
      console.log('[SOURCE DROPDOWN] Added source:', s.name, 'ID:', s.id);
    });

    // Log final dropdown state
    console.log('[SOURCE DROPDOWN] Final dropdown options:', Array.from(select.options).map(o => ({ value: o.value, text: o.textContent })));

    // Auto-select and disable if dispatcher has only one allowed source
    if (Auth.isDispatcher() && allowedSourceNames && allowedSourceNames.length === 1) {
      const sourceName = allowedSourceNames[0];
      console.log('[SOURCE DROPDOWN] Dispatcher with single source, auto-selecting:', sourceName);
      if (sourceName.toLowerCase() === 'my_lead' || sourceName === 'my_lead') {
        select.value = 'my_lead';
      } else {
        // Case-insensitive search for the source
        const source = sources.find(s => s.name.toLowerCase() === sourceName.toLowerCase());
        if (source) {
          select.value = source.id;
          console.log('[SOURCE DROPDOWN] Auto-selected source:', source.name, 'ID:', source.id);
        }
      }
      select.disabled = true;
      select.style.opacity = '0.6';
      select.style.cursor = 'not-allowed';
      console.log('[SOURCE DROPDOWN] Dropdown disabled (single source)');
    } else {
      select.disabled = false;
      select.style.opacity = '1';
      select.style.cursor = '';
    }
    console.log('[SOURCE DROPDOWN] === DONE POPULATING ===');
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
  }

  // ── PAYMENT METHOD ───────────────────────────────────

  function selectPayMethod(btn) {
    // No-op: payment method removed from new job form
    // Payment method now only selected in close job modal
  }

  // ── PAYOUT PREVIEW ──────────────────────────────────

  function updatePayoutPreview() {
    // No-op: financial fields removed from new job form
    // Payout preview now only shown in close job modal
  }

  // ── SAVE JOB ─────────────────────────────────────────

  function saveNewJob() {
    return _withLoading('btn-save-job', _doSaveNewJob);
  }

  async function _doSaveNewJob() {
    if (!Auth.canCreateJobs()) {
      showToast('Only admins and dispatchers can create jobs', 'error');
      return;
    }
    const name   = document.getElementById('f-name')?.value?.trim();
    const phone  = document.getElementById('f-phone')?.value?.trim();
    const techId = document.getElementById('f-tech-id')?.value;

    if (!name)  { showToast('Enter customer name', 'warning'); return; }
    if (!phone) { showToast('Enter phone number', 'warning');  return; }

    const settings = DB.getSettings();
    const tech = settings.technicians.find(t => t.id === techId);
    const sourceValue = document.getElementById('f-source')?.value || 'my_lead';
    // Convert source ID to name for permissions matching
    let source = sourceValue;
    if (sourceValue !== 'my_lead') {
      const leadSource = settings.leadSources?.find(ls => ls.id === sourceValue);
      source = leadSource ? leadSource.name : sourceValue;
    }
    const state  = document.getElementById('f-state')?.value  || settings.defaultState || 'NY';

    // Financial fields removed from new job form - set when closing job
    const techPct  = tech?.percent || 60;
    const contrPct = parseFloat(document.getElementById('f-contractor-pct')?.value) || 0;
    const contrName = document.getElementById('f-contractor')?.value?.trim() || '';
    const isSelf   = tech?.isOwner || false;

    const job = {
      jobId:           DB.generateId(),
      status:          'new',
      createdBy:       Auth.getUser()?.id || null,
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
      contractorName:  contrName,
      contractorPct:   contrPct,
      ownerPct:        100 - techPct - contrPct,
      assignedTechId:  techId,
      assignedTechName:tech?.name || '',
      isSelfAssigned:  isSelf,
      techPercent:     techPct,
      estimatedTotal:  0,
      jobTotal:        0,
      partsCost:       0,
      taxAmount:       0,
      techPayout:      0,
      ownerPayout:     0,
      contractorFee:   0,
      paymentMethod:   'cash',
      photos:          [],
      isRecurringCustomer: _state.newJobDraft.isRecurringCustomer || false,
      syncStatus:      'pending',
    };

    // Update status based on whether scheduled
    if (job.scheduledDate) job.status = 'scheduled';

    try {
      await DB.saveJob(job);
    } catch (e) {
      showToast('Failed to save job: ' + (e.message || 'unknown error'), 'error');
      return;
    }

    // Push to Google Sheets immediately
    SyncManager.queueJob(job.jobId);
    SyncManager.syncJob(job).then(r => {
      if (!r.success) showToast('Saved — Sheets sync pending (check Settings URL)', 'warning');
    }).catch(() => {});

    DB.clearDraft();
    showToast(`Job saved — ${name}`, 'success');
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

  function openJobDetail(jobId, retryCount = 0) {
    console.log('[App] Opening job:', jobId, 'retry:', retryCount);

    // Prevent infinite loop
    if (retryCount > 2) {
      console.error('[App] Max retries exceeded for job:', jobId);
      navigate('jobs');
      showToast('❌ Cannot load this job - data is corrupted. Use CLEAR CACHE in Settings.', 'error');
      return;
    }

    const job = DB.getJobById(jobId);
    if (!job) {
      console.error('[App] Job not found in cache:', jobId);
      if (retryCount === 0) {
        showToast('Job not in cache - fetching fresh...', 'warning');
        // Sync from remote and try again
        DB.syncJobsFromRemote().then(() => {
          const retryJob = DB.getJobById(jobId);
          if (retryJob) {
            openJobDetail(jobId, retryCount + 1);
          } else {
            navigate('jobs');
            showToast('Job no longer exists', 'error');
          }
        });
      } else {
        navigate('jobs');
        showToast('❌ Job not found after sync', 'error');
      }
      return;
    }

    _state.currentJobId = jobId;
    navigate('job-detail');

    const container = document.getElementById('job-detail-content');
    if (!container) {
      console.error('[App] job-detail-content container not found');
      navigate('jobs');
      return;
    }

    try {
      container.innerHTML = _buildJobDetailHTML(job);
    } catch (error) {
      console.error('[App] Error rendering job - corrupted data:', error);
      console.error('[App] Corrupted job data:', job);

      if (retryCount === 0) {
        // First try: delete from cache and fetch fresh
        showToast('⚠️ Corrupted job data - fetching fresh copy...', 'warning');
        Storage.deleteJob(jobId);

        DB.syncJobsFromRemote().then(() => {
          const freshJob = DB.getJobById(jobId);
          if (freshJob) {
            console.log('[App] Fresh job fetched, retrying...');
            openJobDetail(jobId, retryCount + 1);
          } else {
            navigate('jobs');
            showToast('❌ Could not load job', 'error');
          }
        }).catch(err => {
          console.error('[App] Sync failed:', err);
          navigate('jobs');
          showToast('❌ Sync failed - use CLEAR CACHE in Settings', 'error');
        });
      } else {
        // Already retried - give up
        navigate('jobs');
        showToast('❌ Job data is corrupted. Use CLEAR CACHE button in Settings.', 'error');
      }
    }
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

    // WhatsApp — dispatch job details to assigned technician
    const waLink = Auth.isAdminOrDisp()
      ? `<button class="detail-action-btn" onclick="event.stopPropagation();App.openWhatsApp('${job.jobId}')">
      <span class="dab-icon">&#128172;</span><span class="dab-label">Dispatch</span>
    </button>`
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

      <!-- Financials (role-based view: admin full, tech their cut, contractor all splits, dispatcher hidden) -->
      ${!Auth.isDispatcher() && (total > 0 || Auth.isTechOrContractor() && (parseFloat(job.techPayout) > 0 || parseFloat(job.contractorFee) > 0)) ? `
      <div class="detail-section collapsed" id="ds-financials">
        <div class="detail-section-title" onclick="App.toggleDetailSection('ds-financials')">
          ${Auth.isTechOrContractor() ? 'Your Payout' : 'Financials'} <span class="section-chevron">›</span>
        </div>
        <div class="detail-section-body">
          ${total > 0 || isPaid ? PayoutEngine.renderBreakdownHTML(calc, job.assignedTechName || 'Tech', '', Auth.getUser()?.role || 'admin') : `
            <div class="detail-row">
              <div class="detail-row-label">Status</div>
              <div class="detail-row-value" style="color:var(--color-text-faint)">Enter total when closing job</div>
            </div>
          `}
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
    // CRITICAL: Ensure photos is ALWAYS an array
    let photoArray = [];
    if (Array.isArray(photos)) {
      photoArray = photos;
    } else if (typeof photos === 'string') {
      try {
        const parsed = JSON.parse(photos);
        photoArray = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.error('[App] Failed to parse photos string:', e);
        photoArray = [];
      }
    }

    const thumbs = photoArray.map((photo, idx) => {
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
    const cooldownKey = `${jobId}:${status}`;
    if (_statusChangingJobs.has(cooldownKey)) return;
    _statusChangingJobs.add(cooldownKey);
    setTimeout(() => _statusChangingJobs.delete(cooldownKey), 2000);

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

    // Auto-sync to Google Sheets when job is closed
    if (status === 'closed' && Auth.isAdminOrDisp()) {
      const updatedJob = DB.getJobById(jobId);
      SyncManager.syncJob(updatedJob).then(result => {
        if (result.success && !result.skipped) {
          console.log(`[Auto-sync] Job ${jobId} synced to Google Sheets`);
        }
      }).catch(err => {
        console.warn(`[Auto-sync] Failed for job ${jobId}:`, err);
      });
    }

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
      const safeSrc = typeof photo.data === 'string' && photo.data.startsWith('data:image/')
        ? photo.data : '';
      body.innerHTML = `
        <img src="${safeSrc}" alt="Photo" style="width:100%;border-radius:8px;display:block">
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
    const job = DB.getJobById(jobId);
    if (!job) return;

    // Tech can only close jobs assigned to them
    if (Auth.isTech() && job.assignedTechId !== Auth.getUser()?.id) {
      showToast('You can only close jobs assigned to you', 'error');
      return;
    }

    // Admin/dispatcher can close any job
    if (!Auth.canEditAllJobs() && !Auth.isTech()) {
      showToast('Not authorized to close jobs', 'error');
      return;
    }

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

      <div class="field-group">
        <label class="field-label">Closing Details (optional)</label>
        <textarea id="close-details" class="field-input" placeholder="Add notes about the job..." style="resize:vertical;min-height:80px">${_esc(job.closingDetails || '')}</textarea>
      </div>

      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-secondary" style="flex:1" onclick="App.closeModal()">Cancel</button>
        <button class="btn" style="flex:1;background:#ff9800;color:white;font-weight:800"
                onclick="App.markJobLost('${jobId}')">
          Lost
        </button>
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

    // Lookup lead source percentage if not already set
    let contractorPct = parseFloat(job.contractorPct) || 0;
    if (contractorPct === 0 && job.source && job.source !== 'my_lead') {
      const leadSource = settings.leadSources?.find(ls => ls.name === job.source);
      if (leadSource) {
        contractorPct = parseFloat(leadSource.contractorPercent) || 0;
      }
    }

    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parts,
      techPercent: parseFloat(job.techPercent) || 0,
      contractorPct,
      taxOption,
      isSelfAssigned: job.isSelfAssigned,
      taxRateNY: settings.taxRateNY,
      taxRateNJ: settings.taxRateNJ,
    });

    const prev = document.getElementById('close-payout-preview');
    if (prev) {
      // Preserve id so re-renders on subsequent keystrokes still find the element
      const viewerRole = Auth.getUser()?.role || 'admin';
      prev.outerHTML = PayoutEngine.renderBreakdownHTML(calc, tech?.name || 'Tech', 'close-payout-preview', viewerRole);
    }
  }

  function finalizeJob(jobId) {
    const job = DB.getJobById(jobId);
    if (!job) return;

    // Tech can only finalize jobs assigned to them
    if (Auth.isTech() && job.assignedTechId !== Auth.getUser()?.id) {
      showToast('You can only close jobs assigned to you', 'error');
      return;
    }

    // Admin/dispatcher can finalize any job
    if (!Auth.canEditAllJobs() && !Auth.isTech()) {
      showToast('Not authorized to close jobs', 'error');
      return;
    }

    const total     = parseFloat(document.getElementById('close-total')?.value) || 0;
    const parts     = parseFloat(document.getElementById('close-parts')?.value) || 0;
    const method    = document.getElementById('close-pay-method')?.value || 'cash';
    const taxOption = document.getElementById('close-tax-option')?.value || 'none';
    const closingDetails = document.getElementById('close-details')?.value?.trim() || '';

    const settings = DB.getSettings();
    const tech = job.assignedTechId ? settings.technicians.find(t => t.id === job.assignedTechId) : null;

    // Lookup lead source percentage if not already set
    let contractorPct = parseFloat(job.contractorPct) || 0;
    let contractorName = job.contractorName || '';
    if (contractorPct === 0 && job.source && job.source !== 'my_lead') {
      const leadSource = settings.leadSources?.find(ls => ls.name === job.source);
      if (leadSource) {
        contractorPct = parseFloat(leadSource.contractorPercent) || 0;
        contractorName = leadSource.name || '';
      }
    }

    const calc = PayoutEngine.calculate({
      jobTotal: total, partsCost: parts,
      techPercent: parseFloat(job.techPercent) || 0,
      contractorPct,
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

    // Tech can only update specific columns (enforce at client level AND database RLS)
    const updated = Auth.isTech()
      ? {
          ...job,
          status:        'closed', // Tech closes to 'closed', admin marks as 'paid'
          jobTotal:      total,
          partsCost:     parts,
          taxOption,
          taxAmount:     calc.taxAmount,
          techPayout:    calc.techPayout,
          paymentMethod: method,
          closingDetails,
          // Tech CANNOT set: ownerPayout, contractorFee, ownerPct, zelleMemo, paidAt
        }
      : {
          ...job,
          status:        'paid',
          jobTotal:      total,
          partsCost:     parts,
          taxOption,
          taxAmount:     calc.taxAmount,
          techPayout:    calc.techPayout,
          ownerPayout:   calc.ownerPayout,
          contractorFee: calc.contractorFee,
          contractorPct,
          contractorName,
          ownerPct:      100 - (parseFloat(job.techPercent) || 0) - contractorPct,
          paymentMethod: method,
          paidAt:        new Date().toISOString(),
          zelleMemo,
          closingDetails,
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

    // Update dashboard revenue in real-time
    renderDashboard();
    renderJobList();

    // Different success messages for tech vs admin
    if (Auth.isTech()) {
      showToast(`Job closed. Your earnings: ${_fmt(calc.techPayout)}`, 'success');
    } else {
      const _myTake = calc.isSelfAssigned
        ? calc.ownerPayout + calc.techPayout
        : calc.ownerPayout;
      showToast(calc.isSelfAssigned
        ? `Paid! Your take: ${_fmt(_myTake)}`
        : `Paid! On Point: ${_fmt(calc.ownerPayout)} · Tech: ${_fmt(calc.techPayout)}`,
        'success');
    }

    // Refresh detail view
    const container = document.getElementById('job-detail-content');
    const refreshed = DB.getJobById(jobId);
    if (container && refreshed) container.innerHTML = _buildJobDetailHTML(refreshed);

    // Offer Zelle memo to admin only
    if (Auth.canSeeZelleMemo() && tech && calc.techPayout > 0) {
      setTimeout(() => showZelleMemo(jobId), 600);
    }
  }

  function markJobLost(jobId) {
    const job = DB.getJobById(jobId);
    if (!job) return;

    // Only admin/dispatcher can mark jobs as lost
    if (!Auth.canEditAllJobs()) {
      showToast('Not authorized', 'error');
      return;
    }

    const updated = {
      ...job,
      status: 'lost',
    };

    DB.saveJob(updated);
    SyncManager.queueJob(jobId);
    closeModal();
    renderDashboard();
    setJobFilter('lost', null);
    renderJobList();
    showToast('Job marked as lost', 'info');
  }

  // ══════════════════════════════════════════════════════════
  // ZELLE DEEP LINK (customer payment request)
  function openZelleRequest(jobId) {
    const job = DB.getJobById(jobId);
    if (!job) return;
    const amount = parseFloat(job.jobTotal) || parseFloat(job.estimatedTotal) || 0;
    if (!amount) { showToast('No amount set on this job', 'warning'); return; }

    const settings = DB.getSettings();
    const ownerZelle = settings.ownerZelle || '';
    const dateStr = job.scheduledDate
      ? new Date(job.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    const service = (job.description || 'Service').substring(0, 40);
    const memo = `On Point Pro Doors${dateStr ? ' · ' + dateStr : ''} · ${service}`;
    const zelleUrl = `zelle://send?amount=${amount.toFixed(2)}&memo=${encodeURIComponent(memo)}`;
    const amtStr = `$${amount.toFixed(2)}`;

    const body = document.getElementById('modal-zelle-body');
    if (!body) return;

    body.innerHTML = `
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:32px;font-weight:800;color:var(--color-text)">${amtStr}</div>
        <div style="font-size:13px;color:var(--color-text-muted);margin-top:2px">${_esc(memo)}</div>
      </div>
      <a href="${zelleUrl}" class="btn btn-primary btn-full" style="background:#6D1ED4;border-color:#6D1ED4;margin-bottom:10px;display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none"
         onclick="setTimeout(()=>App._checkZelleFallback('${jobId}'),2500)">
        &#128178; Open Zelle App
      </a>
      <div id="zelle-fallback-${jobId}" class="hidden" style="background:var(--color-surface-raised);border-radius:12px;padding:14px;margin-top:4px">
        <div style="font-size:13px;font-weight:600;color:var(--color-text);margin-bottom:10px">Zelle app didn&#39;t open? Send manually:</div>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <div style="flex:1">
            <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:2px">Zelle Handle</div>
            <div style="font-size:14px;font-weight:600;color:var(--color-text);font-family:monospace">${_esc(ownerZelle || 'Not set — add in Settings')}</div>
          </div>
          ${ownerZelle ? `<button class="btn btn-secondary" style="padding:0 12px;align-self:flex-end"
            onclick="navigator.clipboard.writeText(this.dataset.v).then(()=>showToast('Handle copied','success'))"
            data-v="${_esc(ownerZelle)}">Copy</button>` : ''}
        </div>
        <div style="display:flex;gap:8px">
          <div style="flex:1">
            <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:2px">Amount</div>
            <div style="font-size:18px;font-weight:700;color:var(--color-text)">${amtStr}</div>
          </div>
          <button class="btn btn-secondary" style="padding:0 12px;align-self:flex-end"
            onclick="navigator.clipboard.writeText(this.dataset.v).then(()=>showToast('Amount copied','success'))"
            data-v="${_esc(amount.toFixed(2))}">Copy</button>
        </div>
      </div>
    `;

    showModal('modal-zelle');
  }

  function _checkZelleFallback(jobId) {
    const el = document.getElementById(`zelle-fallback-${jobId}`);
    if (el) el.classList.remove('hidden');
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
    console.log('[EditJob] ▶▶▶ showEditJobModal CALLED - jobId:', jobId);
    if (!Auth.canEditAllJobs()) {
      showToast('Not authorized to edit jobs', 'error');
      return;
    }
    const job = DB.getJobById(jobId);
    if (!job) return;
    console.log('[EditJob] ▶▶▶ Opening modal for job:', job.customerName, 'status:', job.status, 'assignedTechId:', job.assignedTechId);

    const settings = DB.getSettings();
    const isPaid = job.status === 'paid';
    const isDispatcher = Auth.isDispatcher();

    // Build modal using close-job modal slot (reuse)
    const body = document.getElementById('modal-close-job-body');
    const titleEl = document.querySelector('#modal-close-job .modal-title');
    if (titleEl) titleEl.textContent = 'Edit Job';

    body.innerHTML = `
      ${isPaid ? `<div style="padding:8px;background:var(--color-warning-bg);color:var(--color-warning);border-radius:6px;margin-bottom:12px;font-size:13px">⚠️ Paid job - only date, tech assignment${isDispatcher ? '' : ', lead source'}, and closing details can be changed</div>` : ''}
      <div class="field-group">
        <label class="field-label">Customer Name</label>
        <input type="text" id="edit-name" class="field-input" value="${_esc(job.customerName || '')}" ${isPaid ? 'disabled' : ''}>
      </div>
      <div class="field-group">
        <label class="field-label">Phone</label>
        <input type="tel" id="edit-phone" class="field-input" value="${_esc(job.phone || '')}" ${isPaid ? 'disabled' : ''}>
      </div>
      <div class="field-group">
        <label class="field-label">Address</label>
        <input type="text" id="edit-address" class="field-input" value="${_esc(job.address || '')}" ${isPaid ? 'disabled' : ''}>
      </div>
      <div class="field-row">
        <div class="field-group" style="flex:2">
          <label class="field-label">City</label>
          <input type="text" id="edit-city" class="field-input" value="${_esc(job.city || '')}" ${isPaid ? 'disabled' : ''}>
        </div>
        <div class="field-group" style="flex:1">
          <label class="field-label">State</label>
          <select id="edit-state" class="field-input" ${isPaid ? 'disabled' : ''}>
            ${['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map(s => `<option value="${s}" ${(job.state||'NY')===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="field-group" style="flex:1">
          <label class="field-label">ZIP</label>
          <input type="text" id="edit-zip" class="field-input" value="${_esc(job.zip || '')}" maxlength="5" ${isPaid ? 'disabled' : ''}>
        </div>
      </div>
      <div class="field-row">
        <div class="field-group" style="flex:1">
          <label class="field-label">Date</label>
          <input type="date" id="edit-date" class="field-input" value="${job.scheduledDate || ''}">
        </div>
        <div class="field-group" style="flex:1">
          <label class="field-label">Time</label>
          <select id="edit-time" class="field-input" ${isPaid ? 'disabled' : ''}>
            <option value="">Select time window</option>
            <option value="08-10" ${job.scheduledTime === '08-10' ? 'selected' : ''}>8-10 AM</option>
            <option value="10-12" ${job.scheduledTime === '10-12' ? 'selected' : ''}>10 AM-12 PM</option>
            <option value="12-14" ${job.scheduledTime === '12-14' ? 'selected' : ''}>12-2 PM</option>
            <option value="14-16" ${job.scheduledTime === '14-16' ? 'selected' : ''}>2-4 PM</option>
            <option value="16-18" ${job.scheduledTime === '16-18' ? 'selected' : ''}>4-6 PM</option>
            <option value="18-20" ${job.scheduledTime === '18-20' ? 'selected' : ''}>6-8 PM</option>
          </select>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Description</label>
        <textarea id="edit-desc" class="field-input field-textarea" rows="2" ${isPaid ? 'disabled' : ''}>${_esc(job.description || '')}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Notes</label>
        <textarea id="edit-notes" class="field-input field-textarea" rows="2" ${isPaid ? 'disabled' : ''}>${_esc(job.notes || '')}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Lead Source</label>
        <select id="edit-lead-source" class="field-input" ${isDispatcher ? 'disabled' : ''}>
          <option value="my_lead" ${job.source === 'my_lead' ? 'selected' : ''}>My Lead</option>
          ${settings.leadSources.map(ls => `<option value="${_esc(ls.name)}" ${job.source === ls.name ? 'selected' : ''}>${_esc(ls.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Assign Technician</label>
        <select id="edit-tech-id" class="field-input">
          <option value="">No Tech Assigned</option>
          ${settings.technicians.map(t => `<option value="${t.id}" ${job.assignedTechId === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Tech Payout %</label>
        <input type="number" id="edit-tech-pct" class="field-input" value="${job.techPercent || 0}" min="0" max="100" ${isPaid ? 'disabled' : ''}>
      </div>
      ${isPaid ? `<div class="field-group">
        <label class="field-label">Closing Details</label>
        <textarea id="edit-closing-details" class="field-input field-textarea" rows="3">${_esc(job.closingDetails || '')}</textarea>
      </div>` : ''}
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-secondary" style="flex:1" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" style="flex:1" onclick="App._saveEditedJob('${jobId}')">Save Changes</button>
      </div>
    `;

    showModal('modal-close-job');
  }

  function _saveEditedJob(jobId) {
    console.log('[EditJob] 🔥🔥🔥 _saveEditedJob CALLED - jobId:', jobId);
    console.log('[EditJob] 🔥🔥🔥 This log should appear FIRST if Save button clicked');
    if (!Auth.canEditAllJobs()) {
      showToast('Not authorized to edit jobs', 'error');
      return;
    }
    const job = DB.getJobById(jobId);
    if (!job) return;

    const settings = DB.getSettings();
    const techId = document.getElementById('edit-tech-id')?.value || null;
    const tech = techId ? settings.technicians.find(t => t.id === techId) : null;

    console.log('[EditJob] ═══ SAVING TECH ASSIGNMENT ═══');
    console.log('[EditJob] Job ID:', jobId);
    console.log('[EditJob] Selected techId from dropdown:', techId);
    console.log('[EditJob] Found tech:', tech);
    console.log('[EditJob] Job status:', job.status);
    console.log('[EditJob] Old assignedTechId:', job.assignedTechId);

    // Dispatchers cannot change lead source
    const isDispatcher = Auth.isDispatcher();
    const newLeadSource = isDispatcher ? job.source : (document.getElementById('edit-lead-source')?.value || job.source);

    // For paid jobs, allow tech assignment, lead source, and date changes
    const newDate = document.getElementById('edit-date')?.value;
    console.log('[EditJob] Date field value:', newDate, 'Old date:', job.scheduledDate);

    const updated = job.status === 'paid'
      ? {
          ...job,
          source:           newLeadSource,
          scheduledDate:    newDate || job.scheduledDate,
          assignedTechId:   techId,
          assignedTechName: tech ? tech.name : '',
          isSelfAssigned:   tech ? tech.isOwner : false,
          closingDetails:   document.getElementById('edit-closing-details')?.value?.trim() || job.closingDetails,
        }
      : {
          ...job,
          customerName:     document.getElementById('edit-name')?.value?.trim()    || job.customerName,
          phone:            document.getElementById('edit-phone')?.value?.trim()   || job.phone,
          address:          document.getElementById('edit-address')?.value?.trim() || job.address,
          city:             document.getElementById('edit-city')?.value?.trim()    || job.city,
          state:            document.getElementById('edit-state')?.value           || job.state,
          zip:              document.getElementById('edit-zip')?.value?.trim()     || job.zip,
          scheduledDate:    document.getElementById('edit-date')?.value            || job.scheduledDate,
          scheduledTime:    document.getElementById('edit-time')?.value            || job.scheduledTime,
          description:      document.getElementById('edit-desc')?.value?.trim()    || job.description,
          notes:            document.getElementById('edit-notes')?.value?.trim()   || job.notes,
          source:           newLeadSource,
          techPercent:      parseFloat(document.getElementById('edit-tech-pct')?.value) || job.techPercent,
          assignedTechId:   techId,
          assignedTechName: tech ? tech.name : '',
          isSelfAssigned:   tech ? tech.isOwner : false,
        };

    console.log('[EditJob] Updated job object:', {
      assignedTechId: updated.assignedTechId,
      assignedTechName: updated.assignedTechName,
      isSelfAssigned: updated.isSelfAssigned
    });

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

    let jobs = DB.getJobsByDate(dateStr);
    const settings = DB.getSettings();
    const container = document.getElementById('calendar-content');

    // Populate tech filter dropdown
    _populateCalendarTechFilter();

    // Apply tech filter
    if (_state.calendarTechFilter) {
      jobs = jobs.filter(j => j.assignedTechId === _state.calendarTechFilter);
    }

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
            ${tech ? `<button class="btn-icon" onclick="App.dispatchTechSchedule('${techId}', '${dateStr}')" title="Send WhatsApp dispatch">&#128196;</button>` : ''}
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

  function _populateCalendarTechFilter() {
    const select = document.getElementById('calendar-tech-filter');
    if (!select) return;

    const settings = DB.getSettings();
    const currentValue = _state.calendarTechFilter;

    select.innerHTML = '<option value="">All Techs</option>';
    settings.technicians.forEach(tech => {
      const opt = document.createElement('option');
      opt.value = tech.id;
      opt.textContent = tech.name;
      if (tech.id === currentValue) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function calendarFilterByTech(techId) {
    _state.calendarTechFilter = techId;
    renderCalendar();
  }

  function dispatchTechSchedule(techId, dateStr) {
    const settings = DB.getSettings();
    const tech = settings.technicians.find(t => t.id === techId);
    if (!tech) return;

    const jobs = DB.getJobsByDate(dateStr).filter(j => j.assignedTechId === techId);
    if (jobs.length === 0) {
      showToast('No jobs for this tech', 'info');
      return;
    }

    // Sort by time
    jobs.sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));

    // Build message
    const date = new Date(dateStr);
    const dateFormatted = _formatDateLong(date);

    let msg = `📅 *Schedule for ${tech.name}*\n`;
    msg += `${dateFormatted}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    jobs.forEach((job, i) => {
      msg += `*${i + 1}. ${job.customerName || 'Unknown'}*\n`;
      msg += `🕐 ${job.scheduledTime ? _formatTime(job.scheduledTime) : 'TBD'}\n`;
      msg += `📍 ${job.address || ''}${job.city ? ', ' + job.city : ''}${job.zip ? ' ' + job.zip : ''}\n`;
      msg += `📞 ${job.phone || 'No phone'}\n`;
      if (job.description) msg += `📝 ${job.description}\n`;
      msg += `\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Total: ${jobs.length} job${jobs.length !== 1 ? 's' : ''}`;

    const encoded = encodeURIComponent(msg);
    const phone = tech.phone ? tech.phone.replace(/\D/g, '') : '';
    const waUrl = phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;

    window.open(waUrl, '_blank');
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
    console.log('[_loadSettingsForm] ╔══════════════════════════════════════════════════════════');
    console.log('[_loadSettingsForm] ║ LOADING SETTINGS FORM');
    console.log('[_loadSettingsForm] ╚══════════════════════════════════════════════════════════');

    // Reset users list loading state when entering Settings
    _usersListFetchInProgress = false;

    const s = DB.getSettings();
    console.log('[_loadSettingsForm] Settings loaded from cache:', s);
    console.log('[_loadSettingsForm] Technicians in settings:', s.technicians?.length || 0);
    console.log('[_loadSettingsForm] Technician data:', JSON.stringify(s.technicians));

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

    // Load notification preferences from user profile
    const notifPrefs = user?.notification_preferences || {};
    const notifEnabled = document.getElementById('s-notif-enabled');
    if (notifEnabled) {
      notifEnabled.checked = notifPrefs.enabled !== false;

      // Add event listener to handle permission request when toggled
      notifEnabled.onchange = async function(e) {
        const wasChecked = !this.checked; // Previous state before the change

        if (!this.checked) {
          // User is turning OFF notifications - allow it
          showToast('Notifications disabled', 'info');
          return;
        }

        // User is turning ON notifications - check permission first
        if (!('Notification' in window)) {
          showToast('Notifications not supported in this browser', 'warning');
          this.checked = false;
          return;
        }

        const currentPermission = Notification.permission;

        // Check if granted already
        if (currentPermission === 'granted') {
          this.checked = true;
          // Ensure subscription exists
          if (window.PushSubscriptionEnforcer) {
            await PushSubscriptionEnforcer.enforce();
          }
          showToast('✅ Notifications enabled!', 'success');
          return;
        }

        // Check if denied
        if (currentPermission === 'denied') {
          this.checked = false;
          showToast('❌ Notifications blocked. Go to Settings → Allow notifications for this site', 'warning', 5000);
          return;
        }

        // Permission is 'default' - need to request
        // iOS-specific handling
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const isPWA = window.navigator.standalone === true;

        if (isIOS && !isPWA) {
          // Running in Safari browser, not installed as PWA
          this.checked = false;
          showToast('📱 Add to Home Screen first: Tap Share ⬆️ → Add to Home Screen', 'warning', 8000);
          return;
        }

        // Request permission
        try {
          const permission = await Notification.requestPermission();

          if (permission === 'granted') {
            this.checked = true;
            // Register push subscription
            if (window.PushSubscriptionEnforcer) {
              await PushSubscriptionEnforcer.enforce();
            }
            showToast('✅ Notifications enabled!', 'success');
          } else {
            // User clicked "Block"
            this.checked = false;
            showToast('❌ You blocked notifications. Go to Settings to enable later', 'warning', 5000);
          }
        } catch (err) {
          console.error('[Notifications] Permission request failed:', err);
          this.checked = false;
          showToast('Failed to enable notifications: ' + (err.message || 'unknown error'), 'error');
        }
      };
    }

    // Set selected sound radio button
    const soundRadios = document.querySelectorAll('input[name="notif-sound"]');
    const selectedSound = notifPrefs.sound || 'chime';
    soundRadios.forEach(radio => {
      radio.checked = radio.value === selectedSound;
    });

    // Load notification type preferences
    const notifNewJob = document.getElementById('s-notif-new-job');
    if (notifNewJob) notifNewJob.checked = notifPrefs.newJob !== false;

    // Zelle handle visible to admin only
    const zelleGroup = document.getElementById('s-zelle-group');
    if (zelleGroup) zelleGroup.classList.toggle('hidden', !Auth.canSeeZelleMemo());

    // Hide admin-only settings sections from tech/contractor
    ['settings-myinfo-card','settings-tax-card','settings-tech-card','settings-sources-card',
     'settings-data-card','settings-defaultstate-group'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !isAdmin);
    });

    // Google Sheets sync visible to admin only
    const syncCard = document.getElementById('settings-sync-card');
    if (syncCard) syncCard.classList.toggle('hidden', !isAdmin);

    // Save button label differs by role
    const saveBtn = document.getElementById('settings-save-btn');
    if (saveBtn) saveBtn.textContent = isAdmin ? 'Save Settings' : 'Update My Profile';

    if (isAdmin) {
      _renderTechList(s.technicians);
      _renderSourceList(s.leadSources);
      _renderAdminUsersSection();
    }
  }

  let _usersListFetchInProgress = false;

  async function _renderAdminUsersSection(isRetry = false) {
    const container = document.getElementById('admin-users-section');
    if (!container) return;

    // If already fetching, don't start another fetch
    if (_usersListFetchInProgress && !isRetry) {
      console.log('Users list fetch already in progress, skipping');
      return;
    }

    container.innerHTML = `<div class="settings-card">
      <div class="settings-section-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Users</span>
        <button class="btn btn-primary" style="padding:6px 14px;font-size:13px" onclick="App.showInviteModal()">+ Create Dispatcher</button>
      </div>
      <div id="admin-users-list">
        <div class="user-list-item" style="opacity:0.5;pointer-events:none">
          <div class="user-item-avatar" style="background:#E5E7EB"></div>
          <div class="user-item-info">
            <div class="user-item-name" style="background:#E5E7EB;color:transparent;border-radius:4px">Loading...</div>
            <div class="user-item-email" style="background:#E5E7EB;color:transparent;border-radius:4px;margin-top:4px;width:70%">email</div>
          </div>
        </div>
        <div class="user-list-item" style="opacity:0.4;pointer-events:none">
          <div class="user-item-avatar" style="background:#E5E7EB"></div>
          <div class="user-item-info">
            <div class="user-item-name" style="background:#E5E7EB;color:transparent;border-radius:4px">Loading...</div>
            <div class="user-item-email" style="background:#E5E7EB;color:transparent;border-radius:4px;margin-top:4px;width:60%">email</div>
          </div>
        </div>
        <div class="user-list-item" style="opacity:0.3;pointer-events:none">
          <div class="user-item-avatar" style="background:#E5E7EB"></div>
          <div class="user-item-info">
            <div class="user-item-name" style="background:#E5E7EB;color:transparent;border-radius:4px">Loading...</div>
            <div class="user-item-email" style="background:#E5E7EB;color:transparent;border-radius:4px;margin-top:4px;width:50%">email</div>
          </div>
        </div>
      </div>
    </div>`;
    container.classList.remove('hidden');

    _usersListFetchInProgress = true;

    try {
      // Ensure fresh session before fetching users
      await SupabaseClient.auth.getSession();
      const users = await Auth.getUsersForAdmin();
      const currentUserId = Auth.getUser()?.id;
      const listEl = document.getElementById('admin-users-list');
      if (!listEl) return;

      listEl.innerHTML = users.map(u => {
        const loginCode = u.magic_token || '';
        return `
        <div class="user-list-item" style="flex-direction:column;align-items:stretch;padding:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="user-item-avatar" style="background:${u.color||'#3B82F6'}">${_initials(u.name||u.id)}</div>
            <div class="user-item-info" style="flex:1">
              <div class="user-item-name">${_esc(u.name || 'Unknown')}</div>
              ${loginCode ? `<div style="font-size:13px;font-weight:600;font-family:monospace;color:var(--color-primary);letter-spacing:1px;margin-top:2px">CODE: ${loginCode}</div>` : ''}
            </div>
            <div class="user-item-role" style="display:flex;align-items:center;gap:6px">
              ${loginCode ? `<button class="btn-icon" onclick="navigator.clipboard.writeText('${loginCode}');App.showToast('Code copied!','success')" title="Copy login code" style="font-size:14px">📋</button>` : ''}
              <span style="font-size:12px;padding:4px 12px;background:${u.role==='admin'?'var(--color-primary)':'var(--color-surface-3)'};color:${u.role==='admin'?'#fff':'var(--color-text)'};border-radius:6px;font-weight:500;text-transform:capitalize">${u.role}</span>
              ${u.role==='dispatcher' ? `<button class="btn-icon" onclick="App.showDispatcherPermissions('${u.id}')" title="Edit permissions">&#9998;</button>` : ''}
              ${u.id !== currentUserId ? `<button class="btn-icon" style="color:var(--color-error);font-size:16px"
                onclick="App._confirmRemoveUser(this.dataset.uid,this.dataset.uname)" title="Remove user"
                data-uid="${_esc(u.id)}" data-uname="${_esc(u.name||u.email)}">&#128465;</button>` : ''}
            </div>
          </div>
        </div>
        `;
      }).join('') || '<div class="empty-state-sm">No users found</div>';
      _usersListFetchInProgress = false;
    } catch (e) {
      if (!isRetry) {
        _usersListFetchInProgress = false;
        await new Promise(resolve => setTimeout(resolve, 2000));
        return _renderAdminUsersSection(true);
      }
      const listEl = document.getElementById('admin-users-list');
      const msg = e?.message || String(e) || 'Failed to load users';
      if (listEl) listEl.innerHTML = `<div class="empty-state-sm" style="color:var(--color-error)">${_esc(msg)}<br><button class="btn-link" style="margin-top:8px" onclick="App._renderAdminUsersSection()">Retry</button></div>`;
      _usersListFetchInProgress = false;
    }
  }

  function showInviteModal() {
    if (!Auth.isAdmin()) return;
    const modal = document.getElementById('invite-modal');
    if (!modal) return;

    // Clear name field
    const nameInput = document.getElementById('invite-name');
    if (nameInput) nameInput.value = '';

    // Reset UI state
    const errEl = document.getElementById('invite-error');
    if (errEl) errEl.classList.add('hidden');

    const formBody = document.getElementById('invite-form-body');
    if (formBody) formBody.classList.remove('hidden');

    const successBody = document.getElementById('invite-success-body');
    if (successBody) successBody.classList.add('hidden');

    // Setup button with event listener
    const btn = document.getElementById('invite-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Create Account';

      // Remove old listeners and add new one
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', submitInvite);
      newBtn.addEventListener('touchend', submitInvite);
    }

    modal.classList.remove('hidden');
  }

  function toggleContractorFields() {
    const role = document.getElementById('invite-role')?.value;
    const isContractor = role === 'contractor';
    const isTechOrContractor = role === 'tech' || role === 'contractor';

    // Show lead source only for contractor
    document.getElementById('invite-lead-source-group')?.classList.toggle('hidden', !isContractor);

    // Show payout % for tech and contractor
    document.getElementById('invite-payout-group')?.classList.toggle('hidden', !isTechOrContractor);
  }

  function closeInviteModal() {
    document.getElementById('invite-modal')?.classList.add('hidden');
  }

  function _sendLoginCodeWA() {
    if (!_lastInvite || !_lastInvite.loginCode) {
      showToast('No login code available', 'warning');
      return;
    }
    const msg = [
      `Hi ${_lastInvite.name}! You have been added to OnPoint Pro Doors CRM.`,
      '',
      `Your login code: ${_lastInvite.loginCode}`,
      '',
      `To log in:`,
      `1. Open https://crm.onpointprodoors.com`,
      `2. Enter your login code: ${_lastInvite.loginCode}`,
      `3. You'll stay logged in automatically`,
      '',
      `Questions? Call (929) 429-2429`,
    ].join('\n');
    _openWAWithMsg('', msg);
  }

  function _openWAWithMsg(_phone, msg) {
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function _sendInviteWA() {
    const msg = _buildWAAppLinkMsg(_lastInvite.name, _lastInvite.setupLink, _lastInvite.loginEmail);
    _openWAWithMsg(_lastInvite.phone, msg);
  }

  function _sendInviteWAFromInput() {
    const phone = document.getElementById('invite-wa-phone-input')?.value?.trim() || '';
    if (!phone.replace(/\D/g, '')) { showToast('Enter a phone number', 'warning'); return; }
    const msg = _buildWAAppLinkMsg(_lastInvite.name, _lastInvite.setupLink, _lastInvite.loginEmail);
    _openWAWithMsg(phone, msg);
  }

  function _sendCredentialsWA() {
    const msg = _buildWACredentialsMsg(_lastInvite.name, _lastInvite.email, _lastInvite.password);
    _openWAWithMsg('', msg);
  }

  function _buildWACredentialsMsg(name, email, password) {
    const settings = DB.getSettings();
    const ownerPhone = settings.ownerPhone || '(929) 429-2429';
    return [
      `Hi ${name}! Welcome to On Point Pro Doors.`,
      '',
      `You've been added to the team app. Here are your login credentials:`,
      '',
      `Email: ${email}`,
      `Password: ${password}`,
      '',
      `Open the app at:`,
      `https://crm.onpointprodoors.com`,
      '',
      `If you have any issues, call us at ${ownerPhone}.`,
    ].join('\n');
  }

  function _sendUserWALink(userId) {
    const tech = (DB.getSettings().technicians || []).find(t => t.id === userId);
    if (!tech || !tech.phone) { showToast('No phone on file for this user', 'warning'); return; }
    const msg = _buildWAAppLinkMsg(tech.name || 'there', '', '');
    _openWAWithMsg(tech.phone, msg);
  }

  async function submitInvite() {
    if (!Auth.isAdmin()) {
      showToast('Not authorized', 'error');
      return;
    }

    const name  = document.getElementById('invite-name')?.value?.trim();
    const errEl = document.getElementById('invite-error');
    const btn   = document.getElementById('invite-submit-btn');

    if (!name) {
      errEl.textContent = 'Name is required.';
      errEl.classList.remove('hidden');
      return;
    }

    errEl.classList.add('hidden');
    btn.disabled    = true;
    btn.textContent = 'Creating...';

    try {
      // Auto-generate email: name.randomnumber@onpointprodoors.com
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${randomNum}@onpointprodoors.com`;

      // Create dispatcher (generates login code)
      // Role is always 'dispatcher', no payout or lead source
      const result = await Auth.createUser(
        name,
        null,
        'dispatcher',
        null,
        null
      );

      if (!result.success || !result.loginCode) {
        throw new Error('Failed to create user or generate login code');
      }

      // Save for WhatsApp message
      _lastInvite = {
        name,
        loginCode: result.loginCode
      };

      // Refresh users list
      _renderAdminUsersSection().catch(() => {});

      // Show success screen
      document.getElementById('invite-form-body').classList.add('hidden');
      document.getElementById('invite-success-body').classList.remove('hidden');
      document.getElementById('invite-success-name').textContent = name;

      btn.disabled = false;
      btn.textContent = 'Create Account';

    } catch (e) {
      console.error('Create user error:', e);
      showToast('Error: ' + (e.message || 'Unknown error'), 'error');
      if (errEl) {
        errEl.textContent = e.message || 'Failed - please try again';
        errEl.classList.remove('hidden');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    }
  }


  async function _confirmRemoveUser(userId, userName) {
    let jobWarning = '';
    try {
      // Check assigned jobs
      const { count: assignedCount } = await SupabaseClient
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_tech_id', userId);

      // Check created jobs
      const { count: createdCount } = await SupabaseClient
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', userId);

      const totalJobs = (assignedCount || 0) + (createdCount || 0);
      if (totalJobs > 0) {
        const parts = [];
        if (assignedCount > 0) parts.push(`${assignedCount} assigned`);
        if (createdCount > 0) parts.push(`${createdCount} created by them`);
        jobWarning = ` This user has ${totalJobs} job${totalJobs !== 1 ? 's' : ''} (${parts.join(', ')}). All references will be removed.`;
      }
    } catch (_e) { /* non-critical */ }

    showConfirm({
      icon:    '&#128465;',
      title:   'Remove User',
      message: `Remove ${userName} from the app?${jobWarning} This cannot be undone.`,
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

  function saveSettings() {
    return _withLoading('settings-save-btn', _doSaveSettings);
  }

  async function _doSaveSettings() {
    // Build notification preferences object
    const selectedSound = document.querySelector('input[name="notif-sound"]:checked')?.value || 'chime';
    const notifPrefs = {
      enabled: document.getElementById('s-notif-enabled')?.checked !== false,
      sound: selectedSound,
      newJob: document.getElementById('s-notif-new-job')?.checked !== false,
    };

    // Non-admin: save profile + notification preferences
    if (!Auth.isAdmin()) {
      try {
        await Auth.updateProfile({ notification_preferences: notifPrefs });
        showToast('Settings saved', 'success');
      } catch (e) {
        showToast('Failed to save settings: ' + (e.message || 'unknown error'), 'error');
      }
      return;
    }

    // Admin: also save notification preferences
    try {
      await Auth.updateProfile({ notification_preferences: notifPrefs });
    } catch (e) {
      console.error('Failed to save admin notification preferences:', e);
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

  // ── NOTIFICATIONS ──────────────────────────────────────

  function testNotificationSound() {
    const sound = document.getElementById('s-notif-sound')?.value || 'chime';
    if (sound === 'none') {
      showToast('Sound is set to Silent', 'info');
      return;
    }

    // Play the selected sound
    if (window.NotificationSounds) {
      window.NotificationSounds.play(sound);
    } else {
      showToast('Sound system not loaded yet', 'warning');
    }
  }

  async function testNotification() {
    const btn = document.getElementById('btn-test-notification');
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      // Check if notifications are supported
      if (!('Notification' in window)) {
        showToast('Notifications not supported in this browser', 'warning');
        return;
      }

      // Check permission
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }

      if (permission !== 'granted') {
        showToast('Notification permission denied', 'warning');
        return;
      }

      // Show test notification
      const notification = new Notification('ON POINT CRM', {
        body: 'This is a test notification. If you can see this, notifications are working!',
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'test-notification',
        requireInteraction: false,
      });

      // Play sound
      const sound = document.getElementById('s-notif-sound')?.value || 'chime';
      if (sound !== 'none' && window.NotificationSounds) {
        window.NotificationSounds.play(sound);
      }

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      showToast('Test notification sent!', 'success');

    } catch (e) {
      showToast('Failed to send notification: ' + (e.message || 'unknown error'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Test Notification';
    }
  }

  async function requestPushPermission() {
    try {
      if (!('Notification' in window)) {
        showToast('Notifications not supported in this browser', 'warning');
        return;
      }

      const permission = await Notification.requestPermission();

      if (permission === 'granted') {
        // Subscribe to push notifications
        await Auth.subscribeToPush();
        showToast('Notifications enabled! You\'ll be notified when jobs are assigned', 'success');
        _updatePushBanner(); // Hide banner
      } else {
        showToast('Notification permission denied', 'warning');
      }
    } catch (e) {
      showToast('Failed to enable notifications: ' + (e.message || 'unknown error'), 'error');
    }
  }

  function _updatePushBanner() {
    const pushBanner = document.getElementById('push-permission-banner');
    const iphoneBanner = document.getElementById('iphone-pwa-banner');

    const hasPermission = 'Notification' in window && Notification.permission === 'granted';

    // Show push permission banner for ALL users who haven't granted permission
    if (pushBanner) {
      pushBanner.classList.toggle('hidden', hasPermission);
    }

    // Show iPhone PWA banner only on iOS devices that haven't installed as PWA
    if (iphoneBanner) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                           window.navigator.standalone === true;
      const shouldShowIOSBanner = isIOS && !isStandalone && !hasPermission;
      iphoneBanner.classList.toggle('hidden', !shouldShowIOSBanner);
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
    // Tech profiles are for job assignment only (not user accounts)
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

  function saveTech() {
    return _withLoading('btn-save-tech', _doSaveTech);
  }

  async function _doSaveTech() {
    if (!Auth.isAdmin()) {
      showToast('Only admins can manage technicians', 'error');
      return;
    }
    const name = document.getElementById('m-tech-name')?.value?.trim();
    if (!name) { showToast('Enter technician name', 'warning'); return; }

    const pct = parseFloat(document.getElementById('m-tech-pct')?.value) || 0;
    if (pct < 0 || pct > 100) { showToast('Payout % must be 0-100', 'warning'); return; }

    let techId = document.getElementById('m-tech-id')?.value;
    if (!techId) {
      techId = DB.generateId();
    }

    const zipsRaw  = document.getElementById('m-tech-zips')?.value || '';
    const zipCodes = zipsRaw.split(',').map(z => z.trim()).filter(z => /^\d{5}$/.test(z));
    const isOwner  = document.getElementById('m-tech-is-owner')?.checked || false;
    const zelle    = document.getElementById('m-tech-zelle')?.value?.trim()  || '';
    const phone    = document.getElementById('m-tech-phone')?.value?.trim()  || '';
    const color    = document.getElementById('m-tech-color')?.value          || '#3B82F6';

    try {
      const settings = DB.getSettings();
      const techs = [...(settings.technicians || [])];
      if (isOwner) techs.forEach(t => { if (t.id !== techId) t.isOwner = false; });
      const idx = techs.findIndex(t => t.id === techId);
      const updated = { id: techId, name, phone, color, percent: pct, zelle, zipCodes, isOwner, isUserAccount: false };
      if (idx >= 0) techs[idx] = updated; else techs.push(updated);

      console.log('[saveTech] 🔍 Technician data:', JSON.stringify(updated));
      console.log('[saveTech] 🔍 Total technicians:', techs.length);

      // Save via server endpoint (bypasses PostgREST schema cache via RPC)
      console.log('[saveTech] 💾 Saving to database...');
      const standaloneTechs = techs.filter(t => !t.isUserAccount);

      const session = await SupabaseClient.auth.getSession();
      if (!session?.data?.session?.access_token) {
        throw new Error('No active session');
      }

      const response = await fetch('/api/save-technicians', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.data.session.access_token}`
        },
        body: JSON.stringify({ technicians: standaloneTechs })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[saveTech] Server error:', errorData);
        throw new Error(errorData.error || `Save failed: ${response.status}`);
      }

      // Update localStorage cache
      DB.updateSettingsCache({ ...DB.getSettings(), technicians: techs });
      console.log('[saveTech] ✅ Database save successful');

      // Re-render UI
      _renderTechList(techs);
      _renderTechSelector();
      closeModal();
      showToast(`${name} saved`, 'success');
      console.log('[saveTech] ✅ Complete - technician will persist after refresh');
    } catch (e) {
      console.error('[saveTech] ❌ PRODUCTION ERROR:', e);
      showToast('Failed to save: ' + (e.message || 'unknown error'), 'error');
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
          // Only delete from profiles if this is a user account
          if (tech?.isUserAccount) {
            console.log('[deleteTech] Deleting user profile:', techId);
            await DB.deleteProfile(techId);
          } else {
            console.log('[deleteTech] Standalone tech, not deleting from profiles');
          }

          // Remove from technicians list
          const updated = (settings.technicians || []).filter(t => t.id !== techId);

          // Save via server endpoint (bypasses PostgREST schema cache via RPC)
          const standaloneTechs = updated.filter(t => !t.isUserAccount);

          const session = await SupabaseClient.auth.getSession();
          if (!session?.data?.session?.access_token) {
            throw new Error('No active session');
          }

          const response = await fetch('/api/save-technicians', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.data.session.access_token}`
            },
            body: JSON.stringify({ technicians: standaloneTechs })
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Delete save failed: ${response.status}`);
          }

          // Update localStorage cache
          DB.updateSettingsCache({ ...DB.getSettings(), technicians: updated });

          _renderTechList(DB.getSettings().technicians);
          _renderTechSelector();
          showToast('Technician removed', 'success');
        } catch (e) {
          console.error('[deleteTech] Error:', e);
          showToast('Failed to remove: ' + (e.message || 'unknown error'), 'error');
        }
      }
    });
  }

  // ── LEAD SOURCES ─────────────────────────────────────

  async function _renderSourceList(sources = []) {
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
        </div>
        <div class="settings-item-actions">
          <button class="btn-icon" onclick="App.showSourceModal('${s.id}')" title="Edit">&#9998;</button>
          <button class="btn-icon" onclick="App.deleteSource('${s.id}')" title="Delete" style="color:var(--color-error)">&#128465;</button>
        </div>
      </div>
    `).join('');
  }

  async function showSourceModal(sourceId) {
    const settings = DB.getSettings();
    const source = sourceId ? settings.leadSources.find(s => s.id === sourceId) : null;
    const title = document.getElementById('source-modal-title');
    if (title) title.textContent = source ? 'Edit Lead Source' : 'Add Lead Source';

    document.getElementById('m-source-id').value   = source?.id   || '';
    document.getElementById('m-source-name').value = source?.name || '';

    showModal('modal-source');
  }

  function saveSource() {
    return _withLoading('btn-save-source', _doSaveSource);
  }

  async function _doSaveSource() {
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

    // Block duplicate names (case-insensitive), ignoring the record being edited
    const nameLC = name.toLowerCase();
    const duplicate = sources.find(s => s.name.toLowerCase() === nameLC && s.id !== existingId);
    if (duplicate) { showToast(`"${name}" already exists`, 'warning'); return; }

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

    try {
      await DB.saveSettings({ leadSources: sources });
      _renderSourceList(sources);
      _populateSourceDropdown();
      closeModal();
      showToast(`${name} saved`, 'success');
    } catch (e) {
      showToast('Failed to save: ' + (e.message || 'unknown error'), 'error');
    }
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
        try {
          const settings = DB.getSettings();
          const sources = (settings.leadSources || []).filter(s => s.id !== sourceId);
          await DB.saveSettings({ leadSources: sources });
          _renderSourceList(sources);
          _populateSourceDropdown();
          showToast('Source deleted', 'success');
        } catch (e) {
          showToast('Failed to delete: ' + (e.message || 'unknown error'), 'error');
        }
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

        // Auto-sync to Google Sheets when job is closed
        if (newStatus === 'closed' && Auth.isAdminOrDisp()) {
          const updatedJob = DB.getJobById(jobId);
          SyncManager.syncJob(updatedJob).then(result => {
            if (result.success && !result.skipped) {
              console.log(`[Auto-sync] Job ${jobId} synced to Google Sheets`);
            }
          }).catch(err => {
            console.warn(`[Auto-sync] Failed for job ${jobId}:`, err);
          });
        }
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
  // LIGHT MODE ONLY (dark mode removed per user request)
  // ══════════════════════════════════════════════════════════

  function _initDarkMode() {
    // ALWAYS use light theme - dark mode removed
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('op_dark_mode', '0');
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
      const safetyTimeout = setTimeout(() => indicator.classList.remove('ptr-loading'), 5000);
      try {
        await DB._syncJobsDown();
        renderDashboard();
        renderJobList();
        if (_jobsViewMode === 'kanban') renderKanban();
        showToast('Refreshed', 'success', 1500);
      } catch (e) {
        console.error('Pull to refresh failed:', e);
      } finally {
        clearTimeout(safetyTimeout);
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
    try {
      const result = await SyncManager.testConnection();
      if (result.success) {
        showToast('Connection successful!', 'success');
      } else {
        showToast(result.error || 'Connection failed', 'error');
      }
    } catch (e) {
      showToast('Connection test failed — check Apps Script URL', 'error');
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

  async function forceClearCache() {
    showToast('Clearing cache...', 'info');

    try {
      // Save auth tokens before clearing
      const magicToken = localStorage.getItem('magic_token');
      const stayLoggedIn = localStorage.getItem('stay_logged_in');

      // Clear localStorage and sessionStorage
      localStorage.clear();
      sessionStorage.clear();

      // Restore auth tokens so user stays logged in
      if (magicToken) localStorage.setItem('magic_token', magicToken);
      if (stayLoggedIn) localStorage.setItem('stay_logged_in', stayLoggedIn);

      // Clear IndexedDB if exists
      try {
        indexedDB.deleteDatabase('offline_queue');
      } catch (e) {
        console.error('IndexedDB clear failed:', e);
      }

      // Clear service worker cache
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }

      showToast('✅ Cache cleared! Reloading...', 'success');

      // Hard reload to get fresh data
      setTimeout(() => {
        window.location.href = window.location.href.split('#')[0];
        window.location.reload(true);
      }, 500);
    } catch (error) {
      console.error('Force clear failed:', error);
      showToast('❌ Clear failed, trying simpler reload...', 'error');
      setTimeout(() => window.location.reload(true), 500);
    }
  }

  function clearAllData() {
    showConfirm({
      icon: '&#9888;',
      title: 'Clear ALL Data?',
      message: 'This will permanently delete all jobs and settings from your device. Jobs in the database will remain.',
      okLabel: 'Clear Everything',
      onOk: async () => {
        await forceClearCache();
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
      // Handle time window format (e.g., "14-16" → "2-4 PM")
      if (timeStr.includes('-')) {
        const [start, end] = timeStr.split('-').map(Number);
        const startAmpm = start >= 12 ? 'PM' : 'AM';
        const endAmpm = end >= 12 ? 'PM' : 'AM';
        const start12 = start > 12 ? start - 12 : start === 0 ? 12 : start;
        const end12 = end > 12 ? end - 12 : end === 0 ? 12 : end;

        // Show AM/PM on both if they differ, otherwise just at the end
        if (startAmpm !== endAmpm) {
          return `${start12} ${startAmpm}-${end12} ${endAmpm}`;
        } else {
          return `${start12}-${end12} ${endAmpm}`;
        }
      }

      // Backward compatibility: handle old "HH:MM" format
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

  function _thisWeekSundayStr() {
    const d = new Date();
    const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
    d.setDate(d.getDate() - dayOfWeek); // Go back to most recent Sunday
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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
      job.closingDetails ? `*Details:* ${_esc(job.closingDetails)}` : '',
    ];

    // For paid jobs, show job total and parts only
    if (job.status === 'paid') {
      const jobTotal = parseFloat(job.jobTotal) || 0;
      const parts = parseFloat(job.partsCost) || 0;

      lines.push('');
      if (jobTotal > 0) lines.push(`*Job Total:* $${jobTotal.toFixed(2)}`);
      if (parts > 0)    lines.push(`*Parts:* $${parts.toFixed(2)}`);
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

  // Tech dispatch message — sent to assigned technician's WhatsApp
  function _buildWhatsAppTechDispatchMsg(job) {
    const settings = DB.getSettings();
    const fullAddress = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ') || 'See job details';
    const googleMapsLink = job.address ? `https://maps.google.com/?q=${encodeURIComponent(fullAddress)}` : null;
    const dateLine = job.scheduledDate ? _formatDate(job.scheduledDate) : 'TBD';
    const timeLine = job.scheduledTime ? _formatTime(job.scheduledTime) : 'TBD';
    const ownerPhone = settings.ownerPhone || '(929) 429-2429';

    const lines = [
      '*🏢 ON POINT PRO DOORS*',
      '*━━━━━━━━━━━━━━━━━━━━━━━*',
      '*🔔 NEW JOB ASSIGNMENT*',
      '*━━━━━━━━━━━━━━━━━━━━━━━*',
      '',
      '*👤 CUSTOMER*',
      `  • ${job.customerName || 'N/A'}`,
      `  • ${job.phone || 'N/A'}`,
      '',
      '*📍 LOCATION*',
      googleMapsLink ? `  ${googleMapsLink}` : `  ${fullAddress}`,
      '',
      '*📅 SCHEDULE*',
      `  • Date: ${dateLine}`,
      `  • Time: ${timeLine}`,
      `  • Service: ${job.description || 'Garage Door Service'}`,
    ];

    if (job.notes) {
      lines.push('');
      lines.push('*📝 NOTES*');
      lines.push(`  ${job.notes}`);
    }

    const techPayout = parseFloat(job.techPayout) || parseFloat(job.contractorFee) || 0;
    if (techPayout > 0) {
      lines.push('');
      lines.push('*💰 YOUR PAYOUT*');
      lines.push(`  *$${techPayout.toFixed(2)}*`);
    }

    lines.push('');
    lines.push('*━━━━━━━━━━━━━━━━━━━━━━━*');
    lines.push('Have a great day! 🚀');

    return lines.join('\n');
  }

  // Open WhatsApp with job details (user chooses recipient)
  function openWhatsApp(jobId) {
    if (!Auth.isAdminOrDisp()) return;
    const job = DB.getJobById(jobId);
    if (!job) { showToast('Job not found', 'error'); return; }

    // Build message with job details
    // For paid jobs, use full breakdown; otherwise use tech dispatch message
    const msg = job.status === 'paid'
      ? _buildWhatsAppJobText(job)
      : _buildWhatsAppTechDispatchMsg(job);

    // Open WhatsApp with pre-filled message (user chooses recipient)
    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
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
    // Remove app shell immediately
    _removeAppShell();

    const currentUser = await Auth.init(async (user) => {
      if (user) {
        if (_firstSetupInProgress) return;
        console.log('[App] User authenticated, calling _onAuthenticated');
        await _onAuthenticated();
      } else {
        // No user - show magic link input instead of error
        console.warn('[App] No user - showing magic link input');
        _showMagicLinkInput();
      }
    });

    if (currentUser) {
      console.log('[App] Current user exists, calling _onAuthenticated');
      await _onAuthenticated();
    } else {
      // Show magic link input
      _showMagicLinkInput();
    }
  }

  function _showMagicLinkInput() {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a2e;padding:20px">
        <div style="max-width:400px;width:100%;text-align:center">
          <img src="assets/logo.jpg" alt="Logo" style="width:120px;height:120px;border-radius:50%;margin-bottom:24px;box-shadow:0 4px 12px rgba(0,0,0,0.3)">
          <h1 style="color:#fff;margin-bottom:12px;font-size:24px">Welcome to On Point CRM</h1>
          <p style="color:#aaa;margin-bottom:32px;font-size:14px">Enter your login code or paste your link</p>
          <input type="text" id="magic-link-input" placeholder="DISPATCHER-A1B2 or paste full link"
            style="width:100%;padding:14px;border:2px solid #333;border-radius:8px;background:#16213e;color:#fff;font-size:14px;margin-bottom:16px;box-sizing:border-box"
            autocomplete="off" autocapitalize="off">
          <button id="magic-link-btn"
            style="width:100%;padding:14px;background:#0066ff;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">
            Continue
          </button>
          <p style="color:#666;margin-top:24px;font-size:12px">Don't have a code? Contact your administrator</p>
        </div>
      </div>
    `;

    const input = document.getElementById('magic-link-input');
    const btn = document.getElementById('magic-link-btn');

    const processLink = () => {
      let inputValue = input.value.trim();
      if (!inputValue) return;

      let token = inputValue;

      // If input contains URL with #token= or token=, extract just the token
      if (inputValue.includes('#token=')) {
        token = inputValue.split('#token=')[1].split('&')[0];
      } else if (inputValue.includes('token=') && inputValue.includes('http')) {
        token = inputValue.split('token=')[1].split('&')[0];
      }

      if (token) {
        console.log('[App] Login code/token:', token.substring(0, 10) + '...');
        // Store in all locations
        localStorage.setItem('magic_token', token);
        localStorage.setItem('onpoint-pwa-auth-magic_token', token);
        localStorage.setItem('onpoint-web-auth-magic_token', token);
        sessionStorage.setItem('magic_token', token);
        // Reload to trigger auth
        window.location.reload();
      } else {
        alert('Please enter your login code or paste your full link.');
      }
    };

    btn.onclick = processLink;
    input.onkeypress = (e) => { if (e.key === 'Enter') processLink(); };
    input.focus();
  }

  let _setupCheckInProgress = false;
  async function _checkAndShowFirstSetup() {
    if (_setupCheckInProgress) return; // prevent duplicate call from auth callback + init()
    _setupCheckInProgress = true;
    // Show login screen immediately so the app shell disappears < 2s
    // then asynchronously check if first-admin setup is needed and swap if so
    _removeAppShell();
    LoginScreen.show();
    try {
      const needed = await Auth.checkFirstSetupNeeded();
      if (needed) {
        LoginScreen.hide();
        SetupScreen.show();
      }
      // else: login screen is already showing — nothing to do
    } catch (_e) {
      // Login screen is already showing — swallow error silently
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
  async function showDispatcherPermissions(userId) {
    if (!Auth.isAdmin()) return;
    const modal = document.getElementById('dispatcher-permissions-modal');
    if (!modal) return;

    document.getElementById('dp-user-id').value = userId;

    // Get current user's permissions
    const { data: profile } = await SupabaseClient
      .from('profiles')
      .select('allowed_lead_sources')
      .eq('id', userId)
      .single();

    const allowed = profile?.allowed_lead_sources || [];

    // Get all lead sources + always include "Direct" (owner's leads)
    const settings = DB.getSettings();
    const leadSources = settings.leadSources || [];

    const list = document.getElementById('dp-lead-sources-list');
    // First add "Direct" option (stored as "my_lead" in database)
    let html = `
      <label class="checkbox-label" style="padding:12px;margin:4px 0;background:var(--color-surface-2);border-radius:8px">
        <input type="checkbox" value="my_lead" ${allowed.includes('my_lead') ? 'checked' : ''}>
        <span>Direct</span>
      </label>
    `;
    // Then add all other lead sources
    html += leadSources.map(ls => `
      <label class="checkbox-label" style="padding:12px;margin:4px 0;background:var(--color-surface-2);border-radius:8px">
        <input type="checkbox" value="${_esc(ls.name)}" ${allowed.includes(ls.name) ? 'checked' : ''}>
        <span>${_esc(ls.name)}</span>
      </label>
    `).join('');
    list.innerHTML = html;

    modal.classList.remove('hidden');
  }

  async function saveDispatcherPermissions() {
    if (!Auth.isAdmin()) return;
    const userId = document.getElementById('dp-user-id')?.value;
    if (!userId) return;

    const checkboxes = document.querySelectorAll('#dp-lead-sources-list input[type="checkbox"]:checked');
    const allowedSources = Array.from(checkboxes).map(cb => cb.value);

    try {
      await SupabaseClient
        .from('profiles')
        .update({
          allowed_lead_sources: allowedSources,
          assigned_lead_source: allowedSources.length > 0 ? allowedSources[0] : null
        })
        .eq('id', userId);

      showToast('Permissions updated', 'success');
      closeModal();
      _renderAdminUsersSection();
    } catch (e) {
      showToast('Failed to update permissions: ' + (e.message || 'unknown error'), 'error');
    }
  }


  // ══════════════════════════════════════════════════════════
  // RECONNECT - Re-subscribe to realtime channels
  // ══════════════════════════════════════════════════════════

  async function onReconnect() {
    console.log('[App] Reconnecting - re-subscribing to channels...');

    // Re-sync data from server
    await DB.syncJobsFromRemote();
    renderDashboard();
    renderJobList();

    // Channels should auto-reconnect via Supabase client
    // Just sync any queued offline operations
    if (window.OfflineQueue) {
      await OfflineQueue.sync();
    }

    console.log('[App] Reconnection complete');
  }

  return {
    init,

    // Auth
    logout,
    toggleUserMenu,
    closeUserMenu,
    toggleMoreMenu,
    hideMoreMenu,

    navigate,
    goBack,
    onReconnect,

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
    markJobLost,
    _updateClosePreview,
    _closeSelectPay,
    _closeTaxSelect,
    _saveEditedJob,
    confirmDeleteJob,

    // Zelle
    showZelleMemo,
    _copyZelleMemo,
    openZelleRequest,
    _checkZelleFallback,

    // Photos
    handlePhotoUpload,
    viewPhoto,
    deletePhoto,

    // Calendar
    renderCalendar,
    calendarShift,
    calendarToday,
    calendarFilterByTech,
    dispatchTechSchedule,

    // PDF
    navigateToJob,
    toggleDetailSection,
    exportJobPDF,


    // Admin invite
    showDispatcherPermissions,
    saveDispatcherPermissions,
    showInviteModal,
    closeInviteModal,
    toggleContractorFields,
    submitInvite,
    _changeUserRole,
    _confirmRemoveUser,
    _sendInviteWA,
    _sendInviteWAFromInput,
    _sendCredentialsWA,
    _sendLoginCodeWA,
    _sendUserWALink,
    _renderAdminUsersSection,

    // WhatsApp
    openWhatsApp,

    // Settings
    saveSettings,
    testNotification,
    testNotificationSound,
    requestPushPermission,
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
    forceClearCache,

    // Kanban / view toggle
    toggleJobsView,
    renderKanban,

    // Follow-up
    sendFollowUpWhatsApp,

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

// Last-resort safety net — only fires if app-shell is STILL visible after 6s
// (meaning auth init genuinely hung). Never fires when the app loaded correctly.
window.addEventListener('load', () => {
  setTimeout(() => {
    const shell = document.getElementById('app-shell');
    // Only act if the shell is still in the DOM and visible
    if (!shell || shell.style.display === 'none') return;
    const login = document.getElementById('login-screen');
    const app   = document.getElementById('app');
    const appVisible = app && !app.classList.contains('hidden');
    const loginVisible = login && !login.classList.contains('hidden');
    if (!appVisible && !loginVisible) {
      shell.style.display = 'none';
      if (login) login.classList.remove('hidden');
    }
  }, 6000);
});

// ============================================================
// IDENTITY DEBUG UI
// ============================================================

async function refreshIdentityDebug() {
  const output = document.getElementById('identity-debug-output');
  if (!output) return;

  try {
    // Get all identity sources
    const currentUser = Auth.getUser();
    const { data: { session } } = await SupabaseClient.auth.getSession();
    const { data: { user: authUser } } = await SupabaseClient.auth.getUser();

    let profileData = null;
    if (session?.user?.id) {
      const { data } = await SupabaseClient
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      profileData = data;
    }

    // Check for mismatches
    const sessionId = session?.user?.id;
    const authId = authUser?.id;
    const currentId = currentUser?.id;
    const profileId = profileData?.id;

    const allMatch =
      sessionId === authId &&
      authId === currentId &&
      currentId === profileId;

    const html = `
<div style="line-height: 1.6;">
  <div style="margin-bottom: 10px; font-weight: bold; color: ${allMatch ? '#0f0' : '#f00'};">
    ${allMatch ? '✅ ALL IDs MATCH' : '❌ IDENTITY MISMATCH DETECTED'}
  </div>

  <div style="margin-bottom: 15px;">
    <div style="color: #0ff; margin-bottom: 5px;">📱 Session (localStorage):</div>
    <div>  user_id: ${sessionId || 'null'}</div>
    <div>  email: ${session?.user?.email || 'null'}</div>
    <div>  created: ${session?.user?.created_at || 'null'}</div>
  </div>

  <div style="margin-bottom: 15px;">
    <div style="color: #0ff; margin-bottom: 5px;">🔐 Auth.getUser() (Supabase):</div>
    <div>  user_id: ${authId || 'null'}</div>
    <div>  email: ${authUser?.email || 'null'}</div>
    <div>  created: ${authUser?.created_at || 'null'}</div>
  </div>

  <div style="margin-bottom: 15px;">
    <div style="color: #0ff; margin-bottom: 5px;">👤 App currentUser:</div>
    <div>  user_id: ${currentId || 'null'}</div>
    <div>  name: ${currentUser?.name || 'null'}</div>
    <div>  role: ${currentUser?.role || 'null'}</div>
    <div>  email: ${currentUser?.email || 'null'}</div>
  </div>

  <div style="margin-bottom: 15px;">
    <div style="color: #0ff; margin-bottom: 5px;">📋 Database Profile:</div>
    <div>  profile_id: ${profileId || 'null'}</div>
    <div>  name: ${profileData?.name || 'null'}</div>
    <div>  role: ${profileData?.role || 'null'}</div>
    <div>  created: ${profileData?.created_at || 'null'}</div>
  </div>

  <div style="margin-top: 15px; padding: 10px; background: ${allMatch ? '#064e3b' : '#450a0a'}; border-radius: 4px;">
    ${allMatch
      ? '✅ Identity is consistent across all sources'
      : '❌ WARNING: Stale session detected. Use "Clear All & Force Logout" button.'}
  </div>
</div>
`;

    output.innerHTML = html;
  } catch (error) {
    output.innerHTML = `<div style="color: #f00;">Error loading identity data: ${error.message}</div>`;
  }
}

async function clearAllSessions() {
  if (!confirm('This will clear all cached data and force logout. Continue?')) {
    return;
  }

  try {
    // Clear Supabase session
    await SupabaseClient.auth.signOut();

    // Clear all localStorage
    localStorage.clear();

    // Clear all sessionStorage
    sessionStorage.clear();

    // Force reload
    window.location.reload();
  } catch (error) {
    alert('Error clearing sessions: ' + error.message);
  }
}

// Make functions globally available
window.refreshIdentityDebug = refreshIdentityDebug;
window.clearAllSessions = clearAllSessions;

// ============================================================
// PUSH EVENT LOGS (DURABLE)
// ============================================================

async function refreshPushLogs() {
  const output = document.getElementById('push-logs-output');
  if (!output) return;

  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('OnPointCRM_PushLogs', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('push_events')) {
          const store = db.createObjectStore('push_events', { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });

    const tx = db.transaction(['push_events'], 'readonly');
    const store = tx.objectStore('push_events');
    const logs = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();

    if (logs.length === 0) {
      output.innerHTML = '<div style="color: #888;">No push events logged yet. Background push events will appear here.</div>';
      return;
    }

    // Sort by timestamp descending (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const html = logs.slice(0, 50).map((log, index) => {
      const color = log.event === 'PUSH_ERROR' ? '#f00' :
                    log.event === 'NOTIFICATION_SHOWN' ? '#0f0' :
                    '#0ff';

      return `
<div style="margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-left: 3px solid ${color};">
  <div style="color: ${color}; font-weight: bold;">${index + 1}. ${log.event}</div>
  <div>Timestamp: ${log.timestamp}</div>
  ${log.data ? `<div>Title: ${log.data.title || 'N/A'}</div>` : ''}
  ${log.data ? `<div>Body: ${log.data.body || 'N/A'}</div>` : ''}
  ${log.data ? `<div>Job ID: ${log.data.jobId || 'N/A'}</div>` : ''}
  ${log.title ? `<div>Title: ${log.title}</div>` : ''}
  ${log.body ? `<div>Body: ${log.body}</div>` : ''}
  ${log.jobId ? `<div>Job ID: ${log.jobId}</div>` : ''}
  ${log.parseError ? `<div style="color: #ff0;">Parse Error: ${log.parseError}</div>` : ''}
  ${log.error ? `<div style="color: #f00;">Error: ${log.error.message}</div>` : ''}
  ${log.error && log.error.stack ? `<div style="color: #f00; font-size: 10px; overflow-x: auto;">Stack: ${log.error.stack}</div>` : ''}
</div>
      `.trim();
    }).join('');

    output.innerHTML = `
<div style="margin-bottom: 10px; color: #0f0;">
  Total Events: ${logs.length} (showing last 50)
</div>
${html}
    `;

  } catch (error) {
    output.innerHTML = `<div style="color: #f00;">Error loading push logs: ${error.message}</div>`;
  }
}

async function clearPushLogs() {
  if (!confirm('Clear all push event logs?')) return;

  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('OnPointCRM_PushLogs', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    const tx = db.transaction(['push_events'], 'readwrite');
    const store = tx.objectStore('push_events');
    store.clear();

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();

    alert('Push logs cleared');
    refreshPushLogs();
  } catch (error) {
    alert('Error clearing logs: ' + error.message);
  }
}

window.refreshPushLogs = refreshPushLogs;
window.clearPushLogs = clearPushLogs;

// Auto-refresh identity debug and push logs when settings view is shown
const settingsObserver = new MutationObserver(() => {
  const settingsView = document.getElementById('view-settings');
  if (settingsView && !settingsView.classList.contains('hidden')) {
    refreshIdentityDebug();
    refreshPushLogs();
  }
});

// Observe body for class changes on views
if (document.body) {
  settingsObserver.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
}
