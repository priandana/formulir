const fs = require('fs');
let html = fs.readFileSync('public/admin.html', 'utf8');

const target = '\n  </div>\n</main>';

const absensiPage = `
    <!-- ===== ABSENSI PAGE ===== -->
    <div id="page-absensi" class="page-section" style="display:none;">

      <!-- Header -->
      <div style="display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
        <div>
          <h2 style="font-size:22px; font-weight:800; color:var(--text); margin-bottom:6px;">Manajemen Absensi</h2>
          <p style="font-size:13px; color:var(--text-muted);">Pilih tanggal dan tandai siapa yang hadir. Hanya yang diabsen yang bisa input formulir (jika fitur aktif).</p>
        </div>
        <button class="btn btn-outline" onclick="openAbsensiSettings()" id="btnAbsensiSettings" style="gap:8px; padding:9px 16px; font-size:13px; display:flex; align-items:center;">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          Pengaturan
        </button>
      </div>

      <!-- Status Banner -->
      <div id="absensiStatusBanner" style="display:none; margin-bottom:20px;"></div>

      <!-- Stats Row -->
      <div id="absensiStatsRow" style="display:none; display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:20px;">
        <div class="absensi-stat-card absensi-stat-hadir">
          <div class="absensi-stat-icon">&#10003;</div>
          <div>
            <div class="absensi-stat-num" id="statHadir">0</div>
            <div class="absensi-stat-label">Hadir</div>
          </div>
        </div>
        <div class="absensi-stat-card absensi-stat-belum">
          <div class="absensi-stat-icon">&#10005;</div>
          <div>
            <div class="absensi-stat-num" id="statBelumHadir">0</div>
            <div class="absensi-stat-label">Tidak Hadir</div>
          </div>
        </div>
        <div class="absensi-stat-card absensi-stat-total">
          <div class="absensi-stat-icon">&#128101;</div>
          <div>
            <div class="absensi-stat-num" id="statTotalUser">0</div>
            <div class="absensi-stat-label">Total Karyawan</div>
          </div>
        </div>
      </div>

      <!-- Main Card -->
      <div class="table-card">
        <div class="table-header" style="align-items:center; gap:16px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:10px;">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--primary);"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <label for="absensiTanggal" style="font-size:13px; font-weight:700; color:var(--text-muted);">Tanggal:</label>
            <input type="date" id="absensiTanggal" class="filter-input" style="width:160px;" onchange="loadAbsensiForDate()">
          </div>
          <div class="search-bar" style="flex:1; max-width:280px;">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input type="text" id="absensiSearch" placeholder="Cari nama karyawan..." oninput="filterAbsensiUsers()">
          </div>
          <div style="margin-left:auto; display:flex; gap:8px;">
            <button class="btn btn-success" onclick="absensiSemuaHadir()" style="gap:6px; font-size:12px; padding:7px 14px;" id="btnHadirSemua">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              Hadir Semua
            </button>
            <button class="btn btn-danger" onclick="absensiClearSemua()" style="gap:6px; font-size:12px; padding:7px 14px;" id="btnClearSemua">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Hapus Semua
            </button>
          </div>
        </div>
        <div class="absensi-user-list" id="absensiUserList">
          <div class="absensi-empty-state">
            <svg width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="opacity:0.35; margin-bottom:12px;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <p>Pilih tanggal untuk melihat dan mengatur kehadiran</p>
          </div>
        </div>
      </div>

      <!-- Rekap Table -->
      <div id="absensiRekapSection" style="display:none; margin-top:20px;">
        <div class="table-card">
          <div class="table-header">
            <div class="table-title">Rekap Kehadiran <span id="absensiRekapDate" style="font-size:12px; font-weight:500; color:var(--text-muted); margin-left:8px;"></span></div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>No</th><th>Nama Lengkap</th><th>Posisi</th><th>NIK</th><th>Diabsen Oleh</th><th>Waktu</th>
                </tr>
              </thead>
              <tbody id="absensiRekapBody"></tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
    <!-- ===== END ABSENSI PAGE ===== -->
`;

// Find the closing of page-content - the last </div> before </main>
const insertBefore = '\n  </div>\n</main>';
if (!html.includes(insertBefore)) {
  console.error('Closing marker not found!');
  process.exit(1);
}
if (html.includes('page-absensi')) {
  console.log('Already has absensi page, skipping.');
  process.exit(0);
}
// Insert before the last page-content closing
const lastIdx = html.lastIndexOf(insertBefore);
html = html.slice(0, lastIdx) + absensiPage + insertBefore + html.slice(lastIdx + insertBefore.length);
fs.writeFileSync('public/admin.html', html, 'utf8');
console.log('Done! Lines:', html.split('\n').length);
