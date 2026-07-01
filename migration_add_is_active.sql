-- Migration: Tambah kolom is_active ke tabel users
-- Jalankan di Supabase SQL Editor
-- Tanggal: 2026-06-29

-- 1. Tambah kolom is_active dengan default TRUE
--    (semua user lama otomatis dianggap aktif)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. (Opsional) Buat index untuk query filter lebih cepat
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- 3. Verifikasi hasilnya
SELECT id, username, nama_lengkap, role, is_active
FROM users
ORDER BY created_at DESC;
