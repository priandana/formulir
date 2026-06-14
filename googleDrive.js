/**
 * googleDrive.js
 * Helper module untuk upload file ke Google Drive menggunakan Service Account.
 *
 * Setup:
 * 1. Aktifkan Google Drive API di https://console.cloud.google.com (project yang sama dengan Sheets)
 * 2. Buat folder di Google Drive → share ke service account email sebagai Editor
 * 3. Salin Folder ID dari URL Drive → masukkan ke .env sebagai GOOGLE_DRIVE_FOLDER_ID
 *
 * Menggunakan service account yang sama dengan googleSheets.js
 */

require('dotenv').config();
const { google } = require('googleapis');
const { Readable } = require('stream');

// ===== Konfigurasi =====
const FOLDER_ID            = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY           = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');

/**
 * Cek apakah konfigurasi Google Drive sudah lengkap
 */
function isConfigured() {
  return !!(FOLDER_ID && SERVICE_ACCOUNT_EMAIL && PRIVATE_KEY);
}

/**
 * Buat Google Drive auth client menggunakan Service Account
 */
function getAuthClient() {
  if (!isConfigured()) {
    throw new Error('Google Drive belum dikonfigurasi. Tambahkan GOOGLE_DRIVE_FOLDER_ID ke .env');
  }
  const auth = new google.auth.JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    key: PRIVATE_KEY,
    scopes: [
      'https://www.googleapis.com/auth/drive',  // full access agar bisa upload ke folder shared
    ],
  });
  return auth;
}

/**
 * Convert Buffer ke Readable Stream (diperlukan oleh Drive API)
 */
function bufferToStream(buffer) {
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
}

/**
 * Upload file ke Google Drive
 * @param {string} filename         - Nama file yang akan disimpan di Drive
 * @param {Buffer} buffer           - Buffer isi file
 * @param {string} mimeType         - MIME type file (misal: 'image/jpeg')
 * @returns {{ fileId, viewLink, downloadLink }}
 */
async function uploadFileToDrive(filename, buffer, mimeType) {
  const auth = getAuthClient();
  await auth.authorize();

  const drive = google.drive({ version: 'v3', auth });

  // Upload file ke folder Drive
  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: filename,
      parents: [FOLDER_ID],
      mimeType: mimeType,
    },
    media: {
      mimeType: mimeType,
      body: bufferToStream(buffer),
    },
    fields: 'id, name, webViewLink, webContentLink',
  });

  const fileId = response.data.id;

  // Set permission: siapapun bisa lihat (anyone with link)
  await drive.permissions.create({
    fileId: fileId,
    supportsAllDrives: true,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  const viewLink = `https://drive.google.com/file/d/${fileId}/view`;
  const downloadLink = `https://drive.google.com/uc?export=download&id=${fileId}`;

  console.log(`[GoogleDrive] Uploaded: ${filename} → ${viewLink}`);

  return { fileId, viewLink, downloadLink };
}

/**
 * Hapus file dari Google Drive berdasarkan fileId
 * File ID bisa diekstrak dari viewLink: .../file/d/<fileId>/view
 * @param {string} fileId
 */
async function deleteFileFromDrive(fileId) {
  if (!fileId) return;
  try {
    const auth = getAuthClient();
    await auth.authorize();
    const drive = google.drive({ version: 'v3', auth });
    await drive.files.delete({ fileId });
    console.log(`[GoogleDrive] Deleted fileId: ${fileId}`);
  } catch (err) {
    // Jangan throw — jika file sudah tidak ada, tidak perlu error
    console.error(`[GoogleDrive] Gagal hapus fileId ${fileId}:`, err.message);
  }
}

/**
 * Ekstrak fileId dari Google Drive view link
 * Format: https://drive.google.com/file/d/<fileId>/view
 */
function extractFileId(viewLink) {
  if (!viewLink) return null;
  const match = viewLink.match(/\/file\/d\/([^/]+)/);
  return match ? match[1] : null;
}

module.exports = {
  isConfigured,
  uploadFileToDrive,
  deleteFileFromDrive,
  extractFileId,
};
