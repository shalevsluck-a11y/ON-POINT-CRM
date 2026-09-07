function doPost(e) {
  return ContentService.createTextOutput(JSON.stringify({ success: true, test: 'working' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ success: true, test: 'working' }))
    .setMimeType(ContentService.MimeType.JSON);
}
