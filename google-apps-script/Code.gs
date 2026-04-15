// ============================================================
// ON POINT HOME SERVICES — Google Apps Script Backend
// Handles all CRUD operations with Google Sheets
// Deploy as Web App: Execute as Me, Anyone can access
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
var SPREADSHEET_NAME = 'On Point Home Services — Jobs';
var SHEET_NAME       = 'Jobs';

// Column headers (must match exactly — order matters)
var HEADERS = [
  'jobId',
  'createdAt',
  'updatedAt',
  'status',
  'customerName',
  'phone',
  'address',
  'city',
  'state',
  'zip',
  'scheduledDate',
  'scheduledTime',
  'description',
  'notes',
  'source',
  'contractorName',
  'contractorPct',
  'assignedTechId',
  'assignedTechName',
  'isSelfAssigned',
  'techPercent',
  'estimatedTotal',
  'jobTotal',
  'partsCost',
  'taxAmount',
  'techPayout',
  'ownerPayout',
  'contractorFee',
  'paymentMethod',
  'paidAt',
  'zelleMemo',
  'isRecurring',
  'photoCount',
];

// ── MAIN ENTRY POINT ─────────────────────────────────────────

function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    // Body arrives as text/plain (avoids CORS preflight from the browser)
    var body   = JSON.parse(e.postData.contents);
    var action = body.action || '';
    var data   = body.data   || {};
    var result = _handleAction(action, data);
    output.setContent(JSON.stringify(result));
  } catch (err) {
    output.setContent(JSON.stringify({
      ok:    false,
      error: err.toString(),
      stack: err.stack,
    }));
  }

  return output;
}

// Also handle GET (for testing in browser / fallback)
function doGet(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var action = (e.parameter && e.parameter.action) ? e.parameter.action : 'ping';
    var data   = (e.parameter && e.parameter.data)   ? JSON.parse(e.parameter.data) : {};
    output.setContent(JSON.stringify(_handleAction(action, data)));
  } catch (err) {
    output.setContent(JSON.stringify({ ok: false, error: err.toString() }));
  }

  return output;
}

function _handleAction(action, data) {
  switch (action) {
    case 'ping':
      return { ok: true, message: 'On Point Home Services backend is running', ts: new Date().toISOString() };
    case 'upsertJob':
      return upsertJob(data);
    case 'deleteJob':
      return deleteJob(data.jobId);
    case 'getAllJobs':
      return getAllJobs();
    case 'getJob':
      return getJobById(data.jobId);
    default:
      return { ok: false, error: 'Unknown action: ' + action };
  }
}

// ── UPSERT JOB ───────────────────────────────────────────────
// Insert new row or update existing by jobId

function upsertJob(data) {
  if (!data || !data.jobId) {
    return { ok: false, error: 'Missing jobId in data' };
  }

  var sheet = getOrCreateSheet();
  var jobId = String(data.jobId);

  // Find existing row
  var existingRow = findRowByJobId(sheet, jobId);

  // Build row values in HEADERS order
  var rowValues = HEADERS.map(function(col) {
    var val = data[col];
    if (val === undefined || val === null) return '';
    return val;
  });

  if (existingRow > 0) {
    // Update existing row
    var range = sheet.getRange(existingRow, 1, 1, HEADERS.length);
    range.setValues([rowValues]);
    return { ok: true, action: 'updated', row: existingRow, jobId: jobId };
  } else {
    // Append new row
    sheet.appendRow(rowValues);
    var newRow = sheet.getLastRow();
    // Apply alternating row color
    _applyRowFormatting(sheet, newRow, data.status);
    return { ok: true, action: 'inserted', row: newRow, jobId: jobId };
  }
}

// ── DELETE JOB ───────────────────────────────────────────────

function deleteJob(jobId) {
  if (!jobId) return { ok: false, error: 'Missing jobId' };

  var sheet = getOrCreateSheet();
  var row   = findRowByJobId(sheet, String(jobId));

  if (row <= 0) {
    return { ok: false, error: 'Job not found: ' + jobId };
  }

  sheet.deleteRow(row);
  return { ok: true, action: 'deleted', jobId: jobId };
}

// ── GET ALL JOBS ─────────────────────────────────────────────

function getAllJobs() {
  var sheet = getOrCreateSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return { ok: true, jobs: [], count: 0 };
  }

  var range  = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
  var values = range.getValues();

  var jobs = values.map(function(row) {
    var job = {};
    HEADERS.forEach(function(col, i) {
      job[col] = row[i] !== undefined ? String(row[i]) : '';
    });
    return job;
  }).filter(function(job) {
    return job.jobId && job.jobId.trim() !== '';
  });

  return { ok: true, jobs: jobs, count: jobs.length };
}

// ── GET JOB BY ID ────────────────────────────────────────────

function getJobById(jobId) {
  if (!jobId) return { ok: false, error: 'Missing jobId' };

  var sheet = getOrCreateSheet();
  var row   = findRowByJobId(sheet, String(jobId));

  if (row <= 0) {
    return { ok: false, error: 'Job not found' };
  }

  var values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  var job    = {};
  HEADERS.forEach(function(col, i) {
    job[col] = values[i] !== undefined ? String(values[i]) : '';
  });

  return { ok: true, job: job };
}

// ── FIND ROW BY JOB ID ───────────────────────────────────────

function findRowByJobId(sheet, jobId) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;

  // jobId is in column 1 (index 0 = 'jobId')
  var jobIdCol = 1;
  var data     = sheet.getRange(2, jobIdCol, lastRow - 1, 1).getValues();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === jobId) {
      return i + 2; // +2 because data starts at row 2 and array is 0-indexed
    }
  }

  return -1;
}

// ── GET OR CREATE SHEET ──────────────────────────────────────

function getOrCreateSheet() {
  var spreadsheet = _getOrCreateSpreadsheet();
  var sheet       = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    _initSheet(sheet);
  } else {
    // Validate headers — repair if missing
    _validateHeaders(sheet);
  }

  return sheet;
}

function _getOrCreateSpreadsheet() {
  // Try to find existing spreadsheet in Drive
  var files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (files.hasNext()) {
    var file = files.next();
    return SpreadsheetApp.open(file);
  }

  // Create new one
  var ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  return ss;
}

function _initSheet(sheet) {
  // Write headers
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);

  // Header styling
  headerRange.setBackground('#0F172A');
  headerRange.setFontColor('#F1F5F9');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(11);
  headerRange.setFrozenRows(1);

  // Column widths
  var widths = {
    1:  120, // jobId
    2:  150, // createdAt
    3:  150, // updatedAt
    4:   90, // status
    5:  160, // customerName
    6:  130, // phone
    7:  200, // address
    8:  130, // city
    9:   60, // state
    10:  70, // zip
    11: 110, // scheduledDate
    12:  80, // scheduledTime
    13: 250, // description
    14: 200, // notes
    15: 120, // source
    16: 150, // contractorName
    17:  80, // contractorPct
    18: 120, // assignedTechId
    19: 140, // assignedTechName
    20:  90, // isSelfAssigned
    21:  80, // techPercent
    22:  90, // estimatedTotal
    23:  90, // jobTotal
    24:  90, // partsCost
    25:  90, // taxAmount
    26:  90, // techPayout
    27:  90, // ownerPayout
    28:  90, // contractorFee
    29: 100, // paymentMethod
    30: 150, // paidAt
    31: 300, // zelleMemo
    32:  90, // isRecurring
    33:  80, // photoCount
  };

  Object.keys(widths).forEach(function(col) {
    sheet.setColumnWidth(parseInt(col), widths[col]);
  });

  Logger.log('Sheet initialized: ' + SHEET_NAME);
}

function _validateHeaders(sheet) {
  var firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var needsRepair = false;

  for (var i = 0; i < HEADERS.length; i++) {
    if (String(firstRow[i]) !== HEADERS[i]) {
      needsRepair = true;
      break;
    }
  }

  if (needsRepair) {
    Logger.log('Headers mismatch detected — repairing...');
    _initSheet(sheet);
  }
}

function _applyRowFormatting(sheet, row, status) {
  var statusColors = {
    'new':         '#EFF6FF',
    'scheduled':   '#F5F3FF',
    'in_progress': '#FFFBEB',
    'closed':      '#ECFDF5',
    'paid':        '#F0FDF4',
  };

  var color = statusColors[status] || '#FFFFFF';
  sheet.getRange(row, 1, 1, HEADERS.length).setBackground(color);
}

// ── SPREADSHEET SUMMARY VIEW ─────────────────────────────────
// Run this manually from Apps Script to create a summary tab

function createSummarySheet() {
  var spreadsheet = _getOrCreateSpreadsheet();
  var summaryName = 'Summary';
  var existing    = spreadsheet.getSheetByName(summaryName);
  if (existing) spreadsheet.deleteSheet(existing);

  var summary = spreadsheet.insertSheet(summaryName, 0); // Insert as first sheet

  summary.getRange('A1').setValue('On Point Home Services — Summary');
  summary.getRange('A1').setFontSize(16).setFontWeight('bold');
  summary.getRange('A1:F1').merge().setBackground('#0F172A').setFontColor('#F1F5F9');

  var statsData = [
    ['Metric', 'Value'],
    ['Total Jobs',       '=COUNTA(Jobs!A2:A)'],
    ['New',              '=COUNTIF(Jobs!D:D,"new")'],
    ['Scheduled',        '=COUNTIF(Jobs!D:D,"scheduled")'],
    ['In Progress',      '=COUNTIF(Jobs!D:D,"in_progress")'],
    ['Closed',           '=COUNTIF(Jobs!D:D,"closed")'],
    ['Paid',             '=COUNTIF(Jobs!D:D,"paid")'],
    ['', ''],
    ['Total Revenue',    '=SUMIF(Jobs!D:D,"paid",Jobs!W:W)'],
    ['Total Tech Payout','=SUMIF(Jobs!D:D,"paid",Jobs!Z:Z)'],
    ['Total Owner Pay',  '=SUMIF(Jobs!D:D,"paid",Jobs!AA:AA)'],
  ];

  summary.getRange(3, 1, statsData.length, 2).setValues(statsData);
  summary.getRange(3, 1, 1, 2).setFontWeight('bold').setBackground('#1E293B').setFontColor('#F1F5F9');

  Logger.log('Summary sheet created');
}

// ── UTILITY: Get spreadsheet URL (run manually) ───────────────

function getSpreadsheetUrl() {
  var ss = _getOrCreateSpreadsheet();
  Logger.log('Spreadsheet URL: ' + ss.getUrl());
  return ss.getUrl();
}
