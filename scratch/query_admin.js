require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkAdmin() {
  console.log('Querying Supabase users table for admin user...');
  const { data, error } = await supabase
    .from('users')
    .select('id, username, role, password')
    .eq('username', 'admin')
    .maybeSingle();
    
  if (error) {
    console.error('Error querying users:', error);
  } else {
    console.log('Admin user found in Supabase:', data);
  }
}

checkAdmin().catch(console.error);
