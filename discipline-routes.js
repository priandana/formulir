'use strict';

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const ExcelJS = require('exceljs');

const ALLOWED_EVIDENCE_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf'
];

const uploadEvidence = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
    files: 5
  },
  fileFilter: (req, file, cb) => {
    const extOk = /\.(jpg|jpeg|png|gif|webp|pdf)$/i.test(file.originalname || '');
    if (ALLOWED_EVIDENCE_MIMES.includes(file.mimetype) || extOk) {
      cb(null, true);
    } else {
      cb(new Error('Format bukti tidak didukung. Gunakan file JPG, PNG, WEBP, GIF, atau PDF (maks 10MB).'));
    }
  }
});

module.exports = function setupDisciplineRoutes(app, db, jwt, JWT_SECRET, storeNotification = null) {
  const BUCKET_NAME = 'discipline-attachments';

  // --- Middlewares ---
  const requireAuth = async (req, res, next) => {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized. Silakan login terlebih dahulu.' });
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (!decoded.userId && decoded.id) decoded.userId = decoded.id;
      if (!decoded.userId && decoded.username) {
        const u = await db.getUserByUsername(decoded.username);
        if (u) decoded.userId = u.id;
      }
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Sesi login habis atau tidak valid. Silakan login kembali.' });
    }
  };

  const isAuthorizedDisciplineAdmin = (user) => {
    if (!user || user.role !== 'admin') return false;
    if (user.username && user.username.toLowerCase() === 'admin') return true;
    const allowed = Array.isArray(user.allowed_pages) ? user.allowed_pages : [];
    return (
      allowed.length === 0 ||
      allowed.includes('discipline') ||
      allowed.includes('users') ||
      allowed.includes('absensi') ||
      allowed.includes('penggajian')
    );
  };

  const requireDisciplineAdmin = async (req, res, next) => {
    await requireAuth(req, res, () => {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Akses ditolak. Fitur ini hanya untuk Administrator.' });
      }
      if (isAuthorizedDisciplineAdmin(req.user)) {
        return next();
      }
      return res.status(403).json({ error: 'Akses ditolak. Anda tidak memiliki izin untuk modul Poin & Disiplin.' });
    });
  };

  // Helper: upload files to private Supabase Storage bucket
  async function uploadFilesToPrivateStorage(files, incidentId, appealId, sourceType, actor) {
    if (!files || files.length === 0) return [];
    const savedAttachments = [];

    for (const file of files) {
      const safeOriginal = path.basename(file.originalname || 'bukti.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
      const folder = sourceType === 'APPEAL' ? `appeals/${appealId || incidentId}` : `incidents/${incidentId}`;
      const storagePath = `${folder}/${uuidv4()}_${safeOriginal}`;

      if (db.isSupabaseEnabled && db.supabase) {
        const { error: upErr } = await db.supabase.storage
          .from(BUCKET_NAME)
          .upload(storagePath, file.buffer, {
            contentType: file.mimetype || 'application/octet-stream',
            upsert: false
          });
        if (upErr) {
          console.error('Supabase discipline storage upload error:', upErr.message);
          throw new Error('Gagal mengunggah file bukti ke penyimpanan aman.');
        }
      }

      const attRecord = await db.addDisciplineAttachment({
        incident_id: incidentId,
        appeal_id: appealId || null,
        source_type: sourceType,
        storage_path: storagePath,
        original_filename: file.originalname || safeOriginal,
        mime_type: file.mimetype || 'application/octet-stream',
        file_size: file.size || file.buffer.length,
        uploaded_by: actor.userId || null,
        uploaded_by_name: actor.nama_lengkap || actor.username || 'User'
      });

      savedAttachments.push(attRecord);
    }

    return savedAttachments;
  }

  // Helper: hydrate signed URLs (1 hour expiry) for private storage attachments
  async function hydrateSignedUrls(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];
    if (!db.isSupabaseEnabled || !db.supabase) return attachments;

    return Promise.all(
      attachments.map(async (att) => {
        try {
          const { data, error } = await db.supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(att.storage_path, 3600);
          return {
            ...att,
            signed_url: !error && data ? data.signedUrl : null
          };
        } catch (e) {
          return { ...att, signed_url: null };
        }
      })
    );
  }

  // ===================== ADMIN ROUTES =====================

  // 1. GET /api/discipline/widget-summary — Compact widget for Dashboard MPP
  app.get('/api/discipline/widget-summary', requireAuth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Akses ditolak.' });
      }
      const dash = await db.getAdminDisciplineDashboard({});
      res.json({
        success: true,
        cards: dash.cards
      });
    } catch (err) {
      console.error('GET /api/discipline/widget-summary error:', err);
      res.status(500).json({ error: 'Gagal memuat ringkasan catatan kinerja.' });
    }
  });

  // 2. GET /api/discipline/dashboard — Full Admin Analytics Dashboard
  app.get('/api/discipline/dashboard', requireDisciplineAdmin, async (req, res) => {
    try {
      const data = await db.getAdminDisciplineDashboard({
        date_from: req.query.date_from,
        date_to: req.query.date_to,
        posisi: req.query.posisi,
        kategori: req.query.kategori,
        status_poin: req.query.status_poin,
        user_search: req.query.user_search
      });
      res.json({ success: true, ...data });
    } catch (err) {
      console.error('GET /api/discipline/dashboard error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal memuat dashboard disiplin.' });
    }
  });

  // 3. GET /api/discipline/categories — Master Pelanggaran list
  app.get('/api/discipline/categories', requireAuth, async (req, res) => {
    try {
      const activeOnly = req.query.active_only === 'true' || req.user.role !== 'admin';
      const categories = await db.getDisciplineCategories({ activeOnly });
      res.json({ success: true, categories });
    } catch (err) {
      console.error('GET /api/discipline/categories error:', err);
      res.status(500).json({ error: 'Gagal memuat master pelanggaran.' });
    }
  });

  // 4. POST /api/discipline/categories — Create Master Pelanggaran
  app.post('/api/discipline/categories', requireDisciplineAdmin, async (req, res) => {
    try {
      const saved = await db.upsertDisciplineCategory(req.body, req.user);
      res.status(201).json({ success: true, category: saved });
    } catch (err) {
      console.error('POST /api/discipline/categories error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal menyimpan kategori pelanggaran.' });
    }
  });

  // 5. PUT /api/discipline/categories/:id — Update Master Pelanggaran
  app.put('/api/discipline/categories/:id', requireDisciplineAdmin, async (req, res) => {
    try {
      const saved = await db.upsertDisciplineCategory({ ...req.body, id: req.params.id }, req.user);
      res.json({ success: true, category: saved });
    } catch (err) {
      console.error('PUT /api/discipline/categories/:id error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal memperbarui kategori pelanggaran.' });
    }
  });

  // 6. PATCH /api/discipline/categories/:id/toggle — Activate / Deactivate Master Pelanggaran
  app.patch('/api/discipline/categories/:id/toggle', requireDisciplineAdmin, async (req, res) => {
    try {
      const saved = await db.toggleDisciplineCategoryStatus(req.params.id, req.body.is_active, req.user);
      res.json({ success: true, category: saved });
    } catch (err) {
      console.error('PATCH /api/discipline/categories/:id/toggle error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal mengubah status kategori pelanggaran.' });
    }
  });

  // 7. GET /api/discipline/incidents — Paginated & Filtered Incidents (Admin only)
  app.get('/api/discipline/incidents', requireDisciplineAdmin, async (req, res) => {
    try {
      const result = await db.getDisciplineIncidents({
        search: req.query.search,
        user_id: req.query.user_id,
        date_from: req.query.date_from,
        date_to: req.query.date_to,
        posisi: req.query.posisi,
        kategori: req.query.kategori,
        status_poin: req.query.status_poin,
        status_kasus: req.query.status_kasus,
        page: req.query.page,
        limit: req.query.limit
      }, req.user);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('GET /api/discipline/incidents error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal memuat riwayat kejadian.' });
    }
  });

  // 8. POST /api/discipline/incidents — Create New Incident (with optional multipart evidence)
  app.post('/api/discipline/incidents', requireDisciplineAdmin, (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      uploadEvidence.array('evidence_files', 5)(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: err.message || 'Gagal memproses file bukti.' });
        }
        next();
      });
    } else {
      next();
    }
  }, async (req, res) => {
    try {
      const payload = {
        ...req.body,
        show_evidence_to_user: req.body.show_evidence_to_user === 'false' ? false : (req.body.show_evidence_to_user === false ? false : true),
        requires_hr_review: req.body.requires_hr_review === 'true' || req.body.requires_hr_review === true
      };

      const incident = await db.createDisciplineIncident(payload, req.user);

      let uploadedAttachments = [];
      if (req.files && req.files.length > 0) {
        uploadedAttachments = await uploadFilesToPrivateStorage(
          req.files,
          incident.id,
          null,
          'INCIDENT',
          req.user
        );
      }

      res.status(201).json({
        success: true,
        incident: {
          ...incident,
          attachments: uploadedAttachments
        }
      });
    } catch (err) {
      console.error('POST /api/discipline/incidents error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal menyimpan catatan kejadian.' });
    }
  });

  // 9. GET /api/discipline/incidents/:id — Get Incident Detail (Admin or Owner User)
  app.get('/api/discipline/incidents/:id', requireAuth, async (req, res) => {
    try {
      if (req.user.role === 'admin' && !isAuthorizedDisciplineAdmin(req.user)) {
        return res.status(403).json({ error: 'Akses ditolak. Anda tidak memiliki izin untuk modul Poin & Disiplin.' });
      }
      const detail = await db.getDisciplineIncidentDetail(req.params.id, req.user);
      detail.attachments = await hydrateSignedUrls(detail.attachments);
      res.json({ success: true, incident: detail });
    } catch (err) {
      console.error('GET /api/discipline/incidents/:id error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal memuat detail kejadian.' });
    }
  });

  // 10. PUT /api/discipline/incidents/:id — Edit Incident Metadata (Admin only)
  app.put('/api/discipline/incidents/:id', requireDisciplineAdmin, (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      uploadEvidence.array('evidence_files', 5)(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
      });
    } else {
      next();
    }
  }, async (req, res) => {
    try {
      const payload = { ...req.body };
      if (payload.show_evidence_to_user === 'true') payload.show_evidence_to_user = true;
      if (payload.show_evidence_to_user === 'false') payload.show_evidence_to_user = false;

      const updated = await db.updateDisciplineIncident(req.params.id, payload, req.user);
      if (req.files && req.files.length > 0) {
        await uploadFilesToPrivateStorage(req.files, req.params.id, null, 'INCIDENT', req.user);
      }
      const detail = await db.getDisciplineIncidentDetail(req.params.id, req.user);
      detail.attachments = await hydrateSignedUrls(detail.attachments);

      res.json({ success: true, incident: detail });
    } catch (err) {
      console.error('PUT /api/discipline/incidents/:id error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal memperbarui kejadian.' });
    }
  });

  // 11. DELETE /api/discipline/incidents/:id — Strictly Forbidden (Audit Trail Policy)
  app.delete('/api/discipline/incidents/:id', requireAuth, (req, res) => {
    return res.status(405).json({
      error: 'Penghapusan histori kejadian dilarang oleh kebijakan audit. Gunakan mekanisme Adjustment / Pembatalan Poin.'
    });
  });

  // 12. POST /api/discipline/incidents/:id/adjustments — Point Adjustment / Cancellation (Admin only)
  app.post('/api/discipline/incidents/:id/adjustments', requireDisciplineAdmin, async (req, res) => {
    try {
      const result = await db.adjustDisciplineIncidentPoints(req.params.id, req.body, req.user);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('POST /api/discipline/incidents/:id/adjustments error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal memproses adjustment poin.' });
    }
  });

  // 13. GET /api/discipline/appeals — List Appeals (Admin only)
  app.get('/api/discipline/appeals', requireDisciplineAdmin, async (req, res) => {
    try {
      const appeals = await db.getDisciplineAppeals({
        status: req.query.status,
        search: req.query.search
      }, req.user);
      const hydrated = await Promise.all(
        appeals.map(async (ap) => ({
          ...ap,
          attachments: await hydrateSignedUrls(ap.attachments)
        }))
      );
      res.json({ success: true, appeals: hydrated });
    } catch (err) {
      console.error('GET /api/discipline/appeals error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal memuat daftar klarifikasi.' });
    }
  });

  // 14. POST /api/discipline/appeals/:id/review — Approve or Reject Appeal (Admin only)
  app.post('/api/discipline/appeals/:id/review', requireDisciplineAdmin, async (req, res) => {
    try {
      const result = await db.reviewDisciplineAppeal(req.params.id, req.body, req.user);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('POST /api/discipline/appeals/:id/review error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal memproses review klarifikasi.' });
    }
  });

  // 15. GET & PUT /api/discipline/settings — Module Settings (Admin only)
  app.get('/api/discipline/settings', requireDisciplineAdmin, async (req, res) => {
    try {
      const settings = await db.getDisciplineSettings();
      res.json({ success: true, settings });
    } catch (err) {
      console.error('GET /api/discipline/settings error:', err);
      res.status(500).json({ error: 'Gagal memuat pengaturan disiplin.' });
    }
  });

  app.put('/api/discipline/settings', requireDisciplineAdmin, async (req, res) => {
    try {
      const settings = await db.saveDisciplineSettings(req.body, req.user);
      res.json({ success: true, settings });
    } catch (err) {
      console.error('PUT /api/discipline/settings error:', err);
      res.status(500).json({ error: 'Gagal menyimpan pengaturan disiplin.' });
    }
  });

  // 16. GET /api/discipline/export — Export Excel following active filters (Admin only)
  app.get('/api/discipline/export', requireDisciplineAdmin, async (req, res) => {
    try {
      const result = await db.getDisciplineIncidents({
        search: req.query.search,
        user_id: req.query.user_id,
        date_from: req.query.date_from,
        date_to: req.query.date_to,
        posisi: req.query.posisi,
        kategori: req.query.kategori,
        status_poin: req.query.status_poin,
        status_kasus: req.query.status_kasus,
        page: 1,
        limit: 5000
      }, req.user);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'SS08 Admin';
      workbook.created = new Date();

      const ws = workbook.addWorksheet('Riwayat Poin & Disiplin');
      ws.columns = [
        { header: 'ID Kejadian', key: 'incident_code', width: 20 },
        { header: 'Nama Karyawan', key: 'nama', width: 26 },
        { header: 'ID User', key: 'user_id', width: 38 },
        { header: 'NIK', key: 'nik', width: 16 },
        { header: 'Posisi', key: 'posisi', width: 15 },
        { header: 'Tanggal Kejadian', key: 'incident_date', width: 16 },
        { header: 'Kategori', key: 'kategori_nama', width: 18 },
        { header: 'Pelanggaran', key: 'subkategori', width: 28 },
        { header: 'Kronologi', key: 'kronologi', width: 45 },
        { header: 'Poin Awal', key: 'default_poin', width: 12 },
        { header: 'Poin Saat Ini', key: 'poin', width: 14 },
        { header: 'Status Poin', key: 'status_poin', width: 15 },
        { header: 'Status Kasus', key: 'status_kasus', width: 18 },
        { header: 'Expired Date', key: 'expired_at', width: 16 },
        { header: 'Catatan Pembinaan', key: 'catatan_pembinaan', width: 35 },
        { header: 'Dicatat Oleh', key: 'created_by_name', width: 20 },
        { header: 'Tanggal Pencatatan', key: 'created_at', width: 20 }
      ];

      // Style Header
      const headerRow = ws.getRow(1);
      headerRow.height = 24;
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A8A' }
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

      const statusLabels = {
        ACTIVE: 'AKTIF',
        EXPIRED: 'EXPIRED',
        CANCELLED: 'DIBATALKAN'
      };

      result.items.forEach((inc) => {
        const createdDateStr = inc.created_at
          ? new Date(inc.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
          : '-';
        ws.addRow({
          incident_code: inc.incident_code,
          nama: inc.user_name_snapshot,
          user_id: inc.user_id,
          nik: inc.nik_snapshot || '-',
          posisi: inc.posisi,
          incident_date: inc.incident_date,
          kategori_nama: inc.kategori_nama,
          subkategori: inc.subkategori,
          kronologi: inc.kronologi,
          default_poin: inc.default_poin,
          poin: inc.poin,
          status_poin: statusLabels[inc.status_poin] || inc.status_poin,
          status_kasus: inc.status_kasus,
          expired_at: inc.expired_at,
          catatan_pembinaan: inc.catatan_pembinaan || '-',
          created_by_name: inc.created_by_name || 'Admin',
          created_at: createdDateStr
        });
      });

      await db.insertAuditLog(
        req.user.username,
        'DISCIPLINE_EXPORT_EXCEL',
        `Mengekspor ${result.items.length} data Poin & Disiplin ke Excel`
      );

      const jakartaDateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
      const fileName = `Rekap_Poin_Disiplin_SS08_${jakartaDateStr}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error('GET /api/discipline/export error:', err);
      res.status(500).json({ error: 'Gagal mengekspor data Poin & Disiplin ke Excel.' });
    }
  });

  // ===================== USER ("KINERJA SAYA") ROUTES =====================

  // 17. GET /api/discipline/my/summary — User's own performance notes & timeline
  app.get('/api/discipline/my/summary', requireAuth, async (req, res) => {
    try {
      // Block any attempt to manipulate URL/query to read another user's data
      if (req.query.user_id && req.query.user_id !== req.user.userId) {
        return res.status(403).json({
          error: 'Akses ditolak. Anda tidak diizinkan melihat riwayat kinerja user lain.'
        });
      }

      const data = await db.getUserDisciplineSummary(req.user.userId);
      res.json({
        success: true,
        ...data
      });
    } catch (err) {
      console.error('GET /api/discipline/my/summary error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal memuat data Kinerja Saya.' });
    }
  });

  // 18. GET /api/discipline/my/incidents/:id — User's own incident detail
  app.get('/api/discipline/my/incidents/:id', requireAuth, async (req, res) => {
    try {
      // Force non-admin role check so even if URL is manipulated, ownership user_id === req.user.userId is strictly enforced
      const detail = await db.getDisciplineIncidentDetail(req.params.id, {
        ...req.user,
        role: 'operasional'
      });
      detail.attachments = await hydrateSignedUrls(detail.attachments);
      res.json({ success: true, incident: detail });
    } catch (err) {
      console.error('GET /api/discipline/my/incidents/:id error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal memuat detail catatan kinerja.' });
    }
  });

  // 19. POST /api/discipline/my/incidents/:id/appeals — Submit User Appeal (Klarifikasi)
  app.post('/api/discipline/my/incidents/:id/appeals', requireAuth, (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      uploadEvidence.array('evidence_files', 3)(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
      });
    } else {
      next();
    }
  }, async (req, res) => {
    try {
      const appeal = await db.createDisciplineAppeal(
        req.params.id,
        {
          alasan: req.body.alasan,
          kronologi_user: req.body.kronologi_user
        },
        req.user
      );

      let uploadedAttachments = [];
      if (req.files && req.files.length > 0) {
        uploadedAttachments = await uploadFilesToPrivateStorage(
          req.files,
          req.params.id,
          appeal.id,
          'APPEAL',
          req.user
        );
      }

      if (typeof storeNotification === 'function') {
        storeNotification('new_discipline_appeal', {
          appeal_id: appeal.id,
          incident_id: req.params.id,
          nama: req.user.nama_lengkap || req.user.username,
          posisi: req.user.posisi || 'Operasional'
        });
      }

      res.status(201).json({
        success: true,
        appeal: {
          ...appeal,
          attachments: uploadedAttachments
        }
      });
    } catch (err) {
      console.error('POST /api/discipline/my/incidents/:id/appeals error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal mengirim pengajuan klarifikasi.' });
    }
  });

  // 20. POST /api/discipline/my/notifications/read — Mark user discipline notifications read
  app.post('/api/discipline/my/notifications/read', requireAuth, async (req, res) => {
    try {
      await db.markUserDisciplineNotificationsRead(req.user.userId);
      res.json({ success: true });
    } catch (err) {
      console.error('POST /api/discipline/my/notifications/read error:', err);
      res.status(500).json({ error: 'Gagal memperbarui status notifikasi.' });
    }
  });

  // 21. GET /api/discipline/attachments/:id/url — Get Signed URL for Private Attachment with Ownership Check
  app.get('/api/discipline/attachments/:id/url', requireAuth, async (req, res) => {
    try {
      if (req.user.role === 'admin' && !isAuthorizedDisciplineAdmin(req.user)) {
        return res.status(403).json({ error: 'Akses ditolak. Anda tidak memiliki izin untuk membuka lampiran bukti modul Poin & Disiplin.' });
      }
      const att = await db.getDisciplineAttachmentById(req.params.id);
      if (!att) {
        return res.status(404).json({ error: 'Lampiran bukti tidak ditemukan.' });
      }

      // Verify ownership / permission via getDisciplineIncidentDetail
      const inc = await db.getDisciplineIncidentDetail(att.incident_id, req.user);
      if (req.user.role !== 'admin' && att.source_type === 'INCIDENT' && !inc.show_evidence_to_user) {
        return res.status(403).json({ error: 'Bukti lampiran ini tidak diizinkan untuk ditampilkan.' });
      }

      const [hydrated] = await hydrateSignedUrls([att]);
      if (!hydrated || !hydrated.signed_url) {
        return res.status(404).json({ error: 'File bukti tidak tersedia di penyimpanan.' });
      }

      res.json({
        success: true,
        signed_url: hydrated.signed_url,
        original_filename: hydrated.original_filename,
        mime_type: hydrated.mime_type
      });
    } catch (err) {
      console.error('GET /api/discipline/attachments/:id/url error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Gagal membuka lampiran bukti.' });
    }
  });
};
