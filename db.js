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
    const target = await this.getUserById(id);
    const systemAdminId = await this.getSystemAdminId();
    if (id === systemAdminId || (target?.username && target.username.toLowerCase() === 'admin')) {
      const err = new Error('Akun Administrator utama digunakan oleh sistem dan tidak dapat dinonaktifkan.');
      err.status = 409;
      throw err;
    }

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
    const targetUser = await this.getUserById(id);
    const systemAdminId = await this.getSystemAdminId();
    if (id === systemAdminId || (targetUser?.username && targetUser.username.toLowerCase() === 'admin')) {
      const err = new Error('Akun Administrator utama digunakan oleh sistem dan tidak dapat dihapus.');
      err.status = 409;
      throw err;
    }

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
    const target = await this.getUserById(id);
    const systemAdminId = await this.getSystemAdminId();
    if (id === systemAdminId || (target?.username && target.username.toLowerCase() === 'admin')) {
      const err = new Error('Akun Administrator utama digunakan oleh sistem dan tidak dapat diedit dari sini.');
      err.status = 409;
      throw err;
    }
    if (username && username.trim().toLowerCase() === 'admin') {
      const err = new Error('Username "admin" dicadangkan untuk Administrator utama sistem.');
      err.status = 409;
      throw err;
    }
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
   * Hapus akun admin berdasarkan ID (System Admin dilindungi dari penghapusan)
   */
  async deleteAdminUser(id) {
    const targetUser = await this.getUserById(id);
    const systemAdminId = await this.getSystemAdminId();
    if (id === systemAdminId || (targetUser?.username && targetUser.username.toLowerCase() === 'admin')) {
      const err = new Error('Akun Administrator utama digunakan oleh sistem dan tidak dapat dihapus.');
      err.status = 409;
      throw err;
    }

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
   * Toggle is_active status for an admin user (aktif <-> non-aktif)
   * System Admin anchor is protected from deactivation!
   */
  async toggleAdminStatus(id) {
    const target = await this.getUserById(id);
    if (!target || target.role !== 'admin') throw new Error('Akun admin tidak ditemukan.');
    const systemAdminId = await this.getSystemAdminId();
    if (id === systemAdminId || (target.username && target.username.toLowerCase() === 'admin')) {
      const err = new Error('Akun Administrator utama digunakan oleh sistem dan tidak dapat dinonaktifkan.');
      err.status = 409;
      throw err;
    }

    const newStatus = target.is_active === false ? true : false;
    if (isSupabaseEnabled) {
      const { data: updated, error } = await supabase
        .from('users').update({ is_active: newStatus }).eq('id', id).eq('role', 'admin')
        .select('id,username,nama_lengkap,role,is_active').single();
      if (error) { console.error('Supabase toggleAdminStatus error:', error); throw error; }
      return updated;
    } else {
      const db = load();
      const idx = db.users.findIndex(u => u.id === id && u.role === 'admin');
      if (idx === -1) throw new Error('Akun admin tidak ditemukan.');
      db.users[idx].is_active = newStatus;
      save(db);
      return db.users[idx];
    }
  },

  /**
   * Update admin user data (nama_lengkap, username, is_active)
   * Protects System Admin username from rename and from is_active = false!
   */
  async updateAdminUser(id, { username, nama_lengkap, is_active } = {}) {
    const target = await this.getUserById(id);
    if (!target || target.role !== 'admin') throw new Error('Akun admin tidak ditemukan.');
    const systemAdminId = await this.getSystemAdminId();
    const isSystemAdmin = id === systemAdminId || (target.username && target.username.toLowerCase() === 'admin');

    if (isSystemAdmin) {
      if (is_active === false) {
        const err = new Error('Akun Administrator utama digunakan oleh sistem dan tidak dapat dinonaktifkan.');
        err.status = 409;
        throw err;
      }
      if (username && username.trim().toLowerCase() !== 'admin') {
        const err = new Error('Username akun Administrator utama dilindungi dan tidak dapat diubah.');
        err.status = 409;
        throw err;
      }
    } else {
      if (username && username.trim().toLowerCase() === 'admin') {
        const err = new Error('Username "admin" dicadangkan untuk Administrator utama sistem.');
        err.status = 409;
        throw err;
      }
    }

    const updates = {};
    if (username) updates.username = username.trim();
    if (nama_lengkap) updates.nama_lengkap = nama_lengkap.trim();
    if (is_active !== undefined) updates.is_active = is_active;

    if (isSupabaseEnabled) {
      const { data: updated, error } = await supabase
        .from('users').update(updates).eq('id', id).eq('role', 'admin')
        .select('id,username,nama_lengkap,role,is_active,allowed_pages').single();
      if (error) { console.error('Supabase updateAdminUser error:', error); throw error; }
      return updated;
    } else {
      const db = load();
      const idx = db.users.findIndex(u => u.id === id && u.role === 'admin');
      if (idx === -1) throw new Error('Akun admin tidak ditemukan.');
      db.users[idx] = { ...db.users[idx], ...updates };
      save(db);
      return db.users[idx];
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
      const [subData, loaderData, { data: hargaDataRaw }] = await Promise.all([
        this.fetchAllRows('submissions', 'nama, posisi, zona, jumlah_output, tanggal_carian', q =>
          q.gte('tanggal_carian', tanggalMulai).lte('tanggal_carian', tanggalAkhir).eq('status', 'approved')
        ),
        this.fetchAllRows('loader_entries', 'nama, jumlah_kontainer, tanggal_carian', q =>
          q.gte('tanggal_carian', tanggalMulai).lte('tanggal_carian', tanggalAkhir)
        ),
        supabase.from('ketentuan_harga').select('*')
      ]);

      const hargaData = (hargaDataRaw || []);

      const details = [];

      (subData || []).forEach(s => {
        const hargaMapDate = this._buildHargaMapForDate(hargaData, s.tanggal_carian);
        const hargaKey  = `${s.posisi}|${s.zona}`;
        const hargaKeyK = `${s.posisi}|${zonaToKategori(s.zona)}`;
        const h = hargaMapDate[hargaKey] || hargaMapDate[hargaKeyK] || null;
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
        const hargaMapDate = this._buildHargaMapForDate(hargaData, l.tanggal_carian);
        const loaderH = hargaMapDate['Loader|AMBIENT, CHILLER, FREEZER'] || hargaMapDate['Loader|LOADER'] || null;
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

      const details = [];

      subData.forEach(s => {
        const hargaMapDate = this._buildHargaMapForDate(hargaData, s.tanggal_carian);
        const hargaKey  = `${s.posisi}|${s.zona}`;
        const hargaKeyK = `${s.posisi}|${zonaToKategori(s.zona)}`;
        const h = hargaMapDate[hargaKey] || hargaMapDate[hargaKeyK] || null;
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
        const hargaMapDate = this._buildHargaMapForDate(hargaData, l.tanggal_carian);
        const loaderH = hargaMapDate['Loader|AMBIENT, CHILLER, FREEZER'] || hargaMapDate['Loader|LOADER'] || null;
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
        .order('zona', { ascending: true })
        .order('berlaku_dari', { ascending: false });
      if (error) { console.error('Supabase getKetentuanHarga error:', error); throw error; }
      return data || [];
    } else {
      const db = load();
      return (db.ketentuan_harga || []).sort((a, b) => a.posisi.localeCompare(b.posisi) || a.zona.localeCompare(b.zona) || String(b.berlaku_dari||'').localeCompare(String(a.berlaku_dari||'')));
    }
  },

  async getKetentuanHargaByKey(posisi, zona) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('ketentuan_harga')
        .select('*')
        .eq('posisi', posisi)
        .eq('zona', zona)
        .order('berlaku_dari', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) { console.error('Supabase getKetentuanHargaByKey error:', error); throw error; }
      return data || null;
    } else {
      const db = load();
      return (db.ketentuan_harga || []).find(h => h.posisi === posisi && h.zona === zona) || null;
    }
  },

  async insertKetentuanHarga({ posisi, zona, harga, satuan, keterangan, berlaku_dari }) {
    const now = new Date().toISOString();
    const berlakuDate = berlaku_dari || new Date().toISOString().slice(0, 10);
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('ketentuan_harga')
        .insert([{ posisi, zona, harga: parseFloat(harga) || 0, satuan, keterangan: keterangan || null, berlaku_dari: berlakuDate }])
        .select()
        .single();
      if (error) { console.error('Supabase insertKetentuanHarga error:', error); throw error; }
      return data;
    } else {
      const db = load();
      if (!db.ketentuan_harga) db.ketentuan_harga = [];
      const existing = db.ketentuan_harga.find(h => h.posisi === posisi && h.zona === zona && h.berlaku_dari === berlakuDate);
      if (existing) throw new Error('Harga untuk kombinasi posisi, zona, dan tanggal berlaku ini sudah ada.');
      const record = { id: uuidv4(), posisi, zona, harga: parseFloat(harga) || 0, satuan, keterangan: keterangan || null, berlaku_dari: berlakuDate, created_at: now, updated_at: now };
      db.ketentuan_harga.push(record);
      save(db);
      return record;
    }
  },

  // updateKetentuanHarga: Ambil posisi+zona dari row yg di-edit, lalu INSERT baris baru dgn berlaku_dari baru
  async updateKetentuanHarga(id, { harga, keterangan, berlaku_dari }) {
    const now = new Date().toISOString();
    let existing;
    if (isSupabaseEnabled) {
      const { data } = await supabase.from('ketentuan_harga').select('posisi,zona,satuan').eq('id', id).single();
      existing = data;
    } else {
      const db = load();
      existing = (db.ketentuan_harga || []).find(h => h.id === id);
    }
    if (!existing) throw new Error('Ketentuan harga tidak ditemukan.');

    const berlakuDate = berlaku_dari || now.slice(0, 10);
    const satuan = existing.satuan;

    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('ketentuan_harga')
        .insert([{ posisi: existing.posisi, zona: existing.zona, harga: parseFloat(harga) || 0, satuan, keterangan: keterangan || null, berlaku_dari: berlakuDate }])
        .select()
        .single();
      if (error) {
        if (error.code === '23505') throw new Error('Harga untuk tanggal berlaku ini sudah ada. Gunakan tanggal lain.');
        console.error('Supabase updateKetentuanHarga (insert new period) error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      if (!db.ketentuan_harga) db.ketentuan_harga = [];
      const dup = db.ketentuan_harga.find(h => h.posisi === existing.posisi && h.zona === existing.zona && h.berlaku_dari === berlakuDate);
      if (dup) throw new Error('Harga untuk tanggal berlaku ini sudah ada. Gunakan tanggal lain.');
      const record = { id: uuidv4(), posisi: existing.posisi, zona: existing.zona, harga: parseFloat(harga) || 0, satuan, keterangan: keterangan || null, berlaku_dari: berlakuDate, created_at: now, updated_at: now };
      db.ketentuan_harga.push(record);
      save(db);
      return record;
    }
  },

  async deleteKetentuanHarga(id) {
    if (isSupabaseEnabled) {
      const { data: row } = await supabase.from('ketentuan_harga').select('posisi,zona').eq('id', id).single();
      if (row) {
        const { count } = await supabase.from('ketentuan_harga').select('id', { count: 'exact', head: true }).eq('posisi', row.posisi).eq('zona', row.zona);
        if (count <= 1) throw new Error('Tidak dapat menghapus satu-satunya harga untuk kombinasi posisi dan zona ini.');
      }
      const { error } = await supabase.from('ketentuan_harga').delete().eq('id', id);
      if (error) { console.error('Supabase deleteKetentuanHarga error:', error); throw error; }
      return true;
    } else {
      const db = load();
      if (!db.ketentuan_harga) db.ketentuan_harga = [];
      const idx = db.ketentuan_harga.findIndex(h => h.id === id);
      if (idx === -1) throw new Error('Ketentuan harga tidak ditemukan.');
      const { posisi, zona } = db.ketentuan_harga[idx];
      const sameKey = db.ketentuan_harga.filter(h => h.posisi === posisi && h.zona === zona);
      if (sameKey.length <= 1) throw new Error('Tidak dapat menghapus satu-satunya harga untuk kombinasi posisi dan zona ini.');
      db.ketentuan_harga.splice(idx, 1);
      save(db);
      return true;
    }
  },

  /**
   * Helper: Dari array semua harga historis, kembalikan hargaMap yang berlaku pada tanggal tertentu.
   * Untuk tiap kombinasi posisi+zona, ambil row dengan berlaku_dari TERBESAR yang <= tanggal.
   */
  _buildHargaMapForDate(allHargaData, tanggal) {
    const map = {};
    (allHargaData || []).forEach(h => {
      const berlaku = h.berlaku_dari ? String(h.berlaku_dari).slice(0, 10) : '1970-01-01';
      if (berlaku > tanggal) return; // belum berlaku pada tanggal ini
      const key = `${h.posisi}|${h.zona}`;
      if (!map[key] || berlaku > String(map[key].berlaku_dari || '').slice(0, 10)) {
        map[key] = h;
      }
    });
    return map;
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
      // CATATAN: .limit(10000) wajib — Supabase default hanya 1000 rows
      const [subData, loaderData, { data: hargaData }] = await Promise.all([
        this.fetchAllRows('submissions', 'nama, posisi, zona, jumlah_output, tanggal_carian', q =>
          q.gte('tanggal_carian', tanggalMulai).lte('tanggal_carian', tanggalAkhir).eq('status', 'approved')
        ),
        this.fetchAllRows('loader_entries', 'nama, jumlah_kontainer, tanggal_carian', q =>
          q.gte('tanggal_carian', tanggalMulai).lte('tanggal_carian', tanggalAkhir)
        ),
        supabase.from('ketentuan_harga').select('*')
      ]);

      // Aggregate Picker & Sorter per nama+posisi (cross-zona) — harga per tanggal carian
      const subAgg = {};
      (subData || []).forEach(s => {
        const key = `${s.nama}|${s.posisi}`;
        if (!subAgg[key]) subAgg[key] = { nama: s.nama, posisi: s.posisi, total_pencapaian: 0, total_nilai: 0, zona_detail: {} };
        // Lookup harga yang berlaku pada tanggal_carian submission ini
        const hargaMapDate = this._buildHargaMapForDate(hargaData, s.tanggal_carian);
        const hargaKey  = `${s.posisi}|${s.zona}`;
        const hargaKeyK = `${s.posisi}|${zonaToKategori(s.zona)}`;
        const h = hargaMapDate[hargaKey] || hargaMapDate[hargaKeyK] || null;
        const jml = parseInt(s.jumlah_output) || 0;
        const nilai = h ? jml * h.harga : 0;
        subAgg[key].total_pencapaian += jml;
        subAgg[key].total_nilai      += nilai;
        const zk = s.zona || 'UNKNOWN';
        if (!subAgg[key].zona_detail[zk]) subAgg[key].zona_detail[zk] = { pencapaian: 0, nilai: 0, satuan: h ? h.satuan : '-', harga_satuan: h ? h.harga : null };
        subAgg[key].zona_detail[zk].pencapaian += jml;
        subAgg[key].zona_detail[zk].nilai      += nilai;
      });

      // Aggregate Loader per nama — harga per tanggal carian
      const loaderAgg = {};
      (loaderData || []).forEach(l => {
        const key = l.nama;
        if (!loaderAgg[key]) loaderAgg[key] = { nama: l.nama, posisi: 'Loader', total_pencapaian: 0, total_nilai: 0, zona_detail: {} };
        const hargaMapDate = this._buildHargaMapForDate(hargaData, l.tanggal_carian);
        const loaderH = hargaMapDate['Loader|AMBIENT, CHILLER, FREEZER'] || hargaMapDate['Loader|LOADER'] || null;
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

      // Aggregate Picker & Sorter per nama+posisi (cross-zona) — harga per tanggal carian
      const subAgg = {};
      subData.forEach(s => {
        const key = `${s.nama}|${s.posisi}`;
        if (!subAgg[key]) subAgg[key] = { nama: s.nama, posisi: s.posisi, total_pencapaian: 0, total_nilai: 0, zona_detail: {} };
        const hargaMapDate = this._buildHargaMapForDate(hargaData, s.tanggal_carian);
        const hargaKey  = `${s.posisi}|${s.zona}`;
        const hargaKeyK = `${s.posisi}|${zonaToKategori(s.zona)}`;
        const h = hargaMapDate[hargaKey] || hargaMapDate[hargaKeyK] || null;
        const jml = parseInt(s.jumlah_output) || 0;
        const nilai = h ? jml * h.harga : 0;
        subAgg[key].total_pencapaian += jml;
        subAgg[key].total_nilai      += nilai;
        const zk = s.zona || 'UNKNOWN';
        if (!subAgg[key].zona_detail[zk]) subAgg[key].zona_detail[zk] = { pencapaian: 0, nilai: 0, satuan: h ? h.satuan : '-', harga_satuan: h ? h.harga : null };
        subAgg[key].zona_detail[zk].pencapaian += jml;
        subAgg[key].zona_detail[zk].nilai      += nilai;
      });

      // Aggregate Loader per nama — harga per tanggal carian
      const loaderAgg = {};
      loaderData.forEach(l => {
        const key = l.nama;
        if (!loaderAgg[key]) loaderAgg[key] = { nama: l.nama, posisi: 'Loader', total_pencapaian: 0, total_nilai: 0, zona_detail: {} };
        const hargaMapDate = this._buildHargaMapForDate(hargaData, l.tanggal_carian);
        const loaderH = hargaMapDate['Loader|AMBIENT, CHILLER, FREEZER'] || hargaMapDate['Loader|LOADER'] || null;
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
      id: data.id || uuidv4(),
      tanggal: data.tanggal_carian || data.tanggal,
      tanggal_carian: data.tanggal_carian || data.tanggal,
      tanggal_kirim: data.tanggal_kirim || data.tanggal,
      no_polisi: data.no_polisi,
      nama_qc: data.nama_qc || data.created_by || '',
      zona: data.zona || '',
      kontainer: parseInt(data.kontainer) || 0,
      styrofoam: parseInt(data.styrofoam) || 0,
      dus: parseInt(data.dus) || 0,
      non_group: data.non_group || { gacoan: 0, dikichi: 0, benfarm: 0 },
      clusters_breakdown: data.clusters_breakdown || {},
      target_rps_info: data.target_rps_info || {},
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
  },   // ← comma: this function is followed by chat functions in the same module.exports

  // ===================== END QC OUTBOUND =====================

  // ======================== CHAT FUNCTIONS ========================

  DEFAULT_CHAT_SETTINGS: {
    status: 'DISABLED',
    allow_direct_message: true,
    allow_group_chat: true,
    allow_attachment: true,
    show_read_receipt: true,
    show_online_status: true,
    show_typing_indicator: false,
    allow_browser_notification: false,
    max_attachment_size_mb: 10,
    role_access: {
      admin: true,
      Picker: true,
      Sorter: true,
      Loader: true,
      Return: true,
      'QC Outbound': true
    }
  },

  async getChatSettings() {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'chat_settings')
        .maybeSingle();
      if (error) {
        console.error('Supabase getChatSettings error:', error);
        return this.DEFAULT_CHAT_SETTINGS;
      }
      return data && data.value ? { ...this.DEFAULT_CHAT_SETTINGS, ...data.value } : this.DEFAULT_CHAT_SETTINGS;
    }
    return this.DEFAULT_CHAT_SETTINGS;
  },

  async saveChatSettings(settings) {
    const merged = { ...this.DEFAULT_CHAT_SETTINGS, ...settings };
    if (isSupabaseEnabled) {
      const { error } = await supabase
        .from('site_settings')
        .upsert({ 
          key: 'chat_settings', 
          value: merged
        }, { onConflict: 'key' });
      if (error) {
        console.error('Supabase saveChatSettings error:', error);
        throw error;
      }
      return merged;
    }
    return merged;
  },

  chatAccessAllowed(settings, userRole, userPosisi) {
    if (!settings) return false;
    if (settings.status && settings.status !== 'ACTIVE') return false;
    if (settings.is_enabled === false) return false;
    if (userRole === 'admin') return true;
    if (userRole === 'operasional') {
      const allowedRoles = settings.role_access?.operasional || [];
      return allowedRoles.includes(userPosisi);
    }
    return false;
  },

  async findOrCreateDirectConversation(userAId, userBId, creatorId) {
    if (!isSupabaseEnabled) return null;
    if (userAId === userBId) throw new Error('Cannot create conversation with yourself');
    
    const sortedIds = [userAId, userBId].sort();
    const directKey = `${sortedIds[0]}:${sortedIds[1]}`;
    
    // 1. Try to find existing
    const { data: existing } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('direct_key', directKey)
      .maybeSingle();

    let conversationId;
    if (existing) {
      conversationId = existing.id;
    } else {
      // 2. Insert new
      const newConvId = uuidv4();
      const nowIso = new Date().toISOString();
      const { data: inserted, error: insErr } = await supabase
        .from('chat_conversations')
        .insert([{
          id: newConvId,
          type: 'direct',
          direct_key: directKey,
          created_by: creatorId,
          created_at: nowIso,
          updated_at: nowIso
        }])
        .select('id')
        .single();

      if (insErr) {
        if (insErr.code === '23505') {
          const { data: found } = await supabase
            .from('chat_conversations')
            .select('id')
            .eq('direct_key', directKey)
            .single();
          if (found) conversationId = found.id;
          else throw insErr;
        } else {
          console.error('Supabase findOrCreateDirectConversation insert error:', insErr);
          throw insErr;
        }
      } else {
        conversationId = inserted.id;
      }
    }

    // Ensure participants exist
    const { data: partA } = await supabase.from('chat_participants').select('id').eq('conversation_id', conversationId).eq('user_id', userAId).is('removed_at', null).maybeSingle();
    if (!partA) {
      await supabase.from('chat_participants').insert([{ conversation_id: conversationId, user_id: userAId, role: 'member' }]);
    }
    const { data: partB } = await supabase.from('chat_participants').select('id').eq('conversation_id', conversationId).eq('user_id', userBId).is('removed_at', null).maybeSingle();
    if (!partB) {
      await supabase.from('chat_participants').insert([{ conversation_id: conversationId, user_id: userBId, role: 'member' }]);
    }
    
    return { id: conversationId };
  },

  _cachedSystemAdmin: null,
  _cachedSystemAdminTime: 0,

  async getSystemAdminUser() {
    if (!isSupabaseEnabled) return null;

    // Check in-memory cache (valid for 60 seconds)
    if (this._cachedSystemAdmin && (Date.now() - this._cachedSystemAdminTime < 60000)) {
      return this._cachedSystemAdmin;
    }

    try {
      // Primary and ONLY resolution: LOWER(username) = 'admin' and role = 'admin'
      // STRICT: No fallback to arbitrary admin to prevent changing anchor ID & fracturing conversations
      const { data: adminUser, error } = await supabase
        .from('users')
        .select('id, username, nama_lengkap, role, is_active')
        .ilike('username', 'admin')
        .eq('role', 'admin')
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Chat] Error querying system admin user:', error);
        return null;
      }

      if (adminUser) {
        if (adminUser.is_active === false) {
          console.warn('[Chat] Primary system admin account is deactivated:', adminUser.id);
          this._cachedSystemAdmin = null;
          this._cachedSystemAdminTime = 0;
          return null;
        }

        this._cachedSystemAdmin = adminUser;
        this._cachedSystemAdminTime = Date.now();
        return adminUser;
      }
    } catch (err) {
      console.error('[CRITICAL] Exception while resolving System Admin anchor:', err);
    }

    this._cachedSystemAdmin = null;
    this._cachedSystemAdminTime = 0;
    console.error('[CRITICAL] System Admin anchor not found! Ensure an active administrator with LOWER(username) = "admin" exists in users table.');
    return null;
  },

  async getSystemAdminId() {
    const admin = await this.getSystemAdminUser();
    return admin ? admin.id : null;
  },

  async getOrCreateSupportConversation(operationalUserId) {
    if (!isSupabaseEnabled) return null;
    const systemAdminId = await this.getSystemAdminId();
    if (!systemAdminId) {
      const err = new Error('Layanan Live Chat sementara tidak tersedia. Silakan hubungi Administrator.');
      err.status = 503;
      throw err;
    }
    if (operationalUserId === systemAdminId) {
      throw new Error('Pengguna ini adalah administrator.');
    }

    const conv = await this.findOrCreateDirectConversation(operationalUserId, systemAdminId, operationalUserId);
    return conv;
  },

  async isSupportConversation(conversationId) {
    if (!isSupabaseEnabled) return false;
    const systemAdminId = await this.getSystemAdminId();
    if (!systemAdminId) return false;

    const { data, error } = await supabase
      .from('chat_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', systemAdminId)
      .is('removed_at', null)
      .maybeSingle();
    return !error && !!data;
  },

  async getAdminSharedInbox({ search = '', filter = 'all' } = {}) {
    if (!isSupabaseEnabled) return [];
    const systemAdminId = await this.getSystemAdminId();
    if (!systemAdminId) return [];

    // Find all direct conversations where systemAdminId is an active participant
    const { data: adminParts, error: partErr } = await supabase
      .from('chat_participants')
      .select(`
        last_read_message_id,
        last_read_at,
        conversation_id,
        chat_conversations (
          id,
          type,
          created_at,
          updated_at,
          last_message_at
        )
      `)
      .eq('user_id', systemAdminId)
      .is('removed_at', null);

    if (partErr || !adminParts) {
      console.error('getAdminSharedInbox error:', partErr);
      return [];
    }

    const conversations = [];
    for (const ap of adminParts) {
      const conv = ap.chat_conversations;
      if (!conv || conv.type !== 'direct') continue;

      // Find the other participant (the operational user)
      const { data: otherPart } = await supabase
        .from('chat_participants')
        .select(`
          user_id,
          users (
            id,
            username,
            nama_lengkap,
            role,
            posisi,
            tipe_karyawan,
            is_active
          )
        `)
        .eq('conversation_id', conv.id)
        .neq('user_id', systemAdminId)
        .is('removed_at', null)
        .maybeSingle();

      if (!otherPart || !otherPart.users) continue;
      const user = otherPart.users;

      // Filter by search query
      if (search) {
        const q = search.toLowerCase();
        const matchName = (user.nama_lengkap || '').toLowerCase().includes(q);
        const matchUser = (user.username || '').toLowerCase().includes(q);
        const matchPos = (user.posisi || '').toLowerCase().includes(q);
        if (!matchName && !matchUser && !matchPos) continue;
      }

      // Filter by filter tab (e.g. 'picker', 'sorter', 'loader', 'return', 'qc outbound')
      const filterLower = filter.toLowerCase();
      if (filterLower !== 'all' && filterLower !== 'unread') {
        const userPosisiLower = (user.posisi || '').toLowerCase().replace(/\s+/g, '_');
        const targetPosisi = filterLower.replace(/\s+/g, '_');
        if (userPosisiLower !== targetPosisi) continue;
      }

      // Unread count for admin team: messages in this conversation where sender != systemAdminId and created_at > last_read_at
      let unreadQuery = supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .is('deleted_at', null)
        .neq('sender_user_id', systemAdminId);

      if (ap.last_read_at) {
        unreadQuery = unreadQuery.gt('created_at', ap.last_read_at);
      }
      const { count: unreadCount } = await unreadQuery;

      if (filterLower === 'unread' && (!unreadCount || unreadCount === 0)) {
        continue;
      }

      // Get last message
      const { data: lastMsg } = await supabase
        .from('chat_messages')
        .select('id, content, message_type, created_at, sender_user_id, sender_name')
        .eq('conversation_id', conv.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get user presence
      const { data: presence } = await supabase
        .from('chat_presence')
        .select('last_seen_at')
        .eq('user_id', user.id)
        .maybeSingle();

      const isOnline = presence && presence.last_seen_at ? (new Date() - new Date(presence.last_seen_at) < 120000) : false;

      conversations.push({
        id: conv.id,
        user: {
          id: user.id,
          nama_lengkap: user.nama_lengkap || user.username,
          username: user.username,
          posisi: user.posisi || '-',
          tipe_karyawan: user.tipe_karyawan || '-',
          is_online: isOnline,
          last_seen_at: presence ? presence.last_seen_at : null
        },
        last_message: lastMsg || null,
        unread_count: unreadCount || 0,
        updated_at: conv.last_message_at || conv.updated_at || conv.created_at,
        created_at: conv.created_at
      });
    }

    conversations.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    return conversations;
  },

  async getAdminSharedInboxUnreadCount() {
    if (!isSupabaseEnabled) return 0;
    const systemAdminId = await this.getSystemAdminId();
    if (!systemAdminId) return 0;

    const { data: adminParts } = await supabase
      .from('chat_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', systemAdminId)
      .is('removed_at', null);

    if (!adminParts || adminParts.length === 0) return 0;

    let total = 0;
    for (const p of adminParts) {
      let q = supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', p.conversation_id)
        .is('deleted_at', null)
        .neq('sender_user_id', systemAdminId);

      if (p.last_read_at) {
        q = q.gt('created_at', p.last_read_at);
      }
      const { count } = await q;
      if (count) total += count;
    }
    return total;
  },


  async createGroupConversation(arg1, arg2, arg3) {
    if (!isSupabaseEnabled) return null;
    let name, memberIds, createdByUserId;
    if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1)) {
      name = arg1.name;
      memberIds = arg1.memberIds || arg1.member_ids || [];
      createdByUserId = arg1.createdByUserId || arg1.created_by_user_id || arg1.created_by;
    } else {
      name = arg1;
      memberIds = arg2 || [];
      createdByUserId = arg3;
    }
    
    if (!name || name.trim() === '') throw new Error('Group name is required');
    if (!memberIds || memberIds.length === 0) throw new Error('Members are required');
    
    const allMembers = new Set([...memberIds, createdByUserId]);
    const convId = uuidv4();
    const nowIso = new Date().toISOString();
    
    const { data: convData, error: convError } = await supabase
      .from('chat_conversations')
      .insert({
        id: convId,
        type: 'group',
        name: name.trim(),
        created_by: createdByUserId,
        created_at: nowIso,
        updated_at: nowIso
      })
      .select('id')
      .single();
      
    if (convError) {
      console.error('Supabase createGroupConversation error:', convError);
      throw convError;
    }
    
    const participants = Array.from(allMembers).map(userId => ({
      conversation_id: convId,
      user_id: userId,
      role: userId === createdByUserId ? 'admin' : 'member'
    }));
    
    const { error: partError } = await supabase
      .from('chat_participants')
      .insert(participants);
      
    if (partError) {
      console.error('Supabase createGroup participants error:', partError);
    }
    
    return { id: convId };
  },

  async getUserConversations(userId) {
    if (!isSupabaseEnabled) return [];
    
    const { data, error } = await supabase
      .from('chat_participants')
      .select(`
        role,
        removed_at,
        last_read_message_id,
        last_read_at,
        conversation_id,
        chat_conversations (
          id,
          type,
          name,
          updated_at,
          last_message_at
        )
      `)
      .eq('user_id', userId);
      
    if (error) {
      console.error('Supabase getUserConversations error:', error);
      throw error;
    }
    
    const seenConvs = new Set();
    const result = [];
    for (const p of (data || [])) {
      if (!p.chat_conversations) continue;
      const conv = p.chat_conversations;
      if (seenConvs.has(conv.id)) continue;
      seenConvs.add(conv.id);
      
      let unreadCount = 0;
      
      if (!p.removed_at) {
        let countQuery = supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .is('deleted_at', null)
          .neq('sender_user_id', userId);

        if (p.last_read_at) {
          countQuery = countQuery.gt('created_at', p.last_read_at);
        }
        const { count, error: countError } = await countQuery;
        if (!countError) unreadCount = count || 0;
      }
      
      const { data: lastMsg } = await supabase
        .from('chat_messages')
        .select('id, content, message_type, created_at, sender_user_id, sender_name')
        .eq('conversation_id', conv.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let displayName = conv.name;
      let otherParticipant = null;
      if (conv.type === 'direct') {
        const { data: otherPart } = await supabase
          .from('chat_participants')
          .select('user_id, users(id, username, nama_lengkap, role, posisi)')
          .eq('conversation_id', conv.id)
          .neq('user_id', userId)
          .maybeSingle();
          
        if (otherPart && otherPart.users) {
          displayName = otherPart.users.nama_lengkap || otherPart.users.username;
          otherParticipant = otherPart.users;
        }
      }
      
      result.push({
        id: conv.id,
        type: conv.type,
        name: displayName,
        display_name: displayName,
        other_participant_name: displayName,
        other_participant: otherParticipant,
        is_group: conv.type === 'group',
        updated_at: conv.last_message_at || conv.updated_at,
        last_message_at: conv.last_message_at,
        is_former_member: !!p.removed_at,
        removed_at: p.removed_at,
        my_role: p.role,
        last_message: lastMsg || null,
        unread_count: unreadCount
      });
    }
    
    result.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    return result;
  },

  async getConversationById(conversationId, requestingUserId) {
    if (!isSupabaseEnabled) return null;
    
    const part = await this.getParticipantRecord(conversationId, requestingUserId);
    if (!part) return null; // Not a participant
    
    const { data: convData, error: convError } = await supabase
      .from('chat_conversations')
      .select('*')
      .eq('id', conversationId)
      .single();
      
    if (convError || !convData) return null;
    
    return {
      ...convData,
      is_former_member: !!part.removed_at,
      removed_at: part.removed_at,
      my_role: part.role
    };
  },

  async isActiveParticipant(conversationId, userId) {
    if (!isSupabaseEnabled) return false;
    const { data, error } = await supabase
      .from('chat_participants')
      .select('id, removed_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .is('removed_at', null)
      .maybeSingle();
    if (error || !data) return false;
    return true;
  },

  async getParticipantRecord(conversationId, userId) {
    if (!isSupabaseEnabled) return null;
    // Prefer active membership
    const { data: active, error: activeErr } = await supabase
      .from('chat_participants')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .is('removed_at', null)
      .maybeSingle();
    if (!activeErr && active) return active;
    
    // Fallback to most recent membership record
    const { data: latest, error: latestErr } = await supabase
      .from('chat_participants')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) return null;
    return latest;
  },

  async getUserMembershipPeriods(conversationId, userId) {
    if (!isSupabaseEnabled) return [];
    const { data, error } = await supabase
      .from('chat_participants')
      .select('id, joined_at, removed_at, role')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('joined_at', { ascending: true });
    if (error) {
      console.error('Supabase getUserMembershipPeriods error:', error);
      return [];
    }
    return data || [];
  },

  async addParticipant(conversationId, userId, role = 'member') {
    if (!isSupabaseEnabled) return null;
    // Check if user is ALREADY active
    const { data: active } = await supabase
      .from('chat_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .is('removed_at', null)
      .maybeSingle();
      
    if (active) {
      const { data, error } = await supabase
        .from('chat_participants')
        .update({ role })
        .eq('id', active.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    // Insert new membership period row (rejoin or initial join)
    const { data, error } = await supabase
      .from('chat_participants')
      .insert([{
        id: uuidv4(),
        conversation_id: conversationId,
        user_id: userId,
        role: role,
        joined_at: new Date().toISOString(),
        removed_at: null
      }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async removeParticipant(conversationId, userId) {
    if (!isSupabaseEnabled) return null;
    const { data, error } = await supabase
      .from('chat_participants')
      .update({ removed_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .is('removed_at', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getConversationParticipants(conversationId) {
    if (!isSupabaseEnabled) return [];
    const { data, error } = await supabase
      .from('chat_participants')
      .select('user_id, role, joined_at, users (username, nama_lengkap, role, posisi)')
      .eq('conversation_id', conversationId)
      .is('removed_at', null);
    if (error) throw error;
    return data;
  },

  async updateLastRead(conversationId, userId, messageId) {
    if (!isSupabaseEnabled) return null;
    const { data, error } = await supabase
      .from('chat_participants')
      .update({ last_read_message_id: messageId, last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .is('removed_at', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async insertMessage(params) {
    if (!isSupabaseEnabled) return null;
    
    const conversationId = params.conversationId || params.conversation_id;
    const senderUserId = params.senderUserId || params.senderId || params.sender_user_id || null;
    const content = params.content || null;
    const messageType = params.messageType || params.message_type || 'text';
    const replyToMessageId = params.replyToMessageId || params.replyTo || params.reply_to_message_id || null;
    const idempotencyKey = params.idempotencyKey || params.idempotency_key || uuidv4();
    const attachmentInfo = params.attachmentInfo || params.attachment_info || null;

    let senderName = params.senderName || params.sender_name || null;
    if (!senderName && senderUserId) {
      try {
        const { data: senderUser } = await supabase.from('users').select('nama_lengkap, username').eq('id', senderUserId).maybeSingle();
        if (senderUser) senderName = senderUser.nama_lengkap || senderUser.username;
      } catch(e) {}
    }

    const record = {
      id: uuidv4(),
      conversation_id: conversationId,
      sender_user_id: senderUserId,
      sender_name: senderName,
      content: content,
      message_type: messageType,
      reply_to_message_id: replyToMessageId,
      idempotency_key: idempotencyKey
    };

    const { data, error } = await supabase
      .from('chat_messages')
      .insert([record])
      .select()
      .single();

    if (error) {
      if (error.code === '23505' && error.message && error.message.includes('idempotency')) {
        const { data: existing, error: existError } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .eq('sender_user_id', senderUserId)
          .eq('idempotency_key', record.idempotency_key)
          .single();
        if (existError) throw existError;
        return { ...existing, isOwn: true };
      }
      throw error;
    }
    
    if (attachmentInfo) {
      try {
        await supabase.from('chat_attachments').insert([{
          id: uuidv4(),
          message_id: data.id,
          storage_path: attachmentInfo.storage_path,
          original_filename: attachmentInfo.filename || attachmentInfo.original_filename,
          mime_type: attachmentInfo.mimetype || attachmentInfo.mime_type,
          file_size: attachmentInfo.size || attachmentInfo.file_size
        }]);
      } catch (attErr) {
        console.error('Error inserting chat attachment:', attErr);
      }
    }

    const nowIso = new Date().toISOString();
    await supabase
      .from('chat_conversations')
      .update({ 
        last_message_at: nowIso, 
        updated_at: nowIso 
      })
      .eq('id', conversationId);

    return { ...data, isOwn: true };
  },

  async getMessages(conversationId, requestingUserId, { limit = 30, beforeId, afterId, afterCreatedAt, isAdmin = false } = {}) {
    if (!isSupabaseEnabled) return [];
    
    let periods = [];
    if (isAdmin) {
      const isSupport = await this.isSupportConversation(conversationId);
      if (isSupport) {
        periods = [{ joined_at: new Date(0).toISOString(), removed_at: null }];
      }
    }

    if (periods.length === 0) {
      periods = await this.getUserMembershipPeriods(conversationId, requestingUserId);
    }
    if (!periods || periods.length === 0) return [];
    
    let query = supabase
      .from('chat_messages')
      .select(`
        *,
        users (username, nama_lengkap, role, posisi),
        chat_attachments (*),
        reply_to:reply_to_message_id (id, content, message_type, users (username, nama_lengkap, role, posisi))
      `)
      .eq('conversation_id', conversationId)
      .is('deleted_at', null);

    if (afterId && afterCreatedAt) {
      query = query
        .gt('created_at', afterCreatedAt)
        .order('created_at', { ascending: true })
        .limit(Math.min(limit, 50));
    } else if (beforeId) {
      const { data: beforeMsg } = await supabase.from('chat_messages').select('created_at').eq('id', beforeId).single();
      if (beforeMsg) {
        query = query.lt('created_at', beforeMsg.created_at);
      }
      query = query
        .order('created_at', { ascending: false })
        .limit(Math.min(limit, 50));
    } else {
      query = query
        .order('created_at', { ascending: false })
        .limit(Math.min(limit, 50));
    }

    const { data, error } = await query;
    if (error) {
      console.error('Supabase getMessages error:', error);
      throw error;
    }
    
    // Filter messages by membership intervals (rejoin support)
    const visibleMessages = (data || []).filter(m => {
      const msgTime = new Date(m.created_at).getTime();
      return periods.some(p => {
        const joinTime = new Date(p.joined_at).getTime();
        const removeTime = p.removed_at ? new Date(p.removed_at).getTime() : Infinity;
        return msgTime >= joinTime && msgTime <= removeTime;
      });
    });

    const formatted = visibleMessages.map(m => {
      const isSenderAdmin = m.users?.role === 'admin';
      let displayName = m.sender_name || (m.users ? (m.users.nama_lengkap || m.users.username) : 'User');
      if (isSenderAdmin && !isAdmin) {
        displayName = 'Admin SS08';
      }
      return {
        ...m,
        sender_role: m.users?.role || (isSenderAdmin ? 'admin' : 'operasional'),
        is_admin_sender: isSenderAdmin,
        sender_name: displayName,
        isOwn: m.sender_user_id === requestingUserId
      };
    });

    if (!afterId) {
      formatted.reverse();
    }

    return formatted;
  },

  async editMessage(messageId, senderUserId, newContent) {
    if (!isSupabaseEnabled) return null;
    const { data, error } = await supabase
      .from('chat_messages')
      .update({ content: newContent, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('sender_user_id', senderUserId)
      .is('deleted_at', null)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async softDeleteMessage(messageId, senderUserId) {
    if (!isSupabaseEnabled) return null;
    const { data, error } = await supabase
      .from('chat_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('sender_user_id', senderUserId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getUnreadCount(userId) {
    if (!isSupabaseEnabled) return 0;
    
    // First get active conversations for user
    const { data: parts, error: partError } = await supabase
      .from('chat_participants')
      .select('conversation_id, last_read_message_id')
      .eq('user_id', userId)
      .is('removed_at', null);
      
    if (partError || !parts || parts.length === 0) return 0;
    
    let totalUnread = 0;
    for (const p of parts) {
      const { count, error } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', p.conversation_id)
        .is('deleted_at', null)
        .gt('id', p.last_read_message_id || '00000000-0000-0000-0000-000000000000');
      if (!error && count) totalUnread += count;
    }
    
    return totalUnread;
  },

  async getConversationUnreadCount(conversationId, userId) {
    if (!isSupabaseEnabled) return 0;
    const part = await this.getParticipantRecord(conversationId, userId);
    if (!part || part.removed_at) return 0;
    
    const { count, error } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .gt('id', part.last_read_message_id || '00000000-0000-0000-0000-000000000000');
      
    if (error) return 0;
    return count || 0;
  },

  async checkRateLimit(userId, windowMs, maxMessages) {
    if (!isSupabaseEnabled) return { allowed: true, count: 0, limit: maxMessages };
    
    const timeLimit = new Date(Date.now() - windowMs).toISOString();
    
    const { count, error } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_user_id', userId)
      .gt('created_at', timeLimit)
      .is('deleted_at', null);
      
    if (error) {
      console.error('Supabase checkRateLimit error:', error);
      return { allowed: true, count: 0, limit: maxMessages }; // fail open
    }
    
    const currentCount = count || 0;
    return {
      allowed: currentCount < maxMessages,
      count: currentCount,
      limit: maxMessages
    };
  },

  async insertAttachment({ messageId, storagePath, originalFilename, mimeType, fileSize }) {
    if (!isSupabaseEnabled) return null;
    const record = {
      id: uuidv4(),
      message_id: messageId,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: mimeType,
      file_size: fileSize
    };
    const { data, error } = await supabase
      .from('chat_attachments')
      .insert([record])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getAttachmentByMessageId(messageId) {
    if (!isSupabaseEnabled) return null;
    const { data, error } = await supabase
      .from('chat_attachments')
      .select('*')
      .eq('message_id', messageId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getAttachment(id) {
    if (!isSupabaseEnabled) return null;
    const { data, error } = await supabase
      .from('chat_attachments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async updatePresence(userId) {
    if (!isSupabaseEnabled) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('chat_presence')
      .upsert({ user_id: userId, last_seen_at: nowIso, updated_at: nowIso }, { onConflict: 'user_id' });
    if (error) console.error('Supabase updatePresence error:', error);
  },

  async getPresence(userIds) {
    if (!isSupabaseEnabled || !userIds || userIds.length === 0) return [];
    const { data, error } = await supabase
      .from('chat_presence')
      .select('user_id, last_seen_at')
      .in('user_id', userIds);
    if (error) {
      console.error('Supabase getPresence error:', error);
      return [];
    }
    return data || [];
  },

  async updateTyping(userId, conversationId) {
    if (!isSupabaseEnabled) return;
    const { error } = await supabase
      .from('chat_participants')
      .update({ last_typing_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) console.error('Supabase updateTyping error:', error);
  },

  async getTypingUsers(conversationId) {
    if (!isSupabaseEnabled) return [];
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
    const { data, error } = await supabase
      .from('chat_participants')
      .select('user_id, users (username, nama_lengkap)')
      .eq('conversation_id', conversationId)
      .gt('last_typing_at', fiveSecondsAgo);
    if (error) {
      console.error('Supabase getTypingUsers error:', error);
      return [];
    }
    return data.map(d => d.user_id);
  },

  async getChatEligibleUsers(requestingUserId, searchQuery = '') {
    if (!isSupabaseEnabled) return [];
    
    let query = supabase
      .from('users')
      .select('id, username, nama_lengkap, role, posisi, tipe_karyawan')
      .eq('role', 'operasional')
      .is('is_active', true);
      
    if (searchQuery) {
      query = query.or(`username.ilike.%${searchQuery}%,nama_lengkap.ilike.%${searchQuery}%`);
    }
    
    query = query.order('nama_lengkap', { ascending: true }).limit(50);
    
    const { data, error } = await query;
    if (error) {
      console.error('Supabase getChatEligibleUsers error:', error);
      return [];
    }
    return data || [];
  },

  async archiveConversation(conversationId, userId) {
    if (!isSupabaseEnabled) return null;
    throw new Error('Not implemented: archiveConversation');
  },

  async updateGroupName(conversationId, newName) {
    if (!isSupabaseEnabled) return null;
    const { data, error } = await supabase
      .from('chat_conversations')
      .update({ name: newName, updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ===================== CHAT ALIAS / BRIDGE FUNCTIONS =====================
  // These bridge naming differences between chat-routes.js and db implementation

  // Alias: getParticipant → getParticipantRecord
  async getParticipant(conversationId, userId) {
    return this.getParticipantRecord(conversationId, userId);
  },

  // Get a single message by ID
  async getMessage(messageId) {
    if (!isSupabaseEnabled) return null;
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*, sender:users!sender_user_id(id, username, nama_lengkap, role, posisi)')
      .eq('id', messageId)
      .maybeSingle();
    if (error) { console.error('getMessage error:', error); return null; }
    return data;
  },

  // Alias: sendMessage → insertMessage
  async sendMessage(params) {
    return this.insertMessage(params);
  },

  // Alias: getAttachment → getAttachmentByMessageId (by attachment id)
  async getAttachment(attachmentId) {
    if (!isSupabaseEnabled) return null;
    const { data, error } = await supabase
      .from('chat_attachments')
      .select('*')
      .eq('id', attachmentId)
      .maybeSingle();
    if (error) { console.error('getAttachment error:', error); return null; }
    return data;
  },

  // Get conversation details including participants
  async getConversationDetails(conversationId) {
    if (!isSupabaseEnabled) return null;
    const [convResult, participantsResult] = await Promise.all([
      supabase.from('chat_conversations').select('*').eq('id', conversationId).maybeSingle(),
      supabase.from('chat_participants')
        .select('*, user:users!user_id(id, username, nama_lengkap, role, posisi)')
        .eq('conversation_id', conversationId)
        .is('removed_at', null)
    ]);
    if (convResult.error) throw convResult.error;
    if (!convResult.data) return null;
    return {
      ...convResult.data,
      participants: participantsResult.data || []
    };
  },

  // Get group info (same as conversation details for groups)
  async getGroupInfo(conversationId) {
    return this.getConversationDetails(conversationId);
  },

  // Get unread counts for all conversations (alias)
  async getUnreadCounts(userId) {
    return this.getUnreadCount(userId);
  },

  // Get updated read states for a conversation (for poll endpoint)
  async getUpdatedReadStates(conversationId, requestingUserId) {
    if (!isSupabaseEnabled) return [];
    const { data, error } = await supabase
      .from('chat_participants')
      .select('user_id, last_read_message_id, last_read_at')
      .eq('conversation_id', conversationId)
      .is('removed_at', null);
    if (error) { console.error('getUpdatedReadStates error:', error); return []; }
    return data || [];
  },

  // Get presence for a conversation (all active participants' presence)
  async getPresence(conversationId) {
    if (!isSupabaseEnabled) return [];
    // Get active participant userIds
    const { data: participants, error: pErr } = await supabase
      .from('chat_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .is('removed_at', null);
    if (pErr || !participants || participants.length === 0) return [];
    const userIds = participants.map(p => p.user_id);
    const { data: presence, error: prErr } = await supabase
      .from('chat_presence')
      .select('user_id, last_seen_at')
      .in('user_id', userIds);
    if (prErr) return [];
    const TWO_MINUTES = 2 * 60 * 1000;
    const now = Date.now();
    return (presence || []).map(p => ({
      user_id: p.user_id,
      last_seen_at: p.last_seen_at,
      is_online: p.last_seen_at && (now - new Date(p.last_seen_at).getTime()) < TWO_MINUTES
    }));
  },

  // Create group conversation with member_ids array (alias for chat-routes.js)
  async createGroupConversation(name, memberIds, createdByUserId) {
    if (!isSupabaseEnabled) throw new Error('Chat requires Supabase');
    const { v4: uuidv4Fn } = require('uuid');
    const convId = uuidv4Fn();
    const now = new Date().toISOString();
    // Create the conversation
    const { data: conv, error: convErr } = await supabase
      .from('chat_conversations')
      .insert([{ id: convId, type: 'group', name, created_by: createdByUserId, created_at: now, updated_at: now }])
      .select()
      .single();
    if (convErr) throw convErr;
    // Add all members as participants (including creator)
    const allMembers = [...new Set([createdByUserId, ...(Array.isArray(memberIds) ? memberIds : [])])];
    const participantRows = allMembers.map(uid => ({
      id: uuidv4Fn(),
      conversation_id: convId,
      user_id: uid,
      role: uid === createdByUserId ? 'group_admin' : 'member',
      joined_at: now
    }));
    const { error: partErr } = await supabase.from('chat_participants').insert(participantRows);
    if (partErr) throw partErr;
    return conv;
  },

  // Expose supabase client for storage operations in chat-routes.js
  get supabase() { return supabase; }

};

// Attach Discipline & Performance Notes module functions onto db exports
try {
  const createDisciplineDb = require('./discipline-db');
  const disciplineDb = createDisciplineDb(module.exports);
  Object.assign(module.exports, disciplineDb);
} catch (err) {
  console.error('Failed to initialize discipline-db module:', err.message);
}
