-- Migration: Buat tabel ketentuan_harga
-- Jalankan di Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ketentuan_harga (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posisi TEXT NOT NULL CHECK (posisi IN ('Picker', 'Sorter', 'Loader')),
  zona TEXT NOT NULL,
  harga INTEGER NOT NULL DEFAULT 0,
  satuan TEXT NOT NULL DEFAULT 'pcs',
  keterangan TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: 1 harga per kombinasi posisi+zona
CREATE UNIQUE INDEX IF NOT EXISTS idx_ketentuan_harga_posisi_zona ON ketentuan_harga(posisi, zona);

-- RLS policies
ALTER TABLE ketentuan_harga ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ketentuan_harga FOR ALL USING (true) WITH CHECK (true);

-- Trigger update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_ketentuan_harga_updated_at
  BEFORE UPDATE ON ketentuan_harga
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
