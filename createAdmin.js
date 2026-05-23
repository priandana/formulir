require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false }
});

async function createAdminUser() {
  console.log('Mengecek user admin di Supabase...');

  // Cek apakah admin sudah ada
  const { data: existing, error: checkErr } = await supabase
    .from('users')
    .select('id, username')
    .eq('username', 'admin')
    .maybeSingle();

  if (checkErr) {
    console.error('Error saat cek user:', checkErr.message);
    return;
  }

  if (existing) {
    console.log('✅ User admin sudah ada di Supabase! ID:', existing.id);
    console.log('Jika password salah, reset dengan menjalankan script ini lagi setelah menghapus user lama.');
    return;
  }

  // Buat user admin baru
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  const { data, error } = await supabase
    .from('users')
    .insert([{
      id: uuidv4(),
      username: 'admin',
      password: hashedPassword,
      created_at: new Date().toISOString()
    }])
    .select()
    .single();

  if (error) {
    console.error('❌ Gagal membuat admin:', error.message);
    console.log('\nCoba jalankan SQL ini di Supabase SQL Editor:');
    console.log(`
INSERT INTO public.users (id, username, password, created_at)
VALUES (
  gen_random_uuid(),
  'admin',
  '${hashedPassword}',
  NOW()
);
    `);
    return;
  }

  console.log('✅ User admin berhasil dibuat!');
  console.log('   Username: admin');
  console.log('   Password: admin123');
  console.log('   ID:', data.id);
}

createAdminUser().catch(console.error);
