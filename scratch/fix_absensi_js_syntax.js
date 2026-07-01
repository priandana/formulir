const fs = require('fs');

let html = fs.readFileSync('public/admin.html', 'utf8');

const targetLine = "    return '<div class=\"absensi-user-card' + (hadir ? ' hadir' : '') + '\" onclick=\"toggleAbsensi(\'\' + user.id + \'\', \'\' + (absenRecord ? absenRecord.id : \'\') + \'\')\" data-user-id=\"' + user.id + '\" data-nama=\"\' + (user.nama_lengkap || \'\').toLowerCase() + \'\"\u003e\' +";

// We want to replace it with:
const replacementLine = "    return '<div class=\"absensi-user-card' + (hadir ? ' hadir' : '') + '\" onclick=\"window.toggleAbsensi(\\\'' + user.id + '\\\', \\\'' + (absenRecord ? absenRecord.id : '') + '\\\')\" data-user-id=\"' + user.id + '\" data-nama=\"' + (user.nama_lengkap || '').toLowerCase() + '\">\' +";

// Let's search by string without backslash complexity to be 100% sure we match
const targetSub = `onclick="toggleAbsensi('' + user.id + '', '' + (absenRecord ? absenRecord.id : '') + '')"`;
const replacementSub = `onclick="window.toggleAbsensi('\\'' + user.id + '\\'', \\'' + (absenRecord ? absenRecord.id : '') + '\\'')"`;

if (html.includes(targetSub)) {
  html = html.replace(targetSub, replacementSub);
  console.log('Fixed targetSub successfully');
} else {
  console.log('Target string not found, trying exact line match');
  // fallback exact replace
  const oldLine = `    return '<div class="absensi-user-card' + (hadir ? ' hadir' : '') + '" onclick="toggleAbsensi(\'\' + user.id + \'\', \'\' + (absenRecord ? absenRecord.id : \'\') + \'\')" data-user-id="' + user.id + '" data-nama="' + (user.nama_lengkap || '').toLowerCase() + '">' +`;
  const newLine = `    return '<div class="absensi-user-card' + (hadir ? ' hadir' : '') + '" onclick="window.toggleAbsensi(\\\'' + user.id + '\\\', \\\'' + (absenRecord ? absenRecord.id : '') + '\\\')" data-user-id="' + user.id + '" data-nama="' + (user.nama_lengkap || '').toLowerCase() + '">' +`;
  if (html.includes(oldLine)) {
    html = html.replace(oldLine, newLine);
    console.log('Fixed exact line successfully');
  } else {
    console.error('Failed to find matching line in public/admin.html');
  }
}

fs.writeFileSync('public/admin.html', html, 'utf8');
console.log('Write complete');
