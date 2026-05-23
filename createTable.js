require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false }
});

async function createDataCarianTable() {
  console.log('Mencoba membuat tabel data_carian di Supabase...');

  // Coba insert dummy record untuk cek apakah tabel sudah ada
  const { error: checkError } = await supabase.from('data_carian').select('id').limit(1);

  if (!checkError) {
    console.log('✅ Tabel data_carian sudah ada!');
    return;
  }

  console.log('Tabel belum ada, mencoba membuat via RPC...');
  console.log('Error saat check:', checkError.message);

  // Coba via rpc jika ada fungsi exec_sql
  const sql = `
    CREATE TABLE IF NOT EXISTS public.data_carian (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tanggal_carian DATE NOT NULL,
      posisi TEXT NOT NULL,
      zona TEXT NOT NULL,
      batch TEXT NOT NULL,
      total_output INTEGER NOT NULL,
      satuan TEXT NOT NULL DEFAULT 'pcs',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  // Gunakan Supabase Management API
  const projectRef = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
  const managementApiUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  console.log('\n======================================================');
  console.log('INSTRUKSI MANUAL:');
  console.log('======================================================');
  console.log('Buka Supabase SQL Editor:');
  console.log(`https://supabase.com/dashboard/project/${projectRef}/sql/new`);
  console.log('\nCopy-paste SQL ini dan klik Run:\n');
  console.log(sql);
  console.log('======================================================\n');
}

createDataCarianTable().catch(console.error);
