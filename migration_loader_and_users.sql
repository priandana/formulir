-- =====================================================
-- Migration: Tambah kolom user & buat tabel loader_entries
-- Jalankan SQL ini di Supabase SQL Editor:
-- https://supabase.com/dashboard/project/sttgvuukudymnuultxtf/sql/new
-- =====================================================

-- 1. Update tabel public.users dengan kolom-kolom baru
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS nama_lengkap TEXT,
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'operasional',
ADD COLUMN IF NOT EXISTS nik TEXT,
ADD COLUMN IF NOT EXISTS posisi TEXT;

-- Index & constraint tambahan untuk users (supaya tidak duplikat)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON public.users(username);

-- Set admin user details untuk akun admin yang sudah ada
UPDATE public.users
SET role = 'admin', nama_lengkap = 'Administrator', posisi = 'Admin'
WHERE username = 'admin';

-- 2. Buat tabel public.loader_entries
CREATE TABLE IF NOT EXISTS public.loader_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal_carian DATE NOT NULL,
  tanggal_kirim DATE NOT NULL,
  nama TEXT NOT NULL,
  zona TEXT,
  no_polisi TEXT,
  clusters JSONB DEFAULT '[]'::jsonb,
  non_group JSONB DEFAULT '{"gacoan": 0, "dikichi": 0, "benfarm": 0}'::jsonb,
  jumlah_kontainer INTEGER NOT NULL DEFAULT 0,
  catatan TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index untuk query cepat
CREATE INDEX IF NOT EXISTS idx_loader_entries_tanggal_carian ON public.loader_entries(tanggal_carian);
CREATE INDEX IF NOT EXISTS idx_loader_entries_nama ON public.loader_entries(nama);

-- Enable Row Level Security (opsional, karena server menggunakan service_role key)
ALTER TABLE public.loader_entries ENABLE ROW LEVEL SECURITY;

-- Policy: allow all untuk service_role
DROP POLICY IF EXISTS "Allow all for service role" ON public.loader_entries;
CREATE POLICY "Allow all for service role" ON public.loader_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verifikasi hasil migrasi
SELECT 'Migrasi Supabase Berhasil! Tabel loader_entries dan kolom users sudah siap.' AS status;
