/* ============================================================
   PAYOUT.JS — Payout Calculation Engine
   Logic: tech % and contractor % both taken from job total.
   Owner gets what remains after tech, contractor, and parts.
   Tax is chosen explicitly: 'ny' | 'nj' | 'none'
   ============================================================ */

const PayoutEngine = (() => {

  /**
   * Calculate full payout breakdown for a job.
   *
   * @param {object} opts
   * @param {number} opts.jobTotal
   * @param {number} opts.partsCost
   * @param {number} opts.techPercent
   * @param {number} opts.contractorPct
   * @param {string} opts.taxOption  — 'ny' | 'nj' | 'none'
   * @param {number} opts.taxRateNY
   * @param {number} opts.taxRateNJ
   */
  function calculate({
    jobTotal       = 0,
    partsCost      = 0,
    techPercent    = 0,
    contractorPct  = 0,
    taxOption      = 'none',
    isSelfAssigned = false,   // carried through for display only
    taxRateNY      = 8.875,
    taxRateNJ      = 6.625,
  } = {}) {

    // ── Input sanitization ──────────────────────────────────
    const total    = Math.max(0, parseFloat(jobTotal)      || 0);
    const parts    = Math.max(0, parseFloat(partsCost)     || 0);
    const techPct  = Math.min(100, Math.max(0, parseFloat(techPercent)  || 0));
    const contrPct = Math.min(100, Math.max(0, parseFloat(contractorPct)|| 0));

    const partsActual = Math.min(parts, total);

    // ── Step 1: Tax based on explicit selection ─────────────
    let taxRate   = 0;
    if      (taxOption === 'ny') taxRate = taxRateNY / 100;
    else if (taxOption === 'nj') taxRate = taxRateNJ / 100;

    const taxAmount = round2(total * taxRate);
    const afterTax  = round2(total - taxAmount);

    // ── Step 2: Parts deducted first, then % applied to net ─
    const netAfterParts = round2(afterTax - partsActual);
    const techPayout    = round2(netAfterParts * (techPct  / 100));
    const contractorFee = round2(netAfterParts * (contrPct / 100));

    // ── Step 3: Owner gets the remainder ───────────────────
    // When tech % + contractor % ≤ 100 %, rounding can produce a tiny negative
    // (e.g. −$0.01 when both halves of a 50/50 split round up). Clamp to 0.
    const _rawOwner = netAfterParts - techPayout - contractorFee;
    const ownerPayout = round2(techPct + contrPct <= 100 ? Math.max(0, _rawOwner) : _rawOwner);

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
    if (ownerPayout < -0.01) {
      warnings.push('Owner payout is negative — check percentages and parts cost');
    }

    return {
      // Inputs (clean)
      jobTotal:      total,
      partsCost:     partsActual,
      techPercent:   techPct,
      contractorPct: contrPct,
      taxOption,
      isSelfAssigned: !!isSelfAssigned,
      taxRatePercent: round4(taxRate * 100),

      // Computed
      taxAmount,
      afterTax,
      netAfterParts,
      contractorFee,
      techPayout,
      ownerPayout,

      // Meta
      warnings,
      isValid: warnings.filter(w => w.includes('exceeds 100%') || w.includes('negative')).length === 0,
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
      techName     ? `To: ${techName}`        : '',
      customerName ? `Job: ${customerName}`   : '',
      address      ? address                  : '',
      jobDate      ? `Date: ${jobDate}`        : '',
      `Payout: $${techPayout.toFixed(2)}`,
      jobId        ? `Ref: ${jobId.slice(-6).toUpperCase()}` : '',
    ].filter(Boolean);

    return parts.join('\n');
  }

  /**
   * Render HTML payout breakdown for the preview or detail view.
   */
  function renderBreakdownHTML(calc, techName = 'Tech', elemId = '') {
    if (!calc) return '';
    const idAttr = elemId ? ` id="${elemId}"` : '';

    const rows = [];

    rows.push(`<div class="payout-row">
      <span class="payout-label">Job Total</span>
      <span class="payout-value">$${calc.jobTotal.toFixed(2)}</span>
    </div>`);

    if (calc.taxOption !== 'none' && calc.taxAmount > 0) {
      const stateLabel = calc.taxOption === 'ny' ? 'NY' : 'NJ';
      rows.push(`<div class="payout-row">
        <span class="payout-label">Tax (${calc.taxRatePercent}% — ${stateLabel})</span>
        <span class="payout-value deduct">-$${calc.taxAmount.toFixed(2)}</span>
      </div>`);
      rows.push(`<div class="payout-row" style="opacity:0.6;font-size:12px">
        <span class="payout-label">After Tax</span>
        <span class="payout-value">$${calc.afterTax.toFixed(2)}</span>
      </div>`);
    }

    rows.push(`<div class="payout-divider"></div>`);

    if (calc.partsCost > 0) {
      rows.push(`<div class="payout-row">
        <span class="payout-label">Parts / Materials</span>
        <span class="payout-value deduct">-$${calc.partsCost.toFixed(2)}</span>
      </div>`);
      rows.push(`<div class="payout-row" style="opacity:0.6;font-size:12px">
        <span class="payout-label">Net (after parts)</span>
        <span class="payout-value">$${calc.netAfterParts.toFixed(2)}</span>
      </div>`);
    }

    if (calc.isSelfAssigned) {
      // Owner IS the tech — their row is a "you earn" line, not a deduction
      rows.push(`<div class="payout-row">
        <span class="payout-label">You as Tech (${calc.techPercent}%)</span>
        <span class="payout-value" style="color:var(--color-success)">+$${calc.techPayout.toFixed(2)}</span>
      </div>`);
    } else {
      rows.push(`<div class="payout-row">
        <span class="payout-label">${techName} (${calc.techPercent}%)</span>
        <span class="payout-value deduct">-$${calc.techPayout.toFixed(2)}</span>
      </div>`);
    }

    if (calc.contractorFee > 0) {
      rows.push(`<div class="payout-row">
        <span class="payout-label">Contractor Fee (${calc.contractorPct}%)</span>
        <span class="payout-value deduct">-$${calc.contractorFee.toFixed(2)}</span>
      </div>`);
    }

    rows.push(`<div class="payout-divider"></div>`);

    if (calc.isSelfAssigned) {
      // Your total = what you earn as tech + whatever remains as owner
      const yourTotal = round2(calc.ownerPayout + calc.techPayout);
      rows.push(`<div class="payout-total-row">
        <span class="payout-total-label">Your Total (Tech + Owner)</span>
        <span class="payout-total-value">$${yourTotal.toFixed(2)}</span>
      </div>`);
    } else {
      rows.push(`<div class="payout-total-row">
        <span class="payout-total-label">Your Payout (Owner)</span>
        <span class="payout-total-value">$${calc.ownerPayout.toFixed(2)}</span>
      </div>`);
    }

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
