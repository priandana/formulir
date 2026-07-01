const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const target = '    // Validasi: lembar register wajib diupload - REMOVED';

const injection = [
  '    // ===== CEK ABSENSI =====',
  '    // Jika fitur absensi aktif, user harus terdaftar hadir untuk tanggal_carian',
  '    const { user_id: submittedUserId } = req.body;',
  '    if (submittedUserId) {',
  '      try {',
  '        const absensiSettings = await db.getAbsensiSettings();',
  '        if (absensiSettings.absensi_required) {',
  '          const hadir = await db.isUserAbsen(tanggal_carian, submittedUserId);',
  '          if (!hadir) {',
  '            return res.status(403).json({',
  "              error: 'Kamu belum diabsen untuk tanggal ini. Hubungi admin untuk mendaftarkan kehadiranmu.',",
  "              code: 'NOT_ABSEN'",
  '            });',
  '          }',
  '        }',
  '      } catch (absenErr) {',
  "        console.warn('Absensi check warning (allowing submit):', absenErr.message);",
  '      }',
  '    }',
  '    // ===== AKHIR CEK ABSENSI =====',
  ''
].join('\n');

if (!content.includes(target)) {
  console.error('Target not found!');
  process.exit(1);
}

// Check not already patched
if (content.includes('CEK ABSENSI')) {
  console.log('Already patched, skipping.');
  process.exit(0);
}

content = content.replace(target, injection + target);
fs.writeFileSync('server.js', content, 'utf8');
console.log('Done! Lines:', content.split('\n').length);
