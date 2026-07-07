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
const ExcelJS = require('exceljs');
const db = require('./db');
const googleSheets = require('./googleSheets');

const app = express();

// Pending notifications store (for polling - replaces SSE)
// Max 50 notifications kept in memory, auto-cleared setelah 5 menit
const pendingNotifications = [];
const NOTIF_TTL_MS = 5 * 60 * 1000; // 5 menit

function storeNotification(type, data) {
  pendingNotifications.push({ type, data, createdAt: Date.now() });
  // Bersihkan notifikasi lama (> 5 menit) dan batasi max 50
  const cutoff = Date.now() - NOTIF_TTL_MS;
  while (pendingNotifications.length > 0 && pendingNotifications[0].createdAt < cutoff) {
    pendingNotifications.shift();
  }
  if (pendingNotifications.length > 50) pendingNotifications.splice(0, pendingNotifications.length - 50);
}

// Optimized helper function to sync all submissions to Google Sheets (combining queries to avoid N+1)
async function syncSubmissionsToSheets() {
  if (!googleSheets.isConfigured()) return;
  try {
    const allSubs = await db.getAllSubmissions();
    const allFiles = await db.getAllFiles();

    // Map files in memory by submission_id to avoid N+1 queries
    const filesMap = new Map();
    for (const f of allFiles) {
      if (!filesMap.has(f.submission_id)) {
        filesMap.set(f.submission_id, []);
      }
      filesMap.get(f.submission_id).push(f);
    }

    await googleSheets.pushAllSubmissions(allSubs, filesMap);
  } catch(e) {
    console.error('[AutoSync] Google Sheets sync error:', e.message);
  }
}

// JWT Secret Key configuration
const JWT_SECRET = process.env.JWT_SECRET || 'ss08-formulir-secret-fallback-2026';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// Static files: CSS & JS di-cache browser 7 hari, HTML tidak di-cache
app.use('/css', express.static('public/css', { maxAge: '7d', etag: true }));
app.use('/js', express.static('public/js', { maxAge: '7d', etag: true }));
app.use(express.static('public', { maxAge: 0, etag: true }));

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
    const { tanggal_carian, tanggal_pengerjaan, nama, posisi, tipe_lokasi, zona, catatan_tambahan } = req.body;

    // Validate required fields
    if (!tanggal_carian || !tanggal_pengerjaan || !nama || !posisi || !tipe_lokasi || !zona) {
      return res.status(400).json({ error: 'Semua field yang bertanda * wajib diisi.' });
    }

    // ===== CEK ABSENSI =====
    // Jika fitur absensi aktif, user harus terdaftar hadir untuk tanggal_carian
    const { user_id: submittedUserId } = req.body;
    if (submittedUserId) {
      try {
        const absensiSettings = await db.getAbsensiSettings();
        if (absensiSettings.absensi_required) {
          const hadir = await db.isUserAbsen(tanggal_carian, submittedUserId);
          if (!hadir) {
            return res.status(403).json({
              error: 'Kamu belum diabsen untuk tanggal ini. Hubungi admin untuk mendaftarkan kehadiranmu.',
              code: 'NOT_ABSEN'
            });
          }
        }
      } catch (absenErr) {
        console.warn('Absensi check warning (allowing submit):', absenErr.message);
      }
    }
    // ===== AKHIR CEK ABSENSI =====
    // Validasi: lembar register wajib diupload - REMOVED

    // Parse batch_outputs: [{batch, jumlah}]
    let batchOutputs = [];
    try {
      batchOutputs = JSON.parse(req.body.batch_outputs || '[]');
    } catch(e) {
      return res.status(400).json({ error: 'Format data batch output tidak valid.' });
    }

    // Filter hanya yang jumlah > 0
    batchOutputs = batchOutputs.filter(b => b.batch && parseInt(b.jumlah) > 0);

    if (batchOutputs.length === 0) {
      return res.status(400).json({ error: 'Isi jumlah output untuk minimal satu batch.' });
    }

    // ===== CEK KAPASITAS — tentukan status submission =====
    // Jika ada batch yang melebihi kapasitas → status 'pending' (butuh validasi admin)
    // Jika semua dalam batas → status 'approved'
    const pendingBatches = []; // batch yang melebihi kapasitas
    const overCapacityInfo = {}; // detail info per batch yang over
    
    const batchNames = batchOutputs.map(b => b.batch);
    const capacities = await db.getMultipleBatchesCapacity(tanggal_carian, posisi, zona, batchNames);

    for (const { batch, jumlah } of batchOutputs) {
      const outputValue = parseInt(jumlah);
      const capacity = capacities[batch];
      if (capacity && capacity.ada_data_carian && outputValue > capacity.sisa) {
        pendingBatches.push(batch);
        overCapacityInfo[batch] = {
          input: outputValue,
          sisa: capacity.sisa,
          total: capacity.total_output,
          satuan: capacity.satuan
        };
      }
    }
    const submissionStatus = pendingBatches.length > 0 ? 'pending' : 'approved';
    // ===== AKHIR CEK KAPASITAS =====

    // Upload files dulu (shared ke semua submission batch ini)
    const uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const fileId = uuidv4();
        const uniqueFilename = fileId + path.extname(file.originalname);
        const fileUrl = await db.saveUploadedFile(uniqueFilename, file.buffer, file.mimetype);
        uploadedFiles.push({ id: fileId, filename: uniqueFilename, original_name: file.originalname, file_path: fileUrl });
      }
    }

    // Insert satu submission per batch
    for (const { batch, jumlah, keterangan } of batchOutputs) {
      const submissionId = uuidv4();
      const batchStatus = pendingBatches.includes(batch) ? 'pending' : 'approved';
      
      // Gabungkan keterangan per batch dengan catatan_tambahan (jika mengandung otorisasi Leader NIK)
      let finalCatatan = keterangan || '';
      if (catatan_tambahan && catatan_tambahan.includes('[Validasi Leader:')) {
        const match = catatan_tambahan.match(/\[Validasi Leader:[^\]]+\]/);
        const leaderInfo = match ? match[0] : '';
        finalCatatan = finalCatatan ? `${finalCatatan} ${leaderInfo}` : leaderInfo;
      }

      await db.insertSubmission({
        id: submissionId,
        tanggal_carian,
        tanggal_pengerjaan,
        nama,
        posisi,
        tipe_lokasi,
        zona,
        batch_cluster: JSON.stringify([batch]),
        jumlah_output: parseInt(jumlah),
        catatan_tambahan: finalCatatan,
        status: batchStatus,
      });

      // Attach files ke setiap submission
      for (const f of uploadedFiles) {
        await db.insertFile({
          id: uuidv4(),
          submission_id: submissionId,
          filename: f.filename,
          original_name: f.original_name,
          file_path: f.file_path
        });
      }
    }

    invalidateDcCache(tanggal_carian); // clear cache setelah submit baru

    const hasPending = pendingBatches.length > 0;
    const message = hasPending
      ? `Formulir terkirim! ${batchOutputs.length} batch tersimpan. ⚠️ ${pendingBatches.length} batch melebihi kapasitas dan menunggu validasi admin.`
      : `Formulir berhasil dikirim! ${batchOutputs.length} batch tersimpan. Terima kasih.`;

    res.json({
      success: true,
      hasPending,
      pendingBatches,
      overCapacityInfo,
      message
    });

    if (hasPending) {
      storeNotification('new_submission', { nama, posisi, pendingBatches, tanggal_carian });
    }

    // ===== AUTO-SYNC ke Google Sheets (fire-and-forget, tidak block response) =====
    if (googleSheets.isConfigured()) {
      setImmediate(async () => {
        await syncSubmissionsToSheets();
      });
    }
    // ====================================================================

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
    const { username, password, nik, mode } = req.body;

    let user = null;
    let tokenPayload = {};

    if (mode === 'operasional') {
      // Login Operasional: username + NIK (plaintext)
      if (!username || !nik) {
        return res.status(400).json({ error: 'Username dan NIK wajib diisi.' });
      }
      user = await db.getUserByUsernameAndNik(username.trim(), nik.trim());
      if (!user) {
        return res.status(401).json({ error: 'Username atau NIK tidak ditemukan. Hubungi HR/Admin.' });
      }
      // Cek status aktif
      if (user.is_active === false) {
        return res.status(403).json({
          error: 'Akun Anda telah dinonaktifkan. Silakan hubungi Administrator atau HR.',
          code: 'ACCOUNT_INACTIVE'
        });
      }
      tokenPayload = {
        userId: user.id,
        username: user.username,
        nama_lengkap: user.nama_lengkap,
        posisi: user.posisi,
        role: 'operasional'
      };
    } else {
      // Login Admin: username + password (bcrypt)
      if (!username || !password) {
        return res.status(400).json({ error: 'Username dan password wajib diisi.' });
      }
      user = await db.getUserByUsername(username.trim());
      if (!user || user.role === 'operasional' || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Username atau password salah.' });
      }
      tokenPayload = {
        userId: user.id,
        username: user.username,
        nama_lengkap: user.nama_lengkap || user.username,
        posisi: null,
        role: 'admin',
        allowed_pages: user.allowed_pages || []
      };
    }

    // Generate stateless token
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    if (tokenPayload.role === 'admin') {
      await db.insertAuditLog(user.username, 'LOGIN', 'Admin berhasil login ke dashboard');
    }

    res.json({ success: true, role: tokenPayload.role, nama_lengkap: tokenPayload.nama_lengkap, posisi: tokenPayload.posisi });
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

// GET /api/ping — Keep-alive endpoint (no auth required, for UptimeRobot/monitoring)
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// GET /api/settings/login — Ambil setting halaman login (public, no auth)
app.get('/api/settings/login', async (req, res) => {
  try {
    const settings = await db.getLoginSettings();
    res.json(settings);
  } catch (err) {
    console.error('Get login settings error:', err);
    res.json(db.DEFAULT_LOGIN_SETTINGS);
  }
});

// GET /api/check-auth
app.get('/api/check-auth', (req, res) => {
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return res.json({
        authenticated: true,
        userId: decoded.userId || null,
        username: decoded.username,
        nama_lengkap: decoded.nama_lengkap || decoded.username,
        role: decoded.role || 'admin',
        posisi: decoded.posisi || null,
        allowed_pages: decoded.allowed_pages || []
      });
    } catch (err) {
      // Token invalid or expired
    }
  }
  res.json({ authenticated: false });
});

// ==================== ADMIN ROUTES ====================

// Middleware: admin only
const requireAdmin = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak. Hanya untuk Admin.' });
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sesi tidak valid.' });
  }
};

// Middleware: super admin only (username = 'admin' case-insensitive)
const requireSuperAdmin = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin' || !decoded.username || decoded.username.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak. Hanya untuk Super Admin.' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sesi tidak valid.' });
  }
};

// Middleware: check custom admin permissions
const requirePermission = (page) => {
  return (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized.' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak.' });
      
      // Super Admin (username 'admin' case-insensitive) has access to all pages
      if (decoded.username && decoded.username.toLowerCase() === 'admin') {
        req.user = decoded;
        return next();
      }

      // Check allowed pages
      const allowed = Array.isArray(decoded.allowed_pages) ? decoded.allowed_pages : [];
      if (!allowed.includes(page)) {
        return res.status(403).json({ error: `Akses ditolak. Anda tidak memiliki izin untuk halaman: ${page}` });
      }

      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Sesi tidak valid.' });
    }
  };
};

// Polling endpoint untuk admin notifications (menggantikan SSE)
// Admin frontend fetch endpoint ini setiap 15 detik - AMAN untuk serverless
app.get('/api/admin/updates-poll', requireAdmin, (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const newNotifs = pendingNotifications.filter(n => n.createdAt > since);
  res.json({
    notifications: newNotifs,
    serverTime: Date.now()
  });
});

// GET /api/audit-logs
app.get('/api/audit-logs', requireSuperAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    const result = await db.getAuditLogs(page, limit, search);
    res.json(result);
  } catch (err) {
    console.error('Fetch audit logs error:', err);
    res.status(500).json({ error: 'Gagal memuat log aktivitas.' });
  }
});

// GET /api/submissions
app.get('/api/submissions', requirePermission('submissions'), async (req, res) => {
  try {
    const { status } = req.query;
    const filters = {};
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      filters.status = status;
    }
    const submissions = await db.getAllSubmissions(filters);
    res.json(submissions);
  } catch (err) {
    console.error('Fetch submissions error:', err);
    res.status(500).json({ error: 'Gagal memuat data.' });
  }
});

// POST /api/settings/login — Simpan setting halaman login (Super Admin only)
app.post('/api/settings/login', requireSuperAdmin, async (req, res) => {
  try {
    const saved = await db.saveLoginSettings(req.body);
    await db.insertAuditLog(req.user.username, 'UPDATE_SETTINGS', 'Mengubah pengaturan visual halaman login');
    res.json({ success: true, settings: saved });
  } catch (err) {
    console.error('Save login settings error:', err);
    res.status(500).json({ error: 'Gagal menyimpan pengaturan.' });
  }
});

// ==================== ABSENSI ROUTES ====================

// GET /api/settings/absensi — Ambil pengaturan absensi (public)
app.get('/api/settings/absensi', async (req, res) => {
  try {
    const settings = await db.getAbsensiSettings();
    res.json(settings);
  } catch (err) {
    console.error('Get absensi settings error:', err);
    res.json(db.DEFAULT_ABSENSI_SETTINGS);
  }
});

// PUT /api/settings/absensi — Simpan pengaturan absensi (admin only)
app.put('/api/settings/absensi', requirePermission('absensi'), async (req, res) => {
  try {
    const { absensi_required, absensi_visible_to_user } = req.body;
    const saved = await db.saveAbsensiSettings({
      absensi_required: !!absensi_required,
      absensi_visible_to_user: !!absensi_visible_to_user
    });
    await db.insertAuditLog(req.user.username, 'UPDATE_SETTINGS',
      `Mengubah pengaturan absensi: wajib=${saved.absensi_required}, visible=${saved.absensi_visible_to_user}`);
    res.json({ success: true, settings: saved });
  } catch (err) {
    console.error('Save absensi settings error:', err);
    res.status(500).json({ error: 'Gagal menyimpan pengaturan absensi.' });
  }
});

// GET /api/absensi/tanggal-list — Daftar tanggal punya absensi (admin only)
app.get('/api/absensi/tanggal-list', requirePermission('absensi'), async (req, res) => {
  try {
    const dates = await db.getAbsensiTanggalList();
    res.json(dates);
  } catch (err) {
    console.error('Get absensi tanggal list error:', err);
    res.status(500).json({ error: 'Gagal memuat daftar tanggal absensi.' });
  }
});

// GET /api/absensi/check — Cek apakah user hadir untuk tanggal tertentu (public)
app.get('/api/absensi/check', async (req, res) => {
  try {
    const { tanggal, user_id } = req.query;
    if (!tanggal || !user_id) return res.status(400).json({ error: 'tanggal dan user_id diperlukan.' });
    const settings = await db.getAbsensiSettings();
    if (!settings.absensi_required) {
      return res.json({ boleh_input: true, absensi_required: false });
    }
    const hadir = await db.isUserAbsen(tanggal, user_id);
    res.json({ boleh_input: hadir, absensi_required: true, hadir });
  } catch (err) {
    console.error('Check absensi error:', err);
    res.json({ boleh_input: true, absensi_required: false });
  }
});

// GET /api/absensi/hadir-hari-ini?tanggal=YYYY-MM-DD — Rekap hadir (public jika visible)
app.get('/api/absensi/hadir-hari-ini', async (req, res) => {
  try {
    const tanggal = req.query.tanggal;
    if (!tanggal) return res.status(400).json({ error: 'Parameter tanggal diperlukan.' });
    const settings = await db.getAbsensiSettings();
    let isAdmin = false;
    try {
      const token = req.cookies.token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'ss08-secret-key-2024');
        if (decoded.role === 'admin') isAdmin = true;
      }
    } catch (e) { /* not admin */ }
    if (!settings.absensi_visible_to_user && !isAdmin) return res.json([]);
    const records = await db.getAbsensiByTanggal(tanggal);
    res.json(records);
  } catch (err) {
    console.error('Get hadir hari ini error:', err);
    res.status(500).json({ error: 'Gagal memuat data kehadiran.' });
  }
});

// GET /api/absensi?tanggal=YYYY-MM-DD — Rekap absensi per tanggal (admin only)
app.get('/api/absensi', requirePermission('absensi'), async (req, res) => {
  try {
    const tanggal = req.query.tanggal;
    if (!tanggal) return res.status(400).json({ error: 'Parameter tanggal diperlukan.' });
    const records = await db.getAbsensiByTanggal(tanggal);
    res.json(records);
  } catch (err) {
    console.error('Get absensi error:', err);
    res.status(500).json({ error: 'Gagal memuat data absensi.' });
  }
});

// POST /api/absensi — Tambah user ke absensi (admin only)
app.post('/api/absensi', requirePermission('absensi'), async (req, res) => {
  try {
    const { tanggal, user_id } = req.body;
    if (!tanggal || !user_id) return res.status(400).json({ error: 'tanggal dan user_id diperlukan.' });
    const record = await db.addAbsensi(tanggal, user_id, req.user.username);
    const user = await db.getUserById(user_id);
    await db.insertAuditLog(req.user.username, 'ABSENSI_ADD',
      `Menambah absensi: ${user ? user.nama_lengkap : user_id} untuk tanggal ${tanggal}`);
    res.json({ success: true, record });
  } catch (err) {
    console.error('Add absensi error:', err);
    res.status(500).json({ error: 'Gagal menambah absensi.' });
  }
});

// DELETE /api/absensi/:id — Hapus user dari absensi (admin only)
app.delete('/api/absensi/:id', requirePermission('absensi'), async (req, res) => {
  try {
    const { id } = req.params;
    await db.removeAbsensi(id);
    await db.insertAuditLog(req.user.username, 'ABSENSI_REMOVE',
      `Menghapus record absensi ID: ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Remove absensi error:', err);
    res.status(500).json({ error: 'Gagal menghapus absensi.' });
  }
});


// GET /api/submissions/pending-count — Jumlah submission pending (untuk badge admin)
// HARUS SEBELUM /api/submissions/:id agar tidak dianggap sebagai :id
app.get('/api/submissions/pending-count', requireAuth, async (req, res) => {
  try {
    const count = await db.getPendingCount();
    res.json({ count });
  } catch (err) {
    console.error('Pending count error:', err);
    res.status(500).json({ error: 'Gagal mengambil data.' });
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
app.delete('/api/submissions/:id', requirePermission('submissions'), async (req, res) => {
  try {
    const sub = await db.getSubmissionById(req.params.id);
    const date = sub ? sub.tanggal_carian : null;
    if (sub) {
      await db.insertAuditLog(req.user.username, 'DELETE_SUBMISSION', `Menghapus submission dari ${sub.nama} (Tanggal: ${sub.tanggal_carian}, Output: ${sub.jumlah_output})`);
    }
    await db.deleteSubmission(req.params.id);
    if (date) invalidateDcCache(date); // clear cache setelah hapus
    res.json({ success: true });

    // ===== AUTO-SYNC ke Google Sheets setelah hapus (fire-and-forget) =====
    if (googleSheets.isConfigured()) {
      setImmediate(async () => {
        try {
          await syncSubmissionsToSheets();
          console.log(`[AutoSync] Submission ${req.params.id} dihapus — Sheets berhasil diperbarui.`);
        } catch(e) {
          console.error('[AutoSync] Gagal sync hapus ke Google Sheets:', e.message);
        }
      });
    }
    // ======================================================================

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

// PUT /api/submissions/:id/status — Admin approve atau reject submission pending
app.put('/api/submissions/:id/status', requirePermission('submissions'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid. Gunakan: approved, rejected, atau pending.' });
    }
    const submission = await db.getSubmissionById(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission tidak ditemukan.' });

    const updated = await db.updateSubmissionStatus(req.params.id, status);
    // Invalidate cache kapasitas setelah approve (karena approved submission ikut dihitung)
    if (submission.tanggal_carian) invalidateDcCache(submission.tanggal_carian);
    
    await db.insertAuditLog(req.user.username, 'UPDATE_SUBMISSION_STATUS', `Mengubah status submission ${submission.nama} (Tanggal: ${submission.tanggal_carian}) menjadi ${status.toUpperCase()}`);

    res.json({ success: true, data: updated });

    // ===== AUTO-SYNC ke Google Sheets setelah status berubah (fire-and-forget) =====
    if (googleSheets.isConfigured()) {
      setImmediate(async () => {
        try {
          await syncSubmissionsToSheets();
          console.log(`[AutoSync] Status submission ${req.params.id} → "${status}" berhasil disync ke Sheets.`);
        } catch(e) {
          console.error('[AutoSync] Gagal sync status ke Google Sheets:', e.message);
        }
      });
    }
    // ============================================================================

  } catch (err) {
    console.error('Update submission status error:', err);
    res.status(500).json({ error: 'Gagal mengubah status submission.' });
  }
});


// GET /api/export - Export to Styled Excel (ExcelJS) with optional filters
// Query params: tanggal_mulai, tanggal_akhir, posisi, zona, status
app.get('/api/export', requireAuth, async (req, res) => {
  try {
    let submissions = await db.getAllSubmissions();

    // ===== Terapkan Filter =====
    const { tanggal_mulai, tanggal_akhir, posisi: filterPosisi, zona: filterZona, status: filterStatus } = req.query;
    if (tanggal_mulai) submissions = submissions.filter(s => s.tanggal_carian >= tanggal_mulai);
    if (tanggal_akhir) submissions = submissions.filter(s => s.tanggal_carian <= tanggal_akhir);
    if (filterPosisi && filterPosisi !== 'semua') submissions = submissions.filter(s => s.posisi === filterPosisi);
    if (filterZona && filterZona !== 'semua') submissions = submissions.filter(s => s.zona === filterZona);
    if (filterStatus && filterStatus !== 'semua') submissions = submissions.filter(s => s.status === filterStatus);
    // ===========================

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Formulir Pencapaian Kerja SS08';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Pencapaian Kerja SS08', {
      views: [{ state: 'frozen', ySplit: 1 }] // Freeze baris header
    });

    // ===== Definisi Kolom =====
    sheet.columns = [
      { header: 'No',                key: 'no',         width: 6  },
      { header: 'Tanggal Carian',    key: 'tgl_carian', width: 16 },
      { header: 'Tanggal Pengerjaan',key: 'tgl_kerja',  width: 20 },
      { header: 'Nama',              key: 'nama',       width: 32 },
      { header: 'Tipe Karyawan',     key: 'tipe_karyawan', width: 16 },
      { header: 'Posisi',            key: 'posisi',     width: 12 },
      { header: 'Tipe Lokasi',       key: 'tipe',       width: 16 },
      { header: 'Zona',              key: 'zona',       width: 10 },
      { header: 'Batch/Cluster',     key: 'batch',      width: 42 },
      { header: 'Jumlah Output',     key: 'output',     width: 16 },
      { header: 'Status',            key: 'status',     width: 12 },
      { header: 'Catatan Tambahan',  key: 'catatan',    width: 30 },
      { header: 'Waktu Submit',      key: 'waktu',      width: 24 },
    ];

    // ===== Style Header Row =====
    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FF1A4799' }  // biru tua
      };
      cell.font   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FFAEC6E8' } }
      };
    });
    headerRow.height = 22;

    // ===== Warna header kolom angka berbeda (output) =====
    ['output'].forEach(key => {
      const col = sheet.getColumn(key);
      sheet.getRow(1).getCell(col.number).fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FF0D6E3F' } // hijau gelap untuk kolom angka
      };
    });

    // ===== Tambah Data =====
    const STATUS_COLOR = {
      approved: 'FFD4EDDA', // hijau muda
      pending:  'FFFFF3CD', // kuning muda
      rejected: 'FFF8D7DA', // merah muda
    };

    // Load user type mapping
    let userTypeMap = {};
    try {
      const users = await db.getAllOperationalUsers();
      users.forEach(u => {
        userTypeMap[u.nama_lengkap] = u.tipe_karyawan || 'Belum Ditentukan';
      });
    } catch(e) {
      console.error('Error loading users for export map:', e);
    }

    submissions.forEach((s, i) => {
      let batchStr = '';
      try { batchStr = JSON.parse(s.batch_cluster || '[]').join(', '); } catch(e) { batchStr = s.batch_cluster || ''; }

      const waktuStr = s.created_at
        ? new Date(s.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })
        : '';

      const row = sheet.addRow({
        no:        i + 1,
        tgl_carian: s.tanggal_carian || '',
        tgl_kerja:  s.tanggal_pengerjaan || '',
        nama:      s.nama || '',
        tipe_karyawan: userTypeMap[s.nama] || 'Belum Ditentukan',
        posisi:    s.posisi || '',
        tipe:      s.tipe_lokasi || '',
        zona:      s.zona || '',
        batch:     batchStr,
        output:    s.jumlah_output || 0,
        status:    (s.status || 'approved').charAt(0).toUpperCase() + (s.status || 'approved').slice(1),
        catatan:   s.catatan_tambahan || '',
        waktu:     waktuStr,
      });

      // Warna baris alternating + tint sesuai status
      const bgColor = STATUS_COLOR[s.status] || (i % 2 === 0 ? 'FFFAFAFA' : 'FFEFEFEF');
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.font = { name: 'Calibri', size: 10 };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } }
        };
      });

      // Kolom angka: rata kanan + bold
      row.getCell('output').alignment = { horizontal: 'right' };
      row.getCell('output').font = { bold: true, name: 'Calibri', size: 10 };
      row.getCell('no').alignment = { horizontal: 'center' };
      row.getCell('zona').alignment = { horizontal: 'center' };
      row.getCell('posisi').alignment = { horizontal: 'center' };
      row.getCell('status').alignment = { horizontal: 'center' };
      row.height = 18;
    });

    // ===== Auto-filter pada header =====
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1, column: sheet.columns.length }
    };

    // ===== Sheet ringkasan per posisi =====
    if (submissions.length > 0) {
      const summarySheet = workbook.addWorksheet('Ringkasan');
      summarySheet.columns = [
        { header: 'Posisi',       key: 'posisi',  width: 14 },
        { header: 'Zona',         key: 'zona',    width: 10 },
        { header: 'Total Output', key: 'total',   width: 16 },
        { header: 'Jml Entri',    key: 'entri',   width: 14 },
      ];
      // Style header summary
      summarySheet.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A2573' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      summarySheet.getRow(1).height = 20;

      // Aggregate per posisi + zona
      const agg = {};
      submissions.filter(s => s.status !== 'rejected').forEach(s => {
        const key = `${s.posisi}|||${s.zona}`;
        if (!agg[key]) agg[key] = { posisi: s.posisi, zona: s.zona, total: 0, entri: 0 };
        agg[key].total += (s.jumlah_output || 0);
        agg[key].entri++;
      });
      let sIdx = 0;
      Object.values(agg).sort((a,b) => a.posisi.localeCompare(b.posisi) || a.zona.localeCompare(b.zona))
        .forEach(r => {
          const sr = summarySheet.addRow({ posisi: r.posisi, zona: r.zona, total: r.total, entri: r.entri });
          const bgS = sIdx % 2 === 0 ? 'FFF3EFF8' : 'FFFFFFFF';
          sr.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgS } };
            cell.font = { name: 'Calibri', size: 10 };
          });
          sr.getCell('total').font = { bold: true, name: 'Calibri', size: 10 };
          sr.getCell('total').alignment = { horizontal: 'right' };
          sr.getCell('zona').alignment = { horizontal: 'center' };
          sIdx++;
        });
    }

    // ===== Generate buffer dan kirim =====
    const buffer = await workbook.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    const filterSuffix = filterPosisi && filterPosisi !== 'semua' ? `-${filterPosisi.toLowerCase()}` : '';
    const filename = `pencapaian-kerja-ss08${filterSuffix}-${dateStr}.xlsx`;

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
    let submissions = await db.getAllSubmissions();

    // Apply filters
    const { tanggal_mulai, tanggal_akhir, posisi: filterPosisi, zona: filterZona, status: filterStatus } = req.query;
    if (tanggal_mulai) submissions = submissions.filter(s => s.tanggal_carian >= tanggal_mulai);
    if (tanggal_akhir) submissions = submissions.filter(s => s.tanggal_carian <= tanggal_akhir);
    if (filterPosisi && filterPosisi !== 'semua') submissions = submissions.filter(s => s.posisi === filterPosisi);
    if (filterZona && filterZona !== 'semua') submissions = submissions.filter(s => s.zona === filterZona);
    if (filterStatus && filterStatus !== 'semua') submissions = submissions.filter(s => s.status === filterStatus);

    const headers = ['No', 'Tanggal Carian', 'Tanggal Pengerjaan', 'Nama', 'Posisi', 'Tipe Lokasi', 'Zona', 'Batch/Cluster', 'Jumlah Output', 'Status', 'Catatan Tambahan', 'Waktu Submit'];
    const rows = submissions.map((s, i) => [
      i + 1, s.tanggal_carian, s.tanggal_pengerjaan, s.nama, s.posisi, s.tipe_lokasi,
      s.zona, JSON.parse(s.batch_cluster || '[]').join('; '), s.jumlah_output,
      s.status || 'approved', s.catatan_tambahan, s.created_at
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

// ==================== GOOGLE SHEETS ROUTES ====================

// GET /api/google-sheets/status — Cek status koneksi Google Sheets
app.get('/api/google-sheets/status', requireAdmin, async (req, res) => {
  try {
    const status = await googleSheets.checkStatus();
    res.json(status);
  } catch (err) {
    console.error('Google Sheets status error:', err);
    res.status(500).json({ error: 'Gagal cek status Google Sheets.' });
  }
});

// POST /api/google-sheets/push — Manual push semua data ke Google Sheets
app.post('/api/google-sheets/push', requireAdmin, async (req, res) => {
  try {
    if (!googleSheets.isConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'Google Sheets belum dikonfigurasi. Tambahkan GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, dan GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ke file .env'
      });
    }

    let submissions = await db.getAllSubmissions();
    let loaderEntries = await db.getAllLoaderEntries();

    // Apply optional filters dari body
    const { tanggal_mulai, tanggal_akhir, posisi: filterPosisi } = req.body || {};
    
    if (tanggal_mulai) {
      submissions = submissions.filter(s => s.tanggal_carian >= tanggal_mulai);
      loaderEntries = loaderEntries.filter(e => e.tanggal_carian >= tanggal_mulai);
    }
    if (tanggal_akhir) {
      submissions = submissions.filter(s => s.tanggal_carian <= tanggal_akhir);
      loaderEntries = loaderEntries.filter(e => e.tanggal_carian <= tanggal_akhir);
    }
    
    // Tentukan apakah Picker/Sorter dan Loader harus di-push
    const shouldPushSubmissions = !filterPosisi || filterPosisi === 'semua' || ['Picker', 'Sorter'].includes(filterPosisi);
    const shouldPushLoader = !filterPosisi || filterPosisi === 'semua' || filterPosisi === 'Loader';

    let result = { success: true, rowCount: 0, message: '' };

    // Fetch all files once to avoid N+1 queries
    let allFiles = [];
    if (shouldPushSubmissions || shouldPushLoader) {
      allFiles = await db.getAllFiles();
    }

    if (shouldPushSubmissions) {
      if (filterPosisi && filterPosisi !== 'semua') {
        submissions = submissions.filter(s => s.posisi === filterPosisi);
      }
      const filesMap = new Map();
      for (const f of allFiles) {
        if (!filesMap.has(f.submission_id)) {
          filesMap.set(f.submission_id, []);
        }
        filesMap.get(f.submission_id).push(f);
      }
      const subResult = await googleSheets.pushAllSubmissions(submissions, filesMap);
      result.success = result.success && subResult.success;
      result.rowCount += subResult.rowCount;
      result.message = subResult.message;
    }

    if (shouldPushLoader) {
      const loaderFilesMap = new Map();
      for (const f of allFiles) {
        if (!loaderFilesMap.has(f.submission_id)) {
          loaderFilesMap.set(f.submission_id, []);
        }
        loaderFilesMap.get(f.submission_id).push(f);
      }
      const loaderResult = await googleSheets.pushAllLoaderEntries(loaderEntries, loaderFilesMap);
      result.success = result.success && loaderResult.success;
      result.rowCount += loaderResult.rowCount;
      result.message = result.message 
        ? `${result.message} ${loaderResult.message}` 
        : loaderResult.message;
    }

    if (result.success) {
      await db.insertAuditLog(req.user.username, 'PUSH_GOOGLE_SHEETS', `Berhasil push ${result.rowCount} baris data ke Google Sheets`);
    } else {
      await db.insertAuditLog(req.user.username, 'PUSH_GOOGLE_SHEETS_FAILED', `Gagal push data ke Google Sheets: ${result.message}`);
    }

    res.json(result);
  } catch (err) {
    console.error('Google Sheets push error:', err);
    res.status(500).json({ success: false, message: 'Gagal push ke Google Sheets: ' + err.message });
  }
});

// ==================== DATA CARIAN ROUTES (Admin) ====================

// Simple in-memory cache untuk data-carian (per tanggal, TTL 30 detik)
const dcCache = {}; // { tanggal: { data, expireAt } }
const DC_CACHE_TTL = 30 * 1000; // 30 detik
function invalidateDcCache(tanggal) {
  if (tanggal) {
    delete dcCache[tanggal];
  } else {
    Object.keys(dcCache).forEach(k => delete dcCache[k]);
  }
}

// GET /api/data-carian — Ambil semua atau filter per tanggal
app.get('/api/data-carian', requireAuth, async (req, res) => {
  try {
    const { tanggal } = req.query;
    let records;
    if (tanggal) {
      // Cek cache dulu
      const cached = dcCache[tanggal];
      if (cached && cached.expireAt > Date.now()) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached.data);
      }
      records = await db.getDataCarianWithStatus(tanggal);
      // Simpan ke cache
      dcCache[tanggal] = { data: records, expireAt: Date.now() + DC_CACHE_TTL };
      res.setHeader('X-Cache', 'MISS');
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
    const { tanggal_carian, posisi, zona, batch, jumlah_toko, total_output } = req.body;
    if (!tanggal_carian || !posisi || !zona || !batch || total_output === undefined || total_output === null || total_output === '') {
      return res.status(400).json({ error: 'Semua field wajib diisi.' });
    }
    // Tentukan satuan berdasarkan posisi
    const satuan = posisi === 'Picker' ? 'pcs' : 'kontainer';
    const record = await db.insertDataCarian({
      tanggal_carian, posisi, zona, batch,
      jumlah_toko: parseInt(jumlah_toko) || 0,
      total_output: parseInt(total_output),
      satuan
    });
    invalidateDcCache(tanggal_carian);
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('Insert data carian error:', err);
    res.status(500).json({ error: 'Gagal menyimpan data carian.' });
  }
});

// PUT /api/data-carian/:id — Edit satu record
app.put('/api/data-carian/:id', requireAuth, async (req, res) => {
  try {
    const { total_output, jumlah_toko, posisi } = req.body;
    if (total_output === undefined || total_output === null || total_output === '') {
      return res.status(400).json({ error: 'Total output wajib diisi.' });
    }
    const satuan = posisi === 'Picker' ? 'pcs' : 'kontainer';
    const finalZona = posisi === 'Loader' ? 'LOADER' : (req.body.zona || null);
    const record = await db.updateDataCarian(req.params.id, {
      total_output: parseInt(total_output),
      jumlah_toko: parseInt(jumlah_toko) || 0,
      satuan,
      ...(req.body.tanggal_carian && { tanggal_carian: req.body.tanggal_carian }),
      ...(req.body.posisi && { posisi: req.body.posisi }),
      ...(req.body.zona && { zona: req.body.zona }),
      ...(req.body.batch && { batch: req.body.batch }),
    });
    invalidateDcCache(req.body.tanggal_carian || null);
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
    invalidateDcCache(null); // invalidate semua cache karena tidak tahu tanggalnya
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
    invalidateDcCache(req.params.tanggal);
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

    // Detect "DATA UPLOAD SYSTEM" format (1 sheet, matrix besar: row1=posisi, row2=zona, row3=batch, row4=label, row5=QTY/ACT)
    let dataUploadSheet = sheetNames.find(n => n.toUpperCase().includes('DATA UPLOAD') || n.toUpperCase().includes('UPLOAD SYSTEM'));

    // Detect SS08 format (has sheets named Picker / Sorter / Loader)
    const pickerSheetNames = sheetNames.filter(n => n.toLowerCase().includes('picker'));
    const sorterSheetNames = sheetNames.filter(n => n.toLowerCase().includes('sort'));
    const loaderSheetName  = sheetNames.find(n => n.toLowerCase().includes('load') || n.toLowerCase().includes('kontainer'));
    const isSS08Format = !!(pickerSheetNames.length || sorterSheetNames.length || loaderSheetName);

    // Detect "Lembar Fix Baru" format:
    // 1 sheet (Lembar1), row 2 = zona (F1/R1/...), row 3 = Picker/Shorter per zona,
    // row 6 = header (TANGGAL CARI, GROUP MOBIL, KODE, INS, NAMA TOKO, BATCH, QTY, ACT QTY, KONT, ACT KONT... per zona)
    // data mulai row 7 → batch ada di kolom F (per zona group, 5 kolom: BATCH, QTY, ACT QTY, KONT, ACT KONT)
    // Loader kolom terakhir: FREZZER KONT (col 51), CHILLER KONT (col 53), AMBIENT KONT (col 55) [1-based dari Excel]
    let isLembarFixFormat = false;
    let lembarFixHeaderRowIdx = -1; // idx baris yang berisi "TANGGAL CARI"
    let lembarFixSheet = null;

    // First, check if the dataUploadSheet actually matches "Lembar Fix Baru" structure
    if (dataUploadSheet) {
      try {
        const ws0 = workbook.Sheets[dataUploadSheet];
        const probe = XLSX.utils.sheet_to_json(ws0, { header: 1, defval: '', range: { s: {r:0,c:0}, e: {r:9,c:5} } });
        for (let ri = 0; ri < Math.min(10, probe.length); ri++) {
          const rowCells = (probe[ri] || []).map(v => String(v).toUpperCase());
          if (rowCells[0] === 'TANGGAL CARI' || rowCells.some(v => v === 'TANGGAL CARI')) {
            isLembarFixFormat = true;
            lembarFixHeaderRowIdx = ri;
            lembarFixSheet = dataUploadSheet;
            dataUploadSheet = null; // Reset to prevent matching the legacy format
            break;
          }
        }
      } catch(e) { /* ignore */ }
    }

    if (!isLembarFixFormat) {
      const lembarFixSheetName = !dataUploadSheet && !isSS08Format
        ? sheetNames.find(n => /lembar/i.test(n))
        : null;
      isLembarFixFormat = !!lembarFixSheetName;
      if (isLembarFixFormat) {
        lembarFixSheet = lembarFixSheetName;
      }

      // juga deteksi berdasarkan struktur header jika tidak ada nama "Lembar"
      if (!isLembarFixFormat && !dataUploadSheet && !isSS08Format && sheetNames.length === 1) {
        // Cek baris 3–8 (idx 3–8): ada yang berisi "TANGGAL CARI" di kolom 0?
        try {
          const ws0 = workbook.Sheets[sheetNames[0]];
          const probe = XLSX.utils.sheet_to_json(ws0, { header: 1, defval: '', range: { s: {r:0,c:0}, e: {r:9,c:5} } });
          for (let ri = 3; ri <= 8; ri++) {
            const rowCells = (probe[ri] || []).map(v => String(v).toUpperCase());
            if (rowCells[0] === 'TANGGAL CARI' || rowCells.some(v => v === 'TANGGAL CARI')) {
              isLembarFixFormat = true;
              lembarFixHeaderRowIdx = ri;
              lembarFixSheet = sheetNames[0];
              break;
            }
          }
        } catch(e) { /* ignore */ }
      } else if (lembarFixSheet) {
        // Jika terdeteksi dari nama sheet, cari header row-nya
        try {
          const ws0 = workbook.Sheets[lembarFixSheet];
          const probe = XLSX.utils.sheet_to_json(ws0, { header: 1, defval: '', range: { s: {r:0,c:0}, e: {r:9,c:5} } });
          for (let ri = 3; ri <= 8; ri++) {
            const rowCells = (probe[ri] || []).map(v => String(v).toUpperCase());
            if (rowCells[0] === 'TANGGAL CARI' || rowCells.some(v => v === 'TANGGAL CARI')) {
              lembarFixHeaderRowIdx = ri;
              break;
            }
          }
        } catch(e) { /* ignore */ }
      }
    }

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
          // Baris summary: col 0 kosong/0, dan ada angka di kolom RPS (startCol+4)
          // KONT selalu 0 di Sorter, jadi cek RPS bukan KONT
          if (col0 === '' || col0 === '0') {
            const hasRps = batchCols.some(b => {
              const rpsVal = parseInt(r[b.startCol + 4]);
              return !isNaN(rpsVal) && rpsVal > 0;
            });
            if (hasRps) { summaryRowIdx = i; break; }
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


    if (isLembarFixFormat) {
      // ====================================================
      // FORMAT: LEMBAR FIX BARU (sheet Lembar1 atau 1 sheet dgn header TANGGAL CARI)
      // Struktur (bisa ada 1 baris kosong extra di atas, sehingga index bisa bergeser):
      //   - Row X: Zona group — FREZZER, CHILLER, AMBIENT
      //   - Row X+1: Zona code — F1, R1, R2, R3, T1..T5, ALL
      //   - Row X+2: Posisi — Picker, Shorter, LOADER
      //   - Row X+3: Label zona — "FREZZER ZONA F1 Picker", dll
      //   - Row HEADER (auto-detect): TANGGAL CARI, GROUP MOBIL, KODE, ...
      //   - Row HEADER+1+: Data per toko
      // Setiap zona = 5 kolom: BATCH, QTY, ACT QTY, KONT, ACT KONT
      // Loader = 3 kolom terakhir: FREZZER KONT, CHILLER KONT, AMBIENT KONT
      // ====================================================
      const sheetName = lembarFixSheet || sheetNames[0];
      const raw = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });

      // Auto-detect baris header (TANGGAL CARI) — sudah ditemukan saat deteksi format
      // Jika belum ditemukan, cari lagi sekarang
      let headerRowIdx = lembarFixHeaderRowIdx;
      if (headerRowIdx === -1) {
        for (let ri = 0; ri < Math.min(12, raw.length); ri++) {
          const rowCells = raw[ri].map(v => String(v).toUpperCase());
          if (rowCells[0] === 'TANGGAL CARI' || rowCells.some(v => v === 'TANGGAL CARI')) {
            headerRowIdx = ri;
            break;
          }
        }
      }
      // Fallback ke idx 5 (format lama)
      if (headerRowIdx === -1) headerRowIdx = 5;

      const DATA_START = headerRowIdx + 1; // baris data pertama (setelah header)

      // Cari baris zona code: baris sebelum header yang mengandung F1/R1/T1/ALL
      const ZONA_CODES = ['F1', 'R1', 'R2', 'R3', 'T1', 'T2', 'T3', 'T4', 'T5', 'ALL'];
      let zonaRowIdx = -1;
      for (let ri = headerRowIdx - 1; ri >= 0; ri--) {
        const rowUpper = raw[ri].map(v => String(v).trim().toUpperCase());
        const matchCount = ZONA_CODES.filter(z => rowUpper.includes(z)).length;
        if (matchCount >= 2) { zonaRowIdx = ri; break; }
      }
      // Fallback ke idx 2
      if (zonaRowIdx === -1) zonaRowIdx = 2;

      const ZONA_START_COL = 5;
      const ZONA_COLS = 5;

      // Baca zona dari baris zona yang terdeteksi
      const zonaRow = raw[zonaRowIdx] || [];

      // Bangun daftar zona group: { zona, colBatch, colQty, colKont }
      const zonaGroups = [];
      for (let col = ZONA_START_COL; col < zonaRow.length; col += ZONA_COLS) {
        const zona = String(zonaRow[col] || '').trim().toUpperCase();
        if (!zona || zona === 'ALL') continue; // skip Loader area (ALL) dan kosong
        // Tiap zona 5 kolom: 0=BATCH, 1=QTY, 2=ACT QTY, 3=KONT, 4=ACT KONT
        zonaGroups.push({
          zona,
          colBatch: col,
          colQty:   col + 1,
          colKont:  col + 3,
        });
      }

      // Auto-detect kolom Loader: scan SETIAP kolom di zonaRow untuk cari 'ALL'
      // Loader punya 2 kolom per cluster (KONT + ACT KONT), bukan 5 seperti zona Picker/Sorter
      const LOADER_CLUSTERS = ['FREZZER', 'CHILLER', 'AMBIENT'];
      const LOADER_COLS = [];
      // Baris tipe (1 baris sebelum zona) mungkin berisi FREZZER/CHILLER/AMBIENT
      const tipeRow = raw[zonaRowIdx - 1] || [];
      for (let col = ZONA_START_COL; col < zonaRow.length; col++) { // scan satu per satu, bukan step ZONA_COLS
        const zonaCell = String(zonaRow[col] || '').trim().toUpperCase();
        if (zonaCell !== 'ALL') continue;
        // cari cluster dari baris tipe (di kolom yang sama)
        let cluster = '';
        const tipeVal = String(tipeRow[col] || '').trim().toUpperCase();
        if (LOADER_CLUSTERS.includes(tipeVal)) {
          cluster = tipeVal;
        } else {
          // fallback: cari dari baris label (1 sebelum header) — berisi "FREZZER ALL ZONA LOADER"
          const labelRow = raw[headerRowIdx - 1] || [];
          for (let off = 0; off <= 2; off++) {
            const v = String(labelRow[col + off] || '').trim().toUpperCase();
            const m = v.match(/^(FREZZER|CHILLER|AMBIENT)/);
            if (m) { cluster = m[1]; break; }
          }
        }
        if (cluster && !LOADER_COLS.some(l => l.cluster === cluster)) {
          LOADER_COLS.push({ cluster, col });
        }
      }
      // Fallback ke kolom default jika tidak terdeteksi
      if (LOADER_COLS.length === 0) {
        LOADER_COLS.push(
          { cluster: 'FREZZER', col: 50 },
          { cluster: 'CHILLER', col: 52 },
          { cluster: 'AMBIENT', col: 54 }
        );
      }

      // Aggregate: per zona+batch untuk Picker & Sorter, per cluster untuk Loader
      const pickerAgg  = {}; // `${tgl}|${zona}|${batch}` → total QTY
      const sorterAgg  = {}; // `${tgl}|${zona}|${batch}` → total KONT
      const loaderAgg  = {}; // `${tgl}|${cluster}|${groupMobil}` → total KONT
      const pickerTokoCount  = {}; // `${tgl}|${zona}|${batch}` → jumlah toko unik
      const sorterTokoCount  = {}; // `${tgl}|${zona}|${batch}` → jumlah toko unik
      const loaderTokoCount  = {}; // `${tgl}|${cluster}|${groupMobil}` → jumlah toko unik

      // Per-toko records untuk rekap dashboard
      const tokoRecords = [];

      // Baca tanggal otomatis dari kolom A (TANGGAL CARI) data row pertama
      let tanggal_carian_excel = tanggal_carian; // default = dari form

      // Cari baris data pertama yang valid untuk baca tanggal
      for (let r = DATA_START; r < raw.length; r++) {
        const row = raw[r];
        const namaToko = String(row[4] || '').trim();
        if (!namaToko) continue;
        const tglVal = row[0]; // kolom A = TANGGAL CARI
        if (tglVal === '' || tglVal === null || tglVal === undefined) break;
        
        let parsed = null;
        if (typeof tglVal === 'number') {
          // Excel serial date → JS Date (Excel epoch = Jan 1 1900, tapi ada bug +2 hari)
          const jsDate = new Date(Math.round((tglVal - 25569) * 86400 * 1000));
          if (!isNaN(jsDate)) {
            const y = jsDate.getUTCFullYear();
            const m = String(jsDate.getUTCMonth() + 1).padStart(2, '0');
            const d = String(jsDate.getUTCDate()).padStart(2, '0');
            parsed = `${y}-${m}-${d}`;
          }
        } else if (typeof tglVal === 'string' && tglVal.trim()) {
          // Coba parse string tanggal — bisa "30-May-2026", "30/05/2026", "2026-05-30", dll.
          const dt = new Date(tglVal.trim());
          if (!isNaN(dt)) {
            const y = dt.getFullYear();
            const m = String(dt.getMonth() + 1).padStart(2, '0');
            const d = String(dt.getDate()).padStart(2, '0');
            parsed = `${y}-${m}-${d}`;
          }
        }
        
        if (parsed) {
          tanggal_carian_excel = parsed;
          info.push(`Tanggal dari Excel: ${parsed}`);
        }
        break; // cukup baca dari baris pertama
      }

      // Gunakan tanggal dari form (prioritaskan pilihan user di admin panel)
      const tglFinal = tanggal_carian;

      for (let r = DATA_START; r < raw.length; r++) {
        const row = raw[r];
        // Skip baris kosong (nama toko harus ada di col 4)
        const namaToko = String(row[4] || '').trim();
        if (!namaToko) continue;

        // Parse row-specific date from Column A (TANGGAL CARI)
        const tglVal = row[0];
        let rowTanggal = tanggal_carian; // fallback to form date
        if (tglVal !== '' && tglVal !== null && tglVal !== undefined) {
          let parsed = null;
          if (typeof tglVal === 'number') {
            const jsDate = new Date(Math.round((tglVal - 25569) * 86400 * 1000));
            if (!isNaN(jsDate)) {
              const y = jsDate.getUTCFullYear();
              const m = String(jsDate.getUTCMonth() + 1).padStart(2, '0');
              const d = String(jsDate.getUTCDate()).padStart(2, '0');
              parsed = `${y}-${m}-${d}`;
            }
          } else if (typeof tglVal === 'string' && tglVal.trim()) {
            const dt = new Date(tglVal.trim());
            if (!isNaN(dt)) {
              const y = dt.getFullYear();
              const m = String(dt.getMonth() + 1).padStart(2, '0');
              const d = String(dt.getDate()).padStart(2, '0');
              parsed = `${y}-${m}-${d}`;
            }
          }
          if (parsed) {
            rowTanggal = parsed;
          }
        }

        // Picker & Sorter: tiap zona
        for (const { zona, colBatch, colQty, colKont } of zonaGroups) {
          const batchVal = row[colBatch];
          const batch = (batchVal !== '' && batchVal !== null && batchVal !== undefined)
            ? String(batchVal).trim() : '';
          if (!batch || batch === '0') continue;

          const qty  = parseFloat(row[colQty])  || 0;
          const kont = parseFloat(row[colKont]) || 0;

          if (qty > 0) {
            const key = `${rowTanggal}|${zona}|${batch}`;
            pickerAgg[key] = (pickerAgg[key] || 0) + qty;
            pickerTokoCount[key] = (pickerTokoCount[key] || 0) + 1;
          }
          if (kont > 0) {
            const key = `${rowTanggal}|${zona}|${batch}`;
            sorterAgg[key] = (sorterAgg[key] || 0) + kont;
            sorterTokoCount[key] = (sorterTokoCount[key] || 0) + 1;
          }

          // Simpan per-toko record untuk rekap dashboard
          if (qty > 0 || kont > 0) {
            // Deteksi tipe_lokasi dari zona
            let tipe_lokasi = 'Ambient';
            if (zona.startsWith('F')) tipe_lokasi = 'Freezer';
            else if (zona.startsWith('R')) tipe_lokasi = 'Chiller';
            else if (zona.startsWith('T')) tipe_lokasi = 'Ambient';

            tokoRecords.push({
              tanggal_carian: rowTanggal,
              group_mob: String(row[1] || '').trim(),
              kcc: String(row[2] || '').trim(),
              ins: String(row[3] || '').trim(),
              nama_toko: namaToko,
              zona,
              tipe_lokasi,
              batch,
              qty_target: Math.round(qty),
              kont_target: Math.round(kont)
            });
          }
        }

        // Loader: sum per cluster + group mobil
        const groupMobil = String(row[1] || '').trim();
        if (groupMobil) {
          for (const { cluster, col } of LOADER_COLS) {
            const kont = parseFloat(row[col]) || 0;
            if (kont > 0) {
              const key = `${rowTanggal}|${cluster}|${groupMobil}`;
              loaderAgg[key] = (loaderAgg[key] || 0) + kont;
              loaderTokoCount[key] = (loaderTokoCount[key] || 0) + 1;
            }
          }
        }
      }


      // Buat records Picker
      let pickerCount = 0;
      for (const [key, total] of Object.entries(pickerAgg)) {
        if (total <= 0) continue;
        const [tgl, zona, batch] = key.split('|');
        const jumlah_toko = pickerTokoCount[key] || 0;
        records.push({ tanggal_carian: tgl, posisi: 'Picker', zona, batch, jumlah_toko, total_output: Math.round(total), satuan: 'pcs' });
        pickerCount++;
      }

      // Buat records Sorter
      let sorterCount = 0;
      for (const [key, total] of Object.entries(sorterAgg)) {
        if (total <= 0) continue;
        const [tgl, zona, batch] = key.split('|');
        const jumlah_toko = sorterTokoCount[key] || 0;
        records.push({ tanggal_carian: tgl, posisi: 'Sorter', zona, batch, jumlah_toko, total_output: Math.round(total), satuan: 'kontainer' });
        sorterCount++;
      }

      // Buat records Loader per cluster + group mobil
      let loaderCount = 0;
      for (const [key, total] of Object.entries(loaderAgg)) {
        if (total <= 0) continue;
        const [tgl, cluster, groupMobil] = key.split('|');
        const jumlah_toko = loaderTokoCount[key] || 0;
        records.push({ tanggal_carian: tgl, posisi: 'Loader', zona: cluster, batch: groupMobil, jumlah_toko, total_output: Math.round(total), satuan: 'kontainer' });
        loaderCount++;
      }

      if (pickerCount > 0) info.push(`Picker: ${pickerCount} batch`);
      if (sorterCount > 0) info.push(`Sorter: ${sorterCount} batch`);
      if (loaderCount > 0) info.push(`Loader: ${loaderCount} cluster`);
      if (pickerCount === 0 && sorterCount === 0 && loaderCount === 0) {
        skipped.push('Lembar Fix: Tidak ada data valid yang ditemukan. Pastikan data toko terisi di row 7 ke bawah.');
      }

      // Simpan per-toko records jika ada
      if (tokoRecords.length > 0) {
        try {
          // Hapus dulu data lama per-toko untuk tanggal yang sama (jika mode replace)
          if (mode === 'replace') {
            const tokoTanggalList = [...new Set(tokoRecords.map(r => r.tanggal_carian))];
            for (const tgl of tokoTanggalList) {
              await db.deleteTokoDataByTanggal(tgl);
            }
          }
          await db.bulkInsertTokoData(tokoRecords);
          info.push(`Rekap toko: ${tokoRecords.length} baris toko tersimpan`);
        } catch(e) {
          console.error('Gagal simpan per-toko data:', e.message);
          // Tidak fatal, lanjut saja
        }
      }

    } else if (dataUploadSheet) {
      // ====================================================
      // FORMAT: DATA UPLOAD SYSTEM (1 sheet, matrix besar)
      // Row 1 (idx 0): Posisi — PICKER / SHORTER / LOADER
      // Row 2 (idx 1): Zona  — F1, R1, R2, R3, T1..T5, FREZZER, CHILLER, AMBIENT
      // Row 3 (idx 2): Batch number (angka)
      // Row 4 (idx 3): Label lengkap — "PICKER ZONA F1 BATCH 1" / "LOADER ZONA FREZZER"
      // Row 5 (idx 4): QTY / ACT (header sub-kolom, tiap batch = 2 kolom: QTY, ACT)
      // Row 6+  (idx 5+): Data per toko — sum kolom QTY untuk total per batch
      //
      // OPTIMASI: Baca cell langsung via encode_cell, bukan sheet_to_json,
      // karena sheet_to_json sangat lambat untuk 321 kolom × 2000 baris.
      // ====================================================
      const ws = workbook.Sheets[dataUploadSheet];
      const wsRange = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
      const startRow = wsRange.s.r; // baris awal worksheet (bisa 0 atau 1 jika row 1 Excel kosong)
      const maxCol   = wsRange.e.c; // last column index (0-based)
      const maxRow   = wsRange.e.r; // last row index (0-based)

      // Helper: ambil nilai cell (row & col 0-based, ABSOLUTE index)
      // Support both normal mode (ws['A1']) and dense mode (ws['!data'][r][c])
      const cellVal = (r, c) => {
        if (ws['!data']) {
          const cell = ws['!data'][r] && ws['!data'][r][c];
          return cell ? cell.v : '';
        }
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        return cell ? cell.v : '';
      };

      // Normalisasi nama posisi
      const normPosisi = (p) => {
        const u = String(p).trim().toUpperCase();
        if (u === 'PICKER')  return 'Picker';
        if (u === 'SHORTER' || u === 'SORTER') return 'Sorter';
        if (u === 'LOADER')  return 'Loader';
        return null;
      };

      // Satuan per posisi
      const satuanOf = (p) => (p === 'Picker' ? 'pcs' : 'kontainer');

      // Struktur header (relative ke startRow):
      // +0: Posisi (PICKER/SHORTER/LOADER)
      // +1: Zona (F1, R1, T1...)
      // +2: Batch number
      // +3: Label lengkap ("PICKER ZONA F1 BATCH 1")
      // +4: QTY / ACT
      // +5 dst: data per toko
      const rowLabel  = startRow + 3; // Row dengan label lengkap
      const rowHeader = startRow + 4; // Row dengan QTY/ACT
      const dataStart = startRow + 5; // Baris data pertama

      // Bangun peta kolom dari header cells saja (cepat)
      const batchColMap = []; // { col, posisi, zona, batch, label }
      for (let col = 7; col <= maxCol; col++) {
        const label  = String(cellVal(rowLabel,  col) || '').trim();
        const header = String(cellVal(rowHeader, col) || '').trim().toUpperCase();
        if (label === '' || header !== 'QTY') continue;

        // Parse label: "PICKER ZONA F1 BATCH 1", "SHORTER ZONA T1 BATCH 2", "LOADER ZONA FREZZER"
        const m1 = label.match(/^(PICKER|SHORTER|SORTER|LOADER)\s+ZONA\s+([A-Z0-9]+)\s+BATCH\s+(\d+)$/i);
        const m2 = label.match(/^(LOADER)\s+ZONA\s+([A-Z0-9]+)\s*$/i);

        let posisiRaw, zona, batch;
        if (m1) {
          posisiRaw = m1[1]; zona = m1[2].toUpperCase(); batch = String(parseInt(m1[3]));
        } else if (m2) {
          posisiRaw = m2[1]; zona = m2[2].toUpperCase(); batch = '1';
        } else {
          // Fallback: ambil dari row Posisi dan Zona
          posisiRaw = String(cellVal(startRow + 0, col) || '').trim();
          zona      = String(cellVal(startRow + 1, col) || '').trim().toUpperCase();
          batch     = String(cellVal(startRow + 2, col) || '').trim();
          if (!posisiRaw || !zona || !batch) continue;
        }

        const posisi = normPosisi(posisiRaw);
        if (!posisi) continue;
        batchColMap.push({ col, posisi, zona, batch, label });
      }

      if (batchColMap.length === 0) {
        skipped.push('DATA UPLOAD SYSTEM: Tidak menemukan kolom batch yang valid (pastikan Row 4 berisi label seperti "PICKER ZONA F1 BATCH 1")');
      } else {
        // SUM kolom QTY langsung via cell address — mulai dari baris data pertama
        const totals = {}; // col → total
        const loaderClusterTotals = {}; // col → { cluster → sum }
        const isDense = !!ws['!data'];
        
        for (let r = dataStart; r <= maxRow; r++) {
          const clusterVal = String(cellVal(r, 3) || '').trim().toUpperCase();
          for (const { col, posisi } of batchColMap) {
            let cell;
            if (isDense) {
              cell = ws['!data'][r] && ws['!data'][r][col];
            } else {
              cell = ws[XLSX.utils.encode_cell({ r, c: col })];
            }
            if (cell && typeof cell.v === 'number' && cell.v > 0) {
              totals[col] = (totals[col] || 0) + cell.v;
              if (posisi === 'Loader') {
                if (clusterVal) {
                  if (!loaderClusterTotals[col]) loaderClusterTotals[col] = {};
                  loaderClusterTotals[col][clusterVal] = (loaderClusterTotals[col][clusterVal] || 0) + cell.v;
                }
              }
            }
          }
        }

        let pickerCount = 0, sorterCount = 0, loaderCount = 0;
        for (const { col, posisi, zona, batch, label } of batchColMap) {
          if (posisi === 'Loader') {
            const clusterMap = loaderClusterTotals[col] || {};
            const clusters = Object.keys(clusterMap);
            if (clusters.length === 0) {
              skipped.push(`${label}: tidak ada data QTY per cluster, dilewati`);
              continue;
            }
            for (const cluster of clusters) {
              const total_output = clusterMap[cluster];
              records.push({ tanggal_carian, posisi, zona, batch: cluster, jumlah_toko: 0, total_output, satuan: satuanOf(posisi) });
              loaderCount++;
            }
          } else {
            const total_output = totals[col] || 0;
            if (total_output <= 0) {
              skipped.push(`${label}: total QTY = 0, dilewati`);
              continue;
            }
            records.push({ tanggal_carian, posisi, zona, batch, jumlah_toko: 0, total_output, satuan: satuanOf(posisi) });
            if (posisi === 'Picker')       pickerCount++;
            else if (posisi === 'Sorter') sorterCount++;
          }
        }

        if (pickerCount > 0) info.push(`Picker: ${pickerCount} batch`);
        if (sorterCount > 0) info.push(`Sorter: ${sorterCount} batch`);
        if (loaderCount > 0) info.push(`Loader: ${loaderCount} cluster`);
      }

    } else if (isSS08Format) {
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
              records.push({ tanggal_carian, posisi: 'Loader', zona, batch: bParts.join('_'), jumlah_toko: 0, total_output: total, satuan: 'kontainer' });
              loaderCount++;
            }
          });
          info.push(`Loader: ${loaderCount} kombinasi zona+batch`);
        } else skipped.push('Loader: Tidak menemukan header zona (F1/R1/T1 dst)');
      }

    } else {
      // === SIMPLE TEMPLATE FORMAT: Posisi | Zona | Kode Toko (Batch) | [Jumlah Toko] | Total Output ===
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      let headerRowIdx = -1;
      let colMap = {};
      for (let i = 0; i < Math.min(10, rawData.length); i++) {
        const row = rawData[i].map(c => String(c).toLowerCase().trim());
        const pIdx = row.findIndex(c => c.includes('posisi'));
        const zIdx = row.findIndex(c => c.includes('zona'));
        const bIdx = row.findIndex(c => c.includes('batch') || c.includes('kode toko') || c.includes('kode'));
        const oIdx = row.findIndex(c => c.includes('total output') || c === 'output');
        // Kolom jumlah_toko opsional
        const jIdx = row.findIndex(c => c.includes('jumlah toko'));
        if (pIdx !== -1 && zIdx !== -1 && bIdx !== -1 && oIdx !== -1) {
          headerRowIdx = i;
          colMap = { posisi: pIdx, zona: zIdx, batch: bIdx, output: oIdx, jumlah_toko: jIdx };
          break;
        }
      }
      if (headerRowIdx === -1) {
        return res.status(400).json({ error: 'Format Excel tidak dikenali.', hint: 'Gunakan: (1) File "DATA UPLOAD EXCEL" (sheet "DATA UPLOAD SYSTEM"), (2) Register SS08 (sheet Picker/Sorter/Loader), atau (3) template dengan kolom: Posisi | Zona | Kode Toko (Batch) | Jumlah Toko | Total Output' });
      }
      for (let i = headerRowIdx + 1; i < rawData.length; i++) {
        const row = rawData[i];
        const posisi = String(row[colMap.posisi] || '').trim();
        const zona = String(row[colMap.zona] || '').trim();
        const batch = String(row[colMap.batch] || '').trim();
        const total_output = parseInt(row[colMap.output]);
        const jumlah_toko = colMap.jumlah_toko !== -1 ? (parseInt(row[colMap.jumlah_toko]) || 0) : 0;
        if (!posisi || !zona || !batch || isNaN(total_output) || total_output <= 0) continue;
        const posisiNorm = posisi.charAt(0).toUpperCase() + posisi.slice(1).toLowerCase();
        if (!['Picker', 'Sorter', 'Loader'].includes(posisiNorm)) continue;
        records.push({ tanggal_carian, posisi: posisiNorm, zona, batch, jumlah_toko, total_output, satuan: posisiNorm === 'Picker' ? 'pcs' : 'kontainer' });
      }
    }

    // Group Loader records by tanggal_carian and batch to combine their zones
    const finalRecords = [];
    const loaderGroups = {}; // key: `${tanggal_carian}|${batch}` -> record
    
    for (const r of records) {
      if (r.posisi === 'Loader') {
        const key = `${r.tanggal_carian}|${r.batch}`;
        if (!loaderGroups[key]) {
          loaderGroups[key] = {
            tanggal_carian: r.tanggal_carian,
            posisi: 'Loader',
            zonaSet: new Set([r.zona]),
            batch: r.batch,
            jumlah_toko: r.jumlah_toko || 0,
            total_output: r.total_output || 0,
            satuan: r.satuan || 'kontainer'
          };
        } else {
          loaderGroups[key].total_output += r.total_output || 0;
          loaderGroups[key].jumlah_toko = Math.max(loaderGroups[key].jumlah_toko, r.jumlah_toko || 0);
          loaderGroups[key].zonaSet.add(r.zona);
        }
      } else {
        finalRecords.push(r);
      }
    }
    
    for (const lr of Object.values(loaderGroups)) {
      const zonesList = Array.from(lr.zonaSet)
        .map(z => z.trim())
        .filter(Boolean)
        .map(z => z.toUpperCase());
      lr.zona = zonesList.length > 0 ? zonesList.sort().join(', ') : 'LOADER';
      delete lr.zonaSet;
      finalRecords.push(lr);
    }
    
    records = finalRecords;

    if (records.length === 0) {
      return res.status(400).json({ error: 'Tidak ada data valid yang berhasil diparse.', skipped, info });
    }

    // Kumpulkan tanggal unik dari records (bisa berbeda dari tanggal_carian di form)
    const uniqueTanggal = [...new Set(records.map(r => r.tanggal_carian))];

    // Jika mode = 'replace', hapus dulu data lama untuk semua tanggal yang ada di records
    if (mode === 'replace') {
      for (const tgl of uniqueTanggal) {
        await db.deleteDataCarianByTanggal(tgl);
      }
    }

    // Upsert semua record
    const inserted = await db.bulkUpsertDataCarian(records);
    uniqueTanggal.forEach(tgl => invalidateDcCache(tgl)); // clear cache setelah import

    await db.insertAuditLog(req.user.username, 'IMPORT_EXCEL_CARIAN', `Mengimport ${inserted.length} data carian (Tanggal: ${tanggal_carian}, Mode: ${mode})`);

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
      ['Posisi', 'Zona', 'Kode Toko (Batch)', 'Jumlah Toko', 'Total Output'],
      ['Picker', 'T1', '1', 5, 500],
      ['Picker', 'T1', '2', 6, 450],
      ['Picker', 'T2', '3', 8, 600],
      ['Sorter', 'T1', '1', 5, 120],
      ['Loader', 'F1', 'BOG01', 3, 80],
      ['Loader', 'R1', 'CJR01', 4, 60],
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);
    ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 15 }, { wch: 15 }];

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

// GET /api/export-data-carian — Export data carian ke Excel (dengan kode toko/batch)
app.get('/api/export-data-carian', requireAuth, async (req, res) => {
  try {
    const { tanggal } = req.query;
    let records;
    if (tanggal) {
      records = await db.getDataCarian(tanggal);
    } else {
      records = await db.getDataCarian();
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Formulir Pencapaian Kerja SS08';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Data Carian', {
      views: [{ state: 'frozen', ySplit: 1 }]
    });

    sheet.columns = [
      { header: 'No',            key: 'no',           width: 6  },
      { header: 'Tanggal Carian',key: 'tanggal',      width: 16 },
      { header: 'Posisi',        key: 'posisi',       width: 12 },
      { header: 'Zona',          key: 'zona',         width: 10 },
      { header: 'Kode Toko',     key: 'batch',        width: 18 },
      { header: 'Jumlah Toko',   key: 'jumlah_toko',  width: 14 },
      { header: 'Total Output',  key: 'output',       width: 16 },
      { header: 'Satuan',        key: 'satuan',       width: 12 },
    ];

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A4799' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FFAEC6E8' } } };
    });
    headerRow.height = 22;

    const POSISI_COLOR = {
      Picker: 'FFDBEDFF',
      Sorter: 'FFFFFBDB',
      Loader: 'FFFFE4D0',
    };

    records.forEach((r, i) => {
      const row = sheet.addRow({
        no:          i + 1,
        tanggal:     r.tanggal_carian || '',
        posisi:      r.posisi || '',
        zona:        r.zona || '',
        batch:       r.batch || '',
        jumlah_toko: r.jumlah_toko || 0,
        output:      r.total_output || 0,
        satuan:      r.satuan || '',
      });

      const bg = POSISI_COLOR[r.posisi] || (i % 2 === 0 ? 'FFFAFAFA' : 'FFEFEFEF');
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = { name: 'Calibri', size: 10 };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } } };
      });
      row.getCell('no').alignment = { horizontal: 'center' };
      row.getCell('posisi').alignment = { horizontal: 'center' };
      row.getCell('zona').alignment = { horizontal: 'center' };
      row.getCell('jumlah_toko').alignment = { horizontal: 'center' };
      row.getCell('output').alignment = { horizontal: 'right' };
      row.getCell('output').font = { bold: true, name: 'Calibri', size: 10 };
      row.getCell('satuan').alignment = { horizontal: 'center' };
      row.height = 18;
    });

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1, column: sheet.columns.length }
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const dateStr = tanggal || new Date().toISOString().slice(0, 10);
    const filename = `data-carian-${dateStr}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Export data carian error:', err);
    res.status(500).send('Gagal mengekspor data carian.');
  }
});

// POST /api/data-carian/push-sheets — Push data carian harian ke Google Sheets (append ke bawah)
app.post('/api/data-carian/push-sheets', requireAuth, async (req, res) => {
  try {
    if (!googleSheets.isConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'Google Sheets belum dikonfigurasi. Tambahkan GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, dan GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ke file .env'
      });
    }
    const { tanggal } = req.body;
    let records;
    if (tanggal) {
      records = await db.getDataCarianWithStatus(tanggal);
    } else {
      records = await db.getDataCarian();
    }
    const result = await googleSheets.appendDataCarianToSheet(records, tanggal);
    res.json(result);
  } catch (err) {
    console.error('Push data carian to sheets error:', err);
    res.status(500).json({ success: false, message: 'Gagal push ke Google Sheets: ' + err.message });
  }
});

// ==================== USER MANAGEMENT ROUTES (Admin only) ====================

// GET /api/users — List semua user operasional
app.get('/api/users', requirePermission('users'), async (req, res) => {
  try {
    const users = await db.getAllOperationalUsers();
    res.json(users);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Gagal memuat data user.' });
  }
});

// POST /api/users — Buat user operasional baru
app.post('/api/users', requirePermission('users'), async (req, res) => {
  try {
    const { username, nama_lengkap, nik, posisi, tipe_karyawan, nomor_hp } = req.body;
    if (!username || !nama_lengkap || !nik || !posisi) {
      return res.status(400).json({ error: 'Semua field (username, nama lengkap, NIK, posisi) wajib diisi.' });
    }
    if (!['Picker', 'Sorter', 'Loader'].includes(posisi)) {
      return res.status(400).json({ error: 'Posisi harus Picker, Sorter, atau Loader.' });
    }
    if (tipe_karyawan && !['Productivity', 'PHL'].includes(tipe_karyawan)) {
      return res.status(400).json({ error: 'Tipe Karyawan harus Productivity atau PHL.' });
    }
    const user = await db.createOperationalUser({
      username: username.trim(),
      nama_lengkap: nama_lengkap.trim(),
      nik: nik.trim(),
      posisi,
      tipe_karyawan: tipe_karyawan || null,
      nomor_hp: nomor_hp ? nomor_hp.trim() : null
    });
    await db.insertAuditLog(req.user.username, 'CREATE_USER', `Membuat user operasional baru: ${username} (${posisi}, ${tipe_karyawan || 'Belum Ditentukan'}, HP: ${nomor_hp || '-'})`);
    res.json({ success: true, data: user });
  } catch (err) {
    console.error('Create user error:', err);
    const msg = err.message.includes('sudah digunakan') ? err.message : 'Gagal membuat user.';
    res.status(400).json({ error: msg });
  }
});

// DELETE /api/users/:id — Hapus user operasional
app.delete('/api/users/:id', requirePermission('users'), async (req, res) => {
  try {
    const targetUser = await db.getUserById(req.params.id);
    await db.deleteUser(req.params.id);
    if (targetUser) {
      await db.insertAuditLog(req.user.username, 'DELETE_USER', `Menghapus user operasional: ${targetUser.username} (${targetUser.posisi})`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Gagal menghapus user.' });
  }
});

// PATCH /api/users/:id/toggle-status — Aktifkan/Nonaktifkan user operasional
app.patch('/api/users/:id/toggle-status', requirePermission('users'), async (req, res) => {
  try {
    const updated = await db.toggleUserStatus(req.params.id);
    const statusLabel = updated.is_active === false ? 'dinonaktifkan' : 'diaktifkan';
    await db.insertAuditLog(req.user.username, 'TOGGLE_USER_STATUS', `User operasional ${updated.username} (${updated.nama_lengkap}) telah ${statusLabel}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Toggle user status error:', err);
    res.status(500).json({ error: 'Gagal mengubah status user.' });
  }
});

// PUT /api/users/:id — Edit user operasional
app.put('/api/users/:id', requirePermission('users'), async (req, res) => {
  try {
    const { username, nama_lengkap, nik, posisi, tipe_karyawan, nomor_hp } = req.body;
    if (!username || !nama_lengkap || !nik || !posisi) {
      return res.status(400).json({ error: 'Semua field (username, nama lengkap, NIK, posisi) wajib diisi.' });
    }
    if (!['Picker', 'Sorter', 'Loader'].includes(posisi)) {
      return res.status(400).json({ error: 'Posisi harus Picker, Sorter, atau Loader.' });
    }
    if (tipe_karyawan && !['Productivity', 'PHL'].includes(tipe_karyawan)) {
      return res.status(400).json({ error: 'Tipe Karyawan harus Productivity atau PHL.' });
    }
    const user = await db.updateOperationalUser(req.params.id, {
      username: username.trim(),
      nama_lengkap: nama_lengkap.trim(),
      nik: nik.trim(),
      posisi,
      tipe_karyawan: tipe_karyawan || null,
      nomor_hp: nomor_hp ? nomor_hp.trim() : null
    });
    await db.insertAuditLog(req.user.username, 'UPDATE_USER', `Mengubah data user operasional: ${username} (${posisi}, ${tipe_karyawan || 'Belum Ditentukan'}, HP: ${nomor_hp || '-'})`);
    res.json({ success: true, data: user });
  } catch (err) {
    console.error('Update user error:', err);
    const msg = err.message.includes('sudah digunakan') ? err.message : 'Gagal mengupdate user.';
    res.status(400).json({ error: msg });
  }
});

// ==================== STATUS CARIAN & WA REMINDER ====================

// GET /api/status-carian?tanggal=YYYY-MM-DD
// Ambil daftar user yang sudah & belum input carian/submissions hari ini
app.get('/api/status-carian', requirePermission('status-carian'), async (req, res) => {
  try {
    const tanggal = req.query.tanggal || new Date().toISOString().slice(0, 10);

    // Ambil daftar absensi untuk tanggal tersebut
    const absensiHariIni = await db.getAbsensiByTanggal(tanggal);
    const hadirUserIds = new Set(absensiHariIni.map(a => a.user_id));
    const isFilteredByAbsensi = hadirUserIds.size > 0;

    // Ambil semua user operasional yang aktif (Picker & Sorter)
    const allUsers = await db.getAllOperationalUsers();
    const pickerSorter = allUsers.filter(u => {
      const isActive = u.is_active !== false;
      const isPickerSorter = u.posisi === 'Picker' || u.posisi === 'Sorter';
      if (!isActive || !isPickerSorter) return false;
      
      // Jika ada absensi hari ini, filter hanya yang Hadir
      if (isFilteredByAbsensi) {
        return hadirUserIds.has(u.id);
      }
      return true;
    });

    // Ambil submissions untuk tanggal tersebut
    const allSubmissions = await db.getAllSubmissions();
    const submissionsHariIni = allSubmissions.filter(s => s.tanggal_carian === tanggal);

    // Siapa yang sudah submit (berdasarkan username match)
    const sudahSubmit = new Set(submissionsHariIni.map(s => s.username?.toLowerCase()));

    const sudah = [];
    const belum = [];

    pickerSorter.forEach(u => {
      const waktuSubmit = submissionsHariIni
        .filter(s => s.username?.toLowerCase() === u.username?.toLowerCase())
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

      if (sudahSubmit.has(u.username?.toLowerCase())) {
        sudah.push({
          id: u.id,
          nama: u.nama_lengkap || u.username,
          username: u.username,
          posisi: u.posisi,
          nomor_hp: u.nomor_hp || null,
          waktu_submit: waktuSubmit?.created_at || null
        });
      } else {
        belum.push({
          id: u.id,
          nama: u.nama_lengkap || u.username,
          username: u.username,
          posisi: u.posisi,
          nomor_hp: u.nomor_hp || null
        });
      }
    });

    res.json({ tanggal, sudah, belum, total_picker_sorter: pickerSorter.length, is_filtered_by_absensi: isFilteredByAbsensi });
  } catch (err) {
    console.error('Status carian error:', err);
    res.status(500).json({ error: 'Gagal memuat status carian.' });
  }
});

// POST /api/send-wa-reminder — Kirim notif WA via Fonnte ke yang belum input
app.post('/api/send-wa-reminder', requirePermission('status-carian'), async (req, res) => {
  const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
  if (!FONNTE_TOKEN || FONNTE_TOKEN === 'ISI_TOKEN_FONNTE_ANDA_DI_SINI') {
    return res.status(503).json({ error: 'FONNTE_TOKEN belum dikonfigurasi. Silakan isi token Fonnte di environment variables.' });
  }

  try {
    const { targets, tanggal, pesan_custom } = req.body;
    // targets: array of { nomor_hp, nama }
    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'Tidak ada target penerima notifikasi.' });
    }

    const tanggalFormatted = tanggal
      ? new Date(tanggal).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const target of targets) {
      if (!target.nomor_hp) {
        results.push({ nama: target.nama, status: 'skip', reason: 'Nomor HP tidak tersedia' });
        failCount++;
        continue;
      }

      // Format nomor HP (pastikan pakai format internasional)
      let nomor = target.nomor_hp.replace(/\D/g, ''); // hapus non-digit
      if (nomor.startsWith('0')) nomor = '62' + nomor.slice(1); // 08xx → 628xx
      if (!nomor.startsWith('62')) nomor = '62' + nomor;

      const pesan = pesan_custom ||
        `Halo ${target.nama}! 👋\n\nKami ingatkan bahwa kamu *belum menginput data carian* untuk tanggal *${tanggalFormatted}*.\n\nMohon segera lakukan input sebelum hari ini berakhir ya.\n\nTerima kasih! 🙏\n- Tim SS08`;

      try {
        const response = await fetch('https://api.fonnte.com/send', {
          method: 'POST',
          headers: {
            'Authorization': FONNTE_TOKEN,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            target: nomor,
            message: pesan,
            countryCode: '62'
          })
        });

        const data = await response.json();
        if (data.status) {
          results.push({ nama: target.nama, nomor, status: 'success' });
          successCount++;
        } else {
          results.push({ nama: target.nama, nomor, status: 'failed', reason: data.reason || 'Unknown error' });
          failCount++;
        }
      } catch (fetchErr) {
        results.push({ nama: target.nama, nomor, status: 'failed', reason: fetchErr.message });
        failCount++;
      }

      // Delay kecil antar pesan agar tidak rate-limited
      await new Promise(r => setTimeout(r, 300));
    }

    await db.insertAuditLog(
      req.user.username,
      'SEND_WA_REMINDER',
      `Kirim reminder WA tanggal ${tanggal}: ${successCount} berhasil, ${failCount} gagal`
    );

    res.json({ success: true, successCount, failCount, results });
  } catch (err) {
    console.error('Send WA reminder error:', err);
    res.status(500).json({ error: 'Gagal mengirim notifikasi WA.' });
  }
});

// ==================== ADMIN ACCOUNT MANAGEMENT ROUTES ====================


// GET /api/admin-accounts — List semua akun admin (Super Admin only)
app.get('/api/admin-accounts', requireSuperAdmin, async (req, res) => {
  try {
    const admins = await db.getAllAdminUsers();
    res.json(admins);
  } catch (err) {
    console.error('Get admin accounts error:', err);
    res.status(500).json({ error: 'Gagal memuat data akun admin.' });
  }
});

// POST /api/admin-accounts — Buat akun admin baru (Super Admin only)
app.post('/api/admin-accounts', requireSuperAdmin, async (req, res) => {
  try {
    const { username, nama_lengkap, password, allowed_pages } = req.body;
    if (!username || !nama_lengkap || !password) {
      return res.status(400).json({ error: 'Username, nama lengkap, dan password wajib diisi.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    }
    const admin = await db.createAdminUser({ 
      username: username.trim(), 
      nama_lengkap: nama_lengkap.trim(), 
      password,
      allowed_pages: allowed_pages || []
    });
    await db.insertAuditLog(req.user.username, 'CREATE_ADMIN', `Membuat akun admin baru: ${username}`);
    res.json({ success: true, data: admin });
  } catch (err) {
    console.error('Create admin account error:', err);
    const msg = err.message.includes('sudah digunakan') ? err.message : 'Gagal membuat akun admin.';
    res.status(400).json({ error: msg });
  }
});

// PUT /api/admin-accounts/:id/permissions — Update izin akses admin (Super Admin only)
app.put('/api/admin-accounts/:id/permissions', requireSuperAdmin, async (req, res) => {
  try {
    const { allowed_pages } = req.body;
    if (!Array.isArray(allowed_pages)) {
      return res.status(400).json({ error: 'allowed_pages harus berupa array.' });
    }
    const targetAdmin = await db.getUserById(req.params.id);
    if (!targetAdmin) return res.status(404).json({ error: 'Akun admin tidak ditemukan.' });
    
    await db.updateAdminPermissions(req.params.id, allowed_pages);
    await db.insertAuditLog(req.user.username, 'UPDATE_ADMIN_PERMISSIONS', `Mengubah hak akses admin: ${targetAdmin.username} menjadi [${allowed_pages.join(', ')}]`);
    res.json({ success: true });
  } catch (err) {
    console.error('Update admin permissions error:', err);
    res.status(500).json({ error: 'Gagal mengupdate hak akses admin.' });
  }
});

// DELETE /api/admin-accounts/:id — Hapus akun admin (Super Admin only)
app.delete('/api/admin-accounts/:id', requireSuperAdmin, async (req, res) => {
  try {
    const decoded = jwt.verify(req.cookies.token, JWT_SECRET);
    if (decoded.userId === req.params.id) {
      return res.status(400).json({ error: 'Tidak dapat menghapus akun sendiri yang sedang aktif.' });
    }
    const targetAdmin = await db.getUserById(req.params.id);
    await db.deleteAdminUser(req.params.id);
    if (targetAdmin) {
      await db.insertAuditLog(req.user.username, 'DELETE_ADMIN', `Menghapus akun admin: ${targetAdmin.username}`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete admin account error:', err);
    const msg = err.message.includes('sendiri') || err.message.includes('ditemukan') ? err.message : 'Gagal menghapus akun admin.';
    res.status(400).json({ error: msg });
  }
});

// POST /api/admin-accounts/change-password — Ganti password sendiri
app.post('/api/admin-accounts/change-password', requireAdmin, async (req, res) => {
  try {
    const decoded = jwt.verify(req.cookies.token, JWT_SECRET);
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Password lama dan password baru wajib diisi.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
    }
    await db.updateAdminPassword(decoded.userId, currentPassword, newPassword);
    await db.insertAuditLog(req.user.username, 'CHANGE_PASSWORD', `Mengubah password akun admin`);
    res.json({ success: true });
  } catch (err) {
    console.error('Change admin password error:', err);
    const msg = err.message.includes('tidak cocok') || err.message.includes('ditemukan') ? err.message : 'Gagal mengubah password.';
    res.status(400).json({ error: msg });
  }
});

// POST /api/user/change-nik — Ganti password sendiri (khusus user operasional)
app.post('/api/user/change-nik', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'operasional') {
      return res.status(403).json({ error: 'Fitur ini hanya untuk user operasional.' });
    }
    const { currentNik, newNik } = req.body;
    if (!currentNik || !newNik) {
      return res.status(400).json({ error: 'Password lama dan password baru wajib diisi.' });
    }
    if (newNik.trim().length < 4) {
      return res.status(400).json({ error: 'Password baru minimal 4 karakter.' });
    }
    await db.changeUserNik(user.userId, currentNik, newNik);
    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    const msg = err.message.includes('tidak cocok') || err.message.includes('ditemukan') || err.message.includes('digunakan')
      ? err.message : 'Gagal mengubah password.';
    res.status(400).json({ error: msg });
  }
});

// ==================== REKAP TOKO ROUTES ====================

// GET /api/rekap-toko?tanggal=YYYY-MM-DD — Rekap per toko dengan actual dari submissions
app.get('/api/rekap-toko', requireAuth, async (req, res) => {
  try {
    const { tanggal } = req.query;
    if (!tanggal) {
      return res.status(400).json({ error: 'Parameter tanggal wajib diisi.' });
    }
    const data = await db.getTokoDataWithActual(tanggal);
    res.json(data);
  } catch (err) {
    console.error('Get rekap toko error:', err);
    res.status(500).json({ error: 'Gagal memuat data rekap toko.' });
  }
});

// GET /api/rekap-toko/tanggal-list — Daftar tanggal yang punya data toko
app.get('/api/rekap-toko/tanggal-list', requireAuth, async (req, res) => {
  try {
    const dates = await db.getTokoDataTanggalList();
    res.json(dates);
  } catch (err) {
    console.error('Get rekap toko tanggal list error:', err);
    res.status(500).json({ error: 'Gagal memuat daftar tanggal.' });
  }
});

// DELETE /api/rekap-toko/tanggal/:tanggal — Hapus data toko untuk tanggal tertentu
app.delete('/api/rekap-toko/tanggal/:tanggal', requireAuth, async (req, res) => {
  try {
    await db.deleteTokoDataByTanggal(req.params.tanggal);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete rekap toko error:', err);
    res.status(500).json({ error: 'Gagal menghapus data rekap toko.' });
  }
});

// ==================== ANNOUNCEMENTS ROUTES ====================

// GET /api/announcements — Public: get active announcements only
app.get('/api/announcements', async (req, res) => {
  try {
    const data = await db.getActiveAnnouncements();
    res.json(data);
  } catch (err) {
    console.error('Get announcements error:', err);
    res.status(500).json({ error: 'Gagal memuat pengumuman.' });
  }
});

// GET /api/announcements/all — Admin: get all (active + inactive)
app.get('/api/announcements/all', requireAuth, async (req, res) => {
  try {
    const data = await db.getAllAnnouncements();
    res.json(data);
  } catch (err) {
    console.error('Get all announcements error:', err);
    res.status(500).json({ error: 'Gagal memuat pengumuman.' });
  }
});

// POST /api/announcements — Admin: create new
app.post('/api/announcements', requireAuth, async (req, res) => {
  try {
    const { title, content, type, emoji } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title dan content wajib diisi.' });
    const record = await db.createAnnouncement({
      title, content, type, emoji,
      created_by: req.user?.username || 'admin'
    });
    await db.insertAuditLog(req.user?.username, 'CREATE_ANNOUNCEMENT', `Buat pengumuman: ${title}`);
    res.json(record);
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Gagal membuat pengumuman.' });
  }
});

// PUT /api/announcements/:id — Admin: update
app.put('/api/announcements/:id', requireAuth, async (req, res) => {
  try {
    const { title, content, type, emoji, is_active } = req.body;
    const record = await db.updateAnnouncement(req.params.id, { title, content, type, emoji, is_active });
    await db.insertAuditLog(req.user?.username, 'UPDATE_ANNOUNCEMENT', `Update pengumuman: ${title}`);
    res.json(record);
  } catch (err) {
    console.error('Update announcement error:', err);
    res.status(500).json({ error: 'Gagal update pengumuman.' });
  }
});

// PATCH /api/announcements/:id/toggle — Admin: toggle active/inactive
app.patch('/api/announcements/:id/toggle', requireAuth, async (req, res) => {
  try {
    const record = await db.toggleAnnouncement(req.params.id);
    res.json(record);
  } catch (err) {
    console.error('Toggle announcement error:', err);
    res.status(500).json({ error: 'Gagal toggle pengumuman.' });
  }
});

// DELETE /api/announcements/:id — Admin: delete
app.delete('/api/announcements/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteAnnouncement(req.params.id);
    await db.insertAuditLog(req.user?.username, 'DELETE_ANNOUNCEMENT', `Hapus pengumuman ID: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete announcement error:', err);
    res.status(500).json({ error: 'Gagal menghapus pengumuman.' });
  }
});

// ==================== LOADER ENTRIES ROUTES ====================


// GET /api/loader-entries — Semua atau filter per tanggal (lengkap dengan info file/foto)
app.get('/api/loader-entries', requireAuth, async (req, res) => {
  try {
    const { tanggal_carian } = req.query;
    const entries = await db.getAllLoaderEntries(tanggal_carian || null);
    
    // Ambil list file untuk masing-masing loader entry secara paralel
    const entriesWithFiles = await Promise.all(entries.map(async (e) => {
      const files = await db.getFilesBySubmissionId(e.id);
      return { ...e, files: files || [] };
    }));
    
    res.json(entriesWithFiles);
  } catch (err) {
    console.error('Get loader entries error:', err);
    res.status(500).json({ error: 'Gagal memuat data loader.' });
  }
});

// GET /api/loader-entries/:id — Detail loader entry lengkap dengan file/foto
app.get('/api/loader-entries/:id', requireAuth, async (req, res) => {
  try {
    const entry = await db.getLoaderEntryById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry loader tidak ditemukan.' });
    
    const files = await db.getFilesBySubmissionId(entry.id);
    res.json({ ...entry, files: files || [] });
  } catch (err) {
    console.error('Get loader entry detail error:', err);
    res.status(500).json({ error: 'Gagal memuat detail loader.' });
  }
});

// POST /api/loader-entries — Submit entry loader baru (multipart/form-data + optional file upload)
app.post('/api/loader-entries', requireAuth, (req, res, next) => {
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
    const { tanggal_carian, tanggal_kirim, nama, zona, no_polisi, catatan } = req.body;
    if (!tanggal_carian || !tanggal_kirim || !nama || !no_polisi) {
      return res.status(400).json({ error: 'Tanggal carian, tanggal kirim, nama, dan no. polisi wajib diisi.' });
    }

    // Validasi: lembar register wajib diupload - REMOVED

    // Parse JSON fields yang dikirim via FormData
    let clusters = [];
    let cluster_outputs = {};
    let non_group = { gacoan: 0, dikichi: 0, benfarm: 0 };
    let jumlah_kontainer = 0;
    try { clusters = JSON.parse(req.body.clusters || '[]'); } catch(e) {}
    try { cluster_outputs = JSON.parse(req.body.cluster_outputs || '{}'); } catch(e) {}
    try { non_group = JSON.parse(req.body.non_group || '{}'); } catch(e) {}
    jumlah_kontainer = parseInt(req.body.jumlah_kontainer) || 0;

    if ((!clusters || clusters.length === 0) && (!non_group || (non_group.gacoan + non_group.dikichi + non_group.benfarm === 0))) {
      return res.status(400).json({ error: 'Isi minimal satu cluster atau non-group.' });
    }

    // Upload files jika ada
    const uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const fileId = uuidv4();
        const uniqueFilename = fileId + path.extname(file.originalname);
        const fileUrl = await db.saveUploadedFile(uniqueFilename, file.buffer, file.mimetype);
        uploadedFiles.push({ id: fileId, filename: uniqueFilename, original_name: file.originalname, file_path: fileUrl });
      }
    }

    const entry = await db.insertLoaderEntry({
      tanggal_carian, tanggal_kirim, nama, zona, no_polisi,
      clusters: clusters || [],
      cluster_outputs: cluster_outputs || {},
      non_group: non_group || { gacoan: 0, dikichi: 0, benfarm: 0 },
      jumlah_kontainer,
      catatan: catatan || ''
    });

    // Simpan files ke tabel files (linked ke loader entry)
    // Catatan: jika FK constraint ada (files.submission_id → submissions), ini akan fail
    // → gunakan try/catch agar entry tetap tersimpan, URL disimpan ke catatan sebagai fallback
    let photoUrlsFallback = [];
    for (const f of uploadedFiles) {
      try {
        await db.insertFile({
          id: uuidv4(),
          submission_id: entry.id,
          filename: f.filename,
          original_name: f.original_name,
          file_path: f.file_path
        });
      } catch (fileErr) {
        // FK constraint violation — simpan URL ke array fallback
        console.warn('[LoaderFiles] insertFile failed (FK constraint?), URL akan disimpan ke catatan:', fileErr.message);
        photoUrlsFallback.push(f.file_path);
      }
    }

    // Jika ada foto yang gagal di-insert ke files table, update catatan dengan URL-nya
    if (photoUrlsFallback.length > 0) {
      const photoTag = `[Photos: ${photoUrlsFallback.join(', ')}]`;
      try {
        await db.updateLoaderEntryCatatan(entry.id, 
          entry.catatan ? `${entry.catatan} ${photoTag}` : photoTag
        );
      } catch(e) {
        console.warn('[LoaderFiles] updateLoaderEntryCatatan fallback failed:', e.message);
      }
    }

    invalidateDcCache(tanggal_carian); // clear cache setelah submit baru
    res.json({ success: true, data: entry });

    // ===== AUTO-SYNC ke Google Sheets (fire-and-forget, tidak block response) =====
    if (googleSheets.isConfigured()) {
      setImmediate(async () => {
        try {
          const allEntries = await db.getAllLoaderEntries();
          const filesMap = new Map();
          await Promise.all(allEntries.map(async (e) => {
            const files = await db.getFilesBySubmissionId(e.id);
            if (files && files.length > 0) filesMap.set(e.id, files);
          }));
          await googleSheets.pushAllLoaderEntries(allEntries, filesMap);
        } catch(e) {
          console.error('[AutoSync Loader] Google Sheets sync error:', e.message);
        }
      });
    }

  } catch (err) {
    console.error('Insert loader entry error:', err);
    res.status(500).json({ error: 'Gagal menyimpan entry loader.' });
  }
});

// DELETE /api/loader-entries/:id — Hapus entry loader
app.delete('/api/loader-entries/:id', requirePermission('loader'), async (req, res) => {
  try {
    const entry = await db.getLoaderEntryById(req.params.id);
    const date = entry ? entry.tanggal_carian : null;
    await db.deleteLoaderEntry(req.params.id);
    if (date) invalidateDcCache(date); // clear cache setelah hapus
    res.json({ success: true });

    // ===== AUTO-SYNC ke Google Sheets setelah hapus (fire-and-forget) =====
    if (googleSheets.isConfigured()) {
      setImmediate(async () => {
        try {
          const allEntries = await db.getAllLoaderEntries();
          const filesMap = new Map();
          await Promise.all(allEntries.map(async (e) => {
            const files = await db.getFilesBySubmissionId(e.id);
            if (files && files.length > 0) filesMap.set(e.id, files);
          }));
          await googleSheets.pushAllLoaderEntries(allEntries, filesMap);
          console.log(`[AutoSync] Loader entry ${req.params.id} dihapus — Sheets berhasil diperbarui.`);
        } catch(e) {
          console.error('[AutoSync] Gagal sync hapus loader ke Google Sheets:', e.message);
        }
      });
    }
    // ======================================================================

  } catch (err) {
    console.error('Delete loader entry error:', err);
    res.status(500).json({ error: 'Gagal menghapus entry loader.' });
  }
});

// GET /api/export-loader — Export loader entries ke Excel
app.get('/api/export-loader', requirePermission('loader'), async (req, res) => {
  try {
    const { tanggal_carian } = req.query;
    const entries = await db.getAllLoaderEntries(tanggal_carian || null);

    // Load user type mapping
    let userTypeMap = {};
    try {
      const users = await db.getAllOperationalUsers();
      users.forEach(u => {
        userTypeMap[u.nama_lengkap] = u.tipe_karyawan || 'Belum Ditentukan';
      });
    } catch(e) {
      console.error('Error loading users for loader export map:', e);
    }

    const data = entries.map((e, i) => {
      let clusterList = [];
      if (Array.isArray(e.clusters)) {
        clusterList = e.clusters;
      } else if (e.clusters && typeof e.clusters === 'object') {
        clusterList = e.clusters.list || [];
      }
      return {
        'No': i + 1,
        'Tanggal Carian': e.tanggal_carian,
        'Tanggal Kirim': e.tanggal_kirim,
        'Nama': e.nama,
        'Tipe Karyawan': userTypeMap[e.nama] || 'Belum Ditentukan',
        'Zona': e.zona,
        'No. Polisi': e.no_polisi,
        'Clusters': clusterList.join(', '),
        'Gacoan': (e.non_group || {}).gacoan || 0,
        'Dikichi': (e.non_group || {}).dikichi || 0,
        'Benfarm': (e.non_group || {}).benfarm || 0,
        'Jumlah Kontainer': e.jumlah_kontainer,
        'Catatan': e.catatan,
        'Waktu Submit': e.created_at
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      {wch:5},{wch:15},{wch:15},{wch:30},{wch:16},{wch:8},{wch:14},{wch:50},{wch:10},{wch:10},{wch:10},{wch:16},{wch:25},{wch:22}
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Loader Entries');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `loader-entries-${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Export loader error:', err);
    res.status(500).send('Gagal export data loader.');
  }
});

// ==================== USER DASHBOARD ====================

// GET /api/my-achievements — Pencapaian user yang sedang login (Picker/Sorter + Loader)
app.get('/api/my-achievements', requireAuth, async (req, res) => {
  try {
    const namaUser = req.user.nama_lengkap;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD

    // ===== PICKER / SORTER SUBMISSIONS =====
    let allSubmissions = [];
    if (db.isSupabaseEnabled) {
      const { createClient } = require('@supabase/supabase-js');
      const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
      const { data } = await supa.from('submissions').select('*').eq('nama', namaUser).order('created_at', { ascending: false });
      allSubmissions = (data || []).map(s => ({ ...s, batch_cluster: typeof s.batch_cluster === 'string' ? s.batch_cluster : JSON.stringify(s.batch_cluster) }));
    } else {
      const allSubs = await db.getAllSubmissions();
      allSubmissions = allSubs.filter(s => s.nama === namaUser);
    }

    // Filter hari ini berdasarkan tanggal_pengerjaan
    const todaySubmissions = allSubmissions.filter(s => {
      const tgl = (s.tanggal_pengerjaan || '').slice(0, 10);
      return tgl === today;
    });

    // Hitung summary Picker
    const pickerTodaySubs = todaySubmissions.filter(s => s.posisi === 'Picker');
    const sorterTodaySubs = todaySubmissions.filter(s => s.posisi === 'Sorter');
    const pickerAllSubs   = allSubmissions.filter(s => s.posisi === 'Picker');
    const sorterAllSubs   = allSubmissions.filter(s => s.posisi === 'Sorter');

    const sumOutput = (arr) => arr.reduce((acc, s) => acc + (parseInt(s.jumlah_output) || 0), 0);
    const countStatus = (arr, status) => arr.filter(s => s.status === status).length;

    // ===== LOADER ENTRIES =====
    let allLoaderEntries = [];
    if (db.isSupabaseEnabled) {
      const { createClient } = require('@supabase/supabase-js');
      const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
      const { data } = await supa.from('loader_entries').select('*').eq('nama', namaUser).order('created_at', { ascending: false });
      allLoaderEntries = data || [];
    } else {
      const allEntries = await db.getAllLoaderEntries();
      allLoaderEntries = allEntries.filter(e => e.nama === namaUser);
    }

    const todayLoader = allLoaderEntries.filter(e => {
      const tgl = (e.tanggal_kirim || e.tanggal_carian || '').slice(0, 10);
      return tgl === today;
    });

    const sumKontainer = (arr) => arr.reduce((acc, e) => acc + (parseInt(e.jumlah_kontainer) || 0), 0);

    res.json({
      today_date: today,
      picker: {
        all_submissions: pickerAllSubs,
        today: {
          submissions: pickerTodaySubs,
          total_batch: pickerTodaySubs.length,
          total_output: sumOutput(pickerTodaySubs),
          approved: countStatus(pickerTodaySubs, 'approved'),
          pending: countStatus(pickerTodaySubs, 'pending')
        },
        all: {
          total_batch: pickerAllSubs.length,
          total_output: sumOutput(pickerAllSubs)
        }
      },
      sorter: {
        all_submissions: sorterAllSubs,
        today: {
          submissions: sorterTodaySubs,
          total_batch: sorterTodaySubs.length,
          total_output: sumOutput(sorterTodaySubs),
          approved: countStatus(sorterTodaySubs, 'approved'),
          pending: countStatus(sorterTodaySubs, 'pending')
        },
        all: {
          total_batch: sorterAllSubs.length,
          total_output: sumOutput(sorterAllSubs)
        }
      },
      loader: {
        all_entries: allLoaderEntries,
        today: {
          entries: todayLoader,
          total_trip: todayLoader.length,
          total_kontainer: sumKontainer(todayLoader)
        },
        all: {
          total_trip: allLoaderEntries.length,
          total_kontainer: sumKontainer(allLoaderEntries)
        }
      }
    });
  } catch (err) {
    console.error('my-achievements error:', err);
    res.status(500).json({ error: 'Gagal memuat data pencapaian.' });
  }
});

// SPA fallback routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
// ============= KETENTUAN HARGA API =============

// GET /api/ketentuan-harga — ambil semua ketentuan harga
app.get('/api/ketentuan-harga', requireAuth, async (req, res) => {
  try {
    const data = await db.getKetentuanHarga();
    res.json(data);
  } catch (err) {
    console.error('GET ketentuan-harga error:', err);
    res.status(500).json({ error: 'Gagal memuat ketentuan harga.' });
  }
});

// POST /api/ketentuan-harga — tambah ketentuan harga baru
app.post('/api/ketentuan-harga', requireAuth, async (req, res) => {
  try {
    const { posisi, zona, harga, keterangan } = req.body;
    if (!posisi || !zona || harga === undefined || harga === null || harga === '') {
      return res.status(400).json({ error: 'Posisi, zona, dan harga wajib diisi.' });
    }
    if (!['Picker', 'Sorter', 'Loader'].includes(posisi)) {
      return res.status(400).json({ error: 'Posisi tidak valid.' });
    }
    const finalSatuan = posisi === 'Picker' ? 'pcs' : 'kontainer';
    const record = await db.insertKetentuanHarga({ posisi, zona, harga: parseFloat(harga), satuan: finalSatuan, keterangan });
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('POST ketentuan-harga error:', err);
    if (err.message && err.message.includes('sudah ada')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Gagal menyimpan ketentuan harga.' });
  }
});

// PUT /api/ketentuan-harga/:id — edit harga
app.put('/api/ketentuan-harga/:id', requireAuth, async (req, res) => {
  try {
    const { harga, keterangan } = req.body;
    if (harga === undefined || harga === null || harga === '') {
      return res.status(400).json({ error: 'Harga wajib diisi.' });
    }
    const record = await db.updateKetentuanHarga(req.params.id, { harga: parseFloat(harga), keterangan });
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('PUT ketentuan-harga error:', err);
    res.status(500).json({ error: 'Gagal mengupdate ketentuan harga.' });
  }
});

// DELETE /api/ketentuan-harga/:id — hapus ketentuan harga
app.delete('/api/ketentuan-harga/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteKetentuanHarga(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE ketentuan-harga error:', err);
    res.status(500).json({ error: 'Gagal menghapus ketentuan harga.' });
  }
});

// ============= REKAP PENDAPATAN API =============

// GET /api/rekap-pendapatan?bulan=YYYY-MM  ATAU  ?tanggalMulai=YYYY-MM-DD&tanggalAkhir=YYYY-MM-DD
app.get('/api/rekap-pendapatan', requirePermission('rekap-pendapatan'), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    let tanggalMulai, tanggalAkhir;

    if (req.query.bulan) {
      // Dari bulan: misal 2026-07 → 2026-07-01 s/d 2026-07-31
      const [y, m] = req.query.bulan.split('-').map(Number);
      const firstDay = new Date(y, m - 1, 1);
      const lastDay  = new Date(y, m, 0);
      tanggalMulai = firstDay.toISOString().split('T')[0];
      tanggalAkhir = lastDay.toISOString().split('T')[0];
    } else {
      tanggalMulai = req.query.tanggalMulai || today;
      tanggalAkhir  = req.query.tanggalAkhir  || tanggalMulai;
    }
    if (tanggalAkhir < tanggalMulai) tanggalAkhir = tanggalMulai;

    const data = await db.getRekapPendapatan(tanggalMulai, tanggalAkhir);
    res.json({ ...data, tanggalMulai, tanggalAkhir });
  } catch (err) {
    console.error('GET rekap-pendapatan error:', err);
    res.status(500).json({ error: 'Gagal memuat data rekap pendapatan.' });
  }
});

// GET /api/rekap-pendapatan/export - Export rekap pendapatan ke Excel (.xlsx) dengan styling premium
app.get('/api/rekap-pendapatan/export', requirePermission('rekap-pendapatan'), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    let tanggalMulai, tanggalAkhir;

    if (req.query.bulan) {
      const [y, m] = req.query.bulan.split('-').map(Number);
      const firstDay = new Date(y, m - 1, 1);
      const lastDay  = new Date(y, m, 0);
      tanggalMulai = firstDay.toISOString().split('T')[0];
      tanggalAkhir = lastDay.toISOString().split('T')[0];
    } else {
      tanggalMulai = req.query.tanggalMulai || today;
      tanggalAkhir  = req.query.tanggalAkhir  || tanggalMulai;
    }
    if (tanggalAkhir < tanggalMulai) tanggalAkhir = tanggalMulai;

    let data = await db.getRekapPendapatan(tanggalMulai, tanggalAkhir);
    let pekerja = data.pekerja || [];

    // Terapkan filter posisi & search
    const { posisi, search } = req.query;
    if (posisi) {
      pekerja = pekerja.filter(p => p.posisi === posisi);
    }
    if (search) {
      const q = search.toLowerCase().trim();
      pekerja = pekerja.filter(p => p.nama.toLowerCase().includes(q));
    }

    // Hitung ulang total untuk data yang diekspor
    const filteredGrandTotal = pekerja.reduce((sum, p) => sum + (p.total_nilai || 0), 0);
    const totalPicker = pekerja.filter(p => p.posisi === 'Picker').reduce((sum, p) => sum + (p.total_nilai || 0), 0);
    const totalSorter = pekerja.filter(p => p.posisi === 'Sorter').reduce((sum, p) => sum + (p.total_nilai || 0), 0);
    const totalLoader = pekerja.filter(p => p.posisi === 'Loader').reduce((sum, p) => sum + (p.total_nilai || 0), 0);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Formulir Pencapaian Kerja SS08';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Rekap Pendapatan', {
      views: [{ state: 'frozen', ySplit: 7 }] // Freeze 7 baris teratas
    });

    sheet.views[0].showGridLines = true;

    // 1. Title Block
    sheet.mergeCells('A1:F1');
    const titleRow = sheet.getRow(1);
    titleRow.height = 30;
    const titleCell = titleRow.getCell(1);
    titleCell.value = 'LAPORAN REKAP PENDAPATAN PEKERJA';
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1E3A8A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

    sheet.mergeCells('A2:F2');
    const periodRow = sheet.getRow(2);
    periodRow.height = 20;
    const periodCell = periodRow.getCell(1);
    const fmtTgl = (tgl) => {
      if (!tgl) return '';
      const [y, m, d] = tgl.split('-');
      return `${d}/${m}/${y}`;
    };
    periodCell.value = req.query.bulan 
      ? `Bulan: ${new Date(tanggalMulai).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`
      : `Periode: ${fmtTgl(tanggalMulai)} s/d ${fmtTgl(tanggalAkhir)}`;
    periodCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF4B5563' } };
    periodCell.alignment = { vertical: 'middle', horizontal: 'left' };

    // 2. Summary KPI Cards (A4:F5)
    sheet.mergeCells('A4:B5');
    const gtCell = sheet.getCell('A4');
    gtCell.value = `GRAND TOTAL PENDAPATAN\nRp ${Math.round(filteredGrandTotal).toLocaleString('id-ID')}`;
    gtCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    gtCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } };
    gtCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    gtCell.border = {
      top: { style: 'thin', color: { argb: 'FF4C1D95' } },
      left: { style: 'thin', color: { argb: 'FF4C1D95' } },
      bottom: { style: 'thin', color: { argb: 'FF4C1D95' } },
      right: { style: 'thin', color: { argb: 'FF4C1D95' } }
    };

    const pickerCell = sheet.getCell('C4');
    pickerCell.value = `Total Picker\nRp ${Math.round(totalPicker).toLocaleString('id-ID')}`;
    pickerCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1E40AF' } };
    pickerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    pickerCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    pickerCell.border = {
      top: { style: 'thin', color: { argb: 'FF93C5FD' } },
      left: { style: 'thin', color: { argb: 'FF93C5FD' } },
      bottom: { style: 'thin', color: { argb: 'FF93C5FD' } },
      right: { style: 'thin', color: { argb: 'FF93C5FD' } }
    };

    const sorterCell = sheet.getCell('D4');
    sorterCell.value = `Total Sorter\nRp ${Math.round(totalSorter).toLocaleString('id-ID')}`;
    sorterCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF065F46' } };
    sorterCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    sorterCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    sorterCell.border = {
      top: { style: 'thin', color: { argb: 'FF6EE7B7' } },
      left: { style: 'thin', color: { argb: 'FF6EE7B7' } },
      bottom: { style: 'thin', color: { argb: 'FF6EE7B7' } },
      right: { style: 'thin', color: { argb: 'FF6EE7B7' } }
    };

    const loaderCell = sheet.getCell('E4');
    loaderCell.value = `Total Loader\nRp ${Math.round(totalLoader).toLocaleString('id-ID')}`;
    loaderCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF92400E' } };
    loaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } };
    loaderCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    loaderCell.border = {
      top: { style: 'thin', color: { argb: 'FCD34D' } },
      left: { style: 'thin', color: { argb: 'FCD34D' } },
      bottom: { style: 'thin', color: { argb: 'FCD34D' } },
      right: { style: 'thin', color: { argb: 'FCD34D' } }
    };

    const countCell = sheet.getCell('F4');
    countCell.value = `Total Pekerja\n${pekerja.length} Orang`;
    countCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF374151' } };
    countCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    countCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    countCell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
    };

    sheet.getRow(4).height = 25;
    sheet.getRow(5).height = 20;

    // 3. Table Headers definition (Row 7)
    sheet.columns = [
      { header: 'No',                key: 'no',         width: 8  },
      { header: 'Nama Pekerja',      key: 'nama',       width: 32 },
      { header: 'Posisi',            key: 'posisi',     width: 16 },
      { header: 'Total Pencapaian',  key: 'output',     width: 20 },
      { header: 'Total Nilai (Rp)',  key: 'nilai',      width: 22 },
      { header: '% Dari Grand Total',key: 'persen',     width: 20 },
    ];

    const headerRow = sheet.getRow(7);
    headerRow.height = 26;
    headerRow.eachCell(cell => {
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FF4F46E5' }
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF312E81' } },
        bottom: { style: 'medium', color: { argb: 'FF312E81' } },
        left: { style: 'thin', color: { argb: 'FF312E81' } },
        right: { style: 'thin', color: { argb: 'FF312E81' } }
      };
    });

    // Special header colors for numbers
    const colOutput = sheet.getColumn('output');
    headerRow.getCell(colOutput.number).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D6E3F' }
    };
    const colNilai = sheet.getColumn('nilai');
    headerRow.getCell(colNilai.number).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' }
    };

    // 4. Data rows
    pekerja.forEach((p, index) => {
      const pct = filteredGrandTotal > 0 ? (p.total_nilai / filteredGrandTotal) : 0;
      const addedRow = sheet.addRow({
        no: index + 1,
        nama: p.nama || '',
        posisi: p.posisi || '',
        output: p.total_pencapaian || 0,
        nilai: p.total_nilai || 0,
        persen: pct
      });

      addedRow.height = 20;

      addedRow.getCell('no').alignment = { horizontal: 'center', vertical: 'middle' };
      addedRow.getCell('nama').alignment = { horizontal: 'left', vertical: 'middle' };
      addedRow.getCell('posisi').alignment = { horizontal: 'center', vertical: 'middle' };
      addedRow.getCell('output').alignment = { horizontal: 'right', vertical: 'middle' };
      addedRow.getCell('nilai').alignment = { horizontal: 'right', vertical: 'middle' };
      addedRow.getCell('persen').alignment = { horizontal: 'right', vertical: 'middle' };

      addedRow.getCell('output').numFmt = '#,##0';
      addedRow.getCell('nilai').numFmt = 'Rp#,##0';
      addedRow.getCell('persen').numFmt = '0.0%';

      const isEven = index % 2 === 0;
      const bgHex = isEven ? 'FFFFFFFF' : 'FFF9FAFB';

      addedRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgHex } };
        cell.font = { name: 'Calibri', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
      });

      // Special styling for top 3 in rank column
      if (index === 0) {
        addedRow.getCell('no').value = '🥇 1';
        addedRow.getCell('no').font = { bold: true };
      } else if (index === 1) {
        addedRow.getCell('no').value = '🥈 2';
        addedRow.getCell('no').font = { bold: true };
      } else if (index === 2) {
        addedRow.getCell('no').value = '🥉 3';
        addedRow.getCell('no').font = { bold: true };
      }
    });

    // 5. Footer Row
    const footerRow = sheet.addRow({
      no: '',
      nama: 'GRAND TOTAL',
      posisi: '',
      output: pekerja.reduce((sum, p) => sum + (p.total_pencapaian || 0), 0),
      nilai: filteredGrandTotal,
      persen: 1.0
    });

    footerRow.height = 24;
    footerRow.getCell('nama').font = { bold: true, name: 'Calibri', size: 11 };
    footerRow.getCell('output').font = { bold: true, name: 'Calibri', size: 11 };
    footerRow.getCell('nilai').font = { bold: true, name: 'Calibri', size: 11, color: { argb: 'FF10B981' } };
    footerRow.getCell('persen').font = { bold: true, name: 'Calibri', size: 11 };

    footerRow.getCell('output').numFmt = '#,##0';
    footerRow.getCell('nilai').numFmt = 'Rp#,##0';
    footerRow.getCell('persen').numFmt = '0.0%';

    footerRow.getCell('nama').alignment = { horizontal: 'left', vertical: 'middle' };
    footerRow.getCell('output').alignment = { horizontal: 'right', vertical: 'middle' };
    footerRow.getCell('nilai').alignment = { horizontal: 'right', vertical: 'middle' };
    footerRow.getCell('persen').alignment = { horizontal: 'right', vertical: 'middle' };

    footerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        bottom: { style: 'double', color: { argb: 'FF111827' } },
        left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        right: { style: 'thin', color: { argb: 'FF9CA3AF' } }
      };
    });

    // Auto filter
    sheet.autoFilter = {
      from: { row: 7, column: 1 },
      to:   { row: 7, column: sheet.columns.length }
    };

    // Auto width
    sheet.columns.forEach(col => {
      let maxLen = 0;
      col.eachCell({ includeEmpty: false }, cell => {
        if (cell.row < 7) return; // skip header card rows
        const valStr = cell.value ? String(cell.value) : '';
        if (valStr.length > maxLen) maxLen = valStr.length;
      });
      col.width = Math.max(maxLen + 4, col.width || 12);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    const filterSuffix = posisi ? `-${posisi.toLowerCase()}` : '';
    const filename = `rekap-pendapatan${filterSuffix}-${dateStr}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Export Rekap Pendapatan Excel error:', err);
    res.status(500).send('Gagal mengekspor rekap pendapatan.');
  }
});

// ============= MONITORING MPP API =============

// GET /api/monitoring-mpp?tanggalMulai=YYYY-MM-DD&tanggalAkhir=YYYY-MM-DD
// Backward compat: juga menerima ?tanggal=YYYY-MM-DD (single date)
app.get('/api/monitoring-mpp', requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    // Support both old ?tanggal= and new ?tanggalMulai= / ?tanggalAkhir=
    let tanggalMulai = req.query.tanggalMulai || req.query.tanggal || today;
    let tanggalAkhir  = req.query.tanggalAkhir  || tanggalMulai;
    // Validasi: pastikan akhir >= mulai
    if (tanggalAkhir < tanggalMulai) tanggalAkhir = tanggalMulai;
    const data = await db.getMonitoringMPP(tanggalMulai, tanggalAkhir);
    res.json(data);
  } catch (err) {
    console.error('GET monitoring-mpp error:', err);
    res.status(500).json({ error: 'Gagal memuat data Monitoring MPP.' });
  }
});

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
