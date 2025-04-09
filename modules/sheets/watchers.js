const sheetsClient = require('./client');
const notificationService = require('../../services/notification');

// Initialize the sheet watcher
async function initialize() {
  try {
    console.log('Initializing Google Sheets watcher...');
    
    // Start polling for changes
    await startPolling();
    
    console.log('Google Sheets watcher initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Google Sheets watcher:', error);
    throw error;
  }
}

// Start polling for changes
async function startPolling() {
  try {
    console.log('Starting sheet polling...');
    
    let lastCheckTime = new Date();
    
    // Check for changes every minute
    setInterval(async () => {
      try {
        await checkForChanges(lastCheckTime);
        lastCheckTime = new Date();
      } catch (error) {
        console.error('Error during sheet polling:', error);
      }
    }, 60000); // 1 minute
    
    console.log('Sheet polling started');
  } catch (error) {
    console.error('Failed to start sheet polling:', error);
    throw error;
  }
}

// Check for changes since the last check
async function checkForChanges(lastCheckTime) {
  try {
    const doc = sheetsClient.getDoc();
    const sheet = doc.sheetsByTitle['Requests'];
    
    // Reload the sheet to get fresh data
    await sheet.loadCells();
    const rows = await sheet.getRows();
    
    // Find rows that were updated since the last check
    for (const row of rows) {
      const lastUpdated = new Date(row.lastUpdated);
      
      // Skip rows that haven't been updated since our last check
      if (lastUpdated <= lastCheckTime) {
        continue;
      }
      
      console.log(`Found updated row: ${row.ticketNumber}, status: ${row.status}`);
      
      // Process the updated row based on its status
      await processUpdatedRow(row);
    }
  } catch (error) {
    console.error('Error checking for sheet changes:', error);
    throw error;
  }
}

// Process an updated row
async function processUpdatedRow(row) {
  try {
    // Handle different statuses
    switch (row.status) {
      case 'PENDING_APPROVAL_1':
        // New request - check if Kadep has been notified
        if (row.kadepNotified !== 'YES') {
          await notificationService.notifyKadep({
            ticketNumber: row.ticketNumber,
            request: row.request,
            senderNumber: row.senderNumber
          });
          
          // Mark as notified
          row.kadepNotified = 'YES';
          await row.save();
        }
        break;
      
      case 'PENDING_APPROVAL_2':
        // Kadep approved - check if Bendahara has been notified
        if (row.bendaharaNotified !== 'YES') {
          await notificationService.notifyBendahara({
            ticketNumber: row.ticketNumber,
            request: row.request,
            senderNumber: row.senderNumber
          });
          
          // Mark as notified
          row.bendaharaNotified = 'YES';
          await row.save();
        }
        break;
      
      case 'APPROVED':
      case 'REJECTED_1':
      case 'REJECTED_2':
        // Status changed to final state - check if requester has been notified
        if (row.requesterNotified !== 'YES') {
          await notificationService.notifyRequester({
            ticketNumber: row.ticketNumber,
            status: row.status,
            request: row.request,
            reasonKadep: row.reasonKadep,
            reasonBendahara: row.reasonBendahara,
            senderNumber: row.senderNumber
          });
          
          // Mark as notified
          row.requesterNotified = 'YES';
          await row.save();
        }
        break;
    }
  } catch (error) {
    console.error(`Error processing updated row for ticket ${row.ticketNumber}:`, error);
  }
}

module.exports = {
  initialize
};