/**
 * googleSheets.js
 * Helper module untuk integrasi Google Sheets menggunakan Service Account.
 *
 * Setup:
 * 1. Buat project di https://console.cloud.google.com
 * 2. Aktifkan Google Sheets API
 * 3. Buat Service Account → download credentials JSON
 * 4. Ambil "client_email" dan "private_key" dari JSON → masukkan ke .env
 * 5. Buat Google Spreadsheet → share ke email service account (Editor)
 * 6. Ambil Spreadsheet ID dari URL → masukkan ke .env sebagai GOOGLE_SHEETS_ID
 */

require('dotenv').config();
const { google } = require('googleapis');

// ===== Konfigurasi =====
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || '';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const SHEET_SUBMISSIONS = 'Entry Picker Sorter';
const SHEET_SUMMARY     = 'Summary';
const SHEET_LOADER      = 'Entry Loader';

// Header kolom untuk sheet Entry Picker Sorter
const SUBMISSION_HEADERS = [
  'Tanggal Carian', 'Tanggal Pengerjaan', 'Nama', 'Posisi', 'Zona',
  'Jumlah Output', 'Lembar Register', 'Batch/Cluster', 'Tipe Lokasi', 'Catatan Tambahan',
  'Status', 'Waktu Submit', 'ID Submission'
];

// Header kolom untuk sheet Entry Loader
const LOADER_HEADERS = [
  'Tanggal Carian', 'Tanggal Kirim', 'Nama', 'Posisi', 'Zona',
  'Jumlah Kontainer', 'Lembar Register', 'Batch/Cluster', 'Tipe Lokasi', 'Catatan',
  'No. Polisi', 'Gacoan', 'Dikichi', 'Benfarm',
  'Waktu Submit', 'ID Entry'
];

/**
 * Cek apakah konfigurasi Google Sheets sudah lengkap
 */
function isConfigured() {
  return !!(SPREADSHEET_ID && SERVICE_ACCOUNT_EMAIL && PRIVATE_KEY);
}

/**
 * Buat Google Sheets auth client menggunakan Service Account
 */
function getAuthClient() {
  if (!isConfigured()) {
    throw new Error('Google Sheets belum dikonfigurasi. Tambahkan GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, dan GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ke .env');
  }
  const auth = new google.auth.JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    key: PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

/**
 * Ambil instance Google Sheets API
 */
async function getSheetsClient() {
  const auth = getAuthClient();
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

/**
 * Pastikan sheet dengan nama tertentu ada. Jika belum, buat baru.
 */
async function ensureSheet(sheets, sheetTitle) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = meta.data.sheets.map(s => s.properties.title);
  if (!existing.includes(sheetTitle)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: sheetTitle }
          }
        }]
      }
    });
    return true; // baru dibuat
  }
  return false; // sudah ada
}

/**
 * Inisialisasi sheet Submissions: buat sheet jika belum ada, selalu update header
 */
async function initSubmissionsSheet(sheets) {
  const created = await ensureSheet(sheets, SHEET_SUBMISSIONS);

  // Selalu tulis ulang header (memastikan kolom baru seperti "Link Foto" ikut terupdate)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_SUBMISSIONS}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [SUBMISSION_HEADERS] }
  });

  if (created) {
    // Style header hanya saat sheet baru dibuat: bold + background biru tua
    const sheetId = await getSheetId(sheets, SHEET_SUBMISSIONS);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          // Bold header
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  backgroundColor: { red: 0.102, green: 0.278, blue: 0.604 }, // biru gelap
                  horizontalAlignment: 'CENTER'
                }
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)'
            }
          },
          // Freeze baris pertama
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount'
            }
          }
        ]
      }
    });
  }
  return created;
}

/**
 * Ambil sheet ID berdasarkan nama sheet
 */
async function getSheetId(sheets, sheetTitle) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === sheetTitle);
  return sheet ? sheet.properties.sheetId : null;
}

/**
 * Konversi submission DB object ke array baris untuk Google Sheets
 * @param {object} s           - submission object
 * @param {number} idx         - nomor urut
 * @param {Array}  files       - array file objects { file_path, original_name } milik submission ini
 */
/**
 * Membangun formula HYPERLINK Google Sheets dengan separator titik koma (;)
 * untuk mendukung regional setting Indonesia dan mencegah format error.
 */
function buildHyperlinkFormula(files) {
  if (!files || files.length === 0) return '';
  const urls = files.map(f => f.file_path).filter(Boolean);
  if (urls.length === 0) return '';
  
  // Format regional Indonesia: HYPERLINK("url"; "label")
  const links = urls.map((url, i) => `HYPERLINK("${url}";"📷 Foto ${i + 1}")`);
  return '=' + links.join(' & " | " & ');
}

function submissionToRow(s, idx, files = []) {
  let batchStr = '';
  try { batchStr = JSON.parse(s.batch_cluster || '[]').join(', '); } catch(e) { batchStr = s.batch_cluster || ''; }

  const linkFoto = buildHyperlinkFormula(files);

  return [
    s.tanggal_carian || '',
    s.tanggal_pengerjaan || '',
    s.nama || '',
    s.posisi || '',
    s.zona || '',
    s.jumlah_output || 0,
    linkFoto,
    batchStr,
    s.tipe_lokasi || '',
    s.catatan_tambahan || '',
    s.status || 'approved',
    s.created_at ? new Date(s.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '',
    s.id || ''
  ];
}

/**
 * Push SEMUA submissions ke Google Sheets (replace isi sheet, pertahankan header)
 * @param {Array} submissions — array dari db.getAllSubmissions()
 * @param {Map}   filesMap   — Map<submission_id, files[]> untuk lookup foto per submission
 * @returns {{ success: boolean, rowCount: number, message: string }}
 */
async function pushAllSubmissions(submissions, filesMap = new Map()) {
  if (!isConfigured()) {
    return { success: false, rowCount: 0, message: 'Google Sheets belum dikonfigurasi.' };
  }

  try {
    const sheets = await getSheetsClient();
    await initSubmissionsSheet(sheets);

    // Clear data lama (baris 2 ke bawah), pertahankan header di baris 1
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_SUBMISSIONS}!A2:Z`,
    });

    if (submissions.length === 0) {
      return { success: true, rowCount: 0, message: 'Tidak ada data untuk di-push.' };
    }

    // Siapkan baris data — sertakan files per submission
    const rows = submissions.map((s, i) => {
      const files = filesMap.get(s.id) || [];
      return submissionToRow(s, i + 1, files);
    });

    // Batch write — gunakan USER_ENTERED agar formula HYPERLINK diproses
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_SUBMISSIONS}!A2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows }
    });

    // Rapikan tampilan sheet
    await styleSheet(sheets, SHEET_SUBMISSIONS);

    return {
      success: true,
      rowCount: rows.length,
      message: `Berhasil push ${rows.length} baris data ke Google Sheets.`
    };
  } catch (err) {
    console.error('[GoogleSheets] pushAllSubmissions error:', err.message);
    return { success: false, rowCount: 0, message: `Gagal push: ${err.message}` };
  }
}

/**
 * Append SATU submission baru ke sheet (dipanggil dari auto-sync hook)
 * @param {Object} submission     — single submission object
 * @param {number} currentRowCount — jumlah baris data (tanpa header)
 * @param {Array}  files           — array file objects milik submission ini
 */
async function appendSubmission(submission, currentRowCount, files = []) {
  if (!isConfigured()) return; // silent fail jika belum dikonfigurasi

  try {
    const sheets = await getSheetsClient();
    await initSubmissionsSheet(sheets);

    const row = submissionToRow(submission, currentRowCount + 1, files);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_SUBMISSIONS}!A:A`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });

    // Rapikan tampilan sheet
    await styleSheet(sheets, SHEET_SUBMISSIONS);

    console.log(`[GoogleSheets] Appended submission ${submission.id} ke sheet.`);
  } catch (err) {
    console.error('[GoogleSheets] appendSubmission error:', err.message);
    // Tidak throw — fire-and-forget, tidak boleh gagalkan submit user
  }
}

/**
 * Cek status koneksi ke Google Sheets
 * @returns {{ configured: boolean, connected: boolean, spreadsheetTitle: string, rowCount: number, spreadsheetUrl: string, message: string }}
 */
async function checkStatus() {
  if (!isConfigured()) {
    return {
      configured: false,
      connected: false,
      spreadsheetTitle: '',
      rowCount: 0,
      spreadsheetUrl: '',
      message: 'Belum dikonfigurasi. Tambahkan variabel GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, dan GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ke file .env'
    };
  }

  try {
    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const title = meta.data.properties.title || '';

    // Cek jumlah baris di sheet Submissions
    let rowCount = 0;
    try {
      const valRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_SUBMISSIONS}!A:A`,
      });
      rowCount = Math.max(0, (valRes.data.values || []).length - 1); // -1 untuk header
    } catch(e) {
      // Sheet belum ada, rowCount = 0
    }

    return {
      configured: true,
      connected: true,
      spreadsheetTitle: title,
      rowCount,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
      message: `Terhubung ke "${title}" — ${rowCount} baris data`
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      spreadsheetTitle: '',
      rowCount: 0,
      spreadsheetUrl: '',
      message: `Gagal koneksi: ${err.message}`
    };
  }
}

/**
 * Inisialisasi sheet Loader: buat sheet jika belum ada, selalu update header
 */
async function initLoaderSheet(sheets) {
  const created = await ensureSheet(sheets, SHEET_LOADER);

  // Selalu tulis ulang header (memastikan kolom baru tetap sinkron)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_LOADER}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [LOADER_HEADERS] }
  });

  if (created) {
    // Style header hanya saat sheet baru dibuat: bold + background biru tua
    const sheetId = await getSheetId(sheets, SHEET_LOADER);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          // Bold header
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  backgroundColor: { red: 0.102, green: 0.278, blue: 0.604 }, // biru gelap
                  horizontalAlignment: 'CENTER'
                }
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)'
            }
          },
          // Freeze baris pertama
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount'
            }
          }
        ]
      }
    });
  }
  return created;
}

/**
 * Konversi loader entry DB object ke array baris untuk Google Sheets
 */
function loaderEntryToRow(e, idx, files = []) {
  let clusterList = [];
  if (Array.isArray(e.clusters)) {
    clusterList = e.clusters;
  } else if (e.clusters && typeof e.clusters === 'object') {
    clusterList = e.clusters.list || [];
  }
  const clustersStr = clusterList.join(', ');

  const linkFoto = buildHyperlinkFormula(files);

  return [
    e.tanggal_carian || '',
    e.tanggal_kirim || '',
    e.nama || '',
    'Loader',
    e.zona || '',
    e.jumlah_kontainer || 0,
    linkFoto,
    clustersStr,
    'Loading Dock',
    e.catatan || '',
    e.no_polisi || '',
    (e.non_group || {}).gacoan || 0,
    (e.non_group || {}).dikichi || 0,
    (e.non_group || {}).benfarm || 0,
    e.created_at ? new Date(e.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '',
    e.id || ''
  ];
}

/**
 * Push SEMUA Loader entries ke Google Sheets
 */
async function pushAllLoaderEntries(entries, filesMap = new Map()) {
  if (!isConfigured()) {
    return { success: false, rowCount: 0, message: 'Google Sheets belum dikonfigurasi.' };
  }

  try {
    const sheets = await getSheetsClient();
    await initLoaderSheet(sheets);

    // Clear data lama (baris 2 ke bawah), pertahankan header di baris 1
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_LOADER}!A2:Z`,
    });

    if (entries.length === 0) {
      return { success: true, rowCount: 0, message: 'Tidak ada data Loader untuk di-push.' };
    }

    const rows = entries.map((e, i) => {
      const files = filesMap.get(e.id) || [];
      return loaderEntryToRow(e, i + 1, files);
    });

    // Batch write — gunakan USER_ENTERED agar formula HYPERLINK diproses
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_LOADER}!A2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows }
    });

    // Rapikan tampilan sheet
    await styleSheet(sheets, SHEET_LOADER);

    return {
      success: true,
      rowCount: rows.length,
      message: `Berhasil push ${rows.length} baris data Loader ke Google Sheets.`
    };
  } catch (err) {
    console.error('[GoogleSheets] pushAllLoaderEntries error:', err.message);
    return { success: false, rowCount: 0, message: `Gagal push Loader: ${err.message}` };
  }
}

/**
 * Append SATU loader entry baru ke sheet (auto-sync)
 */
async function appendLoaderEntry(entry, currentRowCount, files = []) {
  if (!isConfigured()) return;

  try {
    const sheets = await getSheetsClient();
    await initLoaderSheet(sheets);

    const row = loaderEntryToRow(entry, currentRowCount + 1, files);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_LOADER}!A:A`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });

    // Rapikan tampilan sheet
    await styleSheet(sheets, SHEET_LOADER);

    console.log(`[GoogleSheets] Appended loader entry ${entry.id} ke sheet.`);
  } catch (err) {
    console.error('[GoogleSheets] appendLoaderEntry error:', err.message);
  }
}

/**
 * Menerapkan Alternating Colors (Zebra Striping) secara aman.
 */
async function applyAlternatingColors(sheets, sheetId, maxCols) {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            addAlternatingControls: {
              alternatingRange: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: 1000,
                  startColumnIndex: 0,
                  endColumnIndex: maxCols
                },
                style: 'LIGHT_BLUE'
              }
            }
          }
        ]
      }
    });
  } catch (err) {
    // Abaikan jika sudah ada
  }
}

/**
 * Merapikan tampilan sheet (Header, Row Height, Alignment, Auto Resize Columns)
 */
async function styleSheet(sheets, sheetTitle) {
  try {
    const sheetId = await getSheetId(sheets, sheetTitle);
    if (sheetId === null) return;

    const maxCols = sheetTitle === SHEET_LOADER ? LOADER_HEADERS.length : SUBMISSION_HEADERS.length;

    const requests = [
      // 1. Freeze baris pertama
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount'
        }
      },
      // 2. Format Header: Bold, Navy Blue (#1a365d), Text Putih, Center, Middle, Font Arial
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: maxCols },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10, fontFamily: 'Arial' },
              backgroundColor: { red: 0.102, green: 0.212, blue: 0.365 }, // Navy Blue (#1a365d)
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE'
            }
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment)'
        }
      },
      // 3. Set tinggi baris header (36px)
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 36 },
          fields: 'pixelSize'
        }
      },
      // 4. Set tinggi baris data (26px)
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 1000 },
          properties: { pixelSize: 26 },
          fields: 'pixelSize'
        }
      },
      // 5. Format seluruh data: vertical-align MIDDLE, font size 10, font Arial
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: maxCols },
          cell: {
            userEnteredFormat: {
              textFormat: { fontSize: 10, fontFamily: 'Arial' },
              verticalAlignment: 'MIDDLE'
            }
          },
          fields: 'userEnteredFormat(textFormat,verticalAlignment)'
        }
      }
    ];

    // 6. Custom alignment per kolom
    if (sheetTitle === SHEET_LOADER) {
      const centerCols = [0, 1, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
      for (const col of centerCols) {
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: col, endColumnIndex: col + 1 },
            cell: {
              userEnteredFormat: { horizontalAlignment: 'CENTER' }
            },
            fields: 'userEnteredFormat(horizontalAlignment)'
          }
        });
      }
    } else {
      const centerCols = [0, 1, 3, 4, 5, 6, 7, 8, 10, 11, 12];
      for (const col of centerCols) {
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: col, endColumnIndex: col + 1 },
            cell: {
              userEnteredFormat: { horizontalAlignment: 'CENTER' }
            },
            fields: 'userEnteredFormat(horizontalAlignment)'
          }
        });
      }
    }

    // 7. Auto Resize Columns
    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: maxCols
        }
      }
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests }
    });

    // 8. Terapkan alternating colors secara terpisah agar tidak crash jika sudah ada
    await applyAlternatingColors(sheets, sheetId, maxCols);

    console.log(`[GoogleSheets] Tampilan sheet "${sheetTitle}" berhasil dirapikan.`);
  } catch (err) {
    console.error(`[GoogleSheets] Gagal merapikan sheet "${sheetTitle}":`, err.message);
  }
}

/**
 * Test koneksi (untuk debugging via command line)
 */
async function testConnection() {
  console.log('Testing Google Sheets connection...');
  const status = await checkStatus();
  console.log(JSON.stringify(status, null, 2));
  return status;
}

// ===== DATA CARIAN SHEET =====
const SHEET_DATA_CARIAN = 'Data Carian';

const DATA_CARIAN_HEADERS = [
  'No', 'Tanggal Carian', 'Posisi', 'Zona', 'Kode Toko', 'Jumlah Toko',
  'Total Output', 'Satuan', 'Sudah Terisi', 'Sisa', 'Waktu Push'
];

/**
 * Pastikan sheet Data Carian ada + header up-to-date
 */
async function initDataCarianSheet(sheets) {
  const created = await ensureSheet(sheets, SHEET_DATA_CARIAN);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_DATA_CARIAN}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [DATA_CARIAN_HEADERS] }
  });

  if (created) {
    const sheetId = await getSheetId(sheets, SHEET_DATA_CARIAN);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  backgroundColor: { red: 0.102, green: 0.278, blue: 0.604 },
                  horizontalAlignment: 'CENTER'
                }
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)'
            }
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount'
            }
          }
        ]
      }
    });
  }
  return created;
}

/**
 * Append data carian ke sheet "Data Carian" (tidak menghapus data lama, hanya tambah ke bawah)
 * @param {Array}  records  - array dari db.getDataCarian() atau db.getDataCarianWithStatus()
 * @param {string} tanggal  - tanggal carian yang dipush (opsional, untuk label)
 * @returns {{ success: boolean, rowCount: number, message: string }}
 */
async function appendDataCarianToSheet(records, tanggal = null) {
  if (!isConfigured()) {
    return { success: false, rowCount: 0, message: 'Google Sheets belum dikonfigurasi.' };
  }

  try {
    const sheets = await getSheetsClient();
    await initDataCarianSheet(sheets);

    if (!records || records.length === 0) {
      return { success: true, rowCount: 0, message: 'Tidak ada data carian untuk di-push.' };
    }

    const waktuPush = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const rows = records.map((r, i) => [
      i + 1,
      r.tanggal_carian || '',
      r.posisi || '',
      r.zona || '',
      r.batch || '',
      r.jumlah_toko || 0,
      r.total_output || 0,
      r.satuan || '',
      r.sudah_diisi ?? '',
      r.sisa ?? '',
      waktuPush
    ]);

    // Append ke bawah (tidak hapus data lama)
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_DATA_CARIAN}!A:A`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows }
    });

    const label = tanggal ? ` untuk tanggal ${tanggal}` : '';
    return {
      success: true,
      rowCount: rows.length,
      message: `Berhasil menambahkan ${rows.length} baris data carian${label} ke Google Sheets.`
    };
  } catch (err) {
    console.error('[GoogleSheets] appendDataCarianToSheet error:', err.message);
    return { success: false, rowCount: 0, message: `Gagal push data carian: ${err.message}` };
  }
}

module.exports = {
  isConfigured,
  pushAllSubmissions,
  appendSubmission,
  pushAllLoaderEntries,
  appendLoaderEntry,
  appendDataCarianToSheet,
  checkStatus,
  testConnection
};

