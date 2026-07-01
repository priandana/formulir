const fs = require('fs');
let html = fs.readFileSync('public/admin.html', 'utf8');

// Fix: openAbsensiSettings uses .classList.add('open') but should use 'visible'
if (html.includes("document.getElementById('absensiSettingsModal').classList.add('open')")) {
  html = html.replace(
    "document.getElementById('absensiSettingsModal').classList.add('open')",
    "document.getElementById('absensiSettingsModal').classList.add('visible')"
  );
  console.log('openAbsensiSettings class fixed: open -> visible');
}

// Also fix the absensi modal - it was using 'open' in the JS script injected earlier
// The closeModal in admin.html uses 'visible' (from admin.js closeModal function)
// The absensiSettingsModal close button calls closeModal('absensiSettingsModal') which removes 'visible' - OK

fs.writeFileSync('public/admin.html', html, 'utf8');
console.log('Done');
