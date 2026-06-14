require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const googleDrive = require('./googleDrive');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const isSupabaseEnabled = !!(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;
if (isSupabaseEnabled) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false
    }
  });
  console.log('⚡ Supabase cloud database mode enabled!');
} else {
  console.log('📁 Local JSON database fallback enabled!');
}

const DB_FILE = path.join(__dirname, 'database.json');

// Default database structure
const defaultDb = {
  users: [],
  submissions: [],
  files: [],
  data_carian: [],
  loader_entries: []
};

// Load database from file (local fallback)
function load() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      // Ensure collections exist for older databases
      if (!db.data_carian) db.data_carian = [];
      if (!db.loader_entries) db.loader_entries = [];
      return db;
    } catch (e) {
      console.error('DB read error, using default:', e.message);
      return { ...defaultDb };
    }
  }
  return { ...defaultDb };
}

// Save database to file (local fallback)
function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// Initialize: create default admin if not exists (only for local mode)
function init() {
  if (isSupabaseEnabled) return;
  const db = load();
  let changed = false;
  if (!db.users.find(u => u.username === 'admin')) {
    db.users.push({
      id: uuidv4(),
      username: 'admin',
      nama_lengkap: 'Administrator',
      password: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      nik: null,
      posisi: null,
      created_at: new Date().toISOString()
    });
    changed = true;
    console.log('✅ Default admin created: username=admin, password=admin123');
  }
  // Migrate existing admin users that don't have role field
  db.users.forEach(u => {
    if (!u.role) { u.role = 'admin'; u.nama_lengkap = u.nama_lengkap || u.username; changed = true; }
  });
  if (changed) save(db);
}

init();

module.exports = {
  isSupabaseEnabled,

  async getUserByUsername(username) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .maybeSingle();
      if (error) {
        console.error('Supabase getUserByUsername error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      return db.users.find(u => u.username === username) || null;
    }
  },

  async insertSubmission(data) {
    let batch_cluster = data.batch_cluster;
    if (typeof batch_cluster === 'string') {
      try {
        batch_cluster = JSON.parse(batch_cluster);
      } catch (e) {
        batch_cluster = [];
      }
    }

    if (isSupabaseEnabled) {
      const record = {
        id: data.id,
        tanggal_carian: data.tanggal_carian,
        tanggal_pengerjaan: data.tanggal_pengerjaan,
        nama: data.nama,
        posisi: data.posisi,
        tipe_lokasi: data.tipe_lokasi,
        zona: data.zona,
        batch_cluster,
        jumlah_output: parseInt(data.jumlah_output),
        catatan_tambahan: data.catatan_tambahan || '',
        status: data.status || 'approved'
      };
      const { error } = await supabase.from('submissions').insert([record]);
      if (error) {
        console.error('Supabase insertSubmission error:', error);
        throw error;
      }
      return record;
    } else {
      const db = load();
      const record = {
        ...data,
        batch_cluster: JSON.stringify(batch_cluster),
        status: data.status || 'approved',
        created_at: new Date().toISOString()
      };
      db.submissions.push(record);
      save(db);
      return record;
    }
  },

  async updateSubmissionStatus(id, status) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('submissions')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      if (error) {
        console.error('Supabase updateSubmissionStatus error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      const idx = db.submissions.findIndex(s => s.id === id);
      if (idx === -1) throw new Error('Submission tidak ditemukan');
      db.submissions[idx] = { ...db.submissions[idx], status, updated_at: new Date().toISOString() };
      save(db);
      return db.submissions[idx];
    }
  },

  async getPendingCount() {
    if (isSupabaseEnabled) {
      const { count, error } = await supabase
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) { console.error('Supabase getPendingCount error:', error); return 0; }
      return count || 0;
    } else {
      const db = load();
      return db.submissions.filter(s => s.status === 'pending').length;
    }
  },

  async insertFile(data) {
    if (isSupabaseEnabled) {
      const record = {
        id: data.id,
        submission_id: data.submission_id,
        filename: data.filename,
        original_name: data.original_name,
        file_path: data.file_path
      };
      const { error } = await supabase.from('files').insert([record]);
      if (error) {
        console.error('Supabase insertFile error:', error);
        throw error;
      }
      return record;
    } else {
      const db = load();
      const record = {
        ...data,
        created_at: new Date().toISOString()
      };
      db.files.push(record);
      save(db);
      return record;
    }
  },

  async getAllSubmissions() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('submissions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        console.error('Supabase getAllSubmissions error:', error);
        throw error;
      }
      return data.map(s => ({
        ...s,
        batch_cluster: typeof s.batch_cluster === 'string' ? s.batch_cluster : JSON.stringify(s.batch_cluster)
      }));
    } else {
      const db = load();
      return [...db.submissions].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      );
    }
  },

  async getSubmissionById(id) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('submissions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        console.error('Supabase getSubmissionById error:', error);
        throw error;
      }
      if (!data) return null;
      return {
        ...data,
        batch_cluster: typeof data.batch_cluster === 'string' ? data.batch_cluster : JSON.stringify(data.batch_cluster)
      };
    } else {
      const db = load();
      return db.submissions.find(s => s.id === id) || null;
    }
  },

  async getFilesBySubmissionId(submissionId) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .eq('submission_id', submissionId);
      if (error) {
        console.error('Supabase getFilesBySubmissionId error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      return db.files.filter(f => f.submission_id === submissionId);
    }
  },

  async deleteSubmission(id) {
    if (isSupabaseEnabled) {
      // Get all files related to this submission first so we can remove them from storage
      const { data: files, error: fileFetchError } = await supabase
        .from('files')
        .select('filename')
        .eq('submission_id', id);
      
      if (!fileFetchError && files && files.length > 0) {
        const filenames = files.map(f => f.filename);
        const { error: storageDeleteError } = await supabase.storage
          .from('lembar-register')
          .remove(filenames);
        if (storageDeleteError) console.error('Supabase Storage delete error:', storageDeleteError);
      }

      // Delete from DB (foreign key cascade or manual delete)
      const { error: err1 } = await supabase.from('files').delete().eq('submission_id', id);
      if (err1) console.error('Supabase delete files error:', err1);
      
      const { error: err2 } = await supabase.from('submissions').delete().eq('id', id);
      if (err2) {
        console.error('Supabase delete submission error:', err2);
        throw err2;
      }
    } else {
      const db = load();
      const files = db.files.filter(f => f.submission_id === id);
      
      // Hapus dari local disk
      files.forEach(file => {
        const filePath = path.join(__dirname, 'public', 'uploads', file.filename);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.error('Failed to delete local file:', e.message);
          }
        }
      });

      db.submissions = db.submissions.filter(s => s.id !== id);
      db.files = db.files.filter(f => f.submission_id !== id);
      save(db);
    }
  },

  async getStats() {
    if (isSupabaseEnabled) {
      const { data: allSubmissions, error } = await supabase
        .from('submissions')
        .select('posisi, created_at');
      if (error) {
        console.error('Supabase getStats error:', error);
        throw error;
      }
      
      const total = allSubmissions.length;
      const todayStr = new Date().toISOString().slice(0, 10);
      const today = allSubmissions.filter(s => s.created_at.startsWith(todayStr)).length;

      const byPosisiMap = {};
      allSubmissions.forEach(s => {
        byPosisiMap[s.posisi] = (byPosisiMap[s.posisi] || 0) + 1;
      });
      const byPosisi = Object.entries(byPosisiMap).map(([posisi, count]) => ({ posisi, count }));

      return { total, today, byPosisi };
    } else {
      const db = load();
      const total = db.submissions.length;
      const todayStr = new Date().toISOString().slice(0, 10);
      const today = db.submissions.filter(s => s.created_at.startsWith(todayStr)).length;

      const byPosisiMap = {};
      db.submissions.forEach(s => {
        byPosisiMap[s.posisi] = (byPosisiMap[s.posisi] || 0) + 1;
      });
      const byPosisi = Object.entries(byPosisiMap).map(([posisi, count]) => ({ posisi, count }));

      return { total, today, byPosisi };
    }
  },

  async saveUploadedFile(filename, buffer, mimeType) {
    // 1. Google Drive (jika terkonfigurasi)
    if (googleDrive.isConfigured()) {
      try {
        console.log(`[FileUpload] Uploading ${filename} to Google Drive...`);
        const driveRes = await googleDrive.uploadFileToDrive(filename, buffer, mimeType);
        return driveRes.viewLink;
      } catch (driveErr) {
        console.error('[FileUpload] Google Drive upload failed, falling back:', driveErr.message);
      }
    }

    // 2. Supabase Storage (cloud fallback)
    if (isSupabaseEnabled) {
      const { data, error } = await supabase.storage
        .from('lembar-register')
        .upload(filename, buffer, {
          contentType: mimeType,
          cacheControl: '3600',
          upsert: true
        });
      if (error) {
        console.error('Supabase Storage upload error:', error);
        throw error;
      }
      
      const { data: publicUrlData } = supabase.storage
        .from('lembar-register')
        .getPublicUrl(filename);
      
      return publicUrlData.publicUrl;
    }

    // 3. Local disk fallback
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buffer);
    return `/uploads/${filename}`;
  },

  // =============================================
  // DATA CARIAN — Kapasitas batch harian
  // =============================================

  /**
   * Insert satu record data carian
   * @param {object} data - { tanggal_carian, posisi, zona, batch, jumlah_toko, total_output, satuan }
   */
  async insertDataCarian(data) {
    if (isSupabaseEnabled) {
      const record = {
        id: data.id || uuidv4(),
        tanggal_carian: data.tanggal_carian,
        posisi: data.posisi,
        zona: data.zona,
        batch: data.batch,
        jumlah_toko: parseInt(data.jumlah_toko) || 0,
        total_output: parseInt(data.total_output),
        satuan: data.satuan || 'pcs'
      };
      const { error } = await supabase.from('data_carian').insert([record]);
      if (error) {
        console.error('Supabase insertDataCarian error:', error);
        throw error;
      }
      return record;
    } else {
      const db = load();
      const record = {
        id: data.id || uuidv4(),
        tanggal_carian: data.tanggal_carian,
        posisi: data.posisi,
        zona: data.zona,
        batch: data.batch,
        jumlah_toko: parseInt(data.jumlah_toko) || 0,
        total_output: parseInt(data.total_output),
        satuan: data.satuan || 'pcs',
        created_at: new Date().toISOString()
      };
      db.data_carian.push(record);
      save(db);
      return record;
    }
  },

  /**
   * Insert banyak record data carian sekaligus (bulk upsert)
   * OPTIMASI: gunakan Supabase native upsert (1 query) bukan loop N+1
   * Jika kombinasi (tanggal, posisi, zona, batch) sudah ada → update total_output
   */
  async bulkUpsertDataCarian(records) {
    if (records.length === 0) return [];

    if (isSupabaseEnabled) {
      // Supabase native upsert — 1 query saja, conflict pada unique key
      const rows = records.map(data => ({
        id: data.id || uuidv4(),
        tanggal_carian: data.tanggal_carian,
        posisi: data.posisi,
        zona: data.zona,
        batch: String(data.batch),
        jumlah_toko: parseInt(data.jumlah_toko) || 0,
        total_output: parseInt(data.total_output),
        satuan: data.satuan || 'pcs'
      }));

      const { data, error } = await supabase
        .from('data_carian')
        .upsert(rows, {
          onConflict: 'tanggal_carian,posisi,zona,batch',
          ignoreDuplicates: false
        })
        .select();

      if (error) {
        // Fallback ke loop jika upsert gagal (misal belum ada unique constraint)
        console.warn('Supabase bulk upsert gagal, fallback ke loop:', error.message);
        const results = [];
        for (const data of records) {
          const existing = await this.getDataCarianByKey(data.tanggal_carian, data.posisi, data.zona, data.batch);
          if (existing) {
            const updated = await this.updateDataCarian(existing.id, { jumlah_toko: data.jumlah_toko, total_output: data.total_output, satuan: data.satuan });
            results.push(updated);
          } else {
            const inserted = await this.insertDataCarian(data);
            results.push(inserted);
          }
        }
        return results;
      }
      return data || rows;
    } else {
      // Local mode: proses semua di memory, simpan sekali
      const db = load();
      const results = [];
      for (const data of records) {
        const idx = db.data_carian.findIndex(d =>
          d.tanggal_carian === data.tanggal_carian &&
          d.posisi === data.posisi &&
          d.zona === data.zona &&
          String(d.batch) === String(data.batch)
        );
        if (idx !== -1) {
          db.data_carian[idx] = { ...db.data_carian[idx], jumlah_toko: parseInt(data.jumlah_toko) || 0, total_output: parseInt(data.total_output), satuan: data.satuan, updated_at: new Date().toISOString() };
          results.push(db.data_carian[idx]);
        } else {
          const record = { id: uuidv4(), tanggal_carian: data.tanggal_carian, posisi: data.posisi, zona: data.zona, batch: String(data.batch), jumlah_toko: parseInt(data.jumlah_toko) || 0, total_output: parseInt(data.total_output), satuan: data.satuan || 'pcs', created_at: new Date().toISOString() };
          db.data_carian.push(record);
          results.push(record);
        }
      }
      save(db); // simpan sekali setelah semua diproses
      return results;
    }
  },

  /**
   * Ambil satu record berdasarkan kombinasi key unik
   */
  async getDataCarianByKey(tanggal_carian, posisi, zona, batch) {
    if (isSupabaseEnabled) {
      let zonesToSearch = [zona];
      if (posisi === 'Loader') {
        const norm = zona.trim().toUpperCase();
        if (norm.startsWith('F') || norm.includes('FREEZ')) {
          zonesToSearch = ['F1', 'FREEZER', 'FREZZER'];
        } else if (norm.startsWith('R') || norm.includes('CHILL')) {
          zonesToSearch = ['R1', 'R2', 'R3', 'CHILLER'];
        } else if (norm.startsWith('T') || norm.includes('AMBIE')) {
          zonesToSearch = ['T1', 'T2', 'T3', 'T4', 'T5', 'AMBIENT'];
        }
      }

      const { data, error } = await supabase
        .from('data_carian')
        .select('*')
        .eq('tanggal_carian', tanggal_carian)
        .eq('posisi', posisi)
        .in('zona', zonesToSearch)
        .eq('batch', batch)
        .limit(1);

      if (error) {
        console.error('Supabase getDataCarianByKey error:', error);
        throw error;
      }
      return (data && data[0]) || null;
    } else {
      const db = load();
      let zonesToSearch = [zona];
      if (posisi === 'Loader') {
        const norm = zona.trim().toUpperCase();
        if (norm.startsWith('F') || norm.includes('FREEZ')) {
          zonesToSearch = ['F1', 'FREEZER', 'FREZZER'];
        } else if (norm.startsWith('R') || norm.includes('CHILL')) {
          zonesToSearch = ['R1', 'R2', 'R3', 'CHILLER'];
        } else if (norm.startsWith('T') || norm.includes('AMBIE')) {
          zonesToSearch = ['T1', 'T2', 'T3', 'T4', 'T5', 'AMBIENT'];
        }
      }
      return db.data_carian.find(d =>
        d.tanggal_carian === tanggal_carian &&
        d.posisi === posisi &&
        zonesToSearch.includes(d.zona) &&
        String(d.batch) === String(batch)
      ) || null;
    }
  },

  /**
   * Ambil semua data carian, opsional filter per tanggal
   */
  async getDataCarian(tanggal_carian = null) {
    if (isSupabaseEnabled) {
      let query = supabase.from('data_carian').select('*').order('tanggal_carian', { ascending: false }).order('posisi').order('zona').order('batch');
      if (tanggal_carian) query = query.eq('tanggal_carian', tanggal_carian);
      const { data, error } = await query;
      if (error) {
        console.error('Supabase getDataCarian error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      let records = [...db.data_carian];
      if (tanggal_carian) records = records.filter(d => d.tanggal_carian === tanggal_carian);
      return records.sort((a, b) => {
        if (a.tanggal_carian !== b.tanggal_carian) return b.tanggal_carian.localeCompare(a.tanggal_carian);
        if (a.posisi !== b.posisi) return a.posisi.localeCompare(b.posisi);
        if (a.zona !== b.zona) return a.zona.localeCompare(b.zona);
        return String(a.batch).localeCompare(String(b.batch), undefined, { numeric: true });
      });
    }
  },

  /**
   * Update satu record data carian
   */
  async updateDataCarian(id, data) {
    if (isSupabaseEnabled) {
      const updates = {};
      if (data.total_output !== undefined) updates.total_output = parseInt(data.total_output);
      if (data.satuan !== undefined) updates.satuan = data.satuan;
      if (data.tanggal_carian !== undefined) updates.tanggal_carian = data.tanggal_carian;
      if (data.posisi !== undefined) updates.posisi = data.posisi;
      if (data.zona !== undefined) updates.zona = data.zona;
      if (data.batch !== undefined) updates.batch = data.batch;

      const { data: updated, error } = await supabase
        .from('data_carian')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) {
        console.error('Supabase updateDataCarian error:', error);
        throw error;
      }
      return updated;
    } else {
      const db = load();
      const idx = db.data_carian.findIndex(d => d.id === id);
      if (idx === -1) throw new Error('Record tidak ditemukan');
      db.data_carian[idx] = { ...db.data_carian[idx], ...data, updated_at: new Date().toISOString() };
      save(db);
      return db.data_carian[idx];
    }
  },

  /**
   * Hapus satu record data carian
   */
  async deleteDataCarian(id) {
    if (isSupabaseEnabled) {
      const { error } = await supabase.from('data_carian').delete().eq('id', id);
      if (error) {
        console.error('Supabase deleteDataCarian error:', error);
        throw error;
      }
    } else {
      const db = load();
      db.data_carian = db.data_carian.filter(d => d.id !== id);
      save(db);
    }
  },

  /**
   * Hapus semua data carian untuk tanggal tertentu
   */
  async deleteDataCarianByTanggal(tanggal_carian) {
    if (isSupabaseEnabled) {
      const { error } = await supabase.from('data_carian').delete().eq('tanggal_carian', tanggal_carian);
      if (error) {
        console.error('Supabase deleteDataCarianByTanggal error:', error);
        throw error;
      }
    } else {
      const db = load();
      db.data_carian = db.data_carian.filter(d => d.tanggal_carian !== tanggal_carian);
      save(db);
    }
  },

  /**
   * Hitung total output yang sudah disubmit untuk kombinasi tertentu
   * Untuk 1 batch yang dikerjakan banyak orang → total semua yang sudah submit
   */
  async getSubmittedOutputForBatch(tanggal_carian, posisi, zona, batch) {
    if (posisi === 'Loader') {
      const entries = await this.getAllLoaderEntries(tanggal_carian);
      let total = 0;
      
      let zonesToSearch = [zona];
      const norm = zona.trim().toUpperCase();
      if (norm.startsWith('F') || norm.includes('FREEZ')) {
        zonesToSearch = ['F1', 'FREEZER', 'FREZZER'];
      } else if (norm.startsWith('R') || norm.includes('CHILL')) {
        zonesToSearch = ['R1', 'R2', 'R3', 'CHILLER'];
      } else if (norm.startsWith('T') || norm.includes('AMBIE')) {
        zonesToSearch = ['T1', 'T2', 'T3', 'T4', 'T5', 'AMBIENT'];
      }

      for (const e of entries) {
        if (zonesToSearch.includes(e.zona)) {
          let clustersList = [];
          let clusterOutputs = {};
          if (Array.isArray(e.clusters)) {
            clustersList = e.clusters;
          } else if (e.clusters && typeof e.clusters === 'object') {
            clustersList = e.clusters.list || [];
            clusterOutputs = e.clusters.outputs || {};
          }

          if (clustersList.includes(batch)) {
            if (clusterOutputs[batch] !== undefined) {
              total += parseInt(clusterOutputs[batch]) || 0;
            } else {
              total += parseInt(e.jumlah_kontainer) || 0;
            }
          }
        }
      }
      return total;
    }

    if (isSupabaseEnabled) {
      // Ambil semua submission yang tanggal_carian sama, posisi sama, zona sama
      // dan batch ada di dalam batch_cluster mereka yang sudah disetujui (approved)
      const { data, error } = await supabase
        .from('submissions')
        .select('jumlah_output, batch_cluster')
        .eq('tanggal_carian', tanggal_carian)
        .eq('posisi', posisi)
        .eq('zona', zona)
        .eq('status', 'approved');
      if (error) {
        console.error('Supabase getSubmittedOutputForBatch error:', error);
        throw error;
      }
      let total = 0;
      for (const s of data) {
        const clusters = Array.isArray(s.batch_cluster)
          ? s.batch_cluster
          : JSON.parse(s.batch_cluster || '[]');
        if (clusters.includes(batch)) {
          // Jika karyawan ini memilih batch ini + mungkin batch lain,
          // output dihitung penuh (per submission, bukan dibagi per batch)
          total += parseInt(s.jumlah_output) || 0;
        }
      }
      return total;
    } else {
      const db = load();
      let total = 0;
      const relevantSubmissions = db.submissions.filter(s =>
        s.tanggal_carian === tanggal_carian &&
        s.posisi === posisi &&
        s.zona === zona &&
        s.status === 'approved'
      );
      for (const s of relevantSubmissions) {
        const clusters = JSON.parse(s.batch_cluster || '[]');
        if (clusters.includes(batch)) {
          total += parseInt(s.jumlah_output) || 0;
        }
      }
      return total;
    }
  },

  /**
   * Ambil kapasitas lengkap sebuah batch beserta yang sudah terpakai
   * Return: { total_output, satuan, sudah_diisi, sisa, ada_data_carian }
   */
  async getBatchCapacity(tanggal_carian, posisi, zona, batch) {
    const dataCarian = await this.getDataCarianByKey(tanggal_carian, posisi, zona, batch);
    if (!dataCarian) {
      // Coba cari posisi lain yang punya data untuk zona+batch yang sama
      const POSISI_LIST = ['Picker', 'Sorter', 'Loader'].filter(p => p !== posisi);
      let suggestionPosisi = null;
      for (const altPosisi of POSISI_LIST) {
        const alt = await this.getDataCarianByKey(tanggal_carian, altPosisi, zona, batch);
        if (alt) { suggestionPosisi = altPosisi; break; }
      }
      return {
        ada_data_carian: false,
        total_output: null,
        satuan: null,
        sudah_diisi: 0,
        sisa: null,
        suggestion_posisi: suggestionPosisi
      };
    }
    const sudah_diisi = await this.getSubmittedOutputForBatch(tanggal_carian, posisi, zona, batch);
    const sisa = Math.max(0, dataCarian.total_output - sudah_diisi);
    return {
      ada_data_carian: true,
      total_output: dataCarian.total_output,
      satuan: dataCarian.satuan,
      sudah_diisi,
      sisa
    };
  },

  /**
   * Ambil rekapitulasi semua batch untuk tanggal tertentu dengan status pengisian.
   * OPTIMASI: fetch semua submissions untuk tanggal itu dalam 1 query,
   * lalu hitung sudah_diisi per batch di memory (menghindari N+1 queries).
   */
  async getDataCarianWithStatus(tanggal_carian) {
    // Fetch data_carian records, semua submissions, dan semua loader entries sekaligus (3 queries total)
    const [records, allSubmissions, allLoaderEntries] = await Promise.all([
      this.getDataCarian(tanggal_carian),
      (async () => {
        if (isSupabaseEnabled) {
          const { data, error } = await supabase
            .from('submissions')
            .select('jumlah_output, batch_cluster, posisi, zona')
            .eq('tanggal_carian', tanggal_carian)
            .eq('status', 'approved');
          if (error) {
            console.error('Supabase getDataCarianWithStatus submissions error:', error);
            throw error;
          }
          return data;
        } else {
          const db = load();
          return db.submissions.filter(s => s.tanggal_carian === tanggal_carian && s.status === 'approved');
        }
      })(),
      this.getAllLoaderEntries(tanggal_carian)
    ]);

    // Bangun lookup map: "posisi|zona|batch" → total output yang sudah disubmit
    const submittedMap = {};
    for (const s of allSubmissions) {
      const clusters = Array.isArray(s.batch_cluster)
        ? s.batch_cluster
        : JSON.parse(s.batch_cluster || '[]');
      for (const batch of clusters) {
        const key = `${s.posisi}|${s.zona}|${batch}`;
        submittedMap[key] = (submittedMap[key] || 0) + (parseInt(s.jumlah_output) || 0);
      }
    }

    // Tambahkan rekap dari loader_entries ke submittedMap
    for (const le of allLoaderEntries) {
      let outputs = {};
      if (le.clusters && typeof le.clusters === 'object' && !Array.isArray(le.clusters)) {
        outputs = le.clusters.outputs || {};
      }
      
      for (const [groupMobil, qty] of Object.entries(outputs)) {
        const key = `Loader|${le.zona}|${groupMobil}`;
        submittedMap[key] = (submittedMap[key] || 0) + (parseInt(qty) || 0);
      }
    }

    // Gabungkan dengan data_carian records
    const result = [];
    for (const rec of records) {
      const key = `${rec.posisi}|${rec.zona}|${rec.batch}`;
      const sudah_diisi = submittedMap[key] || 0;
      const sisa = Math.max(0, rec.total_output - sudah_diisi);
      const persen = rec.total_output > 0 ? Math.min(100, Math.round((sudah_diisi / rec.total_output) * 100)) : 0;
      result.push({ ...rec, sudah_diisi, sisa, persen });
    }
    return result;
  },

  // =============================================
  // USER MANAGEMENT — Operasional Users (NIK-based)
  // =============================================

  /**
   * Create a new operational user (Picker / Sorter / Loader)
   * Login: username + nik (no bcrypt, plaintext NIK)
   */
  async createOperationalUser(data) {
    const { username, nama_lengkap, nik, posisi } = data;
    if (isSupabaseEnabled) {
      const record = {
        id: uuidv4(),
        username,
        nama_lengkap,
        password: bcrypt.hashSync('__operasional__', 10), // dummy, not used
        role: 'operasional',
        nik,
        posisi
      };
      const { error } = await supabase.from('users').insert([record]);
      if (error) { console.error('Supabase createOperationalUser error:', error); throw error; }
      return record;
    } else {
      const db = load();
      if (db.users.find(u => u.username === username)) {
        throw new Error(`Username "${username}" sudah digunakan.`);
      }
      const record = {
        id: uuidv4(),
        username,
        nama_lengkap,
        password: '__operasional__',
        role: 'operasional',
        nik,
        posisi,
        created_at: new Date().toISOString()
      };
      db.users.push(record);
      save(db);
      return record;
    }
  },

  /**
   * Get all operational users (role = operasional)
   */
  async getAllOperationalUsers() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('users').select('id,username,nama_lengkap,nik,posisi,role,created_at')
        .eq('role', 'operasional')
        .order('created_at', { ascending: false });
      if (error) { console.error('Supabase getAllOperationalUsers error:', error); throw error; }
      return data;
    } else {
      const db = load();
      return db.users
        .filter(u => u.role === 'operasional')
        .map(({ password, ...u }) => u) // strip password
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  /**
   * Delete a user by ID (only operational users can be deleted from here)
   */
  async deleteUser(id) {
    if (isSupabaseEnabled) {
      const { error } = await supabase.from('users').delete().eq('id', id).eq('role', 'operasional');
      if (error) { console.error('Supabase deleteUser error:', error); throw error; }
    } else {
      const db = load();
      db.users = db.users.filter(u => !(u.id === id && u.role === 'operasional'));
      save(db);
    }
  },

  /**
   * Update an operational user's data (Nama Lengkap, Username, NIK, Posisi)
   */
  async updateOperationalUser(id, data) {
    const { username, nama_lengkap, nik, posisi } = data;
    if (isSupabaseEnabled) {
      const updates = {
        username: username.trim(),
        nama_lengkap: nama_lengkap.trim(),
        nik: nik.trim(),
        posisi
      };
      const { data: updated, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', id)
        .eq('role', 'operasional')
        .select()
        .single();
      if (error) { console.error('Supabase updateOperationalUser error:', error); throw error; }
      return updated;
    } else {
      const db = load();
      const idx = db.users.findIndex(u => u.id === id && u.role === 'operasional');
      if (idx === -1) throw new Error('User tidak ditemukan.');
      // Check if username is already taken by another user
      const dup = db.users.find(u => u.username === username.trim() && u.id !== id);
      if (dup) {
        throw new Error(`Username "${username}" sudah digunakan oleh user lain.`);
      }
      db.users[idx] = {
        ...db.users[idx],
        username: username.trim(),
        nama_lengkap: nama_lengkap.trim(),
        nik: nik.trim(),
        posisi,
        updated_at: new Date().toISOString()
      };
      save(db);
      return db.users[idx];
    }
  },

  /**
   * Find user by username + NIK (for operasional login)
   */
  async getUserByUsernameAndNik(username, nik) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('users').select('*')
        .eq('username', username)
        .eq('nik', nik)
        .eq('role', 'operasional')
        .maybeSingle();
      if (error) { console.error('Supabase getUserByUsernameAndNik error:', error); throw error; }
      return data;
    } else {
      const db = load();
      return db.users.find(u =>
        u.username === username &&
        u.nik === nik &&
        u.role === 'operasional'
      ) || null;
    }
  },

  // =============================================
  // LOADER ENTRIES — Entry khusus Loader
  // =============================================

  async insertLoaderEntry(data) {
    const formattedClusters = (data.clusters && data.cluster_outputs)
      ? { list: data.clusters, outputs: data.cluster_outputs }
      : (Array.isArray(data.clusters) ? data.clusters : []);

    if (isSupabaseEnabled) {
      const record = {
        id: data.id || uuidv4(),
        tanggal_carian: data.tanggal_carian,
        tanggal_kirim: data.tanggal_kirim,
        nama: data.nama,
        zona: data.zona || '',
        no_polisi: data.no_polisi || '',
        clusters: formattedClusters,
        non_group: data.non_group || { gacoan: 0, dikichi: 0, benfarm: 0 },
        jumlah_kontainer: parseInt(data.jumlah_kontainer) || 0,
        catatan: data.catatan || ''
      };
      const { error } = await supabase.from('loader_entries').insert([record]);
      if (error) { console.error('Supabase insertLoaderEntry error:', error); throw error; }
      return record;
    } else {
      const db = load();
      const record = {
        id: data.id || uuidv4(),
        tanggal_carian: data.tanggal_carian,
        tanggal_kirim: data.tanggal_kirim,
        nama: data.nama,
        zona: data.zona || '',
        no_polisi: data.no_polisi || '',
        clusters: formattedClusters,
        non_group: data.non_group || { gacoan: 0, dikichi: 0, benfarm: 0 },
        jumlah_kontainer: parseInt(data.jumlah_kontainer) || 0,
        catatan: data.catatan || '',
        created_at: new Date().toISOString()
      };
      db.loader_entries.push(record);
      save(db);
      return record;
    }
  },

  async getAllLoaderEntries(tanggal_carian = null) {
    if (isSupabaseEnabled) {
      let query = supabase.from('loader_entries').select('*').order('created_at', { ascending: false });
      if (tanggal_carian) query = query.eq('tanggal_carian', tanggal_carian);
      const { data, error } = await query;
      if (error) { console.error('Supabase getAllLoaderEntries error:', error); throw error; }
      return data;
    } else {
      const db = load();
      let entries = [...db.loader_entries];
      if (tanggal_carian) entries = entries.filter(e => e.tanggal_carian === tanggal_carian);
      return entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  async getLoaderEntryById(id) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase.from('loader_entries').select('*').eq('id', id).maybeSingle();
      if (error) { console.error('Supabase getLoaderEntryById error:', error); throw error; }
      return data;
    } else {
      const db = load();
      return db.loader_entries.find(e => e.id === id) || null;
    }
  },

  async deleteLoaderEntry(id) {
    if (isSupabaseEnabled) {
      const { error } = await supabase.from('loader_entries').delete().eq('id', id);
      if (error) { console.error('Supabase deleteLoaderEntry error:', error); throw error; }
    } else {
      const db = load();
      db.loader_entries = db.loader_entries.filter(e => e.id !== id);
      save(db);
    }
  },

  async updateLoaderEntryCatatan(id, catatan) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('loader_entries')
        .update({ catatan })
        .eq('id', id)
        .select()
        .single();
      if (error) { console.error('Supabase updateLoaderEntryCatatan error:', error); throw error; }
      return data;
    } else {
      const db = load();
      const idx = db.loader_entries.findIndex(e => e.id === id);
      if (idx === -1) throw new Error('Entry loader tidak ditemukan');
      db.loader_entries[idx].catatan = catatan;
      db.loader_entries[idx].updated_at = new Date().toISOString();
      save(db);
      return db.loader_entries[idx];
    }
  }
};

