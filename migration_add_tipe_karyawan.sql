-- =====================================================
-- Migration: Tambah kolom tipe_karyawan ke public.users
-- Jalankan SQL ini di Supabase SQL Editor:
-- =====================================================

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS tipe_karyawan TEXT DEFAULT 'Productivity';

-- Set default value untuk user yang sudah ada
UPDATE public.users 
SET tipe_karyawan = 'Productivity' 
WHERE tipe_karyawan IS NULL;

SELECT 'Migrasi kolom tipe_karyawan berhasil!' AS status;
