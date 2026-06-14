require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  const { data: entries, error: err1 } = await supabase.from('loader_entries').select('*');
  if (err1) console.error(err1);
  console.log('Loader Entries:', JSON.stringify(entries, null, 2));

  const { data: files, error: err2 } = await supabase.from('files').select('*');
  if (err2) console.error(err2);
  console.log('Files:', JSON.stringify(files, null, 2));
}

main().catch(console.error);
