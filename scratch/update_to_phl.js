require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const isSupabaseEnabled = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);

async function runUpdate() {
  console.log('--- STARTING UPDATE 1-63 TO PHL ---');
  console.log('Database Mode: ', isSupabaseEnabled ? 'Supabase Cloud' : 'LowDB Local');

  if (isSupabaseEnabled) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    
    // 1. Fetch users sorted by created_at ascending
    console.log('Fetching users from Supabase...');
    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, nama_lengkap, created_at, tipe_karyawan')
      .eq('role', 'operasional')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching users:', error);
      process.exit(1);
    }

    console.log(`Total users found: ${users.length}`);

    // 2. Select the first 63 users
    const targetUsers = users.slice(0, 63);
    console.log(`Targeting the first ${targetUsers.length} users for update to PHL.`);

    // 3. Update them
    for (let i = 0; i < targetUsers.length; i++) {
      const u = targetUsers[i];
      console.log(`[${i + 1}/63] Updating ${u.nama_lengkap} (${u.username})...`);
      
      const { error: updateErr } = await supabase
        .from('users')
        .update({ tipe_karyawan: 'PHL' })
        .eq('id', u.id);

      if (updateErr) {
        console.error(`Failed to update ${u.nama_lengkap}:`, updateErr);
      }
    }
    console.log('✅ Supabase update completed.');
  } else {
    // LowDB Local fallback
    const dbPath = path.join(__dirname, '..', 'database.json');
    if (!fs.existsSync(dbPath)) {
      console.error('database.json not found!');
      process.exit(1);
    }
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    
    // Sort operasional users by created_at
    const opUsers = db.users
      .filter(u => u.role === 'operasional')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    console.log(`Total local users found: ${opUsers.length}`);
    const targetUsers = opUsers.slice(0, 63);
    const targetIds = new Set(targetUsers.map(u => u.id));

    db.users = db.users.map(u => {
      if (targetIds.has(u.id)) {
        return { ...u, tipe_karyawan: 'PHL' };
      }
      return u;
    });

    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    console.log('✅ Local database.json update completed.');
  }
  console.log('--- UPDATE COMPLETED SUCCESSFULLY ---');
}

runUpdate().catch(err => {
  console.error('Error during update:', err);
  process.exit(1);
});
