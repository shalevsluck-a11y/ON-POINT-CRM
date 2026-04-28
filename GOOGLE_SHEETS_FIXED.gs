// Google Apps Script - ON POINT CRM
// Auto-creates 4 sheets: Jobs, Paid, Unpaid, Contractor Payments

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'ping') {
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'upsertJob') {
      var result = upsertJob(data.data);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: 'Unknown action'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function upsertJob(job) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Jobs');

  if (!sheet) {
    sheet = ss.insertSheet('Jobs');
    setupSheet(sheet);
  }

  var data = sheet.getDataRange().getValues();
  var existingRowIndex = -1;

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === job.jobId) {
      existingRowIndex = i + 1;
      break;
    }
  }

  var total = parseFloat(job.jobTotal) || 0;
  var parts = parseFloat(job.partsCost) || 0;
  var onPointPayout = parseFloat(job.ownerPayout) || 0;
  var onPointPct = (total - parts) > 0 ? ((onPointPayout / (total - parts)) * 100) : 0;

  var otherParts = [];
  if (job.address || job.city || job.state || job.zip) {
    otherParts.push('Address: ' + (job.address || '') + ' ' + (job.city || '') + ' ' + (job.state || '') + ' ' + (job.zip || ''));
  }
  if (job.scheduledTime) otherParts.push('Time: ' + job.scheduledTime);
  if (job.description) otherParts.push('Description: ' + job.description);
  if (job.notes) otherParts.push('Notes: ' + job.notes);
  if (job.paymentMethod) otherParts.push('Payment: ' + job.paymentMethod);

  var other = otherParts.join(' | ');

  var rowData = [
    job.jobId || '',
    job.customerName || '',
    job.phone || '',
    job.scheduledDate || '',
    job.source || '',
    job.assignedTechName || '',
    total,
    parts,
    parseFloat(job.techPercent) || 0,
    parseFloat(job.techPayout) || 0,
    onPointPct,
    onPointPayout,
    parseFloat(job.contractorPct) || 0,
    parseFloat(job.contractorFee) || 0,
    other,
    job.status || '',
    job.paidAt || ''
  ];

  if (existingRowIndex > 0) {
    sheet.getRange(existingRowIndex, 1, 1, rowData.length).setValues([rowData]);
    formatRow(sheet, existingRowIndex);
  } else {
    sheet.appendRow(rowData);
    var newRow = sheet.getLastRow();
    formatRow(sheet, newRow);
  }

  updateFilteredSheets(ss);

  return { success: true, jobId: job.jobId };
}

function setupSheet(sheet) {
  var headers = ['Job ID', 'Name', 'Phone', 'Date', 'Source', 'Tech Name', 'Total', 'Parts Cost', 'Tech %', 'Tech Payout', 'On Point %', 'On Point Payout', 'Contractor %', 'Contractor Payout', 'Other', 'Status', 'Paid At'];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#4285f4');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');

  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 150);
  sheet.setColumnWidth(6, 150);
  sheet.setColumnWidth(7, 100);
  sheet.setColumnWidth(8, 100);
  sheet.setColumnWidth(9, 80);
  sheet.setColumnWidth(10, 100);
  sheet.setColumnWidth(11, 80);
  sheet.setColumnWidth(12, 120);
  sheet.setColumnWidth(13, 100);
  sheet.setColumnWidth(14, 120);
  sheet.setColumnWidth(15, 400);

  sheet.setFrozenRows(1);
}

function formatRow(sheet, rowIndex) {
  sheet.getRange(rowIndex, 7).setNumberFormat('$#,##0.00');
  sheet.getRange(rowIndex, 8).setNumberFormat('$#,##0.00');
  sheet.getRange(rowIndex, 10).setNumberFormat('$#,##0.00');
  sheet.getRange(rowIndex, 12).setNumberFormat('$#,##0.00');
  sheet.getRange(rowIndex, 14).setNumberFormat('$#,##0.00');
  sheet.getRange(rowIndex, 9).setNumberFormat('0.00"%"');
  sheet.getRange(rowIndex, 11).setNumberFormat('0.00"%"');
  sheet.getRange(rowIndex, 13).setNumberFormat('0.00"%"');
  sheet.getRange(rowIndex, 4).setNumberFormat('yyyy-mm-dd');
}

function updateFilteredSheets(ss) {
  var mainSheet = ss.getSheetByName('Jobs');
  if (!mainSheet) return;

  var data = mainSheet.getDataRange().getValues();
  if (data.length < 2) return;

  var headers = data[0];

  // Create Paid sheet
  var paidSheet = ss.getSheetByName('Paid');
  if (!paidSheet) {
    paidSheet = ss.insertSheet('Paid');
  }
  paidSheet.clear();
  paidSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatHeaders(paidSheet, headers.length);

  var paidRows = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][15] === 'paid') {
      paidRows.push(data[i]);
    }
  }

  paidRows.sort(function(a, b) {
    return new Date(b[3]) - new Date(a[3]);
  });

  if (paidRows.length > 0) {
    paidSheet.getRange(2, 1, paidRows.length, headers.length).setValues(paidRows);
    for (var r = 2; r <= paidRows.length + 1; r++) {
      formatRow(paidSheet, r);
    }
  }

  // Create Unpaid sheet
  var unpaidSheet = ss.getSheetByName('Unpaid');
  if (!unpaidSheet) {
    unpaidSheet = ss.insertSheet('Unpaid');
  }
  unpaidSheet.clear();
  unpaidSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatHeaders(unpaidSheet, headers.length);

  var unpaidRows = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][15] !== 'paid') {
      unpaidRows.push(data[i]);
    }
  }

  unpaidRows.sort(function(a, b) {
    return new Date(b[3]) - new Date(a[3]);
  });

  if (unpaidRows.length > 0) {
    unpaidSheet.getRange(2, 1, unpaidRows.length, headers.length).setValues(unpaidRows);
    for (var r = 2; r <= unpaidRows.length + 1; r++) {
      formatRow(unpaidSheet, r);
    }
  }

  // Create Contractor Payments sheet
  var contractorSheet = ss.getSheetByName('Contractor Payments');
  if (!contractorSheet) {
    contractorSheet = ss.insertSheet('Contractor Payments');
  }
  contractorSheet.clear();

  var contractorHeaders = ['Source', 'Job Count', 'Total Revenue', 'Parts Cost', 'Contractor %', 'Contractor Payout', 'On Point Payout'];
  contractorSheet.getRange(1, 1, 1, contractorHeaders.length).setValues([contractorHeaders]);
  formatHeaders(contractorSheet, contractorHeaders.length);

  var contractorData = {};
  for (var i = 1; i < data.length; i++) {
    var source = data[i][4];
    var contractorFee = parseFloat(data[i][13]) || 0;
    if (contractorFee > 0 && source) {
      if (!contractorData[source]) {
        contractorData[source] = {
          count: 0,
          totalRevenue: 0,
          partsCost: 0,
          contractorPayout: 0,
          onPointPayout: 0,
          contractorPct: parseFloat(data[i][12]) || 0
        };
      }
      contractorData[source].count++;
      contractorData[source].totalRevenue += parseFloat(data[i][6]) || 0;
      contractorData[source].partsCost += parseFloat(data[i][7]) || 0;
      contractorData[source].contractorPayout += contractorFee;
      contractorData[source].onPointPayout += parseFloat(data[i][11]) || 0;
    }
  }

  var contractorRows = [];
  for (var source in contractorData) {
    var d = contractorData[source];
    contractorRows.push([
      source,
      d.count,
      d.totalRevenue,
      d.partsCost,
      d.contractorPct,
      d.contractorPayout,
      d.onPointPayout
    ]);
  }

  if (contractorRows.length > 0) {
    contractorSheet.getRange(2, 1, contractorRows.length, contractorHeaders.length).setValues(contractorRows);
    for (var r = 2; r <= contractorRows.length + 1; r++) {
      contractorSheet.getRange(r, 3).setNumberFormat('$#,##0.00');
      contractorSheet.getRange(r, 4).setNumberFormat('$#,##0.00');
      contractorSheet.getRange(r, 5).setNumberFormat('0.00"%"');
      contractorSheet.getRange(r, 6).setNumberFormat('$#,##0.00');
      contractorSheet.getRange(r, 7).setNumberFormat('$#,##0.00');
    }
  }
}

function formatHeaders(sheet, numCols) {
  var headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setBackground('#4285f4');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
}
