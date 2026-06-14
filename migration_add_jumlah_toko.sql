-- =====================================================
-- Migration: Tambah kolom jumlah_toko ke tabel data_carian
-- Jalankan di Supabase SQL Editor:
-- https://supabase.com/dashboard/project/sttgvuukudymnuultxtf/sql/new
-- =====================================================

ALTER TABLE public.data_carian
  ADD COLUMN IF NOT EXISTS jumlah_toko INTEGER NOT NULL DEFAULT 0;

-- Verifikasi
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'data_carian'
  AND column_name = 'jumlah_toko';
