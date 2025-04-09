const dotenv = require('dotenv');
dotenv.config();

// Import modules
const whatsappBot = require('./modules/whatsapp/bot');
const mqttClient = require('./modules/mqtt/client');
const sheetsClient = require('./modules/sheets/client');

// Start WhatsApp Bot
whatsappBot.initialize();

// Connect to MQTT broker
mqttClient.connect();

// Initialize Google Sheets connection
sheetsClient.initialize();

console.log('Sistem Pengadaan Barang dimulai...');

// Handle process termination
process.on('SIGINT', async () => {
  console.log('Menutup aplikasi...');
  await whatsappBot.shutdown();
  mqttClient.disconnect();
  process.exit(0);
});