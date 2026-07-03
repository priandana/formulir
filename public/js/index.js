const formatNum = (v) => (v !== null && v !== undefined && !isNaN(v)) ? Number(v).toLocaleString('id-ID') : '0';

function autoLink(text) {
  if (!text) return '';
  const regex = /(https?:\/\/[^\s]+|wa\.me\/[^\s\n\r\t]+)/gi;
  return text.replace(regex, (url) => {
    let href = url;
    if (!/^https?:\/\//i.test(url)) {
      href = 'https://' + url;
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}


// ===================== AUTH =====================
let currentUser = null;

async function initAuth() {
  try {
    const r = await fetch('/api/check-auth');
    const auth = await r.json();
    if (!auth.authenticated) { window.location.href = '/login'; return; }
    if (auth.role === 'admin') { window.location.href = '/admin'; return; }
    currentUser = auth;
    populateUserUI();
    // Load announcements immediately after user validation
    loadAnnouncements();
  } catch(e) {
    window.location.href = '/login';
  } finally {
    document.getElementById('pageLoader').classList.add('hidden');
    setTimeout(() => document.getElementById('pageLoader').remove(), 400);
  }
}

function getInitials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase();
}

function populateUserUI() {
  const u = currentUser;
  const initials = getInitials(u.nama_lengkap);
  document.getElementById('headerAvatar').textContent = initials;
  document.getElementById('headerName').textContent = u.nama_lengkap || '—';
  const mobileAv = document.getElementById('mobileAvatar');
  if (mobileAv) mobileAv.textContent = initials;

  const badge = document.getElementById('headerPosisiBadge');
  badge.textContent = u.posisi || '—';
  if (u.posisi) {
    const p = u.posisi.toLowerCase();
    badge.classList.add(p === 'picker' ? 'picker' : p === 'sorter' ? 'sorter' : 'loader');
  }

  // Tab 1 - name display
  document.getElementById('psNamaAvatar').textContent = initials;
  document.getElementById('psNamaDisplay').textContent = u.nama_lengkap || '—';

  // Dashboard welcome banner
  const dashAv = document.getElementById('dashAvatar');
  if (dashAv) dashAv.textContent = initials;
  const dashName = document.getElementById('dashName');
  if (dashName) dashName.textContent = u.nama_lengkap || '—';
  const dashGreeting = document.getElementById('dashGreeting');
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Selamat Pagi' : hour < 15 ? 'Selamat Siang' : hour < 18 ? 'Selamat Sore' : 'Selamat Malam';
  if (dashGreeting) dashGreeting.textContent = greet + ', ' + (u.posisi || '') + '!';
  const dashDate = document.getElementById('dashDate');
  if (dashDate) {
    dashDate.textContent = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  // Pre-select posisi if available
  if (u.posisi && (u.posisi === 'Picker' || u.posisi === 'Sorter')) {
    const sel = document.getElementById('ps_posisi');
    for (let opt of sel.options) {
      if (opt.value === u.posisi) { opt.selected = true; break; }
    }
    sel.dispatchEvent(new Event('change'));
    psBatchCapacityCache = {};
    schedulePsRender();
  }

  // Default ke tab dashboard dan load data
  switchTab('dashboard');
}

async function logout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch(e) {}
  window.location.href = '/login';
}

// ===================== GANTI PASSWORD =====================
function openChangePasswordModal() {
  document.getElementById('cpCurrentPw').value = '';
  document.getElementById('cpNewPw').value = '';
  document.getElementById('cpConfirmPw').value = '';
  document.getElementById('cpError').style.display = 'none';
  document.getElementById('cpSuccess').style.display = 'none';
  document.getElementById('cpSaveBtn').disabled = false;
  document.getElementById('cpSaveBtnText').textContent = 'Simpan Password';
  document.getElementById('cpSpinner').style.display = 'none';
  // Reset eye icons
  ['cpCurrentPw','cpNewPw','cpConfirmPw'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.type = 'password';
  });
  document.getElementById('cpOverlay').classList.add('active');
  document.getElementById('cpModal').classList.add('active');
  setTimeout(() => document.getElementById('cpCurrentPw').focus(), 50);
}

function closeChangePasswordModal() {
  document.getElementById('cpOverlay').classList.remove('active');
  document.getElementById('cpModal').classList.remove('active');
}

function cpToggleEye(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  icon.innerHTML = isHidden
    ? '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}

async function submitChangePassword() {
  const currentNik = document.getElementById('cpCurrentPw').value.trim();
  const newNik     = document.getElementById('cpNewPw').value.trim();
  const confirmNik = document.getElementById('cpConfirmPw').value.trim();

  const errEl  = document.getElementById('cpError');
  const errTxt = document.getElementById('cpErrorText');
  const sucEl  = document.getElementById('cpSuccess');
  const btn    = document.getElementById('cpSaveBtn');
  const spin   = document.getElementById('cpSpinner');
  const btnTxt = document.getElementById('cpSaveBtnText');

  errEl.style.display = 'none';
  sucEl.style.display = 'none';

  // Validasi client-side
  if (!currentNik || !newNik || !confirmNik) {
    errTxt.textContent = 'Semua field wajib diisi.';
    errEl.style.display = 'flex'; return;
  }
  if (newNik.length < 4) {
    errTxt.textContent = 'Password baru minimal 4 karakter.';
    errEl.style.display = 'flex'; return;
  }
  if (newNik !== confirmNik) {
    errTxt.textContent = 'Konfirmasi password baru tidak cocok.';
    errEl.style.display = 'flex'; return;
  }
  if (newNik === currentNik) {
    errTxt.textContent = 'Password baru tidak boleh sama dengan password lama.';
    errEl.style.display = 'flex'; return;
  }

  // Submit ke API
  btn.disabled = true;
  btnTxt.textContent = 'Menyimpan...';
  spin.style.display = 'block';

  try {
    const res = await fetch('/api/user/change-nik', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentNik, newNik })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      sucEl.style.display = 'flex';
      btnTxt.textContent = 'Berhasil!';
      spin.style.display = 'none';
      // Auto logout setelah 2 detik agar login ulang dengan password baru
      setTimeout(async () => {
        closeChangePasswordModal();
        await logout();
      }, 2000);
    } else {
      errTxt.textContent = data.error || 'Gagal mengubah password.';
      errEl.style.display = 'flex';
      btn.disabled = false;
      btnTxt.textContent = 'Simpan Password';
      spin.style.display = 'none';
    }
  } catch(e) {
    errTxt.textContent = 'Koneksi gagal. Coba lagi.';
    errEl.style.display = 'flex';
    btn.disabled = false;
    btnTxt.textContent = 'Simpan Password';
    spin.style.display = 'none';
  }
}

// Tutup modal dengan Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeChangePasswordModal();
});

// ===================== TABS =====================
function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active-green', 'active-purple', 'active-blue', 'active-teal');
  });
  if (tab === 'dashboard') {
    document.getElementById('panel-dashboard').classList.add('active');
    document.getElementById('tab-dashboard').classList.add('active-green');
    loadDashboard();
  } else if (tab === 'riwayat') {
    document.getElementById('panel-riwayat').classList.add('active');
    document.getElementById('tab-riwayat').classList.add('active-teal');
    loadRiwayat();
  } else if (tab === 'pendapatan') {
    document.getElementById('panel-pendapatan').classList.add('active');
    document.getElementById('tab-pendapatan').style.background = 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(239,68,68,0.05))';
    document.getElementById('tab-pendapatan').style.borderColor = 'rgba(245,158,11,0.3)';
  } else if (tab === 'picker') {
    document.getElementById('panel-picker').classList.add('active');
    document.getElementById('tab-picker').classList.add('active-purple');
  } else {
    document.getElementById('panel-loader').classList.add('active');
    document.getElementById('tab-loader').classList.add('active-blue');
  }
  // Reset pendapatan tab style if not active
  if (tab !== 'pendapatan') {
    const pdBtn = document.getElementById('tab-pendapatan');
    if (pdBtn) { pdBtn.style.background = ''; pdBtn.style.borderColor = ''; }
  }
  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
}


// ===================== RIWAYAT =====================
let riwayatLoaded = false;

async function loadRiwayat() {
  const rwLoading = document.getElementById('rwLoading');
  const rwContent = document.getElementById('rwContent');
  const rwList    = document.getElementById('rwList');
  const rwEmpty   = document.getElementById('rwEmpty');
  if (rwLoading) rwLoading.style.display = 'flex';
  if (rwContent) rwContent.style.display = 'none';

  try {
    const r = await fetch('/api/my-achievements');
    if (!r.ok) throw new Error('Gagal memuat data.');
    const d = await r.json();

    const fmt = v => Number(v || 0).toLocaleString('id-ID');
    const fmtDate = (dateStr) => {
      if (!dateStr) return '-';
      const dt = new Date(dateStr + 'T00:00:00');
      return dt.toLocaleDateString('id-ID', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    };
    const fmtTime = (isoStr) => {
      if (!isoStr) return '-';
      return new Date(isoStr).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Jakarta' });
    };

    // Gabungkan semua submissions (picker+sorter) dan loader entries ke dalam map per tanggal
    const byDate = {};

    // Picker & Sorter submissions
    const allSubs = [
      ...(d.picker?.all_submissions || []),
      ...(d.sorter?.all_submissions || [])
    ];
    allSubs.forEach(s => {
      const tgl = (s.tanggal_pengerjaan || s.created_at || '').slice(0, 10);
      if (!tgl) return;
      if (!byDate[tgl]) byDate[tgl] = { submissions: [], loaderEntries: [] };
      byDate[tgl].submissions.push(s);
    });

    // Loader entries
    const allLoader = d.loader?.all_entries || [];
    allLoader.forEach(e => {
      const tgl = (e.tanggal_kirim || e.tanggal_carian || e.created_at || '').slice(0, 10);
      if (!tgl) return;
      if (!byDate[tgl]) byDate[tgl] = { submissions: [], loaderEntries: [] };
      byDate[tgl].loaderEntries.push(e);
    });

    const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));

    // Summary chips
    const totalBatch = Object.values(byDate).reduce((acc, v) => acc + v.submissions.length, 0);
    const totalOutput = Object.values(byDate).reduce((acc, v) =>
      acc + v.submissions.reduce((s2, s) => s2 + (parseInt(s.jumlah_output) || 0), 0), 0);
    document.getElementById('rwTotalHari').textContent  = dates.length;
    document.getElementById('rwTotalBatch').textContent = fmt(totalBatch);
    document.getElementById('rwTotalOutput').textContent = fmt(totalOutput);

    if (dates.length === 0) {
      if (rwEmpty) rwEmpty.style.display = 'block';
      if (rwList)  rwList.innerHTML = '';
    } else {
      if (rwEmpty) rwEmpty.style.display = 'none';
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

      rwList.innerHTML = dates.map((tgl, idx) => {
        const { submissions, loaderEntries } = byDate[tgl];
        const isToday = tgl === today;
        const totalOutputDay = submissions.reduce((s, x) => s + (parseInt(x.jumlah_output) || 0), 0);
        const totalKontainerDay = loaderEntries.reduce((s, x) => s + (parseInt(x.jumlah_kontainer) || 0), 0);
        const approved = submissions.filter(s => s.status === 'approved').length;
        const pending  = submissions.filter(s => s.status === 'pending').length;

        const subsHtml = submissions.map(s => {
          let batches = [];
          try { batches = JSON.parse(s.batch_cluster || '[]'); } catch(e) { batches = []; }
          const posColor = s.posisi === 'Picker' ? 'purple' : 'cyan';
          return `<div class="rw-entry-row">
            <div class="rw-entry-left">
              <span class="rw-entry-posisi ${posColor}">${s.posisi || '-'}</span>
              <span class="rw-entry-detail">${batches.join(', ') || '-'} &middot; ${s.zona || '-'} &middot; ${fmtTime(s.created_at)}</span>
            </div>
            <div class="rw-entry-right">
              <span class="rw-entry-val">${fmt(s.jumlah_output)} pcs</span>
              <span class="dash-badge ${s.status === 'approved' ? 'approved' : 'pending'}">${s.status === 'approved' ? '✓ Approved' : '⏳ Pending'}</span>
            </div>
          </div>`;
        }).join('');

        const loaderHtml = loaderEntries.map(e => {
          let clusters = [];
          try { clusters = Array.isArray(e.clusters) ? e.clusters : (e.clusters?.list || []); } catch(er) {}
          return `<div class="rw-entry-row">
            <div class="rw-entry-left">
              <span class="rw-entry-posisi blue">Loader</span>
              <span class="rw-entry-detail">${e.no_polisi || '-'} &middot; ${e.zona || '-'} &middot; ${fmtTime(e.created_at)}</span>
            </div>
            <div class="rw-entry-right">
              <span class="rw-entry-val">${fmt(e.jumlah_kontainer)} kont.</span>
              <span class="dash-badge approved">✓ Terkirim</span>
            </div>
          </div>`;
        }).join('');

        const allEntriesHtml = (subsHtml + loaderHtml) || '<div class="rw-entry-empty">Tidak ada detail entry</div>';

        return `<div class="rw-day-card ${isToday ? 'today' : ''}" id="rw-day-${idx}">
          <div class="rw-day-header" onclick="rwToggle(${idx})">
            <div class="rw-day-header-left">
              ${isToday ? '<span class="rw-today-badge">Hari Ini</span>' : ''}
              <div class="rw-day-date">${fmtDate(tgl)}</div>
              <div class="rw-day-chips">
                ${submissions.length > 0 ? `<span class="rw-mini-chip purple">${submissions.length} batch</span>` : ''}
                ${totalOutputDay > 0 ? `<span class="rw-mini-chip cyan">${fmt(totalOutputDay)} pcs</span>` : ''}
                ${loaderEntries.length > 0 ? `<span class="rw-mini-chip blue">${loaderEntries.length} trip · ${fmt(totalKontainerDay)} kont.</span>` : ''}
                ${pending > 0 ? `<span class="rw-mini-chip orange">${pending} pending</span>` : ''}
              </div>
            </div>
            <svg class="rw-chevron" id="rw-chev-${idx}" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </div>
          <div class="rw-day-body" id="rw-body-${idx}" style="display:${isToday ? 'block' : 'none'}">
            ${allEntriesHtml}
          </div>
        </div>`;
      }).join('');
    }

    if (rwLoading) rwLoading.style.display = 'none';
    if (rwContent) rwContent.style.display = 'block';
    riwayatLoaded = true;

  } catch(err) {
    console.error('loadRiwayat error:', err);
    if (rwLoading) rwLoading.style.display = 'none';
    if (rwContent) { rwContent.style.display = 'block'; rwContent.innerHTML = '<div class="dash-empty"><div class="dash-empty-title">Gagal memuat riwayat</div><div class="dash-empty-sub">Periksa koneksi Anda dan coba refresh.</div></div>'; }
  }
}

function rwToggle(idx) {
  const body = document.getElementById('rw-body-' + idx);
  const chev = document.getElementById('rw-chev-' + idx);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// ===================== BATCH GENERATION =====================
function pad(n) { return String(n).padStart(2, '0'); }

function renderBatchGroup(containerId, items, chipClass = '') {
  const container = document.getElementById(containerId);
  if (!container) return;
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'batch-item' + (chipClass ? ' ' + chipClass : '');
    const id = containerId + '_' + item.replace(/\s/g, '_');
    div.innerHTML = `
      <input type="checkbox" id="${id}" value="${item}">
      <label for="${id}">${item}</label>
    `;
    container.appendChild(div);
  });
}

// --- TAB 1 batches ---
const angka   = Array.from({length: 23}, (_, i) => String(i + 1));
const BDGArr  = Array.from({length: 35}, (_, i) => 'BDG' + pad(i + 1));
const BDYArr  = Array.from({length: 21}, (_, i) => 'BDY' + pad(i + 1));
const cjrArr  = Array.from({length: 27}, (_, i) => 'CJR' + pad(i + 1));
const kwgArr  = Array.from({length: 32}, (_, i) => 'KWG' + pad(i + 1));
const PBNArr  = Array.from({length: 24}, (_, i) => 'PBN' + pad(i + 1));
const special = ['Gacoan', 'Lainnya'];

renderBatchGroup('ps-grid-angka', angka);
renderBatchGroup('ps-grid-BDG',   BDGArr);
renderBatchGroup('ps-grid-BDY',   BDYArr);
renderBatchGroup('ps-grid-cjr',   cjrArr);
renderBatchGroup('ps-grid-kwg',   kwgArr);
renderBatchGroup('ps-grid-PBN',   PBNArr);
renderBatchGroup('ps-grid-special', special);

// --- TAB 2: ld-grid tidak dipakai lagi (cluster dipilih via dropdown) ---

// Helper to get checked values from a section
function getChecked(sectionId) {
  return Array.from(document.querySelectorAll(`#${sectionId} input[type="checkbox"]:checked`)).map(cb => cb.value);
}

// ===================== TAB 1: PICKER/SORTER LOGIC =====================
let psBatchCapacityCache = {};
let psRenderTimeout = null;
let psRenderGen = 0;
let psSelectedFiles = [];

let psCatatanRequired = false;

function psUpdateCount() {
  // Sync selected class on all batch items in psBatchSection
  document.querySelectorAll('#psBatchSection .batch-item').forEach(item => {
    const cb = item.querySelector('input[type="checkbox"]');
    if (cb && cb.checked) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });

  const c = getChecked('psBatchSection').length;
  const countEl = document.getElementById('psSelectedCount');
  if (countEl) countEl.textContent = c;
  schedulePsRender();
}
function psSelectAll() {
  document.querySelectorAll('#psBatchSection input[type="checkbox"]').forEach(cb => {
    const item = cb.closest('.batch-item');
    if (item && item.style.display !== 'none') {
      cb.checked = true;
    }
  });
  psUpdateCount();
}
function psClearAll() {
  document.querySelectorAll('#psBatchSection input[type="checkbox"]').forEach(cb => cb.checked = false);
  psUpdateCount();
}

document.querySelectorAll('#psBatchSection input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', psUpdateCount);
});

// Mapping Tipe Lokasi to Zona
const mapTipeLokasiToZona = {
  'Chiller (R)': ['R1', 'R2', 'R3'],
  'Freezer (F)': ['F1'],
  'Ambient (T)': ['T1', 'T2', 'T3', 'T4', 'T5'],
  'Loading Dock': ['Loading Dock']
};

// Event listener for Tipe Lokasi change to update Zona options dynamically
document.getElementById('ps_tipe_lokasi').addEventListener('change', function() {
  const tipe = this.value;
  const zonaSelect = document.getElementById('ps_zona');
  
  // Clear existing options except the first placeholder option
  zonaSelect.innerHTML = '<option value="">-- Pilih Zona --</option>';
  
  if (tipe && mapTipeLokasiToZona[tipe]) {
    mapTipeLokasiToZona[tipe].forEach(zona => {
      const opt = document.createElement('option');
      opt.value = zona;
      opt.textContent = zona;
      zonaSelect.appendChild(opt);
    });
  } else if (!tipe) {
    // Fallback if no location type selected: show all zones
    const allZonas = ['F1', 'R1', 'R2', 'R3', 'T1', 'T2', 'T3', 'T4', 'T5', 'Loading Dock'];
    allZonas.forEach(zona => {
      const opt = document.createElement('option');
      opt.value = zona;
      opt.textContent = zona;
      zonaSelect.appendChild(opt);
    });
  }
  
  // Reset selected zona value and trigger change event
  zonaSelect.value = '';
  zonaSelect.dispatchEvent(new Event('change'));
});

// Trigger change event initially to apply correct options on load
document.getElementById('ps_tipe_lokasi').dispatchEvent(new Event('change'));

['ps_posisi','ps_zona','ps_tanggal_carian'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    psBatchCapacityCache = {};
    psLoadActiveBatches();
  });
});

async function psLoadActiveBatches() {
  const tanggal = document.getElementById('ps_tanggal_carian').value;
  const posisi  = document.getElementById('ps_posisi').value;
  const zona    = document.getElementById('ps_zona').value;
  
  const section     = document.getElementById('psBatchSection');
  const placeholder = document.getElementById('psBatchPlaceholder');

  if (!tanggal || !posisi || !zona) {
    placeholder.style.display = 'block';
    placeholder.textContent = 'Pilih Tanggal Carian, Posisi, dan Zona terlebih dahulu untuk memuat daftar batch.';
    section.style.display = 'none';
    document.querySelectorAll('#psBatchSection input[type="checkbox"]').forEach(cb => cb.checked = false);
    psUpdateCount();
    return;
  }

  placeholder.style.display = 'block';
  placeholder.textContent = 'Memuat daftar batch...';
  section.style.display = 'none';

  try {
    const r = await fetch(`/api/data-carian?tanggal=${tanggal}`);
    const records = await r.json();
    
    const activeRecords = records.filter(rec => 
      rec.posisi === posisi && 
      String(rec.zona).trim().toUpperCase() === String(zona).trim().toUpperCase()
    );

    if (activeRecords.length === 0) {
      placeholder.style.display = 'block';
      placeholder.textContent = `⚠️ Tidak ada data carian untuk tanggal ${tanggal}, posisi ${posisi}, dan zona ${zona}.`;
      section.style.display = 'none';
      document.querySelectorAll('#psBatchSection input[type="checkbox"]').forEach(cb => cb.checked = false);
      psUpdateCount();
      return;
    }

    const activeBatches = new Set(activeRecords.map(rec => String(rec.batch).trim()));

    placeholder.style.display = 'none';
    section.style.display = 'block';

    section.querySelectorAll('.batch-group').forEach(group => {
      let visibleCount = 0;
      group.querySelectorAll('.batch-item').forEach(item => {
        const cb = item.querySelector('input[type="checkbox"]');
        const batchVal = cb ? String(cb.value).trim() : '';
        if (activeBatches.has(batchVal)) {
          item.style.display = 'flex';
          visibleCount++;
        } else {
          item.style.display = 'none';
          if (cb) cb.checked = false;
        }
      });

      if (visibleCount > 0) {
        group.style.display = 'block';
      } else {
        group.style.display = 'none';
      }
    });

    psUpdateCount();
  } catch (err) {
    console.error('psLoadActiveBatches error:', err);
    placeholder.style.display = 'block';
    placeholder.textContent = '❌ Gagal memuat daftar batch dari server.';
    section.style.display = 'none';
  }
}

function schedulePsRender() {
  clearTimeout(psRenderTimeout);
  psRenderTimeout = setTimeout(psRenderBatchOutputRows, 50);
}

function showOnscreenError(source, err) {
  console.error(`[ONSCREEN ERROR] ${source}:`, err);
  const container = document.getElementById('onscreen-error-container') || (() => {
    const div = document.createElement('div');
    div.id = 'onscreen-error-container';
    div.style.position = 'fixed';
    div.style.bottom = '20px';
    div.style.left = '20px';
    div.style.right = '20px';
    div.style.background = '#FEE2E2';
    div.style.border = '2px solid #EF4444';
    div.style.color = '#B91C1C';
    div.style.padding = '14px';
    div.style.borderRadius = '8px';
    div.style.zIndex = '99999';
    div.style.fontSize = '12px';
    div.style.fontFamily = 'monospace';
    div.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
    div.style.maxHeight = '200px';
    div.style.overflowY = 'auto';
    div.innerHTML = `<strong>Error in ${source}:</strong> <span id="onscreen-error-msg"></span><button onclick="this.parentElement.remove()" style="margin-left: 10px; background: #EF4444; color: white; border: none; padding: 2px 6px; border-radius: 4px; cursor: pointer; float: right;">Tutup</button>`;
    document.body.appendChild(div);
    return div;
  })();
  document.getElementById('onscreen-error-msg').textContent = `${err.name}: ${err.message}\n${err.stack || ''}`;
}

function psRenderBatchOutputRows() {
  try {
    const tanggal = document.getElementById('ps_tanggal_carian').value;
    const posisi  = document.getElementById('ps_posisi').value;
    const zona    = document.getElementById('ps_zona').value;
    const checkedBatches = getChecked('psBatchSection');
    const list  = document.getElementById('psBatchOutputList');
    const empty = document.getElementById('psBatchOutputEmpty');

    console.log('[DEBUG PS] Render called:', { tanggal, posisi, zona, checkedCount: checkedBatches.length, checkedBatches });

    if (checkedBatches.length === 0) {
      list.querySelectorAll('.batch-output-row').forEach(r => r.remove());
      if (empty) empty.style.display = '';
      psCheckOverInput();
      return;
    }

    if (empty) empty.style.display = 'none';

    const checkedSet = new Set(checkedBatches.map(String));

    // Hapus row yang sudah tidak dicheck
    list.querySelectorAll('.batch-output-row').forEach(row => {
      const bRow = row.getAttribute('data-batch-row');
      if (!checkedSet.has(String(bRow))) {
        console.log('[DEBUG PS] Removing unchecked row:', bRow);
        row.remove();
      }
    });

    // Cari row yang sudah ada di DOM
    const existingRowBatches = new Set();
    list.querySelectorAll('.batch-output-row').forEach(row => {
      const bRow = row.getAttribute('data-batch-row');
      if (bRow) existingRowBatches.add(String(bRow));
    });

    console.log('[DEBUG PS] Existing rows in DOM:', Array.from(existingRowBatches));

    // Tambah row untuk batch yang belum ada
    checkedBatches.forEach(batch => {
      if (existingRowBatches.has(String(batch))) {
        console.log('[DEBUG PS] Batch already exists in DOM, skipping:', batch);
        return;
      }
      console.log('[DEBUG PS] Creating row for batch:', batch);
      const key = `${tanggal}|${posisi}|${zona}|${batch}`;
      const cap = psBatchCapacityCache[key];
      const row = document.createElement('div');
      row.className = 'batch-output-row';
      row.setAttribute('data-batch-row', String(batch));
      row.innerHTML = psBuildRowHtml(batch, cap, posisi, '');
      list.appendChild(row);
      
      if (tanggal && posisi && zona && !cap) {
        console.log('[DEBUG PS] Fetching capacity for batch:', batch);
        psFetchCapacity(batch, tanggal, posisi, zona);
      }
    });

    psCheckOverInput();
  } catch (err) {
    showOnscreenError('psRenderBatchOutputRows', err);
  }
}

function psBuildRowHtml(batch, cap, posisi, existingVal) {
  try {
    const isFull = cap && cap.ada_data_carian && cap.sisa <= 0;
    const satuan = cap && cap.ada_data_carian ? cap.satuan : (posisi === 'Picker' ? 'pcs' : 'kontainer');
    const total  = cap && cap.ada_data_carian ? cap.total_output : 0;
    const filled = cap && cap.ada_data_carian ? cap.sudah_diisi  : 0;
    const sisa   = cap && cap.ada_data_carian ? cap.sisa         : 0;
    const pct    = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;
    const pfClass = isFull ? 'full' : (pct >= 75 ? 'warn' : 'ok');
    const hasData = cap && cap.ada_data_carian;

    const statsHtml = hasData ? `
      <div class="bor-stats-row">
        <div class="bor-stat-item">
          <span class="bor-stat-label">Kapasitas</span>
          <span class="bor-stat-value">${formatNum(total)}</span>
          <span class="bor-stat-unit">${satuan}</span>
        </div>
        <div class="bor-stat-sep"></div>
        <div class="bor-stat-item">
          <span class="bor-stat-label">Sudah Terisi</span>
          <span class="bor-stat-value bor-dyn-filled" data-base="${filled}">${formatNum(filled)}</span>
          <span class="bor-stat-unit">${satuan}</span>
        </div>
        <div class="bor-stat-sep"></div>
        <div class="bor-stat-item ${isFull ? 'is-full' : ''} bor-dyn-sisa-wrap">
          <span class="bor-stat-label">Sisa</span>
          <span class="bor-stat-value bor-dyn-sisa ${isFull ? 'full' : 'ok'}" data-base="${sisa}">${formatNum(sisa)}</span>
          <span class="bor-stat-unit">${satuan}</span>
        </div>
      </div>
      <div class="bor-progress-wrap">
        <div class="bor-prog-track">
          <div class="bor-prog-filled ${pfClass}" style="width:${pct}%" data-pct-base="${pct}" data-total="${total}"></div>
          <div class="bor-prog-input ok" style="width:0%"></div>
        </div>
        <span class="bor-prog-pct bor-dyn-pct">${pct}%</span>
      </div>` : `
      <div class="bor-no-cap">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
        Belum ada data kapasitas untuk batch ini
      </div>`;

    return `
      <div class="bor-card-head">
        <span class="bor-badge">${posisi === 'Picker' ? '📋' : '📦'} Batch ${batch}</span>
        ${hasData ? `<span class="bor-head-status ${isFull ? 'full' : (pct >= 75 ? 'warn' : 'ok')}">${isFull ? '🔴 Penuh' : pct >= 75 ? '🟡 Hampir penuh' : '🟢 Tersedia'}</span>` : ''}
      </div>
      ${statsHtml}
      <div class="bor-input-card">
        <div class="bor-input-label">Jumlah ${satuan === 'pcs' ? 'Output' : 'Kontainer'} Kamu</div>
        <div class="bor-input-row">
          <input type="number" class="bor-input" data-batch="${batch}" data-satuan="${satuan}"
            placeholder="0" min="0" value="${existingVal || ''}"
            oninput="psValidateBorInput(this)">
          <span class="bor-satuan">${satuan}</span>
        </div>
      </div>
      <div class="bor-note-row" id="ps-note-row-${batch}" style="display:none;">
        <input type="text" class="form-input bor-note-input" data-batch="${batch}"
          placeholder="Alasan / keterangan over-input Batch ${batch}..."
          style="font-size:12px; padding:8px 12px; border-radius:8px; border: 1.5px dashed var(--error); width: 100%; box-sizing: border-box; outline: none;">
      </div>
      <div class="bor-error${isFull ? ' visible' : ''}">${isFull ? '⚠️ Kapasitas sudah habis! Input ini akan masuk status Pending untuk divalidasi admin.' : ''}</div>
    `;
  } catch (err) {
    showOnscreenError('psBuildRowHtml', err);
    return `<div>Error rendering Batch ${batch}</div>`;
  }
}

async function psFetchCapacity(batch, tanggal, posisi, zona) {
  const key = `${tanggal}|${posisi}|${zona}|${batch}`;
  if (psBatchCapacityCache[key]) return;
  try {
    const r = await fetch(`/api/batch-capacity?tanggal_carian=${tanggal}&posisi=${encodeURIComponent(posisi)}&zona=${encodeURIComponent(zona)}&batch=${encodeURIComponent(batch)}`);
    const d = await r.json();
    psBatchCapacityCache[key] = d;
    const list = document.getElementById('psBatchOutputList');
    const row  = list ? list.querySelector(`[data-batch-row="${batch}"]`) : null;
    if (!row) return;
    const existingInput = row.querySelector('.bor-input');
    const existingVal   = existingInput ? existingInput.value : '';
    row.innerHTML = psBuildRowHtml(batch, d, posisi, existingVal);
    const inp = row.querySelector('.bor-input');
    if (inp) psValidateBorInput(inp);
    psCheckOverInput();
  } catch(e) {
    console.error('Batch capacity fetch error:', batch, e);
    showOnscreenError(`psFetchCapacity (Batch ${batch})`, e);
  }
}

function psValidateBorInput(inp) {
  try {
    const batch = inp.getAttribute('data-batch') || inp.dataset.batch;
    const tanggal = document.getElementById('ps_tanggal_carian').value;
    const posisi  = document.getElementById('ps_posisi').value;
    const zona    = document.getElementById('ps_zona').value;
    const cacheKey = `${tanggal}|${posisi}|${zona}|${batch}`;
    const cap = psBatchCapacityCache[cacheKey];
    const row = inp.closest('.batch-output-row');
    if (!row) return;
    const errEl = row.querySelector('.bor-error');
    const val   = parseInt(inp.value) || 0;

    row.classList.remove('has-error', 'is-ok', 'is-full');
    if (errEl) { errEl.classList.remove('visible'); errEl.textContent = ''; }

    // ---- Update real-time stats ----
    if (cap && cap.ada_data_carian) {
      const total  = cap.total_output || 0;
      const filled = cap.sudah_diisi  || 0;
      const sisa   = cap.sisa         || 0;
      const satuan = cap.satuan       || 'pcs';

      // Update Terisi chip
      const dynFilled = row.querySelector('.bor-dyn-filled');
      if (dynFilled) dynFilled.textContent = formatNum(filled + val);

      // Update Sisa chip
      const dynSisa = row.querySelector('.bor-dyn-sisa');
      if (dynSisa) {
        const newSisa = sisa - val;
        dynSisa.textContent = formatNum(newSisa);
        dynSisa.className = `bor-stat-value bor-dyn-sisa ${newSisa < 0 ? 'full' : newSisa === 0 ? 'full' : sisa <= 0 ? 'full' : 'ok'}`;
      }

      // Update progress bar (dua layer: filled + input user)
      const progFilled = row.querySelector('.bor-prog-filled');
      const progInput  = row.querySelector('.bor-prog-input');
      const dynPct     = row.querySelector('.bor-dyn-pct');
      if (total > 0 && progFilled && progInput) {
        const basePct  = Math.min(100, (filled / total) * 100);
        const inputPct = Math.min(100 - basePct, (val / total) * 100);
        const totalPct = Math.min(100, basePct + inputPct);
        progFilled.style.width = basePct + '%';
        progInput.style.width  = inputPct + '%';
        // Warna progress user
        const overCap = filled + val > total;
        progInput.className = `bor-prog-input ${overCap ? 'over' : 'new'}`;
        if (dynPct) dynPct.textContent = Math.round(totalPct) + '%';
        // Warna filled bar
        progFilled.className = `bor-prog-filled ${totalPct >= 100 ? 'full' : totalPct >= 75 ? 'warn' : 'ok'}`;
      }
    }

    // ---- Validasi & error state ----
    const noteRow = row.querySelector('.bor-note-row');
    if (cap && cap.ada_data_carian) {
      if (cap.sisa <= 0) {
        if (val > 0) {
          row.classList.add('has-error');
          if (errEl) {
            errEl.innerHTML = `⚠️ Kapasitas sudah habis! Sisa: 0. Submission akan masuk status <strong>Pending</strong> dan perlu validasi admin.`;
            errEl.classList.add('visible');
          }
          if (noteRow) noteRow.style.display = 'block';
        } else {
          row.classList.add('is-full');
          if (errEl) {
            errEl.innerHTML = `⚠️ Kapasitas sudah habis! Input ini akan masuk status <strong>Pending</strong>.`;
            errEl.classList.add('visible');
          }
          if (noteRow) noteRow.style.display = 'none';
        }
      } else if (val > cap.sisa) {
        row.classList.add('has-error');
        if (errEl) {
          errEl.innerHTML = `⚠️ Melebihi sisa kapasitas! Sisa: ${formatNum(cap.sisa)} ${cap.satuan}. Submission akan masuk status <strong>Pending</strong> dan perlu validasi admin.`;
          errEl.classList.add('visible');
        }
        if (noteRow) noteRow.style.display = 'block';
      } else if (val > 0) {
        row.classList.add('is-ok');
        if (noteRow) noteRow.style.display = 'none';
      } else {
        if (noteRow) noteRow.style.display = 'none';
      }
    } else {
      if (val > 0) row.classList.add('is-ok');
      if (noteRow) noteRow.style.display = 'none';
    }
    psCheckOverInput();
  } catch (err) {
    showOnscreenError('psValidateBorInput', err);
  }
}

function psCheckOverInput() {
  // No-op: NIK leader validation is removed
}

// ---- File Upload (Tab 1) ----
const psDropZone = document.getElementById('psDropZone');
const psFileInput = document.getElementById('psFileInput');

if (psDropZone) {
  psDropZone.addEventListener('dragover', e => { e.preventDefault(); psDropZone.classList.add('dragover'); });
  psDropZone.addEventListener('dragleave', () => psDropZone.classList.remove('dragover'));
  psDropZone.addEventListener('drop', e => {
    e.preventDefault(); psDropZone.classList.remove('dragover');
    psHandleFiles(Array.from(e.dataTransfer.files));
  });
}
if (psFileInput) {
  psFileInput.addEventListener('change', () => { psHandleFiles(Array.from(psFileInput.files)); psFileInput.value = ''; });
}

function psHandleFiles(files) {
  const allowed = /\.(jpg|jpeg|png|gif|bmp|webp|pdf)$/i;
  files.forEach(file => {
    if (!allowed.test(file.name)) { showToast('Format tidak didukung: ' + file.name, 'error'); return; }
    if (file.size > 10 * 1024 * 1024) { showToast('File terlalu besar (maks 10MB): ' + file.name, 'error'); return; }
    if (psSelectedFiles.length >= 5) { showToast('Maksimum 5 file.', 'error'); return; }
    psSelectedFiles.push(file);
  });
  // Clear error jika file sudah diupload
  if (psSelectedFiles.length > 0) {
    psShowErr('ps_lembar_register', false);
  }
  psRenderFileList();
}
function psRenderFileList() {
  const fl = document.getElementById('psFileList');
  if (!fl) return;
  fl.innerHTML = '';
  psSelectedFiles.forEach((file, idx) => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `
      <div class="file-icon"><svg width="15" height="15" fill="white" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8" stroke="white" stroke-width="2" fill="none"/></svg></div>
      <div class="file-info">
        <div class="file-name">${file.name}</div>
        <div class="file-size">${formatSize(file.size)}</div>
      </div>
      <button type="button" class="file-remove" onclick="psRemoveFile(${idx})">
        <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
      </button>
    `;
    fl.appendChild(div);
  });
}
function psRemoveFile(idx) { psSelectedFiles.splice(idx, 1); psRenderFileList(); }
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

// ---- Validation & Submit (Tab 1) ----
function psShowErr(id, show) {
  const el = document.getElementById('err-' + id);
  if (el) el.classList.toggle('visible', show);
}

function psValidate() {
  let valid = true;
  ['ps_tanggal_carian','ps_tanggal_pengerjaan','ps_posisi','ps_tipe_lokasi','ps_zona'].forEach(id => {
    const el = document.getElementById(id);
    const empty = !el.value.trim();
    psShowErr(id, empty);
    if (empty) valid = false;
  });

  const batchOk = getChecked('psBatchSection').length > 0;
  psShowErr('ps_batch', !batchOk);
  if (!batchOk) valid = false;

  const borInputs = document.querySelectorAll('#psBatchOutputList .bor-input:not(:disabled)');
  const errEl  = document.getElementById('err-ps_jumlah_output');
  const errMsg = document.getElementById('psErrOutputMsg');
  errEl.classList.remove('visible');

  if (batchOk) {
    let anyFilled = false;
    borInputs.forEach(inp => {
      if ((parseInt(inp.value)||0) > 0) anyFilled = true;
    });
    if (!anyFilled) { errEl.classList.add('visible'); errMsg.textContent = 'Isi jumlah output untuk minimal satu batch.'; valid = false; }
  }

  // Validasi catatan per-batch jika over capacity
  const overCapacityRows = document.querySelectorAll('#psBatchOutputList .batch-output-row.has-error');
  overCapacityRows.forEach(row => {
    const batch = row.getAttribute('data-batch-row');
    const noteInp = row.querySelector('.bor-note-input');
    if (noteInp && !noteInp.value.trim()) {
      noteInp.style.borderColor = 'var(--error)';
      valid = false;
      showToast(`Harap isi keterangan alasan over-input untuk Batch ${batch}.`, 'error');
    } else if (noteInp) {
      noteInp.style.borderColor = '';
    }
  });

  // Validasi lembar register wajib - REMOVED

  // Global catatan tidak lagi wajib
  document.getElementById('ps_catatan').style.borderColor = '';

  return valid;
}

document.getElementById('pickerForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!psValidate()) {
    showToast('Mohon lengkapi semua field yang wajib diisi.', 'error');
    const firstErr = document.querySelector('#pickerForm .field-error.visible, #psBatchOutputList .bor-error.visible');
    if (firstErr) firstErr.closest('.form-card, .batch-output-row')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btn = document.getElementById('psSubmitBtn');
  btn.classList.add('loading'); btn.disabled = true;

  const batchOutputs = [];
  document.querySelectorAll('#psBatchOutputList .bor-input').forEach(inp => {
    const val = parseInt(inp.value) || 0;
    if (val > 0 && !inp.disabled) {
      const batch = inp.getAttribute('data-batch') || inp.dataset.batch;
      const noteInput = document.querySelector(`#psBatchOutputList .bor-note-input[data-batch="${batch}"]`);
      const keterangan = noteInput ? noteInput.value.trim() : '';
      batchOutputs.push({ batch, jumlah: val, keterangan });
    }
  });

  let finalCatatan = document.getElementById('ps_catatan').value;

  const fd = new FormData();
  fd.append('tanggal_carian',    document.getElementById('ps_tanggal_carian').value);
  fd.append('tanggal_pengerjaan',document.getElementById('ps_tanggal_pengerjaan').value);
  fd.append('nama',              currentUser.nama_lengkap);
  fd.append('posisi',            document.getElementById('ps_posisi').value);
  fd.append('tipe_lokasi',       document.getElementById('ps_tipe_lokasi').value);
  fd.append('zona',              document.getElementById('ps_zona').value);
  fd.append('catatan_tambahan',  finalCatatan);
  fd.append('batch_outputs',     JSON.stringify(batchOutputs));
  if (currentUser && currentUser.userId) fd.append('user_id', currentUser.userId);
  getChecked('psBatchSection').forEach(v => fd.append('batch_cluster', v));
  psSelectedFiles.forEach(f => fd.append('lembar_register', f));

  try {
    const r = await fetch('/api/submit', { method: 'POST', body: fd });
    const d = await r.json();
    if (d.success) {
      document.getElementById('pickerForm').style.display = 'none';
      document.getElementById('psSuccessCard').style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Refresh dashboard di background
      loadDashboard();
    } else {
      if (d.code === 'NOT_ABSEN') {
        showAbsensiBlockedToast(d.error);
      } else {
        showToast(d.error || 'Terjadi kesalahan. Coba lagi.', 'error');
      }
    }
  } catch(err) {
    showToast('Gagal menghubungi server. Periksa koneksi Anda.', 'error');
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
});

function psClearForm() {
  if (!confirm('Kosongkan formulir?')) return;
  document.getElementById('pickerForm').reset();
  psClearAll();
  psSelectedFiles = []; psRenderFileList();
  psBatchCapacityCache = {}; psRenderBatchOutputRows();

  document.getElementById('psCatatanRequiredAsterisk').style.display = 'none';
  psCatatanRequired = false;
  document.querySelectorAll('#pickerForm .field-error.visible').forEach(el => el.classList.remove('visible'));

  // Reset zona options to empty and sync with newly cleared Tipe Lokasi
  document.getElementById('ps_tipe_lokasi').dispatchEvent(new Event('change'));
}

function psResetToForm() {
  document.getElementById('pickerForm').style.display = 'block';
  document.getElementById('psSuccessCard').style.display = 'none';
  psClearForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===================== TAB 2: LOADER LOGIC =====================
let ldBatchCapacityCache = {};
let ldCapacityCallId = 0; // Race condition guard for ldLoadClusterCapacity
let ldCatatanRequired = false;
let ldArmadas = [{ id: Date.now(), no_polisi: '', selectedGms: [] }];
let ldAvailableGroupMobils = [];
let ldGmZonaMap = {}; // Map: group_mobil -> zona (FREZZER/CHILLER/AMBIENT)
let ldSelectedFiles = [];

// File upload handler for Loader
const ldFileInput   = document.getElementById('ldFileInput');
const ldCameraInput = document.getElementById('ldCameraInput');

if (ldFileInput) {
  ldFileInput.addEventListener('change', () => { ldHandleFiles(Array.from(ldFileInput.files)); ldFileInput.value = ''; });
}
if (ldCameraInput) {
  ldCameraInput.addEventListener('change', () => { ldHandleFiles(Array.from(ldCameraInput.files)); ldCameraInput.value = ''; });
}

function ldHandleFiles(files) {
  files.forEach(file => {
    if (ldSelectedFiles.length >= 5) { showToast('Maksimum 5 file.', 'error'); return; }
    if (file.size > 10 * 1024 * 1024) { showToast(`${file.name} terlalu besar (maks 10MB).`, 'error'); return; }
    ldSelectedFiles.push(file);
  });
  // Clear error jika file sudah diupload
  if (ldSelectedFiles.length > 0) {
    ldShowErr('ld_lembar_register', false);
  }
  ldRenderFileList();
}
function ldRenderFileList() {
  const fl = document.getElementById('ldFileList');
  const infoEl = document.getElementById('ldPhotoInfo');
  const countTextEl = document.getElementById('ldPhotoCountText');
  if (!fl) return;

  // Revoke previous object URLs to avoid memory leaks
  fl.querySelectorAll('img[data-blob]').forEach(img => URL.revokeObjectURL(img.src));
  fl.innerHTML = '';

  // Update count badge
  if (infoEl) {
    if (ldSelectedFiles.length > 0) {
      infoEl.style.display = 'flex';
      if (countTextEl) countTextEl.textContent = `${ldSelectedFiles.length} foto dipilih`;
    } else {
      infoEl.style.display = 'none';
    }
  }

  ldSelectedFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'ld-photo-item';
    const isImage = file.type.startsWith('image/');
    if (isImage) {
      const blobUrl = URL.createObjectURL(file);
      item.innerHTML = `
        <img src="${blobUrl}" data-blob="1" alt="${file.name}" loading="lazy">
        <div class="ld-photo-item-name">${file.name}</div>
        <button type="button" class="ld-photo-item-remove" onclick="ldRemoveFile(${idx})" aria-label="Hapus foto">&times;</button>`;
    } else {
      const sizeKB = (file.size / 1024).toFixed(1);
      item.innerHTML = `
        <div class="ld-photo-item-file">
          <div style="font-size:26px;">📎</div>
          <div class="ld-photo-item-fname">${file.name}</div>
          <div class="ld-photo-item-fsize">${sizeKB} KB</div>
        </div>
        <button type="button" class="ld-photo-item-remove" onclick="ldRemoveFile(${idx})" aria-label="Hapus file">&times;</button>`;
    }
    fl.appendChild(item);
  });
}
function ldRemoveFile(idx) { ldSelectedFiles.splice(idx, 1); ldRenderFileList(); }

document.getElementById('ld_tanggal_carian').addEventListener('change', () => {
  ldBatchCapacityCache = {};
  ldLoadGroupMobils();
});

function ldUpdateCount() {
  let count = 0;
  ldArmadas.forEach(a => {
    count += a.selectedGms.length;
  });
  const countEl = document.getElementById('ldSelectedCount');
  if (countEl) countEl.textContent = count;
  return count;
}

function ldRenderArmadas() {
  const container = document.getElementById('ldArmadaListContainer');
  if (!container) return;
  
  if (ldArmadas.length === 0) {
    ldArmadas.push({ id: Date.now(), no_polisi: '', selectedGms: [] });
  }
  
  container.innerHTML = ldArmadas.map((truck, index) => {
    return `
      <div class="armada-card">
        <div class="armada-card-header">
          <div class="armada-card-title">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/><path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H11a1 1 0 001-1v-1h3.05a2.5 2.5 0 014.9 0H21a1 1 0 001-1v-5a1 1 0 00-.293-.707l-4-4A1 1 0 0017 4h-3a1 1 0 00-1-1H3zm13 4.414L18.586 11H15V8.414z"/></svg>
            Armada #${index + 1}
          </div>
          ${index > 0 ? `
          <button type="button" class="btn-remove-armada" onclick="ldRemoveArmada(${index})">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
            Hapus Armada
          </button>
          ` : ''}
        </div>
        
        <div style="margin-bottom: 16px;">
          <label class="field-label" style="font-size:12px; margin-bottom:6px; font-weight:700; color:var(--text); display:block;">No. Polisi <span class="required" style="color:var(--error);">*</span></label>
          <input type="text" 
                 placeholder="CONTOH: B1234XYZ" 
                 class="form-input blue no-polisi-input" 
                 value="${truck.no_polisi}" 
                 oninput="ldUpdateTruckPolisi(${index}, this.value)" 
                 style="text-transform: uppercase; padding: 10px 14px; font-size: 13px; border-radius: 10px; border: 2px solid var(--border); font-weight:700; font-family:'Inter', sans-serif;"
                 required>
        </div>
        
        <div>
          <label class="field-label" style="font-size:12px; margin-bottom:4px; font-weight:700; color:var(--text); display:block;">Muatan Group Mobil (No. Mobil) <span class="required" style="color:var(--error);">*</span></label>
          <p class="field-hint" style="font-size:11px; margin-bottom:8px; color:var(--text-muted);">Pilih group mobil yang dimuat oleh armada ini</p>
          
          <div class="batch-grid" id="ldArmadaGrid_${index}" style="grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-top: 6px;">
            <!-- Chips rendered dynamically -->
          </div>
        </div>
        
        <div class="field-error" id="ld_armada_error_${index}" style="display: none; align-items: center; gap: 4px; margin-top: 8px;">
          <svg width="13" height="13" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
          No. Polisi dan Muatan Group Mobil wajib diisi.
        </div>
      </div>
    `;
  }).join('');
  
  ldArmadas.forEach((truck, index) => {
    ldRenderArmadaGrid(index);
  });
}

function ldRenderArmadaGrid(index) {
  const grid = document.getElementById(`ldArmadaGrid_${index}`);
  if (!grid) return;
  
  const truck = ldArmadas[index];
  
  grid.innerHTML = ldAvailableGroupMobils.map(gm => {
    const isChecked = truck.selectedGms.includes(gm);
    const isSelectedByOther = ldArmadas.some((t, idx) => idx !== index && t.selectedGms.includes(gm));
    const id = `ld_gm_${index}_${gm.replace(/\s/g, '_')}`;
    
    if (isSelectedByOther) {
      return `
        <div class="batch-item blue-chip disabled" style="opacity: 0.85; pointer-events: none;">
          <input type="checkbox" id="${id}" value="${gm}" disabled>
          <label for="${id}" style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 48px; padding: 4px 2px; border: 2px dashed rgba(239, 68, 68, 0.35); background: repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.02), rgba(239, 68, 68, 0.02) 6px, rgba(239, 68, 68, 0.05) 6px, rgba(239, 68, 68, 0.05) 12px); color: #EF4444; border-radius: 8px; cursor: not-allowed; transition: all 0.2s;">
            <span style="font-weight: 700; font-size: 11px; letter-spacing: 0.3px; opacity: 0.8;">${gm}</span>
            <span style="font-size: 8px; font-weight: 800; background: rgba(239, 68, 68, 0.1); padding: 1px 4px; border-radius: 4px; margin-top: 3px; display: inline-flex; align-items: center; gap: 2px;">
              🔒 TERPAKAI
            </span>
          </label>
        </div>
      `;
    }
    
    return `
      <div class="batch-item blue-chip ${isChecked ? 'selected' : ''}">
        <input type="checkbox" 
               id="${id}" 
               value="${gm}" 
               ${isChecked ? 'checked' : ''} 
               onchange="ldToggleTruckGm(${index}, '${gm}', this.checked)">
        <label for="${id}" style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 48px; padding: 6px 4px; cursor: pointer; transition: all 0.2s;">
          <span style="font-weight: 700; font-size: 12px;">${gm}</span>
        </label>
      </div>
    `;
  }).join('');
}

function ldUpdateTruckPolisi(index, val) {
  ldArmadas[index].no_polisi = val.trim().toUpperCase();
  
  const headerEl = document.getElementById(`ld_actual_header_${index}`);
  if (headerEl) {
    headerEl.innerHTML = `<svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20" style="vertical-align: middle; margin-right: 4px; color: var(--accent-blue);"><path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/><path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H11a1 1 0 001-1v-1h3.05a2.5 2.5 0 014.9 0H21a1 1 0 001-1v-5a1 1 0 00-.293-.707l-4-4A1 1 0 0017 4h-3a1 1 0 00-1-1H3zm13 4.414L18.586 11H15V8.414z"/></svg> Armada: ${ldArmadas[index].no_polisi || '(Belum diisi)'}`;
  }

  const detailsHeaderEl = document.getElementById(`ld_details_header_${index}`);
  if (detailsHeaderEl) {
    detailsHeaderEl.textContent = `Armada: ${ldArmadas[index].no_polisi || '-'}`;
  }
}

function ldToggleTruckGm(index, gm, checked) {
  const truck = ldArmadas[index];
  if (checked) {
    if (!truck.selectedGms.includes(gm)) {
      truck.selectedGms.push(gm);
    }
  } else {
    truck.selectedGms = truck.selectedGms.filter(x => x !== gm);
  }
  
  ldArmadas.forEach((t, idx) => {
    ldRenderArmadaGrid(idx);
  });
  
  ldUpdateCount();
  ldLoadClusterCapacity();
}

function ldAddArmada() {
  ldArmadas.push({ id: Date.now(), no_polisi: '', selectedGms: [] });
  ldRenderArmadas();
  ldLoadClusterCapacity();
}

function ldRemoveArmada(index) {
  ldArmadas.splice(index, 1);
  ldRenderArmadas();
  ldLoadClusterCapacity();
}

async function ldLoadGroupMobils() {
  try {
    const tanggal = document.getElementById('ld_tanggal_carian').value;
    const armadaSection = document.getElementById('ldArmadaSection');
    const armadaListContainer = document.getElementById('ldArmadaListContainer');
    
    const outputList = document.getElementById('ldClusterOutputList');
    const empty      = document.getElementById('ldClusterOutputEmpty');
    const capCard    = document.getElementById('ldCapacityCard');
    const capLoading = document.getElementById('ldCapacityLoading');
    const capInfo    = document.getElementById('ldCapacityInfo');

    // Reset all
    if (armadaListContainer) armadaListContainer.innerHTML = '';
    if (armadaSection) armadaSection.style.display = 'none';
    
    outputList.innerHTML = '';
    empty.style.display = '';
    if (capCard) capCard.style.display = 'none';
    if (capLoading) capLoading.style.display = 'none';
    if (capInfo) capInfo.style.display = 'none';
    
    ldArmadas = [{ id: Date.now(), no_polisi: '', selectedGms: [] }];
    ldAvailableGroupMobils = [];
    ldGmZonaMap = {};
    
    ldUpdateTotal();

    if (!tanggal) return;

    empty.textContent = 'Memuat daftar Group Mobil dari server...';

    const r = await fetch(`/api/data-carian?tanggal=${tanggal}`);
    const records = await r.json();
    
    // Ambil SEMUA records Loader, semua zona digabung
    const activeRecords = records.filter(rec => rec.posisi === 'Loader');

    if (activeRecords.length === 0) {
      empty.textContent = `⚠️ Tidak ada data carian Loader untuk tanggal ${tanggal}.`;
      return;
    }

    // Bangun map GM -> zona, dan list unik GM
    activeRecords.forEach(rec => {
      const gm = String(rec.batch).trim();
      const zona = String(rec.zona).trim().toUpperCase();
      if (!ldGmZonaMap[gm]) ldGmZonaMap[gm] = [];
      if (!ldGmZonaMap[gm].includes(zona)) ldGmZonaMap[gm].push(zona);
    });
    ldAvailableGroupMobils = Array.from(new Set(activeRecords.map(rec => String(rec.batch).trim()))).sort();
    
    if (armadaSection) armadaSection.style.display = 'block';
    empty.textContent = 'Masukkan armada dan pilih Group Mobil yang dimuat.';
    
    ldRenderArmadas();
  } catch (err) {
    console.error('ldLoadGroupMobils error:', err);
    showOnscreenError('ldLoadGroupMobils', err);
  }
}

async function ldLoadClusterCapacity() {
  const myCallId = ++ldCapacityCallId; // Capture this call's ID to detect stale calls
  try {
    const tanggal = document.getElementById('ld_tanggal_carian').value;
    // zona per GM diambil dari ldGmZonaMap saat fetch capacity
    const outputList = document.getElementById('ldClusterOutputList');
    const empty      = document.getElementById('ldClusterOutputEmpty');
    const capCard    = document.getElementById('ldCapacityCard');
    const detailsContainer = document.getElementById('ldCapacityDetails');
    const capLoading = document.getElementById('ldCapacityLoading');
    const capInfo    = document.getElementById('ldCapacityInfo');

    // Aggregate all selected group mobils
    const allSelectedGms = [];
    ldArmadas.forEach(a => {
      a.selectedGms.forEach(gm => {
        if (!allSelectedGms.includes(gm)) allSelectedGms.push(gm);
      });
    });

    // Keep active inputs values to not overwrite them when checking new boxes
    const activeValues = {};
    document.querySelectorAll('#ldClusterOutputList .bor-input').forEach(inp => {
      activeValues[inp.getAttribute('data-batch') || inp.dataset.batch] = inp.value;
    });

    // Reset output list completely
    outputList.innerHTML = '';
    
    if (detailsContainer) {
      detailsContainer.innerHTML = '';
      detailsContainer.style.display = 'none';
    }
    
    if (!tanggal || allSelectedGms.length === 0) {
      empty.style.display = '';
      empty.textContent = 'Pilih satu atau beberapa Group Mobil terlebih dahulu.';
      if (capCard) capCard.style.display = 'none';
      if (capLoading) capLoading.style.display = 'none';
      if (capInfo) capInfo.style.display = 'none';
      ldUpdateTotal();
      return;
    }

    empty.style.display = 'none';
    
    // Show card and loading spinner immediately!
    if (capCard) capCard.style.display = 'block';
    if (capLoading) capLoading.style.display = 'flex';
    if (capInfo) capInfo.style.display = 'none';
    
    const promises = allSelectedGms.map(async gm => {
      if (ldBatchCapacityCache[gm]) return { gm, cap: ldBatchCapacityCache[gm] };
      const zonas = Array.isArray(ldGmZonaMap[gm]) ? ldGmZonaMap[gm] : (ldGmZonaMap[gm] ? [ldGmZonaMap[gm]] : []);
      if (zonas.length === 0) return { gm, cap: { ada_data_carian: false, total_output: 0, satuan: 'kontainer', sudah_diisi: 0, sisa: 0 } };
      // Fetch untuk semua zona yang dimiliki GM ini
      const capResults = await Promise.all(zonas.map(async zona => {
        const r = await fetch(`/api/batch-capacity?tanggal_carian=${tanggal}&posisi=Loader&zona=${encodeURIComponent(zona)}&batch=${encodeURIComponent(gm)}`);
        return r.json();
      }));
      // Gabungkan hasil semua zona
      const cap = {
        ada_data_carian: capResults.some(c => c.ada_data_carian),
        total_output:    capResults.reduce((s, c) => s + (c.total_output  || 0), 0),
        satuan:          capResults.find(c => c.satuan)?.satuan || 'kontainer',
        sudah_diisi:     capResults.reduce((s, c) => s + (c.sudah_diisi   || 0), 0),
        sisa:            capResults.reduce((s, c) => s + (c.sisa          || 0), 0),
      };
      ldBatchCapacityCache[gm] = cap;
      return { gm, cap };
    });

    const results = await Promise.all(promises);

    // Stale call guard: if a newer call has started while we were awaiting,
    // discard this result to prevent duplicate/out-of-order rendering
    if (myCallId !== ldCapacityCallId) return;

    // Sum total target capacity for all selected group mobils
    let totalTarget = 0;
    let anyHasTarget = false;
    results.forEach(({ cap }) => {
      if (cap.ada_data_carian && cap.total_output > 0) {
        totalTarget += cap.total_output;
        anyHasTarget = true;
      }
    });

    // Hide loading spinner
    if (capLoading) capLoading.style.display = 'none';

    if (anyHasTarget) {
      if (capCard) capCard.style.display = 'block';
      if (capInfo) {
        capInfo.style.display = 'flex';
        const plates = ldArmadas.map(a => a.no_polisi || '-').filter(p => p !== '-');
        const plateLabel = plates.length > 0 ? plates.join(', ') : 'Daftar Armada';
        // Tampilkan zona unik dari GMs yang dipilih
        const zonaSet = new Set(allSelectedGms.flatMap(gm => ldGmZonaMap[gm] || []).filter(Boolean));
        const zonaLabel = zonaSet.size > 0 ? Array.from(zonaSet).join(', ') : 'Semua Zona';
        document.getElementById('ldCapacityClusterLabel').textContent = `${plateLabel} (${zonaLabel})`;
        document.getElementById('ldCapacityValue').textContent = formatNum(totalTarget);
      }
      
      // Render details grouped by truck
      if (detailsContainer) {
        let detailsHtml = '';
        ldArmadas.forEach((truck, index) => {
          if (truck.selectedGms.length === 0) return;
          
          let truckDetailsHtml = '';
          truck.selectedGms.forEach(gm => {
            const res = results.find(r => r.gm === gm);
            if (res && res.cap.ada_data_carian && res.cap.total_output > 0) {
              truckDetailsHtml += `
                <div class="tc-details-item" style="margin-left: 12px; padding: 4px 0;">
                  <span class="tc-details-name">
                    <span class="bor-badge blue" style="font-size: 10px; padding: 2px 6px; margin: 0; margin-right: 6px;">${gm}</span>
                    <span style="font-size: 12px; color: var(--text-muted);">Kapasitas Target</span>
                  </span>
                  <span class="tc-details-val">${formatNum(res.cap.total_output)} kontainer</span>
                </div>
              `;
            }
          });
          
          if (truckDetailsHtml) {
            detailsHtml += `
              <div style="margin-bottom: 8px;">
                <div id="ld_details_header_${index}" style="font-weight:700; font-size:12px; color:var(--accent-blue-dark); margin: 6px 0; border-bottom: 1px dashed rgba(14,165,233,0.15); padding-bottom: 2px;">
                  Armada: ${truck.no_polisi || '-'}
                </div>
                ${truckDetailsHtml}
              </div>
            `;
          }
        });
        
        if (detailsHtml) {
          detailsContainer.innerHTML = detailsHtml;
          detailsContainer.style.display = 'flex';
        }
      }
    } else {
      if (capCard) capCard.style.display = 'none';
      if (capInfo) capInfo.style.display = 'none';
    }

    // Render input row grouped by truck!
    ldArmadas.forEach((truck, index) => {
      if (truck.selectedGms.length === 0) return;
      
      const truckDiv = document.createElement('div');
      truckDiv.id = `ld_truck_actual_group_${index}`;
      truckDiv.style.marginBottom = '16px';
      
      truckDiv.innerHTML = `
        <div id="ld_actual_header_${index}" style="font-weight: 700; font-size: 13px; color: var(--accent-blue-dark); margin-top: 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20" style="vertical-align: middle; margin-right: 4px; color: var(--accent-blue);"><path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/><path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H11a1 1 0 001-1v-1h3.05a2.5 2.5 0 014.9 0H21a1 1 0 001-1v-5a1 1 0 00-.293-.707l-4-4A1 1 0 0017 4h-3a1 1 0 00-1-1H3zm13 4.414L18.586 11H15V8.414z"/></svg>
          Armada: ${truck.no_polisi || '(Belum diisi)'}
        </div>
        <div id="ld_truck_actual_rows_${index}" class="bor-grid"></div>
      `;
      outputList.appendChild(truckDiv);
      
      const rowsContainer = document.getElementById(`ld_truck_actual_rows_${index}`);
      truck.selectedGms.forEach(gm => {
        const res = results.find(r => r.gm === gm);
        if (res) {
          ldRenderClusterInputRow(gm, res.cap, rowsContainer);
        }
      });
    });

    // Restore previously typed values if they are still selected
    document.querySelectorAll('#ldClusterOutputList .bor-input').forEach(inp => {
      const gm = inp.getAttribute('data-batch') || inp.dataset.batch;
      if (activeValues[gm] !== undefined) {
        inp.value = activeValues[gm];
        ldValidateBorInput(inp);
      }
    });

    ldUpdateTotal();
  } catch(err) {
    const capCard    = document.getElementById('ldCapacityCard');
    const capLoading = document.getElementById('ldCapacityLoading');
    const capInfo    = document.getElementById('ldCapacityInfo');
    if (capCard) capCard.style.display = 'none';
    if (capLoading) capLoading.style.display = 'none';
    if (capInfo) capInfo.style.display = 'none';

    console.error('ldLoadClusterCapacity error:', err);
    showOnscreenError('ldLoadClusterCapacity', err);
  }
}

function ldRenderClusterInputRow(groupMobil, cap, customContainer = null) {
  try {
    const outputList = customContainer || document.getElementById('ldClusterOutputList');
    const empty      = document.getElementById('ldClusterOutputEmpty');
    if (empty) empty.style.display = 'none';

    const isFull = cap && cap.ada_data_carian && cap.sisa <= 0;
    const isWarn = cap && cap.ada_data_carian && cap.sisa > 0 && (cap.sudah_diisi / cap.total_output) >= 0.75;
    const satuan = 'kontainer';

    const total  = cap && cap.ada_data_carian ? cap.total_output : 0;
    const filled = cap && cap.ada_data_carian ? cap.sudah_diisi : 0;
    const sisa   = cap && cap.ada_data_carian ? cap.sisa : 0;
    const pct    = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;
    const pfClass = isFull ? 'full' : (pct >= 75 ? 'warn' : 'ok');
    const hasData = cap && cap.ada_data_carian;

    const statsHtml = hasData ? `
      <div class="bor-stats-row">
        <div class="bor-stat-item">
          <span class="bor-stat-label">Target</span>
          <span class="bor-stat-value">${formatNum(total)}</span>
          <span class="bor-stat-unit">${satuan}</span>
        </div>
        <div class="bor-stat-sep"></div>
        <div class="bor-stat-item">
          <span class="bor-stat-label">Terisi</span>
          <span class="bor-stat-value bor-dyn-filled" data-base="${filled}">${formatNum(filled)}</span>
          <span class="bor-stat-unit">${satuan}</span>
        </div>
        <div class="bor-stat-sep"></div>
        <div class="bor-stat-item ${isFull ? 'is-full' : ''} bor-dyn-sisa-wrap">
          <span class="bor-stat-label">Sisa</span>
          <span class="bor-stat-value bor-dyn-sisa ${isFull ? 'full' : 'ok'}" data-base="${sisa}">${formatNum(sisa)}</span>
          <span class="bor-stat-unit">${satuan}</span>
        </div>
      </div>
      <div class="bor-progress-wrap">
        <div class="bor-prog-track">
          <div class="bor-prog-filled ${pfClass}" style="width:${pct}%" data-pct-base="${pct}" data-total="${total}"></div>
          <div class="bor-prog-input ok" style="width:0%"></div>
        </div>
        <span class="bor-prog-pct bor-dyn-pct">${pct}%</span>
      </div>` : `
      <div class="bor-no-cap">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
        Belum ada data target untuk group mobil ini
      </div>`;

    const row = document.createElement('div');
    row.className = `batch-output-row${isFull ? ' is-full' : ''}`;
    row.setAttribute('data-batch-row', groupMobil);
    row.innerHTML = `
      <div class="bor-card-head">
        <span class="bor-badge blue">🚚 ${groupMobil}</span>
        ${hasData ? `<span class="bor-head-status ${isFull ? 'full' : (pct >= 75 ? 'warn' : 'ok')}">${isFull ? '🔴 Penuh' : pct >= 75 ? '🟡 Hampir penuh' : '🟢 Tersedia'}</span>` : ''}
      </div>
      ${statsHtml}
      <div class="bor-input-card">
        <div class="bor-input-label">Jumlah Kontainer Aktual</div>
        <div class="bor-input-row">
          <input type="number" class="bor-input blue" data-batch="${groupMobil}" placeholder="0" min="0"
            oninput="ldValidateBorInput(this); ldUpdateTotal()">
          <span class="bor-satuan">${satuan}</span>
        </div>
      </div>
      <div class="bor-note-row" id="ld-note-row-${groupMobil}" style="display:none; padding: 0 16px 12px;">
        <input type="text" class="form-input bor-note-input blue" data-batch="${groupMobil}" placeholder="Tulis alasan / keterangan over-input untuk Group Mobil ${groupMobil}..." style="font-size:12px; padding:8px 12px; border-radius:8px; border: 1.5px dashed var(--error); width: 100%; box-sizing: border-box; outline: none; background: rgba(14,165,233,0.01);">
      </div>
      <div class="bor-error${isFull ? ' visible' : ''}">${isFull ? '⚠️ Kapasitas sudah habis! Input ini akan masuk status Pending untuk divalidasi admin.' : ''}</div>
    `;
    outputList.appendChild(row);

    ldUpdateTotal();
    ldCheckOverInput();
  } catch (err) {
    showOnscreenError('ldRenderClusterInputRow', err);
  }
}

function ldValidateBorInput(inp) {
  try {
    const groupMobil = inp.getAttribute('data-batch') || inp.dataset.batch;
    const cap = ldBatchCapacityCache[groupMobil];
    const row = inp.closest('.batch-output-row');
    if (!row) return;
    const errEl = row.querySelector('.bor-error');
    const val   = parseInt(inp.value) || 0;

    row.classList.remove('has-error', 'is-ok', 'is-full');
    if (errEl) {
      errEl.classList.remove('visible');
      errEl.textContent = '';
    }

    // ---- Update real-time stats ----
    if (cap && cap.ada_data_carian) {
      const total  = cap.total_output || 0;
      const filled = cap.sudah_diisi  || 0;
      const sisa   = cap.sisa         || 0;
      const satuan = 'kontainer';

      // Update Terisi chip
      const dynFilled = row.querySelector('.bor-dyn-filled');
      if (dynFilled) dynFilled.textContent = formatNum(filled + val);

      // Update Sisa chip
      const dynSisa = row.querySelector('.bor-dyn-sisa');
      if (dynSisa) {
        const newSisa = sisa - val;
        dynSisa.textContent = formatNum(newSisa);
        dynSisa.className = `bor-stat-value bor-dyn-sisa ${newSisa < 0 ? 'full' : newSisa === 0 ? 'full' : sisa <= 0 ? 'full' : 'ok'}`;
      }

      // Update progress bar (dua layer: filled + input user)
      const progFilled = row.querySelector('.bor-prog-filled');
      const progInput  = row.querySelector('.bor-prog-input');
      const dynPct     = row.querySelector('.bor-dyn-pct');
      if (total > 0 && progFilled && progInput) {
        const basePct  = Math.min(100, (filled / total) * 100);
        const inputPct = Math.min(100 - basePct, (val / total) * 100);
        const totalPct = Math.min(100, basePct + inputPct);
        progFilled.style.width = basePct + '%';
        progInput.style.width  = inputPct + '%';
        // Warna progress user
        const overCap = filled + val > total;
        progInput.className = `bor-prog-input ${overCap ? 'over' : 'new'}`;
        if (dynPct) dynPct.textContent = Math.round(totalPct) + '%';
        // Warna filled bar
        progFilled.className = `bor-prog-filled ${totalPct >= 100 ? 'full' : totalPct >= 75 ? 'warn' : 'ok'}`;
      }
    }

    const noteRow = row.querySelector('.bor-note-row');
    if (cap && cap.ada_data_carian) {
      if (cap.sisa <= 0) {
        if (val > 0) {
          row.classList.add('has-error');
          if (errEl) {
            errEl.innerHTML = `⚠️ Kapasitas sudah habis! Sisa: 0. Submission akan masuk status <strong>Pending</strong> dan perlu validasi admin.`;
            errEl.classList.add('visible');
          }
          if (noteRow) noteRow.style.display = 'block';
        } else {
          row.classList.add('is-full');
          if (errEl) {
            errEl.innerHTML = `⚠️ Kapasitas sudah habis! Input ini akan masuk status <strong>Pending</strong>.`;
            errEl.classList.add('visible');
          }
          if (noteRow) noteRow.style.display = 'none';
        }
      } else if (val > cap.sisa) {
        row.classList.add('has-error');
        if (errEl) {
          errEl.innerHTML = `⚠️ Melebihi sisa kapasitas! Sisa: ${formatNum(cap.sisa)} kontainer. Submission akan masuk status <strong>Pending</strong> dan perlu validasi admin.`;
          errEl.classList.add('visible');
        }
        if (noteRow) noteRow.style.display = 'block';
      } else if (val > 0) {
        row.classList.add('is-ok');
        if (noteRow) noteRow.style.display = 'none';
      } else {
        if (noteRow) noteRow.style.display = 'none';
      }
    } else {
      if (val > 0) {
        row.classList.add('is-ok');
      }
      if (noteRow) noteRow.style.display = 'none';
    }
    ldCheckOverInput();
  } catch (err) {
    showOnscreenError('ldValidateBorInput', err);
  }
}

function ldCheckOverInput() {
  // No-op: NIK leader validation is removed
}

function ldUpdateTotal() {
  let total = 0;
  document.querySelectorAll('#ldClusterOutputList .bor-input').forEach(inp => {
    total += parseInt(inp.value) || 0;
  });
  total += parseInt(document.getElementById('ld_gacoan').value)  || 0;
  total += parseInt(document.getElementById('ld_dikichi').value) || 0;
  total += parseInt(document.getElementById('ld_benfarm').value) || 0;
  document.getElementById('ldTotalKontainer').textContent = total.toLocaleString('id-ID');
}

function ldShowErr(id, show) {
  const el = document.getElementById('err-' + id);
  if (el) el.classList.toggle('visible', show);
}

function ldValidate() {
  let valid = true;
  
  // Validate global fields — hanya tanggal, cluster tidak perlu dipilih lagi
  ['ld_tanggal_carian','ld_tanggal_kirim'].forEach(id => {
    const el = document.getElementById(id);
    const empty = !el.value.trim();
    ldShowErr(id, empty);
    if (empty) valid = false;
  });

  // Validate each armada
  ldArmadas.forEach((truck, index) => {
    const errEl = document.getElementById(`ld_armada_error_${index}`);
    const plateEmpty = !truck.no_polisi.trim();
    const gmsEmpty = truck.selectedGms.length === 0;
    
    if (plateEmpty || gmsEmpty) {
      if (errEl) errEl.style.display = 'flex';
      valid = false;
    } else {
      if (errEl) errEl.style.display = 'none';
    }
  });

  const errKont = document.getElementById('err-ld_kontainer');
  const errMsg  = document.getElementById('ldErrKontainerMsg');
  if (errKont) errKont.classList.remove('visible');

  const inputs = document.querySelectorAll('#ldClusterOutputList .bor-input:not(:disabled)');
  let anyFilled = false;
  inputs.forEach(inp => {
    if ((parseInt(inp.value)||0) > 0) anyFilled = true;
  });
  if (!anyFilled) {
    if (errKont) {
      errKont.classList.add('visible');
      errMsg.textContent = 'Isi jumlah kontainer aktual.';
    }
    valid = false;
  }

  // Validasi catatan per group mobil jika over capacity
  const overCapacityLdRows = document.querySelectorAll('#ldClusterOutputList .batch-output-row.has-error');
  overCapacityLdRows.forEach(row => {
    const gm = row.getAttribute('data-batch-row');
    const noteInp = row.querySelector('.bor-note-input');
    if (noteInp && !noteInp.value.trim()) {
      noteInp.style.borderColor = 'var(--error)';
      valid = false;
      showToast(`Harap isi keterangan alasan over-input untuk Group Mobil ${gm}.`, 'error');
    } else if (noteInp) {
      noteInp.style.borderColor = '';
    }
  });

  // Validasi lembar register wajib - REMOVED

  // Global catatan tidak lagi wajib
  document.getElementById('ld_catatan').style.borderColor = '';

  return valid;
}

document.getElementById('loaderForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!ldValidate()) {
    showToast('Mohon lengkapi semua field yang wajib diisi.', 'error');
    return;
  }

  const btn = document.getElementById('ldSubmitBtn');
  btn.classList.add('loading'); btn.disabled = true;

  // Ambil files loader
  const ldFiles = ldSelectedFiles.slice();
  // Derive zona dari GM yang dipilih via ldGmZonaMap
  const allSelectedGmsForZona = [];
  ldArmadas.forEach(a => a.selectedGms.forEach(gm => { if (!allSelectedGmsForZona.includes(gm)) allSelectedGmsForZona.push(gm); }));
  const zonaSet = new Set(allSelectedGmsForZona.flatMap(gm => ldGmZonaMap[gm] || []).filter(Boolean));
  const zona = zonaSet.size > 0 ? Array.from(zonaSet).sort().join(', ') : 'LOADER';
  const clusterOutputs = {};
  document.querySelectorAll('#ldClusterOutputList .bor-input').forEach(inp => {
    if (!inp.disabled) {
      clusterOutputs[inp.getAttribute('data-batch') || inp.dataset.batch] = parseInt(inp.value) || 0;
    }
  });

  const nonGroup = {
    gacoan:  parseInt(document.getElementById('ld_gacoan').value)  || 0,
    dikichi: parseInt(document.getElementById('ld_dikichi').value) || 0,
    benfarm: parseInt(document.getElementById('ld_benfarm').value) || 0,
  };

  let finalCatatan = document.getElementById('ld_catatan').value;
  
  // Ambil semua keterangan per group mobil yang over
  const ldNotes = [];
  document.querySelectorAll('#ldClusterOutputList .bor-note-input').forEach(inp => {
    const val = inp.value.trim();
    if (val) {
      const gm = inp.getAttribute('data-batch') || inp.dataset.batch;
      ldNotes.push(`${gm}: ${val}`);
    }
  });
  if (ldNotes.length > 0) {
    finalCatatan = finalCatatan ? `${finalCatatan} [Detail Over-input -> ${ldNotes.join('; ')}]` : `[Detail Over-input -> ${ldNotes.join('; ')}]`;
  }



  try {
    const promises = ldArmadas.map(async (truck, index) => {
      const truckOutputs = {};
      truck.selectedGms.forEach(gm => {
        truckOutputs[gm] = clusterOutputs[gm] || 0;
      });
      const truckTotal = Object.values(truckOutputs).reduce((a, b) => a + b, 0);
      
      const fd = new FormData();
      fd.append('tanggal_carian',    document.getElementById('ld_tanggal_carian').value);
      fd.append('tanggal_kirim',     document.getElementById('ld_tanggal_kirim').value);
      fd.append('nama',              currentUser.nama_lengkap);
      fd.append('zona',              zona);
      fd.append('no_polisi',         truck.no_polisi);
      fd.append('clusters',          JSON.stringify(truck.selectedGms));
      fd.append('cluster_outputs',   JSON.stringify(truckOutputs));
      fd.append('non_group',         JSON.stringify(index === 0 ? nonGroup : { gacoan: 0, dikichi: 0, benfarm: 0 }));
      fd.append('jumlah_kontainer',  String(index === 0 ? (truckTotal + nonGroup.gacoan + nonGroup.dikichi + nonGroup.benfarm) : truckTotal));
      fd.append('catatan',           finalCatatan);
      // Lampirkan foto hanya ke armada pertama (index 0)
      if (index === 0) {
        ldFiles.forEach(file => fd.append('lembar_register', file));
      }

      const r = await fetch('/api/loader-entries', {
        method: 'POST',
        body: fd
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || `Gagal mengirim armada ${truck.no_polisi}`);
      }
      return r.json();
    });

    await Promise.all(promises);
    showToast('Semua Entry Loader berhasil dikirim! ✅', 'info');
    ldResetForm();
    // Refresh dashboard di background
    loadDashboard();
  } catch(err) {
    showToast(err.message || 'Gagal menghubungi server. Periksa koneksi.', 'error');
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
});

function ldResetForm() {
  document.getElementById('loaderForm').reset();
  ldBatchCapacityCache = {};
  document.getElementById('ldClusterOutputList').innerHTML = '';
  document.getElementById('ldClusterOutputEmpty').style.display = '';
  const capCard    = document.getElementById('ldCapacityCard');
  const capLoading = document.getElementById('ldCapacityLoading');
  const capInfo    = document.getElementById('ldCapacityInfo');
  if (capCard) capCard.style.display = 'none';
  if (capLoading) capLoading.style.display = 'none';
  if (capInfo) capInfo.style.display = 'none';
  
  const armadaSection = document.getElementById('ldArmadaSection');
  if (armadaSection) armadaSection.style.display = 'none';
  const armadaListContainer = document.getElementById('ldArmadaListContainer');
  if (armadaListContainer) armadaListContainer.innerHTML = '';
  
  ldArmadas = [{ id: Date.now(), no_polisi: '', selectedGms: [] }];
  ldAvailableGroupMobils = [];
  ldGmZonaMap = {};

  ldUpdateTotal();

  // Reset file upload loader
  ldSelectedFiles = [];
  const ldFileInputInp = document.getElementById('ldFileInput');
  if (ldFileInputInp) ldFileInputInp.value = '';
  const ldFileListContainer = document.getElementById('ldFileList');
  if (ldFileListContainer) ldFileListContainer.innerHTML = '';

  document.getElementById('ldCatatanRequiredAsterisk').style.display = 'none';
  ldCatatanRequired = false;
  document.querySelectorAll('#loaderForm .field-error.visible').forEach(el => el.classList.remove('visible'));
}

function ldClearForm() {
  if (!confirm('Kosongkan formulir?')) return;
  ldResetForm();
}

// ===================== DASHBOARD =====================
let dashboardLoaded = false;

async function loadDashboard() {
  const loading = document.getElementById('dashLoading');
  const main    = document.getElementById('dashMain');
  if (loading) loading.style.display = 'flex';
  if (main) main.style.display = 'none';

  try {
    const r = await fetch('/api/my-achievements');
    if (!r.ok) throw new Error('Gagal memuat data.');
    const d = await r.json();

    const fmt = v => Number(v || 0).toLocaleString('id-ID');
    const fmtDate = (dateStr) => {
      if (!dateStr) return '-';
      const dt = new Date(dateStr + 'T00:00:00');
      return dt.toLocaleDateString('id-ID', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    };
    const fmtTime = (isoStr) => {
      if (!isoStr) return '-';
      return new Date(isoStr).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Jakarta' });
    };
    const statusBadge = (status) => {
      if (status === 'approved') return '<span class="dash-badge approved">✓ Approved</span>';
      if (status === 'pending')  return '<span class="dash-badge pending">⏳ Pending</span>';
      return `<span class="dash-badge">${status}</span>`;
    };

    // Tanggal hari ini
    const todayFmt = fmtDate(d.today_date);
    const el = (id) => document.getElementById(id);

    let hasAny = false;

    // ---- PICKER ----
    const p = d.picker;
    if (p && (p.all.total_batch > 0 || p.today.total_batch > 0)) {
      hasAny = true;
      el('dashSectionPicker').style.display = 'block';
      el('dashPickerDate').textContent = todayFmt;
      el('dashPickerBatchToday').textContent = fmt(p.today.total_batch);
      el('dashPickerOutputToday').textContent = fmt(p.today.total_output);
      el('dashPickerBatchAll').textContent = fmt(p.all.total_batch);
      el('dashPickerOutputAll').textContent = fmt(p.all.total_output);
      // Status
      el('dashPickerStatus').innerHTML = `
        <span class="dash-badge approved">✓ Approved: ${fmt(p.today.approved)}</span>
        ${p.today.pending > 0 ? `<span class="dash-badge pending">⏳ Pending: ${fmt(p.today.pending)}</span>` : ''}
      `;
      // List
      if (p.today.submissions && p.today.submissions.length > 0) {
        el('dashPickerList').innerHTML = p.today.submissions.map(s => {
          let batches = [];
          try { batches = JSON.parse(s.batch_cluster || '[]'); } catch(e) { batches = []; }
          return `
            <div class="dash-list-item">
              <div class="dash-list-left">
                <div class="dash-list-batch">${batches.join(', ') || '-'}</div>
                <div class="dash-list-meta">${s.zona || '-'} · ${fmtTime(s.created_at)}</div>
              </div>
              <div class="dash-list-right">
                <div class="dash-list-value">${fmt(s.jumlah_output)} pcs</div>
                ${statusBadge(s.status)}
              </div>
            </div>`;
        }).join('');
      } else {
        el('dashPickerList').innerHTML = '<div class="dash-list-empty">Belum ada submission Picker hari ini</div>';
      }
    } else {
      el('dashSectionPicker').style.display = 'none';
    }

    // ---- SORTER ----
    const so = d.sorter;
    if (so && (so.all.total_batch > 0 || so.today.total_batch > 0)) {
      hasAny = true;
      el('dashSectionSorter').style.display = 'block';
      el('dashSorterDate').textContent = todayFmt;
      el('dashSorterBatchToday').textContent = fmt(so.today.total_batch);
      el('dashSorterOutputToday').textContent = fmt(so.today.total_output);
      el('dashSorterBatchAll').textContent = fmt(so.all.total_batch);
      el('dashSorterOutputAll').textContent = fmt(so.all.total_output);
      el('dashSorterStatus').innerHTML = `
        <span class="dash-badge approved">✓ Approved: ${fmt(so.today.approved)}</span>
        ${so.today.pending > 0 ? `<span class="dash-badge pending">⏳ Pending: ${fmt(so.today.pending)}</span>` : ''}
      `;
      if (so.today.submissions && so.today.submissions.length > 0) {
        el('dashSorterList').innerHTML = so.today.submissions.map(s => {
          let batches = [];
          try { batches = JSON.parse(s.batch_cluster || '[]'); } catch(e) { batches = []; }
          return `
            <div class="dash-list-item">
              <div class="dash-list-left">
                <div class="dash-list-batch">${batches.join(', ') || '-'}</div>
                <div class="dash-list-meta">${s.zona || '-'} · ${fmtTime(s.created_at)}</div>
              </div>
              <div class="dash-list-right">
                <div class="dash-list-value">${fmt(s.jumlah_output)} kont.</div>
                ${statusBadge(s.status)}
              </div>
            </div>`;
        }).join('');
      } else {
        el('dashSorterList').innerHTML = '<div class="dash-list-empty">Belum ada submission Sorter hari ini</div>';
      }
    } else {
      el('dashSectionSorter').style.display = 'none';
    }

    // ---- LOADER ----
    const lo = d.loader;
    if (lo && (lo.all.total_trip > 0 || lo.today.total_trip > 0)) {
      hasAny = true;
      el('dashSectionLoader').style.display = 'block';
      el('dashLoaderDate').textContent = todayFmt;
      el('dashLoaderTripToday').textContent = fmt(lo.today.total_trip);
      el('dashLoaderKontainerToday').textContent = fmt(lo.today.total_kontainer);
      el('dashLoaderTripAll').textContent = fmt(lo.all.total_trip);
      el('dashLoaderKontainerAll').textContent = fmt(lo.all.total_kontainer);
      if (lo.today.entries && lo.today.entries.length > 0) {
        el('dashLoaderList').innerHTML = lo.today.entries.map(e => {
          let clusterList = [];
          try {
            if (Array.isArray(e.clusters)) clusterList = e.clusters;
            else if (e.clusters && typeof e.clusters === 'object') clusterList = e.clusters.list || [];
          } catch(err) {}
          return `
            <div class="dash-list-item">
              <div class="dash-list-left">
                <div class="dash-list-batch">${e.no_polisi || '-'}</div>
                <div class="dash-list-meta">${e.zona || '-'} · ${clusterList.join(', ') || '-'} · ${fmtTime(e.created_at)}</div>
              </div>
              <div class="dash-list-right">
                <div class="dash-list-value">${fmt(e.jumlah_kontainer)} kont.</div>
                <span class="dash-badge approved">✓ Terkirim</span>
              </div>
            </div>`;
        }).join('');
      } else {
        el('dashLoaderList').innerHTML = '<div class="dash-list-empty">Belum ada entry Loader hari ini</div>';
      }
    } else {
      el('dashSectionLoader').style.display = 'none';
    }

    // Empty state
    if (el('dashEmpty')) el('dashEmpty').style.display = hasAny ? 'none' : 'block';

    if (loading) loading.style.display = 'none';
    if (main) main.style.display = 'block';
    dashboardLoaded = true;

  } catch(err) {
    console.error('loadDashboard error:', err);
    if (loading) loading.style.display = 'none';
    if (main) { main.style.display = 'block'; main.innerHTML = '<div class="dash-empty"><div class="dash-empty-title">Gagal memuat data</div><div class="dash-empty-sub">Periksa koneksi Anda dan coba refresh.</div></div>'; }
  }
}

// ===================== TOAST =====================
let toastTimer;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const icons = {
    success: '<svg width="18" height="18" fill="white" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
    error:   '<svg width="18" height="18" fill="white" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
    info:    '<svg width="18" height="18" fill="white" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>',
  };
  toast.innerHTML = (icons[type] || icons.info) + msg;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}

// ===================== CUSTOM SELECTS =====================
function initCustomSelects() {
  const selects = document.querySelectorAll('select.form-select');
  selects.forEach(select => {
    if (select.dataset.customSelectInitialized) return;
    select.dataset.customSelectInitialized = 'true';

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    if (select.classList.contains('blue')) {
      wrapper.classList.add('blue');
    }
    
    // Insert wrapper before select in DOM
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    
    // Create trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    if (select.classList.contains('blue')) {
      trigger.classList.add('blue');
    }
    
    const triggerText = document.createElement('span');
    triggerText.className = 'custom-select-trigger-text';
    trigger.appendChild(triggerText);
    
    const triggerArrow = document.createElement('span');
    triggerArrow.className = 'custom-select-arrow';
    triggerArrow.innerHTML = `<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l5 5 5-5"/></svg>`;
    trigger.appendChild(triggerArrow);
    
    wrapper.appendChild(trigger);
    
    // Create options container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-select-options-container';
    wrapper.appendChild(optionsContainer);
    
    // Rebuild options from the native select
    function rebuildOptions() {
      optionsContainer.innerHTML = '';
      const options = select.options;
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const customOpt = document.createElement('div');
        customOpt.className = 'custom-select-option';
        customOpt.textContent = opt.textContent;
        customOpt.dataset.value = opt.value;
        if (opt.value === select.value) {
          customOpt.classList.add('selected');
        }
        
        customOpt.addEventListener('click', (e) => {
          e.stopPropagation();
          select.value = opt.value;
          select.dispatchEvent(new Event('change'));
          closeDropdown();
        });
        
        optionsContainer.appendChild(customOpt);
      }
      updateTriggerText();
    }
    
    // Update trigger text based on selected option
    function updateTriggerText() {
      const selectedOption = select.options[select.selectedIndex];
      if (selectedOption) {
        triggerText.textContent = selectedOption.textContent;
        if (select.selectedIndex === 0 || !select.value) {
          triggerText.classList.add('placeholder-text');
        } else {
          triggerText.classList.remove('placeholder-text');
        }
      } else {
        triggerText.textContent = '';
      }
      
      const items = optionsContainer.querySelectorAll('.custom-select-option');
      items.forEach(item => {
        if (item.dataset.value === select.value) {
          item.classList.add('selected');
        } else {
          item.classList.remove('selected');
        }
      });
    }
    
    // Toggle dropdown
    function toggleDropdown(e) {
      e.stopPropagation();
      const isOpen = wrapper.classList.contains('open');
      closeAllCustomDropdowns();
      
      if (!isOpen) {
        wrapper.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        setTimeout(() => {
          optionsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
      }
    }
    
    function closeDropdown() {
      wrapper.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    
    trigger.addEventListener('click', toggleDropdown);
    select.addEventListener('change', updateTriggerText);
    
    if (select.form) {
      select.form.addEventListener('reset', () => {
        setTimeout(updateTriggerText, 10);
      });
    }
    
    // MutationObserver to watch for dynamic option changes in native select
    const observer = new MutationObserver(() => {
      rebuildOptions();
    });
    observer.observe(select, { childList: true });
    
    // Intercept property changes to value and selectedIndex on this select element
    const originalValueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const originalSelectedIndexDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    
    Object.defineProperty(select, 'value', {
      get() {
        return originalValueDescriptor.get.call(this);
      },
      set(val) {
        originalValueDescriptor.set.call(this, val);
        updateTriggerText();
      },
      configurable: true
    });

    Object.defineProperty(select, 'selectedIndex', {
      get() {
        return originalSelectedIndexDescriptor.get.call(this);
      },
      set(val) {
        originalSelectedIndexDescriptor.set.call(this, val);
        updateTriggerText();
      },
      configurable: true
    });
    
    rebuildOptions();
  });
}

function closeAllCustomDropdowns() {
  document.querySelectorAll('.custom-select-wrapper.open').forEach(el => {
    el.classList.remove('open');
    const trigger = el.querySelector('.custom-select-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
}

document.addEventListener('click', closeAllCustomDropdowns);

// ===================== INIT =====================
initCustomSelects();
initAuth();

// ===================== DARK MODE LOGIC =====================
function initTheme() {
  const currentTheme = localStorage.getItem('theme');
  if (currentTheme === 'dark') {
    document.body.classList.add('dark-mode');
    updateThemeIcon(true);
  } else {
    document.body.classList.remove('dark-mode');
    updateThemeIcon(false);
  }
}

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeIcon(isDark);
}

function updateThemeIcon(isDark) {
  const icon = document.getElementById('themeToggleIcon');
  const text = document.getElementById('themeToggleText');
  if (icon) {
    if (isDark) {
      icon.innerHTML = '<path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>';
    } else {
      icon.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707M12 7a5 5 0 100 10 5 5 0 000-10z"/>';
    }
  }
  if (text) {
    text.textContent = isDark ? 'Mode Terang' : 'Mode Gelap';
  }
}

// ===================== LIGHTBOX MODAL =====================
function openLightbox(src, caption = 'Bukti Foto') {
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  if (!lightbox || !lightboxImg) return;
  lightboxImg.src = src;
  if (lightboxCaption) lightboxCaption.textContent = caption;
  lightbox.classList.add('show');
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (lightbox) lightbox.classList.remove('show');
}

// Intercept file preview clicks to open Lightbox if it is an image
document.addEventListener('click', (e) => {
  const fileLink = e.target.closest('.file-preview-item, .badge');
  if (!fileLink) return;
  const href = fileLink.getAttribute('href');
  if (!href) return;
  
  const isImage = /\.(jpg|jpeg|png|gif|bmp|webp)($|\?)/i.test(href);
  if (isImage) {
    e.preventDefault();
    const caption = fileLink.getAttribute('title') || fileLink.textContent.trim() || 'Bukti Foto';
    openLightbox(href, caption);
  }
});

// Run theme initialization
initTheme();

function showAbsensiBlockedToast(msg) {
  const existing = document.getElementById('absensiBlockedNotif');
  if (existing) existing.remove();
  
  const el = document.createElement('div');
  el.id = 'absensiBlockedNotif';
  el.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:9999;background:linear-gradient(135deg,#EF4444,#DC2626);color:#fff;padding:16px 24px;border-radius:14px;box-shadow:0 10px 30px rgba(239,68,68,0.35);font-size:14px;font-weight:600;max-width:90%;width:420px;text-align:center;display:flex;align-items:center;justify-content:center;gap:12px;box-sizing:border-box;border:1px solid rgba(255,255,255,0.1);';
  
  el.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>${msg || 'Kamu belum diabsen untuk tanggal ini.'}</span>`;
  
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -10px)';
    el.style.transition = 'all 0.4s ease';
    setTimeout(() => el.remove(), 400);
  }, 5000);
}

// ===================== ANNOUNCEMENTS (Operasional) =====================
let currentAnnouncementsKey = '';

async function loadAnnouncements() {
  const overlay = document.getElementById('annOverlay');
  const modal   = document.getElementById('annModal');
  const body    = document.getElementById('annModalBody');
  if (!overlay || !modal || !body) return;

  try {
    const data = await fetch('/api/announcements').then(r => r.json());
    if (!Array.isArray(data) || data.length === 0) {
      overlay.classList.remove('active');
      modal.classList.remove('active');
      return;
    }

    // Buat unique key berdasarkan gabungan ID pengumuman aktif agar jika ada pengumuman baru, modal tetap muncul kembali
    const activeIds = data.map(ann => ann.id).sort().join('_');
    currentAnnouncementsKey = `ann_dismissed_${activeIds}`;

    // Cek apakah user sudah dismiss sesi pengumuman aktif ini
    if (sessionStorage.getItem(currentAnnouncementsKey) === 'true') {
      return;
    }

    // Render pengumuman di dalam modal
    body.innerHTML = data.map(ann => {
      const dateStr = new Date(ann.created_at).toLocaleDateString('id-ID', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
      });
      return `<div class="ann-banner ${ann.type || 'info'}">
        <div class="ann-banner-emoji">${ann.emoji || '📢'}</div>
        <div class="ann-banner-body">
          <div class="ann-banner-title">${ann.title}</div>
          <div class="ann-banner-content">${autoLink(ann.content)}</div>
          <div class="ann-banner-date">${dateStr}</div>
        </div>
      </div>`;
    }).join('');

    // Tampilkan modal dengan transisi
    overlay.classList.add('active');
    modal.classList.add('active');
  } catch (e) {
    console.error('loadAnnouncements error:', e);
  }
}

function dismissAnnouncements() {
  const overlay = document.getElementById('annOverlay');
  const modal   = document.getElementById('annModal');
  if (overlay) overlay.classList.remove('active');
  if (modal) modal.classList.remove('active');

  // Set di sessionStorage agar tidak muncul lagi pada sesi tab/browser ini
  if (currentAnnouncementsKey) {
    sessionStorage.setItem(currentAnnouncementsKey, 'true');
  }
}

function closeAnnouncementModalOnly() {
  const overlay = document.getElementById('annOverlay');
  const modal   = document.getElementById('annModal');
  if (overlay) overlay.classList.remove('active');
  if (modal) modal.classList.remove('active');
}

// Expose to global scope
window.dismissAnnouncements = dismissAnnouncements;
window.closeAnnouncementModalOnly = closeAnnouncementModalOnly;
window.loadAnnouncements    = loadAnnouncements;