-- Migration: Tambah kolom berlaku_dari pada ketentuan_harga
-- Jalankan di Supabase SQL Editor
-- Tujuan: mendukung harga historis berbasis periode

-- 1. Tambah kolom berlaku_dari
ALTER TABLE ketentuan_harga
  ADD COLUMN IF NOT EXISTS berlaku_dari DATE NOT NULL DEFAULT CURRENT_DATE;

-- 2. Update existing rows: set berlaku_dari ke created_at date (atau CURRENT_DATE jika created_at null)
UPDATE ketentuan_harga
  SET berlaku_dari = COALESCE(created_at::DATE, CURRENT_DATE)
  WHERE berlaku_dari = CURRENT_DATE;

-- 3. Hapus unique index lama (posisi, zona)
DROP INDEX IF EXISTS idx_ketentuan_harga_posisi_zona;

-- 4. Buat unique index baru (posisi, zona, berlaku_dari)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ketentuan_harga_posisi_zona_berlaku
  ON ketentuan_harga(posisi, zona, berlaku_dari);
