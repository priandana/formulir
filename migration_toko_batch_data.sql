-- Migration: Tabel toko_batch_data untuk menyimpan data per toko dari upload Excel
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS toko_batch_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal_carian DATE NOT NULL,
  group_mob TEXT DEFAULT '',
  kcc TEXT DEFAULT '',
  ins TEXT DEFAULT '',
  nama_toko TEXT NOT NULL,
  zona TEXT NOT NULL,
  tipe_lokasi TEXT DEFAULT '',
  batch TEXT DEFAULT '',
  qty_target INTEGER DEFAULT 0,
  kont_target INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_toko_batch_tanggal ON toko_batch_data(tanggal_carian);
CREATE INDEX IF NOT EXISTS idx_toko_batch_zona ON toko_batch_data(zona);
