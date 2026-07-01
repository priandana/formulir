const http = require('http');

// Make a mock post request to local server
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
  '[]',
  `--${boundary}--`
].join('\r\n');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/submit',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  console.log('STATUS:', res.statusCode);
  console.log('HEADERS:', JSON.stringify(res.headers, null, 2));
  
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('BODY:', body);
  });
});

req.on('error', (e) => {
  console.error('Problem with request:', e.message);
});

req.write(data);
req.end();
