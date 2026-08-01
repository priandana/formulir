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
  console.log('âš¡ Supabase cloud database mode enabled!');
} else {
  console.log('ðŸ“ Local JSON database fallback enabled!');
}

const DB_FILE = path.join(__dirname, 'database.json');

// Default database structure
const defaultDb = {
  users: [],
  submissions: [],
  files: [],
  data_carian: [],
  loader_entries: [],
  toko_batch_data: [],
  audit_logs: [],
  qc_outbound: []
};

// Load database from file (local fallback)
function load() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      // Ensure collections exist for older databases
      if (!db.data_carian) db.data_carian = [];
      if (!db.loader_entries) db.loader_entries = [];
      if (!db.toko_batch_data) db.toko_batch_data = [];
      if (!db.audit_logs) db.audit_logs = [];
      if (!db.qc_outbound) db.qc_outbound = [];
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
    console.log('âœ… Default admin created: username=admin, password=admin123');
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
  supabase,

  async fetchAllRows(tableName, selectFields, addFiltersFn = null) {
    let allData = [];
    let start = 0;
    const limit = 1000;
    while (true) {
      let query = supabase
        .from(tableName)
        .select(selectFields)
        .range(start, start + limit - 1);
      
      if (addFiltersFn) {
        query = addFiltersFn(query);
      }
      
      const { data, error } = await query;
      if (error) {
        console.error(`fetchAllRows error on table ${tableName}:`, error);
        throw error;
      }
      if (!data || data.length === 0) break;
      allData = allData.concat(data);
      if (data.length < limit) break;
      start += limit;
    }
    return allData;
  },

  async getUserByUsername(username) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .ilike('username', username.trim())
        .maybeSingle();
      if (error) {
        console.error('Supabase getUserByUsername error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      const searchVal = username.trim().toLowerCase();
      return db.users.find(u => u.username.toLowerCase() === searchVal) || null;
    }
  },

  async getUserById(id) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        console.error('Supabase getUserById error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      return db.users.find(u => u.id === id) || null;
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

  async updateSubmission(id, data) {
    if (isSupabaseEnabled) {
      let batch_cluster = data.batch_cluster;
      if (typeof batch_cluster === 'string') {
        try { batch_cluster = JSON.parse(batch_cluster); } catch (e) { batch_cluster = []; }
      }
      const record = {
        tanggal_carian: data.tanggal_carian,
        tanggal_pengerjaan: data.tanggal_pengerjaan,
        posisi: data.posisi,
        tipe_lokasi: data.tipe_lokasi,
        zona: data.zona,
        batch_cluster,
        jumlah_output: parseInt(data.jumlah_output),
        catatan_tambahan: data.catatan_tambahan || '',
        status: data.status
      };
      const { data: updatedRecord, error } = await supabase
        .from('submissions')
        .update(record)
        .eq('id', id)
        .select()
        .single();
      if (error) {
        console.error('Supabase updateSubmission error:', error);
        throw error;
      }
      return {
        ...updatedRecord,
        batch_cluster: typeof updatedRecord.batch_cluster === 'string' ? updatedRecord.batch_cluster : JSON.stringify(updatedRecord.batch_cluster)
      };
    } else {
      const db = load();
      const idx = db.submissions.findIndex(s => s.id === id);
      if (idx === -1) throw new Error('Submission tidak ditemukan');
      let batch_cluster = data.batch_cluster;
      if (typeof batch_cluster === 'object') {
        batch_cluster = JSON.stringify(batch_cluster);
      }
      db.submissions[idx] = {
        ...db.submissions[idx],
        ...data,
        batch_cluster,
        updated_at: new Date().toISOString()
      };
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
        submission_id: data.submission_id || null,
        loader_entry_id: data.loader_entry_id || null,
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

  async getAllSubmissions(filters = {}) {
    if (isSupabaseEnabled) {
      // Gunakan pagination untuk ambil SEMUA data tanpa batas 1000 baris default Supabase
      const PAGE_SIZE = 1000;
      let allData = [];
      let from = 0;

      while (true) {
        let query = supabase
          .from('submissions')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (filters.status) {
          query = query.eq('status', filters.status);
        }
        if (filters.nama) {
          query = query.eq('nama', filters.nama);
        }

        if (filters.limit) {
          const offset = filters.offset || 0;
          query = query.range(offset, offset + filters.limit - 1);
          const { data, error } = await query;
          if (error) {
            console.error('Supabase getAllSubmissions with limit error:', error);
            throw error;
          }
          return data.map(s => ({
            ...s,
            batch_cluster: typeof s.batch_cluster === 'string' ? s.batch_cluster : JSON.stringify(s.batch_cluster)
          }));
        }

        const { data, error } = await query;
        if (error) {
          console.error('Supabase getAllSubmissions error:', error);
          throw error;
        }

        if (!data || data.length === 0) break;
        allData = allData.concat(data);

        // Jika hasil kurang dari PAGE_SIZE, berarti sudah halaman terakhir
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return allData.map(s => ({
        ...s,
        batch_cluster: typeof s.batch_cluster === 'string' ? s.batch_cluster : JSON.stringify(s.batch_cluster)
      }));
    } else {
      const db = load();
      let subs = [...db.submissions];
      if (filters.status) {
        subs = subs.filter(s => s.status === filters.status);
      }
      if (filters.nama) {
        subs = subs.filter(s => s.nama === filters.nama);
      }
      subs.sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      );

      if (filters.limit !== undefined) {
        const offset = filters.offset || 0;
        subs = subs.slice(offset, offset + filters.limit);
      }
      return subs;
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
        .or(`submission_id.eq.${submissionId},loader_entry_id.eq.${submissionId}`);
      if (error) {
        console.error('Supabase getFilesBySubmissionId error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      return db.files.filter(f => f.submission_id === submissionId || f.loader_entry_id === submissionId);
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
  // DATA CARIAN â€” Kapasitas batch harian
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
   * Jika kombinasi (tanggal, posisi, zona, batch) sudah ada â†’ update total_output
   */
  async bulkUpsertDataCarian(records) {
    if (records.length === 0) return [];

    if (isSupabaseEnabled) {
      // Supabase native upsert â€” 1 query saja, conflict pada unique key
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
          zonesToSearch = ['F1', 'FREEZER', 'FREZZER', 'LOADER'];
        } else if (norm.startsWith('R') || norm.includes('CHILL')) {
          zonesToSearch = ['R1', 'R2', 'R3', 'CHILLER', 'LOADER'];
        } else if (norm.startsWith('T') || norm.includes('AMBIE')) {
          zonesToSearch = ['T1', 'T2', 'T3', 'T4', 'T5', 'AMBIENT', 'LOADER'];
        } else {
          zonesToSearch = [zona, 'LOADER'];
        }
      }

      if (posisi === 'Loader') {
        const { data, error } = await supabase
          .from('data_carian')
          .select('*')
          .eq('tanggal_carian', tanggal_carian)
          .eq('posisi', posisi)
          .eq('batch', batch)
          .limit(1);
        if (error) {
          console.error('Supabase getDataCarianByKey Loader error:', error);
          throw error;
        }
        return (data && data[0]) || null;
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
          zonesToSearch = ['F1', 'FREEZER', 'FREZZER', 'LOADER'];
        } else if (norm.startsWith('R') || norm.includes('CHILL')) {
          zonesToSearch = ['R1', 'R2', 'R3', 'CHILLER', 'LOADER'];
        } else if (norm.startsWith('T') || norm.includes('AMBIE')) {
          zonesToSearch = ['T1', 'T2', 'T3', 'T4', 'T5', 'AMBIENT', 'LOADER'];
        } else {
          zonesToSearch = [zona, 'LOADER'];
        }
      }
      if (posisi === 'Loader') {
        return db.data_carian.find(d =>
          d.tanggal_carian === tanggal_carian &&
          d.posisi === posisi &&
          String(d.batch) === String(batch)
        ) || null;
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
   * Ambil satu record data carian berdasarkan ID
   */
  async getDataCarianById(id) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('data_carian')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        console.error('Supabase getDataCarianById error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      return db.data_carian.find(d => d.id === id) || null;
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
   * Untuk 1 batch yang dikerjakan banyak orang â†’ total semua yang sudah submit
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
    const capacities = await this.getMultipleBatchesCapacity(tanggal_carian, posisi, zona, [batch]);
    return capacities[batch];
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

    // Bangun lookup map: "posisi|zona|batch" â†’ total output yang sudah disubmit
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

    // Bangun lookup map: GM (batch) â†’ zona, dari data carian (posisi=Loader)
    // Ini diperlukan agar key submittedMap selalu cocok dengan data carian,
    // karena le.zona bisa berupa string gabungan (misal "AMBIENT, CHILLER")
    // ketika loader memuat GM dari beberapa zona sekaligus.
    const loaderGmZonaMap = {};
    for (const rec of records) {
      if (rec.posisi === 'Loader') {
        loaderGmZonaMap[String(rec.batch).trim()] = String(rec.zona).trim();
      }
    }

    // Tambahkan rekap dari loader_entries ke submittedMap
    for (const le of allLoaderEntries) {
      let outputs = {};
      if (le.clusters && typeof le.clusters === 'object' && !Array.isArray(le.clusters)) {
        outputs = le.clusters.outputs || {};
      }
      
      for (const [groupMobil, qty] of Object.entries(outputs)) {
        // Gunakan zona dari data carian (akurat per GM), bukan le.zona
        // yang bisa berupa string gabungan multi-zona
        const actualZona = loaderGmZonaMap[String(groupMobil).trim()] || le.zona;
        const key = `Loader|${actualZona}|${groupMobil}`;
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
  // USER MANAGEMENT â€” Operasional Users (NIK-based)
  // =============================================

  /**
   * Create a new operational user (Picker / Sorter / Loader)
   * Login: username + nik (no bcrypt, plaintext NIK)
   */
  async createOperationalUser(data) {
    const { username, nama_lengkap, nik, posisi, tipe_karyawan, nomor_hp } = data;
    if (isSupabaseEnabled) {
      const record = {
        id: uuidv4(),
        username,
        nama_lengkap,
        password: bcrypt.hashSync('__operasional__', 10), // dummy, not used
        role: 'operasional',
        nik,
        posisi,
        tipe_karyawan: tipe_karyawan || null,
        nomor_hp: nomor_hp || null
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
        tipe_karyawan: tipe_karyawan || null,
        nomor_hp: nomor_hp || null,
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
        .from('users').select('id,username,nama_lengkap,nik,posisi,role,tipe_karyawan,nomor_hp,created_at,is_active')
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
   * Toggle is_active status for an operational user (aktif <-> non-aktif)
   */
  async toggleUserStatus(id) {
    if (isSupabaseEnabled) {
      // First fetch current status
      const { data: current, error: fetchErr } = await supabase
        .from('users').select('is_active').eq('id', id).eq('role', 'operasional').maybeSingle();
      if (fetchErr) { console.error('Supabase toggleUserStatus fetch error:', fetchErr); throw fetchErr; }
      if (!current) throw new Error('User tidak ditemukan.');
      const newStatus = current.is_active === false ? true : false;
      const { data: updated, error } = await supabase
        .from('users').update({ is_active: newStatus }).eq('id', id).eq('role', 'operasional')
        .select('id,username,nama_lengkap,is_active').single();
      if (error) { console.error('Supabase toggleUserStatus update error:', error); throw error; }
      return updated;
    } else {
      const db = load();
      const idx = db.users.findIndex(u => u.id === id && u.role === 'operasional');
      if (idx === -1) throw new Error('User tidak ditemukan.');
      const current = db.users[idx].is_active;
      // Default is_active to true if undefined (legacy data)
      db.users[idx].is_active = current === false ? true : false;
      save(db);
      return { id, username: db.users[idx].username, nama_lengkap: db.users[idx].nama_lengkap, is_active: db.users[idx].is_active };
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
   * Update an operational user's data (Nama Lengkap, Username, NIK, Posisi, Tipe Karyawan)
   */
  async updateOperationalUser(id, data) {
    const { username, nama_lengkap, nik, posisi, tipe_karyawan, nomor_hp } = data;
    if (isSupabaseEnabled) {
      const updates = {
        username: username.trim(),
        nama_lengkap: nama_lengkap.trim(),
        nik: nik.trim(),
        posisi,
        tipe_karyawan: tipe_karyawan || null,
        nomor_hp: nomor_hp || null
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
        tipe_karyawan: tipe_karyawan || null,
        nomor_hp: nomor_hp || null,
        updated_at: new Date().toISOString()
      };
      save(db);
      return db.users[idx];
    }
  },

  /**
   * Get all admin users (tanpa password)
   */
  async getAllAdminUsers() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, nama_lengkap, allowed_pages, created_at')
        .eq('role', 'admin')
        .order('created_at', { ascending: true });
      if (error) { console.error('Supabase getAllAdminUsers error:', error); throw error; }
      return data || [];
    } else {
      const db = load();
      return db.users
        .filter(u => u.role === 'admin')
        .map(({ password, ...u }) => u)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
  },

  /**
   * Buat akun admin baru dengan password bcrypt dan daftar hak akses
   */
  async createAdminUser({ username, nama_lengkap, password, allowed_pages }) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const id = uuidv4();
    const created_at = new Date().toISOString();
    const pages = Array.isArray(allowed_pages) ? allowed_pages : [];

    if (isSupabaseEnabled) {
      const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
      if (existing) throw new Error('Username sudah digunakan oleh akun lain.');
      
      const record = { 
        id, 
        username, 
        nama_lengkap, 
        password: hashedPassword, 
        role: 'admin', 
        nik: null, 
        posisi: null, 
        created_at,
        allowed_pages: pages
      };
      
      const { error } = await supabase.from('users').insert([record]);
      if (error) {
        // Fallback jika kolom allowed_pages belum dibuat di Supabase
        if (error.message && error.message.includes('allowed_pages')) {
          console.warn('Kolom allowed_pages belum dibuat di Supabase. Menyimpan admin tanpa allowed_pages...');
          delete record.allowed_pages;
          const { error: retryError } = await supabase.from('users').insert([record]);
          if (retryError) { console.error('Supabase createAdminUser retry error:', retryError); throw retryError; }
        } else {
          console.error('Supabase createAdminUser error:', error);
          throw error;
        }
      }
      return { id, username, nama_lengkap, allowed_pages: record.allowed_pages || [], created_at };
    } else {
      const db = load();
      if (db.users.find(u => u.username === username)) throw new Error('Username sudah digunakan oleh akun lain.');
      const record = { id, username, nama_lengkap, password: hashedPassword, role: 'admin', nik: null, posisi: null, allowed_pages: pages, created_at };
      db.users.push(record);
      save(db);
      return { id, username, nama_lengkap, allowed_pages: pages, created_at };
    }
  },

  /**
   * Update hak akses (allowed_pages) untuk akun admin
   */
  async updateAdminPermissions(id, allowed_pages) {
    const pages = Array.isArray(allowed_pages) ? allowed_pages : [];
    if (isSupabaseEnabled) {
      const { error } = await supabase
        .from('users')
        .update({ allowed_pages: pages })
        .eq('id', id)
        .eq('role', 'admin');
      if (error) {
        console.error('Supabase updateAdminPermissions error:', error);
        throw error;
      }
      return { id, allowed_pages: pages };
    } else {
      const db = load();
      const idx = db.users.findIndex(u => u.id === id && u.role === 'admin');
      if (idx === -1) throw new Error('Akun admin tidak ditemukan.');
      db.users[idx].allowed_pages = pages;
      save(db);
      return { id, allowed_pages: pages };
    }
  },

  /**
   * Hapus akun admin berdasarkan ID
   */
  async deleteAdminUser(id) {
    if (isSupabaseEnabled) {
      const { error } = await supabase.from('users').delete().eq('id', id).eq('role', 'admin');
      if (error) { console.error('Supabase deleteAdminUser error:', error); throw error; }
    } else {
      const db = load();
      const idx = db.users.findIndex(u => u.id === id && u.role === 'admin');
      if (idx === -1) throw new Error('Akun admin tidak ditemukan.');
      db.users.splice(idx, 1);
      save(db);
    }
  },

  /**
   * Update password admin â€” verifikasi password lama dulu
   */
  async updateAdminPassword(id, currentPassword, newPassword) {
    if (isSupabaseEnabled) {
      const { data: user, error: fetchErr } = await supabase.from('users').select('*').eq('id', id).eq('role', 'admin').maybeSingle();
      if (fetchErr || !user) throw new Error('Akun admin tidak ditemukan.');
      if (!bcrypt.compareSync(currentPassword, user.password)) throw new Error('Password lama tidak cocok.');
      const hashed = bcrypt.hashSync(newPassword, 10);
      const { error } = await supabase.from('users').update({ password: hashed }).eq('id', id);
      if (error) { console.error('Supabase updateAdminPassword error:', error); throw error; }
    } else {
      const db = load();
      const user = db.users.find(u => u.id === id && u.role === 'admin');
      if (!user) throw new Error('Akun admin tidak ditemukan.');
      if (!bcrypt.compareSync(currentPassword, user.password)) throw new Error('Password lama tidak cocok.');
      user.password = bcrypt.hashSync(newPassword, 10);
      save(db);
    }
  },

  /**
   * Ganti password (NIK) user operasional â€” verifikasi password lama dulu
   */
  async changeUserNik(id, currentNik, newNik) {
    if (isSupabaseEnabled) {
      const { data: user, error: fetchErr } = await supabase
        .from('users').select('*').eq('id', id).eq('role', 'operasional').maybeSingle();
      if (fetchErr || !user) throw new Error('Akun tidak ditemukan.');
      if (user.nik !== currentNik.trim()) throw new Error('Password lama tidak cocok.');
      // Cek apakah password baru sudah dipakai
      const { data: dup } = await supabase.from('users').select('id').eq('nik', newNik.trim()).neq('id', id).maybeSingle();
      if (dup) throw new Error('Password baru sudah digunakan oleh akun lain.');
      const { error } = await supabase.from('users').update({ nik: newNik.trim() }).eq('id', id);
      if (error) { console.error('Supabase changeUserNik error:', error); throw error; }
    } else {
      const db = load();
      const user = db.users.find(u => u.id === id && u.role === 'operasional');
      if (!user) throw new Error('Akun tidak ditemukan.');
      if (user.nik !== currentNik.trim()) throw new Error('Password lama tidak cocok.');
      // Cek duplikat password baru
      const dup = db.users.find(u => u.nik === newNik.trim() && u.id !== id);
      if (dup) throw new Error('Password baru sudah digunakan oleh akun lain.');
      user.nik = newNik.trim();
      user.updated_at = new Date().toISOString();
      save(db);
    }
  },

  /**
   * Find user by username + NIK (for operasional login)
   */
  async getUserByUsernameAndNik(username, nik) {
    if (isSupabaseEnabled) {
      // Return user even if inactive so login can show specific message
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
  // LOADER ENTRIES â€” Entry khusus Loader
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
        cluster_outbound_outputs: data.cluster_outbound_outputs || {},
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
        cluster_outbound_outputs: data.cluster_outbound_outputs || {},
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
      // Gunakan pagination untuk ambil SEMUA data (bukan hanya 1000 baris default Supabase)
      const PAGE_SIZE = 1000;
      let allData = [];
      let from = 0;

      while (true) {
        let query = supabase
          .from('loader_entries')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (tanggal_carian) query = query.eq('tanggal_carian', tanggal_carian);

        const { data, error } = await query;
        if (error) { console.error('Supabase getAllLoaderEntries error:', error); throw error; }

        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return allData;
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
      if (db.files) {
        db.files = db.files.filter(f => f.loader_entry_id !== id);
      }
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
  },

  // =============================================
  // SITE SETTINGS â€” pengaturan halaman login dll.
  // =============================================

  DEFAULT_LOGIN_SETTINGS: {
    hero_headline_line1: 'Kerja Keras,',
    hero_headline_line2: 'Hasilkan Prestasi!',
    hero_description: 'Platform pencatatan pencapaian kerja yang mudah, cepat, dan akurat untuk tim SS08.',
    hero_quote: 'Disiplin adalah jembatan antara tujuan dan pencapaian.',
    hero_quote_author: 'â€” Jim Rohn',
    form_title: 'Selamat Datang! ðŸ‘‹',
    form_subtitle: 'Masuk untuk melanjutkan ke sistem pencapaian kerja SS08',
    footer_text: 'Â© 2026 SS08 Pencapaian Kerja. All rights reserved.'
  },

  async getLoginSettings() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'login_page')
        .maybeSingle();
      if (error) {
        console.warn('Supabase getLoginSettings error (returning defaults):', error.message);
        return this.DEFAULT_LOGIN_SETTINGS;
      }
      return data ? { ...this.DEFAULT_LOGIN_SETTINGS, ...data.value } : this.DEFAULT_LOGIN_SETTINGS;
    } else {
      const db = load();
      return db.login_settings ? { ...this.DEFAULT_LOGIN_SETTINGS, ...db.login_settings } : this.DEFAULT_LOGIN_SETTINGS;
    }
  },

  async saveLoginSettings(settings) {
    const merged = { ...this.DEFAULT_LOGIN_SETTINGS, ...settings };
    if (isSupabaseEnabled) {
      const { error } = await supabase
        .from('site_settings')
        .upsert({ key: 'login_page', value: merged }, { onConflict: 'key' });
      if (error) {
        console.error('Supabase saveLoginSettings error:', error);
        throw error;
      }
      return merged;
    } else {
      const db = load();
      db.login_settings = merged;
      save(db);
      return merged;
    }
  },

  DEFAULT_MAINTENANCE_SETTINGS: {
    active: false,
    title: 'Sistem Sedang Pemeliharaan',
    message: 'Kami sedang melakukan pembaruan sistem untuk meningkatkan performa dan kenyamanan Anda. Silakan coba beberapa saat lagi.',
    estimated_end: ''
  },

  async getMaintenanceSettings() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'maintenance')
        .maybeSingle();
      if (error) {
        console.warn('Supabase getMaintenanceSettings error (returning defaults):', error.message);
        return this.DEFAULT_MAINTENANCE_SETTINGS;
      }
      return data ? { ...this.DEFAULT_MAINTENANCE_SETTINGS, ...data.value } : this.DEFAULT_MAINTENANCE_SETTINGS;
    } else {
      const db = load();
      return db.maintenance_settings ? { ...this.DEFAULT_MAINTENANCE_SETTINGS, ...db.maintenance_settings } : this.DEFAULT_MAINTENANCE_SETTINGS;
    }
  },

  async saveMaintenanceSettings(settings) {
    const merged = { ...this.DEFAULT_MAINTENANCE_SETTINGS, ...settings };
    if (isSupabaseEnabled) {
      const { error } = await supabase
        .from('site_settings')
        .upsert({ key: 'maintenance', value: merged }, { onConflict: 'key' });
      if (error) {
        console.error('Supabase saveMaintenanceSettings error:', error);
        throw error;
      }
      return merged;
    } else {
      const db = load();
      db.maintenance_settings = merged;
      save(db);
      return merged;
    }
  },

  // =============================================
  // TOKO BATCH DATA â€” Per-store batch data from Excel upload
  // =============================================

  /**
   * Bulk insert per-toko batch records (from Lembar Fix Excel import)
   */
  async bulkInsertTokoData(records) {
    if (!records || records.length === 0) return [];
    if (isSupabaseEnabled) {
      const rows = records.map(r => ({
        id: uuidv4(),
        tanggal_carian: r.tanggal_carian,
        group_mob: r.group_mob || '',
        kcc: r.kcc || '',
        ins: r.ins || '',
        nama_toko: r.nama_toko,
        zona: r.zona,
        tipe_lokasi: r.tipe_lokasi || '',
        batch: r.batch || '',
        qty_target: parseInt(r.qty_target) || 0,
        kont_target: parseInt(r.kont_target) || 0,
      }));
      const { error } = await supabase.from('toko_batch_data').insert(rows);
      if (error) { console.error('Supabase bulkInsertTokoData error:', error); throw error; }
      return rows;
    } else {
      const db = load();
      const rows = records.map(r => ({
        id: uuidv4(),
        tanggal_carian: r.tanggal_carian,
        group_mob: r.group_mob || '',
        kcc: r.kcc || '',
        ins: r.ins || '',
        nama_toko: r.nama_toko,
        zona: r.zona,
        tipe_lokasi: r.tipe_lokasi || '',
        batch: r.batch || '',
        qty_target: parseInt(r.qty_target) || 0,
        kont_target: parseInt(r.kont_target) || 0,
        created_at: new Date().toISOString()
      }));
      if (!db.toko_batch_data) db.toko_batch_data = [];
      db.toko_batch_data.push(...rows);
      save(db);
      return rows;
    }
  },

  /**
   * Get all toko batch records for a given date
   */
  async getTokoData(tanggal_carian) {
    if (isSupabaseEnabled) {
      let allRows = [];
      let from = 0;
      const step = 1000;
      let hasMore = true;

      while (hasMore) {
        const to = from + step - 1;
        const { data, error } = await supabase
          .from('toko_batch_data')
          .select('*')
          .eq('tanggal_carian', tanggal_carian)
          .order('nama_toko', { ascending: true })
          .range(from, to);

        if (error) {
          console.error('Supabase getTokoData error:', error);
          throw error;
        }

        if (!data || data.length === 0) {
          hasMore = false;
        } else {
          allRows.push(...data);
          if (data.length < step) {
            hasMore = false;
          } else {
            from += step;
          }
        }
      }
      return allRows;
    } else {
      const db = load();
      return (db.toko_batch_data || [])
        .filter(r => r.tanggal_carian === tanggal_carian)
        .sort((a, b) => a.nama_toko.localeCompare(b.nama_toko));
    }
  },

  /**
   * Delete all toko batch data for a given date
   */
  async deleteTokoDataByTanggal(tanggal_carian) {
    if (isSupabaseEnabled) {
      const { error } = await supabase
        .from('toko_batch_data')
        .delete()
        .eq('tanggal_carian', tanggal_carian);
      if (error) { console.error('Supabase deleteTokoDataByTanggal error:', error); throw error; }
    } else {
      const db = load();
      db.toko_batch_data = (db.toko_batch_data || []).filter(r => r.tanggal_carian !== tanggal_carian);
      save(db);
    }
  },

  /**
   * Get toko data merged with actual submission quantities (per zona aggregated)
   * Returns per-toko records with actual_qty and actual_kont from submissions
   */
  async getTokoDataWithActual(tanggal_carian) {
    const [tokoRows, allSubmissions] = await Promise.all([
      this.getTokoData(tanggal_carian),
      (async () => {
        if (isSupabaseEnabled) {
          const { data, error } = await supabase
            .from('submissions')
            .select('jumlah_output, batch_cluster, posisi, zona')
            .eq('tanggal_carian', tanggal_carian)
            .eq('status', 'approved');
          if (error) { console.error('Supabase getTokoDataWithActual error:', error); throw error; }
          return data || [];
        } else {
          const db = load();
          return (db.submissions || []).filter(s => s.tanggal_carian === tanggal_carian && s.status !== 'rejected');
        }
      })()
    ]);

    // Build actual qty map: "zona|batch" â†’ { qty: total pcs from Picker, kont: total kont from Sorter }
    const actualMap = {};
    for (const s of allSubmissions) {
      const clusters = Array.isArray(s.batch_cluster)
        ? s.batch_cluster
        : (() => { try { return JSON.parse(s.batch_cluster || '[]'); } catch(e) { return []; } })();
      for (const batch of clusters) {
        const key = `${s.zona}|${batch}`;
        if (!actualMap[key]) actualMap[key] = { qty: 0, kont: 0 };
        if (s.posisi === 'Picker') actualMap[key].qty += (parseInt(s.jumlah_output) || 0);
        if (s.posisi === 'Sorter') actualMap[key].kont += (parseInt(s.jumlah_output) || 0);
      }
    }

    // Enrich toko rows with actual values
    return tokoRows.map(row => {
      const key = `${row.zona}|${row.batch}`;
      const actual = actualMap[key] || { qty: 0, kont: 0 };
      return {
        ...row,
        actual_qty: actual.qty,
        actual_kont: actual.kont
      };
    });
  },

  /**
   * Get list of dates that have toko batch data
   */
  async getTokoDataTanggalList() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('toko_batch_data')
        .select('tanggal_carian');
      if (error) { console.error('Supabase getTokoDataTanggalList error:', error); throw error; }
      const dates = [...new Set((data || []).map(r => r.tanggal_carian))].sort().reverse();
      return dates;
    } else {
      const db = load();
      const dates = [...new Set((db.toko_batch_data || []).map(r => r.tanggal_carian))].sort().reverse();
      return dates;
    }
  },

  /**
   * Insert new activity log to audit trail
   */
  async insertAuditLog(username, action, details = '') {
    const record = {
      username: username || 'system',
      action,
      details: typeof details === 'object' ? JSON.stringify(details) : String(details),
      created_at: new Date().toISOString()
    };
    if (isSupabaseEnabled) {
      const { error } = await supabase.from('audit_logs').insert([record]);
      if (error) { console.error('Supabase insertAuditLog error:', error); }
    } else {
      const db = load();
      db.audit_logs.push({
        id: uuidv4(),
        ...record
      });
      save(db);
    }
  },

  /**
   * Get paginated and searchable audit logs
   */
  async getAuditLogs(page = 1, limit = 50, search = '', actionType = '', adminUser = '', dateStart = '', dateEnd = '') {
    if (isSupabaseEnabled) {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' });
      
      // 1. Text Search
      if (search) {
        query = query.or(`username.ilike.%${search}%,action.ilike.%${search}%,details.ilike.%${search}%`);
      }
      
      // 2. Action Category Filter
      if (actionType) {
        if (actionType === 'auth') {
          query = query.in('action', ['LOGIN', 'LOGOUT', 'CHANGE_PASSWORD']);
        } else if (actionType === 'submissions') {
          query = query.in('action', ['UPDATE_SUBMISSION_STATUS', 'DELETE_SUBMISSION']);
        } else if (actionType === 'data_carian') {
          query = query.in('action', ['IMPORT_EXCEL_CARIAN', 'PUSH_GOOGLE_SHEETS_MANUAL', 'PUSH_GOOGLE_SHEETS_AUTO']);
        } else if (actionType === 'users') {
          query = query.in('action', ['CREATE_USER', 'DELETE_USER', 'UPDATE_USER', 'CREATE_ADMIN', 'UPDATE_ADMIN_PERMISSIONS', 'DELETE_ADMIN', 'TOGGLE_USER_STATUS']);
        } else if (actionType === 'absensi') {
          query = query.in('action', ['ABSENSI_ADD', 'ABSENSI_REMOVE', 'UPDATE_SETTINGS', 'UPDATE_MAINTENANCE_STATUS']);
        } else if (actionType === 'announcements') {
          query = query.in('action', ['CREATE_ANNOUNCEMENT', 'UPDATE_ANNOUNCEMENT', 'DELETE_ANNOUNCEMENT']);
        } else {
          query = query.eq('action', actionType);
        }
      }
      
      // 3. User Filter
      if (adminUser) {
        query = query.eq('username', adminUser);
      }
      
      // 4. Date Range Filter
      if (dateStart) {
        query = query.gte('created_at', `${dateStart}T00:00:00Z`);
      }
      if (dateEnd) {
        query = query.lte('created_at', `${dateEnd}T23:59:59Z`);
      }
      
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) { console.error('Supabase getAuditLogs error:', error); throw error; }
      return { logs: data || [], total: count || 0 };
    } else {
      const db = load();
      let logs = [...(db.audit_logs || [])];
      
      // 1. Text Search
      if (search) {
        const s = search.toLowerCase();
        logs = logs.filter(l =>
          (l.username || '').toLowerCase().includes(s) ||
          (l.action || '').toLowerCase().includes(s) ||
          (l.details || '').toLowerCase().includes(s)
        );
      }
      
      // 2. Action Category Filter
      if (actionType) {
        const authActions = ['LOGIN', 'LOGOUT', 'CHANGE_PASSWORD'];
        const subActions = ['UPDATE_SUBMISSION_STATUS', 'DELETE_SUBMISSION'];
        const dataActions = ['IMPORT_EXCEL_CARIAN', 'PUSH_GOOGLE_SHEETS_MANUAL', 'PUSH_GOOGLE_SHEETS_AUTO'];
        const userActions = ['CREATE_USER', 'DELETE_USER', 'UPDATE_USER', 'CREATE_ADMIN', 'UPDATE_ADMIN_PERMISSIONS', 'DELETE_ADMIN', 'TOGGLE_USER_STATUS'];
        const absActions = ['ABSENSI_ADD', 'ABSENSI_REMOVE', 'UPDATE_SETTINGS', 'UPDATE_MAINTENANCE_STATUS'];
        const annActions = ['CREATE_ANNOUNCEMENT', 'UPDATE_ANNOUNCEMENT', 'DELETE_ANNOUNCEMENT'];
        
        logs = logs.filter(l => {
          if (actionType === 'auth') return authActions.includes(l.action);
          if (actionType === 'submissions') return subActions.includes(l.action);
          if (actionType === 'data_carian') return dataActions.includes(l.action);
          if (actionType === 'users') return userActions.includes(l.action);
          if (actionType === 'absensi') return absActions.includes(l.action);
          if (actionType === 'announcements') return annActions.includes(l.action);
          return l.action === actionType;
        });
      }
      
      // 3. User Filter
      if (adminUser) {
        logs = logs.filter(l => l.username === adminUser);
      }
      
      // 4. Date Range Filter
      if (dateStart) {
        const start = new Date(`${dateStart}T00:00:00`);
        logs = logs.filter(l => new Date(l.created_at) >= start);
      }
      if (dateEnd) {
        const end = new Date(`${dateEnd}T23:59:59`);
        logs = logs.filter(l => new Date(l.created_at) <= end);
      }
      
      logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const total = logs.length;
      const from = (page - 1) * limit;
      const paginatedLogs = logs.slice(from, from + limit);
      return { logs: paginatedLogs, total };
    }
  },

  /**
   * Get list of unique admin users who have actions in audit trail
   */
  async getAuditLogUsers() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('username')
        .order('username');
      if (error) { console.error('Supabase getAuditLogUsers error:', error); throw error; }
      const usernames = [...new Set((data || []).map(d => d.username))];
      return usernames;
    } else {
      const db = load();
      const logs = db.audit_logs || [];
      const usernames = [...new Set(logs.map(l => l.username))];
      usernames.sort();
      return usernames;
    }
  },

  // =============================================
  // ABSENSI â€” Attendance management
  // =============================================

  DEFAULT_ABSENSI_SETTINGS: {
    absensi_required: false,
    absensi_visible_to_user: false
  },

  /**
   * Get attendance settings
   */
  async getAbsensiSettings() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'absensi_settings')
        .maybeSingle();
      if (error) {
        console.warn('Supabase getAbsensiSettings error (returning defaults):', error.message);
        return this.DEFAULT_ABSENSI_SETTINGS;
      }
      return data ? { ...this.DEFAULT_ABSENSI_SETTINGS, ...data.value } : this.DEFAULT_ABSENSI_SETTINGS;
    } else {
      const db = load();
      return db.absensi_settings ? { ...this.DEFAULT_ABSENSI_SETTINGS, ...db.absensi_settings } : this.DEFAULT_ABSENSI_SETTINGS;
    }
  },

  /**
   * Save attendance settings
   */
  async saveAbsensiSettings(settings) {
    const merged = { ...this.DEFAULT_ABSENSI_SETTINGS, ...settings };
    if (isSupabaseEnabled) {
      const { error } = await supabase
        .from('site_settings')
        .upsert({ key: 'absensi_settings', value: merged }, { onConflict: 'key' });
      if (error) { console.error('Supabase saveAbsensiSettings error:', error); throw error; }
      return merged;
    } else {
      const db = load();
      db.absensi_settings = merged;
      save(db);
      return merged;
    }
  },

  /**
   * Default PHL settings
   */
  DEFAULT_PHL_SETTINGS: {
    upah_harian: 0
  },

  /**
   * Get PHL daily rate settings
   */
  async getPhlSettings() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'phl_settings')
        .maybeSingle();
      if (error) {
        console.warn('Supabase getPhlSettings error (returning defaults):', error.message);
        return this.DEFAULT_PHL_SETTINGS;
      }
      return data ? { ...this.DEFAULT_PHL_SETTINGS, ...data.value } : this.DEFAULT_PHL_SETTINGS;
    } else {
      const db = load();
      return db.phl_settings ? { ...this.DEFAULT_PHL_SETTINGS, ...db.phl_settings } : this.DEFAULT_PHL_SETTINGS;
    }
  },

  /**
   * Save PHL daily rate settings
   */
  async savePhlSettings(settings) {
    const merged = { ...this.DEFAULT_PHL_SETTINGS, ...settings };
    if (isSupabaseEnabled) {
      const { error } = await supabase
        .from('site_settings')
        .upsert({ key: 'phl_settings', value: merged }, { onConflict: 'key' });
      if (error) { console.error('Supabase savePhlSettings error:', error); throw error; }
      return merged;
    } else {
      const db = load();
      db.phl_settings = merged;
      save(db);
      return merged;
    }
  },

  /**
   * Get active period start date (tutup buku)
   */
  async getPeriodeAktif() {
    const DEFAULT = { tanggal_mulai: null };
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'periode_aktif')
        .maybeSingle();
      if (error) { console.warn('Supabase getPeriodeAktif error:', error.message); return DEFAULT; }
      return data ? { ...DEFAULT, ...data.value } : DEFAULT;
    } else {
      const db = load();
      return db.periode_aktif ? { ...DEFAULT, ...db.periode_aktif } : DEFAULT;
    }
  },

  /**
   * Save active period start date (tutup buku)
   */
  async savePeriodeAktif(settings) {
    if (isSupabaseEnabled) {
      const { error } = await supabase
        .from('site_settings')
        .upsert({ key: 'periode_aktif', value: settings }, { onConflict: 'key' });
      if (error) { console.error('Supabase savePeriodeAktif error:', error); throw error; }
      return settings;
    } else {
      const db = load();
      db.periode_aktif = settings;
      save(db);
      return settings;
    }
  },

  /**
   * Get all attendance records for a given date, joined with user info
   */
  async getAbsensiByTanggal(tanggal) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('absensi')
        .select('id, tanggal, created_by, created_at, users(id, username, nama_lengkap, posisi, nik)')
        .eq('tanggal', tanggal)
        .order('created_at', { ascending: true });
      if (error) { console.error('Supabase getAbsensiByTanggal error:', error); throw error; }
      // Flatten user join
      return (data || []).map(r => ({
        id: r.id,
        tanggal: r.tanggal,
        created_by: r.created_by,
        created_at: r.created_at,
        user_id: r.users?.id,
        username: r.users?.username,
        nama_lengkap: r.users?.nama_lengkap,
        posisi: r.users?.posisi,
        nik: r.users?.nik
      }));
    } else {
      const db = load();
      const absensi = (db.absensi || []).filter(a => a.tanggal === tanggal);
      return absensi.map(a => {
        const user = db.users.find(u => u.id === a.user_id) || {};
        return {
          id: a.id,
          tanggal: a.tanggal,
          created_by: a.created_by,
          created_at: a.created_at,
          user_id: a.user_id,
          username: user.username,
          nama_lengkap: user.nama_lengkap,
          posisi: user.posisi,
          nik: user.nik
        };
      });
    }
  },

  /**
   * Check if a specific user is present (diabsen) for a given date
   */
  async isUserAbsen(tanggal, user_id) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('absensi')
        .select('id')
        .eq('tanggal', tanggal)
        .eq('user_id', user_id)
        .maybeSingle();
      if (error) { console.error('Supabase isUserAbsen error:', error); throw error; }
      return !!data;
    } else {
      const db = load();
      return (db.absensi || []).some(a => a.tanggal === tanggal && a.user_id === user_id);
    }
  },

  /**
   * Add a user to attendance for a given date
   */
  async addAbsensi(tanggal, user_id, created_by) {
    if (isSupabaseEnabled) {
      const record = { id: uuidv4(), tanggal, user_id, created_by };
      const { error } = await supabase.from('absensi').upsert([record], { onConflict: 'tanggal,user_id' });
      if (error) { console.error('Supabase addAbsensi error:', error); throw error; }
      return record;
    } else {
      const db = load();
      if (!db.absensi) db.absensi = [];
      // Check if already exists
      const exists = db.absensi.find(a => a.tanggal === tanggal && a.user_id === user_id);
      if (exists) return exists;
      const record = { id: uuidv4(), tanggal, user_id, created_by, created_at: new Date().toISOString() };
      db.absensi.push(record);
      save(db);
      return record;
    }
  },

  /**
   * Remove a user from attendance by absensi record ID
   */
  async removeAbsensi(id) {
    if (isSupabaseEnabled) {
      const { error } = await supabase.from('absensi').delete().eq('id', id);
      if (error) { console.error('Supabase removeAbsensi error:', error); throw error; }
    } else {
      const db = load();
      db.absensi = (db.absensi || []).filter(a => a.id !== id);
      save(db);
    }
  },

  /**
   * Get list of dates that have attendance records
   */
  async getAbsensiTanggalList() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase.from('absensi').select('tanggal');
      if (error) { console.error('Supabase getAbsensiTanggalList error:', error); throw error; }
      const dates = [...new Set((data || []).map(r => r.tanggal))].sort().reverse();
      return dates;
    } else {
      const db = load();
      const dates = [...new Set((db.absensi || []).map(r => r.tanggal))].sort().reverse();
      return dates;
    }
  },

  /**
   * Get attendance history for a specific user in a date range.
   * Returns: { user, tanggal_mulai, tanggal_akhir, hadir: ['2026-06-30',...], tidak_hadir: [...], total_hari, total_hadir, total_tidak_hadir }
   */
  async getAbsensiRiwayatUser(user_id, tanggal_mulai, tanggal_akhir) {
    // Generate all dates in range
    const allDates = [];
    const cur = new Date(tanggal_mulai + 'T00:00:00');
    const last = new Date(tanggal_akhir + 'T00:00:00');
    while (cur <= last) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      allDates.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }

    let hadirSet = new Set();
    let userData = null;

    if (isSupabaseEnabled) {
      // Fetch user info
      const { data: uData } = await supabase.from('users').select('id, nama_lengkap, username, posisi, nik').eq('id', user_id).maybeSingle();
      userData = uData;
      // Fetch absensi records for this user in range
      const { data: absensiData, error } = await supabase
        .from('absensi')
        .select('tanggal')
        .eq('user_id', user_id)
        .gte('tanggal', tanggal_mulai)
        .lte('tanggal', tanggal_akhir)
        .limit(5000);
      if (error) { console.error('getAbsensiRiwayatUser error:', error); throw error; }
      (absensiData || []).forEach(a => hadirSet.add(a.tanggal));
    } else {
      const dbData = load();
      const user = (dbData.users || []).find(u => u.id === user_id);
      userData = user || null;
      (dbData.absensi || [])
        .filter(a => a.user_id === user_id && a.tanggal >= tanggal_mulai && a.tanggal <= tanggal_akhir)
        .forEach(a => hadirSet.add(a.tanggal));
    }

    const hadir = allDates.filter(d => hadirSet.has(d));
    const tidak_hadir = allDates.filter(d => !hadirSet.has(d));

    return {
      user: userData,
      tanggal_mulai,
      tanggal_akhir,
      hadir,
      tidak_hadir,
      total_hari: allDates.length,
      total_hadir: hadir.length,
      total_tidak_hadir: tidak_hadir.length
    };
  },

  /**
   * Get attendance history for ALL active operasional users in a date range.
   * Returns: { tanggal_mulai, tanggal_akhir, total_hari, users: [{ user, hadir:[], tidak_hadir:[], total_hadir, total_tidak_hadir, pct }] }
   */
  async getAbsensiRiwayatSemuaUser(tanggal_mulai, tanggal_akhir) {
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
    const total_hari = allDates.length;

    if (isSupabaseEnabled) {
      // 1. Fetch all active operasional users
      const { data: usersData } = await supabase
        .from('users')
        .select('id, nama_lengkap, username, posisi, nik, tipe_karyawan')
        .eq('role', 'operasional')
        .eq('is_active', true)
        .order('nama_lengkap', { ascending: true });
      const users = usersData || [];

      // 2. Fetch ALL absensi records in range (single query, paginated)
      const absensiData = await this.fetchAllRows('absensi', 'user_id, tanggal', q =>
        q.gte('tanggal', tanggal_mulai).lte('tanggal', tanggal_akhir)
      );

      // Build map: user_id -> Set<tanggal>
      const absensiMap = {};
      (absensiData || []).forEach(a => {
        if (!absensiMap[a.user_id]) absensiMap[a.user_id] = new Set();
        absensiMap[a.user_id].add(a.tanggal);
      });

      // 3. Build result per user
      const result = users.map(u => {
        const hadirSet  = absensiMap[u.id] || new Set();
        const hadir     = allDates.filter(d => hadirSet.has(d));
        const tidak_hadir = allDates.filter(d => !hadirSet.has(d));
        const pct       = total_hari > 0 ? ((hadir.length / total_hari) * 100).toFixed(1) : '0';
        return { user: u, hadir, tidak_hadir, total_hadir: hadir.length, total_tidak_hadir: tidak_hadir.length, pct };
      });

      return { tanggal_mulai, tanggal_akhir, total_hari, allDates, users: result };
    } else {
      const dbData = load();
      const users  = (dbData.users || []).filter(u => u.role === 'operasional' && u.is_active !== false)
        .sort((a, b) => (a.nama_lengkap || a.username).localeCompare(b.nama_lengkap || b.username));
      const absensiMap = {};
      (dbData.absensi || [])
        .filter(a => a.tanggal >= tanggal_mulai && a.tanggal <= tanggal_akhir)
        .forEach(a => {
          if (!absensiMap[a.user_id]) absensiMap[a.user_id] = new Set();
          absensiMap[a.user_id].add(a.tanggal);
        });
      const result = users.map(u => {
        const hadirSet = absensiMap[u.id] || new Set();
        const hadir    = allDates.filter(d => hadirSet.has(d));
        const tidak_hadir = allDates.filter(d => !hadirSet.has(d));
        const pct = total_hari > 0 ? ((hadir.length / total_hari) * 100).toFixed(1) : '0';
        return { user: u, hadir, tidak_hadir, total_hadir: hadir.length, total_tidak_hadir: tidak_hadir.length, pct };
      });
      return { tanggal_mulai, tanggal_akhir, total_hari, allDates, users: result };
    }
  },

  /**
   * Get combined attendance and earnings data for HR payroll (penggajian) report.
   */
  async getRekapPenggajian(tanggalMulai, tanggalAkhir) {
    const [rekapPendapatan, rekapAbsensi, phlSettings] = await Promise.all([
      this.getRekapPendapatan(tanggalMulai, tanggalAkhir),
      this.getAbsensiRiwayatSemuaUser(tanggalMulai, tanggalAkhir),
      this.getPhlSettings()
    ]);
    const upahHarian = phlSettings.upah_harian || 0;

    // Merge attendance and revenue
    // Start with all active operasional users from attendance list
    const combined = rekapAbsensi.users.map(au => {
      const nameKey = String(au.user.nama_lengkap || au.user.username || '').toLowerCase().trim();
      // Find all matching revenue data for this user
      const matches = rekapPendapatan.pekerja.filter(p => 
        String(p.nama || '').toLowerCase().trim() === nameKey
      );

      let total_pencapaian = 0;
      let total_nilai = 0;
      let combined_zona_detail = [];

      matches.forEach(m => {
        total_pencapaian += m.total_pencapaian || 0;
        total_nilai += m.total_nilai || 0;
        if (Array.isArray(m.zona_detail)) {
          m.zona_detail.forEach(zd => {
            combined_zona_detail.push({ ...zd, posisi: m.posisi });
          });
        }
      });

      const userType = au.user.tipe_karyawan || 'Productivity';
      if (userType === 'PHL') {
        total_nilai = au.total_hadir * upahHarian;
      }

      return {
        user: au.user,
        total_hadir: au.total_hadir,
        total_tidak_hadir: au.total_tidak_hadir,
        attendance_pct: au.pct,
        total_pencapaian: total_pencapaian,
        pendapatan_carian: total_nilai,
        zona_detail: combined_zona_detail
      };
    });

    // Check if there are any workers in revenue data that were not in the active users list
    rekapPendapatan.pekerja.forEach(p => {
      const nameKey = String(p.nama || '').toLowerCase().trim();
      const existingIdx = combined.findIndex(c => String(c.user.nama_lengkap || c.user.username || '').toLowerCase().trim() === nameKey);
      if (existingIdx === -1) {
        const matches = rekapPendapatan.pekerja.filter(x => String(x.nama || '').toLowerCase().trim() === nameKey);
        let total_pencapaian = 0;
        let total_nilai = 0;
        let combined_zona_detail = [];
        matches.forEach(m => {
          total_pencapaian += m.total_pencapaian || 0;
          total_nilai += m.total_nilai || 0;
          if (Array.isArray(m.zona_detail)) {
            m.zona_detail.forEach(zd => {
              combined_zona_detail.push({ ...zd, posisi: m.posisi });
            });
          }
        });

        combined.push({
          user: { nama_lengkap: p.nama, posisi: p.posisi, username: p.nama },
          total_hadir: 0,
          total_tidak_hadir: 0,
          attendance_pct: '0.0',
          total_pencapaian: total_pencapaian,
          pendapatan_carian: total_nilai,
          zona_detail: combined_zona_detail
        });
      }
    });

    return {
      tanggal_mulai: tanggalMulai,
      tanggal_akhir: tanggalAkhir,
      total_hari: rekapAbsensi.total_hari,
      pekerja: combined
    };
  },

  /**
   * Get detailed approved submissions and loader entries in date range.
   */
  async getDetailSubmissionsAndLoader(tanggalMulai, tanggalAkhir) {
    const zonaToKategori = (zona) => {
      const z = String(zona || '').trim().toUpperCase();
      if (z.startsWith('F')) return 'FREEZER';
      if (z.startsWith('R')) return 'CHILLER';
      if (z.startsWith('T')) return 'AMBIENT';
      return zona;
    };

    if (isSupabaseEnabled) {
      const [subData, loaderData, { data: hargaData }] = await Promise.all([
        this.fetchAllRows('submissions', 'nama, posisi, zona, jumlah_output, tanggal_carian', q =>
          q.gte('tanggal_carian', tanggalMulai).lte('tanggal_carian', tanggalAkhir).eq('status', 'approved')
        ),
        this.fetchAllRows('loader_entries', 'nama, jumlah_kontainer, tanggal_carian', q =>
          q.gte('tanggal_carian', tanggalMulai).lte('tanggal_carian', tanggalAkhir)
        ),
        supabase.from('ketentuan_harga').select('*')
      ]);

      const hargaMap = {};
      (hargaData || []).forEach(h => { hargaMap[`${h.posisi}|${h.zona}`] = h; });

      const details = [];

      (subData || []).forEach(s => {
        const hargaKey  = `${s.posisi}|${s.zona}`;
        const hargaKeyK = `${s.posisi}|${zonaToKategori(s.zona)}`;
        const h = hargaMap[hargaKey] || hargaMap[hargaKeyK] || null;
        const jml = parseInt(s.jumlah_output) || 0;
        const hargaVal = h ? h.harga : 0;
        const total = jml * hargaVal;
        details.push({
          nama: s.nama,
          posisi: s.posisi,
          tanggal: s.tanggal_carian,
          item: s.zona || '-',
          jumlah: jml,
          satuan: h ? h.satuan : 'output',
          harga: hargaVal,
          total_nilai: total
        });
      });

      (loaderData || []).forEach(l => {
        const loaderH = hargaMap['Loader|AMBIENT, CHILLER, FREEZER'] || hargaMap['Loader|LOADER'] || null;
        const jml = parseInt(l.jumlah_kontainer) || 0;
        const hargaVal = loaderH ? loaderH.harga : 0;
        const total = jml * hargaVal;
        details.push({
          nama: l.nama,
          posisi: 'Loader',
          tanggal: l.tanggal_carian,
          item: 'AMBIENT, CHILLER, FREEZER',
          jumlah: jml,
          satuan: loaderH ? loaderH.satuan : 'kontainer',
          harga: hargaVal,
          total_nilai: total
        });
      });

      return details.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.nama.localeCompare(b.nama));
    } else {
      const dbData = load();
      const subData = (dbData.submissions || []).filter(s => {
        const tgl = s.tanggal_carian;
        return tgl >= tanggalMulai && tgl <= tanggalAkhir && s.status === 'approved';
      });
      const loaderData = (dbData.loader_entries || []).filter(l => {
        const tgl = l.tanggal_carian;
        return tgl >= tanggalMulai && tgl <= tanggalAkhir;
      });
      const hargaData = dbData.ketentuan_harga || [];

      const hargaMap = {};
      hargaData.forEach(h => { hargaMap[`${h.posisi}|${h.zona}`] = h; });

      const details = [];

      subData.forEach(s => {
        const hargaKey  = `${s.posisi}|${s.zona}`;
        const hargaKeyK = `${s.posisi}|${zonaToKategori(s.zona)}`;
        const h = hargaMap[hargaKey] || hargaMap[hargaKeyK] || null;
        const jml = parseInt(s.jumlah_output) || 0;
        const hargaVal = h ? h.harga : 0;
        const total = jml * hargaVal;
        details.push({
          nama: s.nama,
          posisi: s.posisi,
          tanggal: s.tanggal_carian,
          item: s.zona || '-',
          jumlah: jml,
          satuan: h ? h.satuan : 'output',
          harga: hargaVal,
          total_nilai: total
        });
      });

      loaderData.forEach(l => {
        const loaderH = hargaMap['Loader|AMBIENT, CHILLER, FREEZER'] || hargaMap['Loader|LOADER'] || null;
        const jml = parseInt(l.jumlah_kontainer) || 0;
        const hargaVal = loaderH ? loaderH.harga : 0;
        const total = jml * hargaVal;
        details.push({
          nama: l.nama,
          posisi: 'Loader',
          tanggal: l.tanggal_carian,
          item: 'AMBIENT, CHILLER, FREEZER',
          jumlah: jml,
          satuan: loaderH ? loaderH.satuan : 'kontainer',
          harga: hargaVal,
          total_nilai: total
        });
      });

      return details.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.nama.localeCompare(b.nama));
    }
  },

  // ==================== ANNOUNCEMENTS ====================

  async getActiveAnnouncements() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) { console.error('getActiveAnnouncements error:', error); return []; }
      return data || [];
    } else {
      const db = load();
      return (db.announcements || []).filter(a => a.is_active !== false);
    }
  },

  async getAllAnnouncements() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) { console.error('getAllAnnouncements error:', error); return []; }
      return data || [];
    } else {
      const db = load();
      return (db.announcements || []);
    }
  },

  async createAnnouncement({ title, content, type, emoji, imageUrl, created_by }) {
    const record = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(),
      title: title || '',
      content: content || '',
      type: type || 'info',
      emoji: emoji || 'ðŸ“¢',
      image_url: imageUrl || '',
      is_active: true,
      created_by: created_by || 'admin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (isSupabaseEnabled) {
      try {
        const { data, error } = await supabase.from('announcements').insert([record]).select().single();
        if (error) throw error;
        return data;
      } catch (err) {
        console.error('createAnnouncement Supabase error, falling back without image_url:', err.message);
        const recordFallback = { ...record };
        delete recordFallback.image_url;
        const { data, error } = await supabase.from('announcements').insert([recordFallback]).select().single();
        if (error) { console.error('createAnnouncement fallback error:', error); throw error; }
        return { ...data, image_url: record.image_url };
      }
    } else {
      const db = load();
      if (!db.announcements) db.announcements = [];
      db.announcements.unshift(record);
      save(db);
      return record;
    }
  },

  async updateAnnouncement(id, { title, content, type, emoji, is_active, imageUrl }) {
    const updates = {
      ...(title     !== undefined && { title }),
      ...(content   !== undefined && { content }),
      ...(type      !== undefined && { type }),
      ...(emoji     !== undefined && { emoji }),
      ...(is_active !== undefined && { is_active }),
      ...(imageUrl  !== undefined && { image_url: imageUrl }),
      updated_at: new Date().toISOString()
    };
    if (isSupabaseEnabled) {
      try {
        const { data, error } = await supabase.from('announcements').update(updates).eq('id', id).select().single();
        if (error) throw error;
        return data;
      } catch (err) {
        console.error('updateAnnouncement Supabase error, falling back without image_url:', err.message);
        const updatesFallback = { ...updates };
        delete updatesFallback.image_url;
        const { data, error } = await supabase.from('announcements').update(updatesFallback).eq('id', id).select().single();
        if (error) { console.error('updateAnnouncement fallback error:', error); throw error; }
        return { ...data, image_url: updates.image_url };
      }
    } else {
      const db = load();
      const idx = (db.announcements || []).findIndex(a => a.id === id);
      if (idx === -1) throw new Error('Announcement not found');
      db.announcements[idx] = { ...db.announcements[idx], ...updates };
      save(db);
      return db.announcements[idx];
    }
  },

  async deleteAnnouncement(id) {
    if (isSupabaseEnabled) {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) { console.error('deleteAnnouncement error:', error); throw error; }
    } else {
      const db = load();
      db.announcements = (db.announcements || []).filter(a => a.id !== id);
      save(db);
    }
  },

  async toggleAnnouncement(id) {
    if (isSupabaseEnabled) {
      const { data: cur, error: e1 } = await supabase.from('announcements').select('is_active').eq('id', id).single();
      if (e1) throw e1;
      const { data, error } = await supabase.from('announcements')
        .update({ is_active: !cur.is_active, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    } else {
      const db = load();
      const ann = (db.announcements || []).find(a => a.id === id);
      if (!ann) throw new Error('Announcement not found');
      ann.is_active = !ann.is_active;
      ann.updated_at = new Date().toISOString();
      save(db);
      return ann;
    }
  },

  async getAllFiles() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('files')
        .select('*');
      if (error) {
        console.error('Supabase getAllFiles error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      return db.files || [];
    }
  },

  async getMultipleBatchesCapacity(tanggal_carian, posisi, zona, batches) {
    const isLoader = posisi === 'Loader';
    
    // Ambil data carian, submissions, dan loader entries secara parallel (max 3 query)
    const [carianList, submissionsList, loaderList] = await Promise.all([
      this.getDataCarian(tanggal_carian),
      (async () => {
        if (isSupabaseEnabled) {
          const { data, error } = await supabase
            .from('submissions')
            .select('jumlah_output, batch_cluster, posisi, zona')
            .eq('tanggal_carian', tanggal_carian)
            .eq('posisi', posisi)
            .eq('zona', zona)
            .eq('status', 'approved');
          if (error) {
            console.error('Supabase getMultipleBatchesCapacity submissions error:', error);
            throw error;
          }
          return data || [];
        } else {
          const db = load();
          return db.submissions.filter(s =>
            s.tanggal_carian === tanggal_carian &&
            s.posisi === posisi &&
            s.zona === zona &&
            s.status === 'approved'
          );
        }
      })(),
      isLoader ? this.getAllLoaderEntries(tanggal_carian) : Promise.resolve([])
    ]);

    // Helper untuk zone mapping (Loader menggunakan cluster name seperti Freezer/Chiller/Ambient)
    const getZoneSearchList = (pos, z) => {
      let zones = [z];
      if (pos === 'Loader') {
        const norm = z.trim().toUpperCase();
        if (norm.startsWith('F') || norm.includes('FREEZ')) {
          zones = ['F1', 'FREEZER', 'FREZZER', 'LOADER'];
        } else if (norm.startsWith('R') || norm.includes('CHILL')) {
          zones = ['R1', 'R2', 'R3', 'CHILLER', 'LOADER'];
        } else if (norm.startsWith('T') || norm.includes('AMBIE')) {
          zones = ['T1', 'T2', 'T3', 'T4', 'T5', 'AMBIENT', 'LOADER'];
        } else {
          zones = [z, 'LOADER'];
        }
      }
      return zones;
    };

    // Helper untuk cari data carian di memory list
    const findCarianInMemory = (pos, z, b) => {
      if (pos === 'Loader') {
        return carianList.find(c =>
          c.posisi === pos &&
          String(c.batch).trim() === String(b).trim()
        ) || null;
      }
      const zones = getZoneSearchList(pos, z);
      return carianList.find(c =>
        c.posisi === pos &&
        zones.some(zoneName => zoneName.trim().toUpperCase() === c.zona.trim().toUpperCase()) &&
        String(c.batch).trim() === String(b).trim()
      ) || null;
    };

    // Hitung output yang sudah diisi per batch
    const submittedMap = {};
    if (isLoader) {
      for (const e of loaderList) {
        let clustersList = [];
        let clusterOutputs = {};
        if (Array.isArray(e.clusters)) {
          clustersList = e.clusters;
        } else if (e.clusters && typeof e.clusters === 'object') {
          clustersList = e.clusters.list || [];
          clusterOutputs = e.clusters.outputs || {};
        }
        for (const b of batches) {
          if (clustersList.includes(b)) {
            const val = clusterOutputs[b] !== undefined
              ? (parseInt(clusterOutputs[b]) || 0)
              : (parseInt(e.jumlah_kontainer) || 0);
            submittedMap[b] = (submittedMap[b] || 0) + val;
          }
        }
      }
    } else {
      for (const s of submissionsList) {
        const clusters = Array.isArray(s.batch_cluster)
          ? s.batch_cluster
          : JSON.parse(s.batch_cluster || '[]');
        for (const b of clusters) {
          submittedMap[b] = (submittedMap[b] || 0) + (parseInt(s.jumlah_output) || 0);
        }
      }
    }

    const results = {};
    for (const b of batches) {
      const dataCarian = findCarianInMemory(posisi, zona, b);
      if (!dataCarian) {
        const POSISI_LIST = ['Picker', 'Sorter', 'Loader'].filter(p => p !== posisi);
        let suggestionPosisi = null;
        for (const altPosisi of POSISI_LIST) {
          const alt = findCarianInMemory(altPosisi, zona, b);
          if (alt) { suggestionPosisi = altPosisi; break; }
        }
        results[b] = {
          ada_data_carian: false,
          total_output: null,
          satuan: null,
          sudah_diisi: 0,
          sisa: null,
          suggestion_posisi: suggestionPosisi
        };
      } else {
        const sudah_diisi = submittedMap[b] || 0;
        const sisa = Math.max(0, dataCarian.total_output - sudah_diisi);
        results[b] = {
          ada_data_carian: true,
          total_output: dataCarian.total_output,
          satuan: dataCarian.satuan,
          sudah_diisi,
          sisa
        };
      }
    }

    return results;
  },

  // ============= KETENTUAN HARGA =============

  async getKetentuanHarga() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('ketentuan_harga')
        .select('*')
        .order('posisi', { ascending: true })
        .order('zona', { ascending: true });
      if (error) { console.error('Supabase getKetentuanHarga error:', error); throw error; }
      return data || [];
    } else {
      const db = load();
      return (db.ketentuan_harga || []).sort((a, b) => a.posisi.localeCompare(b.posisi) || a.zona.localeCompare(b.zona));
    }
  },

  async getKetentuanHargaByKey(posisi, zona) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('ketentuan_harga')
        .select('*')
        .eq('posisi', posisi)
        .eq('zona', zona)
        .maybeSingle();
      if (error) { console.error('Supabase getKetentuanHargaByKey error:', error); throw error; }
      return data || null;
    } else {
      const db = load();
      return (db.ketentuan_harga || []).find(h => h.posisi === posisi && h.zona === zona) || null;
    }
  },

  async insertKetentuanHarga({ posisi, zona, harga, satuan, keterangan }) {
    const now = new Date().toISOString();
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('ketentuan_harga')
        .insert([{ posisi, zona, harga: parseFloat(harga) || 0, satuan, keterangan: keterangan || null }])
        .select()
        .single();
      if (error) { console.error('Supabase insertKetentuanHarga error:', error); throw error; }
      return data;
    } else {
      const db = load();
      if (!db.ketentuan_harga) db.ketentuan_harga = [];
      const existing = db.ketentuan_harga.find(h => h.posisi === posisi && h.zona === zona);
      if (existing) throw new Error('Harga untuk kombinasi posisi dan zona ini sudah ada.');
      const record = { id: uuidv4(), posisi, zona, harga: parseFloat(harga) || 0, satuan, keterangan: keterangan || null, created_at: now, updated_at: now };
      db.ketentuan_harga.push(record);
      save(db);
      return record;
    }
  },

  async updateKetentuanHarga(id, { harga, keterangan }) {
    const now = new Date().toISOString();
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('ketentuan_harga')
        .update({ harga: parseFloat(harga) || 0, keterangan: keterangan || null, updated_at: now })
        .eq('id', id)
        .select()
        .single();
      if (error) { console.error('Supabase updateKetentuanHarga error:', error); throw error; }
      return data;
    } else {
      const db = load();
      if (!db.ketentuan_harga) db.ketentuan_harga = [];
      const idx = db.ketentuan_harga.findIndex(h => h.id === id);
      if (idx === -1) throw new Error('Ketentuan harga tidak ditemukan.');
      db.ketentuan_harga[idx] = { ...db.ketentuan_harga[idx], harga: parseFloat(harga) || 0, keterangan: keterangan || null, updated_at: now };
      save(db);
      return db.ketentuan_harga[idx];
    }
  },

  async deleteKetentuanHarga(id) {
    if (isSupabaseEnabled) {
      const { error } = await supabase.from('ketentuan_harga').delete().eq('id', id);
      if (error) { console.error('Supabase deleteKetentuanHarga error:', error); throw error; }
      return true;
    } else {
      const db = load();
      if (!db.ketentuan_harga) db.ketentuan_harga = [];
      const idx = db.ketentuan_harga.findIndex(h => h.id === id);
      if (idx === -1) throw new Error('Ketentuan harga tidak ditemukan.');
      db.ketentuan_harga.splice(idx, 1);
      save(db);
      return true;
    }
  },

  // ============= REKAP PENDAPATAN =============

  async getRekapPendapatan(tanggalMulai, tanggalAkhir) {
    if (!tanggalAkhir) tanggalAkhir = tanggalMulai;

    // Helper: zona code â†’ kategori harga
    const zonaToKategori = (zona) => {
      const z = String(zona || '').trim().toUpperCase();
      if (z.startsWith('F')) return 'FREEZER';
      if (z.startsWith('R')) return 'CHILLER';
      if (z.startsWith('T')) return 'AMBIENT';
      return zona;
    };

    // Load all users to get tipe_karyawan mapping
    let userTipeMap = {};
    try {
      if (isSupabaseEnabled) {
        const { data: users } = await supabase.from('users').select('nama_lengkap, username, tipe_karyawan');
        (users || []).forEach(u => {
          const key = String(u.nama_lengkap || u.username || '').toLowerCase().trim();
          userTipeMap[key] = u.tipe_karyawan || 'Productivity';
        });
      } else {
        const db = load();
        (db.users || []).forEach(u => {
          const key = String(u.nama_lengkap || u.username || '').toLowerCase().trim();
          userTipeMap[key] = u.tipe_karyawan || 'Productivity';
        });
      }
    } catch (e) {
      console.warn('Gagal memuat mapping tipe karyawan:', e.message);
    }

    let result = { pekerja: [], grand_total: 0, total_by_posisi: { picker: 0, sorter: 0, loader: 0 }, leaderboard: [] };

    if (isSupabaseEnabled) {
      // CATATAN: .limit(10000) wajib â€” Supabase default hanya 1000 rows
      const [subData, loaderData, { data: hargaData }] = await Promise.all([
        this.fetchAllRows('submissions', 'nama, posisi, zona, jumlah_output, tanggal_carian', q =>
          q.gte('tanggal_carian', tanggalMulai).lte('tanggal_carian', tanggalAkhir).eq('status', 'approved')
        ),
        this.fetchAllRows('loader_entries', 'nama, jumlah_kontainer, tanggal_carian', q =>
          q.gte('tanggal_carian', tanggalMulai).lte('tanggal_carian', tanggalAkhir)
        ),
        supabase.from('ketentuan_harga').select('*')
      ]);

      const hargaMap = {};
      (hargaData || []).forEach(h => { hargaMap[`${h.posisi}|${h.zona}`] = h; });

      // Aggregate Picker & Sorter per nama+posisi (cross-zona)
      const subAgg = {};
      (subData || []).forEach(s => {
        const key = `${s.nama}|${s.posisi}`;
        if (!subAgg[key]) subAgg[key] = { nama: s.nama, posisi: s.posisi, total_pencapaian: 0, total_nilai: 0, zona_detail: {} };
        const hargaKey  = `${s.posisi}|${s.zona}`;
        const hargaKeyK = `${s.posisi}|${zonaToKategori(s.zona)}`;
        const h = hargaMap[hargaKey] || hargaMap[hargaKeyK] || null;
        const jml = parseInt(s.jumlah_output) || 0;
        const nilai = h ? jml * h.harga : 0;
        subAgg[key].total_pencapaian += jml;
        subAgg[key].total_nilai      += nilai;
        const zk = s.zona || 'UNKNOWN';
        if (!subAgg[key].zona_detail[zk]) subAgg[key].zona_detail[zk] = { pencapaian: 0, nilai: 0, satuan: h ? h.satuan : '-', harga_satuan: h ? h.harga : null };
        subAgg[key].zona_detail[zk].pencapaian += jml;
        subAgg[key].zona_detail[zk].nilai      += nilai;
      });

      // Aggregate Loader per nama
      const loaderAgg = {};
      (loaderData || []).forEach(l => {
        const key = l.nama;
        if (!loaderAgg[key]) loaderAgg[key] = { nama: l.nama, posisi: 'Loader', total_pencapaian: 0, total_nilai: 0, zona_detail: {} };
        const loaderH = hargaMap['Loader|AMBIENT, CHILLER, FREEZER'] || hargaMap['Loader|LOADER'] || null;
        const jml = parseInt(l.jumlah_kontainer) || 0;
        const nilai = loaderH ? jml * loaderH.harga : 0;
        loaderAgg[key].total_pencapaian += jml;
        loaderAgg[key].total_nilai      += nilai;
        const zk = 'ALL ZONA';
        if (!loaderAgg[key].zona_detail[zk]) loaderAgg[key].zona_detail[zk] = { pencapaian: 0, nilai: 0, satuan: loaderH ? loaderH.satuan : 'kontainer', harga_satuan: loaderH ? loaderH.harga : null };
        loaderAgg[key].zona_detail[zk].pencapaian += jml;
        loaderAgg[key].zona_detail[zk].nilai      += nilai;
      });

      // Merge all into pekerja list
      const pekerjaMap = {};
      [...Object.values(subAgg), ...Object.values(loaderAgg)].forEach(p => {
        const key = `${p.nama}|${p.posisi}`;
        if (!pekerjaMap[key]) {
          pekerjaMap[key] = {
            nama: p.nama,
            posisi: p.posisi,
            total_pencapaian: 0,
            total_nilai: 0,
            zona_detail: []
          };
        }
        pekerjaMap[key].total_pencapaian += p.total_pencapaian;
        pekerjaMap[key].total_nilai      += p.total_nilai;
        Object.entries(p.zona_detail).forEach(([zona, d]) => {
          pekerjaMap[key].zona_detail.push({ zona, ...d });
        });
      });

      const mappedPekerja = Object.values(pekerjaMap).map(p => {
        const nameKey = String(p.nama || '').toLowerCase().trim();
        return { ...p, tipe_karyawan: userTipeMap[nameKey] || 'Productivity' };
      });
      result.pekerja = mappedPekerja.sort((a, b) => b.total_nilai - a.total_nilai);
      result.grand_total = result.pekerja.reduce((s, p) => s + p.total_nilai, 0);
      result.total_by_posisi.picker = result.pekerja.filter(p => p.posisi === 'Picker').reduce((s, p) => s + p.total_nilai, 0);
      result.total_by_posisi.sorter = result.pekerja.filter(p => p.posisi === 'Sorter').reduce((s, p) => s + p.total_nilai, 0);
      result.total_by_posisi.loader = result.pekerja.filter(p => p.posisi === 'Loader').reduce((s, p) => s + p.total_nilai, 0);
      result.leaderboard = result.pekerja.slice(0, 10).map((p, i) => ({ rank: i + 1, nama: p.nama, posisi: p.posisi, tipe_karyawan: p.tipe_karyawan, total_nilai: p.total_nilai, total_pencapaian: p.total_pencapaian }));

    } else {
      const db = load();
      const subData = (db.submissions || []).filter(s => {
        const tgl = s.tanggal_carian;
        return tgl >= tanggalMulai && tgl <= tanggalAkhir && s.status === 'approved';
      });
      const loaderData = (db.loader_entries || []).filter(l => {
        const tgl = l.tanggal_carian;
        return tgl >= tanggalMulai && tgl <= tanggalAkhir;
      });
      const hargaData = db.ketentuan_harga || [];

      const hargaMap = {};
      hargaData.forEach(h => { hargaMap[`${h.posisi}|${h.zona}`] = h; });

      // Aggregate Picker & Sorter per nama+posisi (cross-zona)
      const subAgg = {};
      subData.forEach(s => {
        const key = `${s.nama}|${s.posisi}`;
        if (!subAgg[key]) subAgg[key] = { nama: s.nama, posisi: s.posisi, total_pencapaian: 0, total_nilai: 0, zona_detail: {} };
        const hargaKey  = `${s.posisi}|${s.zona}`;
        const hargaKeyK = `${s.posisi}|${zonaToKategori(s.zona)}`;
        const h = hargaMap[hargaKey] || hargaMap[hargaKeyK] || null;
        const jml = parseInt(s.jumlah_output) || 0;
        const nilai = h ? jml * h.harga : 0;
        subAgg[key].total_pencapaian += jml;
        subAgg[key].total_nilai      += nilai;
        const zk = s.zona || 'UNKNOWN';
        if (!subAgg[key].zona_detail[zk]) subAgg[key].zona_detail[zk] = { pencapaian: 0, nilai: 0, satuan: h ? h.satuan : '-', harga_satuan: h ? h.harga : null };
        subAgg[key].zona_detail[zk].pencapaian += jml;
        subAgg[key].zona_detail[zk].nilai      += nilai;
      });

      // Aggregate Loader per nama
      const loaderAgg = {};
      loaderData.forEach(l => {
        const key = l.nama;
        if (!loaderAgg[key]) loaderAgg[key] = { nama: l.nama, posisi: 'Loader', total_pencapaian: 0, total_nilai: 0, zona_detail: {} };
        const loaderH = hargaMap['Loader|AMBIENT, CHILLER, FREEZER'] || hargaMap['Loader|LOADER'] || null;
        const jml = parseInt(l.jumlah_kontainer) || 0;
        const nilai = loaderH ? jml * loaderH.harga : 0;
        loaderAgg[key].total_pencapaian += jml;
        loaderAgg[key].total_nilai      += nilai;
        const zk = 'ALL ZONA';
        if (!loaderAgg[key].zona_detail[zk]) loaderAgg[key].zona_detail[zk] = { pencapaian: 0, nilai: 0, satuan: loaderH ? loaderH.satuan : 'kontainer', harga_satuan: loaderH ? loaderH.harga : null };
        loaderAgg[key].zona_detail[zk].pencapaian += jml;
        loaderAgg[key].zona_detail[zk].nilai      += nilai;
      });

      // Merge all into pekerja list
      const pekerjaMap = {};
      [...Object.values(subAgg), ...Object.values(loaderAgg)].forEach(p => {
        const key = `${p.nama}|${p.posisi}`;
        if (!pekerjaMap[key]) {
          pekerjaMap[key] = {
            nama: p.nama,
            posisi: p.posisi,
            total_pencapaian: 0,
            total_nilai: 0,
            zona_detail: []
          };
        }
        pekerjaMap[key].total_pencapaian += p.total_pencapaian;
        pekerjaMap[key].total_nilai      += p.total_nilai;
        Object.entries(p.zona_detail).forEach(([zona, d]) => {
          pekerjaMap[key].zona_detail.push({ zona, ...d });
        });
      });

      const mappedPekerja = Object.values(pekerjaMap).map(p => {
        const nameKey = String(p.nama || '').toLowerCase().trim();
        return { ...p, tipe_karyawan: userTipeMap[nameKey] || 'Productivity' };
      });
      result.pekerja = mappedPekerja.sort((a, b) => b.total_nilai - a.total_nilai);
      result.grand_total = result.pekerja.reduce((s, p) => s + p.total_nilai, 0);
      result.total_by_posisi.picker = result.pekerja.filter(p => p.posisi === 'Picker').reduce((s, p) => s + p.total_nilai, 0);
      result.total_by_posisi.sorter = result.pekerja.filter(p => p.posisi === 'Sorter').reduce((s, p) => s + p.total_nilai, 0);
      result.total_by_posisi.loader = result.pekerja.filter(p => p.posisi === 'Loader').reduce((s, p) => s + p.total_nilai, 0);
      result.leaderboard = result.pekerja.slice(0, 10).map((p, i) => ({ rank: i + 1, nama: p.nama, posisi: p.posisi, tipe_karyawan: p.tipe_karyawan, total_nilai: p.total_nilai, total_pencapaian: p.total_pencapaian }));
    }

    return result;
  },

  // ============= MONITORING MPP =============

  async getMonitoringMPP(tanggalMulai, tanggalAkhir) {
    // Backward compat: if only tanggalMulai given, use it for both
    if (!tanggalAkhir) tanggalAkhir = tanggalMulai;
    const isRange = tanggalMulai !== tanggalAkhir;

    // MPP All: user aktif per posisi
    let mppAll = { picker: 0, sorter: 0, loader: 0 };
    // MPP Today/Periode: hadir per posisi
    let mppToday = { picker: 0, sorter: 0, loader: 0, hari_count: 0 };
    // Pencapaian per pekerja
    let pencapaianList = [];

    // Helper: generate array of date strings between two dates (inclusive)
    const getDateRange = (start, end) => {
      const dates = [];
      const cur = new Date(start + 'T00:00:00');
      const last = new Date(end + 'T00:00:00');
      while (cur <= last) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
      }
      return dates;
    };
    const dateRange = getDateRange(tanggalMulai, tanggalAkhir);

    if (isSupabaseEnabled) {
      // MPP All
      const { data: usersData } = await supabase
        .from('users')
        .select('posisi')
        .eq('role', 'operasional')
        .eq('is_active', true);
      (usersData || []).forEach(u => {
        const pos = (u.posisi || '').toLowerCase();
        if (pos === 'picker') mppAll.picker++;
        else if (pos === 'sorter') mppAll.sorter++;
        else if (pos === 'loader') mppAll.loader++;
      });

      // MPP Today/Periode (from absensi table)
      const { data: absensiData } = await supabase
        .from('absensi')
        .select('user_id, tanggal')
        .gte('tanggal', tanggalMulai)
        .lte('tanggal', tanggalAkhir);

      if (!isRange) {
        // Single date: exact count
        const hadirUserIds = new Set((absensiData || []).map(a => a.user_id));
        if (hadirUserIds.size > 0) {
          const { data: hadirUsers } = await supabase
            .from('users')
            .select('id, posisi')
            .in('id', Array.from(hadirUserIds));
          (hadirUsers || []).forEach(u => {
            const pos = (u.posisi || '').toLowerCase();
            if (pos === 'picker') mppToday.picker++;
            else if (pos === 'sorter') mppToday.sorter++;
            else if (pos === 'loader') mppToday.loader++;
          });
        }
        mppToday.hari_count = 1;
      } else {
        // Range: compute per-day count then average
        const absensiByDate = {};
        (absensiData || []).forEach(a => {
          if (!absensiByDate[a.tanggal]) absensiByDate[a.tanggal] = new Set();
          absensiByDate[a.tanggal].add(a.user_id);
        });
        const allHadirIds = new Set((absensiData || []).map(a => a.user_id));
        let userPosisiMap = {};
        if (allHadirIds.size > 0) {
          const { data: hadirUsers } = await supabase
            .from('users')
            .select('id, posisi')
            .in('id', Array.from(allHadirIds));
          (hadirUsers || []).forEach(u => { userPosisiMap[u.id] = (u.posisi || '').toLowerCase(); });
        }
        let totPicker = 0, totSorter = 0, totLoader = 0, daysWithData = 0;
        dateRange.forEach(d => {
          const ids = absensiByDate[d];
          if (!ids || ids.size === 0) return;
          daysWithData++;
          ids.forEach(uid => {
            const pos = userPosisiMap[uid] || '';
            if (pos === 'picker') totPicker++;
            else if (pos === 'sorter') totSorter++;
            else if (pos === 'loader') totLoader++;
          });
        });
        const div = daysWithData || 1;
        mppToday.picker = Math.round(totPicker / div);
        mppToday.sorter = Math.round(totSorter / div);
        mppToday.loader = Math.round(totLoader / div);
        mppToday.hari_count = daysWithData;
      }

      // Pencapaian: Picker & Sorter dari submissions (approved) â€” range query
      // CATATAN: .limit(10000) wajib â€” Supabase default hanya 1000 rows, menyebabkan data tanggal awal hilang saat range panjang
      const [subData, loaderData, { data: hargaData }] = await Promise.all([
        this.fetchAllRows('submissions', 'nama, posisi, zona, jumlah_output, tanggal_carian', q =>
          q.gte('tanggal_carian', tanggalMulai).lte('tanggal_carian', tanggalAkhir).eq('status', 'approved')
        ),
        this.fetchAllRows('loader_entries', 'nama, jumlah_kontainer, tanggal_carian', q =>
          q.gte('tanggal_carian', tanggalMulai).lte('tanggal_carian', tanggalAkhir)
        ),
        supabase.from('ketentuan_harga').select('*')
      ]);

      const hargaMap = {};
      (hargaData || []).forEach(h => { hargaMap[`${h.posisi}|${h.zona}`] = h; });

      // Helper: map kode zona Excel (F1, R1, T1, dst) ke kategori harga (FREEZER, CHILLER, AMBIENT)
      const zonaToKategori = (zona) => {
        const z = String(zona || '').trim().toUpperCase();
        if (z.startsWith('F')) return 'FREEZER';
        if (z.startsWith('R')) return 'CHILLER';
        if (z.startsWith('T')) return 'AMBIENT';
        return zona; // fallback: pakai apa adanya (misal sudah AMBIENT/CHILLER/FREEZER)
      };

      // Aggregasi submission per nama+posisi+zona (total + detail harian)
      const submissionAgg = {};
      (subData || []).forEach(s => {
        const key = `${s.nama}|${s.posisi}|${s.zona}`;
        if (!submissionAgg[key]) submissionAgg[key] = { nama: s.nama, posisi: s.posisi, zona: s.zona, total: 0, harian: {} };
        submissionAgg[key].total += parseInt(s.jumlah_output) || 0;
        const tgl = s.tanggal_carian;
        if (!submissionAgg[key].harian[tgl]) submissionAgg[key].harian[tgl] = 0;
        submissionAgg[key].harian[tgl] += parseInt(s.jumlah_output) || 0;
      });
      Object.values(submissionAgg).forEach(agg => {
        // Coba lookup langsung dulu, kalau tidak ketemu coba dengan mapping kategori
        const hargaKey = `${agg.posisi}|${agg.zona}`;
        const hargaKeyKategori = `${agg.posisi}|${zonaToKategori(agg.zona)}`;
        const h = hargaMap[hargaKey] || hargaMap[hargaKeyKategori] || null;
        const detail_harian = Object.entries(agg.harian)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([tanggal, pencapaian]) => ({
            tanggal,
            pencapaian,
            total_nilai: h ? pencapaian * h.harga : null
          }));
        pencapaianList.push({
          nama: agg.nama, posisi: agg.posisi, zona: agg.zona,
          pencapaian: agg.total, satuan: h ? h.satuan : (agg.posisi === 'Picker' ? 'pcs' : 'kontainer'),
          harga_satuan: h ? h.harga : null,
          total_nilai: h ? agg.total * h.harga : null,
          detail_harian
        });
      });

      // Aggregasi loader per nama (total + detail harian)
      const loaderAgg = {};
      (loaderData || []).forEach(l => {
        const key = l.nama;
        if (!loaderAgg[key]) loaderAgg[key] = { nama: l.nama, total: 0, harian: {} };
        loaderAgg[key].total += parseInt(l.jumlah_kontainer) || 0;
        const tgl = l.tanggal_carian;
        if (!loaderAgg[key].harian[tgl]) loaderAgg[key].harian[tgl] = 0;
        loaderAgg[key].harian[tgl] += parseInt(l.jumlah_kontainer) || 0;
      });
      const loaderHarga = hargaMap['Loader|AMBIENT, CHILLER, FREEZER'] || hargaMap['Loader|LOADER'] || null;
      Object.values(loaderAgg).forEach(agg => {
        const detail_harian = Object.entries(agg.harian)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([tanggal, pencapaian]) => ({
            tanggal,
            pencapaian,
            total_nilai: loaderHarga ? pencapaian * loaderHarga.harga : null
          }));
        pencapaianList.push({
          nama: agg.nama, posisi: 'Loader', zona: 'AMBIENT, CHILLER, FREEZER',
          pencapaian: agg.total, satuan: loaderHarga ? loaderHarga.satuan : 'kontainer',
          harga_satuan: loaderHarga ? loaderHarga.harga : null,
          total_nilai: loaderHarga ? agg.total * loaderHarga.harga : null,
          detail_harian
        });
      });

    } else {
      // Local JSON fallback
      const db = load();
      const users = (db.users || []).filter(u => u.role === 'operasional' && u.is_active !== false);
      users.forEach(u => {
        const pos = (u.posisi || '').toLowerCase();
        if (pos === 'picker') mppAll.picker++;
        else if (pos === 'sorter') mppAll.sorter++;
        else if (pos === 'loader') mppAll.loader++;
      });

      const absensiAll = (db.absensi || []).filter(a => a.tanggal >= tanggalMulai && a.tanggal <= tanggalAkhir);

      if (!isRange) {
        const hadirIds = new Set(absensiAll.map(a => a.user_id));
        users.filter(u => hadirIds.has(u.id)).forEach(u => {
          const pos = (u.posisi || '').toLowerCase();
          if (pos === 'picker') mppToday.picker++;
          else if (pos === 'sorter') mppToday.sorter++;
          else if (pos === 'loader') mppToday.loader++;
        });
        mppToday.hari_count = 1;
      } else {
        const absensiByDate = {};
        absensiAll.forEach(a => {
          if (!absensiByDate[a.tanggal]) absensiByDate[a.tanggal] = new Set();
          absensiByDate[a.tanggal].add(a.user_id);
        });
        const userPosisiMap = {};
        users.forEach(u => { userPosisiMap[u.id] = (u.posisi || '').toLowerCase(); });
        let totPicker = 0, totSorter = 0, totLoader = 0, daysWithData = 0;
        dateRange.forEach(d => {
          const ids = absensiByDate[d];
          if (!ids || ids.size === 0) return;
          daysWithData++;
          ids.forEach(uid => {
            const pos = userPosisiMap[uid] || '';
            if (pos === 'picker') totPicker++;
            else if (pos === 'sorter') totSorter++;
            else if (pos === 'loader') totLoader++;
          });
        });
        const div = daysWithData || 1;
        mppToday.picker = Math.round(totPicker / div);
        mppToday.sorter = Math.round(totSorter / div);
        mppToday.loader = Math.round(totLoader / div);
        mppToday.hari_count = daysWithData;
      }

      const hargaList = db.ketentuan_harga || [];
      const hargaMap = {};
      hargaList.forEach(h => { hargaMap[`${h.posisi}|${h.zona}`] = h; });

      // Helper: map kode zona Excel (F1, R1, T1, dst) ke kategori harga (FREEZER, CHILLER, AMBIENT)
      const zonaToKategori = (zona) => {
        const z = String(zona || '').trim().toUpperCase();
        if (z.startsWith('F')) return 'FREEZER';
        if (z.startsWith('R')) return 'CHILLER';
        if (z.startsWith('T')) return 'AMBIENT';
        return zona;
      };

      const submissions = (db.submissions || []).filter(s =>
        s.tanggal_carian >= tanggalMulai && s.tanggal_carian <= tanggalAkhir && s.status === 'approved'
      );
      const submissionAgg = {};
      submissions.forEach(s => {
        const key = `${s.nama}|${s.posisi}|${s.zona}`;
        if (!submissionAgg[key]) submissionAgg[key] = { nama: s.nama, posisi: s.posisi, zona: s.zona, total: 0, harian: {} };
        submissionAgg[key].total += parseInt(s.jumlah_output) || 0;
        const tgl = s.tanggal_carian;
        if (!submissionAgg[key].harian[tgl]) submissionAgg[key].harian[tgl] = 0;
        submissionAgg[key].harian[tgl] += parseInt(s.jumlah_output) || 0;
      });
      Object.values(submissionAgg).forEach(agg => {
        const hargaKey = `${agg.posisi}|${agg.zona}`;
        const hargaKeyKategori = `${agg.posisi}|${zonaToKategori(agg.zona)}`;
        const h = hargaMap[hargaKey] || hargaMap[hargaKeyKategori] || null;
        const detail_harian = Object.entries(agg.harian)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([tanggal, pencapaian]) => ({
            tanggal,
            pencapaian,
            total_nilai: h ? pencapaian * h.harga : null
          }));
        pencapaianList.push({
          nama: agg.nama, posisi: agg.posisi, zona: agg.zona,
          pencapaian: agg.total, satuan: h ? h.satuan : (agg.posisi === 'Picker' ? 'pcs' : 'kontainer'),
          harga_satuan: h ? h.harga : null,
          total_nilai: h ? agg.total * h.harga : null,
          detail_harian
        });
      });

      const loaderEntries = (db.loader_entries || []).filter(l =>
        l.tanggal_carian >= tanggalMulai && l.tanggal_carian <= tanggalAkhir
      );
      const loaderAgg = {};
      loaderEntries.forEach(l => {
        const key = l.nama;
        if (!loaderAgg[key]) loaderAgg[key] = { nama: l.nama, total: 0, harian: {} };
        loaderAgg[key].total += parseInt(l.jumlah_kontainer) || 0;
        const tgl = l.tanggal_carian;
        if (!loaderAgg[key].harian[tgl]) loaderAgg[key].harian[tgl] = 0;
        loaderAgg[key].harian[tgl] += parseInt(l.jumlah_kontainer) || 0;
      });
      const loaderHarga = hargaMap['Loader|AMBIENT, CHILLER, FREEZER'] || hargaMap['Loader|LOADER'] || null;
      Object.values(loaderAgg).forEach(agg => {
        const detail_harian = Object.entries(agg.harian)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([tanggal, pencapaian]) => ({
            tanggal,
            pencapaian,
            total_nilai: loaderHarga ? pencapaian * loaderHarga.harga : null
          }));
        pencapaianList.push({
          nama: agg.nama, posisi: 'Loader', zona: 'AMBIENT, CHILLER, FREEZER',
          pencapaian: agg.total, satuan: loaderHarga ? loaderHarga.satuan : 'kontainer',
          harga_satuan: loaderHarga ? loaderHarga.harga : null,
          total_nilai: loaderHarga ? agg.total * loaderHarga.harga : null,
          detail_harian
        });
      });
    }

    pencapaianList.sort((a, b) => a.nama.localeCompare(b.nama));

    return {
      mpp_all: { ...mppAll, total: mppAll.picker + mppAll.sorter + mppAll.loader },
      mpp_today: { ...mppToday, total: mppToday.picker + mppToday.sorter + mppToday.loader },
      pencapaian: pencapaianList,
      is_range: isRange,
      tanggal_mulai: tanggalMulai,
      tanggal_akhir: tanggalAkhir
    };
  },

  // ===================== RETURN ENTRIES =====================

  async insertReturnEntry(data) {
    const { v4: uuidv4 } = require('uuid');
    const record = {
      id: uuidv4(),
      tanggal_return: data.tanggal_return,
      tanggal_referensi: data.tanggal_referensi,
      loader_entry_id: data.loader_entry_id || null,
      no_polisi: data.no_polisi || '',
      nama_return: data.nama_return || '',
      cluster_return_outputs: data.cluster_return_outputs || {},
      total_outbound: data.total_outbound || 0,
      total_kembali: data.total_kembali || 0,
      total_selisih: data.total_selisih || 0,
      catatan: data.catatan || '',
      status: 'submitted',
      created_at: new Date().toISOString()
    };
    if (supabase) {
      const { error } = await supabase.from('return_entries').insert([record]);
      if (error) throw error;
    }
    return record;
  },

  async getAllReturnEntries({ tanggal_return, tanggal_referensi, status } = {}) {
    if (supabase) {
      let q = supabase.from('return_entries').select('*').order('created_at', { ascending: false });
      if (tanggal_return) q = q.eq('tanggal_return', tanggal_return);
      if (tanggal_referensi) q = q.eq('tanggal_referensi', tanggal_referensi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }
    return [];
  },

  async getReturnEntryById(id) {
    if (supabase) {
      const { data, error } = await supabase.from('return_entries').select('*').eq('id', id).single();
      if (error) return null;
      return data;
    }
    return null;
  },

  async validateReturnEntry(id, status, validatedBy, catatanAdmin) {
    const now = new Date().toISOString();
    if (supabase) {
      const updateData = { status, validated_by: validatedBy, validated_at: now };
      if (catatanAdmin) updateData.catatan = catatanAdmin;
      const { data, error } = await supabase.from('return_entries')
        .update(updateData).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }
    throw new Error('Supabase tidak tersedia');
  },

  // ===================== END RETURN ENTRIES =====================

  // ===================== QC OUTBOUND =====================

  /**
   * Insert QC Outbound entry baru.
   * Validasi duplikat (1 nopol per hari) harus dilakukan di server.js sebelum memanggil ini.
   */
  async insertQcOutbound(data) {
    const { v4: uuidv4 } = require('uuid');
    const record = {
      id: uuidv4(),
      tanggal: data.tanggal,
      no_polisi: data.no_polisi,
      kontainer: parseInt(data.kontainer) || 0,
      styrofoam: parseInt(data.styrofoam) || 0,
      dus: parseInt(data.dus) || 0,
      catatan: data.catatan || '',
      created_by: data.created_by || 'unknown',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isSupabaseEnabled) {
      const { error } = await supabase.from('qc_outbound').insert([record]);
      if (error) { console.error('Supabase insertQcOutbound error:', error); throw error; }
      return record;
    } else {
      const db = load();
      db.qc_outbound.push(record);
      save(db);
      return record;
    }
  },

  /**
   * Ambil semua QC Outbound, opsional filter per tanggal.
   */
  async getAllQcOutbound(tanggal = null) {
    if (isSupabaseEnabled) {
      let query = supabase.from('qc_outbound').select('*').order('created_at', { ascending: false });
      if (tanggal) query = query.eq('tanggal', tanggal);
      const { data, error } = await query;
      if (error) { console.error('Supabase getAllQcOutbound error:', error); return []; }
      return data || [];
    } else {
      const db = load();
      let entries = db.qc_outbound || [];
      if (tanggal) entries = entries.filter(e => e.tanggal === tanggal);
      return entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  /**
   * Ambil satu QC Outbound berdasarkan ID.
   */
  async getQcOutboundById(id) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase.from('qc_outbound').select('*').eq('id', id).maybeSingle();
      if (error) return null;
      return data;
    } else {
      const db = load();
      return (db.qc_outbound || []).find(e => e.id === id) || null;
    }
  },

  /**
   * Hapus QC Outbound berdasarkan ID.
   */
  async deleteQcOutbound(id) {
    if (isSupabaseEnabled) {
      const { error } = await supabase.from('qc_outbound').delete().eq('id', id);
      if (error) throw error;
    } else {
      const db = load();
      db.qc_outbound = (db.qc_outbound || []).filter(e => e.id !== id);
      save(db);
    }
  },

  /**
   * Cek apakah no_polisi sudah ada untuk tanggal tertentu (validasi duplikat).
   * Returns: entry yang ditemukan atau null.
   */
  async getQcOutboundByNopolAndTanggal(no_polisi, tanggal) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('qc_outbound')
        .select('*')
        .eq('no_polisi', no_polisi)
        .eq('tanggal', tanggal)
        .maybeSingle();
      if (error) return null;
      return data;
    } else {
      const db = load();
      return (db.qc_outbound || []).find(e => e.no_polisi === no_polisi && e.tanggal === tanggal) || null;
    }
  }

  // ===================== END QC OUTBOUND =====================
};



