-- ================================================================
-- Migration: Tabel QC Outbound
-- Jalankan di Supabase SQL Editor
-- ================================================================

CREATE TABLE IF NOT EXISTS qc_outbound (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal             DATE NOT NULL,
  tanggal_carian      DATE NOT NULL DEFAULT CURRENT_DATE,
  tanggal_kirim       DATE NOT NULL DEFAULT CURRENT_DATE,
  no_polisi           TEXT NOT NULL,
  nama_qc             TEXT NOT NULL,
  zona                TEXT DEFAULT '',
  kontainer           INT NOT NULL DEFAULT 0,
  styrofoam           INT NOT NULL DEFAULT 0,
  dus                 INT NOT NULL DEFAULT 0,
  non_group           JSONB DEFAULT '{"gacoan":0,"dikichi":0,"benfarm":0}'::jsonb,
  clusters_breakdown  JSONB DEFAULT '{}'::jsonb,
  target_rps_info     JSONB DEFAULT '{}'::jsonb,
  catatan             TEXT DEFAULT '',
  created_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Index untuk query per tanggal (performa)
CREATE INDEX IF NOT EXISTS idx_qc_outbound_tanggal ON qc_outbound (tanggal);
CREATE INDEX IF NOT EXISTS idx_qc_outbound_tgl_carian ON qc_outbound (tanggal_carian);

-- Unique constraint: 1 nopol hanya boleh 1 entry per tanggal carian
CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_outbound_tanggal_nopol 
  ON qc_outbound (tanggal_carian, no_polisi);

COMMENT ON TABLE qc_outbound IS 'Data QC Outbound: input kontainer, styrofoam, dus actual, foto, dan non-group per armada per hari';
