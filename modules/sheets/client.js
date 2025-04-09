const { GoogleSpreadsheet } = require('google-spreadsheet');
const dotenv = require('dotenv');
const { GoogleAuth } = require('google-auth-library');

dotenv.config();

let doc;

// Initialize Google Sheets connection
async function initialize() {
  try {
    doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID);
    
    // Authenticate with Google
    const auth = new GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    
      doc.auth = auth;
    
    // Load document properties and sheets
    await doc.loadInfo();
    console.log(`Terhubung ke Google Sheets: ${doc.title}`);
    
    // Ensure required sheets exist
    await ensureRequiredSheets();
    
    return doc;
  } catch (error) {
    console.error('Gagal menginisialisasi Google Sheets:', error);
    throw error;
  }
}

// Ensure all required sheets exist
async function ensureRequiredSheets() {
  try {
    // Check if "Requests" sheet exists
    let requestSheet = doc.sheetsByTitle['Requests'];
    
    // If not, create it
    if (!requestSheet) {
      console.log('Membuat sheet "Requests"...');
      requestSheet = await doc.addSheet({
        title: 'Requests',
        headerValues: [
          'ticketNumber',
          'timestamp',
          'senderNumber',
          'request',
          'status',
          'approvalKadep',
          'statusBendahara',
          'reasonKadep',
          'reasonBendahara',
          'lastUpdated'
        ]
      });
    }
    
    console.log('Sheet "Requests" tersedia');
    return true;
  } catch (error) {
    console.error('Gagal memastikan sheet tersedia:', error);
    throw error;
  }
}

// Get the Google Spreadsheet instance
function getDoc() {
  if (!doc) {
    throw new Error('Google Sheets belum diinisialisasi. Panggil initialize() terlebih dahulu.');
  }
  return doc;
}

module.exports = {
  initialize,
  getDoc
};