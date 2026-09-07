/**
 * Google Apps Script - CRM to Sheets Sync (UPSERT)
 *
 * This script handles job syncing from CRM to Google Sheets.
 * UPSERT = Update existing row if jobId found, otherwise insert new row.
 *
 * Setup:
 * 1. Open your Google Sheet
 * 2. Extensions > Apps Script
 * 3. Replace existing code with this
 * 4. Deploy > New deployment > Web app
 * 5. Set "Execute as: Me" and "Who has access: Anyone"
 * 6. Copy deployment URL to CRM Settings > Apps Script URL
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Jobs');
  if (!sheet) {
    return { success: false, error: 'Sheet "Jobs" not found' };
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // Find jobId column (should be first column)
  const jobIdColIndex = headers.indexOf('jobId');
  if (jobIdColIndex === -1) {
    return { success: false, error: 'jobId column not found in headers' };
  }

  // Search for existing row with this jobId
  let existingRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][jobIdColIndex] === job.jobId) {
      existingRowIndex = i + 1; // +1 because sheet rows are 1-indexed
      break;
    }
  }

  // Build row data from job object in same order as headers
  const rowData = headers.map(header => {
    const value = job[header];
    return value !== undefined ? value : '';
  });

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
    return {
      success: true,
      action: 'inserted',
      row: sheet.getLastRow(),
      jobId: job.jobId
    };
  }
}

/**
 * SHEET STRUCTURE (First row = headers):
 *
 * jobId | createdAt | updatedAt | status | customerName | phone | address |
 * city | state | zip | scheduledDate | scheduledTime | description | notes |
 * source | contractorName | contractorPct | assignedTechId | assignedTechName |
 * isSelfAssigned | techPercent | estimatedTotal | jobTotal | partsCost |
 * taxAmount | techPayout | ownerPayout | contractorFee | paymentMethod |
 * paidAt | zelleMemo | isRecurring | photoCount
 *
 * IMPORTANT: Column names must match exactly (case-sensitive)
 */
