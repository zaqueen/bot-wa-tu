const ticketingService = require('../../services/ticketing');
const mqttClient = require('../mqtt/client');
const sheetsOperations = require('../sheets/operations');

// Command prefixes
const COMMANDS = {
  REQUEST: '/request',
  CHECK: '/cek',
  HELP: '/help'
};

const userStates = {}; // Menyimpan state pengguna berdasarkan nomor pengirim

async function handleMessage(client, msg) {
  const senderNumber = msg.from.replace('@c.us', '');
  const messageBody = msg.body.trim();

  // Jika pengguna mengirim /request
  if (messageBody === COMMANDS.REQUEST) {
    // Mulai alur baru dengan format baris
    userStates[senderNumber] = { step: 'waitingForCompleteData' };
    await msg.reply(
      'Silahkan masukkan keterangan barang yang ingin diajukan dengan format:\n\n' +
      'Nama Lengkap:\nNama Barang:\nJumlah:\nLink:\nAlasan:\n\n' +
      'Contoh:\nNama Lengkap: John Doe\nNama Barang: Proyektor\nJumlah: 1 unit\nLink: https://tokopedia.com/link-proyektor\nAlasan: Untuk presentasi di ruang rapat'
    );
    return;
  }

  // Jika pengguna sedang dalam alur pembuatan request
  if (userStates[senderNumber] && userStates[senderNumber].step === 'waitingForCompleteData') {
    // Parse format baris
    const inputLines = messageBody.split('\n');
    const requestData = {};
    
    // Ekstrak data dari tiap baris
    for (const line of inputLines) {
      if (line.startsWith('Nama Lengkap:')) {
        requestData.senderName = line.replace('Nama Lengkap:', '').trim();
      } else if (line.startsWith('Nama Barang:')) {
        requestData.goodsName = line.replace('Nama Barang:', '').trim();
      } else if (line.startsWith('Jumlah:')) {
        requestData.quantity = line.replace('Jumlah:', '').trim();
      } else if (line.startsWith('Link:')) {
        requestData.link = line.replace('Link:', '').trim();
      } else if (line.startsWith('Alasan:')) {
        requestData.reason = line.replace('Alasan:', '').trim();
      }
    }
    
    // Validasi data
    const requiredFields = ['senderName', 'goodsName', 'quantity', 'link', 'reason'];
    const missingFields = requiredFields.filter(field => !requestData[field]);
    
    if (missingFields.length > 0) {
      await msg.reply(
        '❌ Format data tidak lengkap. Pastikan Anda memasukkan semua informasi yang dibutuhkan.\n\n' +
        'Format:\nNama Lengkap:\nNama Barang:\nJumlah:\nLink:\nAlasan:\n\n' +
        'Contoh:\nNama Lengkap: John Doe\nNama Barang: Proyektor\nJumlah: 1 unit\nLink: https://tokopedia.com/link-proyektor\nAlasan: Untuk presentasi di ruang rapat'
      );
      return;
    }

    // Generate ticket number
    const ticketNumber = ticketingService.generateTicket();

    // Simpan data ke Google Sheets
    await sheetsOperations.addNewRequest({
      ticketNumber,
      senderNumber,
      senderName: requestData.senderName,
      timestamp: new Date().toISOString(),
      goodsName: requestData.goodsName,
      quantity: requestData.quantity,
      link: requestData.link,
      reason: requestData.reason,
      status: 'PENDING_APPROVAL_1',
      approvalKadep: null,
      statusBendahara: null,
      reasonKadep: null,
      reasonBendahara: null,
      lastUpdated: new Date().toISOString()
    });

    // Kirim notifikasi ke Kadep
    await notifyKadep(ticketNumber, requestData.goodsName, requestData.quantity, 
                     requestData.reason, requestData.link, senderNumber, requestData.senderName);

    // Beri tahu pengguna
    await msg.reply(
      `✅ Permintaan Anda telah diterima!\n\n*Nomor Tiket: ${ticketNumber}*\n\nGunakan nomor tiket ini untuk memeriksa status permintaan Anda. Ketik *${COMMANDS.CHECK} ${ticketNumber}* atau cukup ketik *${ticketNumber}* untuk memeriksa status.`
    );

    // Hapus state pengguna setelah selesai
    delete userStates[senderNumber];
    return;
  }

  // Handle approval/rejection dari Kadep (format: "1 123" atau "2 123 Alasan")
  if (senderNumber === process.env.KADEP_NUMBER && /^[12]\s\d+/.test(messageBody)) {
    const parts = messageBody.split(' ');
    const action = parts[0]; // 1 atau 2
    const ticketNumber = parts[1];
    const reason = parts.slice(2).join(' ');

    if (action === '1') {
      // Handle approval
      const updates = {
        status: 'PENDING_PROCESS',
        approvalKadep: 'APPROVED',
        lastUpdated: new Date().toISOString()
      };
      
      await sheetsOperations.updateTicketStatus(ticketNumber, updates);
      await msg.reply(`✅ Anda telah menyetujui permintaan *${ticketNumber}*`);
      
      // Notify Bendahara
      const ticketData = await sheetsOperations.getTicketData(ticketNumber);
      await notifyBendaharaForProcessing(ticketNumber, ticketData);
      
    } else if (action === '2') {
      // Handle rejection
      if (!reason) {
        userStates[senderNumber] = { step: 'waitingForRejectionReason', ticketNumber };
        await msg.reply(`Silakan berikan alasan penolakan untuk tiket *${ticketNumber}*:`);
        return;
      }
      
      const updates = {
        status: 'REJECTED',
        approvalKadep: 'REJECTED',
        reasonKadep: reason,
        lastUpdated: new Date().toISOString()
      };
      
      await sheetsOperations.updateTicketStatus(ticketNumber, updates);
      await msg.reply(`❌ Anda telah menolak permintaan *${ticketNumber}* dengan alasan: ${reason}`);
      
      // Notify requester
      const ticketData = await sheetsOperations.getTicketData(ticketNumber);
      await notifyRequesterRejected(
        ticketNumber, 
        `${ticketData.goodsName} (${ticketData.quantity})`, 
        ticketData.senderNumber, 
        reason
      );
    }
    return;
  }

  // Handle status update dari Bendahara (format: "1 123" atau "2 123 Alasan" atau "3 123 Alasan")
  if (senderNumber === process.env.BENDAHARA_NUMBER && /^[123]\s\d+/.test(messageBody)) {
    const parts = messageBody.split(' ');
    const statusCode = parts[0]; // 1, 2, atau 3
    const ticketNumber = parts[1];
    const reason = parts.slice(2).join(' ') || (statusCode === '1' ? 'Belum diproses' : 
                                              statusCode === '2' ? 'Sedang diproses' : 'Sudah diproses');

    // Determine status
    let status;
    switch (statusCode) {
      case '1': status = 'NOT_PROCESSED'; break;
      case '2': status = 'IN_PROGRESS'; break;
      case '3': status = 'PROCESSED'; break;
    }

    // Update sheet
    const updates = {
      statusBendahara: status,
      reasonBendahara: reason,
      lastUpdated: new Date().toISOString()
    };
    
    await sheetsOperations.updateTicketStatus(ticketNumber, updates);
    await msg.reply(`✅ Status permintaan *${ticketNumber}* diupdate menjadi: *${status}*\nAlasan: ${reason}`);
    
    // Jika status PROCESSED, beri tahu pemohon
    if (status === 'PROCESSED') {
      const ticketData = await sheetsOperations.getTicketData(ticketNumber);
      await notifyRequesterProcessed(
        ticketNumber,
        `${ticketData.goodsName} (${ticketData.quantity})`,
        ticketData.senderNumber,
        reason
      );
    }
    return;
  }

  // Handle pengguna sedang menunggu alasan penolakan
  if (userStates[senderNumber] && userStates[senderNumber].step === 'waitingForRejectionReason') {
    const reason = messageBody;
    const ticketNumber = userStates[senderNumber].ticketNumber;
    
    const updates = {
      status: 'REJECTED',
      approvalKadep: 'REJECTED',
      reasonKadep: reason,
      lastUpdated: new Date().toISOString()
    };
    
    await sheetsOperations.updateTicketStatus(ticketNumber, updates);
    await msg.reply(`❌ Permintaan *${ticketNumber}* ditolak dengan alasan: ${reason}`);
    
    // Notify requester
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    await notifyRequesterRejected(
      ticketNumber, 
      `${ticketData.goodsName} (${ticketData.quantity})`, 
      ticketData.senderNumber, 
      reason
    );
    
    delete userStates[senderNumber];
    return;
  }

  // Handle check command (/cek)
  if (messageBody.startsWith(COMMANDS.CHECK)) {
    await handleCheckCommand(client, msg, senderNumber, messageBody);
    return;
  }

  // Handle help command (/help)
  if (messageBody.startsWith(COMMANDS.HELP)) {
    await handleHelpCommand(client, msg);
    return;
  }

  // Handle ticket number check (123)
  if (/^\d+$/.test(messageBody)) {
    await handleTicketCheck(client, msg, messageBody);
    return;
  }
}

// Handle approval
async function handleApproval(client, msg, senderNumber, messageBody) {
  try {
    const parts = messageBody.split(' ');
    const actionCode = parts[0];
    const ticketNumber = parts[1];
    const reason = parts.slice(2).join(' ');

    // Check if user is Kadep
    const isKadep = senderNumber === process.env.KADEP_NUMBER;
    
    if (!isKadep) {
      await msg.reply('❌ Anda tidak memiliki izin untuk menyetujui/menolak permintaan.');
      return;
    }

    // Get ticket data
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    if (!ticketData) {
      await msg.reply(`❌ Tiket *${ticketNumber}* tidak ditemukan.`);
      return;
    }

    let updates = {};
    let replyMessage = '';
    
    if (actionCode === '1' && ticketData.status === 'PENDING_APPROVAL_1') {
      // Approval
      updates = {
        status: 'PENDING_PROCESS',
        approvalKadep: 'APPROVED',
        lastUpdated: new Date().toISOString()
      };
      replyMessage = `✅ Anda telah menyetujui permintaan *${ticketNumber}*.\nPermintaan telah diteruskan ke Bendahara.`;
      
      await sheetsOperations.updateTicketStatus(ticketNumber, updates);
      await notifyBendaharaForProcessing(ticketNumber, ticketData);
      
    } else if (actionCode === '2' && ticketData.status === 'PENDING_APPROVAL_1') {
      // Rejection
      if (!reason) {
        userStates[senderNumber] = { step: 'waitingForRejectionReason', ticketNumber };
        await msg.reply(`Silakan berikan alasan penolakan untuk tiket *${ticketNumber}*:`);
        return;
      }
      
      updates = {
        status: 'REJECTED',
        approvalKadep: 'REJECTED',
        reasonKadep: reason,
        lastUpdated: new Date().toISOString()
      };
      replyMessage = `❌ Anda telah menolak permintaan *${ticketNumber}* dengan alasan: ${reason}`;
      
      await sheetsOperations.updateTicketStatus(ticketNumber, updates);
      await notifyRequesterRejected(ticketNumber, ticketData, reason);
      
    } else {
      replyMessage = `❌ Tidak dapat memproses tiket *${ticketNumber}* dengan status saat ini (*${ticketData.status}*).`;
    }
    
    await msg.reply(replyMessage);
    
  } catch (error) {
    console.error('Error handling approval:', error);
    await msg.reply('Terjadi kesalahan. Gunakan format:\n*1 123* (setuju)\n*2 123 [alasan]* (tolak)');
  }
}

// Handle rejection
async function handleRejection(client, msg, senderNumber, ticketNumber, reason) {
  try {
    console.log(`Handling rejection for ticket ${ticketNumber} by ${senderNumber}`);
    
    // Check if user is kadep
    const isKadep = senderNumber === process.env.KADEP_NUMBER;
    
    if (!isKadep) {
      await msg.reply('❌ Anda tidak memiliki izin untuk menolak permintaan.');
      return;
    }
    
    // Get ticket data
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    
    if (!ticketData) {
      await msg.reply(`❌ Tiket *${ticketNumber}* tidak ditemukan.`);
      return;
    }
    
    // Handle rejection
    let updates = {};
    let replyMessage = '';
    
    if (isKadep && ticketData.status === 'PENDING_APPROVAL_1') {
      updates = {
        status: 'REJECTED',
        approvalKadep: 'REJECTED',
        reasonKadep: reason,
        lastUpdated: new Date().toISOString()
      };
      
      replyMessage = `❌ Anda telah menolak permintaan *${ticketNumber}* dengan alasan: ${reason}`;
      
      // Update ticket status
      await sheetsOperations.updateTicketStatus(ticketNumber, updates);
      
      // Notify requester that their request was rejected by Kadep
      const requestDetails = ticketData.goodsName 
        ? `${ticketData.goodsName} (${ticketData.quantity})`
        : ticketData.request;
        
      await notifyRequesterRejected(ticketNumber, requestDetails, ticketData.senderNumber, reason);
    } else {
      // Status tidak sesuai
      replyMessage = `❌ Tidak dapat menolak tiket *${ticketNumber}* dengan status saat ini (*${ticketData.status}*).`;
    }
    
    // Kirim balasan
    await msg.reply(replyMessage);
    
  } catch (error) {
    console.error('Error handling rejection:', error);
    await msg.reply('Terjadi kesalahan saat memproses penolakan. Silakan coba lagi nanti.');
  }
}

// Handle Bendahara status update
async function handleBendaharaStatusUpdate(client, msg, senderNumber, messageBody) {
  try {
    const parts = messageBody.split(' ');
    const statusCode = parts[0];
    const ticketNumber = parts[1];
    const reason = parts.slice(2).join(' ') || ''; // Default empty string if no reason provided

    // Check if user is Bendahara
    const isBendahara = senderNumber === process.env.BENDAHARA_NUMBER;
    
    if (!isBendahara) {
      await msg.reply('❌ Anda tidak memiliki izin untuk mengupdate status permintaan.');
      return;
    }

    // Get ticket data
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    
    if (!ticketData) {
      await msg.reply(`❌ Tiket *${ticketNumber}* tidak ditemukan.`);
      return;
    }

    // Determine status based on code
    let status = '';
    let statusMessage = '';
    
    switch (statusCode) {
      case '1':
        status = 'NOT_PROCESSED';
        statusMessage = 'Belum diproses';
        break;
      case '2':
        status = 'IN_PROGRESS';
        statusMessage = 'Sedang diproses';
        break;
      case '3':
        status = 'PROCESSED';
        statusMessage = 'Sudah diproses';
        break;
      default:
        await msg.reply('❌ Kode status tidak valid. Gunakan format:\n*1 123* (belum diproses)\n*2 123 [alasan]* (sedang diproses)\n*3 123 [alasan]* (sudah diproses)');
        return;
    }

    // Update ticket status - both statusBendahara and reasonBendahara
    const updates = {
      statusBendahara: status,
      reasonBendahara: reason || statusMessage, // Use provided reason or default status message
      lastUpdated: new Date().toISOString()
    };
    
    await sheetsOperations.updateTicketStatus(ticketNumber, updates);
    
    // Send confirmation
    await msg.reply(`✅ Status permintaan *${ticketNumber}* telah diupdate menjadi: *${statusMessage}*\nAlasan: ${updates.reasonBendahara}`);
    
    // Notify requester if status is PROCESSED
    if (status === 'PROCESSED') {
      const requestDetails = `${ticketData.goodsName} (${ticketData.quantity})`;
      await notifyRequesterProcessed(ticketNumber, requestDetails, ticketData.senderNumber, updates.reasonBendahara);
    }
    
  } catch (error) {
    console.error('Error handling Bendahara status update:', error);
    await msg.reply('Terjadi kesalahan. Gunakan format:\n*1 123* (belum diproses)\n*2 123 [alasan]* (sedang diproses)\n*3 123 [alasan]* (sudah diproses)');
  }
}
  

// Handle check command
async function handleCheckCommand(client, msg, senderNumber, messageBody) {
  try {
    // Parse the ticket number
    // Format: /cek 123
    const parts = messageBody.split(' ');
    if (parts.length !== 2) {
      await msg.reply(
        `Format cek tidak valid. Gunakan format:\n*${COMMANDS.CHECK} [nomor_tiket]*\n\nContoh:\n*${COMMANDS.CHECK} 123*`
      );
      return;
    }

    const ticketNumber = parts[1].trim();
    await handleTicketCheck(client, msg, ticketNumber);
    
  } catch (error) {
    console.error('Error handling check command:', error);
    await msg.reply('Terjadi kesalahan saat memeriksa status tiket. Silakan coba lagi nanti.');
  }
}

// Handle ticket check
async function handleTicketCheck(client, msg, ticketNumber) {
  try {
    // Check if ticket exists and get its status
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    
    if (!ticketData) {
      await msg.reply(`❌ Tiket *${ticketNumber}* tidak ditemukan. Periksa kembali nomor tiket Anda.`);
      return;
    }
    
    // Format the status message based on the ticket's status
    let statusMessage = `📋 *Status Tiket: ${ticketNumber}*\n\n`;
    
    // Tampilkan detail permintaan
    statusMessage += `Pemohon: ${ticketData.senderName}\n`;
    statusMessage += `Permintaan: ${ticketData.goodsName}\n`;
    statusMessage += `Jumlah: ${ticketData.quantity}\n`;
    if (ticketData.link) statusMessage += `Link: ${ticketData.link}\n`;
    statusMessage += `Alasan: ${ticketData.reason}\n`;
    statusMessage += `Tanggal: ${new Date(ticketData.timestamp).toLocaleString('id-ID')}\n\n`;
    
    switch (ticketData.status) {
      case 'PENDING_APPROVAL_1':
        statusMessage += '⏳ Status: Menunggu persetujuan Kepala Departemen';
        break;
      case 'REJECTED':
        statusMessage += `❌ Status: Ditolak oleh Kepala Departemen\nAlasan: ${ticketData.reasonKadep || 'Tidak ada alasan yang diberikan'}`;
        break;
      case 'PENDING_PROCESS':
        statusMessage += '⏳ Status: Disetujui oleh Kepala Departemen, menunggu diproses Bendahara';
        break;
      default:
        statusMessage += '❓ Status: Tidak diketahui';
    }
    
    // Tambahkan status Bendahara jika ada
    if (ticketData.statusBendahara) {
      let bendaharaStatus = '';
      switch (ticketData.statusBendahara) {
        case 'NOT_PROCESSED':
          bendaharaStatus = 'Belum diproses';
          break;
        case 'IN_PROGRESS':
          bendaharaStatus = 'Sedang diproses';
          break;
        case 'PROCESSED':
          bendaharaStatus = 'Sudah diproses';
          break;
        default:
          bendaharaStatus = ticketData.statusBendahara;
      }
      statusMessage += `\nStatus Proses: ${bendaharaStatus}`;
    }
    
    await msg.reply(statusMessage);
    
  } catch (error) {
    console.error('Error handling ticket check:', error);
    await msg.reply('Terjadi kesalahan saat memeriksa status tiket. Silakan coba lagi nanti.');
  }
}

// Handle help command
// Handle help command
async function handleHelpCommand(client, msg) {
  const helpMessage = 
    `🔹 *PANDUAN PENGGUNAAN BOT PENGADAAN BARANG* 🔹\n\n` +
    `Berikut adalah perintah-perintah yang tersedia:\n\n` +
    `1️⃣ *${COMMANDS.REQUEST}*\n` +
    `   Untuk mengajukan permintaan pengadaan barang\n` +
    `   Format:\n` +
    `   Nama Lengkap: [isi nama lengkap]\n` +
    `   Nama Barang: [isi nama barang]\n` +
    `   Jumlah: [isi jumlah barang]\n` +
    `   Link: [isi link barang]\n` +
    `   Alasan: [isi alasan permintaan]\n\n` +
    `2️⃣ *${COMMANDS.CHECK} [nomor_tiket]*\n` +
    `   Untuk memeriksa status permintaan\n` +
    `   Contoh: ${COMMANDS.CHECK} 123\n\n` +
    `3️⃣ *[nomor_tiket]*\n` +
    `   Anda juga dapat langsung mengetikkan nomor tiket untuk memeriksa status\n` +
    `   Contoh: 123\n\n` +
    `4️⃣ *${COMMANDS.HELP}*\n` +
    `   Untuk menampilkan panduan ini\n\n` +
    `ℹ️ Setelah mengajukan permintaan, Anda akan menerima nomor tiket yang dapat digunakan untuk memeriksa status permintaan.`;
    
  await msg.reply(helpMessage);
}

// Function to notify Kadep about new requests
async function notifyKadep(ticketNumber, goodsName, quantity, reason, link, requesterNumber, requesterName) {
  const kadepNumber = process.env.KADEP_NUMBER;
  if (!kadepNumber) return;

  const notificationMessage = 
    `🔔 *PERMINTAAN BARU*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Dari: ${requesterName} (${requesterNumber})\n` +
    `Permintaan: ${goodsName}\n` +
    `Jumlah: ${quantity}\n` +
    `Link: ${link}\n` +
    `Alasan: ${reason}\n\n` +
    `Balas dengan:\n` +
    `*1 ${ticketNumber}* untuk menyetujui\n` +
    `*2 ${ticketNumber} [alasan]* untuk menolak\n\n` +
    `Contoh:\n` +
    `*2 ${ticketNumber} tidak sesuai kebutuhan*`;

  const botModule = require('./bot');
  await botModule.sendMessage(kadepNumber, notificationMessage);
  userStates[kadepNumber] = { ticketNumber };
}

// Updated notification function for Bendahara
async function notifyBendaharaForProcessing(ticketNumber, ticketData) {
  const bendaharaNumber = process.env.BENDAHARA_NUMBER;
  if (!bendaharaNumber) return;

  const notificationMessage = 
    `🔔 *PERMINTAAN UNTUK DIPROSES*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Dari: ${ticketData.senderName} (${ticketData.senderNumber})\n `+
    `Permintaan: ${ticketData.goodsName}\n` +
    `Jumlah: ${ticketData.quantity}\n` +
    `Link: ${ticketData.link || '-'}\n` +
    `Alasan: ${ticketData.reason}\n\n` +
    `Balas dengan:\n\n` +
    `*1 ${ticketNumber}* (belum diproses)\n` +
    `*2 ${ticketNumber} [alasan]* (sedang diproses)\n` +
    `*3 ${ticketNumber} [alasan]* (sudah diproses)\n\n` +
    `Contoh:\n` +
    `*2 ${ticketNumber} sedang dicari vendor terbaik*`;

  const botModule = require('./bot');
  await botModule.sendMessage(bendaharaNumber, notificationMessage);
  userStates[bendaharaNumber] = { ticketNumber };
}

// Function to notify requester about approved request
async function notifyRequesterApproved(ticketNumber, requestData, requesterNumber) {
  const notificationMessage = 
    `✅ *PERMINTAAN ANDA DISETUJUI*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Permintaan: ${requestData}\n\n` +
    `Permintaan Anda telah disetujui oleh Kepala Departemen.\n` +
    `Permintaan Anda akan segera diproses oleh Bendahara.`;

  // Use the bot module to send message
  const botModule = require('./bot');
  await botModule.sendMessage(requesterNumber, notificationMessage);
}

// Function to notify requester about rejected request
async function notifyRequesterRejected(ticketNumber, requestData, requesterNumber, reason) {
  const notificationMessage = 
    `❌ *PERMINTAAN ANDA DITOLAK*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Permintaan: ${requestData}\n\n` +
    `Permintaan Anda ditolak oleh Kepala Departemen dengan alasan:\n` +
    `"${reason}"\n\n` +
    `Jika ada pertanyaan, silakan hubungi Kepala Departemen untuk informasi lebih lanjut.`;

  // Use the bot module to send message
  const botModule = require('./bot');
  await botModule.sendMessage(requesterNumber, notificationMessage);
}

async function notifyRequesterProcessed(ticketNumber, requestData, requesterNumber, reason) {
  const notificationMessage = 
    `✅ *PERMINTAAN ANDA TELAH DIPROSES*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Permintaan: ${requestData}\n\n` +
    `Status: Sudah diproses\n` +
    `Keterangan: ${reason || 'Proses selesai'}`;

  const botModule = require('./bot');
  await botModule.sendMessage(requesterNumber, notificationMessage);
}

module.exports = {
  handleMessage
};
