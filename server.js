require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');
const db = require('./db');

const app = express();

// JWT Secret Key configuration
const JWT_SECRET = process.env.JWT_SECRET || 'ss08-formulir-secret-fallback-2026';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// Multer config for lembar register (image upload)
const uploadLembar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowedMime = /image\/(jpeg|jpg|png|gif|bmp|webp)/;
    const allowedExt = /\.(jpg|jpeg|png|gif|bmp|webp|pdf)$/i;
    if (allowedMime.test(file.mimetype) || allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar atau PDF yang diizinkan (JPG, PNG, GIF, BMP, WEBP, PDF)'));
    }
  }
});

// Multer config for Excel import (data carian)
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedExt = /\.(xlsx|xls|csv)$/i;
    if (allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file Excel (.xlsx, .xls) atau CSV yang diizinkan'));
    }
  }
});

// Auth middleware (stateless cookie-based JWT)
const requireAuth = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized. Silakan login terlebih dahulu.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sesi login habis atau tidak valid. Silakan login kembali.' });
  }
};

// ==================== PUBLIC ROUTES ====================

// POST /api/submit - submit form dengan validasi kapasitas
app.post('/api/submit', (req, res, next) => {
  uploadLembar.array('lembar_register', 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Ukuran file maksimum 10MB per file.' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Maksimum 5 file yang dapat diupload.' });
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { tanggal_carian, tanggal_pengerjaan, nama, posisi, tipe_lokasi, zona, jumlah_output, catatan_tambahan } = req.body;

    // Validate required fields
    if (!tanggal_carian || !tanggal_pengerjaan || !nama || !posisi || !tipe_lokasi || !zona || !jumlah_output) {
      return res.status(400).json({ error: 'Semua field yang bertanda * wajib diisi.' });
    }

    let batch_cluster = req.body.batch_cluster;
    if (!Array.isArray(batch_cluster)) batch_cluster = batch_cluster ? [batch_cluster] : [];

    if (batch_cluster.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal satu batch/cluster.' });
    }

    const outputValue = parseInt(jumlah_output);
    if (isNaN(outputValue) || outputValue <= 0) {
      return res.status(400).json({ error: 'Jumlah output harus berupa angka positif.' });
    }

    // ===== VALIDASI KAPASITAS BATCH =====
    // Jumlah output user (outputValue) dicek terhadap GABUNGAN sisa kapasitas semua batch yang dipilih
    const validationErrors = [];
    let totalKapasitas = 0;
    let totalSudahDiisi = 0;
    let adaDataCarian = false;
    let satuanLabel = '';

    for (const batch of batch_cluster) {
      const capacity = await db.getBatchCapacity(tanggal_carian, posisi, zona, batch);
      if (capacity.ada_data_carian) {
        adaDataCarian = true;
        totalKapasitas += capacity.total_output;
        totalSudahDiisi += capacity.sudah_diisi;
        satuanLabel = capacity.satuan;
      }
    }

    if (adaDataCarian) {
      const totalSisa = totalKapasitas - totalSudahDiisi;
      if (totalSisa <= 0) {
        validationErrors.push(
          `Semua batch yang dipilih sudah penuh (total kapasitas: ${totalKapasitas} ${satuanLabel}, sudah terisi: ${totalSudahDiisi} ${satuanLabel}).`
        );
      } else if (outputValue > totalSisa) {
        validationErrors.push(
          `Jumlah output Anda (${outputValue} ${satuanLabel}) melebihi sisa kapasitas gabungan batch yang dipilih (sisa: ${totalSisa} ${satuanLabel} dari total ${totalKapasitas} ${satuanLabel}).`
        );
      }
    }
    // Jika tidak ada data carian → tidak divalidasi (admin belum input)

    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Validasi gagal: ' + validationErrors.join(' | '),
        validation_errors: validationErrors
      });
    }
    // ===== AKHIR VALIDASI =====

    const submissionId = uuidv4();

    await db.insertSubmission({
      id: submissionId,
      tanggal_carian,
      tanggal_pengerjaan,
      nama,
      posisi,
      tipe_lokasi,
      zona,
      batch_cluster: JSON.stringify(batch_cluster),
      jumlah_output: outputValue,
      catatan_tambahan: catatan_tambahan || '',
    });

    // Insert uploaded files
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const fileId = uuidv4();
        const uniqueFilename = fileId + path.extname(file.originalname);
        
        const fileUrl = await db.saveUploadedFile(uniqueFilename, file.buffer, file.mimetype);
        
        await db.insertFile({
          id: fileId,
          submission_id: submissionId,
          filename: uniqueFilename,
          original_name: file.originalname,
          file_path: fileUrl
        });
      }
    }

    res.json({ success: true, message: 'Formulir berhasil dikirim! Terima kasih.' });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan server. Silakan coba lagi.' });
  }
});

// GET /api/batch-capacity — Public: cek kapasitas batch untuk form validasi real-time
app.get('/api/batch-capacity', async (req, res) => {
  try {
    const { tanggal_carian, posisi, zona, batch } = req.query;
    if (!tanggal_carian || !posisi || !zona || !batch) {
      return res.status(400).json({ error: 'Parameter tidak lengkap.' });
    }
    const capacity = await db.getBatchCapacity(tanggal_carian, posisi, zona, batch);
    res.json(capacity);
  } catch (err) {
    console.error('Batch capacity error:', err);
    res.status(500).json({ error: 'Gagal mengambil data kapasitas.' });
  }
});

// ==================== AUTH ROUTES ====================

// POST /api/login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.getUserByUsername(username);
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Username atau password salah.' });
    }

    // Generate stateless token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// GET /api/check-auth
app.get('/api/check-auth', (req, res) => {
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return res.json({ authenticated: true, username: decoded.username });
    } catch (err) {
      // Token invalid or expired
    }
  }
  res.json({ authenticated: false });
});

// ==================== ADMIN ROUTES ====================

// GET /api/submissions
app.get('/api/submissions', requireAuth, async (req, res) => {
  try {
    const submissions = await db.getAllSubmissions();
    res.json(submissions);
  } catch (err) {
    console.error('Fetch submissions error:', err);
    res.status(500).json({ error: 'Gagal memuat data.' });
  }
});

// GET /api/submissions/:id
app.get('/api/submissions/:id', requireAuth, async (req, res) => {
  try {
    const submission = await db.getSubmissionById(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    const files = await db.getFilesBySubmissionId(req.params.id);
    res.json({ ...submission, files });
  } catch (err) {
    console.error('Fetch submission detail error:', err);
    res.status(500).json({ error: 'Gagal memuat detail.' });
  }
});

// DELETE /api/submissions/:id
app.delete('/api/submissions/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteSubmission(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete submission error:', err);
    res.status(500).json({ error: 'Gagal menghapus data.' });
  }
});

// GET /api/stats
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (err) {
    console.error('Fetch stats error:', err);
    res.status(500).json({ error: 'Gagal memuat statistik.' });
  }
});

// GET /api/export - Export to Excel
app.get('/api/export', requireAuth, async (req, res) => {
  try {
    const submissions = await db.getAllSubmissions();

    const data = submissions.map((s, i) => ({
      'No': i + 1,
      'Tanggal Carian': s.tanggal_carian,
      'Tanggal Pengerjaan': s.tanggal_pengerjaan,
      'Nama': s.nama,
      'Posisi': s.posisi,
      'Tipe Lokasi': s.tipe_lokasi,
      'Zona': s.zona,
      'Batch/Cluster': JSON.parse(s.batch_cluster || '[]').join(', '),
      'Jumlah Output': s.jumlah_output,
      'Catatan Tambahan': s.catatan_tambahan,
      'Waktu Submit': s.created_at
    }));

    const ws = XLSX.utils.json_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
      { wch: 5 }, { wch: 15 }, { wch: 18 }, { wch: 30 },
      { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 40 },
      { wch: 15 }, { wch: 25 }, { wch: 22 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pencapaian Kerja SS08');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `pencapaian-kerja-ss08-${new Date().toISOString().slice(0,10)}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Export Excel error:', err);
    res.status(500).send('Gagal mengekspor data.');
  }
});

// GET /api/export-csv
app.get('/api/export-csv', requireAuth, async (req, res) => {
  try {
    const submissions = await db.getAllSubmissions();

    const headers = ['No', 'Tanggal Carian', 'Tanggal Pengerjaan', 'Nama', 'Posisi', 'Tipe Lokasi', 'Zona', 'Batch/Cluster', 'Jumlah Output', 'Catatan Tambahan', 'Waktu Submit'];
    const rows = submissions.map((s, i) => [
      i + 1, s.tanggal_carian, s.tanggal_pengerjaan, s.nama, s.posisi, s.tipe_lokasi,
      s.zona, JSON.parse(s.batch_cluster || '[]').join('; '), s.jumlah_output,
      s.catatan_tambahan, s.created_at
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const filename = `pencapaian-kerja-ss08-${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('Export CSV error:', err);
    res.status(500).send('Gagal mengekspor data.');
  }
});

// ==================== DATA CARIAN ROUTES (Admin) ====================

// GET /api/data-carian — Ambil semua atau filter per tanggal
app.get('/api/data-carian', requireAuth, async (req, res) => {
  try {
    const { tanggal } = req.query;
    let records;
    if (tanggal) {
      records = await db.getDataCarianWithStatus(tanggal);
    } else {
      records = await db.getDataCarian();
    }
    res.json(records);
  } catch (err) {
    console.error('Get data carian error:', err);
    res.status(500).json({ error: 'Gagal memuat data carian.' });
  }
});

// GET /api/data-carian/tanggal-list — Daftar tanggal yang punya data carian
app.get('/api/data-carian/tanggal-list', requireAuth, async (req, res) => {
  try {
    const records = await db.getDataCarian();
    const tanggalSet = [...new Set(records.map(r => r.tanggal_carian))].sort().reverse();
    res.json(tanggalSet);
  } catch (err) {
    console.error('Get tanggal list error:', err);
    res.status(500).json({ error: 'Gagal memuat daftar tanggal.' });
  }
});

// POST /api/data-carian — Tambah satu record
app.post('/api/data-carian', requireAuth, async (req, res) => {
  try {
    const { tanggal_carian, posisi, zona, batch, total_output } = req.body;
    if (!tanggal_carian || !posisi || !zona || !batch || !total_output) {
      return res.status(400).json({ error: 'Semua field wajib diisi.' });
    }
    // Tentukan satuan berdasarkan posisi
    const satuan = posisi === 'Picker' ? 'pcs' : 'kontainer';
    const record = await db.insertDataCarian({
      tanggal_carian, posisi, zona, batch,
      total_output: parseInt(total_output),
      satuan
    });
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('Insert data carian error:', err);
    res.status(500).json({ error: 'Gagal menyimpan data carian.' });
  }
});

// PUT /api/data-carian/:id — Edit satu record
app.put('/api/data-carian/:id', requireAuth, async (req, res) => {
  try {
    const { total_output, posisi } = req.body;
    if (!total_output) {
      return res.status(400).json({ error: 'Total output wajib diisi.' });
    }
    const satuan = posisi === 'Picker' ? 'pcs' : 'kontainer';
    const record = await db.updateDataCarian(req.params.id, {
      total_output: parseInt(total_output),
      satuan,
      ...(req.body.tanggal_carian && { tanggal_carian: req.body.tanggal_carian }),
      ...(req.body.posisi && { posisi: req.body.posisi }),
      ...(req.body.zona && { zona: req.body.zona }),
      ...(req.body.batch && { batch: req.body.batch }),
    });
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('Update data carian error:', err);
    res.status(500).json({ error: 'Gagal mengupdate data carian.' });
  }
});

// DELETE /api/data-carian/:id — Hapus satu record
app.delete('/api/data-carian/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteDataCarian(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete data carian error:', err);
    res.status(500).json({ error: 'Gagal menghapus data carian.' });
  }
});

// DELETE /api/data-carian/tanggal/:tanggal — Hapus semua data carian untuk tanggal tertentu
app.delete('/api/data-carian/tanggal/:tanggal', requireAuth, async (req, res) => {
  try {
    await db.deleteDataCarianByTanggal(req.params.tanggal);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete data carian by tanggal error:', err);
    res.status(500).json({ error: 'Gagal menghapus data carian.' });
  }
});

// POST /api/data-carian/import-excel — Import dari file Excel
app.post('/api/data-carian/import-excel', requireAuth, (req, res, next) => {
  uploadExcel.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File tidak ditemukan.' });
    }

    const { tanggal_carian, mode } = req.body;
    if (!tanggal_carian) {
      return res.status(400).json({ error: 'Tanggal carian wajib diisi.' });
    }

    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;
    const info = [];
    let records = [];
    const skipped = [];

    // Detect SS08 format (has sheets named Picker / Sorter / Loader)
    const pickerSheetNames = sheetNames.filter(n => n.toLowerCase().includes('picker'));
    const sorterSheetNames = sheetNames.filter(n => n.toLowerCase().includes('sort'));
    const loaderSheetName  = sheetNames.find(n => n.toLowerCase().includes('load') || n.toLowerCase().includes('kontainer'));
    const isSS08Format = !!(pickerSheetNames.length || sorterSheetNames.length || loaderSheetName);

    // Helper: parse single Picker sheet → array of records
    function parsePickerSheet(sheetName) {
      const raw = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
      const parsed = [];
      let batchNameRowIdx = -1;
      for (let i = 0; i < Math.min(15, raw.length); i++) {
        if (raw[i].join('|').toUpperCase().includes('BATCH') && !raw[i].join('|').toUpperCase().includes('TOTAL')) {
          batchNameRowIdx = i; break;
        }
      }
      let subTotalRowIdx = -1;
      for (let i = raw.length - 1; i >= 0; i--) {
        if (String(raw[i][0]).toUpperCase().includes('TOTAL')) { subTotalRowIdx = i; break; }
      }
      if (batchNameRowIdx === -1 || subTotalRowIdx === -1) {
        skipped.push(`Picker (${sheetName}): Tidak menemukan baris batch/SUB TOTAL`);
        return parsed;
      }
      const batchNameRow = raw[batchNameRowIdx];
      const subTotalRow  = raw[subTotalRowIdx];
      for (let col = 3; col < batchNameRow.length; col += 2) {
        let batchHeader = '';
        for (let off = -1; off <= 2; off++) {
          const c = String(batchNameRow[col + off] || '').trim();
          if (c.toUpperCase().includes('BATCH')) { batchHeader = c; break; }
        }
        const qty = parseInt(subTotalRow[col]);
        if (isNaN(qty) || qty <= 0 || !batchHeader) continue;
        const m = batchHeader.match(/^([A-Z0-9]+)\s+BATCH\s+(\d+)$/i);
        if (!m) { skipped.push(`Picker (${sheetName}): format "${batchHeader}" tidak dikenali`); continue; }
        parsed.push({ tanggal_carian, posisi: 'Picker', zona: m[1], batch: m[2], total_output: qty, satuan: 'pcs' });
      }
      return parsed;
    }

    // Helper: parse single Sorter sheet → array of records
    // Struktur: Row batch header (BATCH 1, BATCH 2...), lalu 30 baris data toko,
    // lalu 1 baris summary (nilai KONT total per batch), lalu NAMA SORTER / SHIFT / TOT KONT.
    // Setiap grup batch = 6 kolom: NO, KODE, INISIAL, KONT, RPS, (kosong).
    // Nilai KONT per batch ada di baris summary (tepat sebelum row "NAMA SORTER"/"SHIFT"),
    // di posisi kolom startCol+3 (kolom KONT).
    function parseSorterSheet(sheetName) {
      const raw = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
      const parsed = [];
      let zonaVal = '';
      for (let i = 0; i < Math.min(8, raw.length); i++) {
        const rowStr = raw[i].join('|').toUpperCase();
        if (rowStr.includes('ZONA')) {
          for (let j = 0; j < raw[i].length; j++) {
            const v = String(raw[i][j]).trim();
            if (v && !v.toUpperCase().includes('ZONA') && !v.toUpperCase().includes('TYPE') && !v.toUpperCase().includes('TANGGAL')) { zonaVal = v; break; }
          }
          break;
        }
      }
      // Fallback: try to extract zona from sheet name (e.g. "Sorter R1" → "R1")
      if (!zonaVal) {
        const mZona = sheetName.match(/([A-Z][0-9])\s*$/i);
        if (mZona) zonaVal = mZona[1].toUpperCase();
      }
      if (!zonaVal) zonaVal = 'T1';

      // Temukan semua baris batch header (bisa lebih dari 1 kelompok, mis. batch 1-5 di rows 6-41, batch 6-10 di rows 43-78)
      const batchHeaderRows = [];
      for (let i = 0; i < raw.length; i++) {
        const rowStr = raw[i].join('|').toUpperCase();
        if (rowStr.includes('BATCH') && rowStr.match(/[A-Z]\d/)) {
          batchHeaderRows.push(i);
        }
      }

      if (batchHeaderRows.length === 0) {
        skipped.push(`Sorter (${sheetName}): Tidak menemukan struktur batch`);
        return parsed;
      }

      // Untuk setiap kelompok batch header, temukan baris summary-nya
      // Baris summary = baris kosong di kolom 0 yang tepat sebelum "NAMA SORTER" atau "SHIFT" atau "TOT KONT"
      for (const batchHeaderRowIdx of batchHeaderRows) {
        const batchCols = [];
        raw[batchHeaderRowIdx].forEach((cell, colIdx) => {
          const m = String(cell).trim().match(/^([A-Z0-9]+)\s+BATCH\s+(\d+)$/i);
          if (m) batchCols.push({ batchNum: m[2], batchName: String(cell).trim(), startCol: colIdx });
        });
        if (batchCols.length === 0) continue;

        // Cari baris summary: baris setelah data toko, ditandai dengan kolom 0 kosong
        // dan kolom 1 berisi angka (nomor urut) ATAU baris tepat sebelum "NAMA SORTER"/"TOT KONT"
        let summaryRowIdx = -1;
        const dataStart = batchHeaderRowIdx + 2; // skip sub-header row
        for (let i = dataStart; i < Math.min(dataStart + 50, raw.length); i++) {
          const r = raw[i];
          const col0 = String(r[0]).trim();
          // Baris summary: col 0 kosong, dan ada angka di posisi KONT (startCol+3)
          if (col0 === '' || col0 === '0') {
            // Cek apakah ada nilai angka di kolom KONT dari salah satu batch
            const hasKont = batchCols.some(b => {
              const kontVal = parseInt(r[b.startCol + 3]);
              return !isNaN(kontVal) && kontVal > 0;
            });
            if (hasKont) { summaryRowIdx = i; break; }
          }
          // Stop jika sudah ketemu baris marker berikutnya
          if (/NAMA|SHIFT|TOT KONT/i.test(col0)) break;
        }

        if (summaryRowIdx === -1) {
          // Fallback: cari baris tepat sebelum "NAMA SORTER" atau "TOT KONT"
          for (let i = dataStart; i < Math.min(dataStart + 50, raw.length); i++) {
            const nextRowStr = String(raw[i + 1] ? raw[i + 1][0] : '').toUpperCase();
            if (/NAMA|SHIFT|TOT KONT/.test(nextRowStr)) { summaryRowIdx = i; break; }
          }
        }

        // Ambil nilai RPS dari baris summary (kolom RPS = startCol+4, bukan KONT = startCol+3)
        // KONT di baris summary selalu 0; nilai aktual ada di kolom RPS
        batchCols.forEach(({ batchNum, batchName, startCol }) => {
          let totalRps = 0;
          if (summaryRowIdx !== -1) {
            totalRps = parseInt(raw[summaryRowIdx][startCol + 4]) || 0;
          }
          // Jika summary row 0, fallback: jumlahkan RPS dari baris data per toko
          if (totalRps === 0) {
            for (let r = dataStart; r < (summaryRowIdx !== -1 ? summaryRowIdx : dataStart + 35); r++) {
              const no = raw[r][startCol];
              if (typeof no === 'number' && no > 0) totalRps += parseInt(raw[r][startCol + 4]) || 0;
            }
          }
          if (totalRps > 0) {
            parsed.push({ tanggal_carian, posisi: 'Sorter', zona: zonaVal, batch: batchNum, total_output: totalRps, satuan: 'rps' });
          } else {
            skipped.push(`Sorter (${sheetName}) ${batchName}: total RPS = 0, dilewati`);
          }
        });
      }
      return parsed;
    }


    if (isSS08Format) {
      // === PICKER: bisa ada beberapa sheet (misal "Picker R3", "Picker F1") ===
      if (pickerSheetNames.length > 0) {
        let totalPicker = 0;
        pickerSheetNames.forEach(sn => {
          const parsed = parsePickerSheet(sn);
          records.push(...parsed);
          totalPicker += parsed.length;
        });
        info.push(`Picker: ${totalPicker} batch dari ${pickerSheetNames.length} sheet`);
      }

      // === SORTER: bisa ada beberapa sheet (misal "Sorter T1", "Sorter R1") ===
      if (sorterSheetNames.length > 0) {
        let totalSorter = 0;
        sorterSheetNames.forEach(sn => {
          const parsed = parseSorterSheet(sn);
          records.push(...parsed);
          totalSorter += parsed.length;
        });
        info.push(`Sorter: ${totalSorter} batch dari ${sorterSheetNames.length} sheet`);
      }


      // === LOADER: Aggregate KONT per zona+batch from each store row ===
      if (loaderSheetName) {
        const raw = XLSX.utils.sheet_to_json(workbook.Sheets[loaderSheetName], { header: 1, defval: '' });
        const ZONES = ['F1', 'R1', 'R2', 'R3', 'T1', 'T2', 'T3', 'T4', 'T5'];
        let zoneHeaderRowIdx = -1;
        const zoneColMap = {};
        for (let i = 0; i < Math.min(15, raw.length); i++) {
          const row = raw[i].map(c => String(c).trim().toUpperCase());
          if (ZONES.filter(z => row.includes(z)).length >= 3) {
            zoneHeaderRowIdx = i;
            ZONES.forEach(zone => {
              const idx = row.indexOf(zone);
              if (idx !== -1) zoneColMap[zone] = { batchCol: idx, kontCol: idx + 1 };
            });
            break;
          }
        }
        if (zoneHeaderRowIdx !== -1) {
          const dataStart = zoneHeaderRowIdx + 2;
          const agg = {};
          for (let r = dataStart; r < raw.length; r++) {
            const no = raw[r][0];
            if (typeof no !== 'number' || no <= 0 || !Number.isInteger(no)) continue;
            Object.entries(zoneColMap).forEach(([zone, { batchCol, kontCol }]) => {
              const bv = raw[r][batchCol];
              const kv = parseInt(raw[r][kontCol]) || 0;
              if (!bv || bv === 0 || bv === '' || kv <= 0) return;
              const key = `${zone}_${bv}`;
              agg[key] = (agg[key] || 0) + kv;
            });
          }
          let loaderCount = 0;
          Object.entries(agg).forEach(([key, total]) => {
            const [zona, ...bParts] = key.split('_');
            if (total > 0) {
              records.push({ tanggal_carian, posisi: 'Loader', zona, batch: bParts.join('_'), total_output: total, satuan: 'kontainer' });
              loaderCount++;
            }
          });
          info.push(`Loader: ${loaderCount} kombinasi zona+batch`);
        } else skipped.push('Loader: Tidak menemukan header zona (F1/R1/T1 dst)');
      }

    } else {
      // === SIMPLE TEMPLATE FORMAT: Posisi | Zona | Batch | Total Output ===
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      let headerRowIdx = -1;
      let colMap = {};
      for (let i = 0; i < Math.min(10, rawData.length); i++) {
        const row = rawData[i].map(c => String(c).toLowerCase().trim());
        const pIdx = row.findIndex(c => c.includes('posisi'));
        const zIdx = row.findIndex(c => c.includes('zona'));
        const bIdx = row.findIndex(c => c.includes('batch'));
        const oIdx = row.findIndex(c => c.includes('output') || c.includes('total') || c.includes('jumlah'));
        if (pIdx !== -1 && zIdx !== -1 && bIdx !== -1 && oIdx !== -1) {
          headerRowIdx = i; colMap = { posisi: pIdx, zona: zIdx, batch: bIdx, output: oIdx }; break;
        }
      }
      if (headerRowIdx === -1) {
        return res.status(400).json({ error: 'Format Excel tidak dikenali.', hint: 'Gunakan file Register SS08 (sheet Picker/Sorter/Loader) atau template dengan kolom: Posisi | Zona | Batch | Total Output' });
      }
      for (let i = headerRowIdx + 1; i < rawData.length; i++) {
        const row = rawData[i];
        const posisi = String(row[colMap.posisi] || '').trim();
        const zona = String(row[colMap.zona] || '').trim();
        const batch = String(row[colMap.batch] || '').trim();
        const total_output = parseInt(row[colMap.output]);
        if (!posisi || !zona || !batch || isNaN(total_output) || total_output <= 0) continue;
        const posisiNorm = posisi.charAt(0).toUpperCase() + posisi.slice(1).toLowerCase();
        if (!['Picker', 'Sorter', 'Loader'].includes(posisiNorm)) continue;
        records.push({ tanggal_carian, posisi: posisiNorm, zona, batch, total_output, satuan: posisiNorm === 'Picker' ? 'pcs' : 'kontainer' });
      }
    }

    if (records.length === 0) {
      return res.status(400).json({ error: 'Tidak ada data valid yang berhasil diparse.', skipped, info });
    }

    // Jika mode = 'replace', hapus dulu data lama untuk tanggal ini
    if (mode === 'replace') {
      await db.deleteDataCarianByTanggal(tanggal_carian);
    }

    // Upsert semua record
    const inserted = await db.bulkUpsertDataCarian(records);

    res.json({
      success: true,
      inserted: inserted.length,
      skipped: skipped.length,
      skipped_detail: skipped,
      info,
      message: `Berhasil mengimport ${inserted.length} data carian. ${info.join(', ')}${skipped.length > 0 ? ` (${skipped.length} dilewati)` : ''}.`
    });
  } catch (err) {
    console.error('Import Excel error:', err);
    res.status(500).json({ error: 'Gagal memproses file Excel: ' + err.message });
  }
});

// GET /api/data-carian/template — Download template Excel
app.get('/api/data-carian/template', requireAuth, (req, res) => {
  try {
    const templateData = [
      ['Posisi', 'Zona', 'Batch', 'Total Output'],
      ['Picker', 'T1', '1', 500],
      ['Picker', 'T1', '2', 450],
      ['Picker', 'T2', '3', 600],
      ['Sorter', 'T1', '1', 120],
      ['Loader', 'F1', 'BOG01', 80],
      ['Loader', 'R1', 'CJR01', 60],
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);
    ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 15 }, { wch: 15 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data Carian');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="template-data-carian.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Template download error:', err);
    res.status(500).send('Gagal membuat template.');
  }
});

// SPA fallback routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀 Server berjalan di http://localhost:${PORT}`);
    console.log(`📝 Form: http://localhost:${PORT}`);
    console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
    console.log(`👤 Login: admin / admin123\n`);
  });
}

module.exports = app;
