// Migration: tambah kolom status ke tabel submissions via Supabase Management API
require('dotenv').config();
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Extract project ref dari URL: https://xxxx.supabase.co -> xxxx
const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];

console.log('Project ref:', projectRef);

const sql = [
  "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'approved';",
  "UPDATE submissions SET status = 'approved' WHERE status IS NULL;"
].join('\n');

const body = JSON.stringify({ query: sql });

// Supabase v2 SQL endpoint
const options = {
  hostname: new URL(SUPABASE_URL).hostname,
  path: '/rest/v1/rpc/exec_sql',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Length': Buffer.byteLength(body),
    'Prefer': 'return=representation'
  }
};

function tryRequest(path, data, callback) {
  const opts = { ...options, path };
  const req = https.request(opts, res => {
    let responseData = '';
    res.on('data', chunk => responseData += chunk);
    res.on('end', () => callback(null, res.statusCode, responseData));
  });
  req.on('error', e => callback(e));
  req.write(data);
  req.end();
}

// Try Management API
const mgmtBody = JSON.stringify({ query: sql });
const mgmtOptions = {
  hostname: 'api.supabase.com',
  path: `/v1/projects/${projectRef}/database/query`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Length': Buffer.byteLength(mgmtBody)
  }
};

console.log('Trying Supabase Management API...');
const mgmtReq = https.request(mgmtOptions, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Management API status:', res.statusCode);
    console.log('Response:', data.substring(0, 500));
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('\n✅ Migration berhasil!');
    } else {
      console.log('\n❌ Management API gagal. Coba cara lain...');
      // Try direct postgres connection via pooler
      tryDirectInsert();
    }
  });
});
mgmtReq.on('error', e => {
  console.error('Management API error:', e.message);
  tryDirectInsert();
});
mgmtReq.write(mgmtBody);
mgmtReq.end();

function tryDirectInsert() {
  // Coba insert dengan field status untuk test apakah kolom sudah ada
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  supabase.from('submissions').select('status').limit(1).then(({ data, error }) => {
    if (!error) {
      console.log('✅ Kolom status sudah ada!');
    } else if (error.message.includes('does not exist') || error.code === '42703') {
      console.log('\n📋 Kolom status belum ada. Jalankan SQL ini di Supabase Dashboard > SQL Editor:');
      console.log('=====================================');
      console.log(sql);
      console.log('=====================================');
      console.log('\nLink: https://app.supabase.com/project/' + projectRef + '/editor');
    } else {
      console.error('Error:', error);
    }
    process.exit(0);
  });
}
