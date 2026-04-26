/**
 * BALANCE MODULE
 * Financial reporting: Overall & By-Tech balance reports
 * Admin-only feature
 */

const Balance = (function() {
  let currentReportType = null;
  let currentReportData = null;

  function init() {
    console.log('[Balance] Module initialized');

    // Populate tech selector
    populateTechSelector();

    // Populate lead source selector (admin only)
    populateLeadSourceSelector();
  }

  async function populateTechSelector() {
    try {
      const users = await Auth.listUsers();
      const techs = users.filter(u => u.role === 'tech' || u.role === 'contractor');

      const select = document.getElementById('balance-tech-select');
      if (!select) return;

      select.innerHTML = '<option value="">All Techs</option>';
      techs.forEach(tech => {
        const option = document.createElement('option');
        option.value = tech.id;
        option.textContent = tech.name;
        select.appendChild(option);
      });
    } catch (err) {
      console.error('[Balance] Failed to load techs:', err);
    }
  }

  function populateLeadSourceSelector() {
    try {
      const filterDiv = document.getElementById('balance-source-filter');
      const select = document.getElementById('balance-source-select');
      if (!filterDiv || !select) return;

      const user = Auth.getUser();
      const settings = DB.getSettings();
      const allLeadSources = settings.leadSources || [];

      console.log('[Balance] ═══ Lead Source Selector Debug ═══');
      console.log('[Balance] User:', user?.name, 'Role:', user?.role);
      console.log('[Balance] All lead sources:', JSON.stringify(allLeadSources));
      console.log('[Balance] Total sources count:', allLeadSources.length);

      // Determine which sources this user can access
      let allowedSources = [];

      if (Auth.isAdmin()) {
        // Admin can see all sources
        allowedSources = allLeadSources;
        console.log('[Balance] Admin mode - showing all sources');
      } else {
        // Non-admin: check their allowed_lead_sources
        const userAllowedSources = user?.allowedLeadSources;
        console.log('[Balance] User allowed sources:', userAllowedSources);
        if (userAllowedSources && Array.isArray(userAllowedSources) && userAllowedSources.length > 0) {
          allowedSources = allLeadSources.filter(s => userAllowedSources.includes(s.name));
        }
      }

      console.log('[Balance] Allowed sources after filtering:', allowedSources.length, JSON.stringify(allowedSources));

      // Admins ALWAYS see the dropdown (even if only 1 source exists)
      if (Auth.isAdmin()) {
        filterDiv.style.display = 'block';
        select.dataset.lockedSource = ''; // Admins are never locked
      } else {
        // Non-admin logic: hide if no sources or lock if exactly 1 source
        if (allowedSources.length === 0) {
          filterDiv.style.display = 'none';
          console.log('[Balance] Hiding filter - no allowed sources');
          return;
        }

        if (allowedSources.length === 1) {
          filterDiv.style.display = 'none';
          // Store the locked source for report generation
          select.dataset.lockedSource = allowedSources[0].name;
          console.log('[Balance] User locked to single source:', allowedSources[0].name);
          return;
        }

        // User has multiple allowed sources - show dropdown
        filterDiv.style.display = 'block';
        select.dataset.lockedSource = '';
      }

      // Populate with allowed sources only
      if (Auth.isAdmin()) {
        select.innerHTML = '<option value="">All Sources</option>';
      } else {
        select.innerHTML = '<option value="">Select Source</option>';
      }

      allowedSources.forEach(source => {
        const option = document.createElement('option');
        option.value = source.name;
        option.textContent = source.name;
        select.appendChild(option);
        console.log('[Balance] Added source option:', source.name);
      });

      console.log('[Balance] ✓ Dropdown populated with', select.options.length, 'total options');
      console.log('[Balance] ═══════════════════════════════════');
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
    currentReportType = type;
    document.getElementById('balance-menu').classList.add('hidden');
    document.getElementById('balance-options').classList.remove('hidden');
    document.getElementById('balance-report').classList.add('hidden');

    const title = type === 'overall' ? 'Overall Balance Report' : 'Balance by Tech Report';
    document.getElementById('balance-options-title').textContent = title;

    // Show/hide tech selector
    const techSelector = document.getElementById('balance-tech-selector');
    if (type === 'tech') {
      techSelector.classList.remove('hidden');
    } else {
      techSelector.classList.add('hidden');
    }
  }

  async function generateReport() {
    try {
      const period = document.getElementById('balance-period').value;
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

      // Get date range
      const dateRange = getDateRange(period);

      // Fetch jobs
      const allJobs = DB.getJobs();
      let jobs = filterJobs(allJobs, dateRange, status, sourceFilter);

      // Generate report based on type
      let reportHTML = '';
      if (currentReportType === 'overall') {
        reportHTML = generateOverallReport(jobs, period, status, dateRange);
      } else {
        reportHTML = generateTechReport(jobs, period, status, techId, dateRange);
      }

      // Store report data for export
      currentReportData = {
        type: currentReportType,
        period,
        status,
        sourceFilter,
        techId,
        jobs,
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

  function getDateRange(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (period) {
      case 'daily':
        return {
          start: today,
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1),
          label: 'Today'
        };

      case 'weekly':
        const dayOfWeek = today.getDay();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - dayOfWeek);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);
        return {
          start: startOfWeek,
          end: endOfWeek,
          label: 'This Week'
        };

      case 'monthly':
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
        return {
          start: startOfMonth,
          end: endOfMonth,
          label: 'This Month'
        };

      default:
        return { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000), label: 'Today' };
    }
  }

  function filterJobs(jobs, dateRange, status, sourceFilter = null) {
    // Get current user to check for dispatcher lead source filtering
    const currentUser = Auth.getUser();
    const assignedLeadSource = currentUser?.assignedLeadSource;

    return jobs.filter(job => {
      // Dispatcher filter: only show jobs from their assigned lead source
      if (assignedLeadSource && job.source !== assignedLeadSource) {
        return false;
      }

      // Admin filter: optional lead source selection
      if (sourceFilter && job.source !== sourceFilter) {
        return false;
      }

      // Filter by date (use paidAt for paid jobs, or updatedAt for closed jobs)
      const jobDate = job.paidAt ? new Date(job.paidAt) : new Date(job.updatedAt);
      if (jobDate < dateRange.start || jobDate > dateRange.end) {
        return false;
      }

      // Filter by payment status
      if (status === 'paid' && !job.paidAt) return false;
      if (status === 'unpaid' && job.paidAt) return false;

      // Only include closed or paid jobs in reports
      if (job.status !== 'closed' && job.status !== 'paid') return false;

      return true;
    });
  }

  function generateOverallReport(jobs, period, status, dateRange) {
    const stats = calculateStats(jobs);
    const periodLabel = dateRange.label;
    const statusLabel = status === 'all' ? 'All Jobs' : status === 'paid' ? 'Paid Only' : 'Unpaid Only';

    // Show lead source for dispatchers or admin-selected filter
    const currentUser = Auth.getUser();
    const assignedLeadSource = currentUser?.assignedLeadSource;
    const sourceFilter = currentReportData?.sourceFilter;
    const displaySource = assignedLeadSource || sourceFilter;

    let html = `
      <div class="report-header">
        <h2>Overall Balance Report</h2>
        <div class="report-meta">
          ${displaySource ? `
            <div class="report-meta-item">
              <span class="report-meta-label">Lead Source:</span>
              <span class="report-meta-value">${displaySource}</span>
            </div>
          ` : ''}
          <div class="report-meta-item">
            <span class="report-meta-label">Period:</span>
            <span class="report-meta-value">${periodLabel}</span>
          </div>
          <div class="report-meta-item">
            <span class="report-meta-label">Status:</span>
            <span class="report-meta-value">${statusLabel}</span>
          </div>
          <div class="report-meta-item">
            <span class="report-meta-label">Date Range:</span>
            <span class="report-meta-value">${formatDate(dateRange.start)} - ${formatDate(dateRange.end)}</span>
          </div>
        </div>
      </div>

      <div class="report-summary">
        <div class="summary-card">
          <div class="summary-label">Jobs Completed</div>
          <div class="summary-value">${stats.totalJobs}</div>
        </div>
        <div class="summary-card ${stats.totalCollected > 0 ? 'positive' : ''}">
          <div class="summary-label">Total Collected</div>
          <div class="summary-value">$${formatMoney(stats.totalCollected)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Parts Total</div>
          <div class="summary-value">$${formatMoney(stats.partsCost)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Labor Total</div>
          <div class="summary-value">$${formatMoney(stats.laborTotal)}</div>
        </div>
      </div>

      <div class="report-breakdown">
        <h3>Financial Breakdown</h3>
        <div class="breakdown-row">
          <span class="breakdown-label">Tech Payouts</span>
          <span class="breakdown-value">$${formatMoney(stats.techPayout)}</span>
        </div>
        <div class="breakdown-row">
          <span class="breakdown-label">Contractor Fees</span>
          <span class="breakdown-value">$${formatMoney(stats.contractorFee)}</span>
        </div>
        <div class="breakdown-row total">
          <span class="breakdown-label">Net Amount (Company)</span>
          <span class="breakdown-value positive">$${formatMoney(stats.ownerPayout)}</span>
        </div>
      </div>

      ${stats.unpaidJobs > 0 ? `
        <div class="report-alert">
          <div class="alert-icon">⚠️</div>
          <div class="alert-content">
            <div class="alert-title">Outstanding Balances</div>
            <div class="alert-text">${stats.unpaidJobs} job(s) completed but not yet paid - $${formatMoney(stats.unpaidAmount)}</div>
          </div>
        </div>
      ` : ''}

      <div class="report-payment-methods">
        <h3>Payment Methods</h3>
        ${Object.entries(stats.paymentMethods).map(([method, amount]) => `
          <div class="breakdown-row">
            <span class="breakdown-label">${capitalizeFirst(method)}</span>
            <span class="breakdown-value">$${formatMoney(amount)}</span>
          </div>
        `).join('')}
      </div>
    `;

    return html;
  }

  function generateTechReport(jobs, period, status, techId, dateRange) {
    let techJobs = jobs;
    let techName = 'All Techs';

    if (techId) {
      techJobs = jobs.filter(j => j.assignedTechId === techId);
      const tech = Auth.getUserById(techId);
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

    // Calculate per-job averages
    const avgJobValue = stats.totalJobs > 0 ? stats.totalCollected / stats.totalJobs : 0;
    const avgPayout = stats.totalJobs > 0 ? stats.techPayout / stats.totalJobs : 0;

    let html = `
      <div class="report-header">
        <h2>Tech Balance Report</h2>
        <div class="report-meta">
          ${displaySource ? `
            <div class="report-meta-item">
              <span class="report-meta-label">Lead Source:</span>
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
          <div class="summary-label">Jobs Completed</div>
          <div class="summary-value">${stats.totalJobs}</div>
        </div>
        <div class="summary-card ${stats.totalCollected > 0 ? 'positive' : ''}">
          <div class="summary-label">Total Revenue</div>
          <div class="summary-value">$${formatMoney(stats.totalCollected)}</div>
        </div>
        <div class="summary-card ${stats.techPayout > 0 ? 'positive' : ''}">
          <div class="summary-label">Tech Payout</div>
          <div class="summary-value">$${formatMoney(stats.techPayout)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Avg per Job</div>
          <div class="summary-value">$${formatMoney(avgJobValue)}</div>
        </div>
      </div>

      <div class="report-breakdown">
        <h3>Performance Metrics</h3>
        <div class="breakdown-row">
          <span class="breakdown-label">Average Job Value</span>
          <span class="breakdown-value">$${formatMoney(avgJobValue)}</span>
        </div>
        <div class="breakdown-row">
          <span class="breakdown-label">Average Payout per Job</span>
          <span class="breakdown-value">$${formatMoney(avgPayout)}</span>
        </div>
        <div class="breakdown-row">
          <span class="breakdown-label">Parts Cost</span>
          <span class="breakdown-value">$${formatMoney(stats.partsCost)}</span>
        </div>
        <div class="breakdown-row total">
          <span class="breakdown-label">Total Tech Payout</span>
          <span class="breakdown-value positive">$${formatMoney(stats.techPayout)}</span>
        </div>
      </div>

      ${!techId ? `
        <div class="report-tech-breakdown">
          <h3>By Individual Tech</h3>
          ${generateTechBreakdown(jobs)}
        </div>
      ` : ''}
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

      techStats[job.assignedTechId].jobs++;
      techStats[job.assignedTechId].revenue += job.jobTotal || 0;
      techStats[job.assignedTechId].payout += job.techPayout || 0;
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
      paymentMethods: {}
    };

    jobs.forEach(job => {
      const jobTotal = job.jobTotal || 0;
      const parts = job.partsCost || 0;
      const techPay = job.techPayout || 0;
      const contractorPay = job.contractorFee || 0;
      const ownerPay = job.ownerPayout || 0;

      stats.totalCollected += jobTotal;
      stats.partsCost += parts;
      stats.laborTotal += (jobTotal - parts);
      stats.techPayout += techPay;
      stats.contractorFee += contractorPay;
      stats.ownerPayout += ownerPay;

      // Track unpaid jobs
      if (!job.paidAt && job.status === 'closed') {
        stats.unpaidJobs++;
        stats.unpaidAmount += jobTotal;
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
      text = `📊 OVERALL BALANCE REPORT\n`;
      text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      if (displaySource) {
        text += `Lead Source: ${displaySource}\n`;
      }
      text += `Period: ${periodLabel}\n`;
      text += `Date: ${formatDate(dateRange.start)} - ${formatDate(dateRange.end)}\n`;
      text += `Status: ${status === 'all' ? 'All Jobs' : status === 'paid' ? 'Paid Only' : 'Unpaid Only'}\n\n`;

      text += `📈 SUMMARY\n`;
      text += `Jobs Completed: ${stats.totalJobs}\n`;
      text += `Total Collected: $${formatMoney(stats.totalCollected)}\n`;
      text += `Parts Total: $${formatMoney(stats.partsCost)}\n`;
      text += `Labor Total: $${formatMoney(stats.laborTotal)}\n\n`;

      text += `💰 BREAKDOWN\n`;
      text += `Tech Payouts: $${formatMoney(stats.techPayout)}\n`;
      text += `Contractor Fees: $${formatMoney(stats.contractorFee)}\n`;
      text += `Net Amount (Company): $${formatMoney(stats.ownerPayout)}\n\n`;

      if (stats.unpaidJobs > 0) {
        text += `⚠️ OUTSTANDING\n`;
        text += `${stats.unpaidJobs} job(s) unpaid - $${formatMoney(stats.unpaidAmount)}\n\n`;
      }

      text += `💳 PAYMENT METHODS\n`;
      Object.entries(stats.paymentMethods).forEach(([method, amount]) => {
        text += `${capitalizeFirst(method)}: $${formatMoney(amount)}\n`;
      });

    } else {
      const techId = currentReportData.techId;
      const techName = techId ? (Auth.getUserById(techId)?.name || 'Unknown Tech') : 'All Techs';
      const avgJobValue = stats.totalJobs > 0 ? stats.totalCollected / stats.totalJobs : 0;

      text = `👤 TECH BALANCE REPORT\n`;
      text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      if (displaySource) {
        text += `Lead Source: ${displaySource}\n`;
      }
      text += `Tech: ${techName}\n`;
      text += `Period: ${periodLabel}\n`;
      text += `Date: ${formatDate(dateRange.start)} - ${formatDate(dateRange.end)}\n\n`;

      text += `📈 PERFORMANCE\n`;
      text += `Jobs Completed: ${stats.totalJobs}\n`;
      text += `Total Revenue: $${formatMoney(stats.totalCollected)}\n`;
      text += `Tech Payout: $${formatMoney(stats.techPayout)}\n`;
      text += `Avg per Job: $${formatMoney(avgJobValue)}\n`;
    }

    text += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
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

  return {
    init,
    showMenu,
    showReportOptions,
    generateReport,
    copyToClipboard,
    shareWhatsApp
  };
})();

// Do NOT auto-initialize — app.js will call Balance.init() after auth is ready
