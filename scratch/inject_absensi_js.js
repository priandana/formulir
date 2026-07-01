const fs = require('fs');
let html = fs.readFileSync('public/admin.html', 'utf8');

// 1. Add CSS link in <head>
if (!html.includes('absensi.css')) {
  html = html.replace(
    '<link rel="stylesheet" href="/css/admin.css?v=1.3">',
    '<link rel="stylesheet" href="/css/admin.css?v=1.3">\n  <link rel="stylesheet" href="/css/absensi.css?v=1.0">'
  );
  console.log('CSS link added');
}

// 2. Add absensi settings modal before </body>
const modalHtml = `
<!-- ===== ABSENSI SETTINGS MODAL ===== -->
<div class="modal-overlay" id="absensiSettingsModal">
  <div class="modal">
    <div class="modal-header">
      <h3>Pengaturan Absensi</h3>
      <button class="modal-close" onclick="closeModal('absensiSettingsModal')">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="absensi-toggle-row">
        <div>
          <div class="absensi-toggle-label">Wajib Absen untuk Input Formulir</div>
          <div class="absensi-toggle-desc">Jika aktif, user yang tidak diabsen tidak dapat submit formulir untuk tanggal tersebut.</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="toggleAbsensiRequired" onchange="saveAbsensiSettings()">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="absensi-toggle-row">
        <div>
          <div class="absensi-toggle-label">Tampilkan Rekap Kehadiran ke User</div>
          <div class="absensi-toggle-desc">Jika aktif, user dapat melihat siapa saja yang hadir hari ini di halaman formulir.</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="toggleAbsensiVisible" onchange="saveAbsensiSettings()">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div id="absensiSettingsSaveStatus" style="margin-top:12px; font-size:13px; color:var(--success); display:none; text-align:center; font-weight:600;">
        ✓ Pengaturan berhasil disimpan
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="closeModal('absensiSettingsModal')">Tutup</button>
    </div>
  </div>
</div>
`;

if (!html.includes('absensiSettingsModal')) {
  html = html.replace('</body>', modalHtml + '\n</body>');
  console.log('Modal added');
}

// 3. Add absensi JS before </body>
const absensiJs = `
<script>
// ===================== ABSENSI MODULE =====================
let absensiAllUsers = [];   // all operational users
let absensiPresent = [];    // current attendance records for selected date
let absensiSettings = { absensi_required: false, absensi_visible_to_user: false };

async function initAbsensiPage() {
  // Set today as default date
  const today = new Date().toISOString().split('T')[0];
  const inp = document.getElementById('absensiTanggal');
  if (inp && !inp.value) inp.value = today;

  await Promise.all([
    loadAbsensiUsers(),
    loadAbsensiSettingsUI()
  ]);
  await loadAbsensiForDate();
}

async function loadAbsensiUsers() {
  try {
    const res = await fetch('/api/users', { credentials: 'include' });
    if (!res.ok) return;
    absensiAllUsers = await res.json();
  } catch(e) { console.error('loadAbsensiUsers:', e); }
}

async function loadAbsensiSettingsUI() {
  try {
    const res = await fetch('/api/settings/absensi');
    absensiSettings = await res.json();
    // Update toggles
    const req = document.getElementById('toggleAbsensiRequired');
    const vis = document.getElementById('toggleAbsensiVisible');
    if (req) req.checked = absensiSettings.absensi_required;
    if (vis) vis.checked = absensiSettings.absensi_visible_to_user;
    // Update status banner
    updateAbsensiStatusBanner();
  } catch(e) { console.error('loadAbsensiSettingsUI:', e); }
}

function updateAbsensiStatusBanner() {
  const banner = document.getElementById('absensiStatusBanner');
  if (!banner) return;
  if (absensiSettings.absensi_required) {
    banner.style.display = 'flex';
    banner.className = 'absensi-status-banner active';
    banner.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Sistem absensi <strong style="margin:0 4px">AKTIF</strong> — user yang tidak diabsen tidak bisa input formulir.';
  } else {
    banner.style.display = 'flex';
    banner.className = 'absensi-status-banner inactive';
    banner.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Sistem absensi <strong style="margin:0 4px">NONAKTIF</strong> — semua user bebas input formulir.';
  }
}

async function loadAbsensiForDate() {
  const tanggal = document.getElementById('absensiTanggal')?.value;
  if (!tanggal) return;

  try {
    const res = await fetch('/api/absensi?tanggal=' + tanggal, { credentials: 'include' });
    if (!res.ok) return;
    absensiPresent = await res.json();
    renderAbsensiUserList();
    renderAbsensiRekap();
  } catch(e) { console.error('loadAbsensiForDate:', e); }
}

function renderAbsensiUserList() {
  const container = document.getElementById('absensiUserList');
  const statsRow = document.getElementById('absensiStatsRow');
  const search = (document.getElementById('absensiSearch')?.value || '').toLowerCase();
  if (!container) return;

  if (absensiAllUsers.length === 0) {
    container.innerHTML = '<div class="absensi-empty-state"><svg width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="opacity:0.35; margin-bottom:12px;"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg><p>Belum ada karyawan terdaftar. Tambahkan karyawan di halaman Manajemen User.</p></div>';
    return;
  }

  const presentIds = new Set(absensiPresent.map(a => a.user_id));
  const filtered = absensiAllUsers.filter(u => {
    if (!search) return true;
    return (u.nama_lengkap || '').toLowerCase().includes(search) ||
           (u.posisi || '').toLowerCase().includes(search) ||
           (u.username || '').toLowerCase().includes(search);
  });

  // Update stats
  if (statsRow) {
    statsRow.style.display = 'grid';
    document.getElementById('statHadir').textContent = presentIds.size;
    document.getElementById('statBelumHadir').textContent = absensiAllUsers.length - presentIds.size;
    document.getElementById('statTotalUser').textContent = absensiAllUsers.length;
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="absensi-empty-state"><p>Tidak ada karyawan yang cocok dengan pencarian.</p></div>';
    return;
  }

  // Sort: hadir first
  const sorted = [...filtered].sort((a, b) => {
    const aH = presentIds.has(a.id) ? 0 : 1;
    const bH = presentIds.has(b.id) ? 0 : 1;
    return aH - bH || (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '');
  });

  container.innerHTML = sorted.map(user => {
    const hadir = presentIds.has(user.id);
    const initials = (user.nama_lengkap || user.username || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const posisiBadge = user.posisi ? getPosisiBadge(user.posisi) : '';
    const absenRecord = absensiPresent.find(a => a.user_id === user.id);

    return '<div class="absensi-user-card' + (hadir ? ' hadir' : '') + '" onclick="toggleAbsensi(\'' + user.id + '\', \'' + (absenRecord ? absenRecord.id : '') + '\')" data-user-id="' + user.id + '" data-nama="' + (user.nama_lengkap || '').toLowerCase() + '">' +
      '<div class="absensi-user-avatar">' + initials + '</div>' +
      '<div class="absensi-user-info">' +
        '<div class="absensi-user-name">' + (user.nama_lengkap || user.username) + '</div>' +
        '<div class="absensi-user-meta">' + posisiBadge + (hadir ? '<span style="color:#10B981; font-weight:600;">Hadir</span>' : '<span style="color:var(--text-dim);">Tidak Hadir</span>') + '</div>' +
      '</div>' +
      '<div class="absensi-check-icon">' +
        (hadir ? '<svg width="12" height="12" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function getPosisiBadge(posisi) {
  const map = { 'Picker': 'badge-posisi-picker', 'Sorter': 'badge-posisi-sorter', 'Loader': 'badge-posisi-loader' };
  const cls = map[posisi] || '';
  return cls ? '<span class="' + cls + '">' + posisi + '</span>' : '<span>' + posisi + '</span>';
}

function filterAbsensiUsers() {
  renderAbsensiUserList();
}

async function toggleAbsensi(userId, absensiRecordId) {
  const tanggal = document.getElementById('absensiTanggal')?.value;
  if (!tanggal) return;

  const presentIds = new Set(absensiPresent.map(a => a.user_id));
  const isHadir = presentIds.has(userId);

  try {
    if (isHadir && absensiRecordId) {
      // Remove
      const res = await fetch('/api/absensi/' + absensiRecordId, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Gagal menghapus absensi');
      absensiPresent = absensiPresent.filter(a => a.id !== absensiRecordId);
    } else {
      // Add
      const res = await fetch('/api/absensi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tanggal, user_id: userId })
      });
      if (!res.ok) throw new Error('Gagal menambah absensi');
      const data = await res.json();
      // Find user info
      const user = absensiAllUsers.find(u => u.id === userId);
      if (user && data.record) {
        absensiPresent.push({
          id: data.record.id,
          tanggal,
          user_id: userId,
          username: user.username,
          nama_lengkap: user.nama_lengkap,
          posisi: user.posisi,
          nik: user.nik,
          created_by: data.record.created_by || '',
          created_at: data.record.created_at || new Date().toISOString()
        });
      }
    }
    renderAbsensiUserList();
    renderAbsensiRekap();
  } catch(e) {
    console.error('toggleAbsensi error:', e);
    alert('Gagal mengubah status absensi: ' + e.message);
  }
}

async function absensiSemuaHadir() {
  const tanggal = document.getElementById('absensiTanggal')?.value;
  if (!tanggal) return;
  if (!absensiAllUsers.length) return;
  if (!confirm('Tandai semua karyawan sebagai hadir untuk tanggal ' + tanggal + '?')) return;

  const presentIds = new Set(absensiPresent.map(a => a.user_id));
  const toAdd = absensiAllUsers.filter(u => !presentIds.has(u.id));

  let added = 0;
  for (const user of toAdd) {
    try {
      const res = await fetch('/api/absensi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tanggal, user_id: user.id })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.record) {
          absensiPresent.push({
            id: data.record.id,
            tanggal,
            user_id: user.id,
            username: user.username,
            nama_lengkap: user.nama_lengkap,
            posisi: user.posisi,
            nik: user.nik,
            created_by: data.record.created_by || '',
            created_at: data.record.created_at || new Date().toISOString()
          });
          added++;
        }
      }
    } catch(e) { /* skip */ }
  }
  renderAbsensiUserList();
  renderAbsensiRekap();
}

async function absensiClearSemua() {
  const tanggal = document.getElementById('absensiTanggal')?.value;
  if (!tanggal) return;
  if (!absensiPresent.length) return;
  if (!confirm('Hapus semua absensi untuk tanggal ' + tanggal + '?')) return;

  for (const record of [...absensiPresent]) {
    try {
      await fetch('/api/absensi/' + record.id, { method: 'DELETE', credentials: 'include' });
    } catch(e) { /* skip */ }
  }
  absensiPresent = [];
  renderAbsensiUserList();
  renderAbsensiRekap();
}

function renderAbsensiRekap() {
  const section = document.getElementById('absensiRekapSection');
  const tbody = document.getElementById('absensiRekapBody');
  const dateLabel = document.getElementById('absensiRekapDate');
  const tanggal = document.getElementById('absensiTanggal')?.value;

  if (!section || !tbody) return;

  if (absensiPresent.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  if (dateLabel && tanggal) {
    const d = new Date(tanggal + 'T00:00:00');
    dateLabel.textContent = '— ' + d.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  }

  tbody.innerHTML = absensiPresent.map((r, i) => {
    const posisiBadge = r.posisi ? '<span class="' + (r.posisi === 'Picker' ? 'badge-posisi-picker' : r.posisi === 'Sorter' ? 'badge-posisi-sorter' : 'badge-posisi-loader') + '">' + r.posisi + '</span>' : '-';
    const waktu = r.created_at ? new Date(r.created_at).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : '-';
    return '<tr>' +
      '<td>' + (i+1) + '</td>' +
      '<td style="font-weight:600;">' + (r.nama_lengkap || r.username || '-') + '</td>' +
      '<td>' + posisiBadge + '</td>' +
      '<td style="font-family:monospace; font-size:12px;">' + (r.nik || '-') + '</td>' +
      '<td style="color:var(--text-muted); font-size:12px;">' + (r.created_by || '-') + '</td>' +
      '<td style="color:var(--text-muted); font-size:12px;">' + waktu + '</td>' +
    '</tr>';
  }).join('');
}

function openAbsensiSettings() {
  loadAbsensiSettingsUI();
  document.getElementById('absensiSettingsModal').classList.add('open');
}

let absensiSettingsSaveTimer = null;
async function saveAbsensiSettings() {
  const required = document.getElementById('toggleAbsensiRequired')?.checked || false;
  const visible = document.getElementById('toggleAbsensiVisible')?.checked || false;

  try {
    const res = await fetch('/api/settings/absensi', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ absensi_required: required, absensi_visible_to_user: visible })
    });
    if (!res.ok) throw new Error('Gagal menyimpan');
    absensiSettings.absensi_required = required;
    absensiSettings.absensi_visible_to_user = visible;
    updateAbsensiStatusBanner();

    // Show save success
    const status = document.getElementById('absensiSettingsSaveStatus');
    if (status) {
      status.style.display = 'block';
      clearTimeout(absensiSettingsSaveTimer);
      absensiSettingsSaveTimer = setTimeout(() => { status.style.display = 'none'; }, 2500);
    }
  } catch(e) {
    alert('Gagal menyimpan pengaturan: ' + e.message);
  }
}
// ===================== END ABSENSI MODULE =====================
</script>
`;

if (!html.includes('ABSENSI MODULE')) {
  html = html.replace('</body>', absensiJs + '\n</body>');
  console.log('JS added');
}

// 4. Hook initAbsensiPage into showPage function
if (!html.includes("case 'absensi'")) {
  // Find the showPage function and hook absensi
  const showPageTarget = "case 'feature-guide':";
  const showPageReplacement = "case 'absensi': initAbsensiPage(); break;\n        case 'feature-guide':";
  if (html.includes(showPageTarget)) {
    html = html.replace(showPageTarget, showPageReplacement);
    console.log('showPage hook added');
  } else {
    // Alternative: find 'loader' case
    const alt = "case 'loader':";
    if (html.includes(alt)) {
      html = html.replace(alt, "case 'absensi': initAbsensiPage(); break;\n        case 'loader':");
      console.log('showPage hook added (alt)');
    }
  }
}

fs.writeFileSync('public/admin.html', html, 'utf8');
console.log('Done! Lines:', html.split('\n').length);
