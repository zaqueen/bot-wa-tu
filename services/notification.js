const whatsappBot = require('../modules/whatsapp/bot');
const dotenv = require('dotenv');

dotenv.config();

// Notify Kepala Departemen about a new request
async function notifyKadep(data) {
  try {
    const kadepNumber = process.env.KADEP_NUMBER;
    if (!kadepNumber) {
      console.error('Nomor Kepala Departemen tidak dikonfigurasi di .env');
      return false;
    }

    const message = 
      `🔔 *NOTIFIKASI PERMINTAAN BARU*\n\n` +
      `Nomor Tiket: *${data.ticketNumber}*\n` +
      `Dari: ${data.senderNumber}\n` +
      `Permintaan: ${data.request}\n\n` +
      `Untuk menyetujui, balas dengan:\n` +
      `*APPROVE ${data.ticketNumber}*\n\n` +
      `Untuk menolak, balas dengan:\n` +
      `*REJECT ${data.ticketNumber} [alasan]*`;

    const result = await whatsappBot.sendMessage(kadepNumber, message);
    
    if (result) {
      console.log(`Notifikasi terkirim ke Kepala Departemen: ${data.ticketNumber}`);
    }
    
    return result;
  } catch (error) {
    console.error('Gagal mengirim notifikasi ke Kepala Departemen:', error);
    return false;
  }
}

// Notify Bendahara about an approved request (by Kadep)
async function notifyBendahara(data) {
  try {
    const bendaharaNumber = process.env.BENDAHARA_NUMBER;
    if (!bendaharaNumber) {
      console.error('Nomor Bendahara tidak dikonfigurasi di .env');
      return false;
    }

    const message = 
      `🔔 *NOTIFIKASI PERMINTAAN (DISETUJUI KADEP)*\n\n` +
      `Nomor Tiket: *${data.ticketNumber}*\n` +
      `Dari: ${data.senderNumber}\n` +
      `Permintaan: ${data.request}\n\n` +
      `Kepala Departemen telah MENYETUJUI permintaan ini.\n\n` +
      `Untuk menyetujui, balas dengan:\n` +
      `*APPROVE ${data.ticketNumber}*\n\n` +
      `Untuk menolak, balas dengan:\n` +
      `*REJECT ${data.ticketNumber} [alasan]*`;

    const result = await whatsappBot.sendMessage(bendaharaNumber, message);
    
    if (result) {
      console.log(`Notifikasi terkirim ke Bendahara: ${data.ticketNumber}`);
    }
    
    return result;
  } catch (error) {
    console.error('Gagal mengirim notifikasi ke Bendahara:', error);
    return false;
  }
}

// Notify requester about status updates
async function notifyRequester(data) {
  try {
    if (!data.senderNumber) {
      console.error('Nomor pengirim tidak ada dalam data');
      return false;
    }

    let message = '';
    
    // Determine message based on status
    if (data.status === 'APPROVED' || data.approved === true) {
      message = 
        `✅ *PERMINTAAN DISETUJUI*\n\n` +
        `Nomor Tiket: *${data.ticketNumber}*\n` +
        `Permintaan: ${data.request}\n\n` +
        `Permintaan Anda telah DISETUJUI oleh Kepala Departemen dan Bendahara.\n` +
        `Silakan hubungi Tata Usaha untuk proses selanjutnya.`;
    } else if (data.status === 'REJECTED_1' || (data.approved === false && data.type === 'APPROVAL_1_UPDATED')) {
      message = 
        `❌ *PERMINTAAN DITOLAK*\n\n` +
        `Nomor Tiket: *${data.ticketNumber}*\n` +
        `Permintaan: ${data.request}\n\n` +
        `Permintaan Anda DITOLAK oleh Kepala Departemen.\n` +
        `Alasan: ${data.reasonKadep || data.reason || 'Tidak ada alasan yang diberikan'}`;
    } else if (data.status === 'REJECTED_2' || (data.approved === false && data.type === 'APPROVAL_2_UPDATED')) {
      message = 
        `❌ *PERMINTAAN DITOLAK*\n\n` +
        `Nomor Tiket: *${data.ticketNumber}*\n` +
        `Permintaan: ${data.request}\n\n` +
        `Permintaan Anda DITOLAK oleh Bendahara.\n` +
        `Alasan: ${data.reasonBendahara || data.reason || 'Tidak ada alasan yang diberikan'}`;
    } else {
      message = 
        `ℹ️ *UPDATE STATUS PERMINTAAN*\n\n` +
        `Nomor Tiket: *${data.ticketNumber}*\n` +
        `Permintaan: ${data.request}\n\n` +
        `Status permintaan Anda telah diperbarui. Ketik *${data.ticketNumber}* untuk melihat status terbaru.`;
    }

    const result = await whatsappBot.sendMessage(data.senderNumber, message);
    
    if (result) {
      console.log(`Notifikasi terkirim ke Pemohon: ${data.ticketNumber}`);
    }
    
    return result;
  } catch (error) {
    console.error('Gagal mengirim notifikasi ke Pemohon:', error);
    return false;
  }
}

module.exports = {
  notifyKadep,
  notifyBendahara,
  notifyRequester
};