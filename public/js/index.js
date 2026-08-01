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

// Smart Number Input Handling: Auto-select text on click & strip leading zeros (e.g. 09 -> 9)
document.addEventListener('focusin', function(e) {
  if (e.target && e.target.type === 'number') {
    try { e.target.select(); } catch(err) {}
  }
});

document.addEventListener('input', function(e) {
  if (e.target && e.target.type === 'number') {
    const val = e.target.value;
    if (val.length > 1 && val.startsWith('0')) {
      e.target.value = val.replace(/^0+/, '') || '0';
    }
  }
});

// ===================== AUTH =====================
let currentUser = null;

async function initAuth() {
  try {
    const r = await fetch('/api/check-auth');
    const auth = await r.json();
    if (auth.maintenance && auth.role !== 'admin' && !auth.isImpersonating) {
      showMaintenanceOverlay(auth);
      return;
    }
    if (!auth.authenticated) { window.location.href = '/login'; return; }
    if (auth.role === 'admin' && !auth.isImpersonating) { window.location.href = '/admin'; return; }
    currentUser = auth;

    if (auth.isImpersonating) {
      const banner = document.getElementById('impersonateBanner');
      const nameEl = document.getElementById('impersonateTargetName');
      if (banner) banner.style.display = 'block';
      if (nameEl) nameEl.textContent = auth.nama_lengkap || auth.username || 'User';
      document.body.classList.add('has-impersonate-banner');
    }

    populateUserUI();
    // Load announcements immediately after user validation
    loadAnnouncements();
  } catch(e) {
    console.error('initAuth error:', e);
    document.getElementById('pageLoader')?.classList.add('hidden');
    setTimeout(() => document.getElementById('pageLoader')?.remove(), 400);
  } finally {
    if (!window.isMaintenanceScreenActive) {
      document.getElementById('pageLoader')?.classList.add('hidden');
      setTimeout(() => document.getElementById('pageLoader')?.remove(), 400);
    }
  }
}

async function switchBackToAdmin() {
  const btn = document.querySelector('.btn-switch-back');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spin" style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;"></span> Mengembalikan...`;
  }
  try {
    const res = await fetch('/api/switch-back-admin', { method: 'POST' }).then(r => r.json());
    if (res.success) {
      window.location.href = '/admin';
    } else {
      alert(res.error || 'Gagal kembali ke sesi Admin.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/></svg><span>Kembali ke Admin</span>`;
      }
    }
  } catch(e) {
    alert('Gagal mengembalikan sesi Admin.');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/></svg><span>Kembali ke Admin</span>`;
    }
  }
}
window.switchBackToAdmin = switchBackToAdmin;

function showMaintenanceOverlay(auth) {
  window.isMaintenanceScreenActive = true;
  // Hide loader
  document.getElementById('pageLoader')?.classList.add('hidden');
  setTimeout(() => document.getElementById('pageLoader')?.remove(), 400);

  const overlayHtml = `
    <div id="maintenanceOverlay" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:linear-gradient(135deg, #0f172a, #1e293b); z-index:999999; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:24px; text-align:center; color:white; font-family:'Inter', sans-serif;">
      <div style="background:rgba(30, 41, 59, 0.7); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.08); padding:48px; border-radius:24px; max-width:540px; box-shadow:0 25px 50px -12px rgba(0, 0, 0, 0.5); display:flex; flex-direction:column; align-items:center; gap:24px;">
        <div style="position:relative; width:80px; height:80px; display:flex; justify-content:center; align-items:center;">
          <svg class="gear-large" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin-clockwise 8s linear infinite;">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <svg class="gear-small" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute; bottom:4px; right:4px; animation: spin-counterclockwise 4s linear infinite;">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </div>
        <style>
          @keyframes spin-clockwise { to { transform: rotate(360deg); } }
          @keyframes spin-counterclockwise { to { transform: rotate(-360deg); } }
        </style>
        <div>
          <h2 style="font-size:24px; font-weight:800; margin-bottom:12px; background:linear-gradient(to right, #60a5fa, #3b82f6); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">${auth.title || 'Sistem Sedang Pemeliharaan'}</h2>
          <p style="font-size:14px; color:#94a3b8; line-height:1.6; margin:0;">${auth.message || 'Kami sedang melakukan peningkatan sistem.'}</p>
        </div>
        ${auth.estimated_end ? `
          <div style="background:rgba(96, 165, 250, 0.1); border:1px solid rgba(96, 165, 250, 0.2); padding:10px 18px; border-radius:12px; font-size:12px; font-weight:600; color:#60a5fa;">
            ⏳ Perkiraan Selesai: <span>${auth.estimated_end}</span>
          </div>
        ` : ''}
        <button id="maintLogoutBtn" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; padding:10px 20px; border-radius:10px; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.2s; border-radius:8px;">
          Keluar Akun
        </button>
      </div>
    </div>
  `;
  document.body.innerHTML = overlayHtml;
  document.getElementById('maintLogoutBtn').onclick = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch(e) {
      window.location.href = '/login';
    }
  };
}

function getInitials(name) {
  if (!name) return '?';
  try {
    const str = String(name).trim();
    if (!str) return '?';
    return str.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  } catch(e) {
    return '?';
  }
}

function safePopulateFallbackUserUI() {
  const safeSet = (id, val) => {
    const el = document.getElementById(id);
    if (el && (el.textContent === 'Memuat...' || el.textContent === '?')) {
      el.textContent = val;
    }
  };
  const name = (currentUser && currentUser.nama_lengkap) || 'User';
  const init = (currentUser && getInitials(currentUser.nama_lengkap)) || 'U';
  safeSet('headerName', name);
  safeSet('dashName', name);
  safeSet('headerAvatar', init);
  safeSet('dashAvatar', init);
  safeSet('psNamaAvatar', init);
  safeSet('psNamaDisplay', name);

  const loading = document.getElementById('dashLoading');
  const main = document.getElementById('dashMain');
  if (loading) loading.style.display = 'none';
  if (main) main.style.display = 'block';
}

setTimeout(safePopulateFallbackUserUI, 1000);

function populateUserUI() {
  try {
    const u = currentUser;
    if (!u) return;
    const initials = getInitials(u.nama_lengkap);

    const headerAv = document.getElementById('headerAvatar');
    if (headerAv) headerAv.textContent = initials;

    const headerNm = document.getElementById('headerName');
    if (headerNm) headerNm.textContent = u.nama_lengkap || '—';

    const mobileAv = document.getElementById('mobileAvatar');
    if (mobileAv) mobileAv.textContent = initials;

    const badge = document.getElementById('headerPosisiBadge');
    if (badge) {
      badge.textContent = u.posisi || '—';
      if (u.posisi) {
        const p = u.posisi.toLowerCase();
        badge.classList.add(p === 'picker' ? 'picker' : p === 'sorter' ? 'sorter' : p === 'return' ? 'loader' : 'loader');
      }
    }

    // Control sidebar menu visibility based on user position/role
    const pos = (u.posisi || '').toLowerCase();
    const isQcOutbound = pos === 'qc outbound' || pos === 'qc-outbound';
    const tabPicker = document.getElementById('tab-picker');
    const tabLoader = document.getElementById('tab-loader');
    const tabReturn = document.getElementById('tab-return');
    const tabPendapatan = document.getElementById('tab-pendapatan');
    const tabQcOutbound = document.getElementById('tab-qc-outbound');

    if (pos === 'return') {
      if (tabPicker) tabPicker.style.display = 'none';
      if (tabLoader) tabLoader.style.display = 'none';
      if (tabPendapatan) tabPendapatan.style.display = 'none';
      if (tabReturn) tabReturn.style.display = 'flex';
      if (tabQcOutbound) tabQcOutbound.style.display = 'none';
    } else if (isQcOutbound) {
      if (tabPicker) tabPicker.style.display = 'none';
      if (tabLoader) tabLoader.style.display = 'none';
      if (tabPendapatan) tabPendapatan.style.display = 'none';
      if (tabReturn) tabReturn.style.display = 'none';
      if (tabQcOutbound) tabQcOutbound.style.display = 'flex';
    } else {
      if (tabPicker) tabPicker.style.display = 'flex';
      if (tabLoader) tabLoader.style.display = 'flex';
      if (tabPendapatan) tabPendapatan.style.display = 'flex';
      if (tabReturn) tabReturn.style.display = 'none';
      if (tabQcOutbound) tabQcOutbound.style.display = 'none';
    }

    const tipeBadge = document.getElementById('headerTipeBadge');
    if (tipeBadge) {
      const tipe = u.tipe_karyawan || 'Productivity';
      tipeBadge.textContent = tipe;
      tipeBadge.style.display = 'inline-block';
      tipeBadge.style.fontSize = '9px';
      tipeBadge.style.fontWeight = '800';
      tipeBadge.style.padding = '2px 8px';
      tipeBadge.style.borderRadius = '20px';
      tipeBadge.style.marginTop = '4px';
      tipeBadge.style.width = 'fit-content';
      tipeBadge.style.textTransform = 'uppercase';
      tipeBadge.style.letterSpacing = '0.5px';
      if (tipe === 'PHL') {
        tipeBadge.style.background = 'rgba(124, 58, 237, 0.15)';
        tipeBadge.style.color = '#a78bfa';
        tipeBadge.style.border = '1px solid rgba(124, 58, 237, 0.3)';
      } else {
        tipeBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        tipeBadge.style.color = '#10b981';
        tipeBadge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      }
    }

    // Tab 1 - name display
    const psAv = document.getElementById('psNamaAvatar');
    if (psAv) psAv.textContent = initials;
    const psNm = document.getElementById('psNamaDisplay');
    if (psNm) psNm.textContent = u.nama_lengkap || '—';

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
      if (sel && sel.options) {
        for (let opt of sel.options) {
          if (opt.value === u.posisi) { opt.selected = true; break; }
        }
        sel.dispatchEvent(new Event('change'));
        psBatchCapacityCache = {};
        schedulePsRender();
      }
    }

    switchTab('dashboard');
  } catch(err) {
    console.error('populateUserUI error:', err);
  }
}

async function doLogout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch(e) {}
  window.location.href = '/login';
}

function logout() {
  document.getElementById('logoutOverlay').classList.add('active');
  document.getElementById('logoutModal').classList.add('active');
}

function closeLogoutModal() {
  document.getElementById('logoutOverlay').classList.remove('active');
  document.getElementById('logoutModal').classList.remove('active');
}

async function confirmLogout() {
  closeLogoutModal();
  await doLogout();
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
        await doLogout();
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
  const pos = currentUser && currentUser.posisi ? currentUser.posisi.toLowerCase() : '';

  // Block forbidden tabs per role
  if (pos === 'return' && ['pendapatan', 'picker', 'loader'].includes(tab)) {
    tab = 'return';
  } else if (pos !== 'return' && tab === 'return') {
    tab = 'picker';
  }

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
    loadPendapatan();
  } else if (tab === 'calendar') {
    document.getElementById('panel-calendar').classList.add('active');
    document.getElementById('tab-calendar').classList.add('active-blue');
    loadCalendarData();
  } else if (tab === 'picker') {
    document.getElementById('panel-picker').classList.add('active');
    document.getElementById('tab-picker').classList.add('active-purple');
  } else if (tab === 'return') {
    document.getElementById('panel-return').classList.add('active');
    document.getElementById('tab-return').classList.add('active-teal');
    // Set default tanggal return = hari ini
    const todayStr = new Date().toLocaleDateString('sv-SE');
    const rtReturn = document.getElementById('rt_tanggal_return');
    if (rtReturn && !rtReturn.value) rtReturn.value = todayStr;
  } else if (tab === 'qc-outbound') {
    document.getElementById('panel-qc-outbound').classList.add('active');
    const tabQcoBtn = document.getElementById('tab-qc-outbound');
    if (tabQcoBtn) tabQcoBtn.classList.add('active-purple');
    // Set default tanggal = hari ini
    const todayStr2 = new Date().toLocaleDateString('sv-SE');
    const qcoTgl = document.getElementById('qco_tanggal');
    if (qcoTgl && !qcoTgl.value) { qcoTgl.value = todayStr2; qcoLoadArmada(); }
    const qcoFilter = document.getElementById('qcoFilterTanggal');
    if (qcoFilter && !qcoFilter.value) { qcoFilter.value = todayStr2; qcoLoadRiwayat(); }
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
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.remove('open');
    document.body.classList.remove('sidebar-open');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const isOpen = sidebar.classList.toggle('open');
  document.body.classList.toggle('sidebar-open', isOpen);
}
window.toggleSidebar = toggleSidebar;

// ===================== PENDAPATAN (PREVIEW MODE) =====================
async function loadPendapatan() {
  const isPreview = window.location.search.includes('preview=true') || localStorage.getItem('preview_pendapatan') === 'true';
  const soonView = document.getElementById('pendapatan-soon-view');
  const activeView = document.getElementById('pendapatan-active-view');
  const phlView = document.getElementById('pendapatan-phl-view');
  if (!soonView || !activeView) return;

  if (!isPreview) {
    soonView.style.display = 'block';
    activeView.style.display = 'none';
    if (phlView) phlView.style.display = 'none';
    return;
  }

  soonView.style.display = 'none';

  // Get current user type
  const tipeKaryawan = (currentUser && currentUser.tipe_karyawan) || 'Productivity';

  if (tipeKaryawan === 'PHL') {
    activeView.style.display = 'none';
    if (phlView) phlView.style.display = 'block';

    const monthlyList = document.getElementById('phl-monthly-list');
    if (monthlyList) {
      monthlyList.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);"><div class="loading-spinner"><div class="spin"></div></div></div>';
    }

    try {
      // 1. Fetch PHL upah harian
      const phlRes = await fetch('/api/settings/phl-rate');
      const phlSettings = await phlRes.json();
      const upahHarian = phlSettings.upah_harian || 0;

      const upahBadge = document.getElementById('phl-upah-badge');
      if (upahBadge) {
        upahBadge.textContent = `Upah Harian: Rp ${upahHarian.toLocaleString('id-ID')}`;
      }

      // 2. Fetch User Absensi for the current year
      const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 10);
      const currentYear = new Date().getFullYear();
      const tanggalMulai = `${currentYear}-01-01`;
      const tanggalAkhir = todayStr;

      const absRes = await fetch(`/api/my-absensi?tanggal_mulai=${tanggalMulai}&tanggal_akhir=${tanggalAkhir}`);
      if (!absRes.ok) throw new Error('Gagal memuat absensi');
      const absData = await absRes.json();

      // Map absensi by month
      const hadirList = absData.hadir || []; // Array of dates
      const monthMap = {}; // { 'YYYY-MM': count }
      hadirList.forEach(date => {
        const monthKey = date.slice(0, 7); // 'YYYY-MM'
        monthMap[monthKey] = (monthMap[monthKey] || 0) + 1;
      });

      // Sort months descending
      const months = Object.keys(monthMap).sort((a, b) => b.localeCompare(a));

      const thisMonthKey = todayStr.slice(0, 7); // 'YYYY-MM'
      const hadirBulanIni = monthMap[thisMonthKey] || 0;
      const valBulanIni = hadirBulanIni * upahHarian;
      const totalHadirAll = hadirList.length;
      const valTotalAll = totalHadirAll * upahHarian;

      document.getElementById('phl-val-hadir-bulan').textContent = `${hadirBulanIni} hari`;
      document.getElementById('phl-val-bulan').textContent = `Rp ${valBulanIni.toLocaleString('id-ID')}`;
      document.getElementById('phl-val-total').textContent = `Rp ${valTotalAll.toLocaleString('id-ID')}`;

      if (months.length === 0) {
        monthlyList.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-secondary); font-size:13px;">Belum ada riwayat kehadiran terdaftar untuk saat ini.</div>';
      } else {
        const monthNames = {
          '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April',
          '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus',
          '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember'
        };

        monthlyList.innerHTML = `
          <div class="table-wrap">
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border); text-align: left;">
                  <th style="padding: 12px 16px; font-size: 12px; color: var(--text-secondary);">Bulan</th>
                  <th style="padding: 12px 16px; font-size: 12px; color: var(--text-secondary);">Hari Hadir</th>
                  <th style="padding: 12px 16px; font-size: 12px; color: var(--text-secondary);">Upah Harian</th>
                  <th style="padding: 12px 16px; font-size: 12px; color: var(--text-secondary);">Total Estimasi</th>
                </tr>
              </thead>
              <tbody>
                ${months.map(mKey => {
                  const parts = mKey.split('-');
                  const mName = monthNames[parts[1]] || parts[1];
                  const mDisplay = `${mName} ${parts[0]}`;
                  const count = monthMap[mKey] || 0;
                  const total = count * upahHarian;
                  return `
                    <tr style="border-bottom: 1px solid var(--border); transition: background 0.2s;">
                      <td style="padding: 12px 16px; font-weight: 600; font-size:13px;">${mDisplay}</td>
                      <td style="padding: 12px 16px; font-weight: 700; font-size:13px;">${count} <span style="font-size:11px; font-weight:500; color:var(--text-secondary);">hari</span></td>
                      <td style="padding: 12px 16px; color: var(--text-secondary); font-size:12px;">Rp ${upahHarian.toLocaleString('id-ID')}</td>
                      <td style="padding: 12px 16px;"><b style="color: #7c3aed; font-size:13px;">Rp ${total.toLocaleString('id-ID')}</b></td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    } catch (err) {
      console.error('loadPendapatan PHL error:', err);
      if (monthlyList) monthlyList.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--error-color, #ef4444);">Gagal memuat data pendapatan PHL.</div>';
    }
  } else {
    // Tampilan Productivity (default)
    if (phlView) phlView.style.display = 'none';
    activeView.style.display = 'block';

    const tbody = document.getElementById('pd-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-secondary);"><div class="loading-spinner"><div class="spin"></div></div></td></tr>';

    try {
      // 1. Ambil ketentuan harga
      const hargaRes = await fetch('/api/ketentuan-harga');
      const hargaList = await hargaRes.json();

      // Map harga dengan key "POSISI|KATEGORI_ZONA"
      const hargaMap = {};
      if (Array.isArray(hargaList)) {
        hargaList.forEach(h => {
          const key = `${h.posisi.toUpperCase()}|${h.zona.toUpperCase()}`;
          hargaMap[key] = parseFloat(h.harga_satuan) || 0;
        });
      }

      // 2. Ambil pencapaian user
      const achRes = await fetch('/api/my-achievements');
      const ach = await achRes.json();

      // 3. Helper mapping zona ke kategori ketentuan harga
      const getZoneCategory = (zona) => {
        if (!zona) return 'AMBIENT';
        const z = zona.trim().toUpperCase();
        if (z.startsWith('F')) return 'FREEZER';
        if (z.startsWith('R')) return 'CHILLER';
        return 'AMBIENT';
      };

      const getLocalDateString = (dateStr) => {
        return dateStr.slice(0, 10);
      };

      const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 10);
      const thisMonthStr = todayStr.slice(0, 7); // YYYY-MM

      let totalToday = 0;
      let totalMonth = 0;
      let totalAll = 0;
      let rows = [];

      // Ambil pencapaian Picker / Sorter
      const submissions = [
        ...(ach.picker?.all_submissions || []),
        ...(ach.sorter?.all_submissions || [])
      ];

      submissions.forEach(sub => {
        if (sub.status !== 'approved') return;

        const dateOnly = getLocalDateString(sub.tanggal_pengerjaan);
        const isToday = dateOnly === todayStr;
        const isThisMonth = dateOnly.startsWith(thisMonthStr);

        const zoneCat = getZoneCategory(sub.zona);
        const priceKey = `${sub.posisi.toUpperCase()}|${zoneCat}`;
        const price = hargaMap[priceKey] || 0;
        const qty = parseInt(sub.jumlah_output) || 0;
        const val = qty * price;

        totalAll += val;
        if (isToday) totalToday += val;
        if (isThisMonth) totalMonth += val;

        rows.push({
          tanggal: dateOnly,
          posisi: sub.posisi,
          zona: sub.zona + ` (${zoneCat})`,
          qty: qty,
          satuan: 'pcs',
          price: price,
          val: val
        });
      });

      // Ambil pencapaian Loader
      const loaderEntries = ach.loader?.all_entries || [];
      loaderEntries.forEach(entry => {
        const dateOnly = getLocalDateString(entry.tanggal_kirim || entry.tanggal_carian);
        const isToday = dateOnly === todayStr;
        const isThisMonth = dateOnly.startsWith(thisMonthStr);

        // Loader menggunakan tarif LOADER|AMBIENT, CHILLER, FREEZER
        const priceKey = 'LOADER|AMBIENT, CHILLER, FREEZER';
        const price = hargaMap[priceKey] || 0;
        const qty = parseInt(entry.jumlah_kontainer) || 0;
        const val = qty * price;

        totalAll += val;
        if (isToday) totalToday += val;
        if (isThisMonth) totalMonth += val;

        rows.push({
          tanggal: dateOnly,
          posisi: 'Loader',
          zona: 'F, R, T (Kombinasi)',
          qty: qty,
          satuan: 'kontainer',
          price: price,
          val: val
        });
      });

      // Urutkan rincian dari tanggal paling baru
      rows.sort((a, b) => b.tanggal.localeCompare(a.tanggal));

      // Update kartu Ringkasan
      document.getElementById('pd-val-today').textContent = `Rp ${totalToday.toLocaleString('id-ID')}`;
      document.getElementById('pd-val-month').textContent = `Rp ${totalMonth.toLocaleString('id-ID')}`;
      document.getElementById('pd-val-total').textContent = `Rp ${totalAll.toLocaleString('id-ID')}`;

      // Tampilkan data ke tabel
      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-secondary); font-size:13px;">Belum ada estimasi pendapatan disetujui (Approved) untuk saat ini.</td></tr>';
      } else {
        const posColors = { 'Picker': '#8b5cf6', 'Sorter': '#10b981', 'Loader': '#f59e0b' };
        tbody.innerHTML = rows.map(r => {
          const color = posColors[r.posisi] || '#6b7280';
          return `
            <tr style="border-bottom: 1px solid var(--border); transition: background 0.2s;">
              <td style="padding: 12px 16px; font-weight: 600; font-size:13px;">${r.tanggal}</td>
              <td style="padding: 12px 16px;"><span class="badge" style="background:${color}15; color:${color}; font-size: 11px; padding: 3px 8px; border-radius: 8px; font-weight:700;">${r.posisi}</span></td>
              <td style="padding: 12px 16px; color: var(--text-secondary); font-size:12px;">${r.zona}</td>
              <td style="padding: 12px 16px; font-weight: 700; font-size:13px;">${r.qty.toLocaleString('id-ID')} <span style="font-size:11px; font-weight:500; color:var(--text-secondary);">${r.satuan}</span></td>
              <td style="padding: 12px 16px; color: var(--text-secondary); font-size:12px;">Rp ${r.price.toLocaleString('id-ID')}</td>
              <td style="padding: 12px 16px;"><b style="color: var(--success, #10b981); font-size:13px;">Rp ${r.val.toLocaleString('id-ID')}</b></td>
            </tr>
          `;
        }).join('');
      }

    } catch (err) {
      console.error('loadPendapatan error:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--error-color, #ef4444);">Gagal memuat rincian estimasi pendapatan.</td></tr>';
    }
  }
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

    // Cache untuk filter
    _rwAllDates = byDate;

    // Tampilkan filter bar setelah load
    const rwFilterBar = document.getElementById('rwFilterBar');
    if (dates.length > 0 && rwFilterBar) rwFilterBar.style.display = 'flex';

    if (dates.length === 0) {
      if (rwEmpty) rwEmpty.style.display = 'block';
      if (rwList)  rwList.innerHTML = '';
    } else {
      if (rwEmpty) rwEmpty.style.display = 'none';
      rwRenderDates(dates);
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

// ===================== RIWAYAT FILTER =====================
let _rwAllDates = {}; // cache untuk filter

function rwToggleFilter() {
  const bar = document.getElementById('rwFilterBar');
  const btn = document.getElementById('rwFilterToggle');
  if (!bar) return;
  const isOpen = bar.style.display !== 'none';
  bar.style.display = isOpen ? 'none' : 'flex';
  if (btn) btn.classList.toggle('active', !isOpen);
}

function rwApplyFilter() {
  const fromVal  = document.getElementById('rwFilterFrom')?.value || '';
  const toVal    = document.getElementById('rwFilterTo')?.value || '';
  const posisi   = (document.getElementById('rwFilterPosisi')?.value || '').toLowerCase();
  const dot      = document.getElementById('rwFilterDot');
  const hasFilter = fromVal || toVal || posisi;
  if (dot) dot.style.display = hasFilter ? 'inline-block' : 'none';

  const dates = Object.keys(_rwAllDates).sort((a,b) => b.localeCompare(a));
  const filtered = dates.filter(tgl => {
    if (fromVal && tgl < fromVal) return false;
    if (toVal   && tgl > toVal)   return false;
    if (posisi) {
      const { submissions, loaderEntries } = _rwAllDates[tgl];
      if (posisi === 'loader'  && loaderEntries.length === 0) return false;
      if (posisi === 'picker'  && !submissions.some(s => s.posisi === 'Picker'))  return false;
      if (posisi === 'sorter'  && !submissions.some(s => s.posisi === 'Sorter'))  return false;
    }
    return true;
  });

  const rwList = document.getElementById('rwList');
  const rwFilterEmpty = document.getElementById('rwFilterEmpty');
  const rwEmpty = document.getElementById('rwEmpty');

  if (hasFilter && filtered.length === 0) {
    if (rwList) rwList.innerHTML = '';
    if (rwFilterEmpty) rwFilterEmpty.style.display = 'flex';
    if (rwEmpty) rwEmpty.style.display = 'none';
    return;
  }
  if (rwFilterEmpty) rwFilterEmpty.style.display = 'none';
  if (rwEmpty) rwEmpty.style.display = 'none';
  rwRenderDates(filtered);
}

function rwResetFilter() {
  const from = document.getElementById('rwFilterFrom');
  const to   = document.getElementById('rwFilterTo');
  const pos  = document.getElementById('rwFilterPosisi');
  const dot  = document.getElementById('rwFilterDot');
  if (from) from.value = '';
  if (to)   to.value   = '';
  if (pos)  pos.value  = '';
  if (dot)  dot.style.display = 'none';
  rwApplyFilter();
}

function rwRenderDates(dates) {
  const rwList = document.getElementById('rwList');
  if (!rwList) return;
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
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

  rwList.innerHTML = dates.map((tgl, idx) => {
    const { submissions, loaderEntries } = _rwAllDates[tgl];
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
            ${loaderEntries.length > 0 ? `<span class="rw-mini-chip blue">${loaderEntries.length} trip &middot; ${fmt(totalKontainerDay)} kont.</span>` : ''}
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

    // Otomatis urutkan semua baris batch secara numerik (Batch 1, 2, 3, 4, 5...)
    const rowsArray = Array.from(list.querySelectorAll('.batch-output-row'));
    rowsArray.sort((a, b) => {
      const valA = a.getAttribute('data-batch-row') || '';
      const valB = b.getAttribute('data-batch-row') || '';
      const numA = parseFloat(valA.replace(/[^\d.]/g, '')) || 0;
      const numB = parseFloat(valB.replace(/[^\d.]/g, '')) || 0;
      if (numA !== numB) return numA - numB;
      return valA.localeCompare(valB, undefined, { numeric: true });
    });
    rowsArray.forEach(row => list.appendChild(row));

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

  } catch (err) {
    showOnscreenError('psValidateBorInput', err);
  }
}

// psCheckOverInput dihapus — fungsi ini adalah dead code (No-op)

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
  // Tampilkan Preview Modal dulu
  openPreviewModal('picker', buildPickerPreviewHtml());
});

async function doPickerSubmit() {
  const btn = document.getElementById('psSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }

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
    closePreviewModal();
    if (d.success) {
      document.getElementById('pickerForm').style.display = 'none';
      document.getElementById('psSuccessCard').style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      loadDashboard();
    } else {
      if (d.code === 'NOT_ABSEN') {
        showAbsensiBlockedToast(d.error);
      } else {
        showToast(d.error || 'Terjadi kesalahan. Coba lagi.', 'error');
      }
    }
  } catch(err) {
    closePreviewModal();
    showToast('Gagal menghubungi server. Periksa koneksi Anda.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Kirim Sekarang'; }
  }
}


// ===================== CLEAR FORM MODAL =====================
let _pendingClearType = null; // 'picker' | 'loader'

function psClearForm() {
  _pendingClearType = 'picker';
  document.getElementById('clearModalSub').textContent = 'Semua data formulir Picker & Sorter yang sudah diisi akan dihapus.';
  document.getElementById('clearOverlay').classList.add('active');
  document.getElementById('clearModal').classList.add('active');
}

function closeClearModal() {
  document.getElementById('clearOverlay').classList.remove('active');
  document.getElementById('clearModal').classList.remove('active');
  _pendingClearType = null;
}

function executeClearForm() {
  closeClearModal();
  if (_pendingClearType === 'picker') {
    document.getElementById('pickerForm').reset();
    psClearAll();
    psSelectedFiles = []; psRenderFileList();
    psBatchCapacityCache = {}; psRenderBatchOutputRows();
    document.getElementById('psCatatanRequiredAsterisk').style.display = 'none';
    psCatatanRequired = false;
    document.querySelectorAll('#pickerForm .field-error.visible').forEach(el => el.classList.remove('visible'));
    document.getElementById('ps_tipe_lokasi').dispatchEvent(new Event('change'));
  } else if (_pendingClearType === 'loader') {
    ldResetForm();
  }
  showToast('Formulir berhasil dikosongkan.', 'info');
}

function psResetToForm() {
  document.getElementById('pickerForm').style.display = 'block';
  document.getElementById('psSuccessCard').style.display = 'none';
  _pendingClearType = 'picker';
  executeClearForm();
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
  
  const cardsHtml = ldArmadas.map((truck, index) => {
    return `
      <div class="armada-card" id="armadaCard_${index}">
        <div class="armada-card-header">
          <div class="armada-badge-header">
            <div class="armada-badge-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="1" y="3" width="14" height="12" rx="2" fill="url(#truckGrad_${index})" />
                <path d="M15 8h4.5l2.5 3.5V15h-7V8z" fill="url(#cabinGrad_${index})" />
                <circle cx="5.5" cy="17.5" r="2.2" fill="#0f172a" stroke="#ffffff" stroke-width="1.2"/>
                <circle cx="17.5" cy="17.5" r="2.2" fill="#0f172a" stroke="#ffffff" stroke-width="1.2"/>
                <path d="M1 8h14M15 11.5h7" stroke="#ffffff" stroke-opacity="0.4" stroke-width="1"/>
                <defs>
                  <linearGradient id="truckGrad_${index}" x1="0" y1="0" x2="15" y2="15" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#0284c7"/>
                    <stop offset="1" stop-color="#0369a1"/>
                  </linearGradient>
                  <linearGradient id="cabinGrad_${index}" x1="15" y1="8" x2="22" y2="15" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#38bdf8"/>
                    <stop offset="1" stop-color="#0284c7"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div>
              <div class="armada-title-text">ARMADA #${index + 1}</div>
              <div class="armada-title-sub">No. Polisi & Cluster Muatan</div>
            </div>
          </div>
          ${index > 0 ? `
          <button type="button" class="btn-remove-armada" onclick="ldRemoveArmada(${index})" title="Hapus armada ini">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
            Hapus Armada
          </button>
          ` : ''}
        </div>
        
        <div style="margin-bottom: 16px; position:relative;" class="nopol-wrapper">
          <label class="field-label" style="font-size:12px; margin-bottom:6px; font-weight:700; color:var(--text); display:block;">No. Polisi Armada <span class="required" style="color:var(--error);">*</span></label>
          
          <div style="position:relative;">
            <input type="text" 
                   id="ld_nopol_input_${index}"
                   placeholder="🚚 Pilih / Cari No. Polisi (contoh: B 9676 VXR)..." 
                   class="form-input blue no-polisi-input" 
                   value="${truck.no_polisi}" 
                   onfocus="ldOpenNopolDropdown(${index})"
                   oninput="ldUpdateTruckPolisi(${index}, this.value); ldFilterNopolDropdown(${index})" 
                   autocomplete="off"
                   style="text-transform: uppercase; padding: 11px 40px 11px 14px; font-size: 13px; border-radius: 10px; border: 2px solid var(--border); font-weight:800; font-family:'Inter', sans-serif; width:100%; transition:all 0.2s;"
                   required>
            
            <div onclick="ldOpenNopolDropdown(${index})" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); cursor:pointer; color:#64748b; font-size:11px; display:flex; align-items:center; gap:4px; background:#f1f5f9; padding:4px 8px; border-radius:6px;">
              <span>Cari / Pilih</span>
              <span>▼</span>
            </div>
          </div>

          <!-- Dropdown Floating Menu -->
          <div id="ld_nopol_dropdown_${index}" class="nopol-dropdown-menu" 
               style="display:none; position:absolute; top:calc(100% + 4px); left:0; right:0; z-index:999; background:#fff; border:1.5px solid #cbd5e1; border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,0.15); max-height:240px; overflow-y:auto;">
            <div id="ld_nopol_list_${index}"></div>
          </div>
        </div>
        
        <div>
          <label class="field-label" style="font-size:12px; margin-bottom:4px; font-weight:700; color:var(--text); display:block;">Muatan Group Mobil (No. Mobil) <span class="required" style="color:var(--error);">*</span></label>
          <p class="field-hint" style="font-size:11px; margin-bottom:8px; color:var(--text-muted);">Pilih group mobil yang dimuat oleh armada ini</p>
          
          <!-- Instant Search & Category Filter Controls -->
          <div class="gm-filter-wrapper" style="margin-bottom: 8px;">
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:6px;">
              <div style="position:relative; flex:1; min-width:160px;">
                <input type="text" 
                       id="ld_gm_search_${index}" 
                       placeholder="Cari No. Mobil (misal: KWG, BDG, 05)..." 
                       class="form-input blue gm-search-input" 
                       oninput="ldFilterArmadaGrid(${index})"
                       style="padding: 8px 10px 8px 30px; font-size: 11.5px; border-radius: 8px; border: 1.5px solid var(--border); font-weight:600; width:100%;">
                <svg width="13" height="13" fill="none" stroke="#64748b" stroke-width="2.2" viewBox="0 0 24 24" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); pointer-events:none;">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </div>
              <div class="gm-category-tabs" id="ld_gm_cat_tabs_${index}">
                <!-- Dynamic category pills -->
              </div>
            </div>
          </div>

          <div class="batch-grid gm-chips-grid" id="ldArmadaGrid_${index}" style="grid-template-columns: repeat(auto-fill, minmax(105px, 1fr)); gap: 8px; margin-top: 4px; max-height: 220px; overflow-y: auto; padding: 6px;">
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

  const nextNum = ldArmadas.length + 1;
  const bottomBtnHtml = `
    <div class="add-armada-bottom-wrapper">
      <button type="button" class="btn-add-armada-bottom" onclick="ldAddArmada()">
        <div class="add-armada-icon-box">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.8" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
          </svg>
        </div>
        <span>Tambah Armada #${nextNum}</span>
      </button>
    </div>
  `;

  container.innerHTML = cardsHtml + bottomBtnHtml;
  
  ldArmadas.forEach((truck, index) => {
    ldRenderGroupFilterControls(index);
    ldFilterArmadaGrid(index);
  });
}

// Master Nopol List (Armada Resmi DC)
const MASTER_NOPOL_LIST = [
  'B 9676 VXR', 'B 9872 VXR', 'B 9541 VXR', 'B 9123 CDE', 'B 9321 XYZ',
  'B 9482 VXR', 'B 9710 VXR', 'B 9811 VXR', 'B 9044 VXR', 'B 9205 VXR',
  'B 9112 VXR', 'B 9308 VXR', 'B 9415 VXR', 'B 9522 VXR', 'B 9633 VXR',
  'B 9744 VXR', 'B 9855 VXR', 'B 9966 VXR', 'B 9077 VXR', 'B 9188 VXR'
];

function ldGetCombinedNopolList() {
  const customHistory = [];
  try {
    const saved = localStorage.getItem('ss08_custom_nopols');
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) customHistory.push(...arr);
    }
  } catch(e) {}

  const combined = [...MASTER_NOPOL_LIST];
  customHistory.forEach(p => {
    if (p && !combined.includes(p)) combined.push(p);
  });
  return combined;
}

function ldSelectNopol(index, val) {
  const cleanVal = val.trim().toUpperCase();
  ldUpdateTruckPolisi(index, cleanVal);
  const inputEl = document.getElementById(`ld_nopol_input_${index}`);
  if (inputEl) inputEl.value = cleanVal;
  ldCloseNopolDropdown(index);

  // Save custom nopol if not in master list
  if (cleanVal && !MASTER_NOPOL_LIST.includes(cleanVal)) {
    try {
      const list = JSON.parse(localStorage.getItem('ss08_custom_nopols') || '[]');
      if (!list.includes(cleanVal)) {
        list.push(cleanVal);
        localStorage.setItem('ss08_custom_nopols', JSON.stringify(list.slice(-20)));
      }
    } catch(e) {}
  }
}

function ldOpenNopolDropdown(index) {
  const dropdown = document.getElementById(`ld_nopol_dropdown_${index}`);
  if (!dropdown) return;
  ldFilterNopolDropdown(index);
  dropdown.style.display = 'block';
}

function ldCloseNopolDropdown(index) {
  const dropdown = document.getElementById(`ld_nopol_dropdown_${index}`);
  if (dropdown) dropdown.style.display = 'none';
}

function ldFilterNopolDropdown(index) {
  const inputEl = document.getElementById(`ld_nopol_input_${index}`);
  const listEl = document.getElementById(`ld_nopol_list_${index}`);
  if (!inputEl || !listEl) return;

  const query = inputEl.value.trim().toUpperCase();
  const allNopols = ldGetCombinedNopolList();

  const filtered = allNopols.filter(p => p.toUpperCase().replace(/\s+/g, '').includes(query.replace(/\s+/g, '')));

  let html = '';
  if (filtered.length > 0) {
    html = filtered.map(p => `
      <div class="nopol-opt-item" onclick="ldSelectNopol(${index}, '${p}')" 
        style="padding:10px 14px; cursor:pointer; font-weight:700; font-size:13px; color:#1e293b; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #f1f5f9; transition:background 0.15s;"
        onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='transparent'">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:15px;">🚚</span>
          <span>${p}</span>
        </div>
        <span style="font-size:10px; color:#0d9488; font-weight:800; background:#e6fffa; padding:2px 6px; border-radius:4px;">PILIH</span>
      </div>
    `).join('');
  }

  // If user typed something not in exact master list
  if (query.length >= 3 && !allNopols.includes(query)) {
    html += `
      <div class="nopol-opt-item custom" onclick="ldSelectNopol(${index}, '${query}')" 
        style="padding:10px 14px; cursor:pointer; font-weight:800; font-size:13px; color:#6d28d9; background:#f5f3ff; display:flex; align-items:center; justify-content:space-between; border-top:1.5px dashed #c4b5fd;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:15px;">➕</span>
          <span>Gunakan Nopol Baru: <strong>"${query}"</strong></span>
        </div>
        <span style="font-size:10px; color:#6d28d9; font-weight:800; background:#ede9fe; padding:2px 6px; border-radius:4px;">TAMBAH</span>
      </div>
    `;
  }

  if (!html) {
    html = `<div style="padding:12px; text-align:center; font-size:12px; color:#94a3b8;">Ketik No. Polisi untuk mencari...</div>`;
  }

  listEl.innerHTML = html;
}

function toggleUserProfileMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('userPopoverMenu');
  if (menu) {
    menu.classList.toggle('show');
  }
}
window.toggleUserProfileMenu = toggleUserProfileMenu;

// Global click listener to close dropdowns when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.nopol-wrapper')) {
    document.querySelectorAll('.nopol-dropdown-menu').forEach(el => el.style.display = 'none');
  }
  if (!e.target.closest('#sidebarUserCard')) {
    const menu = document.getElementById('userPopoverMenu');
    if (menu) menu.classList.remove('show');
  }
});

let ldArmadaSearchState = {};

function ldRenderGroupFilterControls(index) {
  const tabsContainer = document.getElementById(`ld_gm_cat_tabs_${index}`);
  if (!tabsContainer) return;

  const prefixes = ['SEMUA'];
  ldAvailableGroupMobils.forEach(gm => {
    const match = gm.match(/^[A-Z]+/i);
    if (match && !prefixes.includes(match[0].toUpperCase())) {
      prefixes.push(match[0].toUpperCase());
    }
  });

  const state = ldArmadaSearchState[index] || { search: '', prefix: 'SEMUA' };

  tabsContainer.innerHTML = prefixes.map(pref => {
    const isActive = state.prefix === pref;
    return `
      <button type="button" 
              class="gm-cat-pill ${isActive ? 'active' : ''}" 
              onclick="ldSetArmadaPrefixFilter(${index}, '${pref}')">
        ${pref}
      </button>
    `;
  }).join('');
}

function ldSetArmadaPrefixFilter(index, prefix) {
  if (!ldArmadaSearchState[index]) ldArmadaSearchState[index] = { search: '', prefix: 'SEMUA' };
  ldArmadaSearchState[index].prefix = prefix;
  ldRenderGroupFilterControls(index);
  ldFilterArmadaGrid(index);
}

function ldFilterArmadaGrid(index) {
  const grid = document.getElementById(`ldArmadaGrid_${index}`);
  if (!grid) return;

  const searchInput = document.getElementById(`ld_gm_search_${index}`);
  const query = (searchInput ? searchInput.value : '').trim().toUpperCase();

  if (!ldArmadaSearchState[index]) ldArmadaSearchState[index] = { search: '', prefix: 'SEMUA' };
  ldArmadaSearchState[index].search = query;

  const currentPrefix = ldArmadaSearchState[index].prefix;
  const truck = ldArmadas[index];
  let visibleCount = 0;

  const chipsHtml = ldAvailableGroupMobils.map(gm => {
    const isChecked = truck.selectedGms.includes(gm);
    const isSelectedByOther = ldArmadas.some((t, idx) => idx !== index && t.selectedGms.includes(gm));
    const id = `ld_gm_${index}_${gm.replace(/\s/g, '_')}`;

    const gmPrefix = (gm.match(/^[A-Z]+/i)?.[0] || '').toUpperCase();
    const matchesPrefix = (currentPrefix === 'SEMUA') || (gmPrefix === currentPrefix);
    const matchesSearch = !query || gm.toUpperCase().includes(query);

    if (!matchesPrefix || !matchesSearch) {
      return '';
    }

    visibleCount++;

    if (isSelectedByOther) {
      return `
        <div class="batch-item blue-chip disabled" style="opacity: 0.85; pointer-events: none;">
          <input type="checkbox" id="${id}" value="${gm}" disabled>
          <label for="${id}" style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 44px; padding: 4px 2px; border: 2px dashed rgba(239, 68, 68, 0.35); background: repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.02), rgba(239, 68, 68, 0.02) 6px, rgba(239, 68, 68, 0.05) 6px, rgba(239, 68, 68, 0.05) 12px); color: #EF4444; border-radius: 8px; cursor: not-allowed; transition: all 0.2s;">
            <span style="font-weight: 700; font-size: 11px; letter-spacing: 0.3px; opacity: 0.8;">${gm}</span>
            <span style="font-size: 8px; font-weight: 800; background: rgba(239, 68, 68, 0.1); padding: 1px 4px; border-radius: 4px; margin-top: 2px; display: inline-flex; align-items: center; gap: 2px;">
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
        <label for="${id}" style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 44px; padding: 6px 4px; cursor: pointer; transition: all 0.2s;">
          <span style="font-weight: 700; font-size: 12px;">${gm}</span>
        </label>
      </div>
    `;
  }).join('');

  if (visibleCount === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 18px; text-align: center; color: #94a3b8; font-size: 12px; font-weight: 600;">
        🔍 Tidak ada No. Mobil "${query || currentPrefix}" yang cocok.
      </div>
    `;
  } else {
    grid.innerHTML = chipsHtml;
  }
}

function ldRenderArmadaGrid(index) {
  ldRenderGroupFilterControls(index);
  ldFilterArmadaGrid(index);
}

// Regex validasi format plat nomor Indonesia: 1-2 huruf + 1-4 angka + 1-3 huruf (opsional spasi)
const POLISI_REGEX = /^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{1,3}$/;

function ldUpdateTruckPolisi(index, val) {
  // Uppercase & bersihkan spasi berlebih
  const cleaned = val.toUpperCase().replace(/\s+/g, ' ').trim();
  ldArmadas[index].no_polisi = cleaned;

  // Real-time validasi format
  const inputEl = document.querySelector(`#ldArmadaListContainer .armada-card:nth-child(${index + 1}) .no-polisi-input`);
  if (inputEl) {
    const isValid = POLISI_REGEX.test(cleaned.replace(/\s/g, ''));
    if (cleaned.length > 0 && !isValid) {
      inputEl.style.borderColor = 'var(--error)';
      inputEl.title = 'Format tidak valid. Contoh: B1234XYZ atau B 1234 XYZ';
    } else {
      inputEl.style.borderColor = '';
      inputEl.title = '';
    }
  }

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
  const newNum = ldArmadas.length + 1;
  ldArmadas.push({ id: Date.now(), no_polisi: '', selectedGms: [] });
  ldRenderArmadas();
  ldLoadClusterCapacity();

  showToast(`Armada #${newNum} berhasil ditambahkan! 🚚`, 'success');

  setTimeout(() => {
    const lastIdx = ldArmadas.length - 1;
    const newCard = document.getElementById(`armadaCard_${lastIdx}`);
    if (newCard) {
      newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const inputEl = document.getElementById(`ld_nopol_input_${lastIdx}`);
      if (inputEl) inputEl.focus();
    }
  }, 100);
}

function ldRemoveArmada(index) {
  const removedNum = index + 1;
  ldArmadas.splice(index, 1);
  ldRenderArmadas();
  ldLoadClusterCapacity();
  showToast(`Armada #${removedNum} berhasil dihapus.`, 'info');
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
      <div style="padding:12px 16px 0; display:flex; flex-direction:column; gap:12px;">
        <!-- 1. RPS Box (Untuk Penggajian) -->
        <div style="background:linear-gradient(135deg,rgba(14,165,233,0.07),rgba(14,165,233,0.02)); border:1.5px solid rgba(14,165,233,0.3); border-radius:12px; padding:12px 14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:4px;">
            <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#0369a1; display:flex; align-items:center; gap:6px;">
              <span style="width:20px; height:20px; border-radius:6px; background:rgba(14,165,233,0.15); display:inline-flex; align-items:center; justify-content:center;">📋</span>
              RPS <span style="color:#ef4444; font-size:13px; margin-left:2px;">*</span>
            </div>
            <span style="font-size:10px; font-weight:700; color:#0284c7; background:rgba(14,165,233,0.12); padding:2px 8px; border-radius:12px;">⭐ Utama</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <input type="number" class="bor-input blue" data-batch="${groupMobil}" placeholder="Wajib diisi" min="0"
              oninput="ldValidateBorInput(this); ldUpdateTotal()"
              style="flex:1; padding:8px 12px; border-radius:8px; border:1.5px solid rgba(14,165,233,0.4); font-size:18px; font-weight:800; background:#fff; outline:none; color:#0369a1; transition:all .2s;"
              onfocus="this.style.borderColor='#0ea5e9';this.style.boxShadow='0 0 0 3px rgba(14,165,233,0.15)'" onblur="this.style.borderColor='rgba(14,165,233,0.4)';this.style.boxShadow='none'">
            <span style="font-size:12px; font-weight:700; color:#64748b;">${satuan}</span>
          </div>
        </div>

        <!-- 2. Outbound Box -->
        <div style="background:linear-gradient(135deg,rgba(109,40,217,0.06),rgba(109,40,217,0.02)); border:1.5px solid rgba(109,40,217,0.25); border-radius:12px; padding:12px 14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:4px;">
            <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#6d28d9; display:flex; align-items:center; gap:6px;">
              <span style="width:20px; height:20px; border-radius:6px; background:rgba(109,40,217,0.15); display:inline-flex; align-items:center; justify-content:center;">🚚</span>
              Outbound <span style="color:#ef4444; font-size:13px; margin-left:2px;">*</span>
            </div>
            <span style="font-size:10px; font-weight:600; color:#7c3aed;">Pencatatan Barang <span style="color:#ef4444;">*</span></span>
          </div>

          <!-- Banner Petunjuk Ramping Outbound -->
          <div style="background:rgba(109,40,217,0.07); border:1px solid rgba(109,40,217,0.18); border-radius:8px; padding:6px 10px; margin-bottom:10px; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:600; color:#5b21b6; line-height:1.35;">
            <span style="font-size:13px; flex-shrink:0;">ℹ️</span>
            <span>Isi dengan <strong>jumlah FISIK AKTUAL</strong> (Kontainer, Styrofoam, Dus) yang benar-benar dikirim ke armada.</span>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(95px, 1fr)); gap:8px;">
            <div style="background:#fff; border:1.5px solid rgba(109,40,217,0.2); border-radius:10px; padding:8px 10px; text-align:center;">
              <div style="font-size:10px; font-weight:800; color:#6d28d9; margin-bottom:4px;">📦 Kontainer</div>
              <input type="number" class="bor-input-outbound-kontainer" data-batch-outbound="${groupMobil}" placeholder="0" min="0" value="0"
                style="width:100%; padding:6px; border-radius:6px; border:1.5px solid rgba(109,40,217,0.25); font-size:16px; font-weight:800; color:#6d28d9; background:rgba(109,40,217,0.03); text-align:center; outline:none;"
                onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor='rgba(109,40,217,0.25)'">
            </div>
            <div style="background:#fff; border:1.5px solid rgba(2,132,199,0.2); border-radius:10px; padding:8px 10px; text-align:center;">
              <div style="font-size:10px; font-weight:800; color:#0284c7; margin-bottom:4px;">🧊 Styrofoam</div>
              <input type="number" class="bor-input-outbound-styrofoam" data-batch-outbound="${groupMobil}" placeholder="0" min="0" value="0"
                style="width:100%; padding:6px; border-radius:6px; border:1.5px solid rgba(2,132,199,0.25); font-size:16px; font-weight:800; color:#0284c7; background:rgba(2,132,199,0.03); text-align:center; outline:none;"
                onfocus="this.style.borderColor='#0284c7'" onblur="this.style.borderColor='rgba(2,132,199,0.25)'">
            </div>
            <div style="background:#fff; border:1.5px solid rgba(217,119,6,0.2); border-radius:10px; padding:8px 10px; text-align:center;">
              <div style="font-size:10px; font-weight:800; color:#d97706; margin-bottom:4px;">📦 Dus</div>
              <input type="number" class="bor-input-outbound-dus" data-batch-outbound="${groupMobil}" placeholder="0" min="0" value="0"
                style="width:100%; padding:6px; border-radius:6px; border:1.5px solid rgba(217,119,6,0.25); font-size:16px; font-weight:800; color:#d97706; background:rgba(217,119,6,0.03); text-align:center; outline:none;"
                onfocus="this.style.borderColor='#d97706'" onblur="this.style.borderColor='rgba(217,119,6,0.25)'">
            </div>
          </div>
        </div>
      </div>
      <div class="bor-note-row" id="ld-note-row-${groupMobil}" style="display:none; padding: 8px 16px 0px;">
        <input type="text" class="form-input bor-note-input blue" data-batch="${groupMobil}" placeholder="Tulis alasan / keterangan over-input untuk Group Mobil ${groupMobil}..." style="font-size:12px; padding:8px 12px; border-radius:8px; border: 1.5px dashed var(--error); width: 100%; box-sizing: border-box; outline: none; background: rgba(14,165,233,0.01);">
      </div>
      <div class="bor-error${isFull ? ' visible' : ''}">${isFull ? '⚠️ Kapasitas sudah habis! Input ini akan masuk status Pending untuk divalidasi admin.' : ''}</div>
    `;
    outputList.appendChild(row);

    ldUpdateTotal();

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

  } catch (err) {
    showOnscreenError('ldValidateBorInput', err);
  }
}

// ldCheckOverInput dihapus — fungsi ini adalah dead code (No-op)

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
    const plateVal = truck.no_polisi.trim();
    const plateEmpty = !plateVal;
    const plateInvalid = plateVal && !POLISI_REGEX.test(plateVal.replace(/\s/g, ''));
    const gmsEmpty = truck.selectedGms.length === 0;
    
    if (plateEmpty || plateInvalid || gmsEmpty) {
      if (errEl) {
        errEl.style.display = 'flex';
        if (plateInvalid) {
          errEl.textContent = `Format No. Polisi tidak valid (contoh: B1234XYZ). Cek kembali.`;
        } else {
          errEl.textContent = 'No. Polisi dan Muatan Group Mobil wajib diisi.';
        }
      }
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

  // ── Validasi RPS & Outbound wajib diisi per cluster ──────────────────────
  const allClusterRows = document.querySelectorAll('#ldClusterOutputList .batch-output-row');
  allClusterRows.forEach(row => {
    const gm = row.getAttribute('data-batch-row');

    // 1. RPS wajib > 0
    const rpsInput = row.querySelector('.bor-input[data-batch]');
    const rpsVal = parseInt(rpsInput?.value) || 0;
    if (rpsInput && rpsVal <= 0) {
      rpsInput.style.borderColor = 'var(--error, #ef4444)';
      rpsInput.style.boxShadow  = '0 0 0 3px rgba(239,68,68,0.18)';
      showToast(`⚠️ RPS wajib diisi untuk Group Mobil ${gm}.`, 'error');
      valid = false;
    } else if (rpsInput) {
      rpsInput.style.borderColor = '';
      rpsInput.style.boxShadow   = '';
    }

    // 2. Outbound — minimal total Kontainer + Styrofoam + Dus > 0
    const inpK = row.querySelector('.bor-input-outbound-kontainer');
    const inpS = row.querySelector('.bor-input-outbound-styrofoam');
    const inpD = row.querySelector('.bor-input-outbound-dus');
    const outTotal = (parseInt(inpK?.value) || 0) + (parseInt(inpS?.value) || 0) + (parseInt(inpD?.value) || 0);

    const outboundBox = row.querySelector('.bor-input-outbound-kontainer')?.closest('div[style*="grid"]')?.parentElement;

    if (outTotal <= 0) {
      // Tandai semua input outbound dengan border merah
      [inpK, inpS, inpD].forEach(inp => {
        if (inp) {
          inp.style.borderColor = '#ef4444';
          inp.style.boxShadow  = '0 0 0 3px rgba(239,68,68,0.18)';
        }
      });
      showToast(`⚠️ Outbound wajib diisi untuk Group Mobil ${gm} (minimal 1 field > 0).`, 'error');
      valid = false;
    } else {
      // Reset jika sudah diisi
      [inpK, inpS, inpD].forEach(inp => {
        if (inp) {
          inp.style.borderColor = '';
          inp.style.boxShadow   = '';
        }
      });
    }
  });
  // ─────────────────────────────────────────────────────────────────────────

  return valid;
}

document.getElementById('loaderForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!ldValidate()) {
    showToast('Mohon lengkapi semua field yang wajib diisi.', 'error');
    return;
  }
  // Tampilkan Preview Modal dulu
  openPreviewModal('loader', buildLoaderPreviewHtml());
});

async function doLoaderSubmit() {
  const btn = document.getElementById('ldSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }

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

  // Kumpulkan nilai Outbound breakdown (Kontainer, Styrofoam, Dus) per cluster
  const clusterOutboundOutputs = {};
  document.querySelectorAll('#ldClusterOutputList .batch-output-row').forEach(row => {
    const gm = row.getAttribute('data-batch-row');
    const inpK = row.querySelector('.bor-input-outbound-kontainer');
    const inpS = row.querySelector('.bor-input-outbound-styrofoam');
    const inpD = row.querySelector('.bor-input-outbound-dus');

    if (gm) {
      clusterOutboundOutputs[gm] = {
        kontainer: parseInt(inpK?.value) || 0,
        styrofoam: parseInt(inpS?.value) || 0,
        dus:       parseInt(inpD?.value) || 0
      };
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
      fd.append('clusters',                    JSON.stringify(truck.selectedGms));
      fd.append('cluster_outputs',              JSON.stringify(truckOutputs));
      // Outbound outputs per truck (filter hanya GM milik truck ini)
      const truckOutboundOutputs = {};
      truck.selectedGms.forEach(gm => {
        truckOutboundOutputs[gm] = clusterOutboundOutputs[gm] || 0;
      });
      fd.append('cluster_outbound_outputs',     JSON.stringify(truckOutboundOutputs));
      fd.append('non_group',                    JSON.stringify(index === 0 ? nonGroup : { gacoan: 0, dikichi: 0, benfarm: 0 }));
      fd.append('jumlah_kontainer',             String(index === 0 ? (truckTotal + nonGroup.gacoan + nonGroup.dikichi + nonGroup.benfarm) : truckTotal));
      fd.append('catatan',                      finalCatatan);
      if (currentUser && currentUser.userId) fd.append('user_id', currentUser.userId);
      // Lampirkan foto hanya ke armada pertama (index 0)
      if (index === 0) {
        ldFiles.forEach(file => fd.append('lembar_register', file));
      }

      const r = await fetch('/api/loader-entries', {
        method: 'POST',
        body: fd
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const err = new Error(d.error || `Gagal mengirim armada ${truck.no_polisi}`);
        if (d.code === 'NOT_ABSEN') err.code = 'NOT_ABSEN';
        throw err;
      }
      return r.json();
    });

    await Promise.all(promises);
    closePreviewModal();
    // Cek warning foto dari salah satu response
    const responses = await Promise.all(promises.map(p => p.catch(() => null)));
    const photoWarning = responses.find(r => r && r.warning)?.warning;
    if (photoWarning) showToast(`⚠️ ${photoWarning}`, 'error');
    showToast('Semua Entry Loader berhasil dikirim! ✅', 'info');
    ldResetForm();
    loadDashboard();
  } catch(err) {
    closePreviewModal();
    if (err.code === 'NOT_ABSEN') {
      showAbsensiBlockedToast(err.message);
    } else {
      showToast(err.message || 'Gagal menghubungi server. Periksa koneksi.', 'error');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Kirim Sekarang'; }
  }
}


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
  _pendingClearType = 'loader';
  document.getElementById('clearModalSub').textContent = 'Semua data formulir Entry Loader yang sudah diisi akan dihapus.';
  document.getElementById('clearOverlay').classList.add('active');
  document.getElementById('clearModal').classList.add('active');
}


// ===================== DASHBOARD =====================
let dashboardLoaded = false;

async function loadDashboard() {
  const loading = document.getElementById('dashLoading');
  const main    = document.getElementById('dashMain');
  if (loading) loading.style.display = 'flex';
  if (main) main.style.display = 'none';

  const safeSetText = (id, txt) => { const elem = document.getElementById(id); if (elem) elem.textContent = txt; };
  const safeSetHtml = (id, html) => { const elem = document.getElementById(id); if (elem) elem.innerHTML = html; };
  const safeSetDisp = (id, disp) => { const elem = document.getElementById(id); if (elem) elem.style.display = disp; };

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
      if (status === 'rejected') return '<span class="dash-badge rejected">✗ Ditolak</span>';
      return `<span class="dash-badge">${status}</span>`;
    };

    // Tanggal hari ini
    const todayFmt = fmtDate(d.today_date);

    // Periode aktif — label dinamis
    const periodeStart = d.periode_start || null;
    const fmtDateShort = (dateStr) => {
      if (!dateStr) return '';
      const dt = new Date(dateStr + 'T00:00:00');
      return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const allLabel = periodeStart ? `Periode Ini` : `Sepanjang Waktu`;
    const allSubLabel = periodeStart ? `sejak ${fmtDateShort(periodeStart)}` : `semua waktu`;

    document.querySelectorAll('.dash-all-label').forEach(el2 => { el2.textContent = allLabel; });
    document.querySelectorAll('.dash-all-sub').forEach(el2 => { el2.textContent = allSubLabel; });

    let hasAny = false;

    // ---- PICKER ----
    const p = d.picker;
    if (p && (p.all?.total_batch > 0 || p.today?.total_batch > 0)) {
      hasAny = true;
      safeSetDisp('dashSectionPicker', 'block');
      safeSetText('dashPickerDate', todayFmt);
      safeSetText('dashPickerBatchToday', fmt(p.today?.total_batch));
      safeSetText('dashPickerOutputToday', fmt(p.today?.total_output));
      safeSetText('dashPickerBatchAll', fmt(p.all?.total_batch));
      safeSetText('dashPickerOutputAll', fmt(p.all?.total_output));
      safeSetHtml('dashPickerStatus', `
        <span class="dash-badge approved">✓ Approved: ${fmt(p.today?.approved)}</span>
        ${p.today?.pending > 0 ? `<span class="dash-badge pending">⏳ Pending: ${fmt(p.today?.pending)}</span>` : ''}
      `);
      if (p.today?.submissions && p.today.submissions.length > 0) {
        safeSetHtml('dashPickerList', p.today.submissions.map(s => {
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
        }).join(''));
      } else {
        safeSetHtml('dashPickerList', '<div class="dash-list-empty">Belum ada submission Picker hari ini</div>');
      }
    } else {
      safeSetDisp('dashSectionPicker', 'none');
    }

    // ---- SORTER ----
    const so = d.sorter;
    if (so && (so.all?.total_batch > 0 || so.today?.total_batch > 0)) {
      hasAny = true;
      safeSetDisp('dashSectionSorter', 'block');
      safeSetText('dashSorterDate', todayFmt);
      safeSetText('dashSorterBatchToday', fmt(so.today?.total_batch));
      safeSetText('dashSorterOutputToday', fmt(so.today?.total_output));
      safeSetText('dashSorterBatchAll', fmt(so.all?.total_batch));
      safeSetText('dashSorterOutputAll', fmt(so.all?.total_output));
      safeSetHtml('dashSorterStatus', `
        <span class="dash-badge approved">✓ Approved: ${fmt(so.today?.approved)}</span>
        ${so.today?.pending > 0 ? `<span class="dash-badge pending">⏳ Pending: ${fmt(so.today?.pending)}</span>` : ''}
      `);
      if (so.today?.submissions && so.today.submissions.length > 0) {
        safeSetHtml('dashSorterList', so.today.submissions.map(s => {
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
        }).join(''));
      } else {
        safeSetHtml('dashSorterList', '<div class="dash-list-empty">Belum ada submission Sorter hari ini</div>');
      }
    } else {
      safeSetDisp('dashSectionSorter', 'none');
    }

    // ---- LOADER ----
    const lo = d.loader;
    if (lo && (lo.all?.total_trip > 0 || lo.today?.total_trip > 0)) {
      hasAny = true;
      safeSetDisp('dashSectionLoader', 'block');
      safeSetText('dashLoaderDate', todayFmt);
      safeSetText('dashLoaderTripToday', fmt(lo.today?.total_trip));
      safeSetText('dashLoaderKontainerToday', fmt(lo.today?.total_kontainer));
      safeSetText('dashLoaderTripAll', fmt(lo.all?.total_trip));
      safeSetText('dashLoaderKontainerAll', fmt(lo.all?.total_kontainer));
      if (lo.today?.entries && lo.today.entries.length > 0) {
        safeSetHtml('dashLoaderList', lo.today.entries.map(e => {
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
        }).join(''));
      } else {
        safeSetHtml('dashLoaderList', '<div class="dash-list-empty">Belum ada entry Loader hari ini</div>');
      }
    } else {
      safeSetDisp('dashSectionLoader', 'none');
    }

    safeSetDisp('dashEmpty', hasAny ? 'none' : 'block');

    try { renderDashboardSparkline(d); } catch(err) {}
    try { updatePendingBadge(d); } catch(err) {}

    dashboardLoaded = true;

  } catch(err) {
    console.error('loadDashboard error:', err);
    if (main) { main.innerHTML = '<div class="dash-empty"><div class="dash-empty-title">Gagal memuat data</div><div class="dash-empty-sub">Periksa koneksi Anda dan coba refresh.</div></div>'; }
  } finally {
    if (loading) loading.style.display = 'none';
    if (main) main.style.display = 'block';
  }
}

// ===================== DASHBOARD SPARKLINE =====================
function renderDashboardSparkline(d) {
  // Kumpulkan data 14 hari terakhir dari all_submissions + loader entries
  const daily = {};
  const allSubs = [
    ...(d.picker?.all_submissions || []),
    ...(d.sorter?.all_submissions || [])
  ];
  allSubs.forEach(s => {
    const tgl = (s.tanggal_pengerjaan || s.created_at || '').slice(0, 10);
    if (!tgl) return;
    daily[tgl] = (daily[tgl] || 0) + (parseInt(s.jumlah_output) || 0);
  });
  (d.loader?.all_entries || []).forEach(e => {
    const tgl = (e.tanggal_kirim || e.tanggal_carian || '').slice(0, 10);
    if (!tgl) return;
    daily[tgl] = (daily[tgl] || 0) + (parseInt(e.jumlah_kontainer) || 0);
  });

  // Ambil 7 hari terakhir (semua menggunakan timezone Asia/Jakarta)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  const days = [];
  for (let i = 6; i >= 0; i--) {
    // Hitung tanggal dengan offset hari dalam WIB
    const nowWib = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    nowWib.setDate(nowWib.getDate() - i);
    const k = nowWib.toLocaleDateString('sv-SE');
    days.push({ key: k, val: daily[k] || 0, isToday: k === today });
  }

  const max = Math.max(...days.map(x => x.val), 1);
  const W = 180, H = 48, pad = 4;
  const barW = (W - pad * 2) / 7 - 3;

  const barsHtml = days.map((day, i) => {
    const bh = Math.max(4, ((day.val / max) * (H - pad * 2)));
    const x = pad + i * ((W - pad * 2) / 7);
    const y = H - pad - bh;
    const col = day.isToday ? '#6366f1' : (day.val > 0 ? '#a5b4fc' : '#e2e8f0');
    const label = day.key.slice(5); // MM-DD
    return `<g>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${col}" opacity="${day.isToday ? '1' : '0.7'}"/>
      ${day.val > 0 ? `<text x="${(x + barW/2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="7" fill="currentColor" opacity="0.6">${day.val > 999 ? Math.round(day.val/1000)+'k' : day.val}</text>` : ''}
    </g>`;
  }).join('');

  const dayLabels = days.map((day, i) => {
    const x = pad + i * ((W - pad * 2) / 7) + barW / 2;
    const short = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][new Date(day.key + 'T00:00:00').getDay()];
    return `<text x="${x.toFixed(1)}" y="${H + 10}" text-anchor="middle" font-size="7" fill="currentColor" opacity="${day.isToday ? '1' : '0.5'}" font-weight="${day.isToday ? '700' : '400'}">${short}</text>`;
  }).join('');

  const svgHtml = `<div class="dash-sparkline-wrap">
    <div class="dash-sparkline-label">Tren Output 7 Hari</div>
    <svg width="${W}" height="${H + 14}" viewBox="0 0 ${W} ${H + 14}" style="overflow:visible;">
      ${barsHtml}${dayLabels}
    </svg>
  </div>`;

  // Sisipkan setelah welcome header jika belum ada
  let sparkWrap = document.getElementById('dashSparklineWrap');
  if (!sparkWrap) {
    sparkWrap = document.createElement('div');
    sparkWrap.id = 'dashSparklineWrap';
    const dashMain = document.getElementById('dashMain');
    if (dashMain) dashMain.insertAdjacentElement('afterbegin', sparkWrap);
  }
  sparkWrap.innerHTML = svgHtml;
}

// ===================== PENDING BADGE NOTIFIKASI =====================
function updatePendingBadge(d) {
  let totalPending = 0;
  const pickerSubs = d.picker?.all_submissions || [];
  const sorterSubs = d.sorter?.all_submissions || [];
  pickerSubs.forEach(s => { if (s.status === 'pending') totalPending++; });
  sorterSubs.forEach(s => { if (s.status === 'pending') totalPending++; });

  // Cari atau buat badge di sidebar tab Dashboard
  let badge = document.getElementById('dashPendingBadge');
  const tabBtn = document.getElementById('tab-dashboard');
  if (!badge && tabBtn) {
    badge = document.createElement('span');
    badge.id = 'dashPendingBadge';
    badge.style.cssText = 'position:absolute;top:8px;right:10px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:20px;letter-spacing:0.3px;min-width:18px;text-align:center;';
    tabBtn.style.position = 'relative';
    tabBtn.appendChild(badge);
  }
  if (badge) {
    if (totalPending > 0) {
      badge.textContent = totalPending > 9 ? '9+' : totalPending;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

// ===================== PREVIEW SUBMIT MODAL =====================
let _pendingSubmitType = null; // 'picker' | 'loader'
let _pendingFormData = null;

function openPreviewModal(type, summaryHtml) {
  _pendingSubmitType = type;
  document.getElementById('previewModalBody').innerHTML = summaryHtml;
  document.getElementById('previewOverlay').classList.add('active');
  document.getElementById('previewModal').classList.add('active');
  document.getElementById('previewConfirmBtn').disabled = false;
  document.getElementById('previewConfirmText').textContent = 'Ya, Kirim Sekarang';
  document.getElementById('previewSpinner').style.display = 'none';
}

function closePreviewModal() {
  document.getElementById('previewOverlay').classList.remove('active');
  document.getElementById('previewModal').classList.remove('active');
  _pendingSubmitType = null;
  _pendingFormData = null;
}

async function previewConfirmSubmit() {
  const btn = document.getElementById('previewConfirmBtn');
  const txt = document.getElementById('previewConfirmText');
  const spin = document.getElementById('previewSpinner');
  btn.disabled = true;
  txt.textContent = 'Mengirim...';
  spin.style.display = 'block';

  try {
    if (_pendingSubmitType === 'picker') {
      await doPickerSubmit();
    } else if (_pendingSubmitType === 'loader') {
      await doLoaderSubmit();
    }
  } finally {
    btn.disabled = false;
    txt.textContent = 'Ya, Kirim Sekarang';
    spin.style.display = 'none';
  }
}

function buildPickerPreviewHtml() {
  const posisi     = document.getElementById('ps_posisi').value || '-';
  const zona       = document.getElementById('ps_zona').value || '-';
  const tglCarian  = document.getElementById('ps_tanggal_carian').value || '-';
  const tglKerja   = document.getElementById('ps_tanggal_pengerjaan').value || '-';
  const tglCarianFmt = tglCarian !== '-' ? new Date(tglCarian+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}) : '-';
  const tglKerjaFmt  = tglKerja  !== '-' ? new Date(tglKerja+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}) : '-';

  const batches = [];
  let totalOutput = 0;
  document.querySelectorAll('#psBatchOutputList .bor-input').forEach(inp => {
    const val = parseInt(inp.value) || 0;
    if (val > 0 && !inp.disabled) {
      batches.push({ batch: inp.getAttribute('data-batch'), val });
      totalOutput += val;
    }
  });

  const posColor = posisi === 'Picker' ? '#8b5cf6' : '#10b981';
  const rows = batches.map(b => `
    <div class="pv-row">
      <span class="pv-label">${b.batch}</span>
      <span class="pv-val">${b.val.toLocaleString('id-ID')} ${posisi === 'Picker' ? 'pcs' : 'kont.'}</span>
    </div>`).join('');

  const filesHtml = psSelectedFiles.length > 0
    ? psSelectedFiles.map(f => `<div style="font-size:12px;color:var(--text-muted);word-break:break-all;margin-top:2px;">📷 ${f.name}</div>`).join('')
    : '<div class="pv-empty" style="font-size:12px;">Tidak ada foto/PDF diupload</div>';

  return `
    <div class="pv-section">
      <div class="pv-row"><span class="pv-label">Posisi</span><span class="pv-val" style="color:${posColor};font-weight:700;">${posisi}</span></div>
      <div class="pv-row"><span class="pv-label">Zona</span><span class="pv-val">${zona}</span></div>
      <div class="pv-row"><span class="pv-label">Tgl. Carian</span><span class="pv-val">${tglCarianFmt}</span></div>
      <div class="pv-row"><span class="pv-label">Tgl. Pengerjaan</span><span class="pv-val">${tglKerjaFmt}</span></div>
    </div>
    <div class="pv-divider"></div>
    <div class="pv-section">
      <div class="pv-section-title">Output per Batch</div>
      ${rows || '<div class="pv-empty">Tidak ada output diisi</div>'}
    </div>
    <div class="pv-divider"></div>
    <div class="pv-section">
      <div class="pv-section-title">Foto Register / Lampiran</div>
      ${filesHtml}
    </div>
    <div class="pv-divider"></div>
    <div class="pv-total-row">
      <span>Total Output</span>
      <span class="pv-total-val">${totalOutput.toLocaleString('id-ID')} ${posisi === 'Picker' ? 'pcs' : 'kont.'}</span>
    </div>`;
}

function buildLoaderPreviewHtml() {
  const tglCarian  = document.getElementById('ld_tanggal_carian').value || '-';
  const tglKirim   = document.getElementById('ld_tanggal_kirim').value  || '-';
  const tglCarianFmt = tglCarian !== '-' ? new Date(tglCarian+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}) : '-';
  const tglKirimFmt  = tglKirim  !== '-' ? new Date(tglKirim+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}) : '-';
  const totalKont = document.getElementById('ldTotalKontainer')?.textContent || '0';

  const armadas = [];
  document.querySelectorAll('#ldArmadaListContainer .armada-card').forEach(card => {
    const pol = card.querySelector('.no-polisi-input')?.value || '-';
    armadas.push(pol);
  });

  const filesHtml = ldSelectedFiles.length > 0
    ? ldSelectedFiles.map(f => `<div style="font-size:12px;color:var(--text-muted);word-break:break-all;margin-top:2px;">📷 ${f.name}</div>`).join('')
    : '<div class="pv-empty" style="font-size:12px;">Tidak ada foto diupload</div>';

  return `
    <div class="pv-section">
      <div class="pv-row"><span class="pv-label">Tgl. Carian</span><span class="pv-val">${tglCarianFmt}</span></div>
      <div class="pv-row"><span class="pv-label">Tgl. Kirim</span><span class="pv-val">${tglKirimFmt}</span></div>
      <div class="pv-row"><span class="pv-label">Armada</span><span class="pv-val">${armadas.length > 0 ? armadas.join(', ') : '-'}</span></div>
    </div>
    <div class="pv-divider"></div>
    <div class="pv-section">
      <div class="pv-section-title">Foto Register / Lampiran</div>
      ${filesHtml}
    </div>
    <div class="pv-divider"></div>
    <div class="pv-total-row">
      <span>Total Kontainer</span>
      <span class="pv-total-val" style="color:#0ea5e9;">${totalKont} kontainer</span>
    </div>`;
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
      const safeUrl = ann.image_url ? ann.image_url.replace(/"/g, '&quot;') : '';
      const imgHtml = ann.image_url ? `<div class="ann-banner-image-wrap" style="margin-top:12px; border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,0.15); max-height:260px; cursor:pointer;" data-lightbox-src="${safeUrl}" data-lightbox-caption><img src="${safeUrl}" style="width:100%; height:100%; object-fit:cover; display:block;"></div>` : '';
      return `<div class="ann-banner ${ann.type || 'info'}">
        <div class="ann-banner-emoji">${ann.emoji || '📢'}</div>
        <div class="ann-banner-body">
          <div class="ann-banner-title">${ann.title}</div>
          <div class="ann-banner-content">${autoLink(ann.content)}</div>
          ${imgHtml}
          <div class="ann-banner-date">${dateStr}</div>
        </div>
      </div>`;
    }).join('');

    // Tampilkan modal dengan transisi
    overlay.classList.add('active');
    modal.classList.add('active');

    // Event listener aman untuk lightbox di pengumuman (menghindari XSS di inline onclick)
    body.querySelectorAll('[data-lightbox-src]').forEach((el, i) => {
      const annData = data[i] || data[0];
      el.addEventListener('click', () => {
        openLightbox(el.dataset.lightboxSrc, annData ? annData.title : 'Bukti Foto');
      });
    });
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

// ===================== KALENDER KERJA =====================
let calendarCurrentDate = new Date();

async function loadCalendarData() {
  const grid = document.getElementById('calendar-days-grid');
  if (!grid) return;

  // Tampilkan Skeleton Pemuatan Kalender yang Menarik
  let skeletonHtml = '';
  for (let i = 0; i < 35; i++) {
    skeletonHtml += '<div class="cal-skeleton-day"></div>';
  }
  grid.innerHTML = skeletonHtml;

  try {
    const year = calendarCurrentDate.getFullYear();
    const month = calendarCurrentDate.getMonth(); // 0-indexed

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

    // 1. Fetch official absensi
    const absRes = await fetch(`/api/my-absensi?tanggal_mulai=${startStr}&tanggal_akhir=${endStr}`);
    if (!absRes.ok) throw new Error('Gagal mengambil data absensi.');
    const absData = await absRes.json();
    const officialHadir = new Set(absData.hadir || []);

    // 2. Fetch user achievements (submissions)
    const achRes = await fetch('/api/my-achievements');
    if (!achRes.ok) throw new Error('Gagal mengambil data pencapaian.');
    const ach = await achRes.json();

    const datesWithSubmissions = new Set();
    if (ach.picker && ach.picker.all_submissions) {
      ach.picker.all_submissions.forEach(s => {
        const d = s.tanggal_carian || s.tanggal_pengerjaan;
        if (d) datesWithSubmissions.add(d.slice(0, 10));
      });
    }
    if (ach.sorter && ach.sorter.all_submissions) {
      ach.sorter.all_submissions.forEach(s => {
        const d = s.tanggal_carian || s.tanggal_pengerjaan;
        if (d) datesWithSubmissions.add(d.slice(0, 10));
      });
    }
    if (ach.loader && ach.loader.all_entries) {
      ach.loader.all_entries.forEach(e => {
        const d = e.tanggal_kirim || e.tanggal_carian;
        if (d) datesWithSubmissions.add(d.slice(0, 10));
      });
    }

    // 3. Render Calendar
    renderCalendar(year, month, officialHadir, datesWithSubmissions, ach);
  } catch (err) {
    console.error('Error loadCalendarData:', err);
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #ef4444; font-weight: 600;">
      Gagal memuat data kalender: ${err.message}
    </div>`;
  }
}

function renderCalendar(year, month, officialHadir, datesWithSubmissions, ach) {
  const monthNamesIndo = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];

  // Update header text
  const headerEl = document.getElementById('calendar-month-year');
  if (headerEl) {
    headerEl.innerText = `${monthNamesIndo[month]} ${year}`;
  }

  const grid = document.getElementById('calendar-days-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const today = new Date();
  const todayStr = today.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 10);

  // First day of month (0 = Sun, 1 = Mon, ..., 6 = Sat)
  const firstDay = new Date(year, month, 1);
  const startDayOfWeek = firstDay.getDay();

  // Total days in month
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();

  // Days from previous month (padding)
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthLastDay - i;
    const cell = document.createElement('div');
    cell.className = 'calendar-day padding';
    cell.innerHTML = `<span class="day-number">${d}</span>`;
    grid.appendChild(cell);
  }

  let totalHadirCount = 0;
  let totalFormCount = 0;
  let totalOffCount = 0;

  // Days in current month
  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    cell.dataset.date = dateStr;

    const isToday = (dateStr === todayStr);
    if (isToday) cell.classList.add('today');

    const isFuture = (dateStr > todayStr);

    const hasOfficial = officialHadir.has(dateStr);
    const hasForm = datesWithSubmissions.has(dateStr);

    if (isFuture) {
      cell.classList.add('future');
    } else {
      if (hasOfficial) {
        cell.classList.add('status-hadir');
        totalHadirCount++;
      } else if (hasForm) {
        cell.classList.add('status-isi-form');
        totalFormCount++;
      } else {
        cell.classList.add('status-off');
        totalOffCount++;
      }
    }

    // Day content (menggunakan icon badge yang lebih besar dan jelas)
    let badgeHtml = '';
    if (!isFuture) {
      if (hasOfficial) {
        badgeHtml += '<span class="day-badge-icon badge-hadir" title="Hadir Resmi (Absen Admin)">✓</span>';
      }
      if (hasForm) {
        badgeHtml += '<span class="day-badge-icon badge-isi-form" title="Mengisi Formulir Kerja">✎</span>';
      }
    }

    cell.innerHTML = `
      <span class="day-number">${dayNum}</span>
      <div class="day-badge-wrap">${badgeHtml}</div>
    `;

    // Tooltip / title text
    if (!isFuture) {
      let titleParts = [];
      if (hasOfficial) titleParts.push('Hadir Resmi (Absen Admin)');
      if (hasForm) titleParts.push('Mengisi Formulir Kerja');
      if (!hasOfficial && !hasForm) titleParts.push('Off / Belum Hadir');
      cell.title = `${dayNum} ${monthNamesIndo[month]} ${year}: ${titleParts.join(' & ')}`;
    }

    // Add click event listener to select and show day details
    cell.addEventListener('click', () => {
      document.querySelectorAll('#calendar-days-grid .calendar-day').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      showDayDetails(dateStr, hasOfficial, hasForm, dayNum, month, year, ach);

      // Jika di HP/tablet, munculkan bottom sheet modal dan backdrop overlay
      if (window.innerWidth <= 768) {
        const detailsCard = document.getElementById('calendar-day-details-card');
        const backdrop = document.getElementById('calendar-backdrop');
        if (detailsCard) detailsCard.classList.add('show-mobile');
        if (backdrop) backdrop.classList.add('active');
      }
    });

    grid.appendChild(cell);
  }

  // Days from next month (padding) to make a grid of 6 rows (42 cells) or just fill the week
  const totalCellsSoFar = startDayOfWeek + totalDays;
  const remainingCells = (totalCellsSoFar % 7 === 0) ? 0 : 7 - (totalCellsSoFar % 7);
  for (let i = 1; i <= remainingCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day padding';
    cell.innerHTML = `<span class="day-number">${i}</span>`;
    grid.appendChild(cell);
  }

  // Update statistics
  const statHadirEl = document.getElementById('cal-stat-total-hadir');
  const statFormEl = document.getElementById('cal-stat-total-form');
  const statOffEl = document.getElementById('cal-stat-total-off');

  if (statHadirEl) statHadirEl.innerText = totalHadirCount;
  if (statFormEl) statFormEl.innerText = totalFormCount;
  if (statOffEl) statOffEl.innerText = totalOffCount;

  // Auto-select today if present, otherwise select the first day of the month
  let dayToSelect = grid.querySelector(`.calendar-day[data-date="${todayStr}"]`);
  if (!dayToSelect) {
    dayToSelect = grid.querySelector('.calendar-day:not(.padding)');
  }
  if (dayToSelect) {
    // Pada mobile, tampilkan detail di DOM tapi jangan slide up modal secara otomatis saat load pertama
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      document.querySelectorAll('#calendar-days-grid .calendar-day').forEach(c => c.classList.remove('selected'));
      dayToSelect.classList.add('selected');
      const dayNum = parseInt(dayToSelect.querySelector('.day-number').innerText);
      const dateStr = dayToSelect.dataset.date;
      const hasOfficial = officialHadir.has(dateStr);
      const hasForm = datesWithSubmissions.has(dateStr);
      showDayDetails(dateStr, hasOfficial, hasForm, dayNum, month, year, ach);
    } else {
      dayToSelect.click();
    }
  }
}

function showDayDetails(dateStr, hasOfficial, hasForm, dayNum, month, year, ach) {
  const monthNamesIndo = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  
  const dt = new Date(dateStr + 'T00:00:00');
  const dayName = dt.toLocaleDateString('id-ID', { weekday: 'long' });
  const formattedDate = `${dayName}, ${dayNum} ${monthNamesIndo[month]} ${year}`;
  
  document.getElementById('details-date-title').innerText = formattedDate;
  
  let html = '';
  
  // Status Absensi Resmi
  html += `
    <div class="details-section">
      <div class="details-section-title">Status Absensi (HR/Admin)</div>
      <div class="details-status-badge ${hasOfficial ? 'bg-hadir' : 'bg-off'}">
        ${hasOfficial ? '✅ Hadir Resmi' : '❌ Tidak Hadir / Belum Diabsen'}
      </div>
    </div>
  `;
  
  // Status Formulir Kerja
  html += `
    <div class="details-section">
      <div class="details-section-title">Pengisian Formulir (Karyawan)</div>
      <div class="details-status-badge ${hasForm ? 'bg-isi-form' : 'bg-off'}">
        ${hasForm ? '📝 Mengisi Formulir Kerja' : '⚠️ Tidak Mengisi Formulir'}
      </div>
    </div>
  `;
  
  // Submissions Details
  if (hasForm && ach) {
    let subDetails = [];
    
    // Check Picker Submissions
    const pickerSubs = (ach.picker?.all_submissions || []).filter(s => {
      const d = s.tanggal_carian || s.tanggal_pengerjaan;
      return d && d.slice(0, 10) === dateStr;
    });
    
    // Check Sorter Submissions
    const sorterSubs = (ach.sorter?.all_submissions || []).filter(s => {
      const d = s.tanggal_carian || s.tanggal_pengerjaan;
      return d && d.slice(0, 10) === dateStr;
    });
    
    // Check Loader Entries
    const loaderEntries = (ach.loader?.all_entries || []).filter(e => {
      const d = e.tanggal_kirim || e.tanggal_carian;
      return d && d.slice(0, 10) === dateStr;
    });
    
    if (pickerSubs.length > 0) {
      const totalOut = pickerSubs.reduce((sum, s) => sum + (parseInt(s.jumlah_output) || 0), 0);
      subDetails.push(`
        <div class="details-sub-item">
          <strong>Picker:</strong> ${pickerSubs.length} batch (${totalOut.toLocaleString('id-ID')} output)
        </div>
      `);
    }
    
    if (sorterSubs.length > 0) {
      const totalOut = sorterSubs.reduce((sum, s) => sum + (parseInt(s.jumlah_output) || 0), 0);
      subDetails.push(`
        <div class="details-sub-item">
          <strong>Sorter:</strong> ${sorterSubs.length} batch (${totalOut.toLocaleString('id-ID')} output)
        </div>
      `);
    }
    
    if (loaderEntries.length > 0) {
      const totalKon = loaderEntries.reduce((sum, e) => sum + (parseInt(e.jumlah_kontainer) || 0), 0);
      subDetails.push(`
        <div class="details-sub-item">
          <strong>Loader:</strong> ${loaderEntries.length} trip (${totalKon.toLocaleString('id-ID')} kontainer)
        </div>
      `);
    }
    
    if (subDetails.length > 0) {
      html += `
        <div class="details-section">
          <div class="details-section-title">Detail Input Kerja</div>
          <div class="details-work-list">
            ${subDetails.join('')}
          </div>
        </div>
      `;
    }
  } else {
    html += `
      <div class="details-section">
        <div class="details-text-muted">Tidak ada aktivitas penginputan formulir pada tanggal ini.</div>
      </div>
    `;
  }
  
  document.getElementById('details-body-content').innerHTML = html;
}

function changeCalendarMonth(offset) {
  calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + offset);
  loadCalendarData();
}

function closeDayDetails() {
  const card = document.getElementById('calendar-day-details-card');
  const backdrop = document.getElementById('calendar-backdrop');
  if (card) card.classList.remove('show-mobile');
  if (backdrop) backdrop.classList.remove('active');
}

// Expose to global scope
window.dismissAnnouncements = dismissAnnouncements;
window.closeAnnouncementModalOnly = closeAnnouncementModalOnly;
window.loadAnnouncements    = loadAnnouncements;
window.loadCalendarData     = loadCalendarData;
window.changeCalendarMonth  = changeCalendarMonth;
window.closeDayDetails      = closeDayDetails;
let rtLoaderEntriesCache = [];
let rtQcOutboundCache = [];
let rtGroupedArmadaCache = {};

async function rtLoadLoaderEntries() {
  const tglRef = document.getElementById('rt_tanggal_referensi')?.value;
  const listEl = document.getElementById('rtArmadaList');
  const emptyEl = document.getElementById('rtEmptyState');
  if (!tglRef || !listEl) return;
  listEl.innerHTML = '<div style="text-align:center;padding:32px;color:#94a3b8;font-size:13px;">Memuat data outbound &amp; QC...</div>';
  if (emptyEl) emptyEl.style.display = 'none';
  try {
    const [resLoader, resQc] = await Promise.all([
      fetch(`/api/loader-entries?tanggal_carian=${tglRef}`),
      fetch(`/api/qc-outbound?tanggal=${tglRef}`)
    ]);
    const dataLoader = await resLoader.json();
    const dataQc = await resQc.json();
    rtLoaderEntriesCache = Array.isArray(dataLoader) ? dataLoader : (dataLoader.entries || []);
    rtQcOutboundCache = (dataQc && dataQc.data) ? dataQc.data : [];

    if (rtLoaderEntriesCache.length === 0 && rtQcOutboundCache.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }
    rtRenderArmadaCards();
  } catch(e) {
    console.error('rtLoadLoaderEntries error:', e);
    listEl.innerHTML = '<div style="text-align:center;padding:32px;color:#ef4444;font-size:13px;">Gagal memuat data outbound.</div>';
  }
}

function parsePackageBreakdown(item) {
  if (typeof item === 'number') {
    return { kontainer: item, styrofoam: 0, dus: 0, total: item };
  }
  if (typeof item === 'string') {
    const p = parseInt(item) || 0;
    return { kontainer: p, styrofoam: 0, dus: 0, total: p };
  }
  if (typeof item === 'object' && item !== null) {
    const k = parseInt(item.kontainer || item.kont) || 0;
    const s = parseInt(item.styrofoam || item.stero) || 0;
    const d = parseInt(item.dus || item.box) || 0;
    return { kontainer: k, styrofoam: s, dus: d, total: k + s + d };
  }
  return { kontainer: 0, styrofoam: 0, dus: 0, total: 0 };
}

function rtRenderArmadaCards() {
  const listEl = document.getElementById('rtArmadaList');
  if (!listEl) return;
  listEl.innerHTML = '';

  // Aggregate all loader entries by cluster name (Flat List like paper form)
  rtClusterMap = {};
  rtLoaderEntriesCache.forEach(entry => {
    let cl = [];
    if (Array.isArray(entry.clusters)) cl = entry.clusters;
    else if (entry.clusters && typeof entry.clusters === 'object') cl = entry.clusters.list || [];
    if (cl.length === 0 && entry.no_polisi) cl = [entry.no_polisi];

    const ob = entry.cluster_outbound_outputs || {};
    const rps = (entry.clusters && entry.clusters.outputs) ? entry.clusters.outputs : (entry.cluster_outputs || {});

    cl.forEach(gm => {
      if (!rtClusterMap[gm]) {
        rtClusterMap[gm] = {
          gm: gm,
          no_polisi: entry.no_polisi || gm,
          rps: 0,
          outbound: { kontainer: 0, styrofoam: 0, dus: 0, total: 0 },
          entries: []
        };
      }
      // Outbound fallback from legacy cluster_outbound_outputs (if any)
      const parsedOb = parsePackageBreakdown(ob[gm]);
      rtClusterMap[gm].outbound.kontainer += parsedOb.kontainer;
      rtClusterMap[gm].outbound.styrofoam += parsedOb.styrofoam;
      rtClusterMap[gm].outbound.dus       += parsedOb.dus;
      rtClusterMap[gm].outbound.total     += parsedOb.total;
      if (rps[gm] !== undefined) rtClusterMap[gm].rps += (parseInt(rps[gm]) || 0);
      rtClusterMap[gm].entries.push(entry);
    });
  });

  // Enrich & override with actual QC Outbound data per armada (no_polisi)
  const qcMap = {};
  rtQcOutboundCache.forEach(qc => {
    if (qc.no_polisi) {
      qcMap[qc.no_polisi.trim().toUpperCase()] = qc;
    }
  });

  Object.keys(qcMap).forEach(nopol => {
    const qc = qcMap[nopol];
    const k = parseInt(qc.kontainer) || 0;
    const s = parseInt(qc.styrofoam) || 0;
    const d = parseInt(qc.dus) || 0;
    const tot = k + s + d;

    // Find matching key in rtClusterMap (by gm or no_polisi)
    let matchedKey = Object.keys(rtClusterMap).find(key => 
      key.trim().toUpperCase() === nopol || 
      (rtClusterMap[key].no_polisi && rtClusterMap[key].no_polisi.trim().toUpperCase() === nopol)
    );

    if (matchedKey) {
      rtClusterMap[matchedKey].outbound = { kontainer: k, styrofoam: s, dus: d, total: tot };
      rtClusterMap[matchedKey].qc_record = qc;
    } else {
      // Armada has QC Outbound record but no loader entry yet
      rtClusterMap[nopol] = {
        gm: nopol,
        no_polisi: nopol,
        rps: 0,
        outbound: { kontainer: k, styrofoam: s, dus: d, total: tot },
        qc_record: qc,
        entries: []
      };
    }
  });

  const clusterKeys = Object.keys(rtClusterMap).sort();
  if (clusterKeys.length === 0) {
    const emptyEl = document.getElementById('rtEmptyState');
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }

  let grandOutK = 0, grandOutS = 0, grandOutD = 0;
  clusterKeys.forEach(gm => {
    const o = rtClusterMap[gm].outbound;
    grandOutK += o.kontainer;
    grandOutS += o.styrofoam;
    grandOutD += o.dus;
  });

  // Top Summary Banner
  const topBanner = document.createElement('div');
  topBanner.className = 'form-section teal-section';
  topBanner.style.cssText = 'margin-bottom:16px; padding:14px 16px; border-radius:14px; background:linear-gradient(135deg,rgba(13,148,136,0.08),rgba(15,118,110,0.03)); border:1.5px solid rgba(13,148,136,0.2); box-shadow:0 4px 14px rgba(13,148,136,0.06);';
  topBanner.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
      <div>
        <div style="font-size:16px; font-weight:800; color:#0F766E; display:flex; align-items:center; gap:8px;">
          📋 FORM RETUR HARIAN (REKAP TOKO → DC)
        </div>
        <div style="font-size:11px; color:#64748b; margin-top:2px;">
          Total Outbound: <strong>${clusterKeys.length} Grup Cluster</strong> · <strong>${grandOutK} Kont</strong> · <strong>${grandOutS} Stero</strong> · <strong>${grandOutD} Dus</strong>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <div style="background:#fff; padding:6px 14px; border-radius:10px; border:1.5px solid rgba(13,148,136,0.25); text-align:right;">
          <span style="font-size:9px; text-transform:uppercase; color:#0F766E; font-weight:800; display:block;">TOTAL KEMBALI DC</span>
          <span id="rt-global-tot-kembali" style="font-size:13px; font-weight:800; color:#0F766E;">0 Kont · 0 Stero · 0 Dus</span>
        </div>
        <button type="button" onclick="rtPrintDailyReport()"
          style="padding:8px 14px; border-radius:10px; border:1.5px solid rgba(99,102,241,0.3); background:rgba(99,102,241,0.08); color:#4C1D95; font-size:12px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all 0.2s;"
          onmouseover="this.style.background='rgba(99,102,241,0.15)'" onmouseout="this.style.background='rgba(99,102,241,0.08)'">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
          Cetak Rekap (Print)
        </button>
      </div>
    </div>
  `;
  listEl.appendChild(topBanner);

  // Cluster Cards Container
  const clusterListContainer = document.createElement('div');
  clusterListContainer.style.cssText = 'display:flex; flex-direction:column; gap:12px;';

  clusterKeys.forEach((gm, index) => {
    const item = rtClusterMap[gm];
    const outObj = item.outbound;
    const card = document.createElement('div');
    card.className = 'rt-cluster-card';
    card.setAttribute('data-gm', gm);
    card.style.cssText = 'border-radius:12px; border:1.5px solid rgba(13,148,136,0.2); background:#fff; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.02);';
    
    card.innerHTML = `
      <!-- Cluster Sub Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:linear-gradient(135deg,rgba(13,148,136,0.05),rgba(13,148,136,0.01)); border-bottom:1px solid rgba(13,148,136,0.1); flex-wrap:wrap; gap:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:11px; font-weight:800; color:#64748b; background:#F1F5F9; padding:2px 7px; border-radius:6px;">#${index + 1}</span>
          <span style="font-size:14px; font-weight:800; color:#0F766E; background:#E6FFFA; padding:4px 10px; border-radius:8px; border:1px solid #B2F5EA;">🚚 ${gm}</span>
          <span style="font-size:11px; font-weight:600; color:#64748b; background:#F1F5F9; padding:3px 8px; border-radius:6px;">RPS: <strong>${item.rps || '-'}</strong></span>
        </div>
        <div id="rt-selisih-${gm}">
          <span style="font-size:11px; font-weight:800; color:#94a3b8; background:#F1F5F9; border:1px solid #E2E8F0; padding:4px 10px; border-radius:20px;">— Belum diisi</span>
        </div>
      </div>

      <!-- Body Section: Side by Side on PC, Stacked on HP -->
      <div style="padding:12px; display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:12px;">
        
        <!-- 1. Outbound Dikirim (Loader) -->
        <div style="background:linear-gradient(135deg,rgba(109,40,217,0.05),rgba(109,40,217,0.01)); border:1.5px solid rgba(109,40,217,0.2); border-radius:10px; padding:10px 12px;">
          <div style="font-size:10px; font-weight:800; text-transform:uppercase; color:#6D28D9; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between;">
            <span>📦 OUTBOUND DIKIRIM</span>
            <span style="font-size:10px; color:#6D28D9;">TOT: <strong>${outObj.total}</strong></span>
          </div>
          <div style="display:flex; justify-content:space-around; align-items:center; background:#fff; padding:8px 6px; border-radius:8px; border:1px solid rgba(109,40,217,0.15);">
            <div style="text-align:center;">
              <div style="font-size:10px; font-weight:700; color:#6D28D9;">Kontainer</div>
              <div style="font-size:16px; font-weight:800; color:#6D28D9; margin-top:2px;">${outObj.kontainer}</div>
            </div>
            <div style="width:1px; height:24px; background:rgba(109,40,217,0.15);"></div>
            <div style="text-align:center;">
              <div style="font-size:10px; font-weight:700; color:#0284C7;">Sterofom</div>
              <div style="font-size:16px; font-weight:800; color:#0284C7; margin-top:2px;">${outObj.styrofoam}</div>
            </div>
            <div style="width:1px; height:24px; background:rgba(109,40,217,0.15);"></div>
            <div style="text-align:center;">
              <div style="font-size:10px; font-weight:700; color:#D97706;">Dus</div>
              <div style="font-size:16px; font-weight:800; color:#D97706; margin-top:2px;">${outObj.dus}</div>
            </div>
          </div>
        </div>

        <!-- 2. Kembali ke DC (Input Penerima Return) -->
        <div style="background:linear-gradient(135deg,rgba(13,148,136,0.06),rgba(13,148,136,0.01)); border:1.5px solid rgba(13,148,136,0.25); border-radius:10px; padding:10px 12px;">
          <div style="font-size:10px; font-weight:800; text-transform:uppercase; color:#0F766E; margin-bottom:8px; display:flex; align-items:center; gap:4px;">
            ↩️ RETUR TOKO (INPUT PENERIMA DC)
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px;">
            <div style="text-align:center;">
              <div style="font-size:9px; font-weight:800; color:#0F766E; margin-bottom:3px;">Kontainer</div>
              <input type="number" min="0" placeholder="0" class="rt-kembali-input-kont" data-gm="${gm}" data-out="${outObj.kontainer}" oninput="rtUpdateSelisih()"
                style="width:100%; padding:6px 4px; border-radius:6px; border:1.5px solid #0D9488; font-size:15px; font-weight:800; background:#fff; color:#0F766E; text-align:center; outline:none;"
                onfocus="this.style.borderColor='#059669';this.style.boxShadow='0 0 0 3px rgba(13,148,136,0.15)'" onblur="this.style.borderColor='#0D9488';this.style.boxShadow='none'">
            </div>
            <div style="text-align:center;">
              <div style="font-size:9px; font-weight:800; color:#0284C7; margin-bottom:3px;">Sterofom</div>
              <input type="number" min="0" placeholder="0" class="rt-kembali-input-stero" data-gm="${gm}" data-out="${outObj.styrofoam}" oninput="rtUpdateSelisih()"
                style="width:100%; padding:6px 4px; border-radius:6px; border:1.5px solid #0284C7; font-size:15px; font-weight:800; background:#fff; color:#0284C7; text-align:center; outline:none;"
                onfocus="this.style.borderColor='#0284C7';this.style.boxShadow='0 0 0 3px rgba(2,132,199,0.15)'" onblur="this.style.borderColor='#0284C7';this.style.boxShadow='none'">
            </div>
            <div style="text-align:center;">
              <div style="font-size:9px; font-weight:800; color:#D97706; margin-bottom:3px;">Dus</div>
              <input type="number" min="0" placeholder="0" class="rt-kembali-input-dus" data-gm="${gm}" data-out="${outObj.dus}" oninput="rtUpdateSelisih()"
                style="width:100%; padding:6px 4px; border-radius:6px; border:1.5px solid #D97706; font-size:15px; font-weight:800; background:#fff; color:#D97706; text-align:center; outline:none;"
                onfocus="this.style.borderColor='#D97706';this.style.boxShadow='0 0 0 3px rgba(217,119,6,0.15)'" onblur="this.style.borderColor='#D97706';this.style.boxShadow='none'">
            </div>
          </div>
        </div>

      </div>
    `;
    clusterListContainer.appendChild(card);
  });

  listEl.appendChild(clusterListContainer);
  rtUpdateSelisih();
}

function rtUpdateSelisih() {
  const clusterKeys = Object.keys(rtClusterMap || {});
  if (clusterKeys.length === 0) return;

  let totalRetK = 0, totalRetS = 0, totalRetD = 0;

  clusterKeys.forEach(gm => {
    const item = rtClusterMap[gm];
    const outObj = item.outbound;
    const card = document.querySelector(`.rt-cluster-card[data-gm="${gm}"]`);
    if (!card) return;

    const inpK = card.querySelector(`.rt-kembali-input-kont`);
    const inpS = card.querySelector(`.rt-kembali-input-stero`);
    const inpD = card.querySelector(`.rt-kembali-input-dus`);

    const retK = parseInt(inpK?.value) || 0;
    const retS = parseInt(inpS?.value) || 0;
    const retD = parseInt(inpD?.value) || 0;

    totalRetK += retK;
    totalRetS += retS;
    totalRetD += retD;

    const selK = outObj.kontainer - retK;
    const selS = outObj.styrofoam - retS;
    const selD = outObj.dus - retD;

    const selEl = document.getElementById(`rt-selisih-${gm}`);
    if (selEl) {
      const parts = [];
      if (selK !== 0) parts.push(`Kont: ${selK > 0 ? '−' + selK : '+' + Math.abs(selK)}`);
      if (selS !== 0) parts.push(`Stero: ${selS > 0 ? '−' + selS : '+' + Math.abs(selS)}`);
      if (selD !== 0) parts.push(`Dus: ${selD > 0 ? '−' + selD : '+' + Math.abs(selD)}`);

      if (parts.length === 0) {
        selEl.innerHTML = `<span style="font-size:11px;font-weight:800;color:#059669;background:#ECFDF5;border:1px solid #A7F3D0;padding:3px 8px;border-radius:20px;">✓ Sesuai</span>`;
      } else {
        selEl.innerHTML = `<span style="font-size:10px;font-weight:800;color:#D97706;background:#FEF3C7;border:1px solid #FDE68A;padding:3px 8px;border-radius:20px;">${parts.join(' | ')}</span>`;
      }
    }
  });

  const totKEl = document.getElementById('rt-global-tot-kembali');
  if (totKEl) {
    totKEl.textContent = `${totalRetK} Kont · ${totalRetS} Stero · ${totalRetD} Dus`;
  }
}

async function rtSubmitAll() {
  const tglReturn = document.getElementById('rt_tanggal_return')?.value;
  const tglRef    = document.getElementById('rt_tanggal_referensi')?.value;
  const catatan   = document.getElementById('rt_catatan')?.value || '';

  if (!tglReturn || !tglRef) { showToast('Pilih tanggal dulu.', 'error'); return; }
  const clusterKeys = Object.keys(rtClusterMap || {});
  if (clusterKeys.length === 0) { showToast('Tidak ada data.', 'error'); return; }
  const btn = document.getElementById('rtSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }

  try {
    const cro = {};
    let totRetItems = 0;
    let totOutItems = 0;
    const outBreakdown = { kontainer: 0, styrofoam: 0, dus: 0 };
    let primaryEntryId = null;

    clusterKeys.forEach(gm => {
      const item = rtClusterMap[gm];
      const outObj = item.outbound;
      const card = document.querySelector(`.rt-cluster-card[data-gm="${gm}"]`);
      if (!card) return;

      const inpK = card.querySelector(`.rt-kembali-input-kont`);
      const inpS = card.querySelector(`.rt-kembali-input-stero`);
      const inpD = card.querySelector(`.rt-kembali-input-dus`);

      const k = parseInt(inpK?.value) || 0;
      const s = parseInt(inpS?.value) || 0;
      const d = parseInt(inpD?.value) || 0;

      cro[gm] = { kontainer: k, styrofoam: s, dus: d };
      totRetItems += (k + s + d);

      outBreakdown.kontainer += outObj.kontainer;
      outBreakdown.styrofoam += outObj.styrofoam;
      outBreakdown.dus       += outObj.dus;

      if (!primaryEntryId && item.entries && item.entries[0]) {
        primaryEntryId = item.entries[0].id;
      }
    });

    totOutItems = outBreakdown.kontainer + outBreakdown.styrofoam + outBreakdown.dus;

    const r = await fetch('/api/return-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tanggal_return: tglReturn,
        tanggal_referensi: tglRef,
        loader_entry_id: primaryEntryId,
        no_polisi: 'RETUR TOKO',
        cluster_return_outputs: cro,
        outbound_breakdown: outBreakdown,
        total_outbound: totOutItems,
        total_kembali: totRetItems,
        total_selisih: totOutItems - totRetItems,
        catatan
      })
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Gagal'); }
    showToast('Entry Return berhasil dikirim!', 'info');
    document.getElementById('rt_catatan').value = '';
    document.getElementById('rtArmadaList').innerHTML = '';
    const emptyEl = document.getElementById('rtEmptyState');
    if (emptyEl) emptyEl.style.display = 'flex';
    rtLoaderEntriesCache = [];
    rtClusterMap = {};
  } catch(err) {
    showToast(err.message || 'Gagal.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Kirim Entry Return'; }
  }
}

function rtPrintDailyReport() {
  const clusterKeys = Object.keys(rtClusterMap || {}).sort();
  if (clusterKeys.length === 0) {
    showToast('Tidak ada data cluster untuk dicetak.', 'error');
    return;
  }

  const tglRef = document.getElementById('rt_tanggal_referensi')?.value || '-';
  const tglRet = document.getElementById('rt_tanggal_return')?.value || '-';
  const printTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  let grandOutK = 0, grandOutS = 0, grandOutD = 0;
  let grandRetK = 0, grandRetS = 0, grandRetD = 0;
  let grandRps = 0;

  const rowsHtml = clusterKeys.map((gm, i) => {
    const item = rtClusterMap[gm];
    const outObj = item.outbound;
    const rpsQty = item.rps || 0;
    grandRps += typeof rpsQty === 'number' ? rpsQty : (parseInt(rpsQty) || 0);

    const card = document.querySelector(`.rt-cluster-card[data-gm="${gm}"]`);
    const inpK = card ? card.querySelector(`.rt-kembali-input-kont`) : null;
    const inpS = card ? card.querySelector(`.rt-kembali-input-stero`) : null;
    const inpD = card ? card.querySelector(`.rt-kembali-input-dus`) : null;

    const retK = inpK ? (parseInt(inpK.value) || 0) : 0;
    const retS = inpS ? (parseInt(inpS.value) || 0) : 0;
    const retD = inpD ? (parseInt(inpD.value) || 0) : 0;

    const retTot = retK + retS + retD;

    grandOutK += outObj.kontainer;
    grandOutS += outObj.styrofoam;
    grandOutD += outObj.dus;

    grandRetK += retK;
    grandRetS += retS;
    grandRetD += retD;

    const selK = outObj.kontainer - retK;
    const selS = outObj.styrofoam - retS;
    const selD = outObj.dus - retD;

    const selParts = [];
    if (selK !== 0) selParts.push(`Kont: ${selK > 0 ? '−' + selK : '+' + Math.abs(selK)}`);
    if (selS !== 0) selParts.push(`Stero: ${selS > 0 ? '−' + selS : '+' + Math.abs(selS)}`);
    if (selD !== 0) selParts.push(`Dus: ${selD > 0 ? '−' + selD : '+' + Math.abs(selD)}`);

    const selLabel = selParts.length === 0 ? '✓ SESUAI' : selParts.join(', ');
    const selBg = selParts.length === 0 ? '#ECFDF5' : '#FEF3C7';
    const selColor = selParts.length === 0 ? '#047857' : '#B45309';

    return `
      <tr>
        <td style="text-align:center; font-weight:700; padding:6px 4px; border:1px solid #475569;">${i + 1}</td>
        <td style="font-weight:800; color:#1e293b; padding:6px 8px; border:1px solid #475569;">${gm}</td>
        <td style="text-align:center; color:#334155; padding:6px 4px; border:1px solid #475569; font-weight:700;">${rpsQty || '-'}</td>
        
        <!-- OUTBOUND -->
        <td style="text-align:center; font-weight:700; color:#4C1D95; padding:6px 4px; border:1px solid #475569;">${outObj.kontainer || '-'}</td>
        <td style="text-align:center; font-weight:700; color:#0284C7; padding:6px 4px; border:1px solid #475569;">${outObj.styrofoam || '-'}</td>
        <td style="text-align:center; font-weight:700; color:#D97706; padding:6px 4px; border:1px solid #475569;">${outObj.dus || '-'}</td>
        <td style="text-align:center; font-weight:800; color:#4C1D95; background:#EDE9FE; padding:6px 4px; border:1px solid #475569;">${outObj.total}</td>

        <!-- RETUR TOKO -->
        <td style="text-align:center; font-weight:700; color:#0F766E; padding:6px 4px; border:1px solid #475569;">${retK || '-'}</td>
        <td style="text-align:center; font-weight:700; color:#0284C7; padding:6px 4px; border:1px solid #475569;">${retS || '-'}</td>
        <td style="text-align:center; font-weight:700; color:#D97706; padding:6px 4px; border:1px solid #475569;">${retD || '-'}</td>
        <td style="text-align:center; font-weight:800; color:#0F766E; background:#CCFBF1; padding:6px 4px; border:1px solid #475569;">${retTot}</td>

        <!-- SELISIH -->
        <td style="text-align:center; font-weight:800; color:${selColor}; background:${selBg}; padding:6px 4px; border:1px solid #475569; font-size:10px;">${selLabel}</td>
      </tr>`;
  }).join('');

  const grandOutTot = grandOutK + grandOutS + grandOutD;
  const grandRetTot = grandRetK + grandRetS + grandRetD;

  const win = window.open('', '_blank', 'width=1050,height=850');
  win.document.write(`<!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Rekap Retur Toko - ${tglRef}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;}
      body{padding:16px;font-size:11px;color:#1e293b;background:#fff;}
      .hdr{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #1e293b;padding-bottom:8px;margin-bottom:12px;}
      .title-box{font-weight:900;font-size:14px;letter-spacing:0.5px;}
      table{width:100%;border-collapse:collapse;margin-bottom:16px;}
      th,td{border:1px solid #475569;padding:5px 6px;}
      th{font-size:10px;font-weight:800;text-transform:uppercase;}
      .ttd-container{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:24px;page-break-inside:avoid;}
      .ttd-box{border:1px solid #475569;border-radius:6px;padding:10px;text-align:center;}
      .ttd-title{font-size:10px;font-weight:800;text-transform:uppercase;color:#475569;margin-bottom:40px;}
      .ttd-name{border-top:1px solid #475569;padding-top:4px;font-weight:800;font-size:10px;}
      @media print{
        body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        .no-print{display:none!important;}
        @page{margin:8mm;size:A4 portrait;}
      }
    </style>
  </head>
  <body>
    <div class="hdr">
      <div>
        <div class="title-box">TANGGAL : ${tglRef.toUpperCase()} / KIRIM TGL : ${tglRet.toUpperCase()}</div>
      </div>
      <div style="font-size:10px;font-weight:700;color:#64748b;">
        CETAK: ${printTime}
      </div>
    </div>

    <table>
      <thead>
        <tr style="background:#F1F5F9;">
          <th rowspan="2" style="width:32px;text-align:center;">NO</th>
          <th rowspan="2" style="width:75px;text-align:left;">GRUP</th>
          <th rowspan="2" style="width:45px;text-align:center;">RPS</th>
          <th colspan="4" style="text-align:center;background:#EDE9FE;color:#5B21B6;">OUT BOUND</th>
          <th colspan="4" style="text-align:center;background:#CCFBF1;color:#0F766E;">RETUR TOKO</th>
          <th rowspan="2" style="width:110px;text-align:center;">SELISIH</th>
        </tr>
        <tr style="background:#F8FAFC;">
          <th style="text-align:center;font-size:9px;width:60px;">KONTAINER</th>
          <th style="text-align:center;font-size:9px;width:60px;">STEROFOM</th>
          <th style="text-align:center;font-size:9px;width:50px;">DOS</th>
          <th style="text-align:center;font-size:9px;width:50px;background:#DDD6FE;color:#4C1D95;">TOT</th>
          <th style="text-align:center;font-size:9px;width:60px;">KONTAINER</th>
          <th style="text-align:center;font-size:9px;width:60px;">STEROFOM</th>
          <th style="text-align:center;font-size:9px;width:50px;">DOS</th>
          <th style="text-align:center;font-size:9px;width:50px;background:#99F6E4;color:#0F766E;">TOT</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr style="background:#F1F5F9;font-weight:800;">
          <td colspan="2" style="text-align:center;padding:6px;font-size:11px;">TOTAL HARIAN</td>
          <td style="text-align:center;padding:6px;">${grandRps}</td>
          <td style="text-align:center;padding:6px;color:#4C1D95;">${grandOutK}</td>
          <td style="text-align:center;padding:6px;color:#0284C7;">${grandOutS}</td>
          <td style="text-align:center;padding:6px;color:#D97706;">${grandOutD}</td>
          <td style="text-align:center;padding:6px;background:#DDD6FE;color:#4C1D95;">${grandOutTot}</td>
          <td style="text-align:center;padding:6px;color:#0F766E;">${grandRetK}</td>
          <td style="text-align:center;padding:6px;color:#0284C7;">${grandRetS}</td>
          <td style="text-align:center;padding:6px;color:#D97706;">${grandRetD}</td>
          <td style="text-align:center;padding:6px;background:#99F6E4;color:#0F766E;">${grandRetTot}</td>
          <td style="text-align:center;padding:6px;font-size:10px;color:${grandOutTot - grandRetTot === 0 ? '#047857' : '#B45309'};">
            ${grandOutTot - grandRetTot === 0 ? '✓ SESUAI' : 'SELISIH: ' + (grandOutTot - grandRetTot)}
          </td>
        </tr>
      </tbody>
    </table>

    <div class="ttd-container">
      <div class="ttd-box">
        <div class="ttd-title">Diserahkan Oleh (Driver / Loader)</div>
        <div class="ttd-name">( ............................................ )</div>
      </div>
      <div class="ttd-box">
        <div class="ttd-title">Diterima Oleh (Return DC)</div>
        <div class="ttd-name">( ............................................ )</div>
      </div>
      <div class="ttd-box">
        <div class="ttd-title">Mengetahui (Supervisor / Admin)</div>
        <div class="ttd-name">( ............................................ )</div>
      </div>
    </div>

    <div class="no-print" style="margin-top:24px;text-align:center;">
      <button onclick="window.print()" style="background:#0D9488;color:#fff;border:none;padding:11px 28px;border-radius:10px;cursor:pointer;font-weight:800;font-size:14px;box-shadow:0 4px 12px rgba(13,148,136,0.3);margin-right:10px;">🖨️ Cetak Dokumen</button>
      <button onclick="window.close()" style="background:#F1F5F9;color:#475569;border:1px solid #CBD5E1;padding:11px 22px;border-radius:10px;cursor:pointer;font-weight:700;font-size:13px;">Tutup</button>
    </div>
    <script>
      window.onload = function() { window.print(); };
    </script>
  </body>
  </html>`);
  win.document.close();
}

function _doPrintHandover(entry) {
  let cl = [];
  if (Array.isArray(entry.clusters)) cl = entry.clusters;
  else if (entry.clusters && typeof entry.clusters === 'object') cl = entry.clusters.list || [];
  const ob = entry.cluster_outbound_outputs || {};
  const rpsMap = (entry.clusters && entry.clusters.outputs) ? entry.clusters.outputs : {};
  const totOut = Object.values(ob).reduce((a, b) => a + (parseInt(b) || 0), 0);

  const rows = cl.map((gm, i) => `
    <tr>
      <td style="text-align:center;font-weight:700;">${i + 1}</td>
      <td style="font-weight:800;color:#1e293b;">${gm}</td>
      <td style="text-align:center;color:#64748b;">${rpsMap[gm] || '-'}</td>
      <td style="text-align:center;font-weight:800;color:#5B21B6;background:#F5F3FF;">${ob[gm] || '-'}</td>
      <td style="text-align:center;font-weight:800;color:#5B21B6;background:#F5F3FF;">${ob[gm] || '-'}</td>
      <td style="text-align:center;"></td>
      <td style="text-align:center;"></td>
      <td style="text-align:center;"></td>
      <td style="text-align:center;"></td>
    </tr>`).join('');

  const printTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const win = window.open('', '_blank', 'width=950,height=750');

  win.document.write(`<!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Serah Terima Armada ${entry.no_polisi || ''}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;}
      body{padding:20px;font-size:11px;color:#1e293b;background:#fff;}
      .hdr{display:flex;align-items:center;justify-content:space-between;border-bottom:3px double #0D9488;padding-bottom:10px;margin-bottom:14px;}
      .hdr-logo{width:38px;height:38px;background:linear-gradient(135deg,#0D9488,#0F766E);border-radius:8px;color:#fff;font-weight:900;font-size:16px;display:flex;align-items:center;justify-content:center;}
      .hdr-title{font-size:15px;font-weight:900;color:#0F766E;text-transform:uppercase;letter-spacing:-0.2px;}
      .meta-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;background:#F8FAFC;border:1.5px solid #E2E8F0;border-radius:10px;padding:10px;}
      .meta-lbl{font-size:9px;font-weight:800;text-transform:uppercase;color:#64748b;}
      .meta-val{font-size:13px;font-weight:800;margin-top:2px;}
      table{width:100%;border-collapse:collapse;font-size:10px;}
      th{padding:7px 4px;text-align:center;font-size:9px;text-transform:uppercase;font-weight:800;}
      th.bk{background:#1E293B;color:#fff;}
      th.out{background:#5B21B6;color:#fff;}
      th.ret{background:#0F766E;color:#fff;}
      td{border:1px solid #CBD5E1;padding:5px;}
      tr:nth-child(even) td{background:#F8FAFC;}
      .ttd{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:24px;page-break-inside:avoid;}
      .ttd-box{border:1.5px solid #CBD5E1;border-radius:8px;padding:10px;text-align:center;}
      .ttd-sp{height:46px;}
      @media print{
        body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        .no-print{display:none!important;}
        @page{margin:8mm;size:A4 landscape;}
      }
    </style>
  </head>
  <body>
    <div class="hdr">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="hdr-logo">SS</div>
        <div>
          <div class="hdr-title">FORM SERAH TERIMA KONTAINER ARMADA</div>
          <div style="font-size:10px;color:#64748b;">SS08 Logistics Management System</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:9px;color:#64748b;font-weight:700;">WAKTU CETAK</div>
        <div style="font-size:11px;font-weight:800;">${printTime}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div><div class="meta-lbl">Tanggal Carian</div><div class="meta-val">${entry.tanggal_carian || '—'}</div></div>
      <div><div class="meta-lbl">Tanggal Kirim</div><div class="meta-val">${entry.tanggal_kirim || '—'}</div></div>
      <div><div class="meta-lbl">No. Polisi</div><div class="meta-val" style="color:#0D9488;">${entry.no_polisi || '—'}</div></div>
      <div><div class="meta-lbl">Loader</div><div class="meta-val">${entry.nama || '—'}</div></div>
      <div><div class="meta-lbl">Total Outbound</div><div class="meta-val" style="color:#6D28D9;">${totOut} kont</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="bk" rowspan="2" style="width:30px;">No</th>
          <th class="bk" rowspan="2">Grup Cluster</th>
          <th class="out" colspan="3">OUTBOUND - LOADER</th>
          <th class="ret" colspan="4">KEMBALI KE DC - RETURN TEAM</th>
        </tr>
        <tr>
          <th class="out" style="width:60px;">RPS</th>
          <th class="out" style="width:80px;">OUTBOUND</th>
          <th class="out" style="width:70px;">TOT</th>
          <th class="ret" style="width:80px;">KONTAINER</th>
          <th class="ret" style="width:60px;">DOS</th>
          <th class="ret" style="width:70px;">TOT</th>
          <th class="ret" style="width:80px;">SELISIH</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr style="background:#F1F5F9;font-weight:800;">
          <td colspan="2" style="text-align:right;padding-right:8px;">TOTAL HASIL:</td>
          <td style="text-align:center;">-</td>
          <td style="text-align:center;color:#5B21B6;">${totOut}</td>
          <td style="text-align:center;color:#5B21B6;">${totOut}</td>
          <td></td><td></td><td></td><td></td>
        </tr>
      </tbody>
    </table>

    <div class="ttd">
      <div class="ttd-box">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#475569;">Team Outbound / Loader</div>
        <div class="ttd-sp"></div>
        <div style="border-top:1px solid #475569;display:inline-block;min-width:140px;font-size:11px;font-weight:800;padding-top:4px;">${entry.nama || ''}</div>
      </div>
      <div class="ttd-box">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#475569;">Team Return / Penerima DC</div>
        <div class="ttd-sp"></div>
        <div style="border-top:1px solid #475569;display:inline-block;min-width:140px;font-size:11px;font-weight:800;padding-top:4px;">Penerima DC</div>
      </div>
    </div>

    <div class="no-print" style="margin-top:20px;text-align:center;">
      <button onclick="window.print()" style="background:#0D9488;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-weight:800;font-size:13px;margin-right:8px;">🖨️ Print Form</button>
      <button onclick="window.close()" style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;">Tutup</button>
    </div>
  </body>
  </html>`);
  win.document.close();
}

function openFormTab() {
  const pos = (currentUser && currentUser.posisi) ? currentUser.posisi.toLowerCase() : '';
  const pages = (currentUser && currentUser.allowed_pages) ? currentUser.allowed_pages : [];
  const isQco = pos === 'qc outbound' || pos === 'qc-outbound' || pages.includes('qc-outbound');
  if (pos === 'return') {
    switchTab('return');
  } else if (isQco) {
    switchTab('qc-outbound');
  } else if (pos === 'loader') {
    switchTab('loader');
  } else {
    switchTab('picker');
  }
}

window.openFormTab = openFormTab;
window.rtLoadLoaderEntries = rtLoadLoaderEntries;
window.rtUpdateSelisih = rtUpdateSelisih;
window.rtSubmitAll = rtSubmitAll;
window.rtPrintGroupedHandover = rtPrintGroupedHandover;
window.rtPrintHandover = rtPrintHandover;
window.rtPrintDailyReport = rtPrintDailyReport;
window.printLoaderEntryDirect = printLoaderEntryDirect;

// ===================== QC OUTBOUND =====================

let qcoSelectedFiles = [];
let qcoTargetRpsCache = {};

function qcoUpdateTotal() {
  const k = parseInt(document.getElementById('qco_kontainer')?.value) || 0;
  const s = parseInt(document.getElementById('qco_styrofoam')?.value) || 0;
  const d = parseInt(document.getElementById('qco_dus')?.value) || 0;
  const g = parseInt(document.getElementById('qco_gacoan')?.value) || 0;
  const dk = parseInt(document.getElementById('qco_dikichi')?.value) || 0;
  const bf = parseInt(document.getElementById('qco_benfarm')?.value) || 0;
  const el = document.getElementById('qcoTotalItems');
  if (el) el.textContent = k + s + d + g + dk + bf;
}

async function qcoLoadArmada() {
  const tanggal = document.getElementById('qco_tanggal_carian')?.value || document.getElementById('qco_tanggal_kirim')?.value;
  const select = document.getElementById('qco_nopol_select');
  const info = document.getElementById('qco_armada_info');
  if (!tanggal || !select) return;

  try {
    const res = await fetch(`/api/qc-outbound/loader-armada?tanggal=${tanggal}`);
    if (!res.ok) { select.style.display = 'none'; return; }
    const data = await res.json();
    const armadaList = data.data || [];

    if (armadaList.length === 0) {
      select.style.display = 'none';
      if (info) { info.style.display = 'none'; }
      return;
    }

    select.innerHTML = '<option value="">-- Pilih dari daftar armada --</option>';
    armadaList.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.no_polisi;
      opt.textContent = `${a.no_polisi} — ${a.nama || ''} ${a.sudah_ada_qc ? '✅ Sudah di-QC' : ''}`;
      if (a.sudah_ada_qc) opt.style.color = '#10B981';
      select.appendChild(opt);
    });
    select.style.display = 'block';
  } catch(e) {
    select.style.display = 'none';
  }
}

function qcoSelectNopol(val) {
  const input = document.getElementById('qco_nopol');
  const info = document.getElementById('qco_armada_info');
  if (input && val) {
    input.value = val;
    if (info) {
      info.textContent = `Armada ${val} dipilih dari daftar loader entries`;
      info.style.display = 'block';
    }
    qcoOnDateOrArmadaChange();
  }
}

async function qcoOnDateOrArmadaChange() {
  qcoLoadArmada();
  const tanggal = document.getElementById('qco_tanggal_carian')?.value;
  const nopol = document.getElementById('qco_nopol')?.value?.trim();
  const loading = document.getElementById('qcoRpsLoading');
  const empty = document.getElementById('qcoRpsEmpty');
  const container = document.getElementById('qcoRpsContainer');
  if (!container) return;

  // Auto-fill nama QC Inspector jika ada user login
  const nameEl = document.getElementById('qco_nama_qc');
  if (nameEl && currentUser) {
    nameEl.value = currentUser.nama_lengkap || currentUser.username || '';
  }

  if (!tanggal) {
    if (empty) {
      empty.textContent = 'Pilih Tanggal Carian di atas untuk menampilkan acuan Target RPS.';
      empty.style.display = 'block';
    }
    if (container) container.style.display = 'none';
    if (loading) loading.style.display = 'none';
    return;
  }

  if (loading) loading.style.display = 'flex';
  if (empty) empty.style.display = 'none';
  if (container) container.style.display = 'none';

  try {
    // Fetch data carian dan loader entries secara paralel
    const [resCarian, resLoader] = await Promise.all([
      fetch(`/api/data-carian?tanggal=${tanggal}`).catch(() => null),
      fetch(`/api/loader-entries?tanggal_carian=${tanggal}`).catch(() => null)
    ]);

    let carianRecords = [];
    if (resCarian && resCarian.ok) {
      carianRecords = await resCarian.json();
    }
    let loaderEntries = [];
    if (resLoader && resLoader.ok) {
      const dataL = await resLoader.json();
      loaderEntries = Array.isArray(dataL) ? dataL : (dataL.entries || []);
    }

    qcoTargetRpsCache = {};

    // 1. Dari Data Carian
    if (Array.isArray(carianRecords)) {
      carianRecords.forEach(rec => {
        const gm = String(rec.batch || '').trim();
        const cap = parseInt(rec.total_output || rec.capacity || rec.target) || 0;
        if (gm && cap > 0) {
          qcoTargetRpsCache[gm] = (qcoTargetRpsCache[gm] || 0) + cap;
        }
      });
    }

    // 2. Dari Loader Entries (jika ada)
    if (Array.isArray(loaderEntries)) {
      loaderEntries.forEach(entry => {
        if (!nopol || (entry.no_polisi && entry.no_polisi.trim().toUpperCase() === nopol.toUpperCase())) {
          const outputs = (entry.clusters && entry.clusters.outputs) ? entry.clusters.outputs : (entry.cluster_outputs || {});
          Object.entries(outputs).forEach(([cluster, rpsVal]) => {
            const val = parseInt(rpsVal) || 0;
            if (val > 0) {
              qcoTargetRpsCache[cluster] = Math.max(qcoTargetRpsCache[cluster] || 0, val);
            }
          });
        }
      });
    }

    const clusters = Object.keys(qcoTargetRpsCache).sort();

    if (clusters.length === 0) {
      if (loading) loading.style.display = 'none';
      if (empty) {
        empty.textContent = `Belum ada data carian / RPS terdata untuk tanggal carian ${tanggal}.`;
        empty.style.display = 'block';
      }
      return;
    }

    let totalRpsAll = 0;
    let html = `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:10px;">`;
    clusters.forEach(c => {
      const rps = qcoTargetRpsCache[c];
      totalRpsAll += rps;
      html += `
        <div style="background:linear-gradient(135deg, rgba(14,165,233,0.08), rgba(2,132,199,0.03)); border:1.5px solid rgba(14,165,233,0.25); border-radius:10px; padding:10px 12px; text-align:center;">
          <div style="font-size:11px; font-weight:800; color:#0369A1; margin-bottom:4px;">🚚 ${c}</div>
          <div style="font-size:18px; font-weight:900; color:#0284C7;">${rps} <span style="font-size:11px; font-weight:600; color:#64748B;">RPS</span></div>
          <div style="font-size:9px; color:#0284C7; margin-top:2px; font-weight:700;">READ-ONLY ACUAN</div>
        </div>`;
    });
    html += `</div>`;
    html += `
      <div style="margin-top:12px; padding:8px 12px; background:rgba(14,165,233,0.1); border-radius:8px; font-size:12px; font-weight:800; color:#0369A1; display:flex; justify-content:space-between; align-items:center;">
        <span>TOTAL TARGET RPS ACUAN (${clusters.length} Cluster)</span>
        <span style="font-size:15px; color:#0284C7;">${totalRpsAll} RPS</span>
      </div>`;

    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = 'none';
    container.innerHTML = html;
    container.style.display = 'block';

  } catch(e) {
    console.error('qcoOnDateOrArmadaChange error:', e);
    if (loading) loading.style.display = 'none';
    if (empty) {
      empty.textContent = 'Belum ada data carian / RPS terdata untuk tanggal ini.';
      empty.style.display = 'block';
    }
  }
}

// ── PHOTO HANDLING ──
function qcoHandleFileSelect(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  if (qcoSelectedFiles.length + files.length > 5) {
    showToast('Maksimum 5 foto yang dapat diunggah.', 'error');
    return;
  }

  files.forEach(file => {
    if (file.type.startsWith('image/')) {
      qcoSelectedFiles.push(file);
    }
  });

  qcoRenderPhotoPreview();
  event.target.value = '';
}

function qcoRemoveFile(index) {
  qcoSelectedFiles.splice(index, 1);
  qcoRenderPhotoPreview();
}

function qcoRenderPhotoPreview() {
  const infoEl = document.getElementById('qcoPhotoInfo');
  const countText = document.getElementById('qcoPhotoCountText');
  const gridEl = document.getElementById('qcoFileList');
  if (!gridEl) return;

  gridEl.innerHTML = '';
  if (qcoSelectedFiles.length === 0) {
    if (infoEl) infoEl.style.display = 'none';
    return;
  }

  if (infoEl) infoEl.style.display = 'flex';
  if (countText) countText.textContent = `${qcoSelectedFiles.length} foto dipilih`;

  qcoSelectedFiles.forEach((file, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'ld-photo-thumb';
    thumb.style.cssText = 'position:relative; width:80px; height:80px; border-radius:10px; overflow:hidden; border:2px solid #7C3AED; box-shadow:0 2px 8px rgba(124,58,237,0.15);';

    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.style.cssText = 'width:100%; height:100%; object-fit:cover;';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.innerHTML = '✕';
    removeBtn.style.cssText = 'position:absolute; top:4px; right:4px; width:20px; height:20px; border-radius:50%; background:rgba(239,68,68,0.9); color:#fff; border:none; font-size:11px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center;';
    removeBtn.onclick = () => qcoRemoveFile(index);

    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    gridEl.appendChild(thumb);
  });
}

// ── SUBMIT FORM ──
async function qcoSubmitForm() {
  const tanggal_carian = document.getElementById('qco_tanggal_carian')?.value;
  const tanggal_kirim = document.getElementById('qco_tanggal_kirim')?.value;
  const no_polisi = document.getElementById('qco_nopol')?.value?.trim();
  const nama_qc = document.getElementById('qco_nama_qc')?.value || currentUser?.nama_lengkap || currentUser?.username || '';
  const kontainer = parseInt(document.getElementById('qco_kontainer')?.value) || 0;
  const styrofoam = parseInt(document.getElementById('qco_styrofoam')?.value) || 0;
  const dus = parseInt(document.getElementById('qco_dus')?.value) || 0;
  const gacoan = parseInt(document.getElementById('qco_gacoan')?.value) || 0;
  const dikichi = parseInt(document.getElementById('qco_dikichi')?.value) || 0;
  const benfarm = parseInt(document.getElementById('qco_benfarm')?.value) || 0;
  const catatan = document.getElementById('qco_catatan')?.value || '';

  let hasError = false;
  const errCar = document.getElementById('err-qco_tanggal_carian');
  const errKir = document.getElementById('err-qco_tanggal_kirim');
  const errNopol = document.getElementById('err-qco_nopol');
  if (errCar) errCar.style.display = 'none';
  if (errKir) errKir.style.display = 'none';
  if (errNopol) errNopol.style.display = 'none';

  if (!tanggal_carian) { if (errCar) errCar.style.display = 'flex'; hasError = true; }
  if (!tanggal_kirim) { if (errKir) errKir.style.display = 'flex'; hasError = true; }
  if (!no_polisi) { if (errNopol) errNopol.style.display = 'flex'; hasError = true; }
  if (hasError) return;

  if (kontainer + styrofoam + dus + gacoan + dikichi + benfarm === 0) {
    showToast('Minimal satu item harus diisi (kontainer, styrofoam, dus, atau non-group).', 'error');
    return;
  }

  const btn = document.getElementById('qcoSubmitBtn');
  if (btn) { btn.disabled = true; const sp = btn.querySelector('.spinner'); if (sp) sp.style.display = 'block'; }

  try {
    const formData = new FormData();
    formData.append('tanggal_carian', tanggal_carian);
    formData.append('tanggal_kirim', tanggal_kirim);
    formData.append('tanggal', tanggal_carian); // Fallback
    formData.append('no_polisi', no_polisi);
    formData.append('nama_qc', nama_qc);
    formData.append('kontainer', kontainer);
    formData.append('styrofoam', styrofoam);
    formData.append('dus', dus);
    formData.append('non_group', JSON.stringify({ gacoan, dikichi, benfarm }));
    formData.append('target_rps_info', JSON.stringify(qcoTargetRpsCache || {}));
    formData.append('catatan', catatan);

    qcoSelectedFiles.forEach(file => {
      formData.append('foto_outbound', file);
    });

    const res = await fetch('/api/qc-outbound', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();
    if (!res.ok) {
      showToast(result.error || 'Gagal menyimpan data.', 'error');
    } else {
      showToast('✅ Data QC Outbound berhasil disimpan!', 'success');
      qcoClearForm();
      const filterTgl = document.getElementById('qcoFilterTanggal');
      if (filterTgl) filterTgl.value = tanggal_carian;
      qcoLoadRiwayat();
    }
  } catch(e) {
    showToast('Terjadi kesalahan koneksi. Coba lagi.', 'error');
  } finally {
    if (btn) { btn.disabled = false; const sp = btn.querySelector('.spinner'); if (sp) sp.style.display = 'none'; }
  }
}

function qcoClearForm() {
  const todayStr = new Date().toLocaleDateString('sv-SE');
  const tglCar = document.getElementById('qco_tanggal_carian');
  if (tglCar) tglCar.value = todayStr;
  const tglKir = document.getElementById('qco_tanggal_kirim');
  if (tglKir) tglKir.value = todayStr;

  const nopol = document.getElementById('qco_nopol');
  if (nopol) nopol.value = '';
  const select = document.getElementById('qco_nopol_select');
  if (select) select.value = '';
  const info = document.getElementById('qco_armada_info');
  if (info) { info.style.display = 'none'; info.textContent = ''; }

  document.getElementById('qco_kontainer').value = 0;
  document.getElementById('qco_styrofoam').value = 0;
  document.getElementById('qco_dus').value = 0;
  document.getElementById('qco_gacoan').value = 0;
  document.getElementById('qco_dikichi').value = 0;
  document.getElementById('qco_benfarm').value = 0;
  document.getElementById('qco_catatan').value = '';

  qcoSelectedFiles = [];
  qcoRenderPhotoPreview();
  qcoUpdateTotal();
  qcoOnDateOrArmadaChange();
}

async function qcoLoadRiwayat() {
  const tanggal = document.getElementById('qcoFilterTanggal')?.value;
  const container = document.getElementById('qcoRiwayatContainer');
  if (!container) return;

  if (!tanggal) {
    container.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted,#9CA3AF); font-size:13px;">Pilih tanggal untuk melihat riwayat.</div>';
    return;
  }

  container.innerHTML = '<div style="text-align:center; padding:24px; font-size:13px; color:#7C3AED;">⏳ Memuat data...</div>';

  try {
    const res = await fetch(`/api/qc-outbound?tanggal=${tanggal}`);
    const result = await res.json();
    const data = result.data || [];

    if (data.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-muted,#9CA3AF); font-size:13px;">Belum ada data QC Outbound untuk tanggal <strong>${tanggal}</strong>.</div>`;
      return;
    }

    let html = `
      <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="background:linear-gradient(135deg,#7C3AED,#5B21B6); color:#fff;">
            <th style="padding:10px 12px; text-align:center; border-radius:8px 0 0 0;">No.</th>
            <th style="padding:10px 12px; text-align:left;">No. Polisi / QC</th>
            <th style="padding:10px 12px; text-align:center;">📦 Kontainer</th>
            <th style="padding:10px 12px; text-align:center;">🧊 Styrofoam</th>
            <th style="padding:10px 12px; text-align:center;">📫 Dus</th>
            <th style="padding:10px 12px; text-align:center;">Non-Group</th>
            <th style="padding:10px 12px; text-align:center;">Total</th>
            <th style="padding:10px 12px; text-align:left;">Catatan</th>
            <th style="padding:10px 12px; text-align:center;">Foto</th>
            <th style="padding:10px 12px; text-align:center; border-radius:0 8px 0 0;">Aksi</th>
          </tr>
        </thead>
        <tbody>`;

    data.forEach((e, i) => {
      const ng = e.non_group || {};
      const totNg = (ng.gacoan || 0) + (ng.dikichi || 0) + (ng.benfarm || 0);
      const total = (e.kontainer || 0) + (e.styrofoam || 0) + (e.dus || 0) + totNg;
      const waktu = e.created_at ? new Date(e.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
      const bg = i % 2 === 0 ? 'var(--card-bg,#fff)' : 'rgba(124,58,237,0.03)';
      
      const files = e.files || [];
      let filesHtml = '-';
      if (files.length > 0) {
        filesHtml = files.map(f => `<a href="${f.file_path}" target="_blank" style="color:#7C3AED; font-weight:700; text-decoration:underline;">📷 ${files.length} Foto</a>`).join('<br>');
      }

      html += `
        <tr style="background:${bg}; border-bottom:1px solid rgba(124,58,237,0.07);">
          <td style="padding:10px 12px; text-align:center; color:#9CA3AF;">${i+1}</td>
          <td style="padding:10px 12px;">
            <div style="font-weight:700; color:#7C3AED;">${e.no_polisi || '-'}</div>
            <div style="font-size:11px; color:#64748B;">QC: ${e.nama_qc || e.created_by || '-'} ${e.zona ? '· ' + e.zona : ''}</div>
          </td>
          <td style="padding:10px 12px; text-align:center; font-weight:600;">${e.kontainer || 0}</td>
          <td style="padding:10px 12px; text-align:center; font-weight:600; color:#0284C7;">${e.styrofoam || 0}</td>
          <td style="padding:10px 12px; text-align:center; font-weight:600; color:#D97706;">${e.dus || 0}</td>
          <td style="padding:10px 12px; text-align:center; font-size:11px; color:#475569;">G:${ng.gacoan||0} D:${ng.dikichi||0} B:${ng.benfarm||0}</td>
          <td style="padding:10px 12px; text-align:center; font-weight:700; color:#5B21B6;">${total}</td>
          <td style="padding:10px 12px; color:var(--text-muted,#6B7280); font-size:12px;">${e.catatan || '-'}</td>
          <td style="padding:10px 12px; text-align:center; font-size:11px;">${filesHtml}</td>
          <td style="padding:10px 12px; text-align:center;">
            <button onclick="qcoDeleteEntry('${e.id}', '${e.no_polisi}')" style="background:rgba(239,68,68,0.1); color:#DC2626; border:1px solid rgba(239,68,68,0.2); border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer; font-weight:600;">Hapus</button>
          </td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div style="text-align:center; padding:24px; color:#DC2626; font-size:13px;">Gagal memuat data. Coba lagi.</div>';
  }
}

async function qcoDeleteEntry(id, nopol) {
  if (!confirm(`Hapus data QC Outbound untuk armada ${nopol}?`)) return;
  try {
    const res = await fetch(`/api/qc-outbound/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Data berhasil dihapus.', 'success');
      qcoLoadRiwayat();
    } else {
      const err = await res.json();
      showToast(err.error || 'Gagal menghapus.', 'error');
    }
  } catch(e) {
    showToast('Terjadi kesalahan.', 'error');
  }
}

window.qcoUpdateTotal = qcoUpdateTotal;
window.qcoLoadArmada = qcoLoadArmada;
window.qcoSelectNopol = qcoSelectNopol;
window.qcoOnDateOrArmadaChange = qcoOnDateOrArmadaChange;
window.qcoHandleFileSelect = qcoHandleFileSelect;
window.qcoRemoveFile = qcoRemoveFile;
window.qcoSubmitForm = qcoSubmitForm;
window.qcoClearForm = qcoClearForm;
window.qcoLoadRiwayat = qcoLoadRiwayat;
window.qcoDeleteEntry = qcoDeleteEntry;

// ===================== END QC OUTBOUND =====================

