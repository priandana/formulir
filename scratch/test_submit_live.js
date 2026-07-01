const https = require('https');

const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
const data = [
  `--${boundary}`,
  'Content-Disposition: form-data; name="tanggal_carian"',
  '',
  '2026-06-28',
  `--${boundary}`,
  'Content-Disposition: form-data; name="tanggal_pengerjaan"',
  '',
  '2026-06-28',
  `--${boundary}`,
  'Content-Disposition: form-data; name="nama"',
  '',
  'Test User',
  `--${boundary}`,
  'Content-Disposition: form-data; name="posisi"',
  '',
  'Picker',
  `--${boundary}`,
  'Content-Disposition: form-data; name="tipe_lokasi"',
  '',
  'Chiller (R)',
  `--${boundary}`,
  'Content-Disposition: form-data; name="zona"',
  '',
  'R1',
  `--${boundary}`,
  'Content-Disposition: form-data; name="batch_outputs"',
  '',
  '[{"batch":"1","jumlah":"10"}]',
  `--${boundary}`,
  'Content-Disposition: form-data; name="user_id"',
  '',
  'd0000000-0000-0000-0000-000000000000', // Non-existent user UUID
  `--${boundary}--`
].join('\r\n');

const options = {
  hostname: 'formulir-pencapaian-kerja.vercel.app',
  path: '/api/submit',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  console.log('VERCEL STATUS:', res.statusCode);
  console.log('VERCEL HEADERS:', JSON.stringify(res.headers, null, 2));
  
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('VERCEL BODY:', body);
  });
});

req.on('error', (e) => {
  console.error('Problem with request:', e.message);
});

req.write(data);
req.end();
