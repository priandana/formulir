const fs = require('fs');

// ====== PATCH 1: server.js — add userId to check-auth response ======
let server = fs.readFileSync('server.js', 'utf8');
const oldCheckAuth = [
  '      return res.json({',
  '        authenticated: true,',
  '        username: decoded.username,',
  '        nama_lengkap: decoded.nama_lengkap || decoded.username,',
  '        role: decoded.role || \'admin\',',
  '        posisi: decoded.posisi || null',
  '      });'
].join('\n');
const newCheckAuth = [
  '      return res.json({',
  '        authenticated: true,',
  '        userId: decoded.userId || null,',
  '        username: decoded.username,',
  '        nama_lengkap: decoded.nama_lengkap || decoded.username,',
  '        role: decoded.role || \'admin\',',
  '        posisi: decoded.posisi || null',
  '      });'
].join('\n');
if (!server.includes('userId: decoded.userId')) {
  if (!server.includes(oldCheckAuth)) {
    console.error('check-auth target not found!');
    console.log('Looking for:\n' + JSON.stringify(oldCheckAuth));
    process.exit(1);
  }
  server = server.replace(oldCheckAuth, newCheckAuth);
  console.log('check-auth patched');
} else {
  console.log('check-auth already patched');
}
fs.writeFileSync('server.js', server, 'utf8');

// ====== PATCH 2: index.js — append user_id to FormData and handle NOT_ABSEN ======
let idx = fs.readFileSync('public/js/index.js', 'utf8');

// Patch Picker/Sorter form (line ~1009)
const oldFd1 = "  fd.append('catatan_tambahan',  finalCatatan);\n  fd.append('batch_outputs',     JSON.stringify(batchOutputs));";
const newFd1 = "  fd.append('catatan_tambahan',  finalCatatan);\n  fd.append('batch_outputs',     JSON.stringify(batchOutputs));\n  if (currentUser && currentUser.userId) fd.append('user_id', currentUser.userId);";

// Patch error handler for NOT_ABSEN (picker)
const oldErr1 = "    } else {\n      showToast(d.error || 'Terjadi kesalahan. Coba lagi.', 'error');\n    }\n  } catch(err) {\n    showToast('Gagal menghubungi server. Periksa koneksi Anda.', 'error');\n  } finally {\n    btn.classList.remove('loading'); btn.disabled = false;\n  }\n});\n\nfunction psClearForm";
const newErr1 = "    } else {\n      if (d.code === 'NOT_ABSEN') {\n        showAbsensiBlockedToast(d.error);\n      } else {\n        showToast(d.error || 'Terjadi kesalahan. Coba lagi.', 'error');\n      }\n    }\n  } catch(err) {\n    showToast('Gagal menghubungi server. Periksa koneksi Anda.', 'error');\n  } finally {\n    btn.classList.remove('loading'); btn.disabled = false;\n  }\n});\n\nfunction psClearForm";

let changed = 0;
if (!idx.includes("if (currentUser && currentUser.userId) fd.append('user_id'")) {
  if (idx.includes(oldFd1)) {
    idx = idx.replaceAll(oldFd1, newFd1);
    changed++;
    console.log('FormData user_id append patched');
  } else {
    // Try alternate (loader form uses same pattern but different variable)
    const oldFd2 = "fd.append('catatan_tambahan',  finalCatatan);\n  fd.append('batch_outputs',     JSON.stringify(batchOutputs));";
    if (idx.includes(oldFd2)) {
      idx = idx.replaceAll(oldFd2, newFd1);
      changed++;
      console.log('FormData user_id append patched (alt)');
    } else {
      console.log('WARNING: FormData target not found, trying simpler approach');
      // Just add user_id right before fetch('/api/submit'
      const fetchTarget = "const r = await fetch('/api/submit', { method: 'POST', body: fd });";
      if (idx.includes(fetchTarget)) {
        idx = idx.replaceAll(
          fetchTarget,
          "if (currentUser && currentUser.userId) fd.append('user_id', currentUser.userId);\n  const r = await fetch('/api/submit', { method: 'POST', body: fd });"
        );
        changed++;
        console.log('FormData user_id patched before fetch');
      }
    }
  }
} else {
  console.log('FormData already patched');
  changed++;
}

// Patch NOT_ABSEN error handling
if (!idx.includes("NOT_ABSEN")) {
  if (idx.includes(oldErr1)) {
    idx = idx.replace(oldErr1, newErr1);
    console.log('NOT_ABSEN error handler patched');
  } else {
    console.log('WARNING: error handler target not found');
  }
}

// Add showAbsensiBlockedToast function at end of file (before last line)
if (!idx.includes('showAbsensiBlockedToast')) {
  idx = idx + '\n\nfunction showAbsensiBlockedToast(msg) {\n' +
    '  // Create a prominent blocked notification\n' +
    '  const existing = document.getElementById(\'absensiBlockedNotif\');\n' +
    '  if (existing) existing.remove();\n' +
    '  const el = document.createElement(\'div\');\n' +
    '  el.id = \'absensiBlockedNotif\';\n' +
    '  el.style.cssText = \'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;background:linear-gradient(135deg,#EF4444,#DC2626);color:#fff;padding:16px 24px 16px 20px;border-radius:14px;box-shadow:0 8px 32px rgba(239,68,68,0.4);font-size:14px;font-weight:600;max-width:480px;text-align:center;display:flex;align-items:center;gap:12px;animation:slideDown 0.3s ease;\';\n' +
    '  el.innerHTML = \'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>\' + (msg || \'Kamu belum diabsen untuk tanggal ini.\') + \'</span>\';\n' +
    '  document.body.appendChild(el);\n' +
    '  setTimeout(() => { el.style.opacity=\'0\'; el.style.transition=\'opacity 0.4s\'; setTimeout(() => el.remove(), 400); }, 5000);\n' +
    '}\n';
  console.log('showAbsensiBlockedToast function added');
}

fs.writeFileSync('public/js/index.js', idx, 'utf8');
console.log('Done! index.js lines:', idx.split('\n').length);
