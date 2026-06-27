-- =====================================================
-- Migration: Buat tabel audit_logs untuk Audit Trail
-- Jalankan SQL ini di Supabase SQL Editor:
-- https://supabase.com/dashboard/project/sttgvuukudymnuultxtf/sql/new
-- =====================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index untuk query cepat terpaginasi
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON public.audit_logs(username);

-- Enable Row Level Security (RLS)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: allow all untuk service_role
DROP POLICY IF EXISTS "Allow all for service role" ON public.audit_logs;
CREATE POLICY "Allow all for service role" ON public.audit_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verifikasi hasil migrasi
SELECT 'Migrasi Supabase Berhasil! Tabel audit_logs sudah siap.' AS status;
