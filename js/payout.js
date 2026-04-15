/* ============================================================
   PAYOUT.JS — Payout Calculation Engine
   Handles tax logic, parts deduction, contractor fee, tech/owner split
   CRITICAL: Tax ONLY applies when isSelfAssigned = true
   ============================================================ */

const PayoutEngine = (() => {

  /**
   * Calculate full payout breakdown for a job.
   *
   * @param {Object} params
   *   jobTotal        {number}  — total billed to customer
   *   partsCost       {number}  — parts/materials (deducted before split)
   *   techPercent     {number}  — tech payout percentage (0-100)
   *   contractorPct   {number}  — contractor fee percentage (0-100)
   *   isSelfAssigned  {boolean} — true = owner is the tech → apply tax
   *   state           {string}  — 'NY' or 'NJ' (determines tax rate)
   *   taxRateNY       {number}  — NY tax rate percent (from settings)
   *   taxRateNJ       {number}  — NJ tax rate percent (from settings)
   *
   * @returns {Object} breakdown with all computed values
   */
  function calculate({
    jobTotal      = 0,
    partsCost     = 0,
    techPercent   = 0,
    contractorPct = 0,
    isSelfAssigned = false,
    state         = 'NY',
    taxRateNY     = 8.875,
    taxRateNJ     = 6.625,
  } = {}) {

    // ── Input sanitization ──────────────────────────────────
    const total     = Math.max(0, parseFloat(jobTotal)      || 0);
    const parts     = Math.max(0, parseFloat(partsCost)     || 0);
    const techPct   = Math.min(100, Math.max(0, parseFloat(techPercent)   || 0));
    const contrPct  = Math.min(100, Math.max(0, parseFloat(contractorPct) || 0));

    // ── Guard: parts cannot exceed total ───────────────────
    const partsActual = Math.min(parts, total);

    // ── Step 1: Tax (ONLY when owner is assigned) ──────────
    let taxRate   = 0;
    let taxAmount = 0;
    let afterTax  = total;

    if (isSelfAssigned) {
      taxRate   = (state === 'NJ' ? taxRateNJ : taxRateNY) / 100;
      taxAmount = round2(total * taxRate);
      afterTax  = round2(total - taxAmount);
    }

    // ── Step 2: Deduct parts ───────────────────────────────
    const afterParts = round2(Math.max(0, afterTax - partsActual));

    // ── Step 3: Contractor fee ─────────────────────────────
    // Fee is taken from the working amount (after tax + parts)
    const contractorFee  = round2(afterParts * (contrPct / 100));
    const afterContractor = round2(afterParts - contractorFee);

    // ── Step 4: Tech / Owner split ─────────────────────────
    const techPayout  = round2(afterContractor * (techPct / 100));
    const ownerPayout = round2(afterContractor - techPayout);

    // ── Validation warnings ─────────────────────────────────
    const warnings = [];
    if (partsActual < parts) {
      warnings.push('Parts cost exceeds job total — capped at job total');
    }
    if (techPct + contrPct > 100) {
      warnings.push('Tech % + Contractor % exceeds 100% — check values');
    }
    if (total === 0) {
      warnings.push('Job total is $0 — enter an estimated amount');
    }
    if (ownerPayout < 0) {
      warnings.push('Owner payout is negative — check percentages');
    }

    return {
      // Inputs (clean)
      jobTotal:      total,
      partsCost:     partsActual,
      techPercent:   techPct,
      contractorPct: contrPct,
      isSelfAssigned,
      state,
      taxRatePercent: round4(taxRate * 100),

      // Computed
      taxAmount,
      afterTax,
      afterParts,
      contractorFee,
      afterContractor,
      techPayout,
      ownerPayout,

      // Meta
      warnings,
      isValid: warnings.filter(w => w.includes('exceeds 100%')).length === 0,
    };
  }

  /**
   * Generate a Zelle payment memo string for a tech.
   */
  function generateZelleMemo({
    techName     = '',
    customerName = '',
    address      = '',
    jobDate      = '',
    techPayout   = 0,
    jobId        = '',
  } = {}) {
    const parts = [
      `On Point Home Services`,
      customerName ? `Job: ${customerName}` : '',
      address      ? address : '',
      jobDate      ? `Date: ${jobDate}` : '',
      `Payout: $${techPayout.toFixed(2)}`,
      jobId        ? `Ref: ${jobId.slice(-6).toUpperCase()}` : '',
    ].filter(Boolean);

    return parts.join('\n');
  }

  /**
   * Render HTML payout breakdown for the preview or detail view.
   * @param {Object} calc      — result from calculate()
   * @param {string} techName  — tech display name
   * @param {string} elemId    — optional id attribute on the wrapper div
   */
  function renderBreakdownHTML(calc, techName = 'Tech', elemId = '') {
    if (!calc) return '';
    const idAttr = elemId ? ` id="${elemId}"` : '';

    const rows = [];

    rows.push(`<div class="payout-row">
      <span class="payout-label">Job Total</span>
      <span class="payout-value">$${calc.jobTotal.toFixed(2)}</span>
    </div>`);

    if (calc.isSelfAssigned && calc.taxAmount > 0) {
      rows.push(`<div class="payout-row">
        <span class="payout-label">Tax (${calc.taxRatePercent}% — ${calc.state})</span>
        <span class="payout-value deduct">-$${calc.taxAmount.toFixed(2)}</span>
      </div>`);
    }

    if (calc.partsCost > 0) {
      rows.push(`<div class="payout-row">
        <span class="payout-label">Parts / Materials</span>
        <span class="payout-value deduct">-$${calc.partsCost.toFixed(2)}</span>
      </div>`);
    }

    if (calc.contractorFee > 0) {
      rows.push(`<div class="payout-row">
        <span class="payout-label">Contractor Fee (${calc.contractorPct}%)</span>
        <span class="payout-value deduct">-$${calc.contractorFee.toFixed(2)}</span>
      </div>`);
    }

    rows.push(`<div class="payout-divider"></div>`);

    rows.push(`<div class="payout-row">
      <span class="payout-label">${techName} Payout (${calc.techPercent}%)</span>
      <span class="payout-value highlight">$${calc.techPayout.toFixed(2)}</span>
    </div>`);

    rows.push(`<div class="payout-total-row">
      <span class="payout-total-label">Your Payout (Owner)</span>
      <span class="payout-total-value">$${calc.ownerPayout.toFixed(2)}</span>
    </div>`);

    const warnings = calc.warnings.map(w =>
      `<div class="payout-warning">⚠ ${w}</div>`
    ).join('');

    return `<div class="payout-preview"${idAttr}>${rows.join('')}${warnings}</div>`;
  }

  // ── Helpers ─────────────────────────────────────────────
  function round2(n) { return Math.round(n * 100) / 100; }
  function round4(n) { return Math.round(n * 10000) / 10000; }

  return {
    calculate,
    generateZelleMemo,
    renderBreakdownHTML,
  };

})();
