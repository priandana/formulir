-- ============================================================================
-- SS08 — Modul Poin Disiplin & Catatan Kinerja
-- Database Migration & Row Level Security (RLS) Setup
-- Version: 1.0.0
-- Date: 2026-09-25
-- ============================================================================
-- SAFE & IDEMPOTENT:
-- 1. Additive only (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
-- 2. Does NOT alter, drop, or delete any existing tables or columns.
-- 3. Reuses existing public.users and public.audit_logs tables.
-- 4. Enforces strict Row Level Security (RLS) and Private Storage Bucket.
-- ============================================================================

-- ============================================================================
-- 1. TABEL: discipline_categories (Master Pelanggaran)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.discipline_categories (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama_kategori       TEXT        NOT NULL,
  nama_pelanggaran    TEXT        NOT NULL,
  deskripsi           TEXT        DEFAULT '',
  default_poin        INTEGER     NOT NULL DEFAULT 1 CHECK (default_poin >= 0),
  severity            TEXT        NOT NULL DEFAULT 'LOW' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  requires_hr_review  BOOLEAN     NOT NULL DEFAULT FALSE,
  masa_berlaku_bulan  INTEGER     NOT NULL DEFAULT 3 CHECK (masa_berlaku_bulan >= 1 AND masa_berlaku_bulan <= 60),
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by          UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disc_cat_active
  ON public.discipline_categories(is_active, nama_kategori);

CREATE UNIQUE INDEX IF NOT EXISTS idx_disc_cat_unique_name
  ON public.discipline_categories(LOWER(nama_kategori), LOWER(nama_pelanggaran));

-- ============================================================================
-- 2. TABEL: discipline_incidents (Record Kejadian & Poin Disiplin)
-- ============================================================================
-- Catatan: Record kejadian TIDAK PERNAH dihapus (no hard delete).
-- Koreksi atau pembatalan menggunakan mekanisme Adjustment.
CREATE TABLE IF NOT EXISTS public.discipline_incidents (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_code         TEXT        NOT NULL UNIQUE,
  incident_date         DATE        NOT NULL,
  user_id               UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  user_name_snapshot    TEXT        NOT NULL,
  nik_snapshot          TEXT,
  posisi                TEXT        NOT NULL,
  category_id           UUID        REFERENCES public.discipline_categories(id) ON DELETE SET NULL,
  kategori_nama         TEXT        NOT NULL,
  subkategori           TEXT        NOT NULL,
  kronologi             TEXT        NOT NULL,
  default_poin          INTEGER     NOT NULL DEFAULT 0,
  poin                  INTEGER     NOT NULL DEFAULT 0 CHECK (poin >= 0),
  is_overridden         BOOLEAN     NOT NULL DEFAULT FALSE,
  severity              TEXT        NOT NULL DEFAULT 'LOW' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  requires_hr_review    BOOLEAN     NOT NULL DEFAULT FALSE,
  status_kasus          TEXT        NOT NULL DEFAULT 'OPEN' CHECK (status_kasus IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'NEED_HR_REVIEW', 'CANCELLED')),
  catatan_pembinaan     TEXT        DEFAULT '',
  catatan_internal      TEXT        DEFAULT '',
  masa_berlaku_bulan    INTEGER     NOT NULL DEFAULT 3 CHECK (masa_berlaku_bulan >= 1),
  expired_at            DATE        NOT NULL,
  status_poin           TEXT        NOT NULL DEFAULT 'ACTIVE' CHECK (status_poin IN ('ACTIVE', 'EXPIRED', 'CANCELLED')),
  show_evidence_to_user BOOLEAN     NOT NULL DEFAULT TRUE,
  user_notified_read    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by            UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name       TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disc_inc_user_date
  ON public.discipline_incidents(user_id, incident_date DESC);

CREATE INDEX IF NOT EXISTS idx_disc_inc_date
  ON public.discipline_incidents(incident_date DESC);

CREATE INDEX IF NOT EXISTS idx_disc_inc_status_poin
  ON public.discipline_incidents(status_poin, expired_at);

CREATE INDEX IF NOT EXISTS idx_disc_inc_posisi
  ON public.discipline_incidents(posisi);

CREATE INDEX IF NOT EXISTS idx_disc_inc_category
  ON public.discipline_incidents(kategori_nama);

-- ============================================================================
-- 3. TABEL: discipline_adjustments (Riwayat Koreksi / Pembatalan Poin)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.discipline_adjustments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id       UUID        NOT NULL REFERENCES public.discipline_incidents(id) ON DELETE RESTRICT,
  adjustment_type   TEXT        NOT NULL CHECK (adjustment_type IN ('REDUCE_POINTS', 'INCREASE_POINTS', 'CANCEL_INCIDENT', 'RESTORE_POINTS', 'APPEAL_APPROVED')),
  previous_points   INTEGER     NOT NULL,
  new_points        INTEGER     NOT NULL CHECK (new_points >= 0),
  previous_status   TEXT        NOT NULL,
  new_status        TEXT        NOT NULL,
  reason            TEXT        NOT NULL,
  appeal_id         UUID,
  created_by        UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name   TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disc_adj_incident
  ON public.discipline_adjustments(incident_id, created_at DESC);

-- ============================================================================
-- 4. TABEL: discipline_appeals (Klarifikasi User)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.discipline_appeals (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id         UUID        NOT NULL REFERENCES public.discipline_incidents(id) ON DELETE RESTRICT,
  user_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  user_name_snapshot  TEXT        NOT NULL,
  alasan              TEXT        NOT NULL,
  kronologi_user      TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  review_notes        TEXT        DEFAULT '',
  reviewed_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_by_name    TEXT,
  reviewed_at         TIMESTAMPTZ,
  user_result_read    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disc_app_incident
  ON public.discipline_appeals(incident_id);

CREATE INDEX IF NOT EXISTS idx_disc_app_user
  ON public.discipline_appeals(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_disc_app_status
  ON public.discipline_appeals(status, created_at DESC);

-- ============================================================================
-- 5. TABEL: discipline_attachments (Bukti Foto / File Kejadian & Klarifikasi)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.discipline_attachments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id       UUID        NOT NULL REFERENCES public.discipline_incidents(id) ON DELETE RESTRICT,
  appeal_id         UUID        REFERENCES public.discipline_appeals(id) ON DELETE SET NULL,
  source_type       TEXT        NOT NULL DEFAULT 'INCIDENT' CHECK (source_type IN ('INCIDENT', 'APPEAL')),
  storage_path      TEXT        NOT NULL,
  original_filename TEXT        NOT NULL,
  mime_type         TEXT        NOT NULL,
  file_size         INTEGER     NOT NULL CHECK (file_size > 0),
  uploaded_by       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_by_name  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disc_att_incident
  ON public.discipline_attachments(incident_id);

CREATE INDEX IF NOT EXISTS idx_disc_att_appeal
  ON public.discipline_attachments(appeal_id);

-- ============================================================================
-- 6. TABEL: discipline_settings (Pengaturan Modul Poin & Disiplin)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.discipline_settings (
  key               TEXT        PRIMARY KEY,
  value             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_by        UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by_name   TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 7. PRIVATE STORAGE BUCKET: discipline-attachments
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'discipline-attachments',
  'discipline-attachments',
  false,
  10485760, -- 10MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- 8. ROW LEVEL SECURITY (RLS) & DATA PRIVACY POLICIES
-- ============================================================================
ALTER TABLE public.discipline_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_settings ENABLE ROW LEVEL SECURITY;

-- Block anonymous direct PostgREST access completely
REVOKE ALL ON TABLE public.discipline_categories FROM anon;
REVOKE ALL ON TABLE public.discipline_incidents FROM anon;
REVOKE ALL ON TABLE public.discipline_adjustments FROM anon;
REVOKE ALL ON TABLE public.discipline_appeals FROM anon;
REVOKE ALL ON TABLE public.discipline_attachments FROM anon;
REVOKE ALL ON TABLE public.discipline_settings FROM anon;

-- Service Role Full Access Policies (used by Express backend)
DROP POLICY IF EXISTS "service_role_all_disc_categories" ON public.discipline_categories;
CREATE POLICY "service_role_all_disc_categories" ON public.discipline_categories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_disc_incidents" ON public.discipline_incidents;
CREATE POLICY "service_role_all_disc_incidents" ON public.discipline_incidents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_disc_adjustments" ON public.discipline_adjustments;
CREATE POLICY "service_role_all_disc_adjustments" ON public.discipline_adjustments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_disc_appeals" ON public.discipline_appeals;
CREATE POLICY "service_role_all_disc_appeals" ON public.discipline_appeals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_disc_attachments" ON public.discipline_attachments;
CREATE POLICY "service_role_all_disc_attachments" ON public.discipline_attachments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_disc_settings" ON public.discipline_settings;
CREATE POLICY "service_role_all_disc_settings" ON public.discipline_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated User Policies (Defense-in-Depth if PostgREST JWT is used)
-- User hanya dapat membaca kejadian miliknya sendiri (user_id = auth.uid())
DROP POLICY IF EXISTS "user_select_own_incidents" ON public.discipline_incidents;
CREATE POLICY "user_select_own_incidents" ON public.discipline_incidents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- User hanya dapat membaca dan mengajukan klarifikasi untuk kejadian miliknya sendiri
DROP POLICY IF EXISTS "user_select_own_appeals" ON public.discipline_appeals;
CREATE POLICY "user_select_own_appeals" ON public.discipline_appeals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_insert_own_appeals" ON public.discipline_appeals;
CREATE POLICY "user_insert_own_appeals" ON public.discipline_appeals
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.discipline_incidents i
      WHERE i.id = discipline_appeals.incident_id
        AND i.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 9. SEED DATA: Default Master Pelanggaran & Pengaturan Awal
-- ============================================================================
INSERT INTO public.discipline_categories (
  nama_kategori, nama_pelanggaran, deskripsi, default_poin, severity, requires_hr_review, masa_berlaku_bulan, is_active, created_by_name
)
VALUES
  ('Kehadiran', 'Terlambat briefing', 'Datang terlambat saat jadwal briefing operasional dimulai.', 1, 'LOW', false, 3, true, 'System'),
  ('Prosedur', 'Tidak mengikuti SOP', 'Melakukan pekerjaan tidak sesuai Standar Operasional Prosedur yang berlaku.', 3, 'MEDIUM', false, 3, true, 'System'),
  ('Picking', 'Salah SKU / Salah Qty', 'Kesalahan pengambilan item SKU atau jumlah kuantitas barang saat picking.', 3, 'MEDIUM', false, 3, true, 'System'),
  ('Inventory', 'Salah movement / tidak update transaksi', 'Kesalahan perpindahan barang atau kelalaian memperbarui pencatatan transaksi.', 3, 'MEDIUM', false, 3, true, 'System'),
  ('Safety', 'Tidak menggunakan APD', 'Tidak mengenakan Alat Pelindung Diri standar di area kerja.', 3, 'MEDIUM', false, 3, true, 'System'),
  ('K3', 'Pelanggaran K3 berisiko tinggi', 'Tindakan tidak aman yang menimbulkan risiko tinggi terhadap keselamatan kerja.', 5, 'HIGH', false, 6, true, 'System'),
  ('Disiplin', 'Meninggalkan area tanpa izin', 'Meninggalkan zona atau area tanggung jawab kerja tanpa izin atasan/leader.', 2, 'LOW', false, 3, true, 'System'),
  ('Integritas & Berat', 'Manipulasi data / Fraud / Pelanggaran Integritas', 'Tindakan manipulasi data pencapaian, ketidakjujuran, atau pelanggaran integritas berat. Keputusan tindak lanjut ditentukan oleh Atasan / HR.', 10, 'CRITICAL', true, 6, true, 'System'),
  ('K3 Berat', 'Kecelakaan akibat pelanggaran berat', 'Insiden kecelakaan kerja yang disebabkan oleh kelalaian atau pelanggaran prosedur berat. Memerlukan review Atasan / HR.', 10, 'CRITICAL', true, 6, true, 'System')
ON CONFLICT DO NOTHING;

INSERT INTO public.discipline_settings (key, value, updated_by_name)
VALUES (
  'general',
  jsonb_build_object(
    'default_expiry_months', 3,
    'allow_admin_override_points', true,
    'repeat_incident_days', 30,
    'repeat_incident_threshold', 2,
    'enable_hr_review_threshold', false,
    'hr_review_point_threshold', 6,
    'show_evidence_to_user_default', true,
    'enable_user_appeals', true,
    'enable_notifications', true
  ),
  'System'
)
ON CONFLICT (key) DO NOTHING;

SELECT 'Migrasi Modul Poin Disiplin & Catatan Kinerja SS08 selesai!' AS status;
