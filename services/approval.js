const sheetsOperations = require('../modules/sheets/operations');
const mqttClient = require('../modules/mqtt/client');

// Process approval from Kadep
async function processKadepApproval(ticketNumber, approved, reason = null) {
  try {
    // Get current ticket data
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    
    if (!ticketData) {
      console.error(`Tiket tidak ditemukan: ${ticketNumber}`);
      return {
        success: false,
        message: `Tiket ${ticketNumber} tidak ditemukan`
      };
    }
    
    // Check if ticket is in the correct state
    if (ticketData.status !== 'PENDING_APPROVAL_1') {
      console.error(`Status tiket tidak valid untuk persetujuan Kadep: ${ticketData.status}`);
      return {
        success: false,
        message: `Tiket ini tidak sedang menunggu persetujuan Kadep. Status saat ini: ${ticketData.status}`
      };
    }
    
    // Prepare updates
    const updates = {
      approvalKadep: approved ? 'APPROVED' : 'REJECTED',
      status: approved ? 'PENDING_APPROVAL_2' : 'REJECTED_1'
    };
    
    // Add reason if provided
    if (reason) {
      updates.reasonKadep = reason;
    }
    
    // Update ticket in Google Sheets
    await sheetsOperations.updateTicketStatus(ticketNumber, updates);
    
    // Publish to MQTT
    mqttClient.publishNotification({
      type: 'APPROVAL_1_UPDATED',
      ticketNumber,
      approved,
      reason
    });
    
    return {
      success: true,
      message: `Tiket ${ticketNumber} telah ${approved ? 'disetujui' : 'ditolak'} oleh Kadep`
    };
  } catch (error) {
    console.error('Gagal memproses persetujuan Kadep:', error);
    return {
      success: false,
      message: 'Terjadi kesalahan saat memproses persetujuan'
    };
  }
}

// Process approval from Bendahara
async function processBendaharaApproval(ticketNumber, approved, reason = null) {
  try {
    // Get current ticket data
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    
    if (!ticketData) {
      console.error(`Tiket tidak ditemukan: ${ticketNumber}`);
      return {
        success: false,
        message: `Tiket ${ticketNumber} tidak ditemukan`
      };
    }
    
    // Check if ticket is in the correct state
    if (ticketData.status !== 'PENDING_APPROVAL_2') {
      console.error(`Status tiket tidak valid untuk persetujuan Bendahara: ${ticketData.status}`);
      return {
        success: false,
        message: `Tiket ini tidak sedang menunggu persetujuan Bendahara. Status saat ini: ${ticketData.status}`
      };
    }
    
    // Prepare updates
    const updates = {
      statusBendahara: approved ? 'APPROVED' : 'REJECTED',
      status: approved ? 'APPROVED' : 'REJECTED_2'
    };
    
    // Add reason if provided
    if (reason) {
      updates.reasonBendahara = reason;
    }
    
    // Update ticket in Google Sheets
    await sheetsOperations.updateTicketStatus(ticketNumber, updates);
    
    // Publish to MQTT
    mqttClient.publishNotification({
      type: 'APPROVAL_2_UPDATED',
      ticketNumber,
      approved,
      reason
    });
    
    return {
      success: true,
      message: `Tiket ${ticketNumber} telah ${approved ? 'disetujui' : 'ditolak'} oleh Bendahara`
    };
  } catch (error) {
    console.error('Gagal memproses persetujuan Bendahara:', error);
    return {
      success: false,
      message: 'Terjadi kesalahan saat memproses persetujuan'
    };
  }
}

module.exports = {
  processKadepApproval,
  processBendaharaApproval
};