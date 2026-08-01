-- ================================================================
-- Migration: Tabel QC Outbound
-- Jalankan di Supabase SQL Editor
-- ================================================================

CREATE TABLE IF NOT EXISTS qc_outbound (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal     DATE NOT NULL,
  no_polisi   TEXT NOT NULL,
  kontainer   INT NOT NULL DEFAULT 0,
  styrofoam   INT NOT NULL DEFAULT 0,
  dus         INT NOT NULL DEFAULT 0,
  catatan     TEXT DEFAULT '',
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index untuk query per tanggal (performa)
CREATE INDEX IF NOT EXISTS idx_qc_outbound_tanggal ON qc_outbound (tanggal);

-- Unique constraint: 1 nopol hanya boleh 1 entry per hari
CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_outbound_tanggal_nopol 
  ON qc_outbound (tanggal, no_polisi);

-- Enable Row Level Security (opsional, sesuaikan dengan setup Supabase kamu)
-- ALTER TABLE qc_outbound ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE qc_outbound IS 'Data QC Outbound: input kontainer, styrofoam, dus actual per armada per hari';
