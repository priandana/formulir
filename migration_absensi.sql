-- =====================================================
-- Migration: Buat tabel site_settings, absensi, dan setting absensi
-- Jalankan di Supabase SQL Editor:
-- https://supabase.com/dashboard/project/sttgvuukudymnuultxtf/sql/new
-- =====================================================

-- 1. Buat tabel site_settings jika belum ada
--    (dipakai untuk login_page settings dan absensi_settings)
CREATE TABLE IF NOT EXISTS public.site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS untuk site_settings
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- Policy: allow all untuk service_role
DROP POLICY IF EXISTS "Allow all for service role" ON public.site_settings;
CREATE POLICY "Allow all for service role" ON public.site_settings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Tabel absensi: siapa yang hadir pada tanggal tertentu
CREATE TABLE IF NOT EXISTS public.absensi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL DEFAULT '',   -- username admin yang mengabsen
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tanggal, user_id)              -- satu user hanya bisa diabsen sekali per hari
);

-- Index untuk query cepat per tanggal
CREATE INDEX IF NOT EXISTS idx_absensi_tanggal ON public.absensi(tanggal);
CREATE INDEX IF NOT EXISTS idx_absensi_user_id ON public.absensi(user_id);

-- Enable RLS
ALTER TABLE public.absensi ENABLE ROW LEVEL SECURITY;

-- Policy: allow all untuk service_role
DROP POLICY IF EXISTS "Allow all for service role" ON public.absensi;
CREATE POLICY "Allow all for service role" ON public.absensi
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Insert default settings (absensi nonaktif by default)
INSERT INTO public.site_settings (key, value)
VALUES ('absensi_settings', '{"absensi_required": false, "absensi_visible_to_user": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Verifikasi
SELECT 'Migration absensi berhasil! Tabel site_settings dan absensi sudah siap.' AS status;
