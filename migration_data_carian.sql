-- =====================================================
-- Migration: Buat tabel data_carian untuk SS08
-- Jalankan di Supabase SQL Editor:
-- https://supabase.com/dashboard/project/sttgvuukudymnuultxtf/sql/new
-- =====================================================

CREATE TABLE IF NOT EXISTS public.data_carian (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal_carian DATE NOT NULL,
  posisi TEXT NOT NULL CHECK (posisi IN ('Picker', 'Sorter', 'Loader')),
  zona TEXT NOT NULL,
  batch TEXT NOT NULL,
  total_output INTEGER NOT NULL CHECK (total_output > 0),
  satuan TEXT NOT NULL DEFAULT 'pcs',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tanggal_carian, posisi, zona, batch)
);

-- Index untuk query yang sering dipakai
CREATE INDEX IF NOT EXISTS idx_data_carian_tanggal
  ON public.data_carian(tanggal_carian);

CREATE INDEX IF NOT EXISTS idx_data_carian_posisi_zona
  ON public.data_carian(posisi, zona);

-- Enable Row Level Security (opsional, karena kita pakai service_role key)
ALTER TABLE public.data_carian ENABLE ROW LEVEL SECURITY;

-- Policy: allow all untuk service_role (server menggunakan service_role key)
CREATE POLICY "Allow all for service role" ON public.data_carian
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verifikasi tabel berhasil dibuat
SELECT 'Tabel data_carian berhasil dibuat!' AS status;
