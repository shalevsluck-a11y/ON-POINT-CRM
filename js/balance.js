/**
 * BALANCE MODULE
 * Financial reporting: Overall & By-Tech balance reports
 * Admin-only feature
 */

const Balance = (function() {
  let currentReportType = null;
  let currentReportData = null;

  // Range picker state
  let calCursor = startOfMonth(new Date());   // visible month
  let selStart  = null;                       // Date | null
  let selEnd    = null;                       // Date | null
  let hoverDate = null;                       // for in-range hover preview

  function init() {
    console.log('[Balance] Module initialized');

    // Populate tech selector
    populateTechSelector();

    // Populate lead source selector
    populateLeadSourceSelector();

    // No auto-default — user must pick both dates from scratch.
    // Per-user complaint: pre-filled start date felt random and blocked re-selection.
    selStart = null;
    selEnd   = null;
    calCursor = startOfMonth(new Date());
    syncHiddenInputs();
    renderCalendar();
    updateRangeLabel();

    // Dismiss the popup on outside press. Use mousedown so the contains() check
    // happens BEFORE the inline onclick replaces the calendar grid (which would
    // detach the clicked button and cause a false-positive outside-click).
    document.addEventListener('mousedown', function(e) {
      const popup = document.getElementById('bal-range-popup');
      const trigger = document.getElementById('bal-range-trigger');
      if (!popup || !trigger) return;
      if (popup.classList.contains('hidden')) return;
      if (popup.contains(e.target) || trigger.contains(e.target)) return;
      popup.classList.add('hidden');
    });
  }

  async function populateTechSelector() {
    try {
      console.log('[Balance] ═══ TECH SELECTOR START ═══');
      const settings = DB.getSettings();
      const techs = settings.technicians || [];
      console.log('[Balance] Got techs from settings:', techs?.length || 0, techs);

      const select = document.getElementById('balance-tech-select');
      if (!select) {
        console.error('[Balance] ❌ balance-tech-select element NOT FOUND');
        return;
      }

      select.innerHTML = '<option value="">All Techs</option>';
      techs.forEach(tech => {
        const option = document.createElement('option');
        option.value = tech.id;
        option.textContent = tech.name;
        select.appendChild(option);
        console.log('[Balance] Added tech option:', tech.name);
      });
      console.log('[Balance] ✅ Tech selector populated with', techs.length, 'techs');
    } catch (err) {
      console.error('[Balance] ❌ Failed to load techs:', err);
      console.error('[Balance] Error stack:', err.stack);
    }
  }

  function populateLeadSourceSelector() {
    try {
      const filterDiv = document.getElementById('balance-source-filter');
      const select = document.getElementById('balance-source-select');
      if (!filterDiv || !select) {
        console.error('[Balance] ❌ MISSING ELEMENTS - filterDiv:', !!filterDiv, 'select:', !!select);
        return;
      }

      const user = Auth.getUser();
      const settings = DB.getSettings();
      const allLeadSources = settings.leadSources || [];
      const isAdmin = Auth.isAdmin();

      console.log('[Balance] ╔══════════════════════════════════════════════════════════');
      console.log('[Balance] ║ POPULATE LEAD SOURCE DROPDOWN');
      console.log('[Balance] ╠══════════════════════════════════════════════════════════');
      console.log('[Balance] ║ User:', user?.name, 'Role:', user?.role);
      console.log('[Balance] ║ IsAdmin:', isAdmin);
      console.log('[Balance] ║ FULL SETTINGS OBJECT:', JSON.stringify(settings));
      console.log('[Balance] ╠══════════════════════════════════════════════════════════');
      console.log('[Balance] ║ settings.leadSources:', JSON.stringify(allLeadSources));
      console.log('[Balance] ║ settings.leadSources length:', allLeadSources.length);
      console.log('[Balance] ║ settings.leadSources type:', typeof allLeadSources);
      console.log('[Balance] ║ settings.leadSources is array?', Array.isArray(allLeadSources));
      console.log('[Balance] ╚══════════════════════════════════════════════════════════');

      // CRITICAL FIX: Admin should ALWAYS see all sources
      let allowedSources = [];

      if (isAdmin) {
        // Admin sees ALL sources from settings
        allowedSources = [...allLeadSources];
        console.log('[Balance] ✅ Admin - showing ALL', allowedSources.length, 'sources:', allowedSources.map(s => s.name));
      } else {
        // Non-admin: filter by permissions
        const userAllowedSources = user?.allowedLeadSources;
        console.log('[Balance] Non-admin permissions:', userAllowedSources);

        if (userAllowedSources && Array.isArray(userAllowedSources) && userAllowedSources.length > 0) {
          allowedSources = allLeadSources.filter(s => userAllowedSources.includes(s.name));
          console.log('[Balance] ✅ Filtered:', allowedSources.map(s => s.name));
        }
      }

      // Apply permission-based logic
      if (allowedSources.length === 0) {
        filterDiv.style.display = 'none';
        select.dataset.lockedSource = '';
        console.log('[Balance] ❌ No sources - hiding filter');
        return;
      }

      // NON-ADMIN with exactly 1 source: auto-select and LOCK
      if (!isAdmin && allowedSources.length === 1) {
        console.log('[Balance] 🔒 Non-admin with 1 source - locking to:', allowedSources[0].name);
        filterDiv.style.display = 'none';  // Hide the entire filter section
        select.dataset.lockedSource = allowedSources[0].name;
        select.innerHTML = `<option value="${allowedSources[0].name}">${allowedSources[0].name}</option>`;
        select.disabled = true;
        select.value = allowedSources[0].name;
        console.log('[Balance] ✅ Locked source:', select.value);
        return;  // Done - user cannot change source
      }

      // ADMIN or NON-ADMIN with 2+ sources: show dropdown
      console.log('[Balance] 📋 Showing dropdown for', allowedSources.length, 'sources');
      filterDiv.style.display = 'block';
      select.dataset.lockedSource = '';
      select.disabled = false;

      // Build dropdown options
      if (isAdmin) {
        select.innerHTML = '<option value="">All Sources</option>';
        console.log('[Balance] ✅ Added "All Sources" for admin');
      } else {
        // Non-admin with 2+ sources: NO "All Sources" option
        select.innerHTML = '';
        console.log('[Balance] ⚠️ Non-admin - no "All Sources" option');
      }

      allowedSources.forEach(source => {
        const option = document.createElement('option');
        option.value = source.name;
        option.textContent = source.name;
        select.appendChild(option);
        console.log('[Balance] ✅ Added option:', source.name);
      });

      // Auto-select first source for non-admin (they have 2+ at this point)
      if (!isAdmin && select.options.length > 0) {
        select.selectedIndex = 0;
        console.log('[Balance] 🎯 Auto-selected first source:', select.value);
      }

      // Add change handler
      select.onchange = function() {
        console.log('[Balance] 🔄 Source changed to:', this.value);
        const reportSection = document.getElementById('balance-report');
        if (reportSection && !reportSection.classList.contains('hidden')) {
          console.log('[Balance] 🔄 Regenerating report...');
          generateReport();
        } else {
          console.log('[Balance] ℹ️ No report visible, not regenerating');
        }
      };

      console.log('[Balance] ✅ Dropdown ready - options:', select.options.length, 'disabled:', select.disabled);
      console.log('[Balance] ══════════════════════════════════════');
    } catch (err) {
      console.error('[Balance] Failed to load lead sources:', err);
    }
  }

  function showMenu() {
    document.getElementById('balance-menu').classList.remove('hidden');
    document.getElementById('balance-options').classList.add('hidden');
    document.getElementById('balance-report').classList.add('hidden');
    currentReportType = null;
  }

  function showReportOptions(type) {
    // When the back-arrow on the report view calls this with no arg,
    // keep the previously-chosen report type instead of wiping it.
    if (type) currentReportType = type;
    document.getElementById('balance-menu').classList.add('hidden');
    document.getElementById('balance-options').classList.remove('hidden');
    document.getElementById('balance-report').classList.add('hidden');

    document.getElementById('balance-options-title').textContent = 'Balance by Tech';

    // Tech selector is always relevant now — only report type left is Balance
    // by Tech. (Previously gated on the "type" param, which meant it silently
    // hid itself if you tapped Back from the report view and re-entered with
    // no explicit type - a pre-existing bug, fixed here since it's the exact
    // path being simplified.)
    document.getElementById('balance-tech-selector')?.classList.remove('hidden');
  }

  async function generateReport() {
    try {
      const status = document.getElementById('balance-status').value;
      const select = document.getElementById('balance-source-select');

      // Get source filter - either from dropdown or locked source
      let sourceFilter = null;
      if (select) {
        sourceFilter = select.dataset.lockedSource || select.value || null;
      }

      const techId = currentReportType === 'tech'
        ? document.getElementById('balance-tech-select').value
        : null;

      // Custom date range is the only supported mode now.
      const dateRange = getDateRange();
      if (!dateRange) return;
      const period = 'custom';

      // Fetch jobs
      const allJobs = DB.getJobs();
      let jobs = filterJobs(allJobs, dateRange, status, sourceFilter);

      // For tech reports, further filter by techId
      let reportJobs = jobs;
      if (currentReportType === 'tech' && techId) {
        reportJobs = jobs.filter(j => j.assignedTechId === techId);
      }

      // Only report type left is Balance by Tech.
      const reportHTML = generateTechReport(jobs, period, status, techId, dateRange);

      // Store report data for export (use filtered jobs for tech reports)
      currentReportData = {
        type: currentReportType,
        period,
        status,
        sourceFilter,
        techId,
        jobs: reportJobs,
        dateRange
      };

      // Display report
      document.getElementById('balance-report-content').innerHTML = reportHTML;
      document.getElementById('balance-options').classList.add('hidden');
      document.getElementById('balance-report').classList.remove('hidden');

    } catch (err) {
      console.error('[Balance] Report generation failed:', err);
      alert('Failed to generate report: ' + err.message);
    }
  }

  // ── Range picker (custom-only mode) ─────────────────────────────
  function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function isoDay(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function toggleRangePicker() {
    const popup = document.getElementById('bal-range-popup');
    if (!popup) return;
    const willOpen = popup.classList.contains('hidden');
    popup.classList.toggle('hidden');
    if (willOpen) {
      // Open onto the month of the current start (or today)
      calCursor = startOfMonth(selStart || new Date());
      renderCalendar();
    }
  }

  function calNav(delta) {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + delta, 1);
    renderCalendar();
  }

  // Public signatures: accept (y, m, day) from inline calendar handlers.
  function selectDate(y, m, day) {
    const d = new Date(y, m, day);
    if (!selStart || (selStart && selEnd)) {
      // Fresh range: set start, clear end
      selStart = d;
      selEnd = null;
      hoverDate = null;
    } else {
      // Have start, no end → set end (swap if earlier so start <= end)
      if (d.getTime() < selStart.getTime()) {
        selEnd = selStart;
        selStart = d;
      } else {
        selEnd = d;
      }
      hoverDate = null;
    }
    renderCalendar();
    updateRangeStatus();
    // Auto-apply once both dates are picked — no need for a separate Apply click.
    if (selStart && selEnd) {
      applyRange();
    }
  }

  function onHoverDate(y, m, day) {
    if (selStart && !selEnd) {
      const d = new Date(y, m, day);
      // Guard: re-render only when the hover date actually changes.
      // Without this, replacing the grid HTML fires mouseenter on the new
      // button at the same position, which calls back into here, which
      // re-renders — an infinite loop that swallows the user's next click.
      if (hoverDate && sameDay(hoverDate, d)) return;
      hoverDate = d;
      renderCalendar(/*keepFocus*/ true);
    }
  }

  function clearRange() {
    selStart = null;
    selEnd = null;
    hoverDate = null;
    document.getElementById('balance-custom-start').value = '';
    document.getElementById('balance-custom-end').value = '';
    renderCalendar();
    updateRangeStatus();
    updateRangeLabel();
  }

  function applyRange() {
    if (!selStart || !selEnd) return;
    syncHiddenInputs();
    updateRangeLabel();
    document.getElementById('bal-range-popup').classList.add('hidden');
  }

  function syncHiddenInputs() {
    const sInput = document.getElementById('balance-custom-start');
    const eInput = document.getElementById('balance-custom-end');
    if (sInput) sInput.value = selStart ? isoDay(selStart) : '';
    if (eInput) eInput.value = selEnd   ? isoDay(selEnd)   : '';
  }

  function updateRangeLabel() {
    const el = document.getElementById('bal-range-label');
    if (!el) return;
    if (selStart && selEnd) {
      el.textContent = formatDate(selStart) + ' – ' + formatDate(selEnd);
    } else if (selStart) {
      el.textContent = formatDate(selStart) + ' – …';
    } else {
      el.textContent = 'Select date range';
    }
  }

  function updateRangeStatus() {
    const status = document.getElementById('bal-cal-status');
    const apply  = document.getElementById('bal-cal-apply');
    if (!status || !apply) return;
    if (!selStart) {
      status.textContent = 'Pick a start date';
      apply.disabled = true;
    } else if (!selEnd) {
      status.textContent = 'Pick an end date';
      apply.disabled = true;
    } else {
      const days = Math.round((selEnd - selStart) / 86400000) + 1;
      status.textContent = days + ' day' + (days === 1 ? '' : 's') + ' selected';
      apply.disabled = false;
    }
  }

  function renderCalendar(keepFocus) {
    const grid = document.getElementById('bal-cal-grid');
    const title = document.getElementById('bal-cal-title');
    if (!grid || !title) return;
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    title.textContent = months[calCursor.getMonth()] + ' ' + calCursor.getFullYear();

    const firstDow = new Date(calCursor.getFullYear(), calCursor.getMonth(), 1).getDay();
    const daysInMonth = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 0).getDate();
    const prevMonthDays = new Date(calCursor.getFullYear(), calCursor.getMonth(), 0).getDate();
    const today = stripTime(new Date());

    let html = '';
    // Trailing days from previous month
    for (let i = firstDow - 1; i >= 0; i--) {
      html += '<button type="button" class="bal-cal-day muted" disabled>' + (prevMonthDays - i) + '</button>';
    }
    // Days of current month
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(calCursor.getFullYear(), calCursor.getMonth(), day);
      const classes = ['bal-cal-day'];
      if (sameDay(d, today)) classes.push('today');
      if (sameDay(d, selStart)) classes.push('start');
      if (sameDay(d, selEnd))   classes.push('end');
      if (selStart && selEnd && d > selStart && d < selEnd) classes.push('in-range');
      if (selStart && !selEnd && hoverDate) {
        const lo = hoverDate < selStart ? hoverDate : selStart;
        const hi = hoverDate < selStart ? selStart : hoverDate;
        if (d > lo && d < hi) classes.push('in-range');
        if (sameDay(d, hoverDate) && !sameDay(d, selStart)) classes.push('end', 'hover');
      }
      html += '<button type="button" class="' + classes.join(' ') + '"'
            +   ' onclick="Balance.selectDate(' + d.getFullYear() + ',' + d.getMonth() + ',' + d.getDate() + ')"'
            +   ' onmouseenter="Balance.onHoverDate(' + d.getFullYear() + ',' + d.getMonth() + ',' + d.getDate() + ')">'
            +   day
            + '</button>';
    }
    // Leading days from next month to fill 42 cells (6 rows)
    const rendered = firstDow + daysInMonth;
    const tail = (rendered % 7 === 0) ? 0 : (7 - (rendered % 7));
    for (let i = 1; i <= tail; i++) {
      html += '<button type="button" class="bal-cal-day muted" disabled>' + i + '</button>';
    }

    grid.innerHTML = html;
    if (!keepFocus) updateRangeStatus();
  }

  function getDateRange() {
    const startInput = document.getElementById('balance-custom-start')?.value;
    const endInput   = document.getElementById('balance-custom-end')?.value;
    if (!startInput || !endInput) {
      alert('Please pick a date range');
      return null;
    }
    const sp = startInput.split('-');
    const ep = endInput.split('-');
    const start = new Date(+sp[0], +sp[1] - 1, +sp[2], 0, 0, 0, 0);
    const end   = new Date(+ep[0], +ep[1] - 1, +ep[2], 23, 59, 59, 999);
    return { start, end, label: formatDate(start) + ' - ' + formatDate(end) };
  }

  function filterJobs(jobs, dateRange, status, sourceFilter = null) {
    // Get current user to check for dispatcher lead source filtering
    const currentUser = Auth.getUser();
    const assignedLeadSource = currentUser?.assignedLeadSource;

    console.log('[Balance] filterJobs - Date range:', dateRange.start, 'to', dateRange.end);
    console.log('[Balance] filterJobs - Status filter:', status);
    console.log('[Balance] filterJobs - Total jobs to filter:', jobs.length);

    return jobs.filter(job => {
      // Dispatcher filter: only show jobs from their assigned lead source
      if (assignedLeadSource && job.source !== assignedLeadSource) {
        return false;
      }

      // Admin filter: optional lead source selection
      if (sourceFilter && job.source !== sourceFilter) {
        return false;
      }

      // Filter by date (use paidAt for paid jobs, scheduledDate for closed jobs)
      let jobDate;
      if (job.paidAt) {
        jobDate = new Date(job.paidAt);
      } else if (job.scheduledDate) {
        // Parse date string YYYY-MM-DD and set to noon to avoid timezone issues
        const parts = job.scheduledDate.split('-');
        jobDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
      } else {
        jobDate = new Date(job.updatedAt);
      }

      // Set range dates to noon for fair comparison
      const rangeStart = new Date(dateRange.start);
      rangeStart.setHours(0, 0, 0, 0);
      const rangeEnd = new Date(dateRange.end);
      rangeEnd.setHours(23, 59, 59, 999);

      if (jobDate < rangeStart || jobDate > rangeEnd) {
        return false;
      }

      // Filter by payment status
      //   'paid'   → paid_at not null (money was collected)
      //   'unpaid' → closed completed job that hasn't been paid yet
      //   'all'    → every job in the date range, including lost/scheduled
      //              (so the report doesn't silently hide activity)
      if (status === 'paid') {
        if (!job.paidAt) return false;
      } else if (status === 'unpaid') {
        if (job.paidAt) return false;
        if (job.status !== 'closed') return false;
      }
      // status === 'all' → no extra status filter; show everything

      return true;
    });
  }

  // generateOverallReport() ("Balance by Company") removed — operator only
  // wants Balance by Tech; subcontracting companies send their own reports.
  // renderJobsList()'s 'company' mode param is now unused but left in place,
  // it's harmless dead code and not worth the extra risk to strip mid-function.
  function round2(n) { return Math.round(n * 100) / 100; }

  // Collapsible per-job list. Each row shows customer, date, total. For 'tech'
  // mode also shows the tech's cut; for 'company' mode shows only sales + parts.
  function renderJobsList(jobs, title, mode = 'tech') {
    if (!jobs || jobs.length === 0) return '';
    const settings = (typeof DB !== 'undefined' && DB.getSettings) ? DB.getSettings() : {};
    // Sort newest first
    const sorted = [...jobs].sort((a, b) => {
      const da = new Date(a.paidAt || a.scheduledDate || a.createdAt || 0).getTime();
      const dbb = new Date(b.paidAt || b.scheduledDate || b.createdAt || 0).getTime();
      return dbb - da;
    });
    const id = 'jobs-list-' + Math.random().toString(36).slice(2, 7);
    return `
      <div class="report-jobs-list" id="${id}">
        <h3 style="cursor:pointer;display:flex;align-items:center;justify-content:space-between" onclick="document.getElementById('${id}-body').classList.toggle('hidden');this.querySelector('.chev').textContent=document.getElementById('${id}-body').classList.contains('hidden')?'›':'⌄'">
          ${title} <span style="font-size:13px;color:var(--color-text-muted);font-weight:400">${sorted.length} jobs <span class="chev">⌄</span></span>
        </h3>
        <div id="${id}-body" style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          ${sorted.map(j => {
            const calc = (typeof PayoutEngine !== 'undefined') ? PayoutEngine.calculate({
              jobTotal:      j.jobTotal      || 0,
              partsCost:     j.partsCost     || 0,
              techPercent:   j.techPercent   || 0,
              contractorPct: j.contractorPct || 0,
              taxOption:     j.taxOption     || 'none',
              isSelfAssigned: j.isSelfAssigned || false,
              taxRateNY:     settings.taxRateNY || 8.875,
              taxRateNJ:     settings.taxRateNJ || 6.625,
            }) : null;
            const total = parseFloat(j.jobTotal) || 0;
            const parts = parseFloat(j.partsCost) || 0;
            const techCut = calc ? calc.techPayout : 0;
            const dateStr = (j.paidAt || j.scheduledDate || j.createdAt || '').slice(0, 10);
            const statusColor = j.status === 'paid' ? '#22c55e' : j.status === 'lost' ? '#ef4444' : j.status === 'follow_up' ? '#f59e0b' : '#6366f1';
            return `
              <div class="report-job-row" onclick="if(typeof App!=='undefined'&&App.openJobDetail)App.openJobDetail('${j.jobId}')" style="background:var(--color-surface-raised);border-radius:10px;padding:10px 12px;cursor:pointer;border-left:3px solid ${statusColor}">
                <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;gap:8px">
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(j.customerName || 'Unknown')}</span>
                  <span style="white-space:nowrap">$${formatMoney(total)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--color-text-muted);margin-top:4px;gap:8px">
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${dateStr} · ${escapeHtml(j.assignedTechName || '—')} · ${escapeHtml(j.source || '—')}</span>
                  <span style="white-space:nowrap">parts $${formatMoney(parts)}${mode === 'tech' ? ` · tech $${formatMoney(techCut)}` : ''}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function generateTechReport(jobs, period, status, techId, dateRange) {
    let techJobs = jobs;
    let techName = 'All Techs';

    if (techId) {
      console.log('[Balance] Filtering for techId:', techId);
      console.log('[Balance] Total jobs before tech filter:', jobs.length);
      jobs.forEach(j => {
        console.log('[Balance] Job:', j.jobId, 'Tech:', j.assignedTechName, 'TechID:', j.assignedTechId, 'Date:', j.scheduledDate, 'Status:', j.status);
      });

      techJobs = jobs.filter(j => j.assignedTechId === techId);
      console.log('[Balance] Jobs after tech filter:', techJobs.length);
      techJobs.forEach(j => {
        console.log('[Balance] INCLUDED Job:', j.jobId, j.customerName, 'Date:', j.scheduledDate, 'Status:', j.status);
      });

      const settings = DB.getSettings();
      const tech = settings.technicians?.find(t => t.id === techId);
      techName = tech ? tech.name : 'Unknown Tech';
    }

    const stats = calculateStats(techJobs);
    const periodLabel = dateRange.label;
    const statusLabel = status === 'all' ? 'All Jobs' : status === 'paid' ? 'Paid Only' : 'Unpaid Only';

    // Show lead source for dispatchers or admin-selected filter
    const currentUser = Auth.getUser();
    const assignedLeadSource = currentUser?.assignedLeadSource;
    const sourceFilter = currentReportData?.sourceFilter;
    const displaySource = assignedLeadSource || sourceFilter;

    // Calculate company cut (what tech owes company)
    const companyCut = stats.laborTotal - stats.techPayout;

    let html = `
      <div class="report-header">
        <h2>Balance by Tech</h2>
        <div class="report-meta">
          ${displaySource ? `
            <div class="report-meta-item">
              <span class="report-meta-label">Company:</span>
              <span class="report-meta-value">${displaySource}</span>
            </div>
          ` : ''}
          <div class="report-meta-item">
            <span class="report-meta-label">Tech:</span>
            <span class="report-meta-value">${techName}</span>
          </div>
          <div class="report-meta-item">
            <span class="report-meta-label">Period:</span>
            <span class="report-meta-value">${periodLabel}</span>
          </div>
          <div class="report-meta-item">
            <span class="report-meta-label">Status:</span>
            <span class="report-meta-value">${statusLabel}</span>
          </div>
        </div>
      </div>

      <div class="report-summary">
        <div class="summary-card">
          <div class="summary-label">Total Jobs</div>
          <div class="summary-value">${stats.totalJobs}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px">${stats.closedJobs} closed</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Total Sales</div>
          <div class="summary-value">$${formatMoney(stats.totalCollected)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Total Parts</div>
          <div class="summary-value">$${formatMoney(stats.partsCost)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Labor (Total - Parts)</div>
          <div class="summary-value">$${formatMoney(stats.laborTotal)}</div>
        </div>
      </div>

      <div class="report-breakdown">
        <h3>Financial Breakdown</h3>
        <div class="breakdown-row">
          <span class="breakdown-label">Tech Cut (from Labor)</span>
          <span class="breakdown-value">$${formatMoney(stats.techPayout)}</span>
        </div>
        <div class="breakdown-row total">
          <span class="breakdown-label" style="font-weight:bold;color:#d32f2f">YOU OWE (COMPANY CUT)</span>
          <span class="breakdown-value positive">$${formatMoney(companyCut)}</span>
        </div>
      </div>

      ${!techId ? `
        <div class="report-tech-breakdown">
          <h3>By Individual Tech</h3>
          ${generateTechBreakdown(jobs)}
        </div>
      ` : ''}

      <div class="report-alert" style="margin-top:20px;background:#e3f2fd;border:1px solid #2196f3">
        <div class="alert-content">
          <div class="alert-title" style="color:#1976d2;font-weight:bold">💳 ZELLE PAYMENT</div>
          <div class="alert-text" style="font-size:16px;font-weight:bold">SERVICE@ONPOINTPRODOORS.COM</div>
          <div class="alert-text" style="font-size:14px;margin-top:8px;color:#555">Please send a screenshot of your Zelle transfer for our records. Thank you!</div>
        </div>
      </div>

      ${renderJobsList(techJobs, techId ? `${techName}'s jobs in this report` : 'Jobs in this report')}
    `;

    return html;
  }

  function generateTechBreakdown(jobs) {
    const techStats = {};

    jobs.forEach(job => {
      if (!job.assignedTechId) return;

      if (!techStats[job.assignedTechId]) {
        techStats[job.assignedTechId] = {
          name: job.assignedTechName || 'Unknown',
          jobs: 0,
          revenue: 0,
          payout: 0
        };
      }

      // Recompute via PayoutEngine, do not trust stored tech_payout
      const _settings = (typeof DB !== 'undefined' && DB.getSettings) ? DB.getSettings() : {};
      const _calc = (typeof PayoutEngine !== 'undefined') ? PayoutEngine.calculate({
        jobTotal:      job.jobTotal      || 0,
        partsCost:     job.partsCost     || 0,
        techPercent:   job.techPercent   || 0,
        contractorPct: job.contractorPct || 0,
        taxOption:     job.taxOption     || 'none',
        isSelfAssigned: job.isSelfAssigned || false,
        taxRateNY:     _settings.taxRateNY || 8.875,
        taxRateNJ:     _settings.taxRateNJ || 6.625,
      }) : null;
      techStats[job.assignedTechId].jobs++;
      techStats[job.assignedTechId].revenue += job.jobTotal || 0;
      techStats[job.assignedTechId].payout += _calc ? _calc.techPayout : (job.techPayout || 0);
    });

    return Object.entries(techStats)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([id, stats]) => `
        <div class="tech-item">
          <div class="tech-name">${stats.name}</div>
          <div class="tech-stats">
            <span>${stats.jobs} jobs</span>
            <span>Revenue: $${formatMoney(stats.revenue)}</span>
            <span>Payout: $${formatMoney(stats.payout)}</span>
          </div>
        </div>
      `).join('');
  }

  function calculateStats(jobs) {
    const stats = {
      totalJobs: jobs.length,
      totalCollected: 0,
      partsCost: 0,
      laborTotal: 0,
      techPayout: 0,
      contractorFee: 0,
      ownerPayout: 0,
      unpaidJobs: 0,
      unpaidAmount: 0,
      closedJobs: 0,    // jobs that actually got done (status paid OR closed)
      paymentMethods: {}
    };

    const settings = (typeof DB !== 'undefined' && DB.getSettings) ? DB.getSettings() : {};
    jobs.forEach(job => {
      // Always recompute splits from raw inputs via PayoutEngine — never trust stored
      // techPayout / contractorFee / ownerPayout fields. They may have been written by
      // an earlier version of the formula and are kept only for legacy/audit purposes.
      const calc = (typeof PayoutEngine !== 'undefined') ? PayoutEngine.calculate({
        jobTotal:      job.jobTotal      || 0,
        partsCost:     job.partsCost     || 0,
        techPercent:   job.techPercent   || 0,
        contractorPct: job.contractorPct || 0,
        taxOption:     job.taxOption     || 'none',
        isSelfAssigned: job.isSelfAssigned || false,
        taxRateNY:     settings.taxRateNY || 8.875,
        taxRateNJ:     settings.taxRateNJ || 6.625,
      }) : null;

      const jobTotal      = job.jobTotal || 0;
      const parts         = job.partsCost || 0;
      const techPay       = calc ? calc.techPayout      : (job.techPayout      || 0);
      const contractorPay = calc ? calc.contractorFee   : (job.contractorFee   || 0);
      const ownerPay      = calc ? calc.ownerPayout     : (job.ownerPayout     || 0);
      const laborNet      = calc ? calc.netAfterParts   : (jobTotal - parts);

      stats.totalCollected += jobTotal;
      stats.partsCost += parts;
      stats.laborTotal += laborNet;
      stats.techPayout += techPay;
      stats.contractorFee += contractorPay;
      stats.ownerPayout += ownerPay;

      // Track unpaid jobs
      if (!job.paidAt && job.status === 'closed') {
        stats.unpaidJobs++;
        stats.unpaidAmount += jobTotal;
      }

      // Count closed (=completed) jobs: paid OR closed-but-unpaid.
      // Excludes lost / scheduled / follow_up so the user sees how many
      // jobs actually got done in the period.
      if (job.status === 'paid' || job.status === 'closed') {
        stats.closedJobs++;
      }

      // Track payment methods (only for paid jobs)
      if (job.paidAt) {
        const method = job.paymentMethod || 'cash';
        stats.paymentMethods[method] = (stats.paymentMethods[method] || 0) + jobTotal;
      }
    });

    return stats;
  }

  function formatMoney(amount) {
    return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatDate(date) {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  }

  function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function generatePlainText() {
    if (!currentReportData) return '';

    const { type, period, status, sourceFilter, jobs, dateRange } = currentReportData;
    const stats = calculateStats(jobs);
    const periodLabel = dateRange.label;

    // Get current user for lead source
    const currentUser = Auth.getUser();
    const assignedLeadSource = currentUser?.assignedLeadSource;
    const displaySource = assignedLeadSource || sourceFilter;

    let text = '';

    if (type === 'overall') {
      // Balance by Company — what we paste into WhatsApp to send the partner.
      // Summary: Sales → Parts → After Parts → Source Cut (X%).
      // Per-job: only Sales + Parts (no money calculations per job).
      const _companyCut  = round2(stats.contractorFee || 0);
      const _companyLabel = displaySource ? displaySource : 'All Companies';
      const _afterParts  = round2(stats.totalCollected - stats.partsCost);
      const _contrPcts   = [...new Set(jobs.map(j => parseFloat(j.contractorPct) || 0))];
      const _singleCtrPct = _contrPcts.length === 1 ? _contrPcts[0] : null;
      const _cutPct      = _singleCtrPct !== null ? ` (${_singleCtrPct}%)` : '';

      text = `BALANCE BY COMPANY\n`;
      text += `========================\n`;
      text += `Company: ${_companyLabel}\n`;
      text += `Period: ${periodLabel}\n`;
      text += `Date: ${formatDate(dateRange.start)} - ${formatDate(dateRange.end)}\n`;
      text += `Status: ${status === 'all' ? 'All Jobs' : status === 'paid' ? 'Paid Only' : 'Unpaid Only'}\n\n`;

      text += `SUMMARY\n`;
      text += `Total Jobs:     ${stats.totalJobs}\n`;
      text += `Closed Jobs:    ${stats.closedJobs}\n`;
      text += `Total Sales:    $${formatMoney(stats.totalCollected)}\n`;
      text += `Total Parts:    $${formatMoney(stats.partsCost)}\n`;
      text += `Total - Parts:  $${formatMoney(_afterParts)}\n`;
      text += `${_companyLabel} Cut${_cutPct}: $${formatMoney(_companyCut)}\n\n`;

      if (stats.unpaidJobs > 0) {
        text += `OUTSTANDING\n`;
        text += `${stats.unpaidJobs} job(s) unpaid - $${formatMoney(stats.unpaidAmount)}\n\n`;
      }

      // Per-job breakdown — Sales + Parts ONLY (partner doesn't need per-job math).
      if (jobs && jobs.length > 0) {
        const sorted = [...jobs].sort((a, b) => {
          const da = new Date(a.paidAt || a.scheduledDate || a.createdAt || 0).getTime();
          const dbb = new Date(b.paidAt || b.scheduledDate || b.createdAt || 0).getTime();
          return dbb - da;
        });
        text += `JOBS (${sorted.length})\n`;
        text += `========================\n`;
        sorted.forEach((j, i) => {
          const total = parseFloat(j.jobTotal) || 0;
          const parts = parseFloat(j.partsCost) || 0;
          const dateStr = (j.paidAt || j.scheduledDate || j.createdAt || '').slice(0, 10);
          const paidMark = j.paidAt ? '[PAID]' : '[OPEN]';
          text += `\n${i+1}. ${paidMark} ${j.customerName || 'Unknown'}`;
          text += ` (${dateStr})`;
          if (j.assignedTechName) text += ` - ${j.assignedTechName}`;
          text += `\n   Sales: $${formatMoney(total)} | Parts: $${formatMoney(parts)}\n`;
        });
      }

    } else {
      const techId = currentReportData.techId;
      const settings = DB.getSettings();
      const tech = techId ? settings.technicians?.find(t => t.id === techId) : null;
      const techName = tech ? tech.name : (techId ? 'Unknown Tech' : 'All Techs');
      const companyCut = stats.laborTotal - stats.techPayout;

      text = `TECH BALANCE REPORT\n`;
      text += `========================\n`;
      if (displaySource) {
        text += `Company: ${displaySource}\n`;
      }
      text += `Tech: ${techName}\n`;
      text += `Period: ${periodLabel}\n`;
      text += `Date: ${formatDate(dateRange.start)} - ${formatDate(dateRange.end)}\n\n`;

      text += `SUMMARY\n`;
      text += `Total Jobs:  ${stats.totalJobs}\n`;
      text += `Closed Jobs: ${stats.closedJobs}\n`;
      text += `Total Sales: $${formatMoney(stats.totalCollected)}\n`;
      text += `Total Parts: $${formatMoney(stats.partsCost)}\n`;
      text += `Labor (Total - Parts): $${formatMoney(stats.laborTotal)}\n\n`;

      text += `BREAKDOWN\n`;
      text += `Tech Cut: $${formatMoney(stats.techPayout)}\n`;
      text += `*YOU OWE* (COMPANY CUT): $${formatMoney(companyCut)}\n\n`;
      text += `*ZELLE:* SERVICE@ONPOINTPRODOORS.COM\n`;
      text += `Please send a screenshot of your Zelle transfer for our records. Thank you!\n`;
    }

    text += `\n========================\n`;
    text += `Generated: ${new Date().toLocaleString()}\n`;
    text += `On Point Pro Doors CRM`;

    return text;
  }

  async function copyToClipboard() {
    try {
      const text = generatePlainText();
      await navigator.clipboard.writeText(text);

      // Show feedback
      const btn = event.target;
      const originalText = btn.innerHTML;
      btn.innerHTML = '✓ Copied!';
      btn.style.background = '#10b981';

      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = '';
      }, 2000);

    } catch (err) {
      console.error('[Balance] Copy failed:', err);
      alert('Failed to copy to clipboard');
    }
  }

  function shareWhatsApp() {
    const text = generatePlainText();
    const encoded = encodeURIComponent(text);
    const url = `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank');
  }

  // ─────────────────────────────────────────────────────────────
  // PDF export — branded, per-job table, totals footer.
  // Uses jsPDF + autoTable loaded via CDN in index.html.
  // ─────────────────────────────────────────────────────────────
  function downloadPDF() {
    if (!currentReportData) {
      alert('Generate a report first.');
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('PDF library still loading — try again in a second.');
      return;
    }
    try {
      const { type, status, sourceFilter, jobs, dateRange, techId } = currentReportData;
      const stats = calculateStats(jobs);
      const settings = (typeof DB !== 'undefined' && DB.getSettings) ? DB.getSettings() : {};
      const currentUser = Auth.getUser();
      const displaySource = currentUser?.assignedLeadSource || sourceFilter;

      const totalSales = stats.totalCollected;
      const techPay    = stats.techPayout;
      const partsTotal = stats.partsCost;
      // Balance by Company → only what we owe the contractor (Sonart, etc.).
      // Balance by Tech    → contractor + owner (the whole "company side" the tech owes back).
      const companyCut = (type === 'overall')
        ? round2(stats.contractorFee || 0)
        : round2((stats.contractorFee || 0) + (stats.ownerPayout || 0));

      // Detect whether every job in the report uses the same split. If so we can
      // print the agreed split (e.g. "Sonart 50% / Tech 50%") in the header and
      // in the column heading instead of cluttering every row with percentages.
      const techPcts  = [...new Set(jobs.map(j => parseFloat(j.techPercent)   || 0))];
      const contrPcts = [...new Set(jobs.map(j => parseFloat(j.contractorPct) || 0))];
      const singleTechPct  = techPcts.length  === 1 ? techPcts[0]  : null;
      const singleContrPct = contrPcts.length === 1 ? contrPcts[0] : null;

      const { jsPDF } = window.jspdf;
      const doc  = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();

      // ── Clean navy header bar (single accent color, not a rainbow)
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, 64, 'F');
      try {
        const logoEl = document.querySelector('img[src*="logo"]');
        if (logoEl && logoEl.complete && logoEl.naturalWidth > 0) {
          doc.addImage(logoEl, 'JPEG', 28, 12, 40, 40, undefined, 'FAST');
        }
      } catch (_) { /* logo optional */ }
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text('On Point Pro Doors', 80, 28);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('service@onpointprodoors.com  |  (929) 429-2429', 80, 44);
      doc.setFontSize(7);
      doc.text(`Generated: ${new Date().toLocaleString()}`, pageW - 28, 28, { align: 'right' });

      // ── Title
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      const reportTitle = type === 'overall' ? 'Balance by Company' : 'Balance by Tech';
      doc.text(reportTitle, 28, 96);

      // ── Meta block
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      let y = 116;
      const metaLines = [];
      const companyName = displaySource || (type === 'overall' ? 'All Companies' : null);
      if (companyName) metaLines.push(`Company: ${companyName}`);
      if (type === 'tech' && techId) {
        const tech = settings.technicians?.find(t => t.id === techId);
        if (tech) metaLines.push(`Tech: ${tech.name}`);
      }
      metaLines.push(`Period: ${dateRange.label}  (${formatDate(dateRange.start)} to ${formatDate(dateRange.end)})`);
      metaLines.push(`Status: ${status === 'all' ? 'All Jobs' : status === 'paid' ? 'Paid Only' : 'Unpaid Only'}`);
      metaLines.push(`Total Jobs: ${stats.totalJobs}    Closed Jobs: ${stats.closedJobs}`);
      if (type === 'overall' && singleContrPct !== null && singleTechPct !== null) {
        metaLines.push(`Split: ${companyName} ${singleContrPct}%  /  Tech ${singleTechPct}%`);
      } else if (type === 'tech' && singleTechPct !== null) {
        const compSidePct = 100 - singleTechPct;
        metaLines.push(`Split: Tech ${singleTechPct}%  /  Company ${compSidePct}%`);
      }
      metaLines.forEach(line => { doc.text(line, 28, y); y += 14; });
      y += 6;

      // ── Monochrome summary cards (white background, gray border, dark text)
      //    The final "cut" card gets a dark left bar so it still stands out
      //    without coloring the whole report.
      const sumCardW = (pageW - 56 - 30) / 4;   // 30 = 3 gaps of 10
      const sumCardH = 56;
      const afterParts = round2(totalSales - partsTotal);
      const cutLabel = (singleContrPct !== null)
        ? `${(companyName || 'COMPANY').toUpperCase()} CUT (${singleContrPct}%)`
        : `${(companyName || 'COMPANY').toUpperCase()} CUT`;
      const summaryCards = type === 'overall' ? [
        { label: 'TOTAL SALES',  value: '$' + formatMoney(totalSales) },
        { label: 'TOTAL PARTS',  value: '$' + formatMoney(partsTotal) },
        { label: 'TOTAL - PARTS', value: '$' + formatMoney(afterParts) },
        { label: cutLabel,       value: '$' + formatMoney(companyCut), accent: true },
      ] : [
        { label: 'TOTAL SALES', value: '$' + formatMoney(totalSales) },
        { label: 'PARTS',       value: '$' + formatMoney(partsTotal) },
        { label: 'TECH CUT',    value: '$' + formatMoney(techPay)    },
        { label: 'YOU OWE (COMPANY CUT)',
          value: '$' + formatMoney(companyCut), accent: true },
      ];
      summaryCards.forEach((c, i) => {
        const x = 28 + i * (sumCardW + 10);
        doc.setDrawColor(200, 200, 200);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x, y, sumCardW, sumCardH, 4, 4, 'FD');
        if (c.accent) {
          doc.setFillColor(15, 23, 42);
          doc.rect(x, y, 3, sumCardH, 'F');
        }
        doc.setTextColor(120, 120, 120);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        const lbl = c.label.length > 30 ? c.label.slice(0, 28) + '…' : c.label;
        doc.text(lbl, x + 10, y + 16);
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(15);
        doc.text(c.value, x + 10, y + 40);
      });
      y += sumCardH + 18;

      // ── Per-job table — different layout per report type
      const sorted = [...jobs].sort((a, b) => {
        const da = new Date(a.paidAt || a.scheduledDate || a.createdAt || 0).getTime();
        const dbb = new Date(b.paidAt || b.scheduledDate || b.createdAt || 0).getTime();
        return dbb - da;
      });

      if (type === 'overall') {
        // BALANCE BY COMPANY — per-job rows show ONLY Sales + Parts.
        // The partner's cut is summarized at the top, not recomputed per row.
        const rows = sorted.map(j => {
          const total    = parseFloat(j.jobTotal) || 0;
          const partsAmt = parseFloat(j.partsCost) || 0;
          const dateStr  = (j.paidAt || j.scheduledDate || j.createdAt || '').slice(0, 10);
          return [
            dateStr,
            (j.customerName || '-').substring(0, 32),
            (j.assignedTechName || '-').substring(0, 20),
            '$' + formatMoney(total),
            '$' + formatMoney(partsAmt),
            j.paidAt ? 'PAID' : 'OPEN'
          ];
        });
        doc.autoTable({
          startY: y,
          head: [['Date', 'Customer', 'Tech', 'Sale', 'Parts', 'Status']],
          body: rows,
          styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak', textColor: [30, 30, 30] },
          headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, halign: 'left' },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 28, right: 28 },
          columnStyles: {
            3: { halign: 'right' },
            4: { halign: 'right' },
            5: { halign: 'center' }
          },
          foot: [[
            'TOTALS', '', '',
            '$' + formatMoney(totalSales),
            '$' + formatMoney(partsTotal),
            ''
          ]],
          footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 10, halign: 'right' }
        });
      } else {
        // BALANCE BY TECH — keep tech-vs-company columns, but Co% is the
        // clean split (100 - tech%), NOT the post-parts effective rate.
        const rows = sorted.map(j => {
          const calc = (typeof PayoutEngine !== 'undefined') ? PayoutEngine.calculate({
            jobTotal:      j.jobTotal      || 0,
            partsCost:     j.partsCost     || 0,
            techPercent:   j.techPercent   || 0,
            contractorPct: j.contractorPct || 0,
            taxOption:     j.taxOption     || 'none',
            isSelfAssigned: j.isSelfAssigned || false,
            taxRateNY:     settings.taxRateNY || 8.875,
            taxRateNJ:     settings.taxRateNJ || 6.625,
          }) : null;
          const total    = parseFloat(j.jobTotal) || 0;
          const partsAmt = parseFloat(j.partsCost) || 0;
          const techPctVal = parseFloat(j.techPercent) || 0;
          const techCut  = calc ? calc.techPayout : 0;
          const compCut  = calc
            ? round2((calc.contractorFee || 0) + (calc.ownerPayout || 0))
            : (total - techCut - partsAmt);
          // Clean complement of the tech's agreed share — Tech 40% → Company 60%.
          const compPct  = (100 - techPctVal).toFixed(0) + '%';
          const dateStr  = (j.paidAt || j.scheduledDate || j.createdAt || '').slice(0, 10);
          return [
            dateStr,
            (j.customerName || '-').substring(0, 24),
            (j.assignedTechName || '-').substring(0, 16),
            '$' + formatMoney(total),
            '$' + formatMoney(partsAmt),
            techPctVal + '%',
            '$' + formatMoney(techCut),
            compPct,
            '$' + formatMoney(compCut),
            j.paidAt ? 'PAID' : 'OPEN'
          ];
        });
        doc.autoTable({
          startY: y,
          head: [['Date', 'Customer', 'Tech', 'Sale', 'Parts', 'Tech %', 'Tech $', 'Co %', 'Co $', 'Status']],
          body: rows,
          styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak', textColor: [30, 30, 30] },
          headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, halign: 'center' },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 28, right: 28 },
          columnStyles: {
            3: { halign: 'right' },
            4: { halign: 'right' },
            5: { halign: 'center' },
            6: { halign: 'right' },
            7: { halign: 'center' },
            8: { halign: 'right', fontStyle: 'bold' },
            9: { halign: 'center' }
          },
          foot: [[
            '', 'TOTALS', '',
            '$' + formatMoney(totalSales),
            '$' + formatMoney(partsTotal),
            '',
            '$' + formatMoney(techPay),
            '',
            '$' + formatMoney(companyCut),
            ''
          ]],
          footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8, halign: 'right' }
        });
      }

      // ── Page numbers
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(`Page ${i} / ${pageCount}`, pageW - 28, pageH - 16, { align: 'right' });
        doc.text('On Point Pro Doors CRM', 28, pageH - 16);
      }

      const slug = (dateRange.label || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const fname = `balance-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(fname);
    } catch (err) {
      console.error('[Balance] PDF export failed:', err);
      alert('PDF export failed: ' + (err.message || err));
    }
  }

  return {
    init,
    showMenu,
    showReportOptions,
    generateReport,
    copyToClipboard,
    shareWhatsApp,
    downloadPDF,
    populateLeadSourceSelector,  // Export so app.js can refresh after settings sync
    // Range picker (custom-only mode)
    toggleRangePicker,
    calNav,
    selectDate,
    onHoverDate,
    clearRange,
    applyRange
  };
})();

// Make Balance accessible globally
window.Balance = Balance;

// Do NOT auto-initialize — app.js will call Balance.init() after auth is ready
