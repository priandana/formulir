require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const isSupabaseEnabled = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);

async function runFix() {
  console.log('--- STARTING FIX FOR USER TYPES ---');
  console.log('Database Mode: ', isSupabaseEnabled ? 'Supabase Cloud' : 'LowDB Local');

  if (isSupabaseEnabled) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    
    // 1. Fetch users sorted by created_at descending (latest first, exactly like the admin table)
    console.log('Fetching users from Supabase...');
    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, nama_lengkap, created_at, tipe_karyawan')
      .eq('role', 'operasional')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching users:', error);
      process.exit(1);
    }

    console.log(`Total users found: ${users.length}`);

    // 2. We want:
    // Rows 1 to 63 (indices 0 to 62) -> PHL
    // Rows 64 to 81 (indices 63 onwards) -> Productivity (restoring original state)
    
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const targetType = i < 63 ? 'PHL' : 'Productivity';
      
      if (u.tipe_karyawan !== targetType) {
        console.log(`[${i + 1}/${users.length}] Updating ${u.nama_lengkap} (${u.username}) from ${u.tipe_karyawan || 'null'} to ${targetType}...`);
        const { error: updateErr } = await supabase
          .from('users')
          .update({ tipe_karyawan: targetType })
          .eq('id', u.id);

        if (updateErr) {
          console.error(`Failed to update ${u.nama_lengkap}:`, updateErr);
        }
      } else {
        // console.log(`[${i + 1}/${users.length}] ${u.nama_lengkap} is already ${targetType}.`);
      }
    }
    console.log('✅ Supabase fix completed.');
  } else {
    // LowDB Local fallback
    const dbPath = path.join(__dirname, '..', 'database.json');
    if (!fs.existsSync(dbPath)) {
      console.error('database.json not found!');
      process.exit(1);
    }
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    
    // Sort operasional users by created_at descending
    const opUsers = db.users
      .filter(u => u.role === 'operasional')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    console.log(`Total local users found: ${opUsers.length}`);
    
    const targetPhlIds = new Set(opUsers.slice(0, 63).map(u => u.id));

    db.users = db.users.map(u => {
      if (u.role === 'operasional') {
        const targetType = targetPhlIds.has(u.id) ? 'PHL' : 'Productivity';
        return { ...u, tipe_karyawan: targetType };
      }
      return u;
    });

    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    console.log('✅ Local database.json fix completed.');
  }
  console.log('--- FIX COMPLETED SUCCESSFULLY ---');
}

runFix().catch(err => {
  console.error('Error during fix:', err);
  process.exit(1);
});
