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

// Optimized helper function to sync all loader entries to Google Sheets (combining queries to avoid N+1)
async function syncLoaderEntriesToSheets() {
  if (!googleSheets.isConfigured()) return;
  try {
    const allEntries = await db.getAllLoaderEntries();
    const allFiles = await db.getAllFiles();

    // Map files in memory by loader_entry_id (loader files pakai loader_entry_id, bukan submission_id)
    const filesMap = new Map();
    for (const f of allFiles) {
      const key = f.loader_entry_id;
      if (!key) continue; // skip file milik submission biasa
      if (!filesMap.has(key)) {
        filesMap.set(key, []);
      }
      filesMap.get(key).push(f);
    }

    await googleSheets.pushAllLoaderEntries(allEntries, filesMap);
  } catch(e) {
    console.error('[AutoSync Loader] Google Sheets sync error:', e.message);
  }
}

// Helper: sync semua QC Outbound entries ke Google Sheets
async function syncQcOutboundToSheets() {
  if (!googleSheets.isConfigured()) return;
  try {
    const allEntries = await db.getAllQcOutbound();
    await googleSheets.pushAllQcOutbound(allEntries);
  } catch(e) {
    console.error('[AutoSync QC Outbound] Google Sheets sync error:', e.message);
  }
}

// JWT Secret Key configuration
const JWT_SECRET = process.env.JWT_SECRET || 'ss08-formulir-secret-fallback-2026';
if (JWT_SECRET === 'ss08-formulir-secret-fallback-2026') {
  console.warn('âš ï¸ WARNING: Using fallback JWT_SECRET. Please set JWT_SECRET in production environment!');
}

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
const requireAuth = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized. Silakan login terlebih dahulu.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    
    // Check maintenance mode for operasional users
    if (decoded.role !== 'admin') {
      const maintenance = await db.getMaintenanceSettings();
      if (maintenance && maintenance.active) {
        return res.status(503).json({
          error: 'Sistem sedang dalam pemeliharaan.',
          code: 'MAINTENANCE_MODE',
          title: maintenance.title,
          message: maintenance.message,
          estimated_end: maintenance.estimated_end
        });
      }
    }
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sesi login habis atau tidak valid. Silakan login kembali.' });
  }
};

// ==================== PUBLIC ROUTES ====================

// POST /api/submit - submit form dengan validasi kapasitas
app.post('/api/submit', requireAuth, (req, res, next) => {
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

    // ===== CEK KAPASITAS â€” tentukan status submission =====
    // Jika ada batch yang melebihi kapasitas â†’ status 'pending' (butuh validasi admin)
    // Jika semua dalam batas â†’ status 'approved'
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
      ? `Formulir terkirim! ${batchOutputs.length} batch tersimpan. âš ï¸ ${pendingBatches.length} batch melebihi kapasitas dan menunggu validasi admin.`
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

// GET /api/batch-capacity â€” Public: cek kapasitas batch untuk form validasi real-time
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

// Simple in-memory rate limiter for login
const loginAttempts = {};
const loginRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const attemptWindow = 10 * 60 * 1000; // 10 minutes
  const maxAttempts = 10;

  if (!loginAttempts[ip]) {
    loginAttempts[ip] = [];
  }

  // Filter out attempts older than window
  loginAttempts[ip] = loginAttempts[ip].filter(timestamp => now - timestamp < attemptWindow);

  if (loginAttempts[ip].length >= maxAttempts) {
    return res.status(429).json({
      error: 'Terlalu banyak percobaan login. Silakan coba lagi dalam 10 menit.'
    });
  }

  loginAttempts[ip].push(now);
  next();
};

// POST /api/login
app.post('/api/login', loginRateLimiter, async (req, res) => {
  try {
    const { username, password, nik, mode } = req.body;

    let user = null;
    let tokenPayload = {};

    if (mode === 'operasional') {
      const maintenance = await db.getMaintenanceSettings();
      if (maintenance && maintenance.active) {
        return res.status(503).json({
          error: maintenance.message || 'Sistem sedang dalam pemeliharaan. Silakan hubungi Administrator.',
          code: 'MAINTENANCE_MODE'
        });
      }
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
        tipe_karyawan: user.tipe_karyawan || 'Productivity',
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

// GET /api/ping â€” Keep-alive endpoint (no auth required, for UptimeRobot/monitoring)
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// GET /api/settings/login â€” Ambil setting halaman login (public, no auth)
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
app.get('/api/check-auth', async (req, res) => {
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      let isImpersonating = false;
      let adminUsername = null;
      if (req.cookies.admin_token) {
        try {
          const adminDecoded = jwt.verify(req.cookies.admin_token, JWT_SECRET);
          if (adminDecoded && adminDecoded.role === 'admin') {
            isImpersonating = true;
            adminUsername = adminDecoded.username;
          }
        } catch (e) {}
      }

      // Check maintenance for operasional user (skip if impersonated by admin)
      if (decoded.role !== 'admin' && !isImpersonating) {
        const maintenance = await db.getMaintenanceSettings();
        if (maintenance && maintenance.active) {
          return res.json({
            authenticated: true,
            maintenance: true,
            role: decoded.role,
            title: maintenance.title,
            message: maintenance.message,
            estimated_end: maintenance.estimated_end
          });
        }
      }

      return res.json({
        authenticated: true,
        userId: decoded.userId || null,
        username: decoded.username,
        nama_lengkap: decoded.nama_lengkap || decoded.username,
        role: decoded.role || 'admin',
        posisi: decoded.posisi || null,
        tipe_karyawan: decoded.tipe_karyawan || 'Productivity',
        allowed_pages: decoded.allowed_pages || [],
        isImpersonating: isImpersonating,
        adminUsername: adminUsername
      });
    } catch (err) {
      // Token invalid or expired
    }
  }
  res.json({ authenticated: false });
});

// ==================== ADMIN ROUTES & MIDDLEWARES ====================

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

// Middleware: QC Outbound â€” bisa diakses oleh:
// 1. User operasional dengan posisi 'QC Outbound'
// 2. Admin manapun (super admin / admin dengan qc-outbound permission)
const requireQcOutbound = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Izinkan admin (semua jenis)
    if (decoded.role === 'admin') {
      req.user = decoded;
      return next();
    }
    // Izinkan operasional dengan posisi QC Outbound
    if (decoded.role === 'operasional' && decoded.posisi === 'QC Outbound') {
      req.user = decoded;
      return next();
    }
    return res.status(403).json({ error: 'Akses ditolak. Hanya untuk QC Outbound.' });
  } catch (err) {
    res.status(401).json({ error: 'Sesi tidak valid.' });
  }
};

// POST /api/admin/impersonate â€” Login sebagai user lain (Admin only)
app.post('/api/admin/impersonate', requirePermission('users'), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'ID user diperlukan.' });

    const targetUser = await db.getUserById(userId);
    if (!targetUser) return res.status(404).json({ error: 'User tidak ditemukan.' });

    if (targetUser.role === 'admin') {
      return res.status(400).json({ error: 'Tidak dapat meng-impersonate sesama Admin.' });
    }

    // Token admin saat ini
    const adminToken = req.cookies.token;

    // Buat token baru untuk target user
    const userPayload = {
      userId: targetUser.id,
      username: targetUser.username,
      nama_lengkap: targetUser.nama_lengkap || targetUser.username,
      role: targetUser.role || 'operasional',
      posisi: targetUser.posisi || null,
      tipe_karyawan: targetUser.tipe_karyawan || 'Productivity',
      isImpersonating: true
    };

    const userToken = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1d' });

    // Simpan token admin ke cookie 'admin_token'
    res.cookie('admin_token', adminToken, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });

    // Ganti token utama dengan token target user
    res.cookie('token', userToken, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });

    if (db.insertAuditLog) {
      await db.insertAuditLog(req.user.username, 'IMPERSONATE_USER', `Admin ${req.user.username} beralih sesi ke user: ${targetUser.nama_lengkap} (${targetUser.username})`);
    }

    res.json({
      success: true,
      message: `Berhasil beralih ke sesi user ${targetUser.nama_lengkap}`,
      targetUser: {
        id: targetUser.id,
        username: targetUser.username,
        nama_lengkap: targetUser.nama_lengkap
      }
    });
  } catch (err) {
    console.error('Impersonate user error:', err);
    res.status(500).json({ error: 'Gagal beralih ke sesi user.' });
  }
});

// POST /api/switch-back-admin â€” Kembali ke sesi Admin dari sesi impersonasi
app.post('/api/switch-back-admin', async (req, res) => {
  try {
    const adminToken = req.cookies.admin_token;
    if (!adminToken) {
      return res.status(400).json({ error: 'Tidak ada sesi Admin yang tersimpan.' });
    }

    const adminDecoded = jwt.verify(adminToken, JWT_SECRET);
    if (!adminDecoded || adminDecoded.role !== 'admin') {
      return res.status(401).json({ error: 'Sesi Admin tidak valid.' });
    }

    // Kembalikan token utama ke token admin
    res.cookie('token', adminToken, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });

    // Hapus cookie admin_token
    res.clearCookie('admin_token');

    res.json({ success: true, message: 'Berhasil kembali ke sesi Administrator.' });
  } catch (err) {
    console.error('Switch back to admin error:', err);
    res.status(500).json({ error: 'Gagal kembali ke sesi Admin.' });
  }
});


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
    const actionType = req.query.actionType || '';
    const adminUser = req.query.adminUser || '';
    const dateStart = req.query.dateStart || '';
    const dateEnd = req.query.dateEnd || '';
    const result = await db.getAuditLogs(page, limit, search, actionType, adminUser, dateStart, dateEnd);
    res.json(result);
  } catch (err) {
    console.error('Fetch audit logs error:', err);
    res.status(500).json({ error: 'Gagal memuat log aktivitas.' });
  }
});

// GET /api/audit-logs/users
app.get('/api/audit-logs/users', requireSuperAdmin, async (req, res) => {
  try {
    const users = await db.getAuditLogUsers();
    res.json(users);
  } catch (err) {
    console.error('Fetch audit log users error:', err);
    res.status(500).json({ error: 'Gagal memuat daftar user audit.' });
  }
});

// GET /api/audit-logs/export
app.get('/api/audit-logs/export', requireSuperAdmin, async (req, res) => {
  try {
    const { search, actionType, adminUser, dateStart, dateEnd } = req.query;
    // Ambil semua log yang cocok (tidak terpaginasi)
    const result = await db.getAuditLogs(1, 100000, search, actionType, adminUser, dateStart, dateEnd);
    const logs = result.logs || [];
    
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Log Aktivitas');
    
    worksheet.columns = [
      { header: 'Waktu (WIB)', key: 'waktu', width: 22 },
      { header: 'Admin User', key: 'username', width: 15 },
      { header: 'Aksi', key: 'action', width: 25 },
      { header: 'Detail Deskripsi', key: 'details', width: 65 }
    ];
    
    // Format Header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '1E3A8A' } // Navy blue
    };
    
    logs.forEach(l => {
      const dt = new Date(l.created_at);
      const dateStr = dt.toLocaleDateString('id-ID', { year:'numeric', month:'2-digit', day:'2-digit' }) + ' ' + 
                      dt.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Asia/Jakarta' });
      worksheet.addRow({
        waktu: dateStr,
        username: l.username,
        action: l.action,
        details: l.details
      });
    });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Audit_Logs_SS08.xlsx');
    await workbook.xlsx.write(res);
    res.end();
    
    await db.insertAuditLog(req.user.username, 'EXPORT_AUDIT_LOGS', `Mengekspor ${logs.length} log audit ke Excel`);
  } catch (err) {
    console.error('Export audit logs error:', err);
    res.status(500).json({ error: 'Gagal mengekspor log audit.' });
  }
});

// GET /api/submissions
app.get('/api/submissions', requirePermission('submissions'), async (req, res) => {
  try {
    const { status, limit, offset } = req.query;
    const filters = {};
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      filters.status = status;
    }
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);

    const submissions = await db.getAllSubmissions(filters);
    res.json(submissions);
  } catch (err) {
    console.error('Fetch submissions error:', err);
    res.status(500).json({ error: 'Gagal memuat data.' });
  }
});

// POST /api/settings/login â€” Simpan setting halaman login (Super Admin only)
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

// GET /api/settings/maintenance-status â€” Ambil status pemeliharaan (public, no auth)
app.get('/api/settings/maintenance-status', async (req, res) => {
  try {
    const settings = await db.getMaintenanceSettings();
    res.json(settings);
  } catch (err) {
    console.error('GET maintenance status error:', err);
    res.status(500).json({ error: 'Gagal memuat status pemeliharaan.' });
  }
});

// POST /api/settings/maintenance-settings â€” Simpan status pemeliharaan (Admin only)
app.post('/api/settings/maintenance-settings', requireAdmin, async (req, res) => {
  try {
    const { active, title, message, estimated_end } = req.body;
    const saved = await db.saveMaintenanceSettings({ active: !!active, title, message, estimated_end });
    await db.insertAuditLog(req.user.username, 'UPDATE_MAINTENANCE', `Mengubah mode pemeliharaan menjadi ${active ? 'AKTIF' : 'NONAKTIF'}`);
    res.json({ success: true, settings: saved });
  } catch (err) {
    console.error('Save maintenance settings error:', err);
    res.status(500).json({ error: 'Gagal menyimpan pengaturan pemeliharaan.' });
  }
});

// ==================== ABSENSI ROUTES ====================

// GET /api/settings/absensi â€” Ambil pengaturan absensi (public)
app.get('/api/settings/absensi', async (req, res) => {
  try {
    const settings = await db.getAbsensiSettings();
    res.json(settings);
  } catch (err) {
    console.error('Get absensi settings error:', err);
    res.json(db.DEFAULT_ABSENSI_SETTINGS);
  }
});

// PUT /api/settings/absensi â€” Simpan pengaturan absensi (admin only)
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

// GET /api/settings/phl-rate â€” Ambil upah harian PHL (accessible by authenticated users)
app.get('/api/settings/phl-rate', requireAuth, async (req, res) => {
  try {
    const settings = await db.getPhlSettings();
    res.json(settings);
  } catch (err) {
    console.error('Get PHL settings error:', err);
    res.json(db.DEFAULT_PHL_SETTINGS);
  }
});

// PUT /api/settings/phl-rate â€” Simpan upah harian PHL (admin only, with permission 'penggajian')
app.put('/api/settings/phl-rate', requireAdmin, async (req, res) => {
  try {
    const { upah_harian } = req.body;
    const upahNum = parseInt(upah_harian) || 0;
    if (upahNum < 0) {
      return res.status(400).json({ error: 'Upah harian tidak boleh negatif.' });
    }
    const saved = await db.savePhlSettings({ upah_harian: upahNum });
    await db.insertAuditLog(req.user.username, 'UPDATE_SETTINGS',
      `Mengubah pengaturan upah harian PHL menjadi Rp ${upahNum.toLocaleString('id-ID')}`);
    res.json({ success: true, settings: saved });
  } catch (err) {
    console.error('Save PHL settings error:', err);
    res.status(500).json({ error: 'Gagal menyimpan pengaturan upah harian PHL.' });
  }
});

// GET /api/settings/periode-aktif â€” Ambil tanggal mulai periode aktif (accessible by authenticated users)
app.get('/api/settings/periode-aktif', requireAuth, async (req, res) => {
  try {
    const settings = await db.getPeriodeAktif();
    res.json(settings);
  } catch (err) {
    console.error('Get periode aktif error:', err);
    res.json({ tanggal_mulai: null });
  }
});

// PUT /api/settings/periode-aktif â€” Simpan tanggal mulai periode aktif (admin only)
app.put('/api/settings/periode-aktif', requireAdmin, async (req, res) => {
  try {
    const { tanggal_mulai } = req.body;
    // Validate format YYYY-MM-DD or null
    if (tanggal_mulai && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal_mulai)) {
      return res.status(400).json({ error: 'Format tanggal tidak valid. Gunakan YYYY-MM-DD.' });
    }
    const saved = await db.savePeriodeAktif({ tanggal_mulai: tanggal_mulai || null });
    await db.insertAuditLog(req.user.username, 'UPDATE_SETTINGS',
      tanggal_mulai
        ? `Menetapkan periode aktif mulai ${tanggal_mulai} (tutup buku)`
        : 'Mereset periode aktif ke semua waktu');
    res.json({ success: true, settings: saved });
  } catch (err) {
    console.error('Save periode aktif error:', err);
    res.status(500).json({ error: 'Gagal menyimpan pengaturan periode aktif.' });
  }
});

// GET /api/absensi/tanggal-list â€” Daftar tanggal punya absensi (admin only)
app.get('/api/absensi/tanggal-list', requirePermission('absensi'), async (req, res) => {
  try {
    const dates = await db.getAbsensiTanggalList();
    res.json(dates);
  } catch (err) {
    console.error('Get absensi tanggal list error:', err);
    res.status(500).json({ error: 'Gagal memuat daftar tanggal absensi.' });
  }
});

// GET /api/absensi/check â€” Cek apakah user hadir untuk tanggal tertentu (public)
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

// GET /api/absensi/hadir-hari-ini?tanggal=YYYY-MM-DD â€” Rekap hadir (public jika visible)
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

// GET /api/absensi?tanggal=YYYY-MM-DD â€” Rekap absensi per tanggal (admin only)
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

// POST /api/absensi â€” Tambah user ke absensi (admin only)
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

// DELETE /api/absensi/:id â€” Hapus user dari absensi (admin only)
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

// GET /api/absensi/riwayat-user â€” Riwayat hadir/tidak hadir satu user dalam range tanggal
app.get('/api/absensi/riwayat-user', requirePermission('absensi'), async (req, res) => {
  try {
    const { user_id, tanggal_mulai, tanggal_akhir } = req.query;
    if (!user_id || !tanggal_mulai || !tanggal_akhir) {
      return res.status(400).json({ error: 'Parameter user_id, tanggal_mulai, dan tanggal_akhir diperlukan.' });
    }
    if (tanggal_akhir < tanggal_mulai) {
      return res.status(400).json({ error: 'tanggal_akhir tidak boleh lebih awal dari tanggal_mulai.' });
    }
    const data = await db.getAbsensiRiwayatUser(user_id, tanggal_mulai, tanggal_akhir);
    res.json(data);
  } catch (err) {
    console.error('GET absensi/riwayat-user error:', err);
    res.status(500).json({ error: 'Gagal memuat riwayat absensi.' });
  }
});

// GET /api/absensi/riwayat-semua-karyawan â€” Riwayat hadir/tidak hadir semua user dalam range tanggal (JSON)
app.get('/api/absensi/riwayat-semua-karyawan', requirePermission('absensi'), async (req, res) => {
  try {
    const { tanggal_mulai, tanggal_akhir } = req.query;
    if (!tanggal_mulai || !tanggal_akhir) {
      return res.status(400).json({ error: 'Parameter tanggal_mulai dan tanggal_akhir diperlukan.' });
    }
    if (tanggal_akhir < tanggal_mulai) {
      return res.status(400).json({ error: 'tanggal_akhir tidak boleh lebih awal dari tanggal_mulai.' });
    }
    const data = await db.getAbsensiRiwayatSemuaUser(tanggal_mulai, tanggal_akhir);
    res.json(data);
  } catch (err) {
    console.error('GET absensi/riwayat-semua-karyawan error:', err);
    res.status(500).json({ error: 'Gagal memuat riwayat absensi semua karyawan.' });
  }
});


// GET /api/absensi/export-riwayat-user â€” Export rekap kehadiran karyawan ke Excel
app.get('/api/absensi/export-riwayat-user', requirePermission('absensi'), async (req, res) => {
  try {
    const { user_id, tanggal_mulai, tanggal_akhir } = req.query;
    if (!user_id || !tanggal_mulai || !tanggal_akhir) {
      return res.status(400).json({ error: 'Parameter user_id, tanggal_mulai, dan tanggal_akhir diperlukan.' });
    }

    const data = await db.getAbsensiRiwayatUser(user_id, tanggal_mulai, tanggal_akhir);
    const u    = data.user || {};
    const nama = u.nama_lengkap || u.username || 'Karyawan';
    const pct  = data.total_hari > 0 ? ((data.total_hadir / data.total_hari) * 100).toFixed(1) : '0';

    const hadirSet = new Set(data.hadir);

    // â”€â”€â”€ Helper formatting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const fmtDate = (d) => {
      if (!d) return '';
      const [y, m, day] = d.split('-');
      const bln = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
      return `${parseInt(day)} ${bln[parseInt(m)-1]} ${y}`;
    };
    const fmtDateFull = (d) => {
      if (!d) return '';
      const [y, m, day] = d.split('-');
      const bln = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
      const hari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
      const dt = new Date(`${d}T00:00:00`);
      return `${hari[dt.getDay()]}, ${parseInt(day)} ${bln[parseInt(m)-1]} ${y}`;
    };

    // â”€â”€â”€ Color palette â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const C = {
      primaryBg:   'FF4F46E5', // indigo
      primaryFg:   'FFFFFFFF',
      headerBg:    'FF312E81', // dark indigo
      accentGreen: 'FF10B981',
      accentRed:   'FFEF4444',
      accentAmber: 'FFF59E0B',
      greenLight:  'FFD1FAE5',
      greenDark:   'FF065F46',
      redLight:    'FFFEE2E2',
      redDark:     'FF991B1B',
      amberLight:  'FFFEF3C7',
      amberDark:   'FF92400E',
      grayLight:   'FFF8FAFC',
      grayMid:     'FFE2E8F0',
      grayDark:    'FF64748B',
      white:       'FFFFFFFF',
      darkText:    'FF1E293B',
    };

    const border1 = {
      top:    { style: 'thin', color: { argb: C.grayMid } },
      left:   { style: 'thin', color: { argb: C.grayMid } },
      bottom: { style: 'thin', color: { argb: C.grayMid } },
      right:  { style: 'thin', color: { argb: C.grayMid } },
    };
    const borderMedium = (argb) => ({
      top:    { style: 'medium', color: { argb } },
      left:   { style: 'medium', color: { argb } },
      bottom: { style: 'medium', color: { argb } },
      right:  { style: 'medium', color: { argb } },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator  = 'SS08 - Formulir Pencapaian Kerja';
    wb.created  = new Date();
    wb.modified = new Date();

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SHEET 1 â€” RINGKASAN
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const ws1 = wb.addWorksheet('ðŸ“‹ Ringkasan', {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true },
      properties: { tabColor: { argb: C.primaryBg } },
    });
    ws1.views = [{ showGridLines: false }];
    ws1.columns = [
      { key: 'A', width: 3 },
      { key: 'B', width: 28 },
      { key: 'C', width: 38 },
      { key: 'D', width: 18 },
    ];

    // === HEADER BANNER ===
    ws1.mergeCells('A1:D1');
    ws1.getRow(1).height = 14;

    ws1.mergeCells('A2:D5');
    const titleCell = ws1.getCell('A2');
    titleCell.value     = 'ðŸ“Š REKAP KEHADIRAN KARYAWAN';
    titleCell.font      = { name: 'Calibri', size: 20, bold: true, color: { argb: C.primaryFg } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.primaryBg } };
    ws1.getRow(2).height = 20;
    ws1.getRow(3).height = 20;
    ws1.getRow(4).height = 20;
    ws1.getRow(5).height = 20;

    ws1.mergeCells('A6:D6');
    const subTitle = ws1.getCell('A6');
    subTitle.value     = `SS08 - Formulir Pencapaian Kerja  â€¢  Dicetak: ${new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}`;
    subTitle.font      = { name: 'Calibri', size: 10, color: { argb: 'FFCBD5E1' } };
    subTitle.alignment = { vertical: 'middle', horizontal: 'center' };
    subTitle.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
    ws1.getRow(6).height = 18;

    ws1.getRow(7).height = 10; // spacer

    // === PROFIL KARYAWAN ===
    ws1.mergeCells('B8:D8');
    const profileLabel = ws1.getCell('B8');
    profileLabel.value     = '  PROFIL KARYAWAN';
    profileLabel.font      = { name: 'Calibri', size: 11, bold: true, color: { argb: C.primaryFg } };
    profileLabel.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.primaryBg } };
    profileLabel.alignment = { vertical: 'middle', horizontal: 'left' };
    ws1.getRow(8).height   = 22;

    const profileRows = [
      ['Nama Lengkap',  nama],
      ['Posisi',        u.posisi || '-'],
      ['NIK',           u.nik    || '-'],
      ['Username',      u.username || '-'],
      ['Periode',       `${fmtDate(tanggal_mulai)} â€” ${fmtDate(tanggal_akhir)}`],
    ];
    let pr = 9;
    profileRows.forEach(([label, val]) => {
      ws1.getRow(pr).height = 20;
      const lc = ws1.getCell(`B${pr}`);
      lc.value     = label;
      lc.font      = { name: 'Calibri', size: 11, bold: true, color: { argb: C.grayDark } };
      lc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.grayLight } };
      lc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      lc.border    = border1;

      ws1.mergeCells(`C${pr}:D${pr}`);
      const vc = ws1.getCell(`C${pr}`);
      vc.value     = val;
      vc.font      = { name: 'Calibri', size: 11, bold: false, color: { argb: C.darkText } };
      vc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.white } };
      vc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      vc.border    = border1;
      pr++;
    });

    ws1.getRow(pr).height = 12; // spacer
    pr++;

    // === STATISTIK CARDS ===
    ws1.mergeCells(`B${pr}:D${pr}`);
    const statLabel = ws1.getCell(`B${pr}`);
    statLabel.value     = '  STATISTIK KEHADIRAN';
    statLabel.font      = { name: 'Calibri', size: 11, bold: true, color: { argb: C.primaryFg } };
    statLabel.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.accentGreen } };
    statLabel.alignment = { vertical: 'middle', horizontal: 'left' };
    ws1.getRow(pr).height = 22;
    pr++;

    const stats = [
      ['âœ… Total Hari Hadir',    data.total_hadir,       C.greenLight, C.greenDark, C.accentGreen],
      ['âŒ Total Tidak Hadir',   data.total_tidak_hadir, C.redLight,   C.redDark,   C.accentRed  ],
      ['ðŸ“… Total Hari Periode',  data.total_hari,        C.amberLight, C.amberDark, C.accentAmber],
      ['ðŸ“Š Persentase Kehadiran',`${pct}%`,              'FFE0E7FF',   C.primaryBg, C.primaryBg  ],
    ];
    stats.forEach(([label, val, bgArgb, fgArgb, accentArgb]) => {
      ws1.getRow(pr).height = 26;
      const lc = ws1.getCell(`B${pr}`);
      lc.value     = label;
      lc.font      = { name: 'Calibri', size: 12, bold: true, color: { argb: fgArgb } };
      lc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      lc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      lc.border    = borderMedium(accentArgb);

      ws1.mergeCells(`C${pr}:D${pr}`);
      const vc = ws1.getCell(`C${pr}`);
      vc.value     = val;
      vc.font      = { name: 'Calibri', size: 16, bold: true, color: { argb: fgArgb } };
      vc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      vc.alignment = { vertical: 'middle', horizontal: 'center' };
      vc.border    = borderMedium(accentArgb);
      pr++;
    });

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SHEET 2 â€” KALENDER PER BULAN
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const ws2 = wb.addWorksheet('ðŸ“… Kalender', {
      properties: { tabColor: { argb: C.accentGreen } },
    });
    ws2.views = [{ showGridLines: false }];

    // Generate all dates in range
    const allDates = [];
    const cur  = new Date(tanggal_mulai + 'T00:00:00');
    const last = new Date(tanggal_akhir  + 'T00:00:00');
    while (cur <= last) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      allDates.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }

    // Group by month
    const byMonth = {};
    allDates.forEach(d => {
      const key = d.slice(0, 7);
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(d);
    });

    const HARI  = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
    const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

    // Cal sheet columns â€” 7 day cols per month, 2 spacer cols between months
    // Layout: left margin col(1) | Mon cols 7 | spacer(1) | Mon cols 7 | ...
    // We'll stack months vertically for simplicity with max 2 per row
    const CAL_COLS = 7;
    const SPACER   = 1;

    ws2.columns = [
      { key: 'margin', width: 3 },
      ...Array.from({ length: CAL_COLS }, (_, i) => ({ key: `d${i}`, width: 7 })),
      { key: 'spacer', width: 4 },
      ...Array.from({ length: CAL_COLS }, (_, i) => ({ key: `d${i+7}`, width: 7 })),
    ];

    // Banner
    ws2.mergeCells('A1:O1');
    const cal_banner = ws2.getCell('A1');
    cal_banner.value     = `ðŸ“…  KALENDER KEHADIRAN â€” ${nama}  (${fmtDate(tanggal_mulai)} s/d ${fmtDate(tanggal_akhir)})`;
    cal_banner.font      = { name: 'Calibri', size: 13, bold: true, color: { argb: C.primaryFg } };
    cal_banner.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.primaryBg } };
    cal_banner.alignment = { vertical: 'middle', horizontal: 'center' };
    ws2.getRow(1).height = 26;

    ws2.getRow(2).height = 8; // spacer

    const monthKeys = Object.keys(byMonth).sort();
    // 2 months per row
    const MONTHS_PER_ROW = 2;
    const LEFT_COL  = 2;   // col index (1-based) for left month
    const RIGHT_COL = 10;  // col index for right month (2 + 7 + 1)

    let calRow = 3;

    for (let mi = 0; mi < monthKeys.length; mi += MONTHS_PER_ROW) {
      const monthPair = monthKeys.slice(mi, mi + MONTHS_PER_ROW);
      const rowStart  = calRow;

      monthPair.forEach((mKey, pairIdx) => {
        const [y, m] = mKey.split('-');
        const monthLabel = `${BULAN[parseInt(m) - 1]} ${y}`;
        const firstDayDow = new Date(`${mKey}-01T00:00:00`).getDay(); // 0=Sun
        const daysInMonth = new Date(parseInt(y), parseInt(m), 0).getDate();
        const colOff = pairIdx === 0 ? LEFT_COL : RIGHT_COL;

        // Month title
        const mTitleRow = ws2.getRow(rowStart);
        mTitleRow.height = 22;
        const mTitle = ws2.getCell(rowStart, colOff);
        ws2.mergeCells(rowStart, colOff, rowStart, colOff + CAL_COLS - 1);
        mTitle.value     = `  ${monthLabel}`;
        mTitle.font      = { name: 'Calibri', size: 12, bold: true, color: { argb: C.primaryFg } };
        mTitle.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.primaryBg } };
        mTitle.alignment = { vertical: 'middle', horizontal: 'left' };

        // Day-of-week headers
        const dowRow = ws2.getRow(rowStart + 1);
        dowRow.height = 18;
        HARI.forEach((h, hi) => {
          const dc = ws2.getCell(rowStart + 1, colOff + hi);
          dc.value     = h;
          dc.font      = { name: 'Calibri', size: 10, bold: true, color: { argb: h === 'Min' ? C.accentRed : C.primaryBg } };
          dc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
          dc.alignment = { vertical: 'middle', horizontal: 'center' };
        });

        // Day cells
        let dayRow = rowStart + 2;
        let dayCol = colOff + firstDayDow;

        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr  = `${y}-${m}-${String(day).padStart(2, '0')}`;
          const inRange  = dateStr >= tanggal_mulai && dateStr <= tanggal_akhir;
          const isHadir  = hadirSet.has(dateStr);
          const isSunday = (firstDayDow + day - 1) % 7 === 0;

          if (dayCol >= colOff + CAL_COLS) { dayRow++; dayCol = colOff; }
          ws2.getRow(dayRow).height = 18;

          const dc = ws2.getCell(dayRow, dayCol);
          dc.value = day;
          dc.alignment = { vertical: 'middle', horizontal: 'center' };

          if (!inRange) {
            dc.font = { name: 'Calibri', size: 10, color: { argb: 'FFCBD5E1' } };
            dc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          } else if (isHadir) {
            dc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.greenDark } };
            dc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.greenLight } };
            dc.border = { top: { style:'thin', color:{ argb: C.accentGreen } }, left: { style:'thin', color:{ argb: C.accentGreen } }, bottom: { style:'thin', color:{ argb: C.accentGreen } }, right: { style:'thin', color:{ argb: C.accentGreen } } };
          } else {
            dc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.redDark } };
            dc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.redLight } };
            dc.border = { top: { style:'thin', color:{ argb: C.accentRed } }, left: { style:'thin', color:{ argb: C.accentRed } }, bottom: { style:'thin', color:{ argb: C.accentRed } }, right: { style:'thin', color:{ argb: C.accentRed } } };
          }

          dayCol++;
          if (dayCol >= colOff + CAL_COLS) { dayRow++; dayCol = colOff; }
        }

        // Max rows needed (rowStart + 1 dow + 6 weeks + 1 spacer)
        calRow = Math.max(calRow, dayRow + 2);
      });

      calRow = calRow + 1; // spacer between month rows
    }

    // Legend
    ws2.getRow(calRow).height = 8;
    calRow++;
    const legRow = ws2.getRow(calRow);
    legRow.height = 18;
    const legCells = [
      [LEFT_COL,      '  âœ… Hadir',     C.greenLight, C.greenDark ],
      [LEFT_COL + 2,  '  âŒ Tidak Hadir', C.redLight, C.redDark   ],
      [LEFT_COL + 4,  '  â¬œ Di luar periode', 'FFF8FAFC', 'FFCBD5E1'],
    ];
    legCells.forEach(([col, label, bg, fg]) => {
      ws2.mergeCells(calRow, col, calRow, col + 1);
      const lc = ws2.getCell(calRow, col);
      lc.value     = label;
      lc.font      = { name: 'Calibri', size: 10, bold: true, color: { argb: fg } };
      lc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      lc.alignment = { vertical: 'middle', horizontal: 'left' };
      lc.border    = border1;
    });

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SHEET 3 â€” DETAIL DAFTAR HADIR & TIDAK HADIR
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const ws3 = wb.addWorksheet('ðŸ“‹ Detail Absensi', {
      properties: { tabColor: { argb: C.accentAmber } },
    });
    ws3.views = [{ showGridLines: false, state: 'frozen', ySplit: 4 }];
    ws3.columns = [
      { key: 'no',     width: 6  },
      { key: 'tgl',    width: 14 },
      { key: 'hari',   width: 24 },
      { key: 'status', width: 16 },
      { key: 'note',   width: 30 },
    ];

    // Banner
    ws3.mergeCells('A1:E1');
    const d3_banner = ws3.getCell('A1');
    d3_banner.value     = `ðŸ“‹  DETAIL ABSENSI â€” ${nama}`;
    d3_banner.font      = { name: 'Calibri', size: 13, bold: true, color: { argb: C.primaryFg } };
    d3_banner.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.primaryBg } };
    d3_banner.alignment = { vertical: 'middle', horizontal: 'center' };
    ws3.getRow(1).height = 26;

    ws3.mergeCells('A2:E2');
    const d3_sub = ws3.getCell('A2');
    d3_sub.value     = `Periode: ${fmtDate(tanggal_mulai)} s/d ${fmtDate(tanggal_akhir)}   |   Hadir: ${data.total_hadir} hari   |   Tidak Hadir: ${data.total_tidak_hadir} hari   |   Kehadiran: ${pct}%`;
    d3_sub.font      = { name: 'Calibri', size: 10, color: { argb: 'FFCBD5E1' } };
    d3_sub.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
    d3_sub.alignment = { vertical: 'middle', horizontal: 'center' };
    ws3.getRow(2).height = 18;

    ws3.getRow(3).height = 8; // spacer

    // Header row
    const d3Headers = ['No', 'Tanggal', 'Hari', 'Status', 'Keterangan'];
    ws3.getRow(4).height = 22;
    d3Headers.forEach((h, i) => {
      const cell = ws3.getRow(4).getCell(i + 1);
      cell.value     = h;
      cell.font      = { name: 'Calibri', size: 11, bold: true, color: { argb: C.primaryFg } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.primaryBg } };
      cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', indent: i > 0 ? 1 : 0 };
      cell.border    = border1;
    });

    // Data rows â€” all dates in range
    allDates.forEach((dateStr, idx) => {
      const rowIdx  = idx + 5;
      const isHadir = hadirSet.has(dateStr);
      const isBg    = idx % 2 === 0;
      const row     = ws3.getRow(rowIdx);
      row.height    = 19;

      const rowBg   = isHadir
        ? (isBg ? C.greenLight : 'FFE6FFF5')
        : (isBg ? C.redLight   : 'FFFFF0F0');

      const cells = [
        idx + 1,
        dateStr,
        fmtDateFull(dateStr),
        isHadir ? 'âœ… HADIR' : 'âŒ TIDAK HADIR',
        isHadir ? '' : 'Tidak tercatat hadir pada tanggal ini',
      ];

      cells.forEach((val, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value     = val;
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border    = border1;
        cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'center' : 'left', indent: ci > 0 ? 1 : 0 };
        if (ci === 3) {
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: isHadir ? C.greenDark : C.redDark } };
        } else {
          cell.font = { name: 'Calibri', size: 10, color: { argb: C.darkText } };
        }
      });
    });

    // â”€â”€â”€ Send file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const safeName = nama.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
    const filename  = `Absensi_${safeName}_${tanggal_mulai}_sd_${tanggal_akhir}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Export riwayat absensi error:', err);
    res.status(500).json({ error: 'Gagal mengekspor data absensi.' });
  }
});



// GET /api/absensi/export-semua-karyawan â€” Export rekap kehadiran SEMUA karyawan ke Excel
app.get('/api/absensi/export-semua-karyawan', requirePermission('absensi'), async (req, res) => {
  try {
    const { tanggal_mulai, tanggal_akhir } = req.query;
    if (!tanggal_mulai || !tanggal_akhir) {
      return res.status(400).json({ error: 'Parameter tanggal_mulai dan tanggal_akhir diperlukan.' });
    }

    const data  = await db.getAbsensiRiwayatSemuaUser(tanggal_mulai, tanggal_akhir);
    const { allDates, total_hari, users } = data;

    const fmtDate = (d) => {
      if (!d) return '';
      const [y, m, day] = d.split('-');
      const bln = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
      return `${parseInt(day)} ${bln[parseInt(m)-1]} ${y}`;
    };
    const fmtDateFull = (d) => {
      if (!d) return '';
      const [y, m, day] = d.split('-');
      const bln = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
      const hari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
      const dt = new Date(`${d}T00:00:00`);
      return `${hari[dt.getDay()]}, ${parseInt(day)} ${bln[parseInt(m)-1]} ${y}`;
    };
    const fmtShortDay = (d) => {
      if (!d) return '';
      const [y, m, day] = d.split('-');
      return `${String(day).padStart(2,'0')}/${String(m).padStart(2,'0')}`;
    };

    // Colors
    const C = {
      primaryBg:'FF4F46E5', primaryFg:'FFFFFFFF', headerBg:'FF312E81',
      green:'FF10B981', greenLight:'FFD1FAE5', greenDark:'FF065F46',
      red:'FFEF4444', redLight:'FFFEE2E2', redDark:'FF991B1B',
      amber:'FFF59E0B', amberLight:'FFFEF3C7', amberDark:'FF92400E',
      gray:'FFF8FAFC', grayMid:'FFE2E8F0', grayDark:'FF64748B',
      white:'FFFFFFFF', dark:'FF1E293B',
      picker:'FF7C3AED', pickerBg:'FFEDE9FE',
      sorter:'FF065F46', sorterBg:'FFD1FAE5',
      loader:'FF92400E', loaderBg:'FFFEF3C7',
    };
    const posColor = (pos) => {
      const p = (pos||'').toLowerCase();
      if (p==='picker') return { fg: C.picker, bg: C.pickerBg };
      if (p==='sorter') return { fg: C.sorter, bg: C.sorterBg };
      if (p==='loader') return { fg: C.loader, bg: C.loaderBg };
      return { fg: C.grayDark, bg: C.gray };
    };
    const thin = { style:'thin', color:{ argb: C.grayMid } };
    const b1 = { top:thin, left:thin, bottom:thin, right:thin };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SS08 - Formulir Pencapaian Kerja';
    wb.created = new Date();

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SHEET 1 â€” REKAP SEMUA KARYAWAN (summary table)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const ws1 = wb.addWorksheet('ðŸ“Š Rekap Semua Karyawan', {
      views: [{ showGridLines: false, state: 'frozen', ySplit: 5 }],
      properties: { tabColor: { argb: C.primaryBg } },
    });

    // Banner
    const totalCols = 8;
    ws1.mergeCells(1, 1, 1, totalCols);
    const banner = ws1.getCell('A1');
    banner.value = `ðŸ“Š REKAP KEHADIRAN SEMUA KARYAWAN  â€”  ${fmtDate(tanggal_mulai)} s/d ${fmtDate(tanggal_akhir)}`;
    banner.font  = { name:'Calibri', size:14, bold:true, color:{ argb: C.primaryFg } };
    banner.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.primaryBg } };
    banner.alignment = { vertical:'middle', horizontal:'center' };
    ws1.getRow(1).height = 28;

    ws1.mergeCells(2, 1, 2, totalCols);
    const sub = ws1.getCell('A2');
    sub.value = `Total Karyawan: ${users.length}  |  Total Hari Periode: ${total_hari}  |  Dicetak: ${new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}`;
    sub.font  = { name:'Calibri', size:10, color:{ argb:'FFCBD5E1' } };
    sub.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.headerBg } };
    sub.alignment = { vertical:'middle', horizontal:'center' };
    ws1.getRow(2).height = 18;
    ws1.getRow(3).height = 8;

    // Stats summary row
    const totalHadir     = users.reduce((s, u) => s + u.total_hadir, 0);
    const avgPct         = users.length > 0 ? (users.reduce((s,u) => s + parseFloat(u.pct), 0) / users.length).toFixed(1) : '0';
    const statCols = [
      { label:'ðŸ‘¥ Total Karyawan', val: users.length,   bg:'FFE0E7FF', fg: C.primaryBg },
      { label:'ðŸ“… Total Hari',    val: total_hari,      bg: C.amberLight, fg: C.amberDark },
      { label:'ðŸ“Š Rata-rata Kehadiran', val: avgPct+'%', bg:'FFD1FAE5', fg: C.greenDark },
    ];
    // Stat mini cards merged across cols
    const statColWidths = [Math.floor(totalCols/3), Math.floor(totalCols/3), totalCols - 2*Math.floor(totalCols/3)];
    let statCol = 1;
    statCols.forEach((sc, i) => {
      const w = statColWidths[i];
      ws1.mergeCells(4, statCol, 4, statCol + w - 1);
      const cell = ws1.getCell(4, statCol);
      cell.value = `${sc.label}: ${sc.val}`;
      cell.font  = { name:'Calibri', size:11, bold:true, color:{ argb: sc.fg } };
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: sc.bg } };
      cell.alignment = { vertical:'middle', horizontal:'center' };
      statCol += w;
    });
    ws1.getRow(4).height = 22;

    // Header row
    const headers = ['No','Nama Karyawan','Posisi','NIK','âœ… Hadir','âŒ Tidak Hadir','ðŸ“… Total Hari','ðŸ“Š % Kehadiran'];
    const colWidths = [5, 28, 12, 14, 12, 16, 14, 16];
    ws1.columns = colWidths.map((w, i) => ({ key: `c${i}`, width: w }));
    ws1.getRow(5).height = 22;
    headers.forEach((h, i) => {
      const cell = ws1.getRow(5).getCell(i + 1);
      cell.value = h;
      cell.font  = { name:'Calibri', size:11, bold:true, color:{ argb: C.primaryFg } };
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.primaryBg } };
      cell.alignment = { vertical:'middle', horizontal: i <= 1 ? 'left' : 'center', indent: i <= 1 ? 1 : 0 };
      cell.border = b1;
    });

    // Data rows
    users.forEach((u, idx) => {
      const rowIdx = idx + 6;
      const row    = ws1.getRow(rowIdx);
      row.height   = 20;
      const isBg   = idx % 2 === 0;
      const pc     = posColor(u.user.posisi);
      const pctNum = parseFloat(u.pct);
      const pctBg  = pctNum >= 80 ? C.greenLight : pctNum >= 50 ? C.amberLight : C.redLight;
      const pctFg  = pctNum >= 80 ? C.greenDark  : pctNum >= 50 ? C.amberDark  : C.redDark;

      const rowData = [
        idx + 1,
        u.user.nama_lengkap || u.user.username,
        u.user.posisi || '-',
        u.user.nik    || '-',
        u.total_hadir,
        u.total_tidak_hadir,
        total_hari,
        u.pct + '%',
      ];
      rowData.forEach((val, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value = val;
        cell.border = b1;
        cell.alignment = { vertical:'middle', horizontal: ci <= 1 ? 'left' : 'center', indent: ci <= 1 ? 1 : 0 };
        const baseBg = isBg ? C.white : C.gray;
        if (ci === 2) { // Posisi badge
          cell.font = { name:'Calibri', size:10, bold:true, color:{ argb: pc.fg } };
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: pc.bg } };
        } else if (ci === 4) { // Hadir
          cell.font = { name:'Calibri', size:11, bold:true, color:{ argb: C.greenDark } };
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: isBg ? C.greenLight : 'FFE6FFF5' } };
        } else if (ci === 5) { // Tidak hadir
          cell.font = { name:'Calibri', size:11, bold:true, color:{ argb: C.redDark } };
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: isBg ? C.redLight : 'FFFFF0F0' } };
        } else if (ci === 7) { // % kehadiran
          cell.font = { name:'Calibri', size:11, bold:true, color:{ argb: pctFg } };
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: pctBg } };
        } else {
          cell.font = { name:'Calibri', size:10, color:{ argb: C.dark } };
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: baseBg } };
        }
      });
    });

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SHEET 2 â€” MATRIX KEHADIRAN (tanggal x karyawan)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const ws2 = wb.addWorksheet('ðŸ“… Matrix Kehadiran', {
      properties: { tabColor: { argb: C.green } },
    });
    ws2.views = [{ showGridLines: false, state: 'frozen', xSplit: 3, ySplit: 4 }];

    // Max 60 dates per sheet for readability â€” split if needed
    const dateChunks = [];
    for (let i = 0; i < allDates.length; i += 60) dateChunks.push(allDates.slice(i, i+60));
    const usedDates = dateChunks[0] || allDates; // use first 60 dates for matrix

    // Columns: No | Nama | Posisi | [date cols...]
    const fixedCols = [
      { key:'no',    width: 5  },
      { key:'nama',  width: 26 },
      { key:'posisi',width: 10 },
      ...usedDates.map(d => ({ key: d, width: 6 })),
      { key:'hadir',      width: 10 },
      { key:'tidakhadir', width: 14 },
      { key:'pct',        width: 13 },
    ];
    ws2.columns = fixedCols;

    // Banner
    ws2.mergeCells(1, 1, 1, fixedCols.length);
    const mBanner = ws2.getCell('A1');
    mBanner.value = `ðŸ“… MATRIX KEHADIRAN HARIAN  â€”  ${fmtDate(tanggal_mulai)} s/d ${fmtDate(tanggal_akhir)}  ${allDates.length > 60 ? `(Menampilkan 60 dari ${allDates.length} hari)` : ''}`;
    mBanner.font  = { name:'Calibri', size:13, bold:true, color:{ argb: C.primaryFg } };
    mBanner.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.primaryBg } };
    mBanner.alignment = { vertical:'middle', horizontal:'center' };
    ws2.getRow(1).height = 26;
    ws2.getRow(2).height = 8;

    // Legend row
    ws2.mergeCells(3, 1, 3, 3);
    ws2.getCell('A3').value = 'Legenda:';
    ws2.getCell('A3').font  = { name:'Calibri', size:10, bold:true, color:{ argb: C.dark } };
    ws2.getCell('A3').fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.white } };
    const legendItems = [['H',C.greenLight,C.greenDark,'Hadir'],['X',C.redLight,C.redDark,'Tidak Hadir']];
    legendItems.forEach(([sym, bg, fg, label], li) => {
      const col = 4 + li * 2;
      ws2.mergeCells(3, col, 3, col + 1);
      const lc = ws2.getCell(3, col);
      lc.value = `${sym} = ${label}`;
      lc.font  = { name:'Calibri', size:10, bold:true, color:{ argb: fg } };
      lc.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: bg } };
      lc.alignment = { vertical:'middle', horizontal:'center' };
    });
    ws2.getRow(3).height = 18;

    // Header row (col names)
    const mHeadRow = ws2.getRow(4);
    mHeadRow.height = 36;
    ['No','Nama Karyawan','Posisi', ...usedDates.map(d => fmtShortDay(d)), 'Hadir','Tidak Hadir','% Hadir'].forEach((h, i) => {
      const cell = mHeadRow.getCell(i + 1);
      cell.value = h;
      cell.font  = { name:'Calibri', size: i >= 3 && i < 3 + usedDates.length ? 8 : 10, bold:true, color:{ argb: C.primaryFg } };
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: i >= 3 && i < 3 + usedDates.length ? C.headerBg : C.primaryBg } };
      cell.alignment = { vertical:'middle', horizontal:'center', textRotation: i >= 3 && i < 3 + usedDates.length ? 90 : 0 };
      cell.border = b1;
    });

    // Data rows
    users.forEach((u, idx) => {
      const rowIdx  = idx + 5;
      const row     = ws2.getRow(rowIdx);
      row.height    = 18;
      const hadirSet = new Set(u.hadir);
      const pc = posColor(u.user.posisi);

      // No
      let ci = 1;
      const setCell = (val, font, fill, align='center') => {
        const cell = row.getCell(ci);
        cell.value = val; cell.border = b1;
        if (font) cell.font = { name:'Calibri', size:10, ...font };
        if (fill) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: fill } };
        cell.alignment = { vertical:'middle', horizontal: align };
        ci++;
      };
      setCell(idx+1, { color:{ argb: C.dark } }, idx%2===0 ? C.white : C.gray);
      setCell(u.user.nama_lengkap || u.user.username, { color:{ argb: C.dark } }, idx%2===0 ? C.white : C.gray, 'left');
      setCell(u.user.posisi || '-', { bold:true, color:{ argb: pc.fg } }, pc.bg);

      usedDates.forEach(d => {
        const h = hadirSet.has(d);
        setCell(h ? 'H' : 'X',
          { bold:true, size:9, color:{ argb: h ? C.greenDark : C.redDark } },
          h ? C.greenLight : C.redLight
        );
      });
      setCell(u.total_hadir, { bold:true, color:{ argb: C.greenDark } }, C.greenLight);
      setCell(u.total_tidak_hadir, { bold:true, color:{ argb: C.redDark } }, C.redLight);
      const pctNum = parseFloat(u.pct);
      const pfg = pctNum>=80 ? C.greenDark : pctNum>=50 ? C.amberDark : C.redDark;
      const pbg = pctNum>=80 ? C.greenLight : pctNum>=50 ? C.amberLight : C.redLight;
      setCell(u.pct+'%', { bold:true, color:{ argb: pfg } }, pbg);
    });

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SHEET 3 â€” TIDAK HADIR PER KARYAWAN (detail list)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const ws3 = wb.addWorksheet('âŒ Daftar Tidak Hadir', {
      properties: { tabColor: { argb: C.red } },
    });
    ws3.views = [{ showGridLines: false, state: 'frozen', ySplit: 3 }];
    ws3.columns = [
      { key:'no',   width: 5  },
      { key:'nama', width: 28 },
      { key:'pos',  width: 12 },
      { key:'tgl',  width: 14 },
      { key:'hari', width: 26 },
    ];

    // Banner
    ws3.mergeCells('A1:E1');
    const d3Banner = ws3.getCell('A1');
    d3Banner.value = `âŒ DAFTAR TIDAK HADIR  â€”  ${fmtDate(tanggal_mulai)} s/d ${fmtDate(tanggal_akhir)}`;
    d3Banner.font  = { name:'Calibri', size:13, bold:true, color:{ argb: C.primaryFg } };
    d3Banner.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.primaryBg } };
    d3Banner.alignment = { vertical:'middle', horizontal:'center' };
    ws3.getRow(1).height = 26;
    ws3.getRow(2).height = 8;

    // Header
    ws3.getRow(3).height = 22;
    ['No','Nama Karyawan','Posisi','Tanggal','Hari'].forEach((h, i) => {
      const cell = ws3.getRow(3).getCell(i+1);
      cell.value = h;
      cell.font  = { name:'Calibri', size:11, bold:true, color:{ argb: C.primaryFg } };
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.primaryBg } };
      cell.alignment = { vertical:'middle', horizontal: i<=1 ? 'left' : 'center', indent: i<=1 ? 1 : 0 };
      cell.border = b1;
    });

    let absRow = 4, absNo = 1;
    users.forEach(u => {
      if (u.tidak_hadir.length === 0) return;
      const pc = posColor(u.user.posisi);
      u.tidak_hadir.forEach((d, di) => {
        const row = ws3.getRow(absRow);
        row.height = 18;
        const isBg = absRow % 2 === 0;
        const bg   = isBg ? C.redLight : 'FFFFF0F0';
        const rowData = [absNo, u.user.nama_lengkap || u.user.username, u.user.posisi || '-', d, fmtDateFull(d)];
        rowData.forEach((val, ci) => {
          const cell = row.getCell(ci+1);
          cell.value = val; cell.border = b1;
          cell.alignment = { vertical:'middle', horizontal: ci<=1 ? 'left' : 'center', indent: ci<=1 ? 1 : 0 };
          if (ci === 2) {
            cell.font = { name:'Calibri', size:10, bold:true, color:{ argb: pc.fg } };
            cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: pc.bg } };
          } else {
            cell.font = { name:'Calibri', size:10, color:{ argb: C.redDark } };
            cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: bg } };
          }
        });
        absRow++; absNo++;
      });
    });

    // Send
    const filename = `Rekap_Absensi_Semua_Karyawan_${tanggal_mulai}_sd_${tanggal_akhir}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Export semua karyawan error:', err);
    res.status(500).json({ error: 'Gagal mengekspor data.' });
  }
});

// GET /api/hr/penggajian â€” Get JSON rekap penggajian
app.get('/api/hr/penggajian', requirePermission('penggajian'), async (req, res) => {
  try {
    const { tanggal_mulai, tanggal_akhir } = req.query;
    if (!tanggal_mulai || !tanggal_akhir) {
      return res.status(400).json({ error: 'Parameter tanggal_mulai dan tanggal_akhir diperlukan.' });
    }
    const data = await db.getRekapPenggajian(tanggal_mulai, tanggal_akhir);
    res.json(data);
  } catch (err) {
    console.error('GET /api/hr/penggajian error:', err);
    res.status(500).json({ error: 'Gagal memuat rekap penggajian.' });
  }
});

// GET /api/hr/penggajian/export â€” Export rekap penggajian ke Excel
app.get('/api/hr/penggajian/export', requirePermission('penggajian'), async (req, res) => {
  try {
    const { tanggal_mulai, tanggal_akhir } = req.query;
    if (!tanggal_mulai || !tanggal_akhir) {
      return res.status(400).json({ error: 'Parameter tanggal_mulai dan tanggal_akhir diperlukan.' });
    }

    const data = await db.getRekapPenggajian(tanggal_mulai, tanggal_akhir);
    const { pekerja, total_hari } = data;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SS08 - Formulir Pencapaian Kerja';
    wb.created = new Date();

    const ws = wb.addWorksheet('ðŸ“‹ Rekap Penggajian', {
      views: [{ showGridLines: true, state: 'frozen', ySplit: 7, xSplit: 3 }],
      properties: { tabColor: { argb: 'FF4F46E5' } }
    });

    const C = {
      primaryBg:'FF3F51B5', primaryFg:'FFFFFFFF', headerBg:'FF1A237E',
      green:'FF10B981', greenLight:'FFD1FAE5', greenDark:'FF065F46',
      red:'FFEF4444', redLight:'FFFEE2E2', redDark:'FF991B1B',
      amber:'FFF59E0B', amberLight:'FFFEF3C7', amberDark:'FF92400E',
      gray:'FFF8FAFC', grayMid:'FFE2E8F0', grayDark:'FF64748B',
      white:'FFFFFFFF', dark:'FF1E293B',
      picker:'FF7C3AED', pickerBg:'FFEDE9FE',
      sorter:'FF065F46', sorterBg:'FFD1FAE5',
      loader:'FF92400E', loaderBg:'FFFEF3C7',
    };

    const b1 = {
      top: { style:'thin', color:{ argb: C.grayMid } },
      left: { style:'thin', color:{ argb: C.grayMid } },
      bottom: { style:'thin', color:{ argb: C.grayMid } },
      right: { style:'thin', color:{ argb: C.grayMid } }
    };

    const posColor = (pos) => {
      const p = (pos||'').toLowerCase();
      if (p==='picker') return { fg: C.picker, bg: C.pickerBg };
      if (p==='sorter') return { fg: C.sorter, bg: C.sorterBg };
      if (p==='loader') return { fg: C.loader, bg: C.loaderBg };
      return { fg: C.grayDark, bg: C.gray };
    };

    // Columns widths setup
    // A: No, B: NIK, C: Nama Karyawan, D: Tipe, E: JHK (Hari Hadir)
    // F: Sorter F, G: Sorter C, H: Sorter A
    // I: Picker F, J: Picker C, K: Picker A
    // L: Loader Container
    // M: Pendapatan, N: Nominal, O: Jika Dihitung Per Kehadiran, P: Keterangan
    const colWidths = [5, 14, 28, 12, 6, 14, 14, 14, 14, 14, 14, 14, 16, 16, 18, 16];
    ws.columns = colWidths.map((w, i) => ({ key: `c${i}`, width: w }));

    // Title banner row 1
    ws.mergeCells(1, 1, 1, 16);
    const titleCell = ws.getCell('A1');
    titleCell.value = 'ðŸ’µ LAPORAN SUMMARY GAJIAN KARYAWAN';
    titleCell.font  = { name:'Calibri', size:14, bold:true, color:{ argb: C.primaryFg } };
    titleCell.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: 'FF312E81' } };
    titleCell.alignment = { vertical:'middle', horizontal:'center' };
    ws.getRow(1).height = 28;

    ws.mergeCells(2, 1, 2, 16);
    const subTitle = ws.getCell('A2');
    subTitle.value = `Periode: ${tanggal_mulai} s/d ${tanggal_akhir} (${total_hari} Hari)`;
    subTitle.font  = { name:'Calibri', size:10, bold:true, color:{ argb:'FFCBD5E1' } };
    subTitle.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: 'FF1E1B4B' } };
    subTitle.alignment = { vertical:'middle', horizontal:'center' };
    ws.getRow(2).height = 18;

    // Parameters Box at top right (Columns Q, R, S)
    // Row 4: Labels
    ws.getCell('Q4').value = 'KETERANGAN';
    ws.getCell('R4').value = 'UMR @ BULAN';
    ws.getCell('S4').value = 'UMR @ HARI';
    ws.getRow(4).height = 18;
    ['Q4','R4','S4'].forEach(c => {
      const cell = ws.getCell(c);
      cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: C.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = b1;
    });

    // Row 5: Values
    ws.getCell('Q5').value = 'PERBANDINGAN';
    ws.getCell('R5').value = 3904711;
    ws.getCell('R5').numFmt = 'Rp#,##0';
    ws.getCell('S5').value = 153250;
    ws.getCell('S5').numFmt = 'Rp#,##0';
    ws.getRow(5).height = 18;
    ['Q5','R5','S5'].forEach(c => {
      const cell = ws.getCell(c);
      cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: C.dark } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.alignment = { vertical: 'middle', horizontal: c === 'Q5' ? 'center' : 'right' };
      cell.border = b1;
    });

    // Unit prices at top row 3 & 4 for columns F to L
    // Row 3: Sorter prices
    ws.mergeCells('F3:H3');
    ws.getCell('F3').value = 'TARIF SORTER:  FREEZER = Rp 312  |  CHILLER = Rp 390  |  AMBIENT = Rp 437';
    ws.getCell('F3').font = { name: 'Calibri', size: 9, italic: true, bold: true, color: { argb: C.grayDark } };
    ws.getCell('F3').alignment = { vertical: 'middle', horizontal: 'center' };

    // Row 4: Picker & Loader prices
    ws.mergeCells('I4:L4');
    ws.getCell('I4').value = 'TARIF PICKER: FREEZER = Rp 2,73, CHILLER = Rp 3,95, AMBIENT = Rp 4,42  |  LOADER: Rp 232 / Container';
    ws.getCell('I4').font = { name: 'Calibri', size: 9, italic: true, bold: true, color: { argb: C.grayDark } };
    ws.getCell('I4').alignment = { vertical: 'middle', horizontal: 'center' };

    // Row 5: Sorter & Picker headers
    ws.mergeCells('F5:H5');
    ws.getCell('F5').value = 'SORTER';
    ws.getCell('F5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
    ws.getCell('F5').font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0369A1' } };
    ws.getCell('F5').alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getCell('F5').border = b1;

    ws.mergeCells('I5:K5');
    ws.getCell('I5').value = 'PICKER';
    ws.getCell('I5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
    ws.getCell('I5').font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF6B21A8' } };
    ws.getCell('I5').alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getCell('I5').border = b1;

    ws.getCell('L5').value = 'LOADER';
    ws.getCell('L5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } };
    ws.getCell('L5').font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF385723' } };
    ws.getCell('L5').alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getCell('L5').border = b1;

    // Row 6: Total container headers
    ws.mergeCells('F6:H6');
    ws.getCell('F6').value = 'TOTAL CONTAINER';
    ws.getCell('F6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws.getCell('F6').font = { name: 'Calibri', size: 9, bold: true, color: { argb: C.grayDark } };
    ws.getCell('F6').alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getCell('F6').border = b1;

    ws.mergeCells('I6:K6');
    ws.getCell('I6').value = 'TOTAL CONTAINER';
    ws.getCell('I6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws.getCell('I6').font = { name: 'Calibri', size: 9, bold: true, color: { argb: C.grayDark } };
    ws.getCell('I6').alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getCell('I6').border = b1;

    ws.getCell('L6').value = 'TOTAL CONTAINER';
    ws.getCell('L6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws.getCell('L6').font = { name: 'Calibri', size: 9, bold: true, color: { argb: C.grayDark } };
    ws.getCell('L6').alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getCell('L6').border = b1;

    // Row 7: Columns subheaders
    const subHeaders = [
      'NO', 'NIK', 'NAMA', 'TIPE', 'JHK',
      'FREEZER', 'CHILLER', 'AMBIENT',
      'FREEZER', 'CHILLER', 'AMBIENT',
      'CONTAINER',
      'PENDAPATAN', 'NOMINAL',
      'JIKA DIHITUNG PER KEHADIRAN', 'KETERANGAN'
    ];
    ws.getRow(7).height = 24;
    subHeaders.forEach((sh, i) => {
      const cell = ws.getRow(7).getCell(i + 1);
      cell.value = sh;
      cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: C.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= 4 ? 'FF475569' : (i <= 7 ? 'FF0284C7' : (i <= 10 ? 'FF7E22CE' : (i === 11 ? 'FF2E7D32' : 'FF0F172A'))) } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = b1;
    });

    // Helper functions for zone breakdown carian value extraction
    const getZoneValue = (zonaDetail, pos, category) => {
      let sum = 0;
      if (!Array.isArray(zonaDetail)) return 0;
      zonaDetail.forEach(zd => {
        if (String(zd.posisi || '').toLowerCase() === pos.toLowerCase()) {
          const z = String(zd.zona || '').trim().toUpperCase();
          let matched = false;
          if (category === 'FREEZER' && (z.startsWith('F') || z === 'FREEZER')) matched = true;
          if (category === 'CHILLER' && (z.startsWith('R') || z === 'CHILLER')) matched = true;
          if (category === 'AMBIENT' && (z.startsWith('T') || z === 'AMBIENT')) matched = true;
          if (matched) {
            sum += zd.nilai || 0;
          }
        }
      });
      return sum;
    };

    const getLoaderValue = (zonaDetail) => {
      let sum = 0;
      if (!Array.isArray(zonaDetail)) return 0;
      zonaDetail.forEach(zd => {
        if (String(zd.posisi || '').toLowerCase() === 'loader') {
          sum += zd.nilai || 0;
        }
      });
      return sum;
    };

    const sums = {
      jhk: 0,
      sf: 0, sc: 0, sa: 0,
      pf: 0, pc: 0, pa: 0,
      loader: 0,
      pendapatan: 0,
      nominal: 0,
      umrComp: 0
    };

    // Populate data starting from Row 8
    pekerja.forEach((p, idx) => {
      const rowIdx = idx + 8;
      const row = ws.getRow(rowIdx);
      row.height = 20;
      const isBg = idx % 2 === 0;
      const baseBg = isBg ? C.white : C.gray;
      
      const sfVal = getZoneValue(p.zona_detail, 'Sorter', 'FREEZER');
      const scVal = getZoneValue(p.zona_detail, 'Sorter', 'CHILLER');
      const saVal = getZoneValue(p.zona_detail, 'Sorter', 'AMBIENT');
      const pfVal = getZoneValue(p.zona_detail, 'Picker', 'FREEZER');
      const pcVal = getZoneValue(p.zona_detail, 'Picker', 'CHILLER');
      const paVal = getZoneValue(p.zona_detail, 'Picker', 'AMBIENT');
      const ldVal = getLoaderValue(p.zona_detail);
      
      const pendapatan = p.pendapatan_carian;
      const nominal = p.pendapatan_carian;
      const umrComparison = p.total_hadir * 153250;
      const isAchieve = pendapatan >= umrComparison;

      sums.jhk += p.total_hadir;
      sums.sf += sfVal; sums.sc += scVal; sums.sa += saVal;
      sums.pf += pfVal; sums.pc += pcVal; sums.pa += paVal;
      sums.loader += ldVal;
      sums.pendapatan += pendapatan;
      sums.nominal += nominal;
      sums.umrComp += umrComparison;

      // Helper to render zone breakdown values
      const renderZoneVal = (col, val) => {
        const cell = row.getCell(col);
        cell.value = val;
        cell.numFmt = 'Rp#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.font = { name: 'Calibri', size: 9, color: { argb: val > 0 ? C.dark : 'FFCBD5E1' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
        cell.border = b1;
      };

      // Draw cells
      // 1: NO
      row.getCell(1).value = idx + 1;
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(1).font = { name: 'Calibri', size: 9 };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
      row.getCell(1).border = b1;

      // 2: NIK
      row.getCell(2).value = p.user.nik || '-';
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(2).font = { name: 'Calibri', size: 9, color: { argb: C.grayDark } };
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
      row.getCell(2).border = b1;

      // 3: NAMA
      row.getCell(3).value = p.user.nama_lengkap || p.user.username || p.nama;
      row.getCell(3).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      row.getCell(3).font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.dark } };
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
      row.getCell(3).border = b1;

      // 4: TIPE
      row.getCell(4).value = p.user.tipe_karyawan || 'Productivity';
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(4).font = { name: 'Calibri', size: 9, bold: true, color: { argb: p.user.tipe_karyawan === 'PHL' ? C.picker : C.dark } };
      row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: p.user.tipe_karyawan === 'PHL' ? C.pickerBg : baseBg } };
      row.getCell(4).border = b1;

      // 5: JHK
      row.getCell(5).value = p.total_hadir;
      row.getCell(5).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(5).font = { name: 'Calibri', size: 10, bold: true, color: { argb: p.total_hadir < 9 ? C.redDark : C.dark } };
      row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: p.total_hadir < 9 ? C.redLight : baseBg } };
      row.getCell(5).border = b1;

      renderZoneVal(6, sfVal);
      renderZoneVal(7, scVal);
      renderZoneVal(8, saVal);

      // 9: PF, 10: PC, 11: PA
      renderZoneVal(9, pfVal);
      renderZoneVal(10, pcVal);
      renderZoneVal(11, paVal);

      // 12: LOADER
      renderZoneVal(12, ldVal);

      // 13: PENDAPATAN
      const cellM = row.getCell(13);
      cellM.value = pendapatan;
      cellM.numFmt = 'Rp#,##0';
      cellM.alignment = { vertical: 'middle', horizontal: 'right' };
      cellM.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.greenDark } };
      cellM.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isBg ? C.greenLight : 'FFE6FFF5' } };
      cellM.border = b1;

      // 14: NOMINAL
      const cellN = row.getCell(14);
      cellN.value = nominal;
      cellN.numFmt = 'Rp#,##0';
      cellN.alignment = { vertical: 'middle', horizontal: 'right' };
      cellN.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.greenDark } };
      cellN.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isBg ? C.greenLight : 'FFE6FFF5' } };
      cellN.border = b1;

      // 15: JIKA DIHITUNG PER KEHADIRAN
      const cellO = row.getCell(15);
      cellO.value = umrComparison;
      cellO.numFmt = 'Rp#,##0';
      cellO.alignment = { vertical: 'middle', horizontal: 'right' };
      cellO.font = { name: 'Calibri', size: 10, color: { argb: C.dark } };
      cellO.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
      cellO.border = b1;

      // 16: KETERANGAN
      const cellP = row.getCell(16);
      cellP.value = isAchieve ? 'ACHIEVE' : 'NOT ACHIEVE';
      cellP.alignment = { vertical: 'middle', horizontal: 'center' };
      cellP.font = { name: 'Calibri', size: 9, bold: true, color: { argb: isAchieve ? C.greenDark : 'FFFFFFFF' } };
      cellP.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isAchieve ? C.greenLight : C.amber } };
      cellP.border = b1;
    });

    // Grand Total Row
    const tRowIdx = pekerja.length + 8;
    const tRow = ws.getRow(tRowIdx);
    tRow.height = 24;

    ws.mergeCells(tRowIdx, 1, tRowIdx, 4);
    const tLCell = tRow.getCell(1);
    tLCell.value = 'GRAND TOTAL';
    tLCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.white } };
    tLCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    tLCell.alignment = { vertical: 'middle', horizontal: 'center' };

    const formatSumCell = (col, val, numFmt = 'Rp#,##0', bgHex = 'FF1E293B') => {
      const cell = tRow.getCell(col);
      cell.value = val;
      cell.numFmt = numFmt;
      cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'center' : 'right' };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgHex } };
      cell.border = b1;
    };

    formatSumCell(5, sums.jhk, '#,##0');
    formatSumCell(6, sums.sf);
    formatSumCell(7, sums.sc);
    formatSumCell(8, sums.sa);
    formatSumCell(9, sums.pf);
    formatSumCell(10, sums.pc);
    formatSumCell(11, sums.pa);
    formatSumCell(12, sums.loader);
    formatSumCell(13, sums.pendapatan, 'Rp#,##0', 'FF065F46'); // Highlight total green
    formatSumCell(14, sums.nominal, 'Rp#,##0', 'FF065F46');
    formatSumCell(15, sums.umrComp);

    // Empty cell for Keterangan
    tRow.getCell(16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    tRow.getCell(16).border = b1;

    const totalEarningsCarian = sums.pendapatan;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SHEET 2 â€” DETAIL KEHADIRAN (matrix calendar)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const dataAbsensi = await db.getAbsensiRiwayatSemuaUser(tanggal_mulai, tanggal_akhir);
    const { allDates, users: absensiUsers } = dataAbsensi;

    const ws2 = wb.addWorksheet('ðŸ“… Detail Kehadiran', {
      properties: { tabColor: { argb: C.green } }
    });
    ws2.views = [{ showGridLines: false, state: 'frozen', xSplit: 4, ySplit: 4 }];

    const fmtShortDay = (d) => {
      if (!d) return '';
      const [y, m, day] = d.split('-');
      return `${String(day).padStart(2,'0')}/${String(m).padStart(2,'0')}`;
    };

    // Columns: No | Nama | Posisi | Tipe | [date cols...] | Hadir | Tidak Hadir | % Kehadiran
    const fixedCols = [
      { key:'no',    width: 5  },
      { key:'nama',  width: 26 },
      { key:'posisi',width: 10 },
      { key:'tipe',  width: 12 },
      ...allDates.map(d => ({ key: d, width: 6 })),
      { key:'hadir',      width: 10 },
      { key:'tidakhadir', width: 14 },
      { key:'pct',        width: 13 },
    ];
    ws2.columns = fixedCols;

    // Banner Matrix
    ws2.mergeCells(1, 1, 1, fixedCols.length);
    const mBanner = ws2.getCell('A1');
    mBanner.value = `ðŸ“… MATRIX DETAIL KEHADIRAN HARIAN KARYAWAN`;
    mBanner.font  = { name:'Calibri', size:13, bold:true, color:{ argb: C.primaryFg } };
    mBanner.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.primaryBg } };
    mBanner.alignment = { vertical:'middle', horizontal:'center' };
    ws2.getRow(1).height = 26;
    
    ws2.mergeCells(2, 1, 2, fixedCols.length);
    const mSubBanner = ws2.getCell('A2');
    mSubBanner.value = `Periode: ${tanggal_mulai} s/d ${tanggal_akhir} (${total_hari} Hari)`;
    mSubBanner.font  = { name:'Calibri', size:10, color:{ argb:'FFCBD5E1' } };
    mSubBanner.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.headerBg } };
    mSubBanner.alignment = { vertical:'middle', horizontal:'center' };
    ws2.getRow(2).height = 18;

    // Legend
    ws2.mergeCells(3, 1, 3, 4);
    ws2.getCell('A3').value = 'Legenda:   H = Hadir (Hijau)   |   X = Tidak Hadir (Merah)';
    ws2.getCell('A3').font  = { name:'Calibri', size:10, bold:true, color:{ argb: C.dark } };
    ws2.getCell('A3').alignment = { vertical:'middle', horizontal:'left', indent: 1 };
    ws2.getRow(3).height = 18;

    // Headers
    const mHeadRow = ws2.getRow(4);
    mHeadRow.height = 36;
    ['No','Nama Karyawan','Posisi','Tipe', ...allDates.map(d => fmtShortDay(d)), 'Hadir','Tidak Hadir','% Hadir'].forEach((h, i) => {
      const cell = mHeadRow.getCell(i + 1);
      cell.value = h;
      cell.font  = { name:'Calibri', size: i >= 4 && i < 4 + allDates.length ? 8 : 10, bold:true, color:{ argb: C.primaryFg } };
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: i >= 4 && i < 4 + allDates.length ? C.headerBg : C.primaryBg } };
      cell.alignment = { vertical:'middle', horizontal:'center', textRotation: i >= 4 && i < 4 + allDates.length ? 90 : 0 };
      cell.border = b1;
    });

    // Matrix Data Rows
    absensiUsers.forEach((u, idx) => {
      const rowIdx  = idx + 5;
      const row     = ws2.getRow(rowIdx);
      row.height    = 18;
      const hadirSet = new Set(u.hadir);
      const pc = posColor(u.user.posisi);

      let ci = 1;
      const setCell = (val, font, fill, align='center') => {
        const cell = row.getCell(ci);
        cell.value = val; cell.border = b1;
        if (font) cell.font = { name:'Calibri', size:10, ...font };
        if (fill) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: fill } };
        cell.alignment = { vertical:'middle', horizontal: align };
        ci++;
      };
      setCell(idx+1, { color:{ argb: C.dark } }, idx%2===0 ? C.white : C.gray);
      setCell(u.user.nama_lengkap || u.user.username, { color:{ argb: C.dark } }, idx%2===0 ? C.white : C.gray, 'left');
      setCell(u.user.posisi || '-', { bold:true, color:{ argb: pc.fg } }, pc.bg);
      
      const tipe = u.user.tipe_karyawan || 'Productivity';
      setCell(tipe, { bold:true, color:{ argb: tipe === 'PHL' ? C.picker : C.dark } }, tipe === 'PHL' ? C.pickerBg : (idx%2===0 ? C.white : C.gray));

      allDates.forEach(d => {
        const h = hadirSet.has(d);
        setCell(h ? 'H' : 'X',
          { bold:true, size:9, color:{ argb: h ? C.greenDark : C.redDark } },
          h ? C.greenLight : C.redLight
        );
      });
      setCell(u.total_hadir, { bold:true, color:{ argb: C.greenDark } }, C.greenLight);
      setCell(u.total_tidak_hadir, { bold:true, color:{ argb: C.redDark } }, C.redLight);
      const pctNum = parseFloat(u.pct);
      const pfg = pctNum>=80 ? C.greenDark : pctNum>=50 ? C.amberDark : C.redDark;
      const pbg = pctNum>=80 ? C.greenLight : pctNum>=50 ? C.amberLight : C.redLight;
      setCell(u.pct+'%', { bold:true, color:{ argb: pfg } }, pbg);
    });

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SHEET 3 â€” DETAIL PENDAPATAN (carian detail log)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const listDetails = await db.getDetailSubmissionsAndLoader(tanggal_mulai, tanggal_akhir);

    const ws3 = wb.addWorksheet('ðŸ’µ Detail Pendapatan', {
      views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }],
      properties: { tabColor: { argb: C.amber } }
    });

    ws3.columns = [
      { key: 'no', width: 6 },
      { key: 'tanggal', width: 14 },
      { key: 'nama', width: 28 },
      { key: 'posisi', width: 12 },
      { key: 'item', width: 26 },
      { key: 'jumlah', width: 12 },
      { key: 'harga', width: 14 },
      { key: 'total', width: 16 }
    ];

    // Banner Detail
    ws3.mergeCells('A1:H1');
    const dBanner = ws3.getCell('A1');
    dBanner.value = `ðŸ’µ DETAIL LOG PENDAPATAN HARIAN PEKERJA`;
    dBanner.font  = { name:'Calibri', size:13, bold:true, color:{ argb: C.primaryFg } };
    dBanner.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.primaryBg } };
    dBanner.alignment = { vertical:'middle', horizontal:'center' };
    ws3.getRow(1).height = 26;

    ws3.mergeCells('A2:H2');
    const dSubBanner = ws3.getCell('A2');
    dSubBanner.value = `Periode: ${tanggal_mulai} s/d ${tanggal_akhir}  |  Total Data Log: ${listDetails.length} Record`;
    dSubBanner.font  = { name:'Calibri', size:10, color:{ argb:'FFCBD5E1' } };
    dSubBanner.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: C.headerBg } };
    dSubBanner.alignment = { vertical:'middle', horizontal:'center' };
    ws3.getRow(2).height = 18;
    ws3.getRow(3).height = 8; // Spacer

    // Headers
    const dHeaders = ['No', 'Tanggal', 'Nama Karyawan', 'Posisi', 'Keterangan/Zona', 'Volume', 'Tarif Satuan', 'Total Pendapatan'];
    ws3.getRow(4).height = 22;
    dHeaders.forEach((h, i) => {
      const cell = ws3.getRow(4).getCell(i + 1);
      cell.value = h;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.primaryFg } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.primaryBg } };
      cell.alignment = { vertical: 'middle', horizontal: i <= 2 || i === 4 ? 'left' : (i === 3 ? 'center' : 'right'), indent: i <= 2 || i === 4 ? 1 : 0 };
      cell.border = b1;
    });

    // Populate log list
    listDetails.forEach((ld, idx) => {
      const rowIdx = idx + 5;
      const row = ws3.getRow(rowIdx);
      row.height = 20;
      const isBg = idx % 2 === 0;
      const baseBg = isBg ? C.white : C.gray;
      const pc = posColor(ld.posisi);

      const rowValues = [
        idx + 1,
        ld.tanggal,
        ld.nama,
        ld.posisi,
        ld.item,
        ld.jumlah,
        ld.harga,
        ld.total_nilai
      ];

      rowValues.forEach((val, ci) => {
        const cell = row.getCell(ci + 1);
        cell.border = b1;

        if (ci === 0) {
          cell.value = val;
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.font = { name: 'Calibri', size: 9, color: { argb: C.dark } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
        } else if (ci === 1) {
          cell.value = val;
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.font = { name: 'Calibri', size: 9, color: { argb: C.dark } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
        } else if (ci === 2) {
          cell.value = val;
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.dark } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
        } else if (ci === 3) {
          cell.value = val;
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: pc.fg } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pc.bg } };
        } else if (ci === 4) {
          cell.value = val;
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          cell.font = { name: 'Calibri', size: 9, color: { argb: C.grayDark } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
        } else if (ci === 5) {
          cell.value = val;
          cell.numFmt = '#,##0';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.font = { name: 'Calibri', size: 10, color: { argb: C.dark } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
        } else if (ci === 6) {
          cell.value = val;
          cell.numFmt = 'Rp#,##0';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.font = { name: 'Calibri', size: 10, color: { argb: C.dark } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
        } else {
          cell.value = val;
          cell.numFmt = 'Rp#,##0';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: C.greenDark } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isBg ? C.greenLight : 'FFE6FFF5' } };
        }
      });
    });

    // Grand total row for detailed logs
    const dTotalRowIdx = listDetails.length + 5;
    const dTRow = ws3.getRow(dTotalRowIdx);
    dTRow.height = 22;
    ws3.mergeCells(dTotalRowIdx, 1, dTotalRowIdx, 7);
    const dTLabelCell = dTRow.getCell(1);
    dTLabelCell.value = 'GRAND TOTAL PENDAPATAN LOG';
    dTLabelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.primaryFg } };
    dTLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
    dTLabelCell.alignment = { vertical: 'middle', horizontal: 'center' };

    const dTotalValCell = dTRow.getCell(8);
    dTotalValCell.value = totalEarningsCarian;
    dTotalValCell.numFmt = 'Rp#,##0';
    dTotalValCell.border = b1;
    dTotalValCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: C.primaryFg } };
    dTotalValCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.green } };
    dTotalValCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const filename = `Rekap_Kehadiran_dan_Pendapatan_${tanggal_mulai}_sd_${tanggal_akhir}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Export penggajian error:', err);
    res.status(500).json({ error: 'Gagal mengekspor data penggajian.' });
  }
});


// GET /api/submissions/pending-count â€” Jumlah submission pending (untuk badge admin)
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

    // Ambil data kapasitas carian (batch capacity) untuk submission ini
    let carian_capacity = null;
    try {
      const batches = Array.isArray(submission.batch_cluster)
        ? submission.batch_cluster
        : JSON.parse(submission.batch_cluster || '[]');
      if (batches.length > 0 && submission.tanggal_carian && submission.posisi && submission.zona) {
        const capacities = await db.getMultipleBatchesCapacity(
          submission.tanggal_carian,
          submission.posisi,
          submission.zona,
          batches
        );
        // Gabungkan kapasitas semua batch yang terkait submission ini
        let total_carian = 0, sudah_diisi = 0, ada_data = false;
        for (const b of batches) {
          const cap = capacities[b];
          if (cap && cap.ada_data_carian) {
            ada_data = true;
            total_carian += cap.total_output || 0;
            sudah_diisi += (cap.total_output || 0) - (cap.sisa || 0);
          }
        }
        if (ada_data) {
          carian_capacity = {
            ada_data_carian: true,
            total_output: total_carian,
            sudah_diisi,
            sisa: total_carian - sudah_diisi,
            satuan: submission.posisi === 'Picker' ? 'pcs' : 'kontainer',
            batches
          };
        }
      }
    } catch (capErr) {
      console.error('Fetch carian capacity error:', capErr);
      // tidak fatal – lanjut tanpa data kapasitas
    }

    res.json({ ...submission, files, carian_capacity });
  } catch (err) {
    console.error('Fetch submission detail error:', err);
    res.status(500).json({ error: 'Gagal memuat detail.' });
  }
});

// PUT /api/submissions/:id â€” Update submission fields (Admin only)
app.put('/api/submissions/:id', requirePermission('submissions'), async (req, res) => {
  try {
    const { jumlah_output, catatan_tambahan, tanggal_carian, tanggal_pengerjaan } = req.body;
    
    // Validasi data
    if (jumlah_output === undefined || isNaN(parseInt(jumlah_output)) || parseInt(jumlah_output) < 0) {
      return res.status(400).json({ error: 'Jumlah output tidak valid.' });
    }

    const orig = await db.getSubmissionById(req.params.id);
    if (!orig) return res.status(404).json({ error: 'Data tidak ditemukan.' });

    // Update
    const updated = await db.updateSubmission(req.params.id, req.body);
    
    // Invalidate cache
    if (orig.tanggal_carian) invalidateDcCache(orig.tanggal_carian);
    if (tanggal_carian && tanggal_carian !== orig.tanggal_carian) {
      invalidateDcCache(tanggal_carian);
    }
    
    // Audit Log
    await db.insertAuditLog(req.user.username, 'UPDATE_SUBMISSION', `Mengedit submission ID ${req.params.id} milik ${orig.nama} (Jumlah Output diubah dari ${orig.jumlah_output} menjadi ${jumlah_output})`);
    
    // Auto-Sync Google Sheets
    if (googleSheets.isConfigured()) {
      setImmediate(async () => {
        try {
          await syncSubmissionsToSheets();
        } catch(e) {
          console.error('[AutoSync Edit] Google Sheets sync error:', e.message);
        }
      });
    }

    res.json({ success: true, submission: updated });
  } catch (err) {
    console.error('Update submission error:', err);
    res.status(500).json({ error: 'Gagal memperbarui data submission.' });
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
          console.log(`[AutoSync] Submission ${req.params.id} dihapus â€” Sheets berhasil diperbarui.`);
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

// PUT /api/submissions/:id/status â€” Admin approve atau reject submission pending
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
          console.log(`[AutoSync] Status submission ${req.params.id} â†’ "${status}" berhasil disync ke Sheets.`);
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
    res.status(500).json({ success: false, error: 'Gagal mengekspor data.' });
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
    res.status(500).json({ success: false, error: 'Gagal mengekspor data.' });
  }
});

// ==================== GOOGLE SHEETS ROUTES ====================

// GET /api/google-sheets/status â€” Cek status koneksi Google Sheets
app.get('/api/google-sheets/status', requireAdmin, async (req, res) => {
  try {
    const status = await googleSheets.checkStatus();
    res.json(status);
  } catch (err) {
    console.error('Google Sheets status error:', err);
    res.status(500).json({ error: 'Gagal cek status Google Sheets.' });
  }
});

// POST /api/google-sheets/push â€” Manual push semua data ke Google Sheets
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
      // Map files by loader_entry_id (bukan submission_id) karena file loader disimpan di kolom loader_entry_id
      const loaderFilesMap = new Map();
      for (const f of allFiles) {
        const key = f.loader_entry_id;
        if (!key) continue; // skip file milik submission biasa
        if (!loaderFilesMap.has(key)) {
          loaderFilesMap.set(key, []);
        }
        loaderFilesMap.get(key).push(f);
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

// GET /api/data-carian â€” Ambil semua atau filter per tanggal
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

// GET /api/data-carian/tanggal-list â€” Daftar tanggal yang punya data carian
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

// POST /api/data-carian â€” Tambah satu record
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

// PUT /api/data-carian/:id â€” Edit satu record
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

// DELETE /api/data-carian/:id â€” Hapus satu record
app.delete('/api/data-carian/:id', requireAuth, async (req, res) => {
  try {
    const record = await db.getDataCarianById(req.params.id);
    await db.deleteDataCarian(req.params.id);
    if (record && record.tanggal_carian) {
      invalidateDcCache(record.tanggal_carian);
    } else {
      invalidateDcCache(null);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete data carian error:', err);
    res.status(500).json({ error: 'Gagal menghapus data carian.' });
  }
});

// DELETE /api/data-carian/tanggal/:tanggal â€” Hapus semua data carian untuk tanggal tertentu
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

// POST /api/data-carian/import-excel â€” Import dari file Excel
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
    // data mulai row 7 â†’ batch ada di kolom F (per zona group, 5 kolom: BATCH, QTY, ACT QTY, KONT, ACT KONT)
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
        // Cek baris 3â€“8 (idx 3â€“8): ada yang berisi "TANGGAL CARI" di kolom 0?
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

    // Helper: parse single Picker sheet â†’ array of records
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

    // Helper: parse single Sorter sheet â†’ array of records
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
      // Fallback: try to extract zona from sheet name (e.g. "Sorter R1" â†’ "R1")
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
            parsed.push({ tanggal_carian, posisi: 'Sorter', zona: zonaVal, batch: batchNum, total_output: totalRps, satuan: 'kontainer' });
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
      //   - Row X: Zona group â€” FREZZER, CHILLER, AMBIENT
      //   - Row X+1: Zona code â€” F1, R1, R2, R3, T1..T5, ALL
      //   - Row X+2: Posisi â€” Picker, Shorter, LOADER
      //   - Row X+3: Label zona â€” "FREZZER ZONA F1 Picker", dll
      //   - Row HEADER (auto-detect): TANGGAL CARI, GROUP MOBIL, KODE, ...
      //   - Row HEADER+1+: Data per toko
      // Setiap zona = 5 kolom: BATCH, QTY, ACT QTY, KONT, ACT KONT
      // Loader = 3 kolom terakhir: FREZZER KONT, CHILLER KONT, AMBIENT KONT
      // ====================================================
      const sheetName = lembarFixSheet || sheetNames[0];
      const raw = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });

      // Auto-detect baris header (TANGGAL CARI) â€” sudah ditemukan saat deteksi format
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
          // fallback: cari dari baris label (1 sebelum header) â€” berisi "FREZZER ALL ZONA LOADER"
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
      const pickerAgg  = {}; // `${tgl}|${zona}|${batch}` â†’ total QTY
      const sorterAgg  = {}; // `${tgl}|${zona}|${batch}` â†’ total KONT
      const loaderAgg  = {}; // `${tgl}|${cluster}|${groupMobil}` â†’ total KONT
      const pickerTokoCount  = {}; // `${tgl}|${zona}|${batch}` â†’ jumlah toko unik
      const sorterTokoCount  = {}; // `${tgl}|${zona}|${batch}` â†’ jumlah toko unik
      const loaderTokoCount  = {}; // `${tgl}|${cluster}|${groupMobil}` â†’ jumlah toko unik

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
          // Excel serial date â†’ JS Date (Excel epoch = Jan 1 1900, tapi ada bug +2 hari)
          const jsDate = new Date(Math.round((tglVal - 25569) * 86400 * 1000));
          if (!isNaN(jsDate)) {
            const y = jsDate.getUTCFullYear();
            const m = String(jsDate.getUTCMonth() + 1).padStart(2, '0');
            const d = String(jsDate.getUTCDate()).padStart(2, '0');
            parsed = `${y}-${m}-${d}`;
          }
        } else if (typeof tglVal === 'string' && tglVal.trim()) {
          // Coba parse string tanggal â€” bisa "30-May-2026", "30/05/2026", "2026-05-30", dll.
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

      // â”€â”€ VALIDASI BATCH KOSONG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Cek per zona: jika ada baris yang punya QTY/KONT tapi kolom BATCH kosong
      const emptyBatchErrors   = []; // zona yang SEMUA barisnya batch kosong â†’ tolak upload
      const emptyBatchWarnings = []; // zona yang SEBAGIAN barisnya batch kosong â†’ warning
      for (const { zona, colBatch, colQty, colKont } of zonaGroups) {
        let rowsWithData = 0;
        let rowsWithEmptyBatch = 0;
        for (let r = DATA_START; r < raw.length; r++) {
          const row = raw[r];
          const namaToko = String(row[4] || '').trim();
          if (!namaToko) continue;
          const qty  = parseFloat(row[colQty])  || 0;
          const kont = parseFloat(row[colKont]) || 0;
          if (qty > 0 || kont > 0) {
            rowsWithData++;
            const batchVal = row[colBatch];
            const batch = (batchVal !== '' && batchVal !== null && batchVal !== undefined)
              ? String(batchVal).trim() : '';
            if (!batch || batch === '0') rowsWithEmptyBatch++;
          }
        }
        if (rowsWithData > 0 && rowsWithEmptyBatch === rowsWithData) {
          // Semua baris zona ini batch kosong â†’ ERROR, tolak
          emptyBatchErrors.push(`Zona ${zona}: semua ${rowsWithData} baris punya data tapi kolom BATCH kosong`);
        } else if (rowsWithEmptyBatch > 0) {
          // Sebagian batch kosong â†’ WARNING, tetap proses
          emptyBatchWarnings.push(`Zona ${zona}: ${rowsWithEmptyBatch} dari ${rowsWithData} baris dilewati karena kolom BATCH kosong`);
        }
      }
      // Jika ada zona kritis (semua batch kosong) â†’ tolak upload sekarang
      if (emptyBatchErrors.length > 0) {
        return res.status(400).json({
          error: `Upload dibatalkan: kolom BATCH kosong di semua baris data. Pastikan admin mengisi kolom BATCH sebelum upload.`,
          empty_batch_errors: emptyBatchErrors,
          hint: 'Cek file Excel dan pastikan kolom BATCH (kolom pertama tiap zona) sudah terisi untuk setiap baris toko.'
        });
      }
      // Warning batch sebagian kosong â†’ tambahkan ke skipped agar tampil di UI
      for (const w of emptyBatchWarnings) {
        skipped.push(`âš ï¸ ${w}`);
      }
      // â”€â”€ END VALIDASI BATCH KOSONG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


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
      // Row 1 (idx 0): Posisi â€” PICKER / SHORTER / LOADER
      // Row 2 (idx 1): Zona  â€” F1, R1, R2, R3, T1..T5, FREZZER, CHILLER, AMBIENT
      // Row 3 (idx 2): Batch number (angka)
      // Row 4 (idx 3): Label lengkap â€” "PICKER ZONA F1 BATCH 1" / "LOADER ZONA FREZZER"
      // Row 5 (idx 4): QTY / ACT (header sub-kolom, tiap batch = 2 kolom: QTY, ACT)
      // Row 6+  (idx 5+): Data per toko â€” sum kolom QTY untuk total per batch
      //
      // OPTIMASI: Baca cell langsung via encode_cell, bukan sheet_to_json,
      // karena sheet_to_json sangat lambat untuk 321 kolom Ã— 2000 baris.
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
        // SUM kolom QTY langsung via cell address â€” mulai dari baris data pertama
        const totals = {}; // col â†’ total
        const loaderClusterTotals = {}; // col â†’ { cluster â†’ sum }
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

// GET /api/data-carian/template â€” Download template Excel
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
    res.status(500).json({ success: false, error: 'Gagal membuat template.' });
  }
});

// GET /api/export-data-carian â€” Export data carian ke Excel (dengan kode toko/batch)
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
    res.status(500).json({ success: false, error: 'Gagal mengekspor data carian.' });
  }
});

// POST /api/data-carian/push-sheets â€” Push data carian harian ke Google Sheets (append ke bawah)
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

// GET /api/users â€” List semua user operasional
app.get('/api/users', requirePermission('users'), async (req, res) => {
  try {
    const users = await db.getAllOperationalUsers();
    res.json(users);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Gagal memuat data user.' });
  }
});

// POST /api/users â€” Buat user operasional baru
app.post('/api/users', requirePermission('users'), async (req, res) => {
  try {
    const { username, nama_lengkap, nik, posisi, tipe_karyawan, nomor_hp } = req.body;
    if (!username || !nama_lengkap || !nik || !posisi) {
      return res.status(400).json({ error: 'Semua field (username, nama lengkap, NIK, posisi) wajib diisi.' });
    }
    if (!['Picker', 'Sorter', 'Loader', 'Return', 'QC Outbound'].includes(posisi)) {
      return res.status(400).json({ error: 'Posisi harus Picker, Sorter, Loader, Return, atau QC Outbound.' });
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

// DELETE /api/users/:id â€” Hapus user operasional
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
    const targetUser = await db.getUserById(req.params.id);
    const systemAdminId = await db.getSystemAdminId();
    if (req.params.id === systemAdminId || (targetUser?.username && targetUser.username.toLowerCase() === 'admin')) {
      return res.status(409).json({ error: 'Akun Administrator utama digunakan oleh sistem dan tidak dapat dinonaktifkan.' });
    }

    const updated = await db.toggleUserStatus(req.params.id);
    const statusLabel = updated.is_active === false ? 'dinonaktifkan' : 'diaktifkan';
    await db.insertAuditLog(req.user.username, 'TOGGLE_USER_STATUS', `User operasional ${updated.username} (${updated.nama_lengkap}) telah ${statusLabel}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Toggle user status error:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Gagal mengubah status user.' });
  }
});

// PUT /api/users/:id — Edit user operasional
app.put('/api/users/:id', requirePermission('users'), async (req, res) => {
  try {
    const { username, nama_lengkap, nik, posisi, tipe_karyawan, nomor_hp } = req.body;
    if (!username || !nama_lengkap || !nik || !posisi) {
      return res.status(400).json({ error: 'Semua field (username, nama lengkap, NIK, posisi) wajib diisi.' });
    }
    if (username.trim().toLowerCase() === 'admin') {
      return res.status(409).json({ error: 'Username "admin" dicadangkan untuk Administrator utama sistem.' });
    }

    const targetUser = await db.getUserById(req.params.id);
    const systemAdminId = await db.getSystemAdminId();
    if (req.params.id === systemAdminId || (targetUser?.username && targetUser.username.toLowerCase() === 'admin')) {
      return res.status(409).json({ error: 'Akun Administrator utama digunakan oleh sistem dan tidak dapat diedit dari sini.' });
    }

    if (!['Picker', 'Sorter', 'Loader', 'Return', 'QC Outbound'].includes(posisi)) {
      return res.status(400).json({ error: 'Posisi harus Picker, Sorter, Loader, Return, atau QC Outbound.' });
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
    const status = err.status || 400;
    const msg = err.message.includes('sudah digunakan') || err.message.includes('utama') || err.message.includes('dicadangkan') ? err.message : 'Gagal mengupdate user.';
    res.status(status).json({ error: msg });
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

    // Siapa yang sudah submit (berdasarkan nama_lengkap match dengan nama di submissions)
    const sudahSubmitNama = new Set(submissionsHariIni.map(s => s.nama?.toLowerCase().trim()));

    const sudah = [];
    const belum = [];

    pickerSorter.forEach(u => {
      const userNama = (u.nama_lengkap || u.username || '').toLowerCase().trim();
      const waktuSubmit = submissionsHariIni
        .filter(s => s.nama?.toLowerCase().trim() === userNama)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

      if (sudahSubmitNama.has(userNama)) {
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

// POST /api/send-wa-reminder â€” Kirim notif WA via Fonnte ke yang belum input
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
      if (nomor.startsWith('0')) nomor = '62' + nomor.slice(1); // 08xx â†’ 628xx
      if (!nomor.startsWith('62')) nomor = '62' + nomor;

      const pesan = pesan_custom ||
        `Halo ${target.nama}! ðŸ‘‹\n\nKami ingatkan bahwa kamu *belum menginput data carian* untuk tanggal *${tanggalFormatted}*.\n\nMohon segera lakukan input sebelum hari ini berakhir ya.\n\nTerima kasih! ðŸ™\n- Tim SS08`;

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


// GET /api/admin-accounts â€” List semua akun admin (Super Admin only)
app.get('/api/admin-accounts', requireSuperAdmin, async (req, res) => {
  try {
    const admins = await db.getAllAdminUsers();
    res.json(admins);
  } catch (err) {
    console.error('Get admin accounts error:', err);
    res.status(500).json({ error: 'Gagal memuat data akun admin.' });
  }
});

// POST /api/admin-accounts â€” Buat akun admin baru (Super Admin only)
app.post('/api/admin-accounts', requireSuperAdmin, async (req, res) => {
  try {
    const { username, nama_lengkap, password, allowed_pages } = req.body;
    if (!username || !nama_lengkap || !password) {
      return res.status(400).json({ error: 'Username, nama lengkap, dan password wajib diisi.' });
    }
    if (username.trim().toLowerCase() === 'admin') {
      return res.status(409).json({ error: 'Username "admin" dicadangkan untuk Administrator utama sistem.' });
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

// PUT /api/admin-accounts/:id/permissions â€” Update izin akses admin (Super Admin only)
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
    if (!targetAdmin) {
      return res.status(404).json({ error: 'Akun admin tidak ditemukan.' });
    }

    const systemAdminId = await db.getSystemAdminId();
    if (req.params.id === systemAdminId || (targetAdmin.username && targetAdmin.username.toLowerCase() === 'admin')) {
      return res.status(409).json({ error: 'Akun Administrator utama digunakan oleh sistem dan tidak dapat dihapus.' });
    }

    await db.deleteAdminUser(req.params.id);
    if (targetAdmin) {
      await db.insertAuditLog(req.user.username, 'DELETE_ADMIN', `Menghapus akun admin: ${targetAdmin.username}`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete admin account error:', err);
    const msg = err.message.includes('utama') || err.message.includes('sendiri') || err.message.includes('ditemukan') ? err.message : 'Gagal menghapus akun admin.';
    const status = err.status || 400;
    res.status(status).json({ error: msg });
  }
});

// PATCH /api/admin-accounts/:id/toggle-status — Aktifkan/Nonaktifkan akun admin (Super Admin only)
app.patch('/api/admin-accounts/:id/toggle-status', requireSuperAdmin, async (req, res) => {
  try {
    const targetAdmin = await db.getUserById(req.params.id);
    if (!targetAdmin) return res.status(404).json({ error: 'Akun admin tidak ditemukan.' });

    const systemAdminId = await db.getSystemAdminId();
    if (req.params.id === systemAdminId || (targetAdmin.username && targetAdmin.username.toLowerCase() === 'admin')) {
      return res.status(409).json({ error: 'Akun Administrator utama digunakan oleh sistem dan tidak dapat dinonaktifkan.' });
    }

    const updated = await db.toggleAdminStatus(req.params.id);
    const statusLabel = updated.is_active === false ? 'dinonaktifkan' : 'diaktifkan';
    await db.insertAuditLog(req.user.username, 'TOGGLE_ADMIN_STATUS', `Akun admin ${updated.username} (${updated.nama_lengkap}) telah ${statusLabel}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Toggle admin status error:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Gagal mengubah status akun admin.' });
  }
});

// PUT /api/admin-accounts/:id — Update data akun admin (Super Admin only)
app.put('/api/admin-accounts/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { username, nama_lengkap, is_active } = req.body;
    const targetAdmin = await db.getUserById(req.params.id);
    if (!targetAdmin) return res.status(404).json({ error: 'Akun admin tidak ditemukan.' });

    const systemAdminId = await db.getSystemAdminId();
    const isSystemAdmin = req.params.id === systemAdminId || (targetAdmin.username && targetAdmin.username.toLowerCase() === 'admin');

    if (isSystemAdmin) {
      if (is_active === false) {
        return res.status(409).json({ error: 'Akun Administrator utama digunakan oleh sistem dan tidak dapat dinonaktifkan.' });
      }
      if (username && username.trim().toLowerCase() !== 'admin') {
        return res.status(409).json({ error: 'Username akun Administrator utama dilindungi dan tidak dapat diubah.' });
      }
    } else {
      if (username && username.trim().toLowerCase() === 'admin') {
        return res.status(409).json({ error: 'Username "admin" dicadangkan untuk Administrator utama sistem.' });
      }
    }

    const updated = await db.updateAdminUser(req.params.id, { username, nama_lengkap, is_active });
    await db.insertAuditLog(req.user.username, 'UPDATE_ADMIN', `Mengupdate data akun admin: ${targetAdmin.username}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Update admin account error:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Gagal mengupdate akun admin.' });
  }
});

// POST /api/admin-accounts/change-password â€” Ganti password sendiri
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

// POST /api/user/change-nik â€” Ganti password sendiri (khusus user operasional)
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

    // Reissue JWT token with same payload (or updated if needed)
    const tokenPayload = {
      userId: user.userId,
      username: user.username,
      nama_lengkap: user.nama_lengkap,
      posisi: user.posisi,
      role: 'operasional'
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    const msg = err.message.includes('tidak cocok') || err.message.includes('ditemukan') || err.message.includes('digunakan')
      ? err.message : 'Gagal mengubah password.';
    res.status(400).json({ error: msg });
  }
});

// ==================== REKAP TOKO ROUTES ====================

// GET /api/rekap-toko?tanggal=YYYY-MM-DD â€” Rekap per toko dengan actual dari submissions
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

// GET /api/rekap-toko/tanggal-list â€” Daftar tanggal yang punya data toko
app.get('/api/rekap-toko/tanggal-list', requireAuth, async (req, res) => {
  try {
    const dates = await db.getTokoDataTanggalList();
    res.json(dates);
  } catch (err) {
    console.error('Get rekap toko tanggal list error:', err);
    res.status(500).json({ error: 'Gagal memuat daftar tanggal.' });
  }
});

// DELETE /api/rekap-toko/tanggal/:tanggal â€” Hapus data toko untuk tanggal tertentu
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

// GET /api/announcements â€” Public: get active announcements only
app.get('/api/announcements', async (req, res) => {
  try {
    const data = await db.getActiveAnnouncements();
    res.json(data);
  } catch (err) {
    console.error('Get announcements error:', err);
    res.status(500).json({ error: 'Gagal memuat pengumuman.' });
  }
});

// GET /api/announcements/all â€” Admin: get all (active + inactive)
app.get('/api/announcements/all', requireAuth, async (req, res) => {
  try {
    const data = await db.getAllAnnouncements();
    res.json(data);
  } catch (err) {
    console.error('Get all announcements error:', err);
    res.status(500).json({ error: 'Gagal memuat pengumuman.' });
  }
});

// POST /api/announcements â€” Admin: create new
app.post('/api/announcements', requireAuth, uploadLembar.single('image'), async (req, res) => {
  try {
    const { title, content, type, emoji } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title dan content wajib diisi.' });
    
    let imageUrl = '';
    if (req.file) {
      const uniqueFilename = `announcement-${Date.now()}-${req.file.originalname}`;
      imageUrl = await db.saveUploadedFile(uniqueFilename, req.file.buffer, req.file.mimetype);
    }

    const record = await db.createAnnouncement({
      title, content, type, emoji, imageUrl,
      created_by: req.user?.username || 'admin'
    });
    await db.insertAuditLog(req.user?.username, 'CREATE_ANNOUNCEMENT', `Buat pengumuman: ${title}`);
    res.json(record);
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Gagal membuat pengumuman.' });
  }
});

// PUT /api/announcements/:id â€” Admin: update
app.put('/api/announcements/:id', requireAuth, uploadLembar.single('image'), async (req, res) => {
  try {
    const { title, content, type, emoji, is_active } = req.body;
    let imageUrl = req.body.image_url;

    if (req.file) {
      const uniqueFilename = `announcement-${Date.now()}-${req.file.originalname}`;
      imageUrl = await db.saveUploadedFile(uniqueFilename, req.file.buffer, req.file.mimetype);
    }

    const record = await db.updateAnnouncement(req.params.id, { title, content, type, emoji, is_active, imageUrl });
    await db.insertAuditLog(req.user?.username, 'UPDATE_ANNOUNCEMENT', `Update pengumuman: ${title}`);
    res.json(record);
  } catch (err) {
    console.error('Update announcement error:', err);
    res.status(500).json({ error: 'Gagal update pengumuman.' });
  }
});

// PATCH /api/announcements/:id/toggle â€” Admin: toggle active/inactive
app.patch('/api/announcements/:id/toggle', requireAuth, async (req, res) => {
  try {
    const record = await db.toggleAnnouncement(req.params.id);
    res.json(record);
  } catch (err) {
    console.error('Toggle announcement error:', err);
    res.status(500).json({ error: 'Gagal toggle pengumuman.' });
  }
});

// DELETE /api/announcements/:id â€” Admin: delete
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


// GET /api/loader-entries â€” Semua atau filter per tanggal (lengkap dengan info file/foto)
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

// GET /api/loader-entries/:id â€” Detail loader entry lengkap dengan file/foto
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

// POST /api/loader-entries â€” Submit entry loader baru (multipart/form-data + optional file upload)
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

    // ===== CEK ABSENSI LOADER =====
    const { user_id: submittedUserId } = req.body;
    if (submittedUserId) {
      try {
        const absensiActive = await db.getSetting('absensi_required');
        if (absensiActive === 'true') {
          const isHadir = await db.checkUserAbsensi(submittedUserId, tanggal_carian);
          if (!isHadir) {
            return res.status(403).json({
              error: `Anda belum diabsen hadir untuk tanggal carian ${tanggal_carian}. Silakan hubungi Leader/Admin.`,
              code: 'NOT_ABSEN'
            });
          }
        }
      } catch(absErr) {
        console.error('Check absensi loader error:', absErr);
      }
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
      cluster_outbound_outputs: {},
      non_group: non_group || { gacoan: 0, dikichi: 0, benfarm: 0 },
      jumlah_kontainer,
      catatan: catatan || ''
    });

    // Simpan files ke tabel files (linked ke loader entry)
    // Catatan: jika FK constraint ada (files.submission_id â†’ submissions), ini akan fail
    // â†’ gunakan try/catch agar entry tetap tersimpan, URL disimpan ke catatan sebagai fallback
    let photoUrlsFallback = [];
    for (const f of uploadedFiles) {
      try {
        await db.insertFile({
          id: uuidv4(),
          loader_entry_id: entry.id,
          filename: f.filename,
          original_name: f.original_name,
          file_path: f.file_path
        });
      } catch (fileErr) {
        // FK constraint violation â€” simpan URL ke array fallback
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

    // Beri tahu client jika ada foto yang gagal tersimpan ke tabel files
    const photoWarning = photoUrlsFallback.length > 0
      ? `${photoUrlsFallback.length} foto tidak tersimpan ke galeri (FK constraint). URL disimpan di catatan.`
      : null;

    res.json({ success: true, data: entry, warning: photoWarning });

    // ===== AUTO-SYNC ke Google Sheets (fire-and-forget, tidak block response) =====
    setImmediate(() => {
      syncLoaderEntriesToSheets();
    });

  } catch (err) {
    console.error('Insert loader entry error:', err);
    res.status(500).json({ error: 'Gagal menyimpan entry loader.' });
  }
});

// DELETE /api/loader-entries/:id â€” Hapus entry loader
app.delete('/api/loader-entries/:id', requirePermission('loader'), async (req, res) => {
  try {
    const entry = await db.getLoaderEntryById(req.params.id);
    const date = entry ? entry.tanggal_carian : null;
    await db.deleteLoaderEntry(req.params.id);
    if (date) invalidateDcCache(date); // clear cache setelah hapus
    res.json({ success: true });

    // ===== AUTO-SYNC ke Google Sheets setelah hapus (fire-and-forget) =====
    setImmediate(() => {
      syncLoaderEntriesToSheets();
    });
    // ======================================================================

  } catch (err) {
    console.error('Delete loader entry error:', err);
    res.status(500).json({ error: 'Gagal menghapus entry loader.' });
  }
});

// GET /api/export-loader â€” Export loader entries ke Excel
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
      // Hitung Outbound dari cluster_outbound_outputs
      const outboundOutputs = e.cluster_outbound_outputs || {};
      const jumlahKontainerOutbound = Object.values(outboundOutputs).reduce((sum, v) => sum + (parseInt(v) || 0), 0);

      // Detail per cluster (outbound)
      const clusterDetail = Object.entries(outboundOutputs)
        .map(([gm, qty]) => `${gm}: ${qty}`).join(', ');

      return {
        'No': i + 1,
        'Tanggal Carian': e.tanggal_carian,
        'Tanggal Kirim': e.tanggal_kirim,
        'Nama': e.nama,
        'Tipe Karyawan': userTypeMap[e.nama] || 'Belum Ditentukan',
        'Zona': e.zona,
        'No. Polisi': e.no_polisi,
        'Clusters': clusterList.join(', '),
        'Detail Outbound per Cluster': clusterDetail,
        'Gacoan': (e.non_group || {}).gacoan || 0,
        'Dikichi': (e.non_group || {}).dikichi || 0,
        'Benfarm': (e.non_group || {}).benfarm || 0,
        'Jumlah Kontainer (RPS)': e.jumlah_kontainer || 0,
        'Jumlah Kontainer (Outbound)': jumlahKontainerOutbound,
        'Catatan': e.catatan,
        'Waktu Submit': e.created_at
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      {wch:5},{wch:15},{wch:15},{wch:30},{wch:16},{wch:8},{wch:14},{wch:40},{wch:50},{wch:10},{wch:10},{wch:10},{wch:20},{wch:22},{wch:25},{wch:22}
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
    res.status(500).json({ success: false, error: 'Gagal export data loader.' });
  }
});

// ==================== USER DASHBOARD ====================

// GET /api/my-achievements â€” Pencapaian user yang sedang login (Picker/Sorter + Loader)
app.get('/api/my-achievements', requireAuth, async (req, res) => {
  try {
    const namaUser = req.user.nama_lengkap;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD

    // Ambil tanggal mulai periode aktif (tutup buku)
    const periodeSettings = await db.getPeriodeAktif();
    const periodeStart = periodeSettings.tanggal_mulai || null; // null = semua waktu

    // ===== PICKER / SORTER SUBMISSIONS =====
    let allSubmissions = [];
    if (db.isSupabaseEnabled) {
      const { createClient } = require('@supabase/supabase-js');
      const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
      const { data } = await supa.from('submissions').select('*').eq('nama', namaUser).order('created_at', { ascending: false });
      allSubmissions = (data || []).map(s => ({ ...s, batch_cluster: typeof s.batch_cluster === 'string' ? s.batch_cluster : JSON.stringify(s.batch_cluster) }));
    } else {
      allSubmissions = await db.getAllSubmissions({ nama: namaUser });
    }

    // Filter hari ini berdasarkan tanggal_carian atau tanggal_pengerjaan
    const todaySubmissions = allSubmissions.filter(s => {
      const tgl = (s.tanggal_carian || s.tanggal_pengerjaan || '').slice(0, 10);
      return tgl === today;
    });

    // Filter untuk periode aktif (ALL = sejak tanggal mulai periode)
    const filterByPeriode = (arr, dateField1 = 'tanggal_pengerjaan', dateField2 = 'tanggal_carian') => {
      if (!periodeStart) return arr;
      return arr.filter(s => {
        const tgl = (s[dateField1] || s[dateField2] || '').slice(0, 10);
        return tgl >= periodeStart;
      });
    };

    // Hitung summary Picker
    const pickerTodaySubs = todaySubmissions.filter(s => s.posisi === 'Picker');
    const sorterTodaySubs = todaySubmissions.filter(s => s.posisi === 'Sorter');
    const pickerAllSubs   = filterByPeriode(allSubmissions.filter(s => s.posisi === 'Picker'));
    const sorterAllSubs   = filterByPeriode(allSubmissions.filter(s => s.posisi === 'Sorter'));

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

    const allLoaderFiltered = filterByPeriode(allLoaderEntries, 'tanggal_kirim', 'tanggal_carian');

    const sumKontainer = (arr) => arr.reduce((acc, e) => acc + (parseInt(e.jumlah_kontainer) || 0), 0);

    res.json({
      today_date: today,
      tipe_karyawan: req.user.tipe_karyawan || 'Productivity',
      periode_start: periodeStart, // null = semua waktu
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
        all_entries: allLoaderFiltered,
        today: {
          entries: todayLoader,
          total_trip: todayLoader.length,
          total_kontainer: sumKontainer(todayLoader)
        },
        all: {
          total_trip: allLoaderFiltered.length,
          total_kontainer: sumKontainer(allLoaderFiltered)
        }
      }
    });
  } catch (err) {
    console.error('my-achievements error:', err);
    res.status(500).json({ error: 'Gagal memuat data pencapaian.' });
  }
});

// GET /api/my-absensi â€” Riwayat absensi user yang sedang login
app.get('/api/my-absensi', requireAuth, async (req, res) => {
  try {
    const { tanggal_mulai, tanggal_akhir } = req.query;
    if (!tanggal_mulai || !tanggal_akhir) {
      return res.status(400).json({ error: 'Parameter tanggal_mulai dan tanggal_akhir diperlukan.' });
    }
    if (tanggal_akhir < tanggal_mulai) {
      return res.status(400).json({ error: 'tanggal_akhir tidak boleh lebih awal dari tanggal_mulai.' });
    }
    const data = await db.getAbsensiRiwayatUser(req.user.userId, tanggal_mulai, tanggal_akhir);
    res.json(data);
  } catch (err) {
    console.error('GET /api/my-absensi error:', err);
    res.status(500).json({ error: 'Gagal memuat riwayat absensi Anda.' });
  }
});

// SPA fallback routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
// ============= KETENTUAN HARGA API =============

// GET /api/ketentuan-harga â€” ambil semua ketentuan harga
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
    const { posisi, zona, harga, keterangan, berlaku_dari } = req.body;
    if (!posisi || !zona || harga === undefined || harga === null || harga === '') {
      return res.status(400).json({ error: 'Posisi, zona, dan harga wajib diisi.' });
    }
    if (!['Picker', 'Sorter', 'Loader', 'Return'].includes(posisi)) {
      return res.status(400).json({ error: 'Posisi tidak valid.' });
    }
    const finalSatuan = posisi === 'Picker' ? 'pcs' : 'kontainer';
    const record = await db.insertKetentuanHarga({ posisi, zona, harga: parseFloat(harga), satuan: finalSatuan, keterangan, berlaku_dari: berlaku_dari || null });
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('POST ketentuan-harga error:', err);
    if (err.message && (err.message.includes('sudah ada') || err.message.includes('23505'))) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Gagal menyimpan ketentuan harga.' });
  }
});

// PUT /api/ketentuan-harga/:id — tambah periode harga baru (insert new row, harga lama tetap ada)
app.put('/api/ketentuan-harga/:id', requireAuth, async (req, res) => {
  try {
    const { harga, keterangan, berlaku_dari } = req.body;
    if (harga === undefined || harga === null || harga === '') {
      return res.status(400).json({ error: 'Harga wajib diisi.' });
    }
    if (!berlaku_dari) {
      return res.status(400).json({ error: 'Tanggal berlaku (berlaku_dari) wajib diisi.' });
    }
    const record = await db.updateKetentuanHarga(req.params.id, { harga: parseFloat(harga), keterangan, berlaku_dari });
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('PUT ketentuan-harga error:', err);
    if (err.message && (err.message.includes('sudah ada') || err.message.includes('23505'))) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Gagal menyimpan periode harga baru.' });
  }
});

// DELETE /api/ketentuan-harga/:id â€” hapus ketentuan harga
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
      // Dari bulan: misal 2026-07 â†’ 2026-07-01 s/d 2026-07-31
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

    // Terapkan filter posisi, tipe, & search
    const { posisi, tipe, search } = req.query;
    if (posisi) {
      pekerja = pekerja.filter(p => p.posisi === posisi);
    }
    if (tipe) {
      pekerja = pekerja.filter(p => p.tipe_karyawan === tipe);
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
      { header: 'Tipe',              key: 'tipe',       width: 16 },
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
        tipe: p.tipe_karyawan || 'Productivity',
        output: p.total_pencapaian || 0,
        nilai: p.total_nilai || 0,
        persen: pct
      });

      addedRow.height = 20;

      addedRow.getCell('no').alignment = { horizontal: 'center', vertical: 'middle' };
      addedRow.getCell('nama').alignment = { horizontal: 'left', vertical: 'middle' };
      addedRow.getCell('posisi').alignment = { horizontal: 'center', vertical: 'middle' };
      addedRow.getCell('tipe').alignment = { horizontal: 'center', vertical: 'middle' };
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
        addedRow.getCell('no').value = 'ðŸ¥‡ 1';
        addedRow.getCell('no').font = { bold: true };
      } else if (index === 1) {
        addedRow.getCell('no').value = 'ðŸ¥ˆ 2';
        addedRow.getCell('no').font = { bold: true };
      } else if (index === 2) {
        addedRow.getCell('no').value = 'ðŸ¥‰ 3';
        addedRow.getCell('no').font = { bold: true };
      }
    });

    // 5. Footer Row
    const footerRow = sheet.addRow({
      no: '',
      nama: 'GRAND TOTAL',
      posisi: '',
      tipe: '',
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
    res.status(500).json({ success: false, error: 'Gagal mengekspor rekap pendapatan.' });
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

// ===================== RETURN ENTRIES ROUTES =====================

// GET /api/return-entries â€” Semua return entries, filter opsional
app.get('/api/return-entries', requireAuth, async (req, res) => {
  try {
    const { tanggal_return, tanggal_referensi, status } = req.query;
    const entries = await db.getAllReturnEntries({ tanggal_return, tanggal_referensi, status });
    res.json(entries);
  } catch(err) {
    console.error('GET return-entries error:', err);
    res.status(500).json({ error: 'Gagal memuat data return.' });
  }
});

// POST /api/return-entries â€” Submit entry return baru
app.post('/api/return-entries', requireAuth, async (req, res) => {
  try {
    const decoded = jwt.verify(req.cookies.token, JWT_SECRET);
    const {
      tanggal_return, tanggal_referensi, loader_entry_id, no_polisi,
      cluster_return_outputs, total_outbound, total_kembali, total_selisih, catatan
    } = req.body;

    if (!tanggal_return || !tanggal_referensi) {
      return res.status(400).json({ error: 'Tanggal return dan referensi wajib diisi.' });
    }

    const entry = await db.insertReturnEntry({
      tanggal_return, tanggal_referensi,
      loader_entry_id: loader_entry_id || null,
      no_polisi: no_polisi || '',
      nama_return: decoded.nama_lengkap || decoded.username || '',
      cluster_return_outputs: cluster_return_outputs || {},
      total_outbound: parseInt(total_outbound) || 0,
      total_kembali: parseInt(total_kembali) || 0,
      total_selisih: parseInt(total_selisih) || 0,
      catatan: catatan || ''
    });

    res.json({ success: true, entry });

    // ===== AUTO-SYNC ke Google Sheets setelah submit return (fire-and-forget) =====
    setImmediate(async () => {
      try {
        if (googleSheets.isConfigured()) {
          const allReturn = await db.getAllReturnEntries({});
          await googleSheets.pushAllReturnEntries(allReturn);
        }
      } catch(syncErr) {
        console.error('[AutoSync Return] Google Sheets sync error:', syncErr.message);
      }
    });
    // ============================================================================

  } catch(err) {
    console.error('POST return-entries error:', err);
    res.status(500).json({ error: 'Gagal menyimpan entry return.' });
  }
});

// PATCH /api/return-entries/:id/validate â€” Admin validasi return entry
app.patch('/api/return-entries/:id/validate', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, catatan_admin } = req.body; // action: 'validate' | 'revise'
    const decoded = jwt.verify(req.cookies.token, JWT_SECRET);
    const validatedBy = decoded.username || 'admin';

    const newStatus = action === 'revise' ? 'revised' : 'validated';
    const entry = await db.validateReturnEntry(id, newStatus, validatedBy, catatan_admin || '');
    res.json({ success: true, entry });

    // ===== AUTO-SYNC ke Google Sheets setelah validasi (fire-and-forget) =====
    setImmediate(async () => {
      try {
        if (googleSheets.isConfigured()) {
          const allReturn = await db.getAllReturnEntries({});
          await googleSheets.pushAllReturnEntries(allReturn);
        }
      } catch(syncErr) {
        console.error('[AutoSync Return Validate] Google Sheets sync error:', syncErr.message);
      }
    });
    // =========================================================================

  } catch(err) {
    console.error('PATCH return-entries validate error:', err);
    res.status(500).json({ error: 'Gagal memvalidasi entry return.' });
  }
});

// GET /api/return-entries/:id â€” Detail satu return entry
app.get('/api/return-entries/:id', requireAuth, async (req, res) => {
  try {
    const entry = await db.getReturnEntryById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry tidak ditemukan.' });
    res.json(entry);
  } catch(err) {
    console.error('GET return-entry by id error:', err);
    res.status(500).json({ error: 'Gagal memuat entry return.' });
  }
});

// GET /api/export-return â€” Export return entries ke Excel dengan Styling Penuh
app.get('/api/export-return', requirePermission('loader'), async (req, res) => {
  try {
    const { tanggal_return, tanggal_referensi, status } = req.query;
    const entries = await db.getAllReturnEntries({ tanggal_return, tanggal_referensi, status });

    const timeStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    let totalOutK = 0, totalOutS = 0, totalOutD = 0;
    let totalRetK = 0, totalRetS = 0, totalRetD = 0;

    const parsePkg = (val) => {
      if (typeof val === 'number') return { kontainer: val, styrofoam: 0, dus: 0 };
      if (typeof val === 'object' && val !== null) {
        return {
          kontainer: parseInt(val.kontainer || val.kont) || 0,
          styrofoam: parseInt(val.styrofoam || val.stero) || 0,
          dus:       parseInt(val.dus || val.box) || 0
        };
      }
      const p = parseInt(val) || 0;
      return { kontainer: p, styrofoam: 0, dus: 0 };
    };

    const rowsHtml = entries.map((e, i) => {
      let clusterDetail = '';
      let rK = 0, rS = 0, rD = 0;

      try {
        const outputs = typeof e.cluster_return_outputs === 'string'
          ? JSON.parse(e.cluster_return_outputs)
          : (e.cluster_return_outputs || {});
        
        const details = [];
        Object.entries(outputs).forEach(([gm, val]) => {
          const pkg = parsePkg(val);
          rK += pkg.kontainer;
          rS += pkg.styrofoam;
          rD += pkg.dus;
          details.push(`${gm}: ${pkg.kontainer} Kont, ${pkg.styrofoam} Stero, ${pkg.dus} Dus`);
        });
        clusterDetail = details.join('; ');
      } catch(_) { clusterDetail = ''; }

      let oK = 0, oS = 0, oD = 0;
      if (typeof e.outbound_breakdown === 'object' && e.outbound_breakdown !== null) {
        oK = parseInt(e.outbound_breakdown.kontainer) || 0;
        oS = parseInt(e.outbound_breakdown.styrofoam) || 0;
        oD = parseInt(e.outbound_breakdown.dus) || 0;
      } else {
        oK = e.total_outbound || 0;
      }

      totalOutK += oK; totalOutS += oS; totalOutD += oD;
      totalRetK += rK; totalRetS += rS; totalRetD += rD;

      const sK = oK - rK;
      const sS = oS - rS;
      const sD = oD - rD;
      const totalSel = (oK + oS + oD) - (rK + rS + rD);

      const statusBg = e.status === 'validated' ? '#D1FAE5' : e.status === 'revised' ? '#FEE2E2' : '#FEF3C7';
      const statusFg = e.status === 'validated' ? '#047857' : e.status === 'revised' ? '#B91C1C' : '#B45309';
      const statusLabel = e.status === 'validated' ? 'Tervalidasi' : e.status === 'revised' ? 'Perlu Revisi' : 'Menunggu Validasi';

      const selBg = totalSel === 0 ? '#ECFDF5' : totalSel > 0 ? '#FEF3C7' : '#FEE2E2';
      const selFg = totalSel === 0 ? '#059669' : totalSel > 0 ? '#D97706' : '#DC2626';
      const selText = totalSel === 0 ? 'Sesuai (Lengkap)' : totalSel > 0 ? `âˆ’${totalSel} (Kurang)` : `+${Math.abs(totalSel)} (Lebih)`;

      const rowBg = i % 2 === 1 ? '#F8FAFC' : '#FFFFFF';

      return `
        <tr style="background-color: ${rowBg};">
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px;">${i + 1}</td>
          <td style="border: 1px solid #CBD5E1; padding: 7px; font-weight: bold; text-align: center;">${e.tanggal_return || 'â€”'}</td>
          <td style="border: 1px solid #CBD5E1; padding: 7px; text-align: center;">${e.tanggal_referensi || 'â€”'}</td>
          <td style="border: 1px solid #CBD5E1; padding: 7px; font-weight: bold; color: #1E293B;">${e.no_polisi || 'â€”'}</td>
          <td style="border: 1px solid #CBD5E1; padding: 7px;">${e.nama_return || 'â€”'}</td>
          
          <!-- Outbound Breakdown -->
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px; color: #6D28D9; background-color: #F5F3FF;">${oK}</td>
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px; color: #0284C7; background-color: #F0F9FF;">${oS}</td>
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px; color: #D97706; background-color: #FEF3C7;">${oD}</td>
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px; font-weight: bold; color: #5B21B6; background-color: #EDE9FE;">${oK + oS + oD}</td>

          <!-- Kembali DC Breakdown -->
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px; color: #0F766E; background-color: #F0FDF4;">${rK}</td>
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px; color: #0284C7; background-color: #F0F9FF;">${rS}</td>
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px; color: #D97706; background-color: #FEF3C7;">${rD}</td>
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px; font-weight: bold; color: #0F766E; background-color: #CCFBF1;">${rK + rS + rD}</td>

          <!-- Selisih Breakdown -->
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px; font-weight: bold; color: ${selFg}; background-color: ${selBg};">${selText}</td>
          
          <td style="border: 1px solid #CBD5E1; padding: 7px; font-size: 9pt;">${clusterDetail || '—'}</td>
          <td style="border: 1px solid #CBD5E1; padding: 7px; font-style: italic;">${e.catatan || '—'}</td>
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 7px; font-weight: bold; background-color: ${statusBg}; color: ${statusFg};">${statusLabel}</td>
          <td style="border: 1px solid #CBD5E1; padding: 7px;">${e.validated_by || '—'}</td>
          <td style="border: 1px solid #CBD5E1; padding: 7px; font-size: 9pt; text-align: center;">${e.created_at ? new Date(e.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : ''}</td>
        </tr>`;
    }).join('');

    const htmlContent = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Entry Return</x:Name>
                <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          body { font-family: 'Calibri', 'Segoe UI', sans-serif; font-size: 10pt; }
          .hdr-title { font-size: 16pt; font-weight: bold; color: #0F766E; }
          .hdr-sub { font-size: 10pt; color: #64748B; margin-bottom: 12px; }
          table { border-collapse: collapse; width: 100%; }
          th { background-color: #0D9488; color: #FFFFFF; font-weight: bold; padding: 10px 6px; border: 1px solid #0F766E; text-align: center; font-size: 9.5pt; }
          td { border: 1px solid #CBD5E1; padding: 6px 8px; font-size: 9.5pt; }
          .tot-row td { background-color: #F0FDF4; font-weight: bold; border-top: 2.5px solid #0D9488; font-size: 10.5pt; }
        </style>
      </head>
      <body>
        <div class="hdr-title">REKAPITULASI ENTRY RETURN KONTAINER, STYROFOAM &amp; DUS (TOKO KE DC)</div>
        <div class="hdr-sub">Sistem Manajemen Pencapaian Kerja SS08 &bull; Waktu Export: ${timeStr} &bull; Total: ${entries.length} Armada Record</div>
        <table border="1">
          <thead>
            <tr>
              <th rowspan="2" style="width:40px;">NO</th>
              <th rowspan="2" style="width:100px;">TGL RETURN</th>
              <th rowspan="2" style="width:100px;">TGL OUTBOUND</th>
              <th rowspan="2" style="width:110px;">NO. POLISI</th>
              <th rowspan="2" style="width:150px;">DIINPUT OLEH</th>
              <th colspan="4" style="background-color:#5B21B6;">OUTBOUND DIKIRIM LOADER</th>
              <th colspan="4" style="background-color:#065F46;">KEMBALI KE DC (RETURN)</th>
              <th rowspan="2" style="width:140px;">STATUS SELISIH</th>
              <th rowspan="2" style="width:250px;">DETAIL PER CLUSTER</th>
              <th rowspan="2" style="width:140px;">CATATAN</th>
              <th rowspan="2" style="width:120px;">STATUS</th>
              <th rowspan="2" style="width:120px;">VALIDATOR</th>
              <th rowspan="2" style="width:140px;">WAKTU SUBMIT</th>
            </tr>
            <tr>
              <th style="background-color:#6D28D9; width:70px;">Kontainer</th>
              <th style="background-color:#0284C7; width:70px;">Styrofoam</th>
              <th style="background-color:#D97706; width:70px;">Dus</th>
              <th style="background-color:#4C1D95; width:80px;">Total Out</th>

              <th style="background-color:#0F766E; width:70px;">Kontainer</th>
              <th style="background-color:#0284C7; width:70px;">Styrofoam</th>
              <th style="background-color:#D97706; width:70px;">Dus</th>
              <th style="background-color:#047857; width:80px;">Total DC</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="tot-row">
              <td colspan="5" style="text-align: right; padding-right: 12px;">TOTAL KESELURUHAN:</td>
              <td style="text-align: center; color: #6D28D9;">${totalOutK}</td>
              <td style="text-align: center; color: #0284C7;">${totalOutS}</td>
              <td style="text-align: center; color: #D97706;">${totalOutD}</td>
              <td style="text-align: center; color: #5B21B6;">${totalOutK + totalOutS + totalOutD}</td>

              <td style="text-align: center; color: #0F766E;">${totalRetK}</td>
              <td style="text-align: center; color: #0284C7;">${totalRetS}</td>
              <td style="text-align: center; color: #D97706;">${totalRetD}</td>
              <td style="text-align: center; color: #047857;">${totalRetK + totalRetS + totalRetD}</td>

              <td style="text-align: center;">${(totalOutK + totalOutS + totalOutD) === (totalRetK + totalRetS + totalRetD) ? 'âœ“ Sesuai' : 'Ada Selisih'}</td>
              <td colspan="5"></td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>`;

    const filename = `entry-return-${new Date().toISOString().slice(0,10)}.xls`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  } catch (err) {
    console.error('Export return error:', err);
    res.status(500).json({ success: false, error: 'Gagal export data return.' });
  }
});

// ===================== END RETURN ENTRIES =====================


// ==================== QC OUTBOUND ROUTES ====================

// GET /api/qc-outbound - Ambil semua atau filter per tanggal
app.get('/api/qc-outbound', requireQcOutbound, async (req, res) => {
  try {
    const { tanggal } = req.query;
    const entries = await db.getAllQcOutbound(tanggal || null);
    res.json({ success: true, data: entries });
  } catch (err) {
    console.error('Get QC Outbound error:', err);
    res.status(500).json({ error: 'Gagal mengambil data QC Outbound.' });
  }
});

// POST /api/qc-outbound - Simpan entry QC Outbound baru (dengan dukungan upload foto & full fields)
app.post('/api/qc-outbound', requireQcOutbound, (req, res, next) => {
  uploadLembar.array('foto_outbound', 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Ukuran file maksimum 10MB per file.' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Maksimum 5 file foto yang dapat diupload.' });
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { tanggal, tanggal_carian, tanggal_kirim, no_polisi, nama_qc, zona, kontainer, styrofoam, dus, catatan } = req.body;
    const finalTglCarian = tanggal_carian || tanggal;
    const finalTglKirim = tanggal_kirim || tanggal;

    // Validasi field wajib
    if (!finalTglCarian || !finalTglKirim || !no_polisi) {
      return res.status(400).json({ error: 'Tanggal carian, tanggal kirim, dan No. Polisi wajib diisi.' });
    }

    // Parse JSON fields
    let non_group = { gacoan: 0, dikichi: 0, benfarm: 0 };
    let clusters_breakdown = {};
    let target_rps_info = {};
    try { non_group = JSON.parse(req.body.non_group || '{}'); } catch(e) {}
    try { clusters_breakdown = JSON.parse(req.body.clusters_breakdown || '{}'); } catch(e) {}
    try { target_rps_info = JSON.parse(req.body.target_rps_info || '{}'); } catch(e) {}

    const totKont = parseInt(kontainer) || 0;
    const totStero = parseInt(styrofoam) || 0;
    const totDus = parseInt(dus) || 0;
    const totNon = (non_group.gacoan || 0) + (non_group.dikichi || 0) + (non_group.benfarm || 0);

    if (totKont + totStero + totDus + totNon === 0 && Object.keys(clusters_breakdown).length === 0) {
      return res.status(400).json({ error: 'Minimal satu jenis item harus diisi (kontainer, styrofoam, dus, atau non-group).' });
    }

    // Validasi duplikat: 1 nopol hanya boleh 1 entry per hari
    const existing = await db.getQcOutboundByNopolAndTanggal(no_polisi.trim().toUpperCase(), finalTglCarian);
    if (existing) {
      return res.status(409).json({
        error: `Armada ${no_polisi} sudah memiliki data QC Outbound untuk tanggal carian ${finalTglCarian}. Hapus data lama terlebih dahulu jika ingin menggantinya.`
      });
    }

    // Save uploaded files if any
    const uploadedFiles = [];
    const entryId = uuidv4();
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const fileId = uuidv4();
        const uniqueFilename = fileId + path.extname(file.originalname);
        const fileUrl = await db.saveUploadedFile(uniqueFilename, file.buffer, file.mimetype);
        uploadedFiles.push({ id: fileId, filename: uniqueFilename, original_name: file.originalname, file_path: fileUrl });
      }
    }

    const entry = await db.insertQcOutbound({
      id: entryId,
      tanggal: finalTglCarian,
      tanggal_carian: finalTglCarian,
      tanggal_kirim: finalTglKirim,
      no_polisi: no_polisi.trim().toUpperCase(),
      nama_qc: nama_qc || req.user?.nama_lengkap || req.user?.username || 'unknown',
      zona: zona || '',
      kontainer: totKont,
      styrofoam: totStero,
      dus: totDus,
      non_group,
      clusters_breakdown,
      target_rps_info,
      catatan: catatan || '',
      created_by: req.user?.username || req.user?.nama_lengkap || 'unknown'
    });

    // Attach file records to database if files uploaded
    if (uploadedFiles.length > 0) {
      for (const f of uploadedFiles) {
        await db.createFileRecord({
          id: f.id,
          submission_id: entryId,
          filename: f.filename,
          original_name: f.original_name,
          file_path: f.file_path,
          mime_type: f.mime_type || 'image/jpeg'
        });
      }
    }

    res.json({ success: true, data: { ...entry, files: uploadedFiles } });

    // ===== AUTO-SYNC ke Google Sheets (fire-and-forget) =====
    setImmediate(() => {
      syncQcOutboundToSheets();
    });

  } catch (err) {
    console.error('Insert QC Outbound error:', err);
    res.status(500).json({ error: 'Gagal menyimpan data QC Outbound.' });
  }
});

// DELETE /api/qc-outbound/:id - Hapus entry QC Outbound
app.delete('/api/qc-outbound/:id', requireQcOutbound, async (req, res) => {
  try {
    await db.deleteQcOutbound(req.params.id);
    res.json({ success: true });

    // ===== AUTO-SYNC ke Google Sheets setelah hapus =====
    setImmediate(() => {
      syncQcOutboundToSheets();
    });

  } catch (err) {
    console.error('Delete QC Outbound error:', err);
    res.status(500).json({ error: 'Gagal menghapus data QC Outbound.' });
  }
});

// GET /api/qc-outbound/loader-armada - Ambil daftar armada (nopol) dari loader entries per tanggal
// Digunakan sebagai dropdown saat input QC Outbound
app.get('/api/qc-outbound/loader-armada', requireQcOutbound, async (req, res) => {
  try {
    const { tanggal } = req.query;
    if (!tanggal) return res.status(400).json({ error: 'Parameter tanggal wajib diisi.' });
    const entries = await db.getAllLoaderEntries(tanggal);
    // Ambil nopol unik yang belum punya QC Outbound
    const existingQc = await db.getAllQcOutbound(tanggal);
    const existingNopol = new Set(existingQc.map(e => e.no_polisi));
    const armadaList = entries
      .filter(e => e.no_polisi)
      .map(e => ({
        no_polisi: e.no_polisi,
        nama: e.nama,
        zona: e.zona || '',
        sudah_ada_qc: existingNopol.has(e.no_polisi)
      }))
      .filter((v, i, arr) => arr.findIndex(x => x.no_polisi === v.no_polisi) === i); // deduplicate
    res.json({ success: true, data: armadaList });
  } catch (err) {
    console.error('Get loader armada error:', err);
    res.status(500).json({ error: 'Gagal mengambil data armada.' });
  }
});

// ===================== END QC OUTBOUND =====================

// ===================== LIVE CHAT MODULE =====================
// Mount chat routes — must be AFTER all existing routes + middleware,
// BEFORE the listen/export block (no catch-all conflict).
try {
  const setupChatRoutes = require('./chat-routes');
  setupChatRoutes(app, db, jwt, JWT_SECRET);
  console.log('💬 Live Chat routes registered');
} catch (err) {
  console.error('⚠️  Live Chat routes failed to load:', err.message);
  // Chat failure must NOT crash the main server
}
// ===================== END LIVE CHAT MODULE =====================


if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n🚀 Server berjalan di http://localhost:${PORT}`);
    console.log(`📝 Form: http://localhost:${PORT}`);
    console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
    console.log(`👤 Login: admin / admin123\n`);
  });
}

module.exports = app;
