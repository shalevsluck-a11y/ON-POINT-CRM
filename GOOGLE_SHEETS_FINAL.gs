/**
 * Google Apps Script - ON POINT CRM to Sheets Sync
 * Auto-creates sheet, formats columns, updates existing rows
 */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'ping') {
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'upsertJob') {
      const result = upsertJob(data.data);
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Jobs');

  // Create sheet if doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Jobs');
    setupSheet(sheet);
  }

  const data = sheet.getDataRange().getValues();

  // Search for existing row with this jobId
  let existingRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === job.jobId) { // jobId is first column
      existingRowIndex = i + 1; // +1 because sheet rows are 1-indexed
      break;
    }
  }

  // Calculate On Point percentage
  const total = parseFloat(job.jobTotal) || 0;
  const parts = parseFloat(job.partsCost) || 0;
  const techPayout = parseFloat(job.techPayout) || 0;
  const contractorFee = parseFloat(job.contractorFee) || 0;
  const onPointPayout = parseFloat(job.ownerPayout) || 0;
  const onPointPct = (total - parts) > 0 ? ((onPointPayout / (total - parts)) * 100) : 0;

  // Build "Other" column with all extra details
  const other = [
    `Address: ${job.address || ''} ${job.city || ''} ${job.state || ''} ${job.zip || ''}`,
    `Time: ${job.scheduledTime || 'TBD'}`,
    `Description: ${job.description || ''}`,
    `Notes: ${job.notes || ''}`,
    `Status: ${job.status || ''}`,
    `Payment: ${job.paymentMethod || ''} ${job.paidAt ? 'on ' + job.paidAt : ''}`,
    `Created: ${job.createdAt || ''}`,
    `Updated: ${job.updatedAt || ''}`
  ].filter(line => line.split(':')[1].trim()).join(' | ');

  // Build row data
  const rowData = [
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
    onPointPayout,
    parseFloat(job.contractorPct) || 0,
    contractorFee,
    other
  ];

  if (existingRowIndex > 0) {
    // UPDATE existing row
    sheet.getRange(existingRowIndex, 1, 1, rowData.length).setValues([rowData]);
    return {
      success: true,
      action: 'updated',
      row: existingRowIndex,
      jobId: job.jobId
    };
  } else {
    // INSERT new row
    sheet.appendRow(rowData);
    const newRow = sheet.getLastRow();
    formatRow(sheet, newRow);
    return {
      success: true,
      action: 'inserted',
      row: newRow,
      jobId: job.jobId
    };
  }
}

function setupSheet(sheet) {
  // Set headers
  const headers = [
    'Job ID',
    'Name',
    'Phone',
    'Date',
    'Source',
    'Tech Name',
    'Total',
    'Parts Cost',
    'Tech %',
    'Tech Payout',
    'On Point %',
    'On Point Payout',
    'Contractor %',
    'Contractor Payout',
    'Other'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Format header row
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#4285f4');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');

  // Set column widths
  sheet.setColumnWidth(1, 120);  // Job ID
  sheet.setColumnWidth(2, 150);  // Name
  sheet.setColumnWidth(3, 120);  // Phone
  sheet.setColumnWidth(4, 100);  // Date
  sheet.setColumnWidth(5, 150);  // Source
  sheet.setColumnWidth(6, 150);  // Tech Name
  sheet.setColumnWidth(7, 100);  // Total
  sheet.setColumnWidth(8, 100);  // Parts Cost
  sheet.setColumnWidth(9, 80);   // Tech %
  sheet.setColumnWidth(10, 100); // Tech Payout
  sheet.setColumnWidth(11, 80);  // On Point %
  sheet.setColumnWidth(12, 120); // On Point Payout
  sheet.setColumnWidth(13, 100); // Contractor %
  sheet.setColumnWidth(14, 120); // Contractor Payout
  sheet.setColumnWidth(15, 400); // Other

  // Freeze header row
  sheet.setFrozenRows(1);
}

function formatRow(sheet, rowIndex) {
  // Format currency columns (G, H, J, L, N = columns 7, 8, 10, 12, 14)
  const currencyCols = [7, 8, 10, 12, 14];
  currencyCols.forEach(col => {
    sheet.getRange(rowIndex, col).setNumberFormat('$#,##0.00');
  });

  // Format percentage columns (I, K, M = columns 9, 11, 13)
  const percentCols = [9, 11, 13];
  percentCols.forEach(col => {
    sheet.getRange(rowIndex, col).setNumberFormat('0.00"%"');
  });

  // Format date column (D = column 4)
  sheet.getRange(rowIndex, 4).setNumberFormat('yyyy-mm-dd');
}
