require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkAdmins() {
  console.log('Querying Supabase users table for admin accounts...');
  const { data, error } = await supabase
    .from('users')
    .select('id, username, role, created_at');
    
  if (error) {
    console.error('Error querying users:', error);
  } else {
    console.log('Users found in Supabase:', data);
  }
}

checkAdmins().catch(console.error);
