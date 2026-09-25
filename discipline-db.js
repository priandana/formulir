'use strict';

const { v4: uuidv4 } = require('uuid');

const DEFAULT_DISCIPLINE_SETTINGS = {
  default_expiry_months: 3,
  allow_admin_override_points: true,
  repeat_incident_days: 30,
  repeat_incident_threshold: 2,
  enable_hr_review_threshold: false,
  hr_review_point_threshold: 6,
  show_evidence_to_user_default: true,
  enable_user_appeals: true,
  enable_notifications: true
};

function getEffectiveHrThreshold(settings) {
  if (!settings || settings.enable_hr_review_threshold === false) return null;
  const raw = settings.hr_review_point_threshold;
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const num = parseInt(raw, 10);
  return (!isNaN(num) && num > 0) ? num : null;
}

const DEFAULT_DISCIPLINE_CATEGORIES = [
  {
    id: 'cat-default-kehadiran-01',
    nama_kategori: 'Kehadiran',
    nama_pelanggaran: 'Terlambat briefing',
    deskripsi: 'Datang terlambat saat jadwal briefing operasional dimulai.',
    default_poin: 1,
    severity: 'LOW',
    requires_hr_review: false,
    masa_berlaku_bulan: 3,
    is_active: true,
    created_by_name: 'System'
  },
  {
    id: 'cat-default-prosedur-01',
    nama_kategori: 'Prosedur',
    nama_pelanggaran: 'Tidak mengikuti SOP',
    deskripsi: 'Melakukan pekerjaan tidak sesuai Standar Operasional Prosedur yang berlaku.',
    default_poin: 3,
    severity: 'MEDIUM',
    requires_hr_review: false,
    masa_berlaku_bulan: 3,
    is_active: true,
    created_by_name: 'System'
  },
  {
    id: 'cat-default-picking-01',
    nama_kategori: 'Picking',
    nama_pelanggaran: 'Salah SKU / Salah Qty',
    deskripsi: 'Kesalahan pengambilan item SKU atau jumlah kuantitas barang saat picking.',
    default_poin: 3,
    severity: 'MEDIUM',
    requires_hr_review: false,
    masa_berlaku_bulan: 3,
    is_active: true,
    created_by_name: 'System'
  },
  {
    id: 'cat-default-inventory-01',
    nama_kategori: 'Inventory',
    nama_pelanggaran: 'Salah movement / tidak update transaksi',
    deskripsi: 'Kesalahan perpindahan barang atau kelalaian memperbarui pencatatan transaksi.',
    default_poin: 3,
    severity: 'MEDIUM',
    requires_hr_review: false,
    masa_berlaku_bulan: 3,
    is_active: true,
    created_by_name: 'System'
  },
  {
    id: 'cat-default-safety-01',
    nama_kategori: 'Safety',
    nama_pelanggaran: 'Tidak menggunakan APD',
    deskripsi: 'Tidak mengenakan Alat Pelindung Diri standar di area kerja.',
    default_poin: 3,
    severity: 'MEDIUM',
    requires_hr_review: false,
    masa_berlaku_bulan: 3,
    is_active: true,
    created_by_name: 'System'
  },
  {
    id: 'cat-default-k3-01',
    nama_kategori: 'K3',
    nama_pelanggaran: 'Pelanggaran K3 berisiko tinggi',
    deskripsi: 'Tindakan tidak aman yang menimbulkan risiko tinggi terhadap keselamatan kerja.',
    default_poin: 5,
    severity: 'HIGH',
    requires_hr_review: false,
    masa_berlaku_bulan: 6,
    is_active: true,
    created_by_name: 'System'
  },
  {
    id: 'cat-default-disiplin-01',
    nama_kategori: 'Disiplin',
    nama_pelanggaran: 'Meninggalkan area tanpa izin',
    deskripsi: 'Meninggalkan zona atau area tanggung jawab kerja tanpa izin atasan/leader.',
    default_poin: 2,
    severity: 'LOW',
    requires_hr_review: false,
    masa_berlaku_bulan: 3,
    is_active: true,
    created_by_name: 'System'
  },
  {
    id: 'cat-default-integritas-01',
    nama_kategori: 'Integritas & Berat',
    nama_pelanggaran: 'Manipulasi data / Fraud / Pelanggaran Integritas',
    deskripsi: 'Tindakan manipulasi data pencapaian, ketidakjujuran, atau pelanggaran integritas berat. Keputusan tindak lanjut ditentukan oleh Atasan / HR.',
    default_poin: 10,
    severity: 'CRITICAL',
    requires_hr_review: true,
    masa_berlaku_bulan: 6,
    is_active: true,
    created_by_name: 'System'
  },
  {
    id: 'cat-default-k3berat-01',
    nama_kategori: 'K3 Berat',
    nama_pelanggaran: 'Kecelakaan akibat pelanggaran berat',
    deskripsi: 'Insiden kecelakaan kerja yang disebabkan oleh kelalaian atau pelanggaran prosedur berat. Memerlukan review Atasan / HR.',
    default_poin: 10,
    severity: 'CRITICAL',
    requires_hr_review: true,
    masa_berlaku_bulan: 6,
    is_active: true,
    created_by_name: 'System'
  }
];

function getJakartaDateStr(dateObj = new Date()) {
  return dateObj.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
}

function computeExpiryDate(incidentDateStr, months) {
  const m = parseInt(months, 10) || 3;
  const parts = String(incidentDateStr).slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || isNaN(parts[0])) {
    const d = new Date();
    d.setMonth(d.getMonth() + m);
    return d.toISOString().slice(0, 10);
  }
  const [year, month, day] = parts;
  const target = new Date(Date.UTC(year, (month - 1) + m, day));
  return target.toISOString().slice(0, 10);
}

function evaluateIncidentPointStatus(inc, todayStr = getJakartaDateStr()) {
  if (!inc) return inc;
  if (inc.status_poin === 'CANCELLED') {
    return { ...inc, status_poin: 'CANCELLED', effective_active_points: 0 };
  }
  const exp = inc.expired_at || computeExpiryDate(inc.incident_date, inc.masa_berlaku_bulan || 3);
  if (exp < todayStr) {
    return { ...inc, expired_at: exp, status_poin: 'EXPIRED', effective_active_points: 0 };
  }
  return { ...inc, expired_at: exp, status_poin: 'ACTIVE', effective_active_points: Number(inc.poin) || 0 };
}

module.exports = function createDisciplineDb(dbContext) {
  const { supabase, isSupabaseEnabled, insertAuditLog, getUserById } = dbContext;

  const CLOUD_STORE_KEY = 'discipline_cloud_store_v1';
  let useNativeTables = null; // null = unknown, true = native SQL tables exist, false = fallback to site_settings cloud store

  async function checkNativeTables() {
    if (!isSupabaseEnabled) return false;
    if (useNativeTables === true) return true;
    try {
      const { error } = await supabase.from('discipline_incidents').select('id').limit(1);
      if (!error) {
        useNativeTables = true;
        return true;
      }
      if (error.code === 'PGRST205' || (error.message && error.message.includes('schema cache'))) {
        useNativeTables = false;
        return false;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async function loadCloudStore() {
    const now = new Date().toISOString();
    const initialStore = {
      categories: DEFAULT_DISCIPLINE_CATEGORIES.map(c => ({ ...c, created_at: now, updated_at: now })),
      incidents: [],
      adjustments: [],
      appeals: [],
      attachments: [],
      settings: { ...DEFAULT_DISCIPLINE_SETTINGS }
    };
    if (!isSupabaseEnabled) return initialStore;
    const { data, error } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', CLOUD_STORE_KEY)
      .maybeSingle();
    if (error || !data || !data.value) {
      await saveCloudStore(initialStore);
      return initialStore;
    }
    const val = data.value;
    if (!Array.isArray(val.categories) || val.categories.length === 0) {
      val.categories = initialStore.categories;
    }
    if (!Array.isArray(val.incidents)) val.incidents = [];
    if (!Array.isArray(val.adjustments)) val.adjustments = [];
    if (!Array.isArray(val.appeals)) val.appeals = [];
    if (!Array.isArray(val.attachments)) val.attachments = [];
    if (!val.settings) val.settings = { ...DEFAULT_DISCIPLINE_SETTINGS };
    return val;
  }

  async function saveCloudStore(storeData) {
    if (!isSupabaseEnabled) return storeData;
    const { error } = await supabase
      .from('site_settings')
      .upsert({ key: CLOUD_STORE_KEY, value: storeData }, { onConflict: 'key' });
    if (error) {
      console.error('Supabase saveCloudStore error:', error);
      throw error;
    }
    return storeData;
  }

  async function logDisciplineAudit(actorName, action, targetId, beforeData, afterData, summaryText = '') {
    try {
      const payload = {
        module: 'POIN_DISIPLIN',
        actor: actorName || 'system',
        action,
        target_id: targetId,
        summary: summaryText,
        before: beforeData || null,
        after: afterData || null,
        timestamp: new Date().toISOString()
      };
      if (typeof insertAuditLog === 'function') {
        await insertAuditLog(actorName || 'system', action, JSON.stringify(payload));
      }
    } catch (e) {
      console.error('logDisciplineAudit error:', e.message);
    }
  }

  // ===================== 1. SETTINGS =====================
  async function getDisciplineSettings() {
    if (await checkNativeTables()) {
      const { data, error } = await supabase
        .from('discipline_settings')
        .select('value')
        .eq('key', 'general')
        .maybeSingle();
      if (!error && data && data.value) {
        return { ...DEFAULT_DISCIPLINE_SETTINGS, ...data.value };
      }
    }
    const store = await loadCloudStore();
    return { ...DEFAULT_DISCIPLINE_SETTINGS, ...(store.settings || {}) };
  }

  async function saveDisciplineSettings(newSettings, actor = {}) {
    const before = await getDisciplineSettings();

    const hasExplicitThresholdKey = Object.prototype.hasOwnProperty.call(newSettings, 'hr_review_point_threshold');
    const rawHrVal = hasExplicitThresholdKey ? newSettings.hr_review_point_threshold : before.hr_review_point_threshold;
    const parsedHrNum = (rawHrVal !== null && rawHrVal !== undefined && String(rawHrVal).trim() !== '')
      ? parseInt(rawHrVal, 10)
      : NaN;
    const isPositiveNumber = !isNaN(parsedHrNum) && parsedHrNum > 0;

    let enableHrThreshold;
    if (Object.prototype.hasOwnProperty.call(newSettings, 'enable_hr_review_threshold')) {
      enableHrThreshold = Boolean(newSettings.enable_hr_review_threshold) && isPositiveNumber;
    } else if (hasExplicitThresholdKey) {
      enableHrThreshold = isPositiveNumber;
    } else {
      enableHrThreshold = before.enable_hr_review_threshold !== false && isPositiveNumber;
    }

    const merged = {
      ...DEFAULT_DISCIPLINE_SETTINGS,
      ...before,
      ...newSettings,
      default_expiry_months: Math.max(1, parseInt(newSettings.default_expiry_months ?? before.default_expiry_months, 10) || 3),
      repeat_incident_days: Math.max(1, parseInt(newSettings.repeat_incident_days ?? before.repeat_incident_days, 10) || 30),
      repeat_incident_threshold: Math.max(2, parseInt(newSettings.repeat_incident_threshold ?? before.repeat_incident_threshold, 10) || 2),
      enable_hr_review_threshold: enableHrThreshold,
      hr_review_point_threshold: enableHrThreshold ? parsedHrNum : null,
      allow_admin_override_points: Boolean(newSettings.allow_admin_override_points ?? before.allow_admin_override_points),
      show_evidence_to_user_default: Boolean(newSettings.show_evidence_to_user_default ?? before.show_evidence_to_user_default),
      enable_user_appeals: Boolean(newSettings.enable_user_appeals ?? before.enable_user_appeals),
      enable_notifications: Boolean(newSettings.enable_notifications ?? before.enable_notifications)
    };

    if (await checkNativeTables()) {
      const { error } = await supabase
        .from('discipline_settings')
        .upsert({
          key: 'general',
          value: merged,
          updated_by: actor.userId || null,
          updated_by_name: actor.nama_lengkap || actor.username || 'Admin',
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
      if (error) throw error;
    } else {
      const store = await loadCloudStore();
      store.settings = merged;
      await saveCloudStore(store);
    }

    await logDisciplineAudit(
      actor.username || 'admin',
      'DISCIPLINE_UPDATE_SETTINGS',
      'general',
      before,
      merged,
      'Mengubah pengaturan modul Poin & Disiplin'
    );
    return merged;
  }

  // ===================== 2. CATEGORIES (MASTER PELANGGARAN) =====================
  async function getDisciplineCategories({ activeOnly = false } = {}) {
    if (await checkNativeTables()) {
      let q = supabase
        .from('discipline_categories')
        .select('*')
        .order('nama_kategori', { ascending: true })
        .order('nama_pelanggaran', { ascending: true });
      if (activeOnly) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      if (data && data.length > 0) return data;
    }
    const store = await loadCloudStore();
    let cats = store.categories || [];
    if (activeOnly) cats = cats.filter(c => c.is_active !== false);
    return cats.sort((a, b) =>
      (a.nama_kategori || '').localeCompare(b.nama_kategori || '') ||
      (a.nama_pelanggaran || '').localeCompare(b.nama_pelanggaran || '')
    );
  }

  async function upsertDisciplineCategory(catData, actor = {}) {
    const now = new Date().toISOString();
    const nama_kategori = String(catData.nama_kategori || '').trim();
    const nama_pelanggaran = String(catData.nama_pelanggaran || '').trim();
    if (!nama_kategori || !nama_pelanggaran) {
      const err = new Error('Nama kategori dan nama pelanggaran wajib diisi.');
      err.statusCode = 400;
      throw err;
    }
    const severity = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(catData.severity) ? catData.severity : 'LOW';
    const requires_hr_review = catData.requires_hr_review !== undefined
      ? Boolean(catData.requires_hr_review)
      : (severity === 'CRITICAL');
    const parsedPoin = parseInt(catData.default_poin, 10);
    const default_poin = (!isNaN(parsedPoin) && parsedPoin >= 0) ? parsedPoin : 1;
    const masa_berlaku_bulan = Math.max(1, Math.min(60, parseInt(catData.masa_berlaku_bulan, 10) || 3));
    const is_active = catData.is_active === undefined ? true : Boolean(catData.is_active);
    const deskripsi = String(catData.deskripsi || '').trim();

    if (await checkNativeTables()) {
      let before = null;
      if (catData.id) {
        const { data: existing } = await supabase.from('discipline_categories').select('*').eq('id', catData.id).maybeSingle();
        before = existing;
      }
      const record = {
        ...(catData.id ? { id: catData.id } : {}),
        nama_kategori,
        nama_pelanggaran,
        deskripsi,
        default_poin,
        severity,
        requires_hr_review,
        masa_berlaku_bulan,
        is_active,
        created_by: actor.userId || null,
        created_by_name: actor.nama_lengkap || actor.username || 'Admin',
        updated_at: now
      };
      const { data, error } = await supabase
        .from('discipline_categories')
        .upsert(record)
        .select()
        .single();
      if (error) throw error;
      await logDisciplineAudit(
        actor.username || 'admin',
        catData.id ? 'DISCIPLINE_UPDATE_CATEGORY' : 'DISCIPLINE_CREATE_CATEGORY',
        data.id,
        before,
        data,
        `${catData.id ? 'Mengubah' : 'Menambah'} master pelanggaran: ${nama_kategori} - ${nama_pelanggaran}`
      );
      return data;
    } else {
      const store = await loadCloudStore();
      let before = null;
      let saved = null;
      if (catData.id) {
        const idx = store.categories.findIndex(c => c.id === catData.id);
        if (idx === -1) {
          const err = new Error('Kategori pelanggaran tidak ditemukan.');
          err.statusCode = 404;
          throw err;
        }
        before = { ...store.categories[idx] };
        saved = {
          ...store.categories[idx],
          nama_kategori,
          nama_pelanggaran,
          deskripsi,
          default_poin,
          severity,
          requires_hr_review,
          masa_berlaku_bulan,
          is_active,
          updated_at: now
        };
        store.categories[idx] = saved;
      } else {
        const dup = store.categories.find(
          c => c.nama_kategori.toLowerCase() === nama_kategori.toLowerCase() &&
               c.nama_pelanggaran.toLowerCase() === nama_pelanggaran.toLowerCase()
        );
        if (dup) {
          const err = new Error('Pelanggaran dengan nama tersebut sudah ada dalam kategori ini.');
          err.statusCode = 409;
          throw err;
        }
        saved = {
          id: uuidv4(),
          nama_kategori,
          nama_pelanggaran,
          deskripsi,
          default_poin,
          severity,
          requires_hr_review,
          masa_berlaku_bulan,
          is_active,
          created_by: actor.userId || null,
          created_by_name: actor.nama_lengkap || actor.username || 'Admin',
          created_at: now,
          updated_at: now
        };
        store.categories.push(saved);
      }
      await saveCloudStore(store);
      await logDisciplineAudit(
        actor.username || 'admin',
        before ? 'DISCIPLINE_UPDATE_CATEGORY' : 'DISCIPLINE_CREATE_CATEGORY',
        saved.id,
        before,
        saved,
        `${before ? 'Mengubah' : 'Menambah'} master pelanggaran: ${nama_kategori} - ${nama_pelanggaran}`
      );
      return saved;
    }
  }

  async function toggleDisciplineCategoryStatus(id, is_active, actor = {}) {
    if (await checkNativeTables()) {
      const { data: before } = await supabase.from('discipline_categories').select('*').eq('id', id).maybeSingle();
      if (!before) {
        const err = new Error('Master pelanggaran tidak ditemukan.');
        err.statusCode = 404;
        throw err;
      }
      const { data, error } = await supabase
        .from('discipline_categories')
        .update({ is_active: Boolean(is_active), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      await logDisciplineAudit(
        actor.username || 'admin',
        'DISCIPLINE_TOGGLE_CATEGORY',
        id,
        before,
        data,
        `Mengubah status aktif master pelanggaran ${before.nama_pelanggaran} menjadi ${is_active ? 'AKTIF' : 'NONAKTIF'}`
      );
      return data;
    } else {
      const store = await loadCloudStore();
      const idx = store.categories.findIndex(c => c.id === id);
      if (idx === -1) {
        const err = new Error('Master pelanggaran tidak ditemukan.');
        err.statusCode = 404;
        throw err;
      }
      const before = { ...store.categories[idx] };
      store.categories[idx].is_active = Boolean(is_active);
      store.categories[idx].updated_at = new Date().toISOString();
      const after = store.categories[idx];
      await saveCloudStore(store);
      await logDisciplineAudit(
        actor.username || 'admin',
        'DISCIPLINE_TOGGLE_CATEGORY',
        id,
        before,
        after,
        `Mengubah status aktif master pelanggaran ${before.nama_pelanggaran} menjadi ${is_active ? 'AKTIF' : 'NONAKTIF'}`
      );
      return after;
    }
  }

  // ===================== 3. INCIDENTS (KEJADIAN & POIN) =====================
  async function generateIncidentCode(incidentDateStr) {
    const ym = String(incidentDateStr || getJakartaDateStr()).slice(0, 7).replace('-', '');
    const prefix = `INC-${ym}-`;
    let count = 0;
    if (await checkNativeTables()) {
      const { count: c } = await supabase
        .from('discipline_incidents')
        .select('id', { count: 'exact', head: true })
        .ilike('incident_code', `${prefix}%`);
      count = c || 0;
    } else {
      const store = await loadCloudStore();
      count = (store.incidents || []).filter(i => String(i.incident_code || '').startsWith(prefix)).length;
    }
    const seq = String(count + 1).padStart(4, '0');
    const rand = Math.floor(100 + Math.random() * 900);
    return `${prefix}${seq}-${rand}`;
  }

  async function createDisciplineIncident(payload, actor = {}) {
    const settings = await getDisciplineSettings();
    const targetUser = await getUserById(payload.user_id);
    if (!targetUser) {
      const err = new Error('User karyawan tidak ditemukan.');
      err.statusCode = 404;
      throw err;
    }

    const categories = await getDisciplineCategories();
    const matchedCat = categories.find(c => c.id === payload.category_id) ||
      categories.find(c =>
        c.nama_kategori.toLowerCase() === String(payload.kategori_nama || '').toLowerCase() &&
        c.nama_pelanggaran.toLowerCase() === String(payload.subkategori || '').toLowerCase()
      );

    const kategori_nama = String(payload.kategori_nama || matchedCat?.nama_kategori || '').trim();
    const subkategori = String(payload.subkategori || matchedCat?.nama_pelanggaran || '').trim();
    const kronologi = String(payload.kronologi || '').trim();
    const incident_date = String(payload.incident_date || getJakartaDateStr()).slice(0, 10);

    if (!kategori_nama || !subkategori || !kronologi || !incident_date) {
      const err = new Error('Tanggal kejadian, kategori, jenis pelanggaran, dan kronologi wajib diisi.');
      err.statusCode = 400;
      throw err;
    }

    const default_poin = matchedCat ? Number(matchedCat.default_poin) : Math.max(0, parseInt(payload.default_poin, 10) || 1);
    let poin = default_poin;
    let is_overridden = false;

    if (payload.poin !== undefined && payload.poin !== null && payload.poin !== '') {
      const requestedPoin = Math.max(0, parseInt(payload.poin, 10));
      if (!isNaN(requestedPoin) && requestedPoin !== default_poin) {
        const isSuperAdmin = actor.username && actor.username.toLowerCase() === 'admin';
        if (!settings.allow_admin_override_points && !isSuperAdmin) {
          const err = new Error('Anda tidak memiliki izin untuk melakukan override poin default.');
          err.statusCode = 403;
          throw err;
        }
        poin = requestedPoin;
        is_overridden = true;
      }
    }

    const severity = payload.severity || matchedCat?.severity || 'LOW';
    const requires_hr_review = severity === 'CRITICAL' || Boolean(matchedCat?.requires_hr_review) || Boolean(payload.requires_hr_review);
    const masa_berlaku_bulan = Math.max(1, parseInt(payload.masa_berlaku_bulan || matchedCat?.masa_berlaku_bulan || settings.default_expiry_months || 3, 10));
    const expired_at = computeExpiryDate(incident_date, masa_berlaku_bulan);
    const todayStr = getJakartaDateStr();
    const status_poin = expired_at < todayStr ? 'EXPIRED' : 'ACTIVE';
    const status_kasus = requires_hr_review
      ? 'NEED_HR_REVIEW'
      : (['OPEN', 'IN_REVIEW', 'RESOLVED', 'NEED_HR_REVIEW'].includes(payload.status_kasus) ? payload.status_kasus : 'OPEN');

    const now = new Date().toISOString();
    const incident_code = await generateIncidentCode(incident_date);

    const record = {
      id: uuidv4(),
      incident_code,
      incident_date,
      user_id: targetUser.id,
      user_name_snapshot: targetUser.nama_lengkap || targetUser.username,
      nik_snapshot: targetUser.nik || '-',
      posisi: targetUser.posisi || payload.posisi || 'Operasional',
      category_id: matchedCat && /^[0-9a-fA-F-]{36}$/.test(matchedCat.id) ? matchedCat.id : null,
      kategori_nama,
      subkategori,
      kronologi,
      default_poin,
      poin,
      is_overridden,
      severity,
      requires_hr_review,
      status_kasus,
      catatan_pembinaan: String(payload.catatan_pembinaan || '').trim(),
      catatan_internal: String(payload.catatan_internal || '').trim(),
      masa_berlaku_bulan,
      expired_at,
      status_poin,
      show_evidence_to_user: payload.show_evidence_to_user === undefined
        ? Boolean(settings.show_evidence_to_user_default)
        : Boolean(payload.show_evidence_to_user),
      user_notified_read: false,
      created_by: actor.userId || null,
      created_by_name: actor.nama_lengkap || actor.username || 'Admin',
      created_at: now,
      updated_at: now
    };

    if (await checkNativeTables()) {
      const { data, error } = await supabase
        .from('discipline_incidents')
        .insert([record])
        .select()
        .single();
      if (error) throw error;
      await logDisciplineAudit(
        actor.username || 'admin',
        'DISCIPLINE_CREATE_INCIDENT',
        data.id,
        null,
        data,
        `Mencatat kejadian disiplin ${data.incident_code} untuk ${data.user_name_snapshot} (${data.subkategori}, +${data.poin} poin)`
      );
      return evaluateIncidentPointStatus(data);
    } else {
      const store = await loadCloudStore();
      store.incidents.push(record);
      await saveCloudStore(store);
      await logDisciplineAudit(
        actor.username || 'admin',
        'DISCIPLINE_CREATE_INCIDENT',
        record.id,
        null,
        record,
        `Mencatat kejadian disiplin ${record.incident_code} untuk ${record.user_name_snapshot} (${record.subkategori}, +${record.poin} poin)`
      );
      return evaluateIncidentPointStatus(record);
    }
  }

  async function updateDisciplineIncident(incidentId, updateData, actor = {}) {
    const now = new Date().toISOString();
    if (await checkNativeTables()) {
      const { data: before } = await supabase.from('discipline_incidents').select('*').eq('id', incidentId).maybeSingle();
      if (!before) {
        const err = new Error('Data kejadian tidak ditemukan.');
        err.statusCode = 404;
        throw err;
      }
      const masa_berlaku_bulan = updateData.masa_berlaku_bulan !== undefined
        ? Math.max(1, parseInt(updateData.masa_berlaku_bulan, 10) || before.masa_berlaku_bulan)
        : before.masa_berlaku_bulan;
      const incident_date = updateData.incident_date ? String(updateData.incident_date).slice(0, 10) : before.incident_date;
      const expired_at = computeExpiryDate(incident_date, masa_berlaku_bulan);
      const todayStr = getJakartaDateStr();
      const status_poin = before.status_poin === 'CANCELLED'
        ? 'CANCELLED'
        : (expired_at < todayStr ? 'EXPIRED' : 'ACTIVE');

      const patch = {
        incident_date,
        masa_berlaku_bulan,
        expired_at,
        status_poin,
        kronologi: updateData.kronologi !== undefined ? String(updateData.kronologi).trim() : before.kronologi,
        catatan_pembinaan: updateData.catatan_pembinaan !== undefined ? String(updateData.catatan_pembinaan).trim() : before.catatan_pembinaan,
        catatan_internal: updateData.catatan_internal !== undefined ? String(updateData.catatan_internal).trim() : before.catatan_internal,
        status_kasus: updateData.status_kasus && ['OPEN', 'IN_REVIEW', 'RESOLVED', 'NEED_HR_REVIEW', 'CANCELLED'].includes(updateData.status_kasus)
          ? updateData.status_kasus
          : before.status_kasus,
        show_evidence_to_user: updateData.show_evidence_to_user !== undefined
          ? Boolean(updateData.show_evidence_to_user)
          : before.show_evidence_to_user,
        updated_at: now
      };

      const { data, error } = await supabase
        .from('discipline_incidents')
        .update(patch)
        .eq('id', incidentId)
        .select()
        .single();
      if (error) throw error;
      await logDisciplineAudit(
        actor.username || 'admin',
        'DISCIPLINE_UPDATE_INCIDENT',
        incidentId,
        before,
        data,
        `Mengubah detail kejadian ${before.incident_code} (${before.user_name_snapshot})`
      );
      return evaluateIncidentPointStatus(data);
    } else {
      const store = await loadCloudStore();
      const idx = store.incidents.findIndex(i => i.id === incidentId);
      if (idx === -1) {
        const err = new Error('Data kejadian tidak ditemukan.');
        err.statusCode = 404;
        throw err;
      }
      const before = { ...store.incidents[idx] };
      const masa_berlaku_bulan = updateData.masa_berlaku_bulan !== undefined
        ? Math.max(1, parseInt(updateData.masa_berlaku_bulan, 10) || before.masa_berlaku_bulan)
        : before.masa_berlaku_bulan;
      const incident_date = updateData.incident_date ? String(updateData.incident_date).slice(0, 10) : before.incident_date;
      const expired_at = computeExpiryDate(incident_date, masa_berlaku_bulan);
      const todayStr = getJakartaDateStr();
      const status_poin = before.status_poin === 'CANCELLED'
        ? 'CANCELLED'
        : (expired_at < todayStr ? 'EXPIRED' : 'ACTIVE');

      store.incidents[idx] = {
        ...before,
        incident_date,
        masa_berlaku_bulan,
        expired_at,
        status_poin,
        kronologi: updateData.kronologi !== undefined ? String(updateData.kronologi).trim() : before.kronologi,
        catatan_pembinaan: updateData.catatan_pembinaan !== undefined ? String(updateData.catatan_pembinaan).trim() : before.catatan_pembinaan,
        catatan_internal: updateData.catatan_internal !== undefined ? String(updateData.catatan_internal).trim() : before.catatan_internal,
        status_kasus: updateData.status_kasus && ['OPEN', 'IN_REVIEW', 'RESOLVED', 'NEED_HR_REVIEW', 'CANCELLED'].includes(updateData.status_kasus)
          ? updateData.status_kasus
          : before.status_kasus,
        show_evidence_to_user: updateData.show_evidence_to_user !== undefined
          ? Boolean(updateData.show_evidence_to_user)
          : before.show_evidence_to_user,
        updated_at: now
      };
      const after = store.incidents[idx];
      await saveCloudStore(store);
      await logDisciplineAudit(
        actor.username || 'admin',
        'DISCIPLINE_UPDATE_INCIDENT',
        incidentId,
        before,
        after,
        `Mengubah detail kejadian ${before.incident_code} (${before.user_name_snapshot})`
      );
      return evaluateIncidentPointStatus(after);
    }
  }

  // ===================== 4. ADJUSTMENTS (KOREKSI / PEMBATALAN POIN) =====================
  async function adjustDisciplineIncidentPoints(incidentId, adjPayload, actor = {}) {
    const reason = String(adjPayload.reason || '').trim();
    if (!reason) {
      const err = new Error('Alasan adjustment / perubahan poin wajib diisi untuk keperluan audit.');
      err.statusCode = 400;
      throw err;
    }

    const adjustment_type = ['REDUCE_POINTS', 'INCREASE_POINTS', 'CANCEL_INCIDENT', 'RESTORE_POINTS', 'APPEAL_APPROVED'].includes(adjPayload.adjustment_type)
      ? adjPayload.adjustment_type
      : 'REDUCE_POINTS';

    const now = new Date().toISOString();
    const todayStr = getJakartaDateStr();

    if (await checkNativeTables()) {
      const { data: before } = await supabase.from('discipline_incidents').select('*').eq('id', incidentId).maybeSingle();
      if (!before) {
        const err = new Error('Data kejadian tidak ditemukan.');
        err.statusCode = 404;
        throw err;
      }

      const previous_points = Number(before.poin) || 0;
      const previous_status = before.status_poin;
      let new_points = adjustment_type === 'CANCEL_INCIDENT'
        ? 0
        : Math.max(0, parseInt(adjPayload.new_points, 10));
      if (isNaN(new_points)) new_points = 0;

      let new_status = before.status_poin;
      let status_kasus = before.status_kasus;
      if (adjustment_type === 'CANCEL_INCIDENT' || new_points === 0) {
        new_status = 'CANCELLED';
        status_kasus = 'CANCELLED';
      } else {
        new_status = before.expired_at < todayStr ? 'EXPIRED' : 'ACTIVE';
        if (status_kasus === 'CANCELLED') status_kasus = 'RESOLVED';
      }

      const adjRecord = {
        id: uuidv4(),
        incident_id: incidentId,
        adjustment_type,
        previous_points,
        new_points,
        previous_status,
        new_status,
        reason,
        appeal_id: adjPayload.appeal_id || null,
        created_by: actor.userId || null,
        created_by_name: actor.nama_lengkap || actor.username || 'Admin',
        created_at: now
      };

      const { error: adjErr } = await supabase.from('discipline_adjustments').insert([adjRecord]);
      if (adjErr) throw adjErr;

      const { data: updatedIncident, error: incErr } = await supabase
        .from('discipline_incidents')
        .update({
          poin: new_points,
          status_poin: new_status,
          status_kasus,
          updated_at: now
        })
        .eq('id', incidentId)
        .select()
        .single();
      if (incErr) throw incErr;

      await logDisciplineAudit(
        actor.username || 'admin',
        'DISCIPLINE_ADJUST_POINTS',
        incidentId,
        { poin: previous_points, status_poin: previous_status },
        { poin: new_points, status_poin: new_status, adjustment_type, reason },
        `Adjustment poin kejadian ${before.incident_code} (${before.user_name_snapshot}): ${previous_points} -> ${new_points} poin (${adjustment_type}). Alasan: ${reason}`
      );

      return { incident: evaluateIncidentPointStatus(updatedIncident), adjustment: adjRecord };
    } else {
      const store = await loadCloudStore();
      const idx = store.incidents.findIndex(i => i.id === incidentId);
      if (idx === -1) {
        const err = new Error('Data kejadian tidak ditemukan.');
        err.statusCode = 404;
        throw err;
      }
      const before = { ...store.incidents[idx] };
      const previous_points = Number(before.poin) || 0;
      const previous_status = before.status_poin;
      let new_points = adjustment_type === 'CANCEL_INCIDENT'
        ? 0
        : Math.max(0, parseInt(adjPayload.new_points, 10));
      if (isNaN(new_points)) new_points = 0;

      let new_status = before.status_poin;
      let status_kasus = before.status_kasus;
      if (adjustment_type === 'CANCEL_INCIDENT' || new_points === 0) {
        new_status = 'CANCELLED';
        status_kasus = 'CANCELLED';
      } else {
        new_status = before.expired_at < todayStr ? 'EXPIRED' : 'ACTIVE';
        if (status_kasus === 'CANCELLED') status_kasus = 'RESOLVED';
      }

      const adjRecord = {
        id: uuidv4(),
        incident_id: incidentId,
        adjustment_type,
        previous_points,
        new_points,
        previous_status,
        new_status,
        reason,
        appeal_id: adjPayload.appeal_id || null,
        created_by: actor.userId || null,
        created_by_name: actor.nama_lengkap || actor.username || 'Admin',
        created_at: now
      };

      store.adjustments.push(adjRecord);
      store.incidents[idx] = {
        ...before,
        poin: new_points,
        status_poin: new_status,
        status_kasus,
        updated_at: now
      };
      const updatedIncident = store.incidents[idx];
      await saveCloudStore(store);

      await logDisciplineAudit(
        actor.username || 'admin',
        'DISCIPLINE_ADJUST_POINTS',
        incidentId,
        { poin: previous_points, status_poin: previous_status },
        { poin: new_points, status_poin: new_status, adjustment_type, reason },
        `Adjustment poin kejadian ${before.incident_code} (${before.user_name_snapshot}): ${previous_points} -> ${new_points} poin (${adjustment_type}). Alasan: ${reason}`
      );

      return { incident: evaluateIncidentPointStatus(updatedIncident), adjustment: adjRecord };
    }
  }

  // ===================== 5. ATTACHMENTS =====================
  async function addDisciplineAttachment(attData) {
    const record = {
      id: uuidv4(),
      incident_id: attData.incident_id,
      appeal_id: attData.appeal_id || null,
      source_type: attData.source_type === 'APPEAL' ? 'APPEAL' : 'INCIDENT',
      storage_path: attData.storage_path,
      original_filename: attData.original_filename,
      mime_type: attData.mime_type,
      file_size: Number(attData.file_size) || 0,
      uploaded_by: attData.uploaded_by || null,
      uploaded_by_name: attData.uploaded_by_name || 'User',
      created_at: new Date().toISOString()
    };

    if (await checkNativeTables()) {
      const { data, error } = await supabase
        .from('discipline_attachments')
        .insert([record])
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const store = await loadCloudStore();
      store.attachments.push(record);
      await saveCloudStore(store);
      return record;
    }
  }

  async function getDisciplineAttachmentById(attachmentId) {
    if (await checkNativeTables()) {
      const { data, error } = await supabase
        .from('discipline_attachments')
        .select('*')
        .eq('id', attachmentId)
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      const store = await loadCloudStore();
      return (store.attachments || []).find(a => a.id === attachmentId) || null;
    }
  }

  // ===================== 6. FETCH & QUERY INCIDENTS =====================
  async function getAllRawDisciplineData() {
    const todayStr = getJakartaDateStr();
    if (await checkNativeTables()) {
      const [incRes, adjRes, appRes, attRes] = await Promise.all([
        supabase.from('discipline_incidents').select('*').order('incident_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('discipline_adjustments').select('*').order('created_at', { ascending: false }),
        supabase.from('discipline_appeals').select('*').order('created_at', { ascending: false }),
        supabase.from('discipline_attachments').select('*').order('created_at', { ascending: true })
      ]);
      const incidents = (incRes.data || []).map(i => evaluateIncidentPointStatus(i, todayStr));
      return {
        incidents,
        adjustments: adjRes.data || [],
        appeals: appRes.data || [],
        attachments: attRes.data || []
      };
    } else {
      const store = await loadCloudStore();
      let statusChanged = false;
      const incidents = (store.incidents || []).map(inc => {
        const evaluated = evaluateIncidentPointStatus(inc, todayStr);
        if (evaluated.status_poin !== inc.status_poin) statusChanged = true;
        return evaluated;
      });
      if (statusChanged) {
        store.incidents = incidents;
        await saveCloudStore(store).catch(() => {});
      }
      return {
        incidents: [...incidents].sort((a, b) =>
          (b.incident_date || '').localeCompare(a.incident_date || '') ||
          (b.created_at || '').localeCompare(a.created_at || '')
        ),
        adjustments: [...(store.adjustments || [])].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
        appeals: [...(store.appeals || [])].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
        attachments: store.attachments || []
      };
    }
  }

  async function getDisciplineIncidents(filters = {}, requestingUser = { role: 'admin' }) {
    const { incidents, adjustments, appeals, attachments } = await getAllRawDisciplineData();

    // STRICT DATA ISOLATION: Non-admin can ONLY ever query their own user_id
    const effectiveUserId = requestingUser.role === 'admin'
      ? (filters.user_id || null)
      : requestingUser.userId;

    if (requestingUser.role !== 'admin' && !effectiveUserId) {
      const err = new Error('Unauthorized user context.');
      err.statusCode = 401;
      throw err;
    }

    const search = String(filters.search || '').trim().toLowerCase();
    const dateFrom = filters.date_from ? String(filters.date_from).slice(0, 10) : '';
    const dateTo = filters.date_to ? String(filters.date_to).slice(0, 10) : '';
    const posisi = filters.posisi && filters.posisi !== 'all' ? String(filters.posisi) : '';
    const kategori = filters.kategori && filters.kategori !== 'all' ? String(filters.kategori) : '';
    const statusPoin = filters.status_poin && filters.status_poin !== 'all' ? String(filters.status_poin) : '';
    const statusKasus = filters.status_kasus && filters.status_kasus !== 'all' ? String(filters.status_kasus) : '';

    // Map related records
    const adjByInc = new Map();
    adjustments.forEach(a => {
      if (!adjByInc.has(a.incident_id)) adjByInc.set(a.incident_id, []);
      adjByInc.get(a.incident_id).push(a);
    });

    const appByInc = new Map();
    appeals.forEach(ap => {
      if (!appByInc.has(ap.incident_id)) appByInc.set(ap.incident_id, []);
      appByInc.get(ap.incident_id).push(ap);
    });

    const attByInc = new Map();
    attachments.forEach(att => {
      if (!attByInc.has(att.incident_id)) attByInc.set(att.incident_id, []);
      attByInc.get(att.incident_id).push(att);
    });

    let filtered = incidents.filter(inc => {
      if (effectiveUserId && inc.user_id !== effectiveUserId) return false;
      if (dateFrom && inc.incident_date < dateFrom) return false;
      if (dateTo && inc.incident_date > dateTo) return false;
      if (posisi && (inc.posisi || '').toLowerCase() !== posisi.toLowerCase()) return false;
      if (kategori && (inc.kategori_nama || '').toLowerCase() !== kategori.toLowerCase() && inc.category_id !== kategori) return false;
      if (statusPoin && inc.status_poin !== statusPoin) return false;
      if (statusKasus && inc.status_kasus !== statusKasus) return false;
      if (search) {
        const hay = [
          inc.incident_code,
          inc.user_name_snapshot,
          inc.nik_snapshot,
          inc.posisi,
          inc.kategori_nama,
          inc.subkategori,
          inc.kronologi,
          inc.catatan_pembinaan
        ].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const hydrated = filtered.map(inc => {
      const incAdjustments = adjByInc.get(inc.id) || [];
      const incAppeals = appByInc.get(inc.id) || [];
      let incAttachments = attByInc.get(inc.id) || [];
      if (requestingUser.role !== 'admin') {
        incAttachments = incAttachments.filter(a => a.source_type === 'APPEAL' || inc.show_evidence_to_user);
      }
      const item = {
        ...inc,
        adjustments_count: incAdjustments.length,
        latest_adjustment: incAdjustments[0] || null,
        latest_appeal: incAppeals[0] || null,
        attachments_count: incAttachments.length,
        attachments: incAttachments
      };
      if (requestingUser.role !== 'admin') {
        delete item.catatan_internal;
      }
      return item;
    });

    const total = hydrated.length;
    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const limit = Math.max(1, Math.min(500, parseInt(filters.limit, 10) || 20));
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const items = hydrated.slice(start, start + limit);

    const activePointsSum = hydrated
      .filter(i => i.status_poin === 'ACTIVE')
      .reduce((s, i) => s + (Number(i.poin) || 0), 0);
    const periodPointsSum = hydrated
      .filter(i => i.status_poin !== 'CANCELLED')
      .reduce((s, i) => s + (Number(i.poin) || 0), 0);

    return {
      items,
      total,
      page,
      limit,
      totalPages,
      summary: {
        total_incidents: total,
        active_points: activePointsSum,
        period_points: periodPointsSum,
        active_count: hydrated.filter(i => i.status_poin === 'ACTIVE').length,
        expired_count: hydrated.filter(i => i.status_poin === 'EXPIRED').length,
        cancelled_count: hydrated.filter(i => i.status_poin === 'CANCELLED').length
      }
    };
  }

  async function getDisciplineIncidentDetail(incidentId, requestingUser) {
    const { incidents, adjustments, appeals, attachments } = await getAllRawDisciplineData();
    const inc = incidents.find(i => i.id === incidentId);
    if (!inc) {
      const err = new Error('Data kejadian tidak ditemukan.');
      err.statusCode = 404;
      throw err;
    }

    // STRICT OWNERSHIP CHECK
    if (requestingUser.role !== 'admin' && inc.user_id !== requestingUser.userId) {
      const err = new Error('Akses ditolak. Anda hanya dapat melihat catatan kinerja milik Anda sendiri.');
      err.statusCode = 403;
      throw err;
    }

    const incAdjustments = adjustments.filter(a => a.incident_id === incidentId);
    const incAppeals = appeals.filter(ap => ap.incident_id === incidentId);
    let incAttachments = attachments.filter(att => att.incident_id === incidentId);

    if (requestingUser.role !== 'admin') {
      incAttachments = incAttachments.filter(att => att.source_type === 'APPEAL' || inc.show_evidence_to_user);
    }

    const result = {
      ...inc,
      adjustments: incAdjustments,
      appeals: incAppeals,
      attachments: incAttachments
    };

    if (requestingUser.role !== 'admin') {
      delete result.catatan_internal;
    }

    return result;
  }

  // ===================== 7. APPEALS (KLARIFIKASI USER & REVIEW ADMIN) =====================
  async function createDisciplineAppeal(incidentId, payload, actorUser) {
    const settings = await getDisciplineSettings();
    if (!settings.enable_user_appeals) {
      const err = new Error('Fitur pengajuan klarifikasi saat ini sedang dinonaktifkan oleh Administrator.');
      err.statusCode = 403;
      throw err;
    }

    const alasan = String(payload.alasan || '').trim();
    const kronologi_user = String(payload.kronologi_user || '').trim();
    if (!alasan || !kronologi_user) {
      const err = new Error('Alasan dan kronologi versi Anda wajib diisi.');
      err.statusCode = 400;
      throw err;
    }

    const { incidents, appeals } = await getAllRawDisciplineData();
    const inc = incidents.find(i => i.id === incidentId);
    if (!inc) {
      const err = new Error('Kejadian tidak ditemukan.');
      err.statusCode = 404;
      throw err;
    }

    // STRICT OWNERSHIP CHECK: User can only appeal their own incident
    if (inc.user_id !== actorUser.userId) {
      const err = new Error('Akses ditolak. Anda hanya dapat mengajukan klarifikasi untuk kejadian milik Anda sendiri.');
      err.statusCode = 403;
      throw err;
    }

    if (inc.status_poin === 'CANCELLED') {
      const err = new Error('Kejadian ini sudah dibatalkan sehingga tidak memerlukan klarifikasi.');
      err.statusCode = 400;
      throw err;
    }

    const existingPending = appeals.find(a => a.incident_id === incidentId && a.status === 'PENDING');
    if (existingPending) {
      const err = new Error('Klarifikasi untuk kejadian ini sudah diajukan dan sedang menunggu review Admin.');
      err.statusCode = 409;
      throw err;
    }

    const now = new Date().toISOString();
    const appealRecord = {
      id: uuidv4(),
      incident_id: incidentId,
      user_id: actorUser.userId,
      user_name_snapshot: actorUser.nama_lengkap || actorUser.username || inc.user_name_snapshot,
      alasan,
      kronologi_user,
      status: 'PENDING',
      review_notes: '',
      reviewed_by: null,
      reviewed_by_name: null,
      reviewed_at: null,
      user_result_read: true, // Will become false once admin reviews it so user gets notified of the result
      created_at: now,
      updated_at: now
    };

    if (await checkNativeTables()) {
      const { data, error } = await supabase
        .from('discipline_appeals')
        .insert([appealRecord])
        .select()
        .single();
      if (error) throw error;
      await supabase
        .from('discipline_incidents')
        .update({ status_kasus: 'IN_REVIEW', updated_at: now })
        .eq('id', incidentId);
      await logDisciplineAudit(
        actorUser.username,
        'DISCIPLINE_SUBMIT_APPEAL',
        data.id,
        null,
        data,
        `User ${appealRecord.user_name_snapshot} mengajukan klarifikasi untuk kejadian ${inc.incident_code}`
      );
      return data;
    } else {
      const store = await loadCloudStore();
      store.appeals.push(appealRecord);
      const incIdx = store.incidents.findIndex(i => i.id === incidentId);
      if (incIdx !== -1 && store.incidents[incIdx].status_kasus === 'OPEN') {
        store.incidents[incIdx].status_kasus = 'IN_REVIEW';
        store.incidents[incIdx].updated_at = now;
      }
      await saveCloudStore(store);
      await logDisciplineAudit(
        actorUser.username,
        'DISCIPLINE_SUBMIT_APPEAL',
        appealRecord.id,
        null,
        appealRecord,
        `User ${appealRecord.user_name_snapshot} mengajukan klarifikasi untuk kejadian ${inc.incident_code}`
      );
      return appealRecord;
    }
  }

  async function reviewDisciplineAppeal(appealId, reviewData, actorAdmin = {}) {
    const decision = reviewData.decision === 'APPROVED' ? 'APPROVED' : (reviewData.decision === 'REJECTED' ? 'REJECTED' : null);
    if (!decision) {
      const err = new Error('Keputusan review harus APPROVED (Diterima) atau REJECTED (Ditolak).');
      err.statusCode = 400;
      throw err;
    }
    const review_notes = String(reviewData.review_notes || '').trim();
    if (!review_notes) {
      const err = new Error('Catatan / alasan keputusan review klarifikasi wajib diisi.');
      err.statusCode = 400;
      throw err;
    }

    const now = new Date().toISOString();
    const { incidents, appeals } = await getAllRawDisciplineData();
    const appeal = appeals.find(a => a.id === appealId);
    if (!appeal) {
      const err = new Error('Data klarifikasi tidak ditemukan.');
      err.statusCode = 404;
      throw err;
    }
    if (appeal.status !== 'PENDING') {
      const err = new Error('Klarifikasi ini sudah pernah direview sebelumnya.');
      err.statusCode = 409;
      throw err;
    }

    const inc = incidents.find(i => i.id === appeal.incident_id);
    if (!inc) {
      const err = new Error('Data kejadian terkait tidak ditemukan.');
      err.statusCode = 404;
      throw err;
    }

    let adjustmentResult = null;
    if (decision === 'APPROVED') {
      // Do NOT delete incident. Perform point adjustment!
      const adjType = reviewData.adjustment_type === 'CANCEL_INCIDENT' || Number(reviewData.new_points) === 0
        ? 'CANCEL_INCIDENT'
        : 'APPEAL_APPROVED';
      const targetPoints = adjType === 'CANCEL_INCIDENT'
        ? 0
        : (reviewData.new_points !== undefined && reviewData.new_points !== ''
            ? Math.max(0, parseInt(reviewData.new_points, 10))
            : 0);

      adjustmentResult = await adjustDisciplineIncidentPoints(
        inc.id,
        {
          adjustment_type: adjType,
          new_points: targetPoints,
          reason: `Klarifikasi Diterima: ${review_notes}`,
          appeal_id: appeal.id
        },
        actorAdmin
      );
    }

    if (await checkNativeTables()) {
      const { data: updatedAppeal, error } = await supabase
        .from('discipline_appeals')
        .update({
          status: decision,
          review_notes,
          reviewed_by: actorAdmin.userId || null,
          reviewed_by_name: actorAdmin.nama_lengkap || actorAdmin.username || 'Admin',
          reviewed_at: now,
          user_result_read: false,
          updated_at: now
        })
        .eq('id', appealId)
        .select()
        .single();
      if (error) throw error;

      if (decision === 'REJECTED') {
        await supabase
          .from('discipline_incidents')
          .update({
            status_kasus: inc.requires_hr_review ? 'NEED_HR_REVIEW' : 'RESOLVED',
            updated_at: now
          })
          .eq('id', inc.id);
      } else if (decision === 'APPROVED' && adjustmentResult && adjustmentResult.incident.status_poin !== 'CANCELLED') {
        await supabase
          .from('discipline_incidents')
          .update({ status_kasus: 'RESOLVED', updated_at: now })
          .eq('id', inc.id);
      }

      await logDisciplineAudit(
        actorAdmin.username || 'admin',
        decision === 'APPROVED' ? 'DISCIPLINE_APPROVE_APPEAL' : 'DISCIPLINE_REJECT_APPEAL',
        appealId,
        appeal,
        updatedAppeal,
        `${decision === 'APPROVED' ? 'Menerima' : 'Menolak'} klarifikasi kejadian ${inc.incident_code} (${appeal.user_name_snapshot}). Catatan: ${review_notes}`
      );

      return { appeal: updatedAppeal, adjustment: adjustmentResult?.adjustment || null };
    } else {
      const store = await loadCloudStore();
      const apIdx = store.appeals.findIndex(a => a.id === appealId);
      if (apIdx === -1) {
        const err = new Error('Klarifikasi tidak ditemukan.');
        err.statusCode = 404;
        throw err;
      }
      const beforeAppeal = { ...store.appeals[apIdx] };
      store.appeals[apIdx] = {
        ...beforeAppeal,
        status: decision,
        review_notes,
        reviewed_by: actorAdmin.userId || null,
        reviewed_by_name: actorAdmin.nama_lengkap || actorAdmin.username || 'Admin',
        reviewed_at: now,
        user_result_read: false,
        updated_at: now
      };
      const incIdx = store.incidents.findIndex(i => i.id === inc.id);
      if (incIdx !== -1) {
        if (decision === 'REJECTED') {
          store.incidents[incIdx].status_kasus = inc.requires_hr_review ? 'NEED_HR_REVIEW' : 'RESOLVED';
        } else if (store.incidents[incIdx].status_poin !== 'CANCELLED') {
          store.incidents[incIdx].status_kasus = 'RESOLVED';
        }
        store.incidents[incIdx].updated_at = now;
      }
      await saveCloudStore(store);

      await logDisciplineAudit(
        actorAdmin.username || 'admin',
        decision === 'APPROVED' ? 'DISCIPLINE_APPROVE_APPEAL' : 'DISCIPLINE_REJECT_APPEAL',
        appealId,
        beforeAppeal,
        store.appeals[apIdx],
        `${decision === 'APPROVED' ? 'Menerima' : 'Menolak'} klarifikasi kejadian ${inc.incident_code} (${appeal.user_name_snapshot}). Catatan: ${review_notes}`
      );

      return { appeal: store.appeals[apIdx], adjustment: adjustmentResult?.adjustment || null };
    }
  }

  async function getDisciplineAppeals(filters = {}, requestingUser = { role: 'admin' }) {
    const { incidents, appeals, attachments } = await getAllRawDisciplineData();
    const incMap = new Map(incidents.map(i => [i.id, i]));
    const attByAppeal = new Map();
    attachments.forEach(att => {
      if (att.appeal_id) {
        if (!attByAppeal.has(att.appeal_id)) attByAppeal.set(att.appeal_id, []);
        attByAppeal.get(att.appeal_id).push(att);
      }
    });

    const statusFilter = filters.status && filters.status !== 'all' ? String(filters.status) : '';
    const search = String(filters.search || '').trim().toLowerCase();

    let list = appeals.filter(ap => {
      if (requestingUser.role !== 'admin' && ap.user_id !== requestingUser.userId) return false;
      if (statusFilter && ap.status !== statusFilter) return false;
      const inc = incMap.get(ap.incident_id);
      if (search) {
        const hay = [
          ap.user_name_snapshot,
          ap.alasan,
          ap.kronologi_user,
          inc?.incident_code,
          inc?.kategori_nama,
          inc?.subkategori,
          inc?.posisi
        ].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    return list.map(ap => {
      const inc = incMap.get(ap.incident_id) ? { ...incMap.get(ap.incident_id) } : null;
      if (inc && requestingUser.role !== 'admin') {
        delete inc.catatan_internal;
      }
      return {
        ...ap,
        incident: inc,
        attachments: attByAppeal.get(ap.id) || []
      };
    });
  }

  // ===================== 8. ADMIN DASHBOARD ANALYTICS =====================
  async function getAdminDisciplineDashboard(filters = {}) {
    const settings = await getDisciplineSettings();
    const { incidents, appeals } = await getAllRawDisciplineData();
    const todayStr = getJakartaDateStr();
    const currentMonthPrefix = todayStr.slice(0, 7); // YYYY-MM

    const dateFrom = filters.date_from ? String(filters.date_from).slice(0, 10) : '';
    const dateTo = filters.date_to ? String(filters.date_to).slice(0, 10) : '';
    const posisiFilter = filters.posisi && filters.posisi !== 'all' ? String(filters.posisi) : '';
    const kategoriFilter = filters.kategori && filters.kategori !== 'all' ? String(filters.kategori) : '';
    const statusFilter = filters.status_poin && filters.status_poin !== 'all' ? String(filters.status_poin) : '';
    const userSearch = String(filters.user_search || '').trim().toLowerCase();

    const filteredIncidents = incidents.filter(inc => {
      if (dateFrom && inc.incident_date < dateFrom) return false;
      if (dateTo && inc.incident_date > dateTo) return false;
      if (posisiFilter && (inc.posisi || '').toLowerCase() !== posisiFilter.toLowerCase()) return false;
      if (kategoriFilter && (inc.kategori_nama || '').toLowerCase() !== kategoriFilter.toLowerCase()) return false;
      if (statusFilter && inc.status_poin !== statusFilter) return false;
      if (userSearch && !(inc.user_name_snapshot || '').toLowerCase().includes(userSearch)) return false;
      return true;
    });

    const hrPointThreshold = getEffectiveHrThreshold(settings);

    // 4 Main Cards
    const incidentsThisMonth = filteredIncidents.filter(
      i => i.status_poin !== 'CANCELLED' && String(i.incident_date || '').startsWith(currentMonthPrefix)
    );
    const activeIncidents = filteredIncidents.filter(i => i.status_poin === 'ACTIVE');
    const totalActivePoints = activeIncidents.reduce((s, i) => s + (Number(i.poin) || 0), 0);
    const usersWithActivePointsSet = new Set(activeIncidents.filter(i => Number(i.poin) > 0).map(i => i.user_id));
    const pendingAppealsCount = appeals.filter(a => a.status === 'PENDING').length;
    const hrReviewCount = filteredIncidents.filter(
      i => i.status_poin !== 'CANCELLED' && (
        i.requires_hr_review ||
        i.severity === 'CRITICAL' ||
        (hrPointThreshold !== null && i.status_kasus === 'NEED_HR_REVIEW')
      )
    ).length;

    // 1. Kategori kesalahan terbanyak
    const catMap = new Map();
    filteredIncidents.filter(i => i.status_poin !== 'CANCELLED').forEach(inc => {
      const key = inc.kategori_nama || 'Lainnya';
      const cur = catMap.get(key) || { kategori: key, count: 0, total_poin: 0 };
      cur.count += 1;
      cur.total_poin += Number(inc.poin) || 0;
      catMap.set(key, cur);
    });
    const by_category = Array.from(catMap.values()).sort((a, b) => b.count - a.count);

    // 2. Trend jumlah kejadian per bulan (6 bulan terakhir)
    const months = [];
    const nowDate = new Date(todayStr + 'T00:00:00Z');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - i, 1));
      const ym = d.toISOString().slice(0, 7);
      const label = `${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      months.push({ ym, label, count: 0, total_poin: 0 });
    }
    filteredIncidents.filter(i => i.status_poin !== 'CANCELLED').forEach(inc => {
      const ym = String(inc.incident_date || '').slice(0, 7);
      const mObj = months.find(m => m.ym === ym);
      if (mObj) {
        mObj.count += 1;
        mObj.total_poin += Number(inc.poin) || 0;
      }
    });

    // 3. Jumlah kejadian per posisi
    const posMap = new Map();
    ['Picker', 'Sorter', 'Loader', 'Return', 'QC Outbound'].forEach(p => {
      posMap.set(p, { posisi: p, count: 0, active_points: 0 });
    });
    filteredIncidents.filter(i => i.status_poin !== 'CANCELLED').forEach(inc => {
      const p = inc.posisi || 'Lainnya';
      const cur = posMap.get(p) || { posisi: p, count: 0, active_points: 0 };
      cur.count += 1;
      if (inc.status_poin === 'ACTIVE') cur.active_points += Number(inc.poin) || 0;
      posMap.set(p, cur);
    });
    const by_posisi = Array.from(posMap.values()).sort((a, b) => b.count - a.count);

    // 4. User dengan kejadian berulang dalam N hari (default 30 hari) — Fokus Pembinaan & Coaching
    const windowDays = settings.repeat_incident_days || 30;
    const repeatThreshold = settings.repeat_incident_threshold || 2;
    const cutoffDateObj = new Date(todayStr + 'T00:00:00Z');
    cutoffDateObj.setUTCDate(cutoffDateObj.getUTCDate() - windowDays);
    const cutoffStr = cutoffDateObj.toISOString().slice(0, 10);

    const userStatsMap = new Map();
    filteredIncidents.filter(i => i.status_poin !== 'CANCELLED').forEach(inc => {
      const cur = userStatsMap.get(inc.user_id) || {
        user_id: inc.user_id,
        nama_lengkap: inc.user_name_snapshot,
        posisi: inc.posisi,
        recent_count_30d: 0,
        active_points: 0,
        total_incidents: 0,
        has_critical: false,
        last_incident_date: inc.incident_date,
        categories: new Set()
      };
      cur.total_incidents += 1;
      if (inc.incident_date >= cutoffStr) {
        cur.recent_count_30d += 1;
      }
      if (inc.status_poin === 'ACTIVE') {
        cur.active_points += Number(inc.poin) || 0;
      }
      if (inc.requires_hr_review || inc.severity === 'CRITICAL') {
        cur.has_critical = true;
      }
      if (inc.incident_date > cur.last_incident_date) {
        cur.last_incident_date = inc.incident_date;
      }
      cur.categories.add(inc.subkategori);
      userStatsMap.set(inc.user_id, cur);
    });

    const repeat_users_30d = Array.from(userStatsMap.values())
      .filter(u => {
        const exceedsThreshold = hrPointThreshold !== null && u.active_points >= hrPointThreshold;
        return u.recent_count_30d >= repeatThreshold || exceedsThreshold || u.has_critical;
      })
      .map(u => {
        const exceedsThreshold = hrPointThreshold !== null && u.active_points >= hrPointThreshold;
        return {
          user_id: u.user_id,
          nama_lengkap: u.nama_lengkap,
          posisi: u.posisi,
          recent_count_30d: u.recent_count_30d,
          active_points: u.active_points,
          total_incidents: u.total_incidents,
          last_incident_date: u.last_incident_date,
          recent_topics: Array.from(u.categories).slice(0, 3),
          needs_hr_review: u.has_critical || exceedsThreshold,
          coaching_status: u.has_critical
            ? 'Perlu Review Atasan / HR (Insiden Berat)'
            : exceedsThreshold
              ? `Perlu Review Atasan / HR (Ambang Poin Aktif >= ${hrPointThreshold})`
              : 'Perlu Pembinaan / Coaching (Kejadian Berulang)'
        };
      })
      .sort((a, b) => (b.needs_hr_review - a.needs_hr_review) || (b.recent_count_30d - a.recent_count_30d) || (b.active_points - a.active_points));

    // 5. Poin yang akan expired dalam 30 hari ke depan
    const expLimitObj = new Date(todayStr + 'T00:00:00Z');
    expLimitObj.setUTCDate(expLimitObj.getUTCDate() + 30);
    const expLimitStr = expLimitObj.toISOString().slice(0, 10);

    const expiring_soon = activeIncidents
      .filter(inc => inc.poin > 0 && inc.expired_at >= todayStr && inc.expired_at <= expLimitStr)
      .map(inc => {
        const daysLeft = Math.max(0, Math.ceil((new Date(inc.expired_at + 'T00:00:00Z') - new Date(todayStr + 'T00:00:00Z')) / (1000 * 60 * 60 * 24)));
        return {
          id: inc.id,
          incident_code: inc.incident_code,
          user_id: inc.user_id,
          nama_lengkap: inc.user_name_snapshot,
          posisi: inc.posisi,
          subkategori: inc.subkategori,
          poin: inc.poin,
          incident_date: inc.incident_date,
          expired_at: inc.expired_at,
          days_left: daysLeft
        };
      })
      .sort((a, b) => a.expired_at.localeCompare(b.expired_at));

    return {
      cards: {
        total_kejadian_bulan_ini: incidentsThisMonth.length,
        total_poin_aktif: totalActivePoints,
        user_memiliki_poin_aktif: usersWithActivePointsSet.size,
        klarifikasi_menunggu_review: pendingAppealsCount,
        perlu_review_hr_count: hrReviewCount
      },
      by_category,
      monthly_trend: months,
      by_posisi,
      repeat_users_30d,
      expiring_soon,
      settings
    };
  }

  // ===================== 9. USER "KINERJA SAYA" SUMMARY & NOTIFICATIONS =====================
  async function getUserDisciplineSummary(userId) {
    if (!userId) {
      const err = new Error('User ID wajib tersedia.');
      err.statusCode = 401;
      throw err;
    }

    const settings = await getDisciplineSettings();
    const hrPointThreshold = getEffectiveHrThreshold(settings);
    const { incidents, appeals, adjustments, attachments } = await getAllRawDisciplineData();
    const todayStr = getJakartaDateStr();
    const currentMonthPrefix = todayStr.slice(0, 7);

    // Get active period from site_settings if available
    let periodeMulai = '';
    if (isSupabaseEnabled) {
      const { data: perData } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'periode_aktif')
        .maybeSingle();
      if (perData && perData.value && perData.value.tanggal_mulai) {
        periodeMulai = String(perData.value.tanggal_mulai).slice(0, 10);
      }
    }

    // STRICTLY FILTER BY userId
    const myIncidents = incidents.filter(i => i.user_id === userId);
    const myAppeals = appeals.filter(a => a.user_id === userId);

    const adjByInc = new Map();
    adjustments.forEach(a => {
      if (!adjByInc.has(a.incident_id)) adjByInc.set(a.incident_id, []);
      adjByInc.get(a.incident_id).push(a);
    });

    const appByInc = new Map();
    myAppeals.forEach(ap => {
      if (!appByInc.has(ap.incident_id)) appByInc.set(ap.incident_id, []);
      appByInc.get(ap.incident_id).push(ap);
    });

    const attByInc = new Map();
    attachments.forEach(att => {
      if (!attByInc.has(att.incident_id)) attByInc.set(att.incident_id, []);
      attByInc.get(att.incident_id).push(att);
    });

    const activeIncidents = myIncidents.filter(i => i.status_poin === 'ACTIVE');
    const poin_aktif = activeIncidents.reduce((s, i) => s + (Number(i.poin) || 0), 0);

    const kejadian_bulan_ini = myIncidents.filter(
      i => i.status_poin !== 'CANCELLED' && String(i.incident_date || '').startsWith(currentMonthPrefix)
    ).length;

    const periodIncidents = myIncidents.filter(
      i => i.status_poin !== 'CANCELLED' && (!periodeMulai || i.incident_date >= periodeMulai)
    );
    const total_kejadian_periode_ini = periodIncidents.length;
    const total_poin_periode_ini = periodIncidents.reduce((s, i) => s + (Number(i.poin) || 0), 0);

    const klarifikasi_menunggu_review = myAppeals.filter(a => a.status === 'PENDING').length;

    // Notifications (strictly private to this user, non-sensitive message text)
    const unreadNewIncidents = myIncidents.filter(i => !i.user_notified_read && i.status_poin !== 'CANCELLED');
    const unreadReviewedAppeals = myAppeals.filter(a => a.status !== 'PENDING' && !a.user_result_read);

    const notifications = [
      ...unreadNewIncidents.map(i => ({
        id: `inc_${i.id}`,
        type: 'NEW_INCIDENT',
        incident_id: i.id,
        title: 'Catatan Kinerja Baru',
        message: 'Anda memiliki Catatan Kinerja baru.',
        created_at: i.created_at
      })),
      ...unreadReviewedAppeals.map(a => ({
        id: `app_${a.id}`,
        type: 'APPEAL_REVIEWED',
        incident_id: a.incident_id,
        appeal_id: a.id,
        status: a.status,
        title: 'Hasil Review Klarifikasi',
        message: `Pengajuan klarifikasi Anda telah selesai direview (${a.status === 'APPROVED' ? 'Diterima' : 'Ditolak'}).`,
        created_at: a.reviewed_at || a.updated_at
      }))
    ].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    // Sanitize timeline items (NEVER expose catatan_internal)
    const timeline = myIncidents.map(inc => {
      const isCategoryHrReview = Boolean(inc.requires_hr_review || inc.severity === 'CRITICAL');
      const effectiveStatusKasus = (!isCategoryHrReview && hrPointThreshold === null && inc.status_kasus === 'NEED_HR_REVIEW')
        ? 'OPEN'
        : inc.status_kasus;
      const item = {
        id: inc.id,
        incident_code: inc.incident_code,
        incident_date: inc.incident_date,
        posisi: inc.posisi,
        kategori_nama: inc.kategori_nama,
        subkategori: inc.subkategori,
        kronologi: inc.kronologi,
        default_poin: inc.default_poin,
        poin: inc.poin,
        effective_active_points: inc.effective_active_points !== undefined ? inc.effective_active_points : (inc.status_poin === 'ACTIVE' ? inc.poin : 0),
        severity: inc.severity,
        requires_hr_review: isCategoryHrReview,
        status_kasus: effectiveStatusKasus,
        catatan_pembinaan: inc.catatan_pembinaan,
        masa_berlaku_bulan: inc.masa_berlaku_bulan,
        expired_at: inc.expired_at,
        status_poin: inc.status_poin,
        show_evidence_to_user: inc.show_evidence_to_user,
        created_by_name: inc.created_by_name,
        created_at: inc.created_at,
        adjustments: adjByInc.get(inc.id) || [],
        appeals: appByInc.get(inc.id) || [],
        latest_appeal: (appByInc.get(inc.id) || [])[0] || null,
        attachments: (attByInc.get(inc.id) || []).filter(
          att => att.source_type === 'APPEAL' || inc.show_evidence_to_user
        )
      };
      return item;
    });

    const needsHrReviewByThreshold = hrPointThreshold !== null && poin_aktif >= hrPointThreshold;
    const needsHrReviewByCategory = activeIncidents.some(i => i.requires_hr_review || i.severity === 'CRITICAL');
    const needs_hr_review = needsHrReviewByCategory || needsHrReviewByThreshold;
    const status_pembinaan = needs_hr_review
      ? 'Perlu Review Atasan / HR'
      : (poin_aktif > 0 ? 'Dalam Pembinaan' : 'Normal (0 Poin Aktif)');

    return {
      cards: {
        poin_aktif,
        kejadian_bulan_ini,
        total_kejadian_periode_ini,
        total_poin_periode_ini,
        klarifikasi_menunggu_review,
        hr_review_point_threshold: hrPointThreshold,
        needs_hr_review,
        status_pembinaan
      },
      notifications,
      unread_count: notifications.length,
      timeline
    };
  }

  async function markUserDisciplineNotificationsRead(userId) {
    if (!userId) return { success: false };
    if (await checkNativeTables()) {
      await Promise.all([
        supabase.from('discipline_incidents').update({ user_notified_read: true }).eq('user_id', userId).eq('user_notified_read', false),
        supabase.from('discipline_appeals').update({ user_result_read: true }).eq('user_id', userId).eq('user_result_read', false)
      ]);
      return { success: true };
    } else {
      const store = await loadCloudStore();
      let changed = false;
      store.incidents.forEach(i => {
        if (i.user_id === userId && !i.user_notified_read) {
          i.user_notified_read = true;
          changed = true;
        }
      });
      store.appeals.forEach(a => {
        if (a.user_id === userId && a.status !== 'PENDING' && !a.user_result_read) {
          a.user_result_read = true;
          changed = true;
        }
      });
      if (changed) await saveCloudStore(store);
      return { success: true };
    }
  }

  return {
    DEFAULT_DISCIPLINE_SETTINGS,
    DEFAULT_DISCIPLINE_CATEGORIES,
    getDisciplineSettings,
    saveDisciplineSettings,
    getDisciplineCategories,
    upsertDisciplineCategory,
    toggleDisciplineCategoryStatus,
    createDisciplineIncident,
    updateDisciplineIncident,
    adjustDisciplineIncidentPoints,
    addDisciplineAttachment,
    getDisciplineAttachmentById,
    getDisciplineIncidents,
    getDisciplineIncidentDetail,
    createDisciplineAppeal,
    reviewDisciplineAppeal,
    getDisciplineAppeals,
    getAdminDisciplineDashboard,
    getUserDisciplineSummary,
    markUserDisciplineNotificationsRead
  };
};
