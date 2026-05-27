require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

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
  data_carian: []
};

// Load database from file (local fallback)
function load() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      // Ensure data_carian exists in older databases
      if (!db.data_carian) db.data_carian = [];
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
  if (!db.users.find(u => u.username === 'admin')) {
    db.users.push({
      id: uuidv4(),
      username: 'admin',
      password: bcrypt.hashSync('admin123', 10),
      created_at: new Date().toISOString()
    });
    save(db);
    console.log('✅ Default admin created: username=admin, password=admin123');
  }
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
        catatan_tambahan: data.catatan_tambahan || ''
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
        created_at: new Date().toISOString()
      };
      db.submissions.push(record);
      save(db);
      return record;
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
      
      // Delete uploaded files from local disk
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
    } else {
      const uploadsDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, buffer);
      return `/uploads/${filename}`;
    }
  },

  // =============================================
  // DATA CARIAN — Kapasitas batch harian
  // =============================================

  /**
   * Insert satu record data carian
   * @param {object} data - { tanggal_carian, posisi, zona, batch, total_output, satuan }
   */
  async insertDataCarian(data) {
    if (isSupabaseEnabled) {
      const record = {
        id: data.id || uuidv4(),
        tanggal_carian: data.tanggal_carian,
        posisi: data.posisi,
        zona: data.zona,
        batch: data.batch,
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
   * Jika kombinasi (tanggal, posisi, zona, batch) sudah ada → update total_output
   */
  async bulkUpsertDataCarian(records) {
    const results = [];
    for (const data of records) {
      // Cek apakah sudah ada record dengan kombinasi yang sama
      const existing = await this.getDataCarianByKey(
        data.tanggal_carian, data.posisi, data.zona, data.batch
      );
      if (existing) {
        // Update
        const updated = await this.updateDataCarian(existing.id, {
          total_output: data.total_output,
          satuan: data.satuan
        });
        results.push(updated);
      } else {
        // Insert
        const inserted = await this.insertDataCarian(data);
        results.push(inserted);
      }
    }
    return results;
  },

  /**
   * Ambil satu record berdasarkan kombinasi key unik
   */
  async getDataCarianByKey(tanggal_carian, posisi, zona, batch) {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase
        .from('data_carian')
        .select('*')
        .eq('tanggal_carian', tanggal_carian)
        .eq('posisi', posisi)
        .eq('zona', zona)
        .eq('batch', batch)
        .maybeSingle();
      if (error) {
        console.error('Supabase getDataCarianByKey error:', error);
        throw error;
      }
      return data;
    } else {
      const db = load();
      return db.data_carian.find(d =>
        d.tanggal_carian === tanggal_carian &&
        d.posisi === posisi &&
        d.zona === zona &&
        d.batch === batch
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
    if (isSupabaseEnabled) {
      // Ambil semua submission yang tanggal_carian sama, posisi sama, zona sama
      // dan batch ada di dalam batch_cluster mereka
      const { data, error } = await supabase
        .from('submissions')
        .select('jumlah_output, batch_cluster')
        .eq('tanggal_carian', tanggal_carian)
        .eq('posisi', posisi)
        .eq('zona', zona);
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
        s.zona === zona
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
    // Fetch data_carian records dan semua submissions sekaligus (2 queries total, bukan N+1)
    const [records, allSubmissions] = await Promise.all([
      this.getDataCarian(tanggal_carian),
      (async () => {
        if (isSupabaseEnabled) {
          const { data, error } = await supabase
            .from('submissions')
            .select('jumlah_output, batch_cluster, posisi, zona')
            .eq('tanggal_carian', tanggal_carian);
          if (error) {
            console.error('Supabase getDataCarianWithStatus submissions error:', error);
            throw error;
          }
          return data;
        } else {
          const db = load();
          return db.submissions.filter(s => s.tanggal_carian === tanggal_carian);
        }
      })()
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
  }
};
