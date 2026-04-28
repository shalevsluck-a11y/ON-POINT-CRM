function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'ping') {
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'Ping OK' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'upsertJob') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Jobs');

      // CREATE SHEET IF NOT EXISTS
      if (!sheet) {
        sheet = ss.insertSheet('Jobs');
        var headers = ['Job ID', 'Name', 'Phone', 'Date', 'Source', 'Tech', 'Total', 'Parts', 'Tech %', 'Tech $', 'On Point %', 'On Point $', 'Contractor %', 'Contractor $', 'Other', 'Status', 'Paid At'];
        sheet.getRange(1, 1, 1, 17).setValues([headers]);
        sheet.getRange(1, 1, 1, 17).setBackground('#4285f4').setFontColor('#ffffff').setFontWeight('bold');
        sheet.setFrozenRows(1);
      }

      var job = data.data;
      var allData = sheet.getDataRange().getValues();
      var rowIndex = -1;

      // FIND EXISTING ROW
      for (var i = 1; i < allData.length; i++) {
        if (allData[i][0] == job.jobId) {
          rowIndex = i + 1;
          break;
        }
      }

      // BUILD ROW DATA
      var total = parseFloat(job.jobTotal) || 0;
      var parts = parseFloat(job.partsCost) || 0;
      var techPayout = parseFloat(job.techPayout) || 0;
      var ownerPayout = parseFloat(job.ownerPayout) || 0;
      var contractorFee = parseFloat(job.contractorFee) || 0;

      var onPointPct = (total - parts) > 0 ? ((ownerPayout / (total - parts)) * 100) : 0;

      var other = [];
      if (job.address) other.push('Addr: ' + job.address);
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
        techPayout,
        onPointPct,
        ownerPayout,
        parseFloat(job.contractorPct) || 0,
        contractorFee,
        other.join(' | '),
        job.status || '',
        job.paidAt || ''
      ];

      // UPDATE OR INSERT
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 1, 1, 17).setValues([row]);
      } else {
        sheet.appendRow(row);
        rowIndex = sheet.getLastRow();
      }

      // FORMAT NUMBERS
      sheet.getRange(rowIndex, 7).setNumberFormat('$#,##0.00');
      sheet.getRange(rowIndex, 8).setNumberFormat('$#,##0.00');
      sheet.getRange(rowIndex, 10).setNumberFormat('$#,##0.00');
      sheet.getRange(rowIndex, 12).setNumberFormat('$#,##0.00');
      sheet.getRange(rowIndex, 14).setNumberFormat('$#,##0.00');
      sheet.getRange(rowIndex, 9).setNumberFormat('0.00"%"');
      sheet.getRange(rowIndex, 11).setNumberFormat('0.00"%"');
      sheet.getRange(rowIndex, 13).setNumberFormat('0.00"%"');

      // CREATE PAID SHEET
      createPaidSheet(ss);

      // CREATE UNPAID SHEET
      createUnpaidSheet(ss);

      // CREATE CONTRACTOR SHEET
      createContractorSheet(ss);

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        jobId: job.jobId,
        action: rowIndex > 0 ? 'updated' : 'inserted',
        row: rowIndex
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString(),
      line: err.lineNumber || 'unknown'
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function createPaidSheet(ss) {
  var mainSheet = ss.getSheetByName('Jobs');
  if (!mainSheet) return;

  var paidSheet = ss.getSheetByName('Paid');
  if (!paidSheet) {
    paidSheet = ss.insertSheet('Paid');
  }

  var allData = mainSheet.getDataRange().getValues();
  if (allData.length < 2) return;

  var headers = allData[0];
  var paidRows = [headers];

  for (var i = 1; i < allData.length; i++) {
    if (allData[i][15] == 'paid') {
      paidRows.push(allData[i]);
    }
  }

  paidRows.sort(function(a, b) {
    if (a === headers) return -1;
    if (b === headers) return 1;
    var dateA = new Date(a[3]);
    var dateB = new Date(b[3]);
    return dateB - dateA;
  });

  paidSheet.clear();
  if (paidRows.length > 0) {
    paidSheet.getRange(1, 1, paidRows.length, headers.length).setValues(paidRows);
    paidSheet.getRange(1, 1, 1, headers.length).setBackground('#4285f4').setFontColor('#ffffff').setFontWeight('bold');
    paidSheet.setFrozenRows(1);
  }
}

function createUnpaidSheet(ss) {
  var mainSheet = ss.getSheetByName('Jobs');
  if (!mainSheet) return;

  var unpaidSheet = ss.getSheetByName('Unpaid');
  if (!unpaidSheet) {
    unpaidSheet = ss.insertSheet('Unpaid');
  }

  var allData = mainSheet.getDataRange().getValues();
  if (allData.length < 2) return;

  var headers = allData[0];
  var unpaidRows = [headers];

  for (var i = 1; i < allData.length; i++) {
    if (allData[i][15] != 'paid') {
      unpaidRows.push(allData[i]);
    }
  }

  unpaidRows.sort(function(a, b) {
    if (a === headers) return -1;
    if (b === headers) return 1;
    var dateA = new Date(a[3]);
    var dateB = new Date(b[3]);
    return dateB - dateA;
  });

  unpaidSheet.clear();
  if (unpaidRows.length > 0) {
    unpaidSheet.getRange(1, 1, unpaidRows.length, headers.length).setValues(unpaidRows);
    unpaidSheet.getRange(1, 1, 1, headers.length).setBackground('#4285f4').setFontColor('#ffffff').setFontWeight('bold');
    unpaidSheet.setFrozenRows(1);
  }
}

function createContractorSheet(ss) {
  var mainSheet = ss.getSheetByName('Jobs');
  if (!mainSheet) return;

  var contractorSheet = ss.getSheetByName('Contractor Payments');
  if (!contractorSheet) {
    contractorSheet = ss.insertSheet('Contractor Payments');
  }

  var allData = mainSheet.getDataRange().getValues();
  if (allData.length < 2) return;

  var contractorData = {};

  for (var i = 1; i < allData.length; i++) {
    var source = allData[i][4];
    var contractorFee = parseFloat(allData[i][13]) || 0;

    if (contractorFee > 0 && source) {
      if (!contractorData[source]) {
        contractorData[source] = {
          count: 0,
          revenue: 0,
          parts: 0,
          contractorPayout: 0,
          onPointPayout: 0,
          pct: parseFloat(allData[i][12]) || 0
        };
      }
      contractorData[source].count++;
      contractorData[source].revenue += parseFloat(allData[i][6]) || 0;
      contractorData[source].parts += parseFloat(allData[i][7]) || 0;
      contractorData[source].contractorPayout += contractorFee;
      contractorData[source].onPointPayout += parseFloat(allData[i][11]) || 0;
    }
  }

  var headers = ['Source', 'Jobs', 'Revenue', 'Parts', 'Contractor %', 'Contractor $', 'On Point $'];
  var rows = [headers];

  for (var source in contractorData) {
    var d = contractorData[source];
    rows.push([
      source,
      d.count,
      d.revenue,
      d.parts,
      d.pct,
      d.contractorPayout,
      d.onPointPayout
    ]);
  }

  contractorSheet.clear();
  if (rows.length > 0) {
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
