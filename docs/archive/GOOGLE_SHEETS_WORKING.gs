function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'ping') {
      return respond({ success: true, message: 'Connected' });
    }

    if (data.action === 'upsertJob') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var jobSheet = getOrCreateSheet(ss, 'Jobs');

      var job = data.data;
      var headers = ['Job ID', 'Name', 'Phone', 'Date', 'Source', 'Tech', 'Total', 'Parts', 'Tech %', 'Tech $', 'On Point %', 'On Point $', 'Contractor %', 'Contractor $', 'Other', 'Status', 'Paid At'];

      // Ensure headers exist
      if (jobSheet.getLastRow() === 0) {
        jobSheet.appendRow(headers);
        jobSheet.getRange(1, 1, 1, 17).setBackground('#4285f4').setFontColor('#ffffff').setFontWeight('bold');
        jobSheet.setFrozenRows(1);
      }

      // Find existing row
      var allData = jobSheet.getDataRange().getValues();
      var rowIndex = -1;
      for (var i = 1; i < allData.length; i++) {
        if (allData[i][0] == job.jobId) {
          rowIndex = i + 1;
          break;
        }
      }

      // Build row
      var total = parseFloat(job.jobTotal) || 0;
      var parts = parseFloat(job.partsCost) || 0;
      var ownerPayout = parseFloat(job.ownerPayout) || 0;
      var onPointPct = (total - parts) > 0 ? ((ownerPayout / (total - parts)) * 100) : 0;

      var other = [];
      if (job.address) other.push(job.address);
      if (job.city) other.push(job.city);
      if (job.state) other.push(job.state);
      if (job.zip) other.push(job.zip);
      if (job.scheduledTime) other.push('Time: ' + job.scheduledTime);
      if (job.description) other.push('Desc: ' + job.description);
      if (job.notes) other.push('Notes: ' + job.notes);
      if (job.paymentMethod) other.push('Pay: ' + job.paymentMethod);

      var row = [
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
        ownerPayout,
        parseFloat(job.contractorPct) || 0,
        parseFloat(job.contractorFee) || 0,
        other.join(' | '),
        job.status || '',
        job.paidAt || ''
      ];

      // Insert or update
      if (rowIndex > 0) {
        jobSheet.getRange(rowIndex, 1, 1, 17).setValues([row]);
      } else {
        jobSheet.appendRow(row);
        rowIndex = jobSheet.getLastRow();
      }

      // Format
      formatNumbers(jobSheet, rowIndex);

      // Create other sheets
      createPaidSheet(ss, jobSheet);
      createUnpaidSheet(ss, jobSheet);
      createContractorSheet(ss, jobSheet);

      return respond({ success: true, jobId: job.jobId, row: rowIndex });
    }

    return respond({ success: false, error: 'Unknown action' });

  } catch (err) {
    return respond({ success: false, error: err.toString(), line: err.lineNumber });
  }
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function formatNumbers(sheet, row) {
  sheet.getRange(row, 7).setNumberFormat('$#,##0.00');
  sheet.getRange(row, 8).setNumberFormat('$#,##0.00');
  sheet.getRange(row, 10).setNumberFormat('$#,##0.00');
  sheet.getRange(row, 12).setNumberFormat('$#,##0.00');
  sheet.getRange(row, 14).setNumberFormat('$#,##0.00');
  sheet.getRange(row, 9).setNumberFormat('0.00"%"');
  sheet.getRange(row, 11).setNumberFormat('0.00"%"');
  sheet.getRange(row, 13).setNumberFormat('0.00"%"');
}

function createPaidSheet(ss, jobSheet) {
  var paidSheet = getOrCreateSheet(ss, 'Paid');
  paidSheet.clear();

  var allData = jobSheet.getDataRange().getValues();
  var headers = allData[0];
  var paidRows = [headers];

  for (var i = 1; i < allData.length; i++) {
    if (allData[i][15] == 'paid') {
      paidRows.push(allData[i]);
    }
  }

  if (paidRows.length > 1) {
    paidSheet.getRange(1, 1, paidRows.length, headers.length).setValues(paidRows);
    paidSheet.getRange(1, 1, 1, headers.length).setBackground('#4285f4').setFontColor('#ffffff').setFontWeight('bold');
    paidSheet.setFrozenRows(1);
  }
}

function createUnpaidSheet(ss, jobSheet) {
  var unpaidSheet = getOrCreateSheet(ss, 'Unpaid');
  unpaidSheet.clear();

  var allData = jobSheet.getDataRange().getValues();
  var headers = allData[0];
  var unpaidRows = [headers];

  for (var i = 1; i < allData.length; i++) {
    if (allData[i][15] != 'paid') {
      unpaidRows.push(allData[i]);
    }
  }

  if (unpaidRows.length > 1) {
    unpaidSheet.getRange(1, 1, unpaidRows.length, headers.length).setValues(unpaidRows);
    unpaidSheet.getRange(1, 1, 1, headers.length).setBackground('#4285f4').setFontColor('#ffffff').setFontWeight('bold');
    unpaidSheet.setFrozenRows(1);
  }
}

function createContractorSheet(ss, jobSheet) {
  var contractorSheet = getOrCreateSheet(ss, 'Contractor Payments');
  contractorSheet.clear();

  var allData = jobSheet.getDataRange().getValues();
  var contractorData = {};

  for (var i = 1; i < allData.length; i++) {
    var source = allData[i][4];
    var contractorFee = parseFloat(allData[i][13]) || 0;

    if (contractorFee > 0 && source) {
      if (!contractorData[source]) {
        contractorData[source] = { count: 0, revenue: 0, parts: 0, contractorPayout: 0, onPointPayout: 0, pct: 0 };
      }
      contractorData[source].count++;
      contractorData[source].revenue += parseFloat(allData[i][6]) || 0;
      contractorData[source].parts += parseFloat(allData[i][7]) || 0;
      contractorData[source].contractorPayout += contractorFee;
      contractorData[source].onPointPayout += parseFloat(allData[i][11]) || 0;
      contractorData[source].pct = parseFloat(allData[i][12]) || 0;
    }
  }

  var headers = ['Source', 'Jobs', 'Revenue', 'Parts', 'Contractor %', 'Contractor $', 'On Point $'];
  var rows = [headers];

  for (var source in contractorData) {
    var d = contractorData[source];
    rows.push([source, d.count, d.revenue, d.parts, d.pct, d.contractorPayout, d.onPointPayout]);
  }

  if (rows.length > 1) {
    contractorSheet.getRange(1, 1, rows.length, 7).setValues(rows);
    contractorSheet.getRange(1, 1, 1, 7).setBackground('#4285f4').setFontColor('#ffffff').setFontWeight('bold');
    contractorSheet.setFrozenRows(1);

    for (var r = 2; r <= rows.length; r++) {
      contractorSheet.getRange(r, 3).setNumberFormat('$#,##0.00');
      contractorSheet.getRange(r, 4).setNumberFormat('$#,##0.00');
      contractorSheet.getRange(r, 5).setNumberFormat('0.00"%"');
      contractorSheet.getRange(r, 6).setNumberFormat('$#,##0.00');
      contractorSheet.getRange(r, 7).setNumberFormat('$#,##0.00');
    }
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
