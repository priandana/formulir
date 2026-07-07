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

  window.onerror = function(message, source, lineno, colno, error) {
    showOnscreenError(`Global Window (${lineno}:${colno})`, error || new Error(message));
    return false;
  };

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

  // ============= STATE =============
  let allSubmissions = [];
  let filteredSubmissions = [];
  let currentPage = 1;
  const PAGE_SIZE = 15;
  let currentUser = { username: '', allowed_pages: [] };
  let currentView = 'dashboard';

  let allDataCarian = [];
  let filteredDataCarian = [];
  let importSelectedFile = null;

  function applySidebarPermissions() {
    const isSuperAdmin = currentUser.username && currentUser.username.toLowerCase() === 'admin';
    const allowed = currentUser.allowed_pages || [];

    // All pages that can be protected
    const pages = [
      'dashboard', 'submissions', 'loader', 'data-carian', 'rekap-toko',
      'status-carian', 'users', 'absensi', 'ketentuan-harga', 'rekap-pendapatan', 'announcements',
      'export', 'gsheets', 'login-settings', 'admin-accounts',
      'audit-logs'
    ];

    pages.forEach(p => {
      const nav = document.getElementById('nav-' + p);
      if (nav) {
        const hasAccess = isSuperAdmin || allowed.includes(p);
        nav.style.display = hasAccess ? 'flex' : 'none';
      }
    });

    // Submenu groups
    document.querySelectorAll('.nav-group').forEach(group => {
      const items = group.querySelectorAll('.nav-item');
      let visibleCount = 0;
      items.forEach(item => {
        if (item.style.display !== 'none') visibleCount++;
      });
      group.style.display = visibleCount > 0 ? 'block' : 'none';
    });
    
    // Settings group title hide if no access to sub-items
    const settingsTitle = document.getElementById('nav-login-settings') ? document.getElementById('nav-login-settings').parentNode.previousElementSibling : null;
    if (settingsTitle && settingsTitle.classList.contains('nav-section-title')) {
      const showSettingsTitle = isSuperAdmin || allowed.includes('login-settings') || allowed.includes('admin-accounts') || allowed.includes('audit-logs');
      settingsTitle.style.display = showSettingsTitle ? 'block' : 'none';
    }
  }

  // ============= INIT =============
  (async () => {
    const auth = await fetch('/api/check-auth').then(r => r.json());
    if (!auth.authenticated) { window.location.href = '/login'; return; }
    if (auth.role === 'operasional') { window.location.href = '/'; return; }
    currentUser = {
      username: auth.username,
      allowed_pages: auth.allowed_pages || []
    };
    document.getElementById('userName').textContent = auth.nama_lengkap || auth.username;
    document.getElementById('userAvatar').textContent = (auth.nama_lengkap || auth.username).charAt(0).toUpperCase();
    applySidebarPermissions();
    // Set today's date as default for filters
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('dcDateFilter').value = today;
    document.getElementById('importTanggal').value = today;
    document.getElementById('acTanggal').value = today;
    document.getElementById('loaderDateFilter').value = today;
    // Set date picker for Monitoring MPP
    const mppPicker = document.getElementById('mppDatePicker');
    if (mppPicker) mppPicker.value = today;
    // Load core data (submissions)
    try { await loadData(); } catch(e) { console.error('loadData init:', e); }
    initTheme();
    initRealtimeNotifications();
    initCustomSelects();
    // Tampilkan dashboard atau halaman pertama yang diizinkan
    const isSuperAdmin = currentUser.username && currentUser.username.toLowerCase() === 'admin';
    const allowed = currentUser.allowed_pages || [];
    if (isSuperAdmin || allowed.includes('dashboard')) {
      showPage('dashboard');
    } else if (allowed.length > 0) {
      showPage(allowed[0]);
    } else {
      showPage('feature-guide');
    }
  })();



  // ============= ANIMATION HELPERS =============
  function animateValue(id, end, duration = 800) {
    const obj = document.getElementById(id);
    if (!obj) return;
    const currentText = obj.textContent.replace(/[^\d]/g, '');
    const startVal = parseInt(currentText) || 0;
    const endVal = parseInt(end) || 0;
    if (startVal === endVal) {
      obj.textContent = endVal.toLocaleString('id-ID');
      return;
    }
    const range = endVal - startVal;
    const startTime = performance.now();
    
    function update(currentTime) {
      const elapsed = currentTime - startTime;
      if (elapsed >= duration) {
        obj.textContent = endVal.toLocaleString('id-ID');
        return;
      }
      const progress = elapsed / duration;
      const easeProgress = progress * (2 - progress); // quadratic ease-out
      const currentVal = Math.round(startVal + range * easeProgress);
      obj.textContent = currentVal.toLocaleString('id-ID');
      requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  async function loadData() {
    try {
      // Fetch data paralel: semua submissions (top-1000) + SEMUA pending (tanpa batas)
      const [submissions, stats, pendingCountRes, pendingSubmissions] = await Promise.all([
        fetch('/api/submissions').then(r => r.json()),
        fetch('/api/stats').then(r => r.json()),
        fetch('/api/submissions/pending-count').then(r => r.json()).catch(() => ({ count: 0 })),
        fetch('/api/submissions?status=pending').then(r => r.json()).catch(() => [])
      ]);
      allSubmissions = Array.isArray(submissions) ? submissions : [];
      // Merge pending submissions yang mungkin tidak ada di top-1000
      if (Array.isArray(pendingSubmissions) && pendingSubmissions.length > 0) {
        const existingIds = new Set(allSubmissions.map(s => s.id));
        for (const ps of pendingSubmissions) {
          if (!existingIds.has(ps.id)) {
            allSubmissions.push(ps);
          }
        }
      }
      // Normalize status: null/undefined → 'approved' agar konsisten
      allSubmissions = allSubmissions.map(s => ({ ...s, status: s.status || 'approved' }));
      filteredSubmissions = [...allSubmissions];

      const total = stats && stats.total ? stats.total : 0;
      const today = stats && stats.today ? stats.today : 0;
      const byPosisi = stats && Array.isArray(stats.byPosisi) ? stats.byPosisi : [];

      animateValue('stat-total', total);
      animateValue('stat-today', today);
      const pickerCount = (byPosisi.find(p => p.posisi === 'Picker') || {count: 0}).count || 0;
      const otherCount = total - pickerCount;
      animateValue('stat-picker', pickerCount);
      animateValue('stat-other', otherCount);

      // Update pending badge & banner
      const pendingCount = pendingCountRes && pendingCountRes.count ? pendingCountRes.count : 0;
      const pendingBadge = document.getElementById('nav-submissions-pending');
      if (pendingBadge) {
        if (pendingCount > 0) {
          pendingBadge.textContent = pendingCount;
          pendingBadge.style.display = 'inline-flex';
        } else {
          pendingBadge.style.display = 'none';
        }
      }

      const banner = document.getElementById('pendingAlertBanner');
      const bannerTitle = document.getElementById('pendingAlertTitle');
      if (banner && bannerTitle) {
        if (pendingCount > 0) {
          bannerTitle.textContent = `Ada ${pendingCount} submission menunggu validasi`;
          banner.style.display = 'flex';
        } else {
          banner.style.display = 'none';
        }
      }

      renderRecentTable();
      populateFilterDropdowns();
      // Re-apply filter aktif setelah data di-reload (bukan langsung renderAllTable)
      filterTable();
    } catch(err) {

      console.error('loadData error:', err);
      showToast('Gagal memuat data.', 'error');
    }
  }

  // ============= FORMAT HELPERS =============
  function formatDate(dt) {
    if (!dt) return '-';
    return new Date(dt).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
  }
  function formatDateTime(dt) {
    if (!dt) return '-';
    return new Date(dt).toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function posisiBadge(pos) {
    const cls = pos === 'Picker' ? 'badge-picker' : pos === 'Sorter' ? 'badge-sorter' : 'badge-loader';
    return `<span class="badge ${cls}">${pos}</span>`;
  }

  // ============= RECENT TABLE (DASHBOARD) =============
  function renderRecentTable() {
    const recent = allSubmissions.slice(0, 10);
    const tbody = document.getElementById('recentTableBody');
    if (!tbody) return; // Dashboard baru tidak punya recentTableBody
    if (!recent.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📋</div><h3>Belum ada data</h3><p>Data akan muncul setelah ada submission masuk</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = recent.map((s, idx) => `
      <tr style="animation-delay: ${idx * 0.04}s">
        <td class="text-main">${s.nama}</td>
        <td>${posisiBadge(s.posisi)}</td>
        <td>${s.tipe_lokasi}</td>
        <td>${s.zona}</td>
        <td class="text-main">${s.jumlah_output.toLocaleString('id-ID')}</td>
        <td>${formatDateTime(s.created_at)}</td>
        <td>
          <div class="action-btns">
            <button class="btn-icon btn-view" onclick="viewDetail('${s.id}')" title="Lihat detail">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="btn-icon btn-del" onclick="deleteSubmission('${s.id}')" title="Hapus">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // ============= ALL SUBMISSIONS TABLE =============
  function renderAllTable() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const page = filteredSubmissions.slice(start, end);
    const tbody = document.getElementById('allTableBody');
    if (!filteredSubmissions.length) {
      const isFiltered = allSubmissions.length > 0;
      tbody.innerHTML = isFiltered
        ? `<tr><td colspan="12"><div class="empty-state"><div class="empty-icon">🔍</div><h3>Tidak ada data yang cocok</h3><p>Filter aktif tidak menemukan data. Coba ubah atau <a href="#" onclick="resetAllFilters(); return false;" style="color:var(--primary); text-decoration:underline;">reset filter</a>.</p></div></td></tr>`
        : `<tr><td colspan="12"><div class="empty-state"><div class="empty-icon">📋</div><h3>Belum ada data submissions</h3><p>Data akan muncul setelah ada karyawan yang mengisi formulir</p></div></td></tr>`;
      updatePagination(0); return;
    }
    tbody.innerHTML = page.map((s, i) => {
      const batches = JSON.parse(s.batch_cluster || '[]');
      const batchPreview = batches.slice(0, 3).join(', ') + (batches.length > 3 ? ` +${batches.length - 3}` : '');
      const status = s.status || 'approved'; // sudah di-normalize di loadData, fallback untuk keamanan
      
      let statusBadge = '';
      if (status === 'pending') {
        statusBadge = `<span class="badge" style="background:rgba(245,158,11,0.06); color:#D97706; border:1px solid rgba(245,158,11,0.15)">🟡 Pending</span>`;
      } else if (status === 'approved') {
        statusBadge = `<span class="badge" style="background:rgba(16,185,129,0.06); color:#059669; border:1px solid rgba(16,185,129,0.15)">🟢 Approved</span>`;
      } else {
        statusBadge = `<span class="badge" style="background:rgba(239,68,68,0.06); color:#DC2626; border:1px solid rgba(239,68,68,0.15)">🔴 Rejected</span>`;
      }

      let actionButtons = `
        <button class="btn-icon btn-view" onclick="viewDetail('${s.id}')" title="Lihat detail">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      `;

      if (status === 'pending') {
        actionButtons += `
          <button class="btn-icon" style="background:rgba(16,185,129,0.08); color:#059669;" onclick="updateStatus('${s.id}', 'approved')" title="Approve">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
          </button>
          <button class="btn-icon" style="background:rgba(239,68,68,0.08); color:#DC2626;" onclick="updateStatus('${s.id}', 'rejected')" title="Reject">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        `;
      }

      actionButtons += `
        <button class="btn-icon btn-del" onclick="deleteSubmission('${s.id}')" title="Hapus">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      `;

      return `
        <tr style="animation-delay: ${i * 0.03}s">
          <td>${start + i + 1}</td>
          <td>${s.tanggal_carian}</td>
          <td>${s.tanggal_pengerjaan}</td>
          <td class="text-main">${s.nama}</td>
          <td>${posisiBadge(s.posisi)}</td>
          <td>${s.tipe_lokasi}</td>
          <td>${s.zona}</td>
          <td title="${batches.join(', ')}">${batchPreview || '-'}</td>
          <td class="text-main">${s.jumlah_output.toLocaleString('id-ID')}</td>
          <td>${statusBadge}</td>
          <td>${formatDateTime(s.created_at)}</td>
          <td>
            <div class="action-btns">
              ${actionButtons}
            </div>
          </td>
        </tr>`;
    }).join('');
    updatePagination(filteredSubmissions.length);
  }

  function updatePagination(total) {
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const start = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, total);
    document.getElementById('pageInfo').textContent = `Menampilkan ${start}–${end} dari ${total} data`;
    const pag = document.getElementById('pagination');
    pag.innerHTML = '';
    const prev = document.createElement('button');
    prev.className = 'page-btn'; prev.innerHTML = '‹'; prev.disabled = currentPage <= 1;
    prev.onclick = () => { currentPage--; renderAllTable(); };
    pag.appendChild(prev);
    getPageRange(currentPage, totalPages).forEach(p => {
      if (p === '...') {
        const el = document.createElement('span');
        el.style.cssText = 'display:flex;align-items:center;padding:0 4px;color:var(--text-dim);';
        el.textContent = '…'; pag.appendChild(el);
      } else {
        const btn = document.createElement('button');
        btn.className = 'page-btn' + (p === currentPage ? ' active' : '');
        btn.textContent = p; btn.onclick = () => { currentPage = p; renderAllTable(); };
        pag.appendChild(btn);
      }
    });
    const next = document.createElement('button');
    next.className = 'page-btn'; next.innerHTML = '›'; next.disabled = currentPage >= totalPages;
    next.onclick = () => { currentPage++; renderAllTable(); };
    pag.appendChild(next);
  }

  function getPageRange(cur, total) {
    if (total <= 7) return Array.from({length: total}, (_, i) => i + 1);
    if (cur <= 4) return [1,2,3,4,5,'...',total];
    if (cur >= total - 3) return [1,'...',total-4,total-3,total-2,total-1,total];
    return [1,'...',cur-1,cur,cur+1,'...',total];
  }

  function filterTable() {
    const q        = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const statusVal = document.getElementById('statusFilterInput')?.value || 'all';
    const posisiVal = document.getElementById('filterPosisi')?.value || 'all';
    const lokasiVal = document.getElementById('filterTipeLokasi')?.value || 'all';
    const zonaVal   = document.getElementById('filterZona')?.value || 'all';
    const dateFrom  = document.getElementById('filterDateFrom')?.value || '';
    const dateTo    = document.getElementById('filterDateTo')?.value || '';

    filteredSubmissions = allSubmissions.filter(s => {
      // Search — null-safe agar tidak crash jika field kosong
      const matchSearch = !q ||
        (s.nama || '').toLowerCase().includes(q) ||
        (s.posisi || '').toLowerCase().includes(q) ||
        (s.zona || '').toLowerCase().includes(q) ||
        (s.tipe_lokasi || '').toLowerCase().includes(q);
      // Status
      // s.status sudah di-normalize di loadData (null → 'approved'), cek langsung
      const matchStatus = statusVal === 'all' || s.status === statusVal;
      // Posisi
      const matchPosisi = posisiVal === 'all' || s.posisi === posisiVal;
      // Tipe Lokasi
      const matchLokasi = lokasiVal === 'all' || s.tipe_lokasi === lokasiVal;
      // Zona
      const matchZona = zonaVal === 'all' || s.zona === zonaVal;
      // Tanggal Carian range
      const tgl = s.tanggal_carian ? s.tanggal_carian.slice(0, 10) : '';
      const matchFrom = !dateFrom || tgl >= dateFrom;
      const matchTo   = !dateTo   || tgl <= dateTo;

      return matchSearch && matchStatus && matchPosisi && matchLokasi && matchZona && matchFrom && matchTo;
    });

    // Update active chips + highlight inputs
    updateFilterChips({ q, statusVal, posisiVal, lokasiVal, zonaVal, dateFrom, dateTo });
    // Update result info
    const info = document.getElementById('filterResultInfo');
    if (info) {
      info.textContent = filteredSubmissions.length === allSubmissions.length
        ? `${allSubmissions.length.toLocaleString('id-ID')} data`
        : `${filteredSubmissions.length.toLocaleString('id-ID')} dari ${allSubmissions.length.toLocaleString('id-ID')} data`;
    }
    currentPage = 1;
    renderAllTable();
  }

  function populateFilterDropdowns() {
    const tipeLokasi = [...new Set(allSubmissions.map(s => s.tipe_lokasi).filter(Boolean))].sort();
    const zonas      = [...new Set(allSubmissions.map(s => s.zona).filter(Boolean))].sort();

    const lokasiSel = document.getElementById('filterTipeLokasi');
    const zonaSel   = document.getElementById('filterZona');
    if (lokasiSel) {
      const prev = lokasiSel.value;
      lokasiSel.innerHTML = '<option value="all">Semua Lokasi</option>' +
        tipeLokasi.map(t => `<option value="${t}">${t}</option>`).join('');
      if (prev) lokasiSel.value = prev;
    }
    if (zonaSel) {
      const prev = zonaSel.value;
      zonaSel.innerHTML = '<option value="all">Semua Zona</option>' +
        zonas.map(z => `<option value="${z}">Zona ${z}</option>`).join('');
      if (prev) zonaSel.value = prev;
    }
  }

  function updateFilterChips({ q, statusVal, posisiVal, lokasiVal, zonaVal, dateFrom, dateTo }) {
    const chips = [];
    if (q) chips.push({ label: `"${q}"`, clear: () => { document.getElementById('searchInput').value = ''; filterTable(); } });
    if (posisiVal !== 'all') chips.push({ label: `Posisi: ${posisiVal}`, clear: () => { document.getElementById('filterPosisi').value = 'all'; filterTable(); } });
    if (lokasiVal !== 'all') chips.push({ label: `Lokasi: ${lokasiVal}`, clear: () => { document.getElementById('filterTipeLokasi').value = 'all'; filterTable(); } });
    if (zonaVal !== 'all') chips.push({ label: `Zona: ${zonaVal}`, clear: () => { document.getElementById('filterZona').value = 'all'; filterTable(); } });
    if (statusVal !== 'all') chips.push({ label: `Status: ${statusVal}`, clear: () => { document.getElementById('statusFilterInput').value = 'all'; filterTable(); } });
    if (dateFrom) chips.push({ label: `Dari: ${dateFrom}`, clear: () => { document.getElementById('filterDateFrom').value = ''; filterTable(); } });
    if (dateTo)   chips.push({ label: `Sampai: ${dateTo}`, clear: () => { document.getElementById('filterDateTo').value = ''; filterTable(); } });

    const container = document.getElementById('filterActiveChips');
    if (container) {
      container.innerHTML = chips.map((c, i) => `
        <span class="filter-chip">
          ${c.label}
          <button class="chip-x" onclick="clearFilterChip(${i})" title="Hapus filter">
            <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </span>`).join('');
      // Store chip clear callbacks
      window._filterChipClears = chips.map(c => c.clear);
    }

    // Show/hide reset button
    const resetBtn = document.getElementById('btnResetFilter');
    if (resetBtn) resetBtn.style.display = chips.length ? 'inline-flex' : 'none';

    // Highlight active inputs
    const highlightSearchParent = !!q;
    const searchEl = document.getElementById('searchInput');
    if (searchEl && searchEl.closest('.filter-search')) {
      searchEl.closest('.filter-search').classList.toggle('active', highlightSearchParent);
    }
    const highlight = (id, active) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', active);
    };
    highlight('filterPosisi', posisiVal !== 'all');
    highlight('filterTipeLokasi', lokasiVal !== 'all');
    highlight('filterZona', zonaVal !== 'all');
    highlight('statusFilterInput', statusVal !== 'all');
    highlight('filterDateFrom', !!dateFrom);
    highlight('filterDateTo', !!dateTo);
  }

  function clearFilterChip(i) {
    if (window._filterChipClears && window._filterChipClears[i]) {
      window._filterChipClears[i]();
    }
  }

  function resetAllFilters() {
    const ids = ['searchInput', 'filterDateFrom', 'filterDateTo'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['filterPosisi', 'filterTipeLokasi', 'filterZona', 'statusFilterInput'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = 'all';
    });
    filterTable();
  }

  function filterToPending() {
    const statusSelect = document.getElementById('statusFilterInput');
    if (statusSelect) {
      statusSelect.value = 'pending';
      filterTable();
    }
  }

  async function updateStatus(id, newStatus) {
    const actionText = newStatus === 'approved' ? 'menyetujui' : 'menolak';
    const isApproved = newStatus === 'approved';
    const okText = isApproved ? 'Setujui' : 'Tolak';
    const okClass = isApproved ? 'btn-primary' : 'btn-danger';
    const icon = isApproved ? '🟢' : '🔴';
    
    const confirmed = await showConfirmModal({
      title: `${isApproved ? 'Setujui' : 'Tolak'} Submission`,
      message: `Apakah Anda yakin ingin ${actionText} submission ini?`,
      icon: icon,
      okText: okText,
      okClass: okClass
    });
    if (!confirmed) return;
    try {
      const r = await fetch(`/api/submissions/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      const res = await r.json();
      if (res.success) {
        showToast(`Submission berhasil di-${newStatus}.`, 'success');
        await loadData();
      } else {
        showToast(res.error || 'Gagal mengubah status.', 'error');
      }
    } catch (err) {
      showToast('Gagal menghubungi server.', 'error');
    }
  }

  // ============= VIEW DETAIL =============
  async function viewDetail(id) {
    const titleEl = document.getElementById('detailModalTitle');
    if (titleEl) titleEl.textContent = 'Detail Submission (Picker & Sorter)';
    document.getElementById('modalBody').innerHTML = '<div class="loading-spinner"><div class="spin"></div></div>';
    document.getElementById('detailModal').classList.add('visible');
    try {
      const data = await fetch(`/api/submissions/${id}`).then(r => r.json());
      const batches = JSON.parse(data.batch_cluster || '[]');
      document.getElementById('modalBody').innerHTML = `
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-key">Tanggal Carian</div><div class="detail-value">${data.tanggal_carian}</div></div>
          <div class="detail-item"><div class="detail-key">Tanggal Pengerjaan</div><div class="detail-value">${data.tanggal_pengerjaan}</div></div>
          <div class="detail-item full"><div class="detail-key">Nama</div><div class="detail-value">${data.nama}</div></div>
          <div class="detail-item"><div class="detail-key">Posisi</div><div class="detail-value">${data.posisi}</div></div>
          <div class="detail-item"><div class="detail-key">Tipe Lokasi</div><div class="detail-value">${data.tipe_lokasi}</div></div>
          <div class="detail-item"><div class="detail-key">Zona</div><div class="detail-value">${data.zona}</div></div>
          <div class="detail-item"><div class="detail-key">Jumlah Output</div><div class="detail-value">${data.jumlah_output.toLocaleString('id-ID')}</div></div>
          <div class="detail-item full">
            <div class="detail-key">Batch / Cluster (${batches.length})</div>
            <div class="batch-tags">${batches.map(b => `<span class="batch-tag">${b}</span>`).join('') || '-'}</div>
          </div>
          ${data.catatan_tambahan ? `<div class="detail-item full"><div class="detail-key">Catatan Tambahan</div><div class="detail-value">${data.catatan_tambahan}</div></div>` : ''}
          <div class="detail-item full"><div class="detail-key">Waktu Submit</div><div class="detail-value">${formatDateTime(data.created_at)}</div></div>
        </div>`;
    } catch (err) {
      document.getElementById('modalBody').innerHTML = '<p style="color:var(--error)">Gagal memuat detail.</p>';
    }
  }

  async function deleteSubmission(id) {
    const confirmed = await showConfirmModal({
      title: 'Hapus Submission',
      message: 'Apakah Anda yakin ingin menghapus submission ini? Tindakan ini tidak dapat dibatalkan.',
      icon: '🗑️',
      okText: 'Hapus',
      okClass: 'btn-danger'
    });
    if (!confirmed) return;
    try {
      await fetch(`/api/submissions/${id}`, { method: 'DELETE' });
      allSubmissions = allSubmissions.filter(s => s.id !== id);
      filteredSubmissions = filteredSubmissions.filter(s => s.id !== id);
      renderRecentTable(); renderAllTable();
      showToast('Data berhasil dihapus.', 'success');
    } catch (err) { showToast('Gagal menghapus data.', 'error'); }
  }

  // ============= DATA CARIAN =============
  async function loadDataCarian() {
    const tanggal = document.getElementById('dcDateFilter').value;
    if (!tanggal) {
      document.getElementById('dcTableBody').innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📅</div><h3>Pilih tanggal carian</h3><p>Pilih tanggal untuk melihat data kapasitas batch</p></div></td></tr>`;
      document.getElementById('dcSummary').style.display = 'none';
      document.getElementById('btnDeleteAllDC').style.display = 'none';
      document.getElementById('dcPageInfo').textContent = '-';
      return;
    }

    document.getElementById('dcTableBody').innerHTML = `<tr><td colspan="9"><div class="loading-spinner"><div class="spin"></div></div></td></tr>`;
    // Reset summary ke 0 sebelum data baru tiba (hindari nilai stale dari load sebelumnya)
    document.getElementById('dcSumTotal').textContent = '0';
    document.getElementById('dcSumDone').textContent = '0';
    document.getElementById('dcSumEmpty').textContent = '0';
    document.getElementById('dcSumPartial').textContent = '0';

    try {
      const records = await fetch(`/api/data-carian?tanggal=${tanggal}`).then(r => r.json());
      allDataCarian = records;
      filteredDataCarian = [...allDataCarian];

      // DEBUG: cek nilai persen dari API
      const persenValues = records.map(r => r.persen);
      const persenTypes = [...new Set(persenValues.map(p => typeof p))];
      const persen100Count = records.filter(r => r.persen === 100).length;
      const persen100NumCount = records.filter(r => Number(r.persen) >= 100).length;
      console.log('[loadDataCarian] total records:', records.length);
      console.log('[loadDataCarian] persen types:', persenTypes);
      console.log('[loadDataCarian] persen===100 count:', persen100Count, '| Number(persen)>=100 count:', persen100NumCount);
      console.log('[loadDataCarian] sample data (5):', records.slice(0,5).map(r => ({ posisi:r.posisi, zona:r.zona, batch:r.batch, persen:r.persen, sudah_diisi:r.sudah_diisi, total_output:r.total_output })));

      const dateLabel = new Date(tanggal + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
      document.getElementById('dcTableTitle').textContent = `Data Kapasitas Batch — ${dateLabel}`;

      if (records.length > 0) {
        document.getElementById('btnDeleteAllDC').style.display = 'flex';
        document.getElementById('dcSummary').style.display = 'grid';
      } else {
        document.getElementById('btnDeleteAllDC').style.display = 'none';
        document.getElementById('dcSummary').style.display = 'none';
      }

      // filterDCTable akan update summary secara otomatis
      filterDCTable();
    } catch(err) {
      showToast('Gagal memuat data carian.', 'error');
    }
  }

  function updateDCSummary(records) {
    const total = records.length;
    const done = records.filter(r => Number(r.persen) >= 100).length;
    const empty = records.filter(r => (r.sudah_diisi === 0 || r.sudah_diisi === null || r.sudah_diisi === undefined) && Number(r.persen) < 100).length;
    const partial = total - done - empty;
    console.log('[DC Summary] total:', total, 'done:', done, 'empty:', empty, 'partial:', partial);
    console.log('[DC Summary] sample persen values:', records.slice(0,5).map(r => ({ batch: r.batch, persen: r.persen, type: typeof r.persen, sudah_diisi: r.sudah_diisi })));
    animateValue('dcSumTotal', total);
    animateValue('dcSumDone', done);
    animateValue('dcSumEmpty', empty);
    animateValue('dcSumPartial', partial);
  }

  function renderDCTable() {
    const tbody = document.getElementById('dcTableBody');
    if (!filteredDataCarian.length) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">📭</div><h3>Belum ada data carian</h3><p>Import dari Excel atau tambah manual untuk memulai</p></div></td></tr>`;
      document.getElementById('dcPageInfo').textContent = '0 data';
      return;
    }

    tbody.innerHTML = filteredDataCarian.map((r, i) => {
      const pct = r.persen || 0;
      const progClass = pct >= 100 ? 'full' : pct >= 75 ? 'high' : pct >= 40 ? 'mid' : 'low';
      const sisaClass = r.sisa <= 0 ? 'full' : r.sisa < (r.total_output * 0.25) ? 'warn' : 'ok';
      return `
        <tr style="animation-delay: ${i * 0.03}s">
          <td>${i + 1}</td>
          <td>${posisiBadge(r.posisi)}</td>
          <td><span style="font-weight:600;color:var(--text)">${r.zona}</span></td>
          <td><span class="batch-tag">${r.batch}</span></td>
          <td><span style="font-size:13px;font-weight:600;color:var(--accent)">${(r.jumlah_toko || 0).toLocaleString('id-ID')} <span style="font-size:11px;color:var(--text-muted)">toko</span></span></td>
          <td class="text-main">${r.total_output.toLocaleString('id-ID')} <span style="font-size:11px;color:var(--text-muted)">${r.satuan}</span></td>
          <td>${(r.sudah_diisi || 0).toLocaleString('id-ID')} <span style="font-size:11px;color:var(--text-muted)">${r.satuan}</span></td>
          <td><span class="sisa-badge ${sisaClass}">${(r.sisa || 0).toLocaleString('id-ID')} ${r.satuan}</span></td>
          <td>
            <div class="progress-wrap">
              <div class="progress-bar"><div class="progress-fill ${progClass}" style="width:${pct}%"></div></div>
              <span class="progress-pct" style="color:${pct>=100?'#FCA5A5':pct>=75?'#FCD34D':'#6EE7B7'}">${pct}%</span>
            </div>
          </td>
          <td>
            <div class="action-btns">
              <button class="btn-icon btn-edit" onclick="openEditCarianModal('${r.id}','${r.tanggal_carian}','${r.posisi}','${r.zona}','${r.batch}',${r.total_output},${r.jumlah_toko || 0})" title="Edit">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon btn-del" onclick="deleteDataCarian('${r.id}')" title="Hapus">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
    document.getElementById('dcPageInfo').textContent = `${filteredDataCarian.length} data kapasitas batch`;
  }

  function filterDCTable() {
    const q = (document.getElementById('dcSearchInput')?.value || '').toLowerCase().trim();
    const posisiVal = document.getElementById('dcPosisiFilter')?.value || '';
    const zonaVal = document.getElementById('dcZonaFilter')?.value || '';
    const statusVal = document.getElementById('dcStatusFilter')?.value || '';

    if (statusVal === 'selesai') {
      const selesaiCount = allDataCarian.filter(r => Number(r.persen) >= 100).length;
      console.log('[filterDCTable] filter=selesai, allDataCarian.length:', allDataCarian.length, ', selesai count:', selesaiCount);
      console.log('[filterDCTable] sample persen:', allDataCarian.slice(0,10).map(r => r.persen));
    }

    filteredDataCarian = allDataCarian.filter(r => {
      // 1. Text Search
      const matchesSearch = !q || (
        r.zona.toLowerCase().includes(q) ||
        String(r.batch).toLowerCase().includes(q) ||
        r.posisi.toLowerCase().includes(q) ||
        String(r.jumlah_toko || 0).includes(q)
      );

      // 2. Posisi Filter
      const matchesPosisi = !posisiVal || r.posisi === posisiVal;

      // 3. Zona Filter
      const matchesZona = !zonaVal || r.zona.toUpperCase() === zonaVal.toUpperCase();

      // 4. Status Progress Filter
      let matchesStatus = true;
      if (statusVal) {
        const pct = Number(r.persen) || 0;
        if (statusVal === 'belum') {
          matchesStatus = pct === 0;
        } else if (statusVal === 'sebagian') {
          matchesStatus = pct > 0 && pct < 100;
        } else if (statusVal === 'selesai') {
          matchesStatus = pct >= 100;
        }
      }

      return matchesSearch && matchesPosisi && matchesZona && matchesStatus;
    });

    // Summary card selalu mencerminkan SEMUA data tanggal tersebut (bukan hanya filtered)
    // agar kartu statistik konsisten dan tidak membingungkan
    if (allDataCarian.length > 0) {
      updateDCSummary(allDataCarian);
    }

    renderDCTable();
  }

  // ============= IMPORT EXCEL =============
  function openImportModal() {
    importSelectedFile = null;
    document.getElementById('importFileInfo').style.display = 'none';
    document.getElementById('importResult').style.display = 'none';
    document.getElementById('importFileInput').value = '';
    document.getElementById('btnImport').disabled = true;
    // Pre-fill date from filter
    const dcDate = document.getElementById('dcDateFilter').value;
    if (dcDate) document.getElementById('importTanggal').value = dcDate;
    document.getElementById('importModal').classList.add('visible');
  }

  function handleImportFile(file) {
    if (!file) return;
    importSelectedFile = file;
    const infoEl = document.getElementById('importFileInfo');
    const sizeKB = (file.size / 1024).toFixed(1);
    infoEl.style.display = 'flex';
    infoEl.className = 'file-selected-info';
    infoEl.innerHTML = `
      <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--primary-light);flex-shrink:0"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="fs-name">${file.name}</span>
      <span class="fs-size">${sizeKB} KB</span>
      <button class="fs-remove" onclick="clearImportFile()">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
      </button>`;
    document.getElementById('importResult').style.display = 'none';
    document.getElementById('btnImport').disabled = false;

    // Setup drag/drop
    const dz = document.getElementById('importDropZone');
    dz.style.borderColor = 'var(--primary)';
    dz.style.background = 'rgba(108,60,225,0.08)';
  }

  function clearImportFile() {
    importSelectedFile = null;
    document.getElementById('importFileInfo').style.display = 'none';
    document.getElementById('importFileInput').value = '';
    document.getElementById('btnImport').disabled = true;
    const dz = document.getElementById('importDropZone');
    dz.style.borderColor = '';
    dz.style.background = '';
  }

  // Setup drag/drop for import zone
  document.addEventListener('DOMContentLoaded', () => {
    const dz = document.getElementById('importDropZone');
    if (dz) {
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
      dz.addEventListener('drop', e => {
        e.preventDefault(); dz.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleImportFile(file);
      });
    }
  });

  async function doImport() {
    if (!importSelectedFile) { showToast('Pilih file terlebih dahulu.', 'error'); return; }
    const tanggal = document.getElementById('importTanggal').value;
    if (!tanggal) { showToast('Tanggal carian wajib diisi.', 'error'); return; }
    const mode = document.querySelector('input[name="importMode"]:checked').value;

    const btn = document.getElementById('btnImport');
    btn.disabled = true;
    btn.innerHTML = `<div style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;"></div> Mengimport...`;

    const formData = new FormData();
    formData.append('file', importSelectedFile);
    formData.append('tanggal_carian', tanggal);
    formData.append('mode', mode);

    try {
      const res = await fetch('/api/data-carian/import-excel', { method: 'POST', body: formData });
      const data = await res.json();
      const resultEl = document.getElementById('importResult');
      resultEl.style.display = 'block';

      if (data.success) {
        resultEl.className = 'import-result success';
        resultEl.innerHTML = `
          <div class="ir-title">✅ ${data.message}</div>
          ${data.skipped_detail && data.skipped_detail.length > 0 ? `
            <div style="margin-top:8px;font-size:12px;">Baris dilewati:</div>
            <ul>${data.skipped_detail.map(s => `<li>${s}</li>`).join('')}</ul>
          ` : ''}`;
        showToast(data.message, 'success');
        // Update filter date and reload
        document.getElementById('dcDateFilter').value = tanggal;
        await loadDataCarian();
      } else {
        resultEl.className = 'import-result error';
        resultEl.innerHTML = `<div class="ir-title">❌ ${data.error}</div>${data.hint ? `<div style="margin-top:4px;font-size:12px;">${data.hint}</div>` : ''}${data.skipped ? `<ul>${data.skipped.map(s=>`<li>${s}</li>`).join('')}</ul>` : ''}`;
        showToast('Import gagal.', 'error');
      }
    } catch(err) {
      showToast('Gagal menghubungi server.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg> Import Sekarang`;
    }
  }

  function downloadTemplate() {
    window.location.href = '/api/data-carian/template';
  }

  // ============= ADD / EDIT DATA CARIAN MANUAL =============
  function openAddCarianModal() {
    document.getElementById('addCarianTitle').textContent = 'Tambah Data Carian';
    document.getElementById('editCarianId').value = '';
    document.getElementById('acPosisi').value = '';
    document.getElementById('acZona').value = '';
    document.getElementById('acBatch').value = '';
    document.getElementById('acJumlahToko').value = '0';
    document.getElementById('acOutput').value = '';
    document.getElementById('addCarianError').style.display = 'none';
    const dcDate = document.getElementById('dcDateFilter').value;
    if (dcDate) document.getElementById('acTanggal').value = dcDate;
    document.getElementById('addCarianModal').classList.add('visible');
  }

  function openEditCarianModal(id, tanggal, posisi, zona, batch, total_output, jumlah_toko = 0) {
    document.getElementById('addCarianTitle').textContent = 'Edit Data Carian';
    document.getElementById('editCarianId').value = id;
    document.getElementById('acTanggal').value = tanggal;
    document.getElementById('acPosisi').value = posisi;
    document.getElementById('acZona').value = zona;
    document.getElementById('acBatch').value = batch;
    document.getElementById('acOutput').value = total_output;
    document.getElementById('acJumlahToko').value = jumlah_toko;
    document.getElementById('addCarianError').style.display = 'none';
    document.getElementById('addCarianModal').classList.add('visible');
  }

  async function saveCarian() {
    const id = document.getElementById('editCarianId').value;
    const tanggal_carian = document.getElementById('acTanggal').value;
    const posisi = document.getElementById('acPosisi').value;
    const zona = document.getElementById('acZona').value;
    const batch = document.getElementById('acBatch').value.trim();
    const total_output = document.getElementById('acOutput').value;
    const jumlah_toko = parseInt(document.getElementById('acJumlahToko').value) || 0;
    const errEl = document.getElementById('addCarianError');

    if (!tanggal_carian || !posisi || !zona || !batch || total_output === '') {
      errEl.textContent = 'Semua field wajib diisi.';
      errEl.style.display = 'block'; return;
    }
    if (parseInt(total_output) < 0) {
      errEl.textContent = 'Total output tidak boleh kurang dari 0.';
      errEl.style.display = 'block'; return;
    }
    errEl.style.display = 'none';

    const btn = document.getElementById('btnSaveCarian');
    btn.disabled = true; btn.textContent = 'Menyimpan...';

    try {
      let res;
      if (id) {
        res = await fetch(`/api/data-carian/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tanggal_carian, posisi, zona, batch, jumlah_toko, total_output: parseInt(total_output) })
        }).then(r => r.json());
      } else {
        res = await fetch('/api/data-carian', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tanggal_carian, posisi, zona, batch, jumlah_toko, total_output: parseInt(total_output) })
        }).then(r => r.json());
      }

      if (res.success) {
        showToast(id ? 'Data berhasil diupdate.' : 'Data berhasil ditambahkan.', 'success');
        closeModal('addCarianModal');
        document.getElementById('dcDateFilter').value = tanggal_carian;
        await loadDataCarian();
      } else {
        errEl.textContent = res.error || 'Gagal menyimpan data.';
        errEl.style.display = 'block';
      }
    } catch(err) {
      errEl.textContent = 'Gagal menghubungi server.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Simpan';
    }
  }

  async function deleteDataCarian(id) {
    const confirmed = await showConfirmModal({
      title: 'Hapus Data Kapasitas',
      message: 'Apakah Anda yakin ingin menghapus data kapasitas batch ini?',
      icon: '🗑️',
      okText: 'Hapus',
      okClass: 'btn-danger'
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/data-carian/${id}`, { method: 'DELETE' }).then(r => r.json());
      if (res.success) {
        showToast('Data berhasil dihapus.', 'success');
        await loadDataCarian();
      } else {
        showToast('Gagal menghapus.', 'error');
      }
    } catch(err) { showToast('Gagal menghapus.', 'error'); }
  }

  async function deleteAllDataCarian() {
    const tanggal = document.getElementById('dcDateFilter').value;
    if (!tanggal) return;
    const dateLabel = new Date(tanggal + 'T00:00:00').toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' });
    const confirmed = await showConfirmModal({
      title: 'Hapus Semua Data Kapasitas',
      message: `Apakah Anda yakin ingin menghapus SEMUA data kapasitas batch untuk tanggal ${dateLabel}? Tindakan ini tidak dapat dibatalkan.`,
      icon: '🚨',
      okText: 'Hapus Semua',
      okClass: 'btn-danger'
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/data-carian/tanggal/${tanggal}`, { method: 'DELETE' }).then(r => r.json());
      if (res.success) {
        showToast('Semua data carian berhasil dihapus.', 'success');
        await loadDataCarian();
      } else {
        showToast('Gagal menghapus.', 'error');
      }
    } catch(err) { showToast('Gagal menghapus.', 'error'); }
  }

  // ============= PAGE NAVIGATION =============
  function showPage(page) {
    const isSuperAdmin = currentUser.username && currentUser.username.toLowerCase() === 'admin';
    const allowed = currentUser.allowed_pages || [];
    const isAllowed = isSuperAdmin || page === 'feature-guide' || allowed.includes(page);

    if (!isAllowed) {
      showToast('Akses Ditolak: Anda tidak memiliki hak akses untuk halaman ini.', 'error');
      // Redirect ke halaman pertama yang diizinkan, atau feature-guide jika tidak ada
      const fallback = allowed.length > 0 ? allowed[0] : 'feature-guide';
      if (currentView !== fallback) {
        showPage(fallback);
      }
      return;
    }

    currentView = page;
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
    ['dashboard','submissions','data-carian','rekap-toko','status-carian','welcome','users','loader','absensi','export','gsheets','login-settings','admin-accounts','audit-logs','feature-guide','announcements','ketentuan-harga','rekap-pendapatan'].forEach(p => {
      const el = document.getElementById('page-' + p);
      if (el) el.style.display = p === page ? 'block' : 'none';
    });

    const titles = {
      dashboard: 'Monitoring MPP',
      submissions: 'Data Submissions (Picker & Sorter)',
      'data-carian': 'Data Carian Harian',
      'rekap-toko': 'Rekap Harian Per Toko',
      'status-carian': 'Status Input Carian Harian',
      welcome: 'Selamat Datang',
      users: 'Manajemen User Operasional',
      loader: 'Hasil Entry Loader',
      export: 'Export Data',
      gsheets: 'Google Sheets Integration',
      'login-settings': 'Pengaturan Tampilan Login',
      'admin-accounts': 'Manajemen Akun Administrator',
      'audit-logs': 'Log Aktivitas Sistem (Audit Trail)',
      'feature-guide': 'Panduan Fitur Baru',
      'absensi': 'Manajemen Absensi',
      'announcements': 'Manajemen Pengumuman',
      'ketentuan-harga': 'Ketentuan Harga',
      'rekap-pendapatan': 'Rekap Pendapatan Pekerja'
    };
    document.getElementById('pageTitle').textContent = titles[page] || page;

    ['dashboard','submissions','data-carian','rekap-toko','status-carian','welcome','users','loader','absensi','export','gsheets','login-settings','admin-accounts','audit-logs','feature-guide','announcements','ketentuan-harga'].forEach(p => {
      const nav = document.getElementById('nav-' + p);
      if (nav) {
        const isActive = p === page;
        nav.classList.toggle('active', isActive);
        if (isActive) {
          // Auto-open parent submenu group if active child is loaded
          const group = nav.closest('.nav-group');
          if (group && !group.classList.contains('open')) {
            group.classList.add('open');
          }
        }
      }
    });

    if (page === 'submissions') loadData();
    if (page === 'data-carian') loadDataCarian();
    if (page === 'rekap-toko') loadRekapToko();
    if (page === 'users') loadUsers();
    if (page === 'loader') loadLoaderEntries();
    if (page === 'absensi') { if (typeof window.initAbsensiPage === 'function') window.initAbsensiPage(); }
    if (page === 'gsheets') loadGSheetsStatus();
    if (page === 'login-settings') loadLoginSettings();
    if (page === 'admin-accounts') loadAdminAccounts();
    if (page === 'audit-logs') loadAuditLogs(1);
    if (page === 'announcements') loadAnnouncements();
    if (page === 'dashboard') loadMonitoringMPP();
    if (page === 'ketentuan-harga') loadKetentuanHarga();
    if (page === 'rekap-pendapatan') loadRekapPendapatan();
    if (page === 'status-carian') loadStatusCarian();
    if (page === 'welcome') renderWelcomePage();
  }

  // Toggle navigation collapsible group
  function toggleNavGroup(header) {
    const group = header.parentNode;
    if (group) {
      group.classList.toggle('open');
    }
  }
  window.toggleNavGroup = toggleNavGroup;



  // ============= MODAL HELPERS =============
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('visible');
  }
  window.openModal = openModal;

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  }
  window.closeModal = closeModal;

  // Close modal on overlay click
  ['detailModal', 'importModal', 'addCarianModal', 'editUserModal', 'confirmModal', 'changePasswordModal', 'absensiSettingsModal', 'announcementModal', 'waReminderModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', e => {
        if (e.target === el) closeModal(id);
      });
    }
  });

  // Reusable Promise-based confirmation modal helper
  function showConfirmModal({ title, message, icon = '⚠️', okText = 'Ya', okClass = 'btn-danger' }) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      document.getElementById('confirmIcon').textContent = icon;
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMessage').textContent = message;
      
      const btnOk = document.getElementById('confirmBtnOk');
      const btnCancel = document.getElementById('confirmBtnCancel');
      
      // Reset classes
      btnOk.className = 'btn ' + okClass;
      btnOk.textContent = okText;
      
      const onOk = () => {
        closeModal('confirmModal');
        cleanup();
        resolve(true);
      };
      
      const onCancel = () => {
        closeModal('confirmModal');
        cleanup();
        resolve(false);
      };
      
      const cleanup = () => {
        btnOk.removeEventListener('click', onOk);
        btnCancel.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onOverlayClick);
      };
      
      const onOverlayClick = (e) => {
        if (e.target === modal) onCancel();
      };
      
      btnOk.addEventListener('click', onOk);
      btnCancel.addEventListener('click', onCancel);
      modal.addEventListener('click', onOverlayClick);
      
      modal.classList.add('visible');
    });
  }

  // ============= USER MANAGEMENT =============
  let allUsers = [];

  async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = `<tr><td colspan="9"><div class="loading-spinner"><div class="spin"></div></div></td></tr>`;
    try {
      allUsers = await fetch('/api/users').then(r => r.json());
      renderUsersTable();
    } catch(err) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">⚠️</div><h3>Gagal memuat data</h3></div></td></tr>`;
    }
  }

  function renderUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!allUsers.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">👥</div><h3>Belum ada user operasional</h3><p>Gunakan form di atas untuk membuat user baru</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = allUsers.map((u, i) => {
      const posBadge = u.posisi === 'Picker' ? 'badge-picker' : u.posisi === 'Sorter' ? 'badge-sorter' : 'badge-loader';
      const tipeBadge = u.tipe_karyawan === 'PHL' ? 'badge-phl' : u.tipe_karyawan === 'Productivity' ? 'badge-prod' : 'badge-other';
      // is_active: null/undefined dianggap aktif (data lama)
      const isActive = u.is_active !== false;
      const statusBadge = isActive
        ? `<span class="badge-status badge-status-active"><span class="status-dot"></span>Aktif</span>`
        : `<span class="badge-status badge-status-inactive"><span class="status-dot"></span>Non-Aktif</span>`;
      const toggleTitle = isActive ? 'Nonaktifkan user ini' : 'Aktifkan kembali user ini';
      const toggleIcon = isActive
        ? `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="16" cy="12" r="3" fill="currentColor"/></svg>`
        : `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="8" cy="12" r="3" fill="currentColor"/></svg>`;
      // Safe escaping for quote chars in names/usernames
      const safeNama = u.nama_lengkap.replace(/'/g, "\\'");
      const safeUser = u.username.replace(/'/g, "\\'");
      const safeNik = u.nik.replace(/'/g, "\\'");
      const safeTipe = (u.tipe_karyawan || '').replace(/'/g, "\\'");
      return `
        <tr style="animation-delay:${i*0.04}s${!isActive ? ';opacity:0.6' : ''}">
          <td>${i+1}</td>
          <td class="text-main">${u.nama_lengkap}${!isActive ? ' <span style="font-size:10px;color:var(--text-dim);font-weight:500;">(Keluar)</span>' : ''}</td>
          <td><code style="background:rgba(108,60,225,0.06);padding:2px 8px;border-radius:5px;font-size:12px;">${u.username}</code></td>
          <td><span style="font-family:monospace;background:rgba(0,0,0,0.04);padding:2px 8px;border-radius:5px;font-size:13px;">${u.nik}</span></td>
          <td><span class="badge ${posBadge}">${u.posisi}</span></td>
          <td><span class="badge ${tipeBadge}">${u.tipe_karyawan || 'Belum Ditentukan'}</span></td>
          <td>${statusBadge}</td>
          <td>${formatDate(u.created_at)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-icon btn-toggle-status ${isActive ? 'btn-deactivate' : 'btn-activate'}" onclick="toggleUserStatus('${u.id}', '${safeNama}', ${isActive})" title="${toggleTitle}">
                ${toggleIcon}
              </button>
              <button class="btn-icon btn-edit" onclick="openEditUserModal('${u.id}', '${safeNama}', '${safeUser}', '${safeNik}', '${u.posisi}', '${safeTipe}', '${(u.nomor_hp || '').replace(/'/g, "\\'")}')" title="Edit user">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon btn-del" onclick="deleteUser('${u.id}', '${safeNama}')" title="Hapus user">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  async function addUser() {
    const nama_lengkap = document.getElementById('newNamaLengkap').value.trim();
    const username = document.getElementById('newUsername').value.trim();
    const nik = document.getElementById('newNik').value.trim();
    const posisi = document.getElementById('newPosisi').value;
    const tipe_karyawan = document.getElementById('newTipeKaryawan').value;
    const nomor_hp = document.getElementById('newNomorHp').value.trim();
    const errEl = document.getElementById('addUserError');
    errEl.style.display = 'none';

    if (!nama_lengkap || !username || !nik || !posisi) {
      errEl.textContent = 'Semua field (kecuali tipe karyawan dan nomor HP) wajib diisi.';
      errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('btnAddUser');
    btn.disabled = true; btn.textContent = 'Menyimpan...';

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama_lengkap, username, nik, posisi, tipe_karyawan, nomor_hp })
      }).then(r => r.json());

      if (res.success) {
        showToast(`User "${nama_lengkap}" berhasil dibuat!`, 'success');
        document.getElementById('newNamaLengkap').value = '';
        document.getElementById('newUsername').value = '';
        document.getElementById('newNik').value = '';
        document.getElementById('newPosisi').value = '';
        document.getElementById('newTipeKaryawan').value = '';
        document.getElementById('newNomorHp').value = '';
        await loadUsers();
      } else {
        errEl.textContent = res.error || 'Gagal membuat user.';
        errEl.style.display = 'block';
      }
    } catch(err) {
      errEl.textContent = 'Gagal menghubungi server.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Buat User Baru`;
    }
  }

  async function deleteUser(id, nama) {
    const confirmed = await showConfirmModal({
      title: 'Hapus User',
      message: `Apakah Anda yakin ingin menghapus user "${nama}"? User ini tidak bisa login lagi setelah dihapus.`,
      icon: '👤',
      okText: 'Hapus User',
      okClass: 'btn-danger'
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' }).then(r => r.json());
      if (res.success) {
        showToast('User berhasil dihapus.', 'success');
        await loadUsers();
      } else { showToast('Gagal menghapus user.', 'error'); }
    } catch(err) { showToast('Gagal menghapus user.', 'error'); }
  }

  async function toggleUserStatus(id, nama, currentlyActive) {
    const action = currentlyActive ? 'nonaktifkan' : 'aktifkan kembali';
    const emoji = currentlyActive ? '🔒' : '🔓';
    const confirmed = await showConfirmModal({
      title: currentlyActive ? 'Nonaktifkan User' : 'Aktifkan User',
      message: currentlyActive
        ? `Apakah Anda yakin ingin menonaktifkan "${nama}"?\n\nUser tidak akan bisa login dan akan mendapat notifikasi bahwa akunnya dinonaktifkan.`
        : `Aktifkan kembali akun "${nama}"?\n\nUser akan bisa login seperti biasa.`,
      icon: emoji,
      okText: currentlyActive ? 'Ya, Nonaktifkan' : 'Ya, Aktifkan',
      okClass: currentlyActive ? 'btn-danger' : 'btn-primary'
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/users/${id}/toggle-status`, { method: 'PATCH' }).then(r => r.json());
      if (res.success) {
        const label = res.data.is_active === false ? 'dinonaktifkan' : 'diaktifkan';
        showToast(`User "${nama}" berhasil ${label}.`, 'success');
        await loadUsers();
      } else { showToast(res.error || 'Gagal mengubah status user.', 'error'); }
    } catch(err) { showToast('Gagal menghubungi server.', 'error'); }
  }

  function openEditUserModal(id, nama, username, nik, posisi, tipe_karyawan, nomor_hp) {
    document.getElementById('editUserId').value = id;
    document.getElementById('editNamaLengkap').value = nama;
    document.getElementById('editUsername').value = username;
    document.getElementById('editNik').value = nik;
    document.getElementById('editPosisi').value = posisi;
    document.getElementById('editTipeKaryawan').value = tipe_karyawan || '';
    document.getElementById('editNomorHp').value = nomor_hp || '';
    document.getElementById('editUserError').style.display = 'none';
    document.getElementById('editUserModal').classList.add('visible');
  }

  async function saveUser() {
    const id = document.getElementById('editUserId').value;
    const nama_lengkap = document.getElementById('editNamaLengkap').value.trim();
    const username = document.getElementById('editUsername').value.trim();
    const nik = document.getElementById('editNik').value.trim();
    const posisi = document.getElementById('editPosisi').value;
    const tipe_karyawan = document.getElementById('editTipeKaryawan').value;
    const nomor_hp = document.getElementById('editNomorHp').value.trim();
    const errEl = document.getElementById('editUserError');
    errEl.style.display = 'none';

    if (!nama_lengkap || !username || !nik || !posisi) {
      errEl.textContent = 'Semua field (kecuali tipe karyawan dan nomor HP) wajib diisi.';
      errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('btnSaveUser');
    btn.disabled = true; btn.textContent = 'Menyimpan...';

    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama_lengkap, username, nik, posisi, tipe_karyawan, nomor_hp })
      }).then(r => r.json());

      if (res.success) {
        showToast('User berhasil diupdate.', 'success');
        closeModal('editUserModal');
        await loadUsers();
      } else {
        errEl.textContent = res.error || 'Gagal menyimpan perubahan.';
        errEl.style.display = 'block';
      }
    } catch(err) {
      errEl.textContent = 'Gagal menghubungi server.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Simpan Perubahan';
    }
  }

  // ============= ADMIN ACCOUNT MANAGEMENT =============
  let allAdminAccounts = [];

  async function loadAdminAccounts() {
    const tbody = document.getElementById('adminAccountsTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6"><div class="loading-spinner"><div class="spin"></div></div></td></tr>`;
    try {
      allAdminAccounts = await fetch('/api/admin-accounts').then(r => r.json());
      renderAdminAccountsTable();
    } catch(err) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">⚠️</div><h3>Gagal memuat data</h3></div></td></tr>`;
    }
  }

  function renderAdminAccountsTable() {
    const tbody = document.getElementById('adminAccountsTableBody');
    if (!allAdminAccounts.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🛡️</div><h3>Belum ada akun admin lain</h3><p>Gunakan form di atas untuk menambah admin baru</p></div></td></tr>`;
      return;
    }

    const pageLabels = {
      submissions: 'Submissions',
      loader: 'Entry Loader',
      'data-carian': 'Carian Harian',
      'rekap-toko': 'Rekap Harian',
      users: 'Manajemen User',
      absensi: 'Absensi',
      'ketentuan-harga': 'Harga',
      announcements: 'Pengumuman',
      export: 'Ekspor',
      gsheets: 'GSheets'
    };

    tbody.innerHTML = allAdminAccounts.map((a, i) => {
      const safeName = a.nama_lengkap.replace(/'/g, "\\'");
      const safeUser = a.username.replace(/'/g, "\\'");
      
      // Render permissions
      let permsHTML = '';
      if (a.username && a.username.toLowerCase() === 'admin') {
        permsHTML = `<span style="background:rgba(108,60,225,0.08);color:var(--primary);font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;border:1px solid rgba(108,60,225,0.15);">Super Admin (Semua)</span>`;
      } else {
        const pages = a.allowed_pages || [];
        if (!pages.length) {
          permsHTML = `<span style="background:rgba(239,68,68,0.06);color:#DC2626;font-size:11px;padding:2px 8px;border-radius:20px;">Tanpa Akses</span>`;
        } else {
          permsHTML = `<div style="display:flex;flex-wrap:wrap;gap:4px;">` + pages.map(p => {
            const label = pageLabels[p] || p;
            return `<span style="background:rgba(108,60,225,0.05);color:var(--primary);font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;border:1px solid rgba(108,60,225,0.08);">${label}</span>`;
          }).join('') + `</div>`;
        }
      }

      // Check if delete button should be visible
      const deleteBtn = (!a.username || a.username.toLowerCase() !== 'admin') 
        ? `<button class="btn-icon btn-del" onclick="deleteAdminAccount('${a.id}', '${safeName}', '${safeUser}')" title="Hapus akun admin">
             <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
           </button>`
        : '';
        
      // Check if permissions edit button should be visible
      const editPermsBtn = (!a.username || a.username.toLowerCase() !== 'admin')
        ? `<button class="btn-icon" style="color:var(--primary);background:rgba(108,60,225,0.05);border:1px solid rgba(108,60,225,0.1);padding:4px;display:inline-flex;" onclick="openEditPermissionsModal('${a.id}', '${safeName}', '${(a.allowed_pages || []).join(',')}')" title="Edit Hak Akses">
             <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
           </button>`
        : '';

      return `
        <tr style="animation-delay:${i*0.04}s">
          <td>${i+1}</td>
          <td class="text-main">${a.nama_lengkap}</td>
          <td><code style="background:rgba(108,60,225,0.06);padding:2px 8px;border-radius:5px;font-size:12px;">${a.username}</code></td>
          <td>${permsHTML}</td>
          <td>${formatDate(a.created_at)}</td>
          <td>
            <div class="action-btns">
              ${editPermsBtn}
              ${deleteBtn}
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  async function addAdminAccount() {
    const nama_lengkap = document.getElementById('newAdminNama').value.trim();
    const username = document.getElementById('newAdminUsername').value.trim();
    const password = document.getElementById('newAdminPassword').value;
    const passwordConfirm = document.getElementById('newAdminPasswordConfirm').value;
    const errEl = document.getElementById('addAdminError');
    errEl.style.display = 'none';

    if (!nama_lengkap || !username || !password || !passwordConfirm) {
      errEl.textContent = 'Semua field wajib diisi.'; errEl.style.display = 'block'; return;
    }
    if (password.length < 6) {
      errEl.textContent = 'Password minimal 6 karakter.'; errEl.style.display = 'block'; return;
    }
    if (password !== passwordConfirm) {
      errEl.textContent = 'Konfirmasi password tidak cocok.'; errEl.style.display = 'block'; return;
    }

    const checkedPages = Array.from(document.querySelectorAll('input[name="newAdminPages"]:checked')).map(cb => cb.value);

    const btn = document.getElementById('btnAddAdmin');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const res = await fetch('/api/admin-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama_lengkap, username, password, allowed_pages: checkedPages })
      }).then(r => r.json());

      if (res.success) {
        showToast(`Akun admin "${nama_lengkap}" berhasil dibuat!`, 'success');
        document.getElementById('newAdminNama').value = '';
        document.getElementById('newAdminUsername').value = '';
        document.getElementById('newAdminPassword').value = '';
        document.getElementById('newAdminPasswordConfirm').value = '';
        document.querySelectorAll('input[name="newAdminPages"]').forEach(cb => cb.checked = false);
        await loadAdminAccounts();
      } else {
        errEl.textContent = res.error || 'Gagal membuat akun admin.';
        errEl.style.display = 'block';
      }
    } catch(err) {
      errEl.textContent = 'Gagal menghubungi server.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Buat Akun Admin Baru`;
    }
  }

  function openEditPermissionsModal(id, name, allowedPagesStr) {
    document.getElementById('editPermsAdminId').value = id;
    document.getElementById('editPermsAdminName').textContent = name;
    
    const allowedPages = allowedPagesStr ? allowedPagesStr.split(',') : [];
    
    document.querySelectorAll('input[name="editAdminPages"]').forEach(cb => {
      cb.checked = allowedPages.includes(cb.value);
      const card = cb.closest('.perm-card');
      if (card) {
        card.classList.toggle('checked', cb.checked);
      }
    });
    
    document.getElementById('editPermissionsModal').classList.add('visible');
  }

  async function saveAdminPermissions() {
    const id = document.getElementById('editPermsAdminId').value;
    const checkedPages = Array.from(document.querySelectorAll('input[name="editAdminPages"]:checked')).map(cb => cb.value);
    
    const btn = document.querySelector('#editPermissionsModal .btn-primary');
    const origText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyimpan...';

    try {
      const res = await fetch(`/api/admin-accounts/${id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_pages: checkedPages })
      }).then(r => r.json());
      
      if (res.success) {
        showToast('Hak akses admin berhasil diperbarui!', 'success');
        closeModal('editPermissionsModal');
        await loadAdminAccounts();
      } else {
        showToast(res.error || 'Gagal mengubah hak akses.', 'error');
      }
    } catch(err) {
      showToast('Gagal menghubungi server.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = origText;
    }
  }

  window.openEditPermissionsModal = openEditPermissionsModal;
  window.saveAdminPermissions = saveAdminPermissions;


  async function deleteAdminAccount(id, nama, username) {
    const confirmed = await showConfirmModal({
      title: 'Hapus Akun Admin',
      message: `Apakah Anda yakin ingin menghapus akun "${nama}" (${username})? Akun ini tidak bisa login lagi setelah dihapus.`,
      icon: '🛡️',
      okText: 'Hapus Akun',
      okClass: 'btn-danger'
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/admin-accounts/${id}`, { method: 'DELETE' }).then(r => r.json());
      if (res.success) {
        showToast('Akun admin berhasil dihapus.', 'success');
        await loadAdminAccounts();
      } else {
        showToast(res.error || 'Gagal menghapus akun.', 'error');
      }
    } catch(err) { showToast('Gagal menghubungi server.', 'error'); }
  }

  function openChangePasswordModal() {
    document.getElementById('cpCurrentPassword').value = '';
    document.getElementById('cpNewPassword').value = '';
    document.getElementById('cpConfirmPassword').value = '';
    document.getElementById('changePasswordError').style.display = 'none';
    document.getElementById('changePasswordModal').classList.add('visible');
  }

  async function changeMyPassword() {
    const currentPassword = document.getElementById('cpCurrentPassword').value;
    const newPassword = document.getElementById('cpNewPassword').value;
    const confirmPassword = document.getElementById('cpConfirmPassword').value;
    const errEl = document.getElementById('changePasswordError');
    errEl.style.display = 'none';

    if (!currentPassword || !newPassword || !confirmPassword) {
      errEl.textContent = 'Semua field wajib diisi.'; errEl.style.display = 'block'; return;
    }
    if (newPassword.length < 6) {
      errEl.textContent = 'Password baru minimal 6 karakter.'; errEl.style.display = 'block'; return;
    }
    if (newPassword !== confirmPassword) {
      errEl.textContent = 'Konfirmasi password baru tidak cocok.'; errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('btnChangePassword');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const res = await fetch('/api/admin-accounts/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      }).then(r => r.json());

      if (res.success) {
        closeModal('changePasswordModal');
        showToast('Password berhasil diubah! Gunakan password baru untuk login berikutnya.', 'success');
      } else {
        errEl.textContent = res.error || 'Gagal mengubah password.';
        errEl.style.display = 'block';
      }
    } catch(err) {
      errEl.textContent = 'Gagal menghubungi server.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg> Simpan Password Baru`;
    }
  }

  // ============= LOADER ENTRIES =============
  let allLoaderEntries = [];
  let filteredLoaderEntries = [];

  async function loadLoaderEntries() {
    const tbody = document.getElementById('loaderTableBody');
    tbody.innerHTML = `<tr><td colspan="12"><div class="loading-spinner"><div class="spin"></div></div></td></tr>`;
    try {
      const tanggal = document.getElementById('loaderDateFilter').value;
      const url = tanggal ? `/api/loader-entries?tanggal_carian=${tanggal}` : '/api/loader-entries';
      allLoaderEntries = await fetch(url).then(r => r.json());
      filteredLoaderEntries = [...allLoaderEntries];

      if (tanggal) {
        const dateLabel = new Date(tanggal + 'T00:00:00').toLocaleDateString('id-ID', {weekday:'long',day:'2-digit',month:'long',year:'numeric'});
        document.getElementById('loaderTableTitle').textContent = `Entry Loader — ${dateLabel}`;
      } else {
        document.getElementById('loaderTableTitle').textContent = 'Semua Entry Loader';
      }

      renderLoaderTable();
    } catch(err) {
      tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state"><div class="empty-icon">⚠️</div><h3>Gagal memuat data</h3></div></td></tr>`;
    }
  }

  function renderLoaderTable() {
    const tbody = document.getElementById('loaderTableBody');
    if (!filteredLoaderEntries.length) {
      tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state"><div class="empty-icon">🚚</div><h3>Belum ada entry loader</h3><p>Data akan muncul setelah Loader mengisi form</p></div></td></tr>`;
      document.getElementById('loaderPageInfo').textContent = '0 data';
      return;
    }
    tbody.innerHTML = filteredLoaderEntries.map((e, i) => {
      const clusters = Array.isArray(e.clusters) ? e.clusters : (e.clusters && typeof e.clusters === 'object' ? (e.clusters.list || []) : []);
      const clusterPreview = clusters.slice(0,3).join(', ') + (clusters.length > 3 ? ` +${clusters.length-3}` : '');
      const ng = e.non_group || {};
      const ngParts = [];
      if (ng.gacoan > 0) ngParts.push(`Gacoan:${ng.gacoan}`);
      if (ng.dikichi > 0) ngParts.push(`Dikichi:${ng.dikichi}`);
      if (ng.benfarm > 0) ngParts.push(`Benfarm:${ng.benfarm}`);
      
      const files = e.files || [];
      const fileBadgeHtml = files.length > 0 
        ? files.map((f, fi) => `
            <a href="${f.file_path}" target="_blank" class="badge" style="display:inline-flex; align-items:center; gap:3px; background:rgba(14,165,233,0.06); color:var(--accent-blue-dark); border:1px solid rgba(14,165,233,0.15); margin:2px 1px; text-decoration:none; font-size:11px;" title="${f.original_name}">
              📄 Foto ${fi + 1}
            </a>
          `).join('')
        : '<span style="color:var(--text-dim); font-size:12px;">-</span>';

      // Determine jabatan from entry — Loader entries default to 'Loader'
      const jabatan = e.posisi || 'Loader';
      const jabatanBadge = jabatan === 'Picker' ? 'badge-picker' : jabatan === 'Sorter' ? 'badge-sorter' : 'badge-loader';

      return `
        <tr style="animation-delay:${i*0.03}s">
          <td>${i+1}</td>
          <td>${e.tanggal_carian || '-'}</td>
          <td>${e.tanggal_kirim || '-'}</td>
          <td class="text-main">${e.nama}</td>
          <td><span class="badge ${jabatanBadge}">${jabatan}</span></td>
          <td><code style="background:rgba(245,158,11,0.08);color:#B45309;padding:2px 8px;border-radius:5px;font-size:12px;font-family:monospace;">${e.no_polisi || '-'}</code></td>
          <td>${e.zona || '-'}</td>
          <td title="${clusters.join(', ')}">${clusterPreview || '-'}</td>
          <td style="font-size:12px;">${ngParts.join('<br>') || '-'}</td>
          <td class="text-main">${(e.jumlah_kontainer || 0).toLocaleString('id-ID')} <span style="font-size:11px;color:var(--text-muted)">kont.</span></td>
          <td>${formatDateTime(e.created_at)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-icon btn-view" onclick="viewLoaderDetail('${e.id}')" title="Lihat detail">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button class="btn-icon btn-del" onclick="deleteLoaderEntry('${e.id}')" title="Hapus">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
    document.getElementById('loaderPageInfo').textContent = `${filteredLoaderEntries.length} entry loader`;
  }

  function filterLoaderTable() {
    const q = document.getElementById('loaderSearchInput').value.toLowerCase();
    filteredLoaderEntries = allLoaderEntries.filter(e =>
      (e.nama || '').toLowerCase().includes(q) ||
      (e.no_polisi || '').toLowerCase().includes(q) ||
      (e.zona || '').toLowerCase().includes(q)
    );
    renderLoaderTable();
  }

  async function deleteLoaderEntry(id) {
    const confirmed = await showConfirmModal({
      title: 'Hapus Entry Loader',
      message: 'Apakah Anda yakin ingin menghapus entry loader ini?',
      icon: '🗑️',
      okText: 'Hapus',
      okClass: 'btn-danger'
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/loader-entries/${id}`, { method: 'DELETE' }).then(r => r.json());
      if (res.success) { showToast('Entry berhasil dihapus.', 'success'); await loadLoaderEntries(); }
      else showToast('Gagal menghapus.', 'error');
    } catch(err) { showToast('Gagal menghapus.', 'error'); }
  }

  async function viewLoaderDetail(id) {
    const titleEl = document.getElementById('detailModalTitle');
    if (titleEl) titleEl.textContent = 'Detail Entry Loader';
    document.getElementById('modalBody').innerHTML = '<div class="loading-spinner"><div class="spin"></div></div>';
    document.getElementById('detailModal').classList.add('visible');
    try {
      const data = await fetch(`/api/loader-entries/${id}`).then(r => r.json());
      let clusterList = [];
      if (Array.isArray(data.clusters)) {
        clusterList = data.clusters;
      } else if (data.clusters && typeof data.clusters === 'object') {
        clusterList = data.clusters.list || [];
      }
      const ng = data.non_group || {};
      const ngParts = [];
      if (ng.gacoan > 0) ngParts.push(`Gacoan: ${ng.gacoan} kontainer`);
      if (ng.dikichi > 0) ngParts.push(`Dikichi: ${ng.dikichi} kontainer`);
      if (ng.benfarm > 0) ngParts.push(`Benfarm: ${ng.benfarm} kontainer`);

      document.getElementById('modalBody').innerHTML = `
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-key">Tanggal Carian</div><div class="detail-value">${data.tanggal_carian}</div></div>
          <div class="detail-item"><div class="detail-key">Tanggal Kirim</div><div class="detail-value">${data.tanggal_kirim}</div></div>
          <div class="detail-item full"><div class="detail-key">Nama</div><div class="detail-value">${data.nama}</div></div>
          <div class="detail-item"><div class="detail-key">No. Polisi</div><div class="detail-value">${data.no_polisi || '-'}</div></div>
          <div class="detail-item"><div class="detail-key">Zona</div><div class="detail-value">${data.zona || '-'}</div></div>
          <div class="detail-item"><div class="detail-key">Total Kontainer</div><div class="detail-value">${data.jumlah_kontainer.toLocaleString('id-ID')} kontainer</div></div>
          <div class="detail-item full">
            <div class="detail-key">Cluster / Group Mobil</div>
            <div class="batch-tags">${clusterList.map(b => `<span class="batch-tag">${b}</span>`).join('') || '-'}</div>
          </div>
          <div class="detail-item full">
            <div class="detail-key">Non-Group</div>
            <div class="detail-value">${ngParts.join(', ') || '-'}</div>
          </div>
          ${data.catatan ? `<div class="detail-item full"><div class="detail-key">Catatan</div><div class="detail-value">${data.catatan}</div></div>` : ''}
          <div class="detail-item full"><div class="detail-key">Waktu Submit</div><div class="detail-value">${formatDateTime(data.created_at)}</div></div>
        </div>`;
    } catch (err) {
      document.getElementById('modalBody').innerHTML = '<p style="color:var(--error)">Gagal memuat detail.</p>';
    }
  }

  function exportLoaderExcel() {
    const tanggal = document.getElementById('loaderDateFilter').value;
    window.location.href = tanggal ? `/api/export-loader?tanggal_carian=${tanggal}` : '/api/export-loader';
  }

  // ============= EXPORT & PUSH DATA CARIAN =============
  function exportDataCarian() {
    const tanggal = document.getElementById('dcDateFilter').value;
    window.location.href = tanggal ? `/api/export-data-carian?tanggal=${tanggal}` : '/api/export-data-carian';
  }

  async function pushDataCarianToSheets() {
    const btn = document.getElementById('btnPushDCSheets');
    if (!btn) return;
    const tanggal = document.getElementById('dcDateFilter').value;
    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg width="14" height="14" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24" class="spin" style="display:inline-block;"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Mengirim...`;
    try {
      const res = await fetch('/api/data-carian/push-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tanggal: tanggal || undefined })
      }).then(r => r.json());
      if (res.success) {
        showToast(`✅ ${res.message}`, 'success');
      } else {
        showToast('❌ ' + res.message, 'error');
      }
    } catch(e) {
      showToast('Gagal koneksi ke server.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHTML;
    }
  }


  // ============= EXPORT =============
  function exportExcel() {
    if (typeof currentView !== 'undefined' && currentView === 'data-carian') {
      exportDataCarian();
    } else if (typeof currentView !== 'undefined' && currentView === 'loader') {
      exportLoaderExcel();
    } else {
      const params = getExportFilterParams();
      window.location.href = '/api/export' + (params ? '?' + params : '');
    }
  }
  function exportCSV() {
    const params = getExportFilterParams();
    window.location.href = '/api/export-csv' + (params ? '?' + params : '');
  }
  function getExportFilterParams() {
    const mulai  = document.getElementById('efTanggalMulai')  ? document.getElementById('efTanggalMulai').value  : '';
    const akhir  = document.getElementById('efTanggalAkhir')  ? document.getElementById('efTanggalAkhir').value  : '';
    const posisi = document.getElementById('efPosisi')         ? document.getElementById('efPosisi').value         : '';
    const status = document.getElementById('efStatus')         ? document.getElementById('efStatus').value         : '';
    const parts = [];
    if (mulai)  parts.push('tanggal_mulai=' + mulai);
    if (akhir)  parts.push('tanggal_akhir=' + akhir);
    if (posisi && posisi !== 'semua') parts.push('posisi=' + encodeURIComponent(posisi));
    if (status && status !== 'semua') parts.push('status=' + encodeURIComponent(status));
    return parts.join('&');
  }

  // ============= GOOGLE SHEETS =============
  let gsLastSyncTime = null;

  async function loadGSheetsStatus() {
    const statusEl = document.getElementById('gsStatusChip');
    const bodyEl   = document.getElementById('gsBody');
    if (!statusEl) return;
    statusEl.className = 'gs-status-chip checking';
    statusEl.innerHTML = `<div class="gs-status-dot"></div> Memeriksa...`;
    if (bodyEl) bodyEl.innerHTML = '<div class="loading-spinner"><div class="spin"></div></div>';
    try {
      // Timeout 15s untuk Vercel cold start
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch('/api/google-sheets/status', { signal: controller.signal }).then(r => r.json());
      clearTimeout(timeout);

      if (res.configured && res.connected) {
        statusEl.className = 'gs-status-chip connected';
        statusEl.innerHTML = `<div class="gs-status-dot on"></div> Terhubung`;
        // ✅ Inject template DULU, baru isi nilainya
        const tpl = document.getElementById('gsTplConnected');
        if (bodyEl && tpl) bodyEl.innerHTML = tpl.innerHTML;
        const t = document.getElementById('gsSpreadsheetTitle');
        const r = document.getElementById('gsRowCount');
        const u = document.getElementById('gsUrl');
        const m = document.getElementById('gsMessage');
        if (t) t.textContent = res.spreadsheetTitle || '-';
        if (r) r.textContent = (res.rowCount || 0).toLocaleString('id-ID') + ' baris data';
        if (u) { u.href = res.spreadsheetUrl || '#'; u.textContent = res.spreadsheetUrl || '-'; }
        if (m) m.textContent = res.message || '';
      } else if (res.configured && !res.connected) {
        statusEl.className = 'gs-status-chip disconnected';
        statusEl.innerHTML = `<div class="gs-status-dot off"></div> Gagal Koneksi`;
        showGSNotConfigured(res.message);
      } else {
        statusEl.className = 'gs-status-chip disconnected';
        statusEl.innerHTML = `<div class="gs-status-dot off"></div> Belum Dikonfigurasi`;
        showGSNotConfigured(null);
      }
    } catch(e) {
      statusEl.className = 'gs-status-chip disconnected';
      const isTimeout = e.name === 'AbortError';
      statusEl.innerHTML = `<div class="gs-status-dot off"></div> ${isTimeout ? 'Timeout' : 'Error'}`;
      if (bodyEl) bodyEl.innerHTML = `
        <div class="gs-not-configured">
          <div class="nc-icon">${isTimeout ? '⏱️' : '⚠️'}</div>
          <h3>${isTimeout ? 'Request timeout (>15 detik)' : 'Gagal terhubung ke server'}</h3>
          <p style="font-size:12px; color:var(--text-dim);">${e.message || 'Unknown error'}</p>
          <button class="btn btn-outline" onclick="loadGSheetsStatus()" style="margin-top:12px;">
            Coba Lagi
          </button>
        </div>`;
    }
  }

  function showGSNotConfigured(errorMsg) {
    const bodyEl = document.getElementById('gsBody');
    bodyEl.innerHTML = `
      <div class="gs-not-configured">
        <div class="nc-icon">📋</div>
        <h3>${errorMsg || 'Google Sheets belum dikonfigurasi'}</h3>
        <p>Tambahkan variabel berikut ke file <strong>.env</strong> untuk mengaktifkan integrasi Google Sheets:</p>
        <div class="gs-code">GOOGLE_SHEETS_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-account@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----</div>
        <p style="margin-top:14px; font-size:12px; color:var(--text-dim);">Hubungi administrator untuk panduan lengkap setup Google Service Account.</p>
      </div>`;
  }

  async function pushToGSheets() {
    const btn = document.getElementById('gsPushBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin" style="display:inline-block;"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Menyinkronkan...`;
    try {
      const mulai  = document.getElementById('gsTanggalMulai')  ? document.getElementById('gsTanggalMulai').value  : '';
      const akhir  = document.getElementById('gsTanggalAkhir')  ? document.getElementById('gsTanggalAkhir').value  : '';
      const posisi = document.getElementById('gsPosisiFilter')   ? document.getElementById('gsPosisiFilter').value   : 'semua';
      const res = await fetch('/api/google-sheets/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tanggal_mulai: mulai || undefined, tanggal_akhir: akhir || undefined, posisi: posisi !== 'semua' ? posisi : undefined })
      }).then(r => r.json());
      if (res.success) {
        gsLastSyncTime = new Date();
        showToast(`✅ ${res.message}`, 'success');
        document.getElementById('gsLastSyncLabel').textContent = 'Sync berhasil: ' + gsLastSyncTime.toLocaleTimeString('id-ID');
        await loadGSheetsStatus();
      } else {
        showToast('❌ ' + res.message, 'error');
      }
    } catch(e) {
      showToast('Gagal koneksi ke server.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg> Push ke Google Sheets`;
    }
  }

  // ============= LOGOUT =============
  async function logout() {
    const confirmed = await showConfirmModal({
      title: 'Konfirmasi Keluar',
      message: 'Apakah Anda yakin ingin keluar dari Admin Dashboard?',
      icon: '🚪',
      okText: 'Keluar',
      okClass: 'btn-danger'
    });
    if (!confirmed) return;
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  // ============= TOAST =============
  let toastTimer;
  function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    const icons = {
      success: '<svg width="18" height="18" fill="white" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
      error: '<svg width="18" height="18" fill="white" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
      warning: '<svg width="18" height="18" fill="white" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>'
    };
    toast.innerHTML = (icons[type] || '') + msg;
    toast.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
  }

  // ============= LOGIN SETTINGS =============
  async function loadLoginSettings() {
    try {
      const res = await fetch('/api/settings/login');
      if (!res.ok) throw new Error('Gagal mengambil data settings.');
      const data = await res.json();
      
      document.getElementById('lsHeroHeadlineLine1').value = data.hero_headline_line1 || '';
      document.getElementById('lsHeroHeadlineLine2').value = data.hero_headline_line2 || '';
      document.getElementById('lsHeroDescription').value = data.hero_description || '';
      document.getElementById('lsHeroQuote').value = data.hero_quote || '';
      document.getElementById('lsHeroQuoteAuthor').value = data.hero_quote_author || '';
      document.getElementById('lsFormTitle').value = data.form_title || '';
      document.getElementById('lsFormSubtitle').value = data.form_subtitle || '';
      document.getElementById('lsFooterText').value = data.footer_text || '';
    } catch (err) {
      showToast('❌ Gagal memuat pengaturan login.', 'error');
    }
  }

  async function saveLoginSettings(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('btnSaveLoginSettings');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    const payload = {
      hero_headline_line1: document.getElementById('lsHeroHeadlineLine1').value,
      hero_headline_line2: document.getElementById('lsHeroHeadlineLine2').value,
      hero_description: document.getElementById('lsHeroDescription').value,
      hero_quote: document.getElementById('lsHeroQuote').value,
      hero_quote_author: document.getElementById('lsHeroQuoteAuthor').value,
      form_title: document.getElementById('lsFormTitle').value,
      form_subtitle: document.getElementById('lsFormSubtitle').value,
      footer_text: document.getElementById('lsFooterText').value
    };

    try {
      const res = await fetch('/api/settings/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Pengaturan login berhasil disimpan!', 'success');
      } else {
        showToast('❌ Gagal menyimpan pengaturan: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      showToast('❌ Terjadi kesalahan jaringan.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Simpan Perubahan';
    }
  }



  // ============================================================
  // REKAP HARIAN PER TOKO
  // ============================================================

  let allRekapData = [];      // raw rows from API
  let filteredRekapData = []; // after search/filter
  let rekapZones = [];        // ordered zone list detected from data

  // Tipe lokasi ordering
  const ZONA_TIPE = z => {
    if (z.startsWith('F')) return 'Freezer';
    if (z.startsWith('R')) return 'Chiller';
    return 'Ambient';
  };
  const ZONA_ORDER = ['F1','F2','R1','R2','R3','R4','T1','T2','T3','T4','T5','T6','T7','T8'];
  const sortZona = (a, b) => {
    const ai = ZONA_ORDER.indexOf(a);
    const bi = ZONA_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  };

  async function loadRekapToko() {
    const tanggal = document.getElementById('rekapTglFilter').value;
    const tbody = document.getElementById('rekapTokoTbody');
    const thead = document.getElementById('rekapTokoThead');

    if (!tanggal) {
      thead.innerHTML = '';
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:60px 20px;color:#475569;">
        <div style="font-size:32px;margin-bottom:12px;">📅</div>
        <div style="font-size:15px;font-weight:600;">Pilih tanggal carian</div>
        <div style="font-size:13px;margin-top:6px;">Import Excel di menu Data Carian Harian terlebih dahulu</div>
      </td></tr>`;
      document.getElementById('rekapSummaryBar').style.display = 'none';
      document.getElementById('rekapPageInfo').textContent = '-';
      return;
    }

    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;"><div style="color:#475569;font-size:13px;">⏳ Memuat data rekap...</div></td></tr>`;

    try {
      const data = await fetch(`/api/rekap-toko?tanggal=${tanggal}`).then(r => r.json());
      allRekapData = Array.isArray(data) ? data : [];
      filteredRekapData = [...allRekapData];

      if (allRekapData.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:60px 20px;color:#475569;">
          <div style="font-size:32px;margin-bottom:12px;">📭</div>
          <div style="font-size:15px;font-weight:600;">Belum ada data rekap toko</div>
          <div style="font-size:13px;margin-top:6px;">Import Excel di menu Data Carian Harian terlebih dahulu, lalu refresh halaman ini</div>
        </td></tr>`;
        document.getElementById('rekapSummaryBar').style.display = 'none';
        document.getElementById('rekapPageInfo').textContent = '0 data';
        return;
      }

      // Build zone list from data
      const zonaSet = new Set(allRekapData.map(r => r.zona));
      rekapZones = [...zonaSet].sort(sortZona);

      // Populate group filter
      const groupSet = new Set(allRekapData.map(r => r.group_mob).filter(Boolean));
      const groupSel = document.getElementById('rekapGroupFilter');
      const curGroup = groupSel.value;
      groupSel.innerHTML = '<option value="">Semua Grup</option>' +
        [...groupSet].sort().map(g => `<option value="${g}" ${g===curGroup?'selected':''}>${g}</option>`).join('');

      // Title
      const dateLabel = new Date(tanggal + 'T00:00:00').toLocaleDateString('id-ID', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
      document.getElementById('rekapTabelTitle').textContent = `SEMUA TOKO NASIONAL — ${dateLabel}`;

      updateRekapSummary();
      renderRekapTable();

    } catch(err) {
      console.error('loadRekapToko error:', err);
      showToast('Gagal memuat data rekap toko.', 'error');
    }
  }

  function filterRekapTable() {
    const q = document.getElementById('rekapSearchInput').value.toLowerCase().trim();
    const grp = document.getElementById('rekapGroupFilter').value;
    filteredRekapData = allRekapData.filter(r => {
      const matchQ = !q || r.nama_toko.toLowerCase().includes(q) || (r.group_mob||'').toLowerCase().includes(q);
      const matchG = !grp || r.group_mob === grp;
      return matchQ && matchG;
    });
    renderRekapTable();
  }

  function updateRekapSummary() {
    const bar = document.getElementById('rekapSummaryBar');
    // Count unique toko
    const tokoSet = new Set(allRekapData.map(r => r.nama_toko));
    const totalFreezer = allRekapData.filter(r => r.tipe_lokasi === 'Freezer').reduce((s,r) => s + (r.qty_target||0), 0);
    const totalChiller = allRekapData.filter(r => r.tipe_lokasi === 'Chiller').reduce((s,r) => s + (r.qty_target||0), 0);
    const totalAmbient = allRekapData.filter(r => r.tipe_lokasi === 'Ambient').reduce((s,r) => s + (r.qty_target||0), 0);
    const totalKont    = allRekapData.reduce((s,r) => s + (r.kont_target||0), 0);

    // Calculate actuals without double counting
    const uniqueZoneBatches = {};
    allRekapData.forEach(r => {
      const key = `${r.zona}|${r.batch}`;
      if (!uniqueZoneBatches[key]) {
        uniqueZoneBatches[key] = {
          tipe_lokasi: r.tipe_lokasi,
          actual_qty: r.actual_qty || 0,
          actual_kont: r.actual_kont || 0
        };
      }
    });

    let actFreezer = 0;
    let actChiller = 0;
    let actAmbient = 0;
    let actKont = 0;
    Object.values(uniqueZoneBatches).forEach(zb => {
      if (zb.tipe_lokasi === 'Freezer') actFreezer += zb.actual_qty;
      else if (zb.tipe_lokasi === 'Chiller') actChiller += zb.actual_qty;
      else if (zb.tipe_lokasi === 'Ambient') actAmbient += zb.actual_qty;
      actKont += zb.actual_kont;
    });

    document.getElementById('rekapTotalToko').textContent = tokoSet.size.toLocaleString('id-ID');

    // Update the chips with actual vs target
    const fChip = document.getElementById('rekapTotalFreezer').parentNode;
    fChip.innerHTML = `Act: <strong style="color:#60a5fa">${actFreezer.toLocaleString('id-ID')}</strong> / Tgt: <span id="rekapTotalFreezer">${totalFreezer.toLocaleString('id-ID')}</span> pcs Freezer`;

    const cChip = document.getElementById('rekapTotalChiller').parentNode;
    cChip.innerHTML = `Act: <strong style="color:#34d399">${actChiller.toLocaleString('id-ID')}</strong> / Tgt: <span id="rekapTotalChiller">${totalChiller.toLocaleString('id-ID')}</span> pcs Chiller`;

    const aChip = document.getElementById('rekapTotalAmbient').parentNode;
    aChip.innerHTML = `Act: <strong style="color:#fbbf24">${actAmbient.toLocaleString('id-ID')}</strong> / Tgt: <span id="rekapTotalAmbient">${totalAmbient.toLocaleString('id-ID')}</span> pcs Ambient`;

    const kChip = document.getElementById('rekapTotalKont').parentNode;
    kChip.innerHTML = `Act: <strong style="color:#c084fc">${actKont.toLocaleString('id-ID')}</strong> / Tgt: <span id="rekapTotalKont">${totalKont.toLocaleString('id-ID')}</span> kontainer`;

    bar.style.display = 'flex';
  }

  function renderRekapTable() {
    const thead = document.getElementById('rekapTokoThead');
    const tbody = document.getElementById('rekapTokoTbody');

    // Group zones by tipe lokasi (Freezer → F*, Chiller → R*, Ambient → T*)
    const GROUPS = [
      { key: 'Freezer', label: '❄ FREEZER',  cls: 'grp-freezer', zonaCls: 'zona-freezer', prefix: 'F' },
      { key: 'Chiller', label: '🟢 CHILLER',  cls: 'grp-chiller', zonaCls: 'zona-chiller', prefix: 'R' },
      { key: 'Ambient', label: '☀ AMBIENT',  cls: 'grp-ambient', zonaCls: 'zona-ambient', prefix: 'T' },
    ];

    // Map each zone to its group
    const zonaByGroup = {};
    GROUPS.forEach(g => { zonaByGroup[g.key] = rekapZones.filter(z => z.startsWith(g.prefix)); });

    // Build lookup: "namaToko|zona" → { batch, qty_target, kont_target, actual_qty, actual_kont }
    const lookup = {};
    filteredRekapData.forEach(r => {
      const key = `${r.nama_toko}|||${r.zona}`;
      if (!lookup[key]) lookup[key] = [];
      lookup[key].push(r);
    });

    // Unique toko list (preserve order by nama_toko)
    const tokoMap = {};
    filteredRekapData.forEach(r => {
      if (!tokoMap[r.nama_toko]) tokoMap[r.nama_toko] = { group_mob: r.group_mob, kcc: r.kcc, ins: r.ins };
    });
    const tokoList = Object.entries(tokoMap).sort((a,b) => a[0].localeCompare(b[0]));

    // === BUILD HEADER (3 rows) ===
    let row1 = '<tr>';
    let row2 = '<tr>';
    let row3 = '<tr>';

    // Fixed columns — span 3 rows
    row1 += `<th class="grp-header sticky-col sticky-col-1" rowspan="3" style="text-align:left;padding:8px 12px;color:#94a3b8;">Nama Toko</th>`;
    row1 += `<th class="grp-header sticky-col sticky-col-2" rowspan="3" style="color:#94a3b8;">Grup</th>`;

    GROUPS.forEach(g => {
      const zones = zonaByGroup[g.key];
      if (!zones.length) return;
      const colspan = zones.length * 3; // Batch + QTY + KONT per zone
      row1 += `<th class="grp-header ${g.cls}" colspan="${colspan}">${g.label}</th>`;
      zones.forEach(z => {
        row2 += `<th class="zona-header ${g.zonaCls}" colspan="3">${z}</th>`;
        row3 += `<th class="sub-header">Batch</th>`;
        row3 += `<th class="sub-header">ACT / TGT</th>`;
        row3 += `<th class="sub-header col-kont">ACT / TGT</th>`;
      });
    });

    row1 += '</tr>'; row2 += '</tr>'; row3 += '</tr>';
    thead.innerHTML = row1 + row2 + row3;

    // === BUILD BODY ===
    if (!tokoList.length) {
      const totalCols = 2 + rekapZones.length * 3;
      tbody.innerHTML = `<tr><td colspan="${totalCols}" style="text-align:center;padding:40px;color:#475569;">
        <div style="font-size:26px;margin-bottom:10px;">🔍</div>
        <div>Tidak ada toko ditemukan</div>
      </td></tr>`;
      document.getElementById('rekapPageInfo').textContent = '0 toko';
      return;
    }

    const rows = tokoList.map(([namaToko, info], idx) => {
      const storeCode = info.kcc || '';
      const displayName = namaToko.replace(/\s*\[[^\]]+\]$/, '');

      let cells = `<td class="sticky-col sticky-col-1" style="border-right:1px solid #1e293b;">
        <div class="rekap-tabel-toko">
          <span class="toko-nama">${displayName}</span>
          ${storeCode ? `<span class="toko-kode">${storeCode}</span>` : ''}
        </div>
      </td>`;
      cells += `<td class="sticky-col sticky-col-2" style="text-align:center;border-right:2px solid #1e293b;">
        ${info.group_mob ? `<span class="rekap-group-badge">${info.group_mob}</span>` : '<span class="rekap-dash">—</span>'}
      </td>`;

      GROUPS.forEach(g => {
        const zones = zonaByGroup[g.key];
        if (!zones.length) return;
        zones.forEach(z => {
          const key = `${namaToko}|||${z}`;
          const rows = lookup[key] || [];
          if (rows.length === 0) {
            cells += `<td class="col-batch"><span class="rekap-dash">—</span></td>`;
            cells += `<td class="col-qty"><span class="rekap-dash">—</span></td>`;
            cells += `<td class="col-kont"><span class="rekap-dash">—</span></td>`;
          } else {
            // Combine multiple batches for same zona
            const batchNums = [...new Set(rows.map(r => r.batch))].join(', ');
            const totalQty  = rows.reduce((s,r) => s + (r.qty_target||0), 0);
            const totalKont = rows.reduce((s,r) => s + (r.kont_target||0), 0);
            // Actual: deduplicate by batch agar tidak double-count
            const uniqueByBatch = [...new Map(rows.map(r => [r.batch, r])).values()];
            const actQty  = uniqueByBatch.reduce((s,r) => s + (r.actual_qty||0), 0);
            const actKont = uniqueByBatch.reduce((s,r) => s + (r.actual_kont||0), 0);
            const qtyColor  = actQty > 0 ? (actQty >= totalQty ? 'act-done' : 'act-partial') : 'act-none';
            const kontColor = actKont > 0 ? (actKont >= totalKont ? 'act-done' : 'act-partial') : 'act-none';

            cells += `<td class="col-batch">${batchNums || '—'}</td>`;

            if (totalQty > 0) {
              cells += `<td class="col-qty act-cell ${qtyColor}">`
                + `<span class="act-val">${actQty.toLocaleString('id-ID')}</span>`
                + `<span class="act-sep"> / </span>`
                + `<span class="tgt-val">${totalQty.toLocaleString('id-ID')}</span>`
                + (actQty >= totalQty ? `<span class="act-check">✓</span>` : '')
                + `</td>`;
            } else {
              cells += `<td class="col-qty"><span class="rekap-dash">—</span></td>`;
            }

            if (totalKont > 0) {
              cells += `<td class="col-kont act-cell ${kontColor}">`
                + `<span class="act-val">${actKont.toLocaleString('id-ID')}</span>`
                + `<span class="act-sep"> / </span>`
                + `<span class="kont-badge">${totalKont.toLocaleString('id-ID')}</span>`
                + (actKont >= totalKont ? `<span class="act-check">✓</span>` : '')
                + `</td>`;
            } else {
              cells += `<td class="col-kont"><span class="rekap-dash">—</span></td>`;
            }
          }
        });
      });

      return `<tr style="animation-delay:${idx*0.01}s">${cells}</tr>`;
    }).join('');

    // === CALCULATE ACTUALS PER ZONE FOR FOOTER ===
    const zoneActuals = {};
    rekapZones.forEach(z => {
      // Find unique batches for this zone
      const zoneRows = filteredRekapData.filter(r => r.zona === z);
      const batchSet = new Set(zoneRows.map(r => r.batch));
      let actQty = 0;
      let actKont = 0;
      batchSet.forEach(b => {
        const match = zoneRows.find(r => r.batch === b);
        if (match) {
          actQty += (match.actual_qty || 0);
          actKont += (match.actual_kont || 0);
        }
      });
      zoneActuals[z] = { qty: actQty, kont: actKont };
    });

    // === BUILD FOOTER ROWS ===
    let targetRow = `<tr class="rekap-footer-row footer-target">
      <td class="sticky-col sticky-col-1 font-semibold">TOTAL TARGET</td>
      <td class="sticky-col sticky-col-2 text-center">—</td>`;

    let actualRow = `<tr class="rekap-footer-row footer-actual">
      <td class="sticky-col sticky-col-1 font-semibold">TOTAL ACTUAL</td>
      <td class="sticky-col sticky-col-2 text-center">—</td>`;

    let pctRow = `<tr class="rekap-footer-row footer-pct">
      <td class="sticky-col sticky-col-1 font-semibold">PENCAPAIAN (%)</td>
      <td class="sticky-col sticky-col-2 text-center">—</td>`;

    GROUPS.forEach(g => {
      const zones = zonaByGroup[g.key];
      if (!zones.length) return;
      zones.forEach(z => {
        const zoneRows = filteredRekapData.filter(r => r.zona === z);
        const tgtQty = zoneRows.reduce((s,r) => s + (r.qty_target||0), 0);
        const tgtKont = zoneRows.reduce((s,r) => s + (r.kont_target||0), 0);

        const act = zoneActuals[z] || { qty: 0, kont: 0 };
        const actQty = act.qty;
        const actKont = act.kont;

        const pctQty = tgtQty > 0 ? Math.round((actQty / tgtQty) * 100) : 0;
        const pctKont = tgtKont > 0 ? Math.round((actKont / tgtKont) * 100) : 0;

        // Target cells
        targetRow += `<td class="col-batch">—</td>`;
        targetRow += `<td class="col-qty font-semibold">${tgtQty > 0 ? tgtQty.toLocaleString('id-ID') : '—'}</td>`;
        targetRow += `<td class="col-kont font-semibold">${tgtKont > 0 ? tgtKont.toLocaleString('id-ID') : '—'}</td>`;

        // Actual cells
        actualRow += `<td class="col-batch">—</td>`;
        actualRow += `<td class="col-qty font-semibold has-data">${actQty > 0 ? actQty.toLocaleString('id-ID') : '—'}</td>`;
        actualRow += `<td class="col-kont font-semibold"><span class="kont-badge${actKont === 0 ? ' kont-zero' : ''}">${actKont > 0 ? actKont.toLocaleString('id-ID') : '—'}</span></td>`;

        // Pct cells
        pctRow += `<td class="col-batch">—</td>`;
        pctRow += `<td class="col-qty font-semibold ${pctQty >= 100 ? 'text-success' : pctQty > 0 ? 'text-warning' : ''}">${pctQty > 0 ? pctQty + '%' : '—'}</td>`;
        pctRow += `<td class="col-kont font-semibold ${pctKont >= 100 ? 'text-success' : pctKont > 0 ? 'text-warning' : ''}">${pctKont > 0 ? pctKont + '%' : '—'}</td>`;
      });
    });

    targetRow += '</tr>';
    actualRow += '</tr>';
    pctRow += '</tr>';

    tbody.innerHTML = rows + targetRow + actualRow + pctRow;

    const tokoCount = tokoList.length;
    document.getElementById('rekapSubtitle').textContent = `${tokoCount} toko`;
    document.getElementById('rekapPageInfo').textContent =
      `Menampilkan ${tokoCount} dari ${new Set(allRekapData.map(r=>r.nama_toko)).size} toko`;
  }

  // ===== DARK MODE LOGIC =====
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
    if (icon) {
      if (isDark) {
        icon.innerHTML = '<path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>';
      } else {
        icon.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707M12 7a5 5 0 100 10 5 5 0 000-10z"/>';
      }
    }
  }

  // ===== LIGHTBOX MODAL =====
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

  // ===== REALTIME NOTIFICATIONS (Polling - menggantikan SSE agar hemat resource Vercel) =====
  let pollLastSeen = Date.now();
  let pollTimer = null;

  function initRealtimeNotifications() {
    if (pollTimer) clearInterval(pollTimer);
    pollLastSeen = Date.now();
    pollTimer = setInterval(pollNotifications, 15000); // cek setiap 15 detik
    console.log('[Poll] Notification polling started (every 15s)');
  }

  async function pollNotifications() {
    try {
      const res = await fetch(`/api/admin/updates-poll?since=${pollLastSeen}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.serverTime) pollLastSeen = data.serverTime;
      if (data.notifications && data.notifications.length > 0) {
        data.notifications.forEach(notif => {
          if (notif.type === 'new_submission') {
            playNotificationSound();
            showToast(`Submission PENDING baru dari ${notif.data.nama} (${notif.data.posisi})!`, 'warning');
          }
        });
        loadData();
      }
    } catch (e) {
      console.warn('[Poll] Notification poll failed:', e.message);
    }
  }

  function playNotificationSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      oscillator.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.12); // A5
      
      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.35);
    } catch(e) {
      // Audio context might be blocked by user interaction policy
    }
  }

  // ===== AUDIT TRAIL LOGS =====
  let auditLogTimeout = null;
  function filterLogs() {
    clearTimeout(auditLogTimeout);
    auditLogTimeout = setTimeout(() => {
      loadAuditLogs(1);
    }, 400);
  }

  async function loadAuditLogs(page = 1) {
    const tbody = document.getElementById('auditLogsTableBody');
    const search = document.getElementById('logSearchInput').value.trim();
    if (tbody && page === 1 && !search) {
      tbody.innerHTML = '<tr><td colspan="4"><div class="loading-spinner"><div class="spin"></div></div></td></tr>';
    }
    try {
      const res = await fetch(`/api/audit-logs?page=${page}&limit=15&search=${encodeURIComponent(search)}`).then(r => r.json());
      const logs = res.logs || [];
      const total = res.total || 0;
      
      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:30px;">Tidak ada log ditemukan.</td></tr>';
        document.getElementById('logPageInfo').textContent = 'Menampilkan 0 log';
        document.getElementById('logPagination').innerHTML = '';
        return;
      }
      
      tbody.innerHTML = logs.map(l => {
        const dt = new Date(l.created_at);
        const dateStr = dt.toLocaleDateString('id-ID', { year:'numeric', month:'2-digit', day:'2-digit' }) + ' ' + 
                        dt.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Asia/Jakarta' });
        
        let actionClass = 'log-badge-other';
        const action = l.action || 'OTHER';
        if (action.includes('LOGIN')) actionClass = 'log-badge-login';
        else if (action.includes('ABSENSI')) actionClass = 'log-badge-absensi';
        else if (action.includes('CREATE')) actionClass = 'log-badge-create';
        else if (action.includes('UPDATE')) actionClass = 'log-badge-update';
        else if (action.includes('DELETE')) actionClass = 'log-badge-delete';
        else if (action.includes('PUSH')) actionClass = 'log-badge-sheets';
        else if (action.includes('IMPORT')) actionClass = 'log-badge-excel';

        return `<tr>
          <td style="white-space:nowrap;font-family:monospace;font-size:12px;">${dateStr}</td>
          <td><strong>${l.username}</strong></td>
          <td><span class="log-badge-action ${actionClass}">${action}</span></td>
          <td style="font-size:13px;color:var(--text-mid);">${l.details || '-'}</td>
        </tr>`;
      }).join('');
      
      const totalPages = Math.ceil(total / 15);
      const from = (page - 1) * 15 + 1;
      const to = Math.min(page * 15, total);
      document.getElementById('logPageInfo').textContent = `Menampilkan ${from}-${to} dari ${total} log`;
      
      let pagHtml = '';
      if (totalPages > 1) {
        if (page > 1) {
          pagHtml += `<button class="page-btn" onclick="loadAuditLogs(${page - 1})">‹</button>`;
        }
        for (let i = Math.max(1, page - 3); i <= Math.min(totalPages, page + 3); i++) {
          pagHtml += `<button class="page-btn${i === page ? ' active' : ''}" onclick="loadAuditLogs(${i})">${i}</button>`;
        }
        if (page < totalPages) {
          pagHtml += `<button class="page-btn" onclick="loadAuditLogs(${page + 1})">›</button>`;
        }
      }
      document.getElementById('logPagination').innerHTML = pagHtml;
    } catch(err) {
      console.error('loadAuditLogs error:', err);
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--error);padding:30px;">Gagal memuat log aktivitas.</td></tr>';
    }
  }

  // ===================== CUSTOM SELECTS =====================
  function initCustomSelects() {
    const selects = document.querySelectorAll('select.form-control');
    selects.forEach(select => {
      if (select.dataset.customSelectInitialized) return;
      select.dataset.customSelectInitialized = 'true';

      // Create wrapper
      const wrapper = document.createElement('div');
      wrapper.className = 'custom-select-wrapper';
      
      // Copy layout styles from select to wrapper
      if (select.style.width) {
        wrapper.style.width = select.style.width;
        wrapper.style.flexShrink = '0';
      }
      if (select.style.display) {
        wrapper.style.display = select.style.display;
      } else {
        wrapper.style.display = 'inline-block';
      }
      if (select.style.marginRight) wrapper.style.marginRight = select.style.marginRight;
      if (select.style.marginLeft) wrapper.style.marginLeft = select.style.marginLeft;
      if (select.style.marginTop) wrapper.style.marginTop = select.style.marginTop;
      if (select.style.marginBottom) wrapper.style.marginBottom = select.style.marginBottom;
      
      // Insert wrapper before select in DOM
      select.parentNode.insertBefore(wrapper, select);
      wrapper.appendChild(select);
      
      // Create trigger button
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'custom-select-trigger';
      
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

  // Expose to global scope
  window.loadRekapToko    = loadRekapToko;
  window.filterRekapTable = filterRekapTable;
  window.toggleDarkMode   = toggleDarkMode;
  window.closeLightbox    = closeLightbox;
  window.loadAuditLogs    = loadAuditLogs;
  window.filterLogs       = filterLogs;
  window.initCustomSelects = initCustomSelects;
  window.showPage         = showPage;
  window.loadStatusCarian = loadStatusCarian;
  window.openWAModal      = openWAModal;
  window.kirimReminderWA  = kirimReminderWA;

  // ============= WELCOME PAGE =============
  const PAGE_MENU_META = {
    dashboard:        { label: 'Dashboard MPP',         icon: '📊' },
    submissions:      { label: 'Submissions',            icon: '📋' },
    'data-carian':    { label: 'Carian Harian',          icon: '📈' },
    'rekap-toko':     { label: 'Rekap Harian',           icon: '🏪' },
    'status-carian':  { label: 'Status Input Carian',    icon: '✅' },
    users:            { label: 'Manajemen User',         icon: '👥' },
    absensi:          { label: 'Kehadiran Absensi',      icon: '📌' },
    'ketentuan-harga':  { label: 'Ketentuan Harga',        icon: '💰' },
    'rekap-pendapatan': { label: 'Rekap Pendapatan',        icon: '🏆' },
    announcements:      { label: 'Pengumuman',             icon: '📢' },
    export:           { label: 'Export Excel/CSV',       icon: '📥' },
    gsheets:          { label: 'Google Sheets',          icon: '📊' },
    'login-settings': { label: 'Tampilan Login',         icon: '🎨' },
    'admin-accounts': { label: 'Akun Administrator',     icon: '🔐' },
    'audit-logs':     { label: 'Log Aktivitas',          icon: '🕐' },
    'feature-guide':  { label: 'Panduan Fitur',          icon: '📖' },
  };

  function renderWelcomePage() {
    const nameEl = document.getElementById('welcomeAdminName');
    const dateEl = document.getElementById('welcomeDate');
    const gridEl = document.getElementById('welcomeMenuGrid');
    if (!gridEl) return;

    // Set name and date
    if (nameEl) nameEl.textContent = currentUser.nama_lengkap || currentUser.username || 'Admin';
    if (dateEl) {
      const now = new Date();
      dateEl.textContent = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    const isSuperAdmin = currentUser.username && currentUser.username.toLowerCase() === 'admin';
    const allowed = isSuperAdmin
      ? Object.keys(PAGE_MENU_META)
      : (currentUser.allowed_pages || []);

    gridEl.innerHTML = '';
    allowed.forEach(page => {
      const meta = PAGE_MENU_META[page];
      if (!meta) return;
      const card = document.createElement('div');
      card.style.cssText = 'cursor:pointer;background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;transition:all 0.2s;';
      card.innerHTML = `<span style="font-size:24px;">${meta.icon}</span><span style="font-size:13px;font-weight:600;color:var(--text-primary);">${meta.label}</span>`;
      card.onmouseover = () => { card.style.borderColor = 'var(--primary)'; card.style.transform = 'translateY(-2px)'; card.style.boxShadow = '0 4px 12px rgba(var(--primary-rgb),0.15)'; };
      card.onmouseout  = () => { card.style.borderColor = 'var(--border)'; card.style.transform = ''; card.style.boxShadow = ''; };
      card.onclick = () => showPage(page);
      gridEl.appendChild(card);
    });

    if (allowed.length === 0) {
      gridEl.innerHTML = '<p style="color:var(--text-muted);font-size:14px;grid-column:1/-1;text-align:center;padding:20px 0;">Belum ada halaman yang diberikan izin. Hubungi Super Admin.</p>';
    }
  }

  // ============= STATUS CARIAN =============
  let statusCarianData = { sudah: [], belum: [] };

  async function loadStatusCarian() {
    const datePicker = document.getElementById('statusCarianDate');
    if (!datePicker.value) {
      datePicker.value = new Date().toISOString().slice(0, 10);
    }
    const tanggal = datePicker.value;

    // Reset search inputs
    const searchSudah = document.getElementById('searchSudah');
    const searchBelum = document.getElementById('searchBelum');
    if (searchSudah) searchSudah.value = '';
    if (searchBelum) searchBelum.value = '';

    // Show loading state
    document.getElementById('sc-sudah-list').innerHTML = '<p style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px;">⏳ Memuat data...</p>';
    document.getElementById('sc-belum-list').innerHTML = '<p style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px;">⏳ Memuat data...</p>';

    try {
      const res = await fetch(`/api/status-carian?tanggal=${tanggal}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat');

      statusCarianData = data;

      // Update summary
      document.getElementById('sc-sudah-count').textContent = data.sudah.length;
      document.getElementById('sc-belum-count').textContent = data.belum.length;
      document.getElementById('sc-total-count').textContent = data.total_picker_sorter;

      // Update filter badge
      const badge = document.getElementById('sc-filter-badge');
      if (badge) {
        badge.style.display = 'inline-block';
        if (data.is_filtered_by_absensi) {
          badge.style.background = 'rgba(16,185,129,0.1)';
          badge.style.color = '#10B981';
          badge.style.border = '1px solid rgba(16,185,129,0.2)';
          badge.textContent = 'Filtered by Absensi (Hadir)';
        } else {
          badge.style.background = 'rgba(107,114,128,0.1)';
          badge.style.color = '#6B7280';
          badge.style.border = '1px solid rgba(107,114,128,0.2)';
          badge.textContent = 'All Active Employees (No Absensi)';
        }
      }

      // Render sudah list
      const sudahEl = document.getElementById('sc-sudah-list');
      if (data.sudah.length === 0) {
        sudahEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px;"><div style="font-size:32px;margin-bottom:8px;">📭</div>Belum ada karyawan yang menginput hari ini</div>';
      } else {
        sudahEl.innerHTML = data.sudah.map(u => {
          const waktu = u.waktu_submit ? new Date(u.waktu_submit).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—';
          return `<div class="user-status-card" data-name="${u.nama}" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;background:var(--card-bg);border:1px solid var(--border);margin-bottom:10px;box-shadow:0 2px 4px rgba(0,0,0,0.015);transition:all 0.2s;">
            <div style="width:38px;height:38px;border-radius:50%;background:rgba(16,185,129,0.08);color:#10B981;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;border:1px solid rgba(16,185,129,0.15);flex-shrink:0;">
              ${(u.nama || '?').charAt(0).toUpperCase()}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:14px;color:var(--text-primary);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.nama}</div>
              <span class="badge ${u.posisi === 'Picker' ? 'badge-picker' : 'badge-sorter'}">${u.posisi}</span>
            </div>
            <div style="flex-shrink:0;text-align:right;">
              <span class="badge badge-status-active" style="background:rgba(16,185,129,0.06);color:#047857;border:1px solid rgba(16,185,129,0.15);font-size:11px;padding:3px 8px;">
                <span class="status-dot" style="background:#10B981;width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:6px;"></span>
                ${waktu}
              </span>
            </div>
          </div>`;
        }).join('');
      }

      // Render belum list
      const belumEl = document.getElementById('sc-belum-list');
      if (data.belum.length === 0) {
        belumEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--success);font-size:13px;font-weight:600;"><div style="font-size:32px;margin-bottom:8px;">🎉</div>Hebat! Semua karyawan sudah input hari ini!</div>';
      } else {
        belumEl.innerHTML = data.belum.map(u => {
          const noHpBadge = u.nomor_hp 
            ? `<span style="font-size:11px;color:var(--text-secondary);background:var(--bg-secondary);padding:2px 6px;border-radius:4px;border:1px solid var(--border);">📱 ${u.nomor_hp}</span>` 
            : `<span style="font-size:11px;color:var(--error);background:rgba(239,68,68,0.05);padding:2px 6px;border-radius:4px;border:1px solid rgba(239,68,68,0.15);">⚠️ Belum ada no. HP</span>`;
          return `<div class="user-status-card" data-name="${u.nama}" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;background:var(--card-bg);border:1px solid var(--border);margin-bottom:10px;box-shadow:0 2px 4px rgba(0,0,0,0.015);transition:all 0.2s;">
            <div style="width:38px;height:38px;border-radius:50%;background:rgba(239,68,68,0.08);color:#EF4444;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;border:1px solid rgba(239,68,68,0.15);flex-shrink:0;">
              ${(u.nama || '?').charAt(0).toUpperCase()}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:14px;color:var(--text-primary);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.nama}</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span class="badge ${u.posisi === 'Picker' ? 'badge-picker' : 'badge-sorter'}">${u.posisi}</span>
                ${noHpBadge}
              </div>
            </div>
            <div style="flex-shrink:0;text-align:right;">
              <span class="badge badge-status-inactive" style="background:rgba(107,114,128,0.06);color:#4B5563;border:1px solid rgba(107,114,128,0.15);font-size:11px;padding:3px 8px;">
                Belum Input
              </span>
            </div>
          </div>`;
        }).join('');
      }

      // Add hover card animation styles dynamically
      document.querySelectorAll('.user-status-card').forEach(card => {
        card.onmouseover = () => { card.style.borderColor = 'var(--primary)'; card.style.transform = 'translateY(-1px)'; card.style.boxShadow = '0 4px 8px rgba(0,0,0,0.04)'; };
        card.onmouseout  = () => { card.style.borderColor = 'var(--border)'; card.style.transform = ''; card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.015)'; };
      });

      // Update WA button
      const btnWA = document.getElementById('btnKirimWA');
      if (btnWA) {
        const punya_hp = data.belum.filter(u => u.nomor_hp).length;
        btnWA.title = `${punya_hp} dari ${data.belum.length} orang yang belum input punya nomor HP`;
      }

    } catch (err) {
      console.error('loadStatusCarian error:', err);
      document.getElementById('sc-sudah-list').innerHTML = `<p style="text-align:center;padding:20px;color:var(--error);font-size:13px;">Gagal memuat: ${err.message}</p>`;
      document.getElementById('sc-belum-list').innerHTML = '';
    }
  }

  // Live filter function for search boxes
  function filterSudahBelum() {
    const querySudah = document.getElementById('searchSudah')?.value?.toLowerCase() || '';
    const queryBelum = document.getElementById('searchBelum')?.value?.toLowerCase() || '';

    document.querySelectorAll('#sc-sudah-list .user-status-card').forEach(card => {
      const name = card.getAttribute('data-name')?.toLowerCase() || '';
      card.style.display = name.includes(querySudah) ? 'flex' : 'none';
    });

    document.querySelectorAll('#sc-belum-list .user-status-card').forEach(card => {
      const name = card.getAttribute('data-name')?.toLowerCase() || '';
      card.style.display = name.includes(queryBelum) ? 'flex' : 'none';
    });
  }
  window.filterSudahBelum = filterSudahBelum;

  // ============= WA REMINDER =============
  function openWAModal() {
    const belumDenganHP = statusCarianData.belum.filter(u => u.nomor_hp);
    const countEl = document.getElementById('waRecipientCount');
    const listEl  = document.getElementById('waRecipientList');
    const resultEl = document.getElementById('waResultBanner');
    const pesanEl = document.getElementById('waPesanCustom');
    const selectAllCb = document.getElementById('waSelectAll');

    if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }
    if (pesanEl) pesanEl.value = '';
    if (selectAllCb) selectAllCb.checked = belumDenganHP.length > 0;

    if (listEl) {
      if (belumDenganHP.length === 0) {
        const total = statusCarianData.belum.length;
        listEl.innerHTML = total === 0
          ? '<span style="color:var(--success);font-weight:600;display:block;text-align:center;padding:20px;">🎉 Semua sudah menginput carian!</span>'
          : `<span style="color:var(--error);font-weight:600;display:block;text-align:center;padding:20px;">⚠️ Ada ${total} orang belum input, tapi tidak ada yang memiliki nomor HP di database. Silakan isi dulu nomor HP operasional di Manajemen User.</span>`;
      } else {
        listEl.innerHTML = belumDenganHP.map((u, i) =>
          `<label style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:10px;background:var(--card-bg);border:1px solid var(--border);cursor:pointer;margin:0;transition:border-color 0.2s;">
            <div style="display:flex;align-items:center;gap:10px;min-width:0;">
              <input type="checkbox" name="waSelectedUser" value="${u.username}" data-phone="${u.nomor_hp}" data-name="${u.nama}" checked style="cursor:pointer;width:16px;height:16px;accent-color:var(--primary);" onchange="updateWASelectionCount()">
              <div style="min-width:0;">
                <div style="font-weight:700;color:var(--text-primary);font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.nama}</div>
                <span class="badge ${u.posisi === 'Picker' ? 'badge-picker' : 'badge-sorter'}" style="font-size:10px;padding:1px 6px;">${u.posisi}</span>
              </div>
            </div>
            <span style="font-family:monospace;color:var(--text-secondary);font-size:12px;flex-shrink:0;">${u.nomor_hp}</span>
          </label>`
        ).join('');

        // Add visual feedback to checkboxes labels
        document.querySelectorAll('#waRecipientList label').forEach(label => {
          const cb = label.querySelector('input');
          cb.addEventListener('change', () => {
            label.style.borderColor = cb.checked ? 'var(--primary)' : 'var(--border)';
            label.style.background = cb.checked ? 'rgba(var(--primary-rgb),0.02)' : 'var(--card-bg)';
          });
          // initial style
          label.style.borderColor = cb.checked ? 'var(--primary)' : 'var(--border)';
          label.style.background = cb.checked ? 'rgba(var(--primary-rgb),0.02)' : 'var(--card-bg)';
        });
      }
    }

    updateWASelectionCount();
    openModal('waReminderModal');
  }

  function updateWASelectionCount() {
    const checked = document.querySelectorAll('input[name="waSelectedUser"]:checked');
    const total = document.querySelectorAll('input[name="waSelectedUser"]').length;
    
    const countEl = document.getElementById('waRecipientCount');
    if (countEl) countEl.textContent = checked.length;
    
    const selectAllCb = document.getElementById('waSelectAll');
    if (selectAllCb) {
      selectAllCb.checked = checked.length === total && total > 0;
      selectAllCb.indeterminate = checked.length > 0 && checked.length < total;
    }

    const btn = document.getElementById('btnKirimWAConfirm');
    if (btn) btn.disabled = checked.length === 0;
  }
  window.updateWASelectionCount = updateWASelectionCount;

  function toggleSelectAllWA(master) {
    const checkboxes = document.querySelectorAll('input[name="waSelectedUser"]');
    checkboxes.forEach(cb => {
      cb.checked = master.checked;
      const label = cb.closest('label');
      if (label) {
        label.style.borderColor = cb.checked ? 'var(--primary)' : 'var(--border)';
        label.style.background = cb.checked ? 'rgba(var(--primary-rgb),0.02)' : 'var(--card-bg)';
      }
    });
    updateWASelectionCount();
  }
  window.toggleSelectAllWA = toggleSelectAllWA;

  async function kirimReminderWA() {
    const checkedCheckboxes = document.querySelectorAll('input[name="waSelectedUser"]:checked');
    const targets = Array.from(checkedCheckboxes).map(cb => ({
      nomor_hp: cb.getAttribute('data-phone'),
      nama: cb.getAttribute('data-name')
    }));

    if (targets.length === 0) {
      showToast('Pilih minimal satu karyawan untuk dikirim reminder.', 'error');
      return;
    }

    const tanggal = document.getElementById('statusCarianDate')?.value || new Date().toISOString().slice(0, 10);
    const pesanCustom = document.getElementById('waPesanCustom')?.value?.trim() || '';

    const btn = document.getElementById('btnKirimWAConfirm');
    if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }

    const resultEl = document.getElementById('waResultBanner');

    try {
      const res = await fetch('/api/send-wa-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets,
          tanggal,
          pesan_custom: pesanCustom || null
        })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Gagal mengirim');

      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.style.background = data.successCount > 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
        resultEl.style.border = data.successCount > 0 ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(239,68,68,0.3)';
        resultEl.style.color = data.successCount > 0 ? 'var(--success)' : 'var(--error)';
        resultEl.textContent = `✅ ${data.successCount} berhasil dikirim, ❌ ${data.failCount} gagal.`;
      }

      showToast(`WA Reminder: ${data.successCount} berhasil, ${data.failCount} gagal`, data.successCount > 0 ? 'success' : 'error');

    } catch (err) {
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.style.background = 'rgba(239,68,68,0.1)';
        resultEl.style.border = '1px solid rgba(239,68,68,0.3)';
        resultEl.style.color = 'var(--error)';
        resultEl.textContent = `❌ Error: ${err.message}`;
      }
      showToast('Gagal mengirim WA: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> Kirim Sekarang';
      }
    }
  }


  // ===================== ANNOUNCEMENTS =====================

  async function loadAnnouncements() {
    const list = document.getElementById('announcementList');
    if (!list) return;
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);"><div style="font-size:28px;margin-bottom:10px;">⏳</div><div>Memuat...</div></div>`;
    try {
      const data = await fetch('/api/announcements/all').then(r => r.json());
      if (!Array.isArray(data) || data.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
          <div style="font-size:40px;margin-bottom:12px;">📭</div>
          <div style="font-weight:600;font-size:15px;">Belum ada pengumuman</div>
          <div style="font-size:13px;margin-top:6px;">Klik "Buat Pengumuman Baru" untuk memulai</div>
        </div>`;
        return;
      }
      list.innerHTML = data.map(ann => `
        <div class="ann-admin-card ${ann.is_active ? '' : 'inactive'}" id="ann-card-${ann.id}">
          <div class="ann-admin-emoji">${ann.emoji || '📢'}</div>
          <div class="ann-admin-body">
            <div class="ann-admin-title">${ann.title}</div>
            <div class="ann-admin-content">${autoLink(ann.content)}</div>
            <div class="ann-admin-meta">
              <span class="ann-type-badge ${ann.type}">${ann.type}</span>
              <span>${ann.is_active ? '🟢 Aktif' : '⚫ Nonaktif'}</span>
              <span>· ${new Date(ann.created_at).toLocaleDateString('id-ID', {day:'2-digit',month:'short',year:'numeric'})}</span>
            </div>
          </div>
          <div class="ann-admin-actions">
            <button class="ann-toggle-btn ${ann.is_active ? 'on' : ''}" title="${ann.is_active ? 'Nonaktifkan' : 'Aktifkan'}"
              onclick="toggleAnnouncement('${ann.id}', this)"></button>
            <button class="btn btn-outline" style="padding:5px 12px;font-size:11px;" onclick="editAnnouncement(${JSON.stringify(ann).replace(/"/g,'&quot;')})">Edit</button>
            <button class="btn" style="padding:5px 12px;font-size:11px;background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.3);"
              onclick="deleteAnnouncement('${ann.id}')">Hapus</button>
          </div>
        </div>`).join('');
    } catch (err) {
      list.innerHTML = `<div style="text-align:center;padding:40px;color:#f87171;">Gagal memuat pengumuman.</div>`;
    }
  }

  function buildAnnPreview() {
    const emoji   = document.getElementById('annEmoji')?.value || '📢';
    const title   = document.getElementById('annTitle')?.value || 'Judul Pengumuman';
    const content = document.getElementById('annContent')?.value || 'Isi pengumuman akan tampil di sini...';
    const type    = document.querySelector('input[name="annType"]:checked')?.value || 'info';
    const preview = document.getElementById('annPreview');
    if (!preview) return;
    preview.className = `ann-banner ${type}`;
    preview.innerHTML = `
      <div class="ann-banner-emoji">${emoji}</div>
      <div class="ann-banner-body">
        <div class="ann-banner-title">${title}</div>
        <div class="ann-banner-content">${autoLink(content)}</div>
      </div>`;
  }

  function openAnnouncementModal(ann = null) {
    document.getElementById('annId').value        = ann?.id || '';
    document.getElementById('annEmoji').value     = ann?.emoji   || '📢';
    document.getElementById('annTitle').value     = ann?.title   || '';
    document.getElementById('annContent').value   = ann?.content || '';
    document.getElementById('announcementModalTitle').textContent = ann ? 'Edit Pengumuman' : 'Buat Pengumuman Baru';
    const type = ann?.type || 'info';
    document.querySelectorAll('input[name="annType"]').forEach(r => { r.checked = r.value === type; });
    buildAnnPreview();
    const modal = document.getElementById('announcementModal');
    modal.classList.add('visible');
    // Live preview
    ['annEmoji','annTitle','annContent'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.oninput = buildAnnPreview; }
    });
    document.querySelectorAll('input[name="annType"]').forEach(r => { r.onchange = buildAnnPreview; });
  }
  window.openAnnouncementModal = openAnnouncementModal;

  function editAnnouncement(ann) {
    openAnnouncementModal(ann);
  }
  window.editAnnouncement = editAnnouncement;

  function closeAnnouncementModal() {
    closeModal('announcementModal');
  }
  window.closeAnnouncementModal = closeAnnouncementModal;

  async function saveAnnouncement() {
    const id      = document.getElementById('annId').value;
    const emoji   = document.getElementById('annEmoji').value.trim() || '📢';
    const title   = document.getElementById('annTitle').value.trim();
    const content = document.getElementById('annContent').value.trim();
    const type    = document.querySelector('input[name="annType"]:checked')?.value || 'info';
    if (!title || !content) { showToast('Judul dan isi pengumuman wajib diisi.', 'error'); return; }
    const btn = document.getElementById('annSaveBtn');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const url    = id ? `/api/announcements/${id}` : '/api/announcements';
      const method = id ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji, title, content, type })
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Gagal menyimpan');
      showToast(id ? 'Pengumuman diperbarui ✓' : 'Pengumuman berhasil dibuat ✓', 'success');
      closeAnnouncementModal();
      loadAnnouncements();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Simpan Pengumuman';
    }
  }
  window.saveAnnouncement = saveAnnouncement;

  async function toggleAnnouncement(id, btn) {
    try {
      const r = await fetch(`/api/announcements/${id}/toggle`, { method: 'PATCH' });
      if (!r.ok) throw new Error();
      const ann = await r.json();
      btn.classList.toggle('on', ann.is_active);
      btn.title = ann.is_active ? 'Nonaktifkan' : 'Aktifkan';
      const card = document.getElementById(`ann-card-${id}`);
      if (card) card.classList.toggle('inactive', !ann.is_active);
      const meta = card?.querySelector('.ann-admin-meta span:nth-child(2)');
      if (meta) meta.textContent = ann.is_active ? '🟢 Aktif' : '⚫ Nonaktif';
      showToast(ann.is_active ? 'Pengumuman diaktifkan' : 'Pengumuman dinonaktifkan', 'success');
    } catch { showToast('Gagal mengubah status pengumuman.', 'error'); }
  }
  window.toggleAnnouncement = toggleAnnouncement;

  async function deleteAnnouncement(id) {
    if (!confirm('Hapus pengumuman ini? Tidak bisa dibatalkan.')) return;
    try {
      const r = await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      showToast('Pengumuman dihapus.', 'success');
      loadAnnouncements();
    } catch { showToast('Gagal menghapus pengumuman.', 'error'); }
  }
  window.deleteAnnouncement = deleteAnnouncement;
  window.loadAnnouncements  = loadAnnouncements;

  // ============= MONITORING MPP =============

  // Helper: get local date as YYYY-MM-DD (avoids UTC timezone shift)
  function getLocalDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Helper: format tanggal YYYY-MM-DD → DD/MM/YYYY
  function fmtTgl(tgl) {
    if (!tgl) return '';
    const [y, m, d] = tgl.split('-');
    return `${d}/${m}/${y}`;
  }

  let allMPPData  = []; // Cache data pencapaian untuk filter client-side
  let mppIsRange  = false; // Apakah mode range atau single date

  // Helper: format Rupiah — desimal otomatis jika bukan bilangan bulat
  function fmtRp(val) {
    if (val === null || val === undefined) return null;
    const isDecimal = !Number.isInteger(val);
    return val.toLocaleString('id-ID', {
      minimumFractionDigits: isDecimal ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  // Toggle expand detail harian pada satu baris
  window.toggleMPPDetail = function(rowKey) {
    const btn = document.querySelector(`.mpp-expand-btn[data-key="${rowKey}"]`);
    const detailRows = document.querySelectorAll(`.mpp-detail-row[data-key="${rowKey}"]`);
    if (!detailRows.length) return;

    const isOpen = detailRows[0].style.display !== 'none';
    if (isOpen) {
      // Tutup
      detailRows.forEach(r => {
        r.classList.remove('is-animating');
        r.style.display = 'none';
      });
      if (btn) { btn.textContent = '▼'; btn.classList.remove('expanded'); }
    } else {
      // Buka dengan animasi
      detailRows.forEach(r => {
        r.style.display = '';
        // Reset animasi agar bisa re-trigger setiap kali dibuka
        r.classList.remove('is-animating');
        void r.offsetWidth; // force reflow
        r.classList.add('is-animating');
      });
      if (btn) { btn.textContent = '▲'; btn.classList.add('expanded'); }
    }
  };

  function renderMPPTable(list, isRange) {
    const tbody = document.getElementById('mppPencapaianBody');
    if (!tbody) return;

    // Tampilkan/sembunyikan kolom expand
    const expandHead = document.getElementById('mppExpandColHead');
    if (expandHead) expandHead.style.display = isRange ? '' : 'none';

    const posisiBadgeColor = { 'Picker': '#8b5cf6', 'Sorter': '#10b981', 'Loader': '#f59e0b' };

    if (!list || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${isRange ? 8 : 7}" style="text-align:center; padding:32px; color:var(--text-secondary); font-size:13px;">
        <div style="font-size:32px; margin-bottom:10px;">🔍</div>
        Tidak ada data yang cocok dengan filter.</td></tr>`;
      return;
    }

    let totalNilaiGrand = 0;
    let html = '';

    list.forEach((p, i) => {
      const color    = posisiBadgeColor[p.posisi] || '#6b7280';
      const hargaStr = p.harga_satuan !== null
        ? `Rp ${fmtRp(p.harga_satuan)}`
        : '<span style="color:var(--text-secondary); font-style:italic;">Belum diset</span>';
      const nilaiStr = p.total_nilai !== null
        ? `<b style="color:var(--success);">Rp ${fmtRp(p.total_nilai)}</b>`
        : '<span style="color:var(--text-secondary); font-style:italic;">—</span>';
      if (p.total_nilai) totalNilaiGrand += p.total_nilai;

      // Key unik per baris berdasarkan nama+posisi+zona
      const rowKey = encodeURIComponent(`${p.nama}|${p.posisi}|${p.zona}`);

      // Kolom expand hanya ada saat mode range DAN pekerja punya detail harian
      const hasDetail = isRange && p.detail_harian && p.detail_harian.length >= 1;
      const expandCell = isRange
        ? `<td class="mpp-expand-col">${hasDetail
            ? `<button class="mpp-expand-btn" data-key="${rowKey}" onclick="toggleMPPDetail('${rowKey}')" title="Lihat detail per tanggal">▼</button>`
            : ''}</td>`
        : '';

      // Baris utama
      html += `<tr class="mpp-main-row">
        ${expandCell}
        <td><b>${p.nama}</b></td>
        <td><span class="badge" style="background:${color}20; color:${color}; font-size:11px; padding:3px 8px; border-radius:8px;">${p.posisi}</span></td>
        <td style="font-size:12px;">${p.zona}</td>
        <td style="font-weight:700;">${p.pencapaian.toLocaleString('id-ID')}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${p.satuan}</td>
        <td>${hargaStr}</td>
        <td>${nilaiStr}</td>
      </tr>`;

      // Pre-render baris detail (hidden) langsung setelah baris utama
      if (hasDetail) {
        p.detail_harian.forEach(dh => {
          const dNilaiStr = dh.total_nilai !== null
            ? `<span class="mpp-detail-nilai">Rp ${fmtRp(dh.total_nilai)}</span>`
            : '<span style="color:var(--text-secondary);">—</span>';
          html += `<tr class="mpp-detail-row" data-key="${rowKey}" style="display:none;">
            <td colspan="${isRange ? 8 : 7}">
              <div class="mpp-detail-inner">
                <span class="mpp-detail-date-badge">📅 ${fmtTgl(dh.tanggal)}</span>
                <span class="mpp-detail-val">${dh.pencapaian.toLocaleString('id-ID')} <span style="font-size:10px;font-weight:500;color:var(--text-secondary);">${p.satuan}</span></span>
                ${dNilaiStr}
              </div>
            </td>
          </tr>`;
        });
      }
    });

    // Baris total
    const colspanTotal = isRange ? 7 : 6;
    html += `<tr style="background:rgba(99,102,241,0.06); font-weight:700; border-top:2px solid var(--border);">
      <td colspan="${colspanTotal}" style="text-align:right; padding-right:16px; font-size:13px;">TOTAL NILAI SELURUH PEKERJA</td>
      <td style="color:var(--primary); font-size:14px;">Rp ${fmtRp(totalNilaiGrand)}</td>
    </tr>`;

    tbody.innerHTML = html;
  }

  window.filterMPPTable = function() {
    const q      = (document.getElementById('mppSearchNama')?.value || '').toLowerCase().trim();
    const posisi = document.getElementById('mppFilterPosisi')?.value || '';
    const filtered = allMPPData.filter(p => {
      const matchNama  = !q      || p.nama.toLowerCase().includes(q);
      const matchPosisi = !posisi || p.posisi === posisi;
      return matchNama && matchPosisi;
    });
    renderMPPTable(filtered, mppIsRange);
  };

  async function loadMonitoringMPP() {
    const fromEl = document.getElementById('mppDateFrom');
    const toEl   = document.getElementById('mppDateTo');
    if (!fromEl || !toEl) return;

    // Default: hari ini untuk keduanya
    const today = getLocalDateString();
    if (!fromEl.value) fromEl.value = today;
    if (!toEl.value)   toEl.value   = fromEl.value;

    // Pastikan "Sampai" tidak lebih awal dari "Dari"
    if (toEl.value < fromEl.value) toEl.value = fromEl.value;

    const tanggalMulai = fromEl.value;
    const tanggalAkhir = toEl.value;
    const isRange = tanggalMulai !== tanggalAkhir;
    mppIsRange = isRange;

    // Update label MPP Today / MPP Periode
    const labelEl    = document.getElementById('mppTodayLabel');
    const labelSubEl = document.getElementById('mppTodayLabelSub');
    const totalLabel = document.getElementById('mpp-today-total-label');
    const heroDesc   = document.getElementById('mppHeroDesc');
    const subIds     = ['mpp-today-sub-picker', 'mpp-today-sub-sorter', 'mpp-today-sub-loader', 'mpp-today-sub-total'];

    if (isRange) {
      if (labelEl)    labelEl.childNodes[0].textContent = 'MPP PERIODE ';
      if (labelSubEl) labelSubEl.textContent = `— Rata-rata Hadir (${fmtTgl(tanggalMulai)} – ${fmtTgl(tanggalAkhir)})`;
      if (totalLabel) totalLabel.textContent = 'TOTAL MPP PERIODE';
      if (heroDesc)   heroDesc.textContent   = 'MPP All = total user operasional aktif · MPP Periode = rata-rata kehadiran harian dalam rentang tanggal dipilih';
      subIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = 'Rata-rata/hari';
      });
    } else {
      if (labelEl)    labelEl.childNodes[0].textContent = 'MPP TODAY ';
      if (labelSubEl) labelSubEl.textContent = '— Hadir Sesuai Absensi';
      if (totalLabel) totalLabel.textContent = 'TOTAL MPP TODAY';
      if (heroDesc)   heroDesc.textContent   = 'MPP All = total user operasional aktif \u00a0·\u00a0 MPP Today = hadir sesuai absensi pada tanggal dipilih';
      subIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = id.includes('total') ? 'Semua posisi' : 'Hadir hari ini';
      });
    }

    // Reset filter
    const searchEl = document.getElementById('mppSearchNama');
    const posisiEl = document.getElementById('mppFilterPosisi');
    if (searchEl) searchEl.value = '';
    if (posisiEl) posisiEl.value = '';

    // Reset stats ke loading state
    ['mpp-all-picker','mpp-all-sorter','mpp-all-loader','mpp-all-total',
     'mpp-today-picker','mpp-today-sorter','mpp-today-loader','mpp-today-total'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    const tbody    = document.getElementById('mppPencapaianBody');
    const colCount = isRange ? 8 : 7;
    if (tbody) tbody.innerHTML = `<tr><td colspan="${colCount}"><div class="loading-spinner"><div class="spin"></div></div></td></tr>`;
    const errBanner = document.getElementById('mppErrorBanner');
    if (errBanner) errBanner.style.display = 'none';

    try {
      const res  = await fetch(`/api/monitoring-mpp?tanggalMulai=${tanggalMulai}&tanggalAkhir=${tanggalAkhir}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat data.');

      // Update MPP All cards
      document.getElementById('mpp-all-picker').textContent = data.mpp_all.picker;
      document.getElementById('mpp-all-sorter').textContent = data.mpp_all.sorter;
      document.getElementById('mpp-all-loader').textContent = data.mpp_all.loader;
      document.getElementById('mpp-all-total').textContent  = data.mpp_all.total;

      // Update MPP Today / Periode cards
      document.getElementById('mpp-today-picker').textContent = data.mpp_today.picker;
      document.getElementById('mpp-today-sorter').textContent = data.mpp_today.sorter;
      document.getElementById('mpp-today-loader').textContent = data.mpp_today.loader;
      document.getElementById('mpp-today-total').textContent  = data.mpp_today.total;

      // Simpan ke cache lalu render
      allMPPData = data.pencapaian || [];
      if (allMPPData.length === 0) {
        const msg = isRange
          ? `Tidak ada data pencapaian untuk periode <b>${fmtTgl(tanggalMulai)}</b> – <b>${fmtTgl(tanggalAkhir)}</b>.`
          : `Tidak ada data pencapaian untuk tanggal <b>${fmtTgl(tanggalMulai)}</b>.`;
        tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; padding:32px; color:var(--text-secondary); font-size:13px;">
          <div style="font-size:32px; margin-bottom:10px;">📋</div>${msg}</td></tr>`;
      } else {
        renderMPPTable(allMPPData, isRange);
      }
    } catch (err) {
      console.error('loadMonitoringMPP error:', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; padding:20px; color:var(--error);">Gagal memuat data Monitoring MPP.</td></tr>`;
      if (errBanner) { errBanner.textContent = err.message; errBanner.style.display = 'block'; }
    }
  }
  window.loadMonitoringMPP = loadMonitoringMPP;
  // loadMonitoringMPP dipanggil via showPage('dashboard') — tidak perlu DOMContentLoaded terpisah


  // ============= REKAP PENDAPATAN =============

  let rpAllData = [];      // raw data from API (all pekerja)
  let rpFiltered = [];     // after client filter
  let rpGrandTotal = 0;

  const RP_POSISI_COLOR = {
    Picker: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
    Sorter: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
    Loader: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  };

  function rpFmt(val) {
    if (val === null || val === undefined) return '—';
    return 'Rp ' + Math.round(val).toLocaleString('id-ID');
  }

  function onRpModeChange() {
    const mode = document.getElementById('rpModePicker')?.value;
    const bulanWrap  = document.getElementById('rpBulanWrap');
    const customWrap = document.getElementById('rpCustomWrap');
    if (!bulanWrap || !customWrap) return;
    if (mode === 'bulan') {
      bulanWrap.style.display  = 'flex';
      customWrap.style.display = 'none';
    } else {
      bulanWrap.style.display  = 'none';
      customWrap.style.display = 'flex';
    }
    loadRekapPendapatan();
  }
  window.onRpModeChange = onRpModeChange;

  async function loadRekapPendapatan() {
    const mode = document.getElementById('rpModePicker')?.value || 'bulan';
    let url;
    let periodeLabel;

    if (mode === 'bulan') {
      const bulan = document.getElementById('rpBulanInput')?.value;
      if (!bulan) return;
      url = `/api/rekap-pendapatan?bulan=${bulan}`;
      const [y, m] = bulan.split('-');
      periodeLabel = new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    } else {
      const dari  = document.getElementById('rpTanggalMulai')?.value;
      const sampai = document.getElementById('rpTanggalAkhir')?.value;
      if (!dari || !sampai) return;
      url = `/api/rekap-pendapatan?tanggalMulai=${dari}&tanggalAkhir=${sampai}`;
      periodeLabel = `${dari} s/d ${sampai}`;
    }

    // Loading state
    const tbody = document.getElementById('rpTableBody');
    const podium = document.getElementById('rpPodium');
    const leaderList = document.getElementById('rpLeaderList');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px;"><div class="loading-spinner"><div class="spin"></div></div></td></tr>`;
    if (podium) podium.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:13px; padding:40px 0; width:100%;">⏳ Memuat leaderboard...</div>`;
    if (leaderList) leaderList.innerHTML = '';
    ['rpGrandTotal','rpTotalPicker','rpTotalSorter','rpTotalLoader','rpTotalPekerja'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = '—'; el.style.opacity = '0.5'; }
    });

    try {
      const res  = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat data.');

      rpAllData    = data.pekerja || [];
      rpGrandTotal = data.grand_total || 0;
      rpFiltered   = [...rpAllData];

      // Update summary cards dengan animasi count-up
      const animNum = (id, val, prefix = 'Rp ', suffix = '') => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.opacity = '1';
        const end = Math.round(val);
        const dur = 900;
        const start = performance.now();
        const tick = (now) => {
          const p = Math.min((now - start) / dur, 1);
          const ease = 1 - Math.pow(1 - p, 3);
          const cur = Math.round(end * ease);
          el.textContent = prefix + cur.toLocaleString('id-ID') + suffix;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };

      animNum('rpGrandTotal', rpGrandTotal);
      animNum('rpTotalPicker', data.total_by_posisi?.picker || 0);
      animNum('rpTotalSorter', data.total_by_posisi?.sorter || 0);
      animNum('rpTotalLoader', data.total_by_posisi?.loader || 0);
      const pekerjaEl = document.getElementById('rpTotalPekerja');
      if (pekerjaEl) { pekerjaEl.style.opacity = '1'; pekerjaEl.textContent = rpAllData.length; }

      const periodeEl = document.getElementById('rpPeriodeLabel');
      if (periodeEl) periodeEl.textContent = periodeLabel;

      // Render leaderboard
      rpRenderLeaderboard(data.leaderboard || []);

      // Render table
      rpRenderTable();

    } catch (err) {
      console.error('loadRekapPendapatan error:', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--error);">⚠️ Gagal memuat data: ${err.message}</td></tr>`;
      showToast('Gagal memuat rekap pendapatan.', 'error');
    }
  }
  window.loadRekapPendapatan = loadRekapPendapatan;

  function rpRenderLeaderboard(leaderboard) {
    const podiumEl    = document.getElementById('rpPodium');
    const leaderListEl = document.getElementById('rpLeaderList');
    if (!podiumEl) return;

    if (!leaderboard || leaderboard.length === 0) {
      podiumEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:13px; padding:40px 0; width:100%;">Tidak ada data untuk periode ini.</div>`;
      if (leaderListEl) leaderListEl.innerHTML = '';
      return;
    }

    const top3 = leaderboard.slice(0, 3);
    const podiumItems = [];
    if (top3[1]) {
      podiumItems.push({
        data: top3[1],
        cfg: { rank: 2, medal: '🥈', height: '130px', bg: 'linear-gradient(180deg,#94a3b8,#64748b)', label: '2nd', delay: '0.2s' }
      });
    }
    if (top3[0]) {
      podiumItems.push({
        data: top3[0],
        cfg: { rank: 1, medal: '🥇', height: '170px', bg: 'linear-gradient(180deg,#fbbf24,#d97706)', label: '1st', delay: '0s' }
      });
    }
    if (top3[2]) {
      podiumItems.push({
        data: top3[2],
        cfg: { rank: 3, medal: '🥉', height: '100px', bg: 'linear-gradient(180deg,#cd7c4a,#a05c2e)', label: '3rd', delay: '0.3s' }
      });
    }

    podiumEl.innerHTML = podiumItems.map(item => {
      const p = item.data;
      const cfg = item.cfg;
      const posColor = RP_POSISI_COLOR[p.posisi] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
      const pct = rpGrandTotal > 0 ? ((p.total_nilai / rpGrandTotal) * 100).toFixed(1) : 0;
      return `
        <div style="display:flex; flex-direction:column; align-items:center; flex:1; max-width:220px; animation:fadeInUp 0.5s ${cfg.delay} both;">
          <div style="font-size:13px; font-weight:700; color:var(--text-primary); text-align:center; margin-bottom:6px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${p.nama}">${p.nama}</div>
          <div style="background:${posColor.bg}; color:${posColor.text}; border:1px solid ${posColor.border}; font-size:10px; font-weight:700; padding:2px 8px; border-radius:20px; margin-bottom:8px;">${p.posisi}</div>
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px;">${rpFmt(p.total_nilai)}</div>
          <div style="width:100%; height:${cfg.height}; background:${cfg.bg}; border-radius:12px 12px 0 0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; box-shadow:0 4px 20px rgba(0,0,0,0.15); position:relative;">
            <div style="font-size:28px;">${cfg.medal}</div>
            <div style="font-size:16px; font-weight:800; color:#fff;">${cfg.label}</div>
            <div style="font-size:10px; color:rgba(255,255,255,0.8);">${pct}% dari total</div>
          </div>
        </div>`;
    }).join('');

    // Rank 4–10 list
    if (leaderListEl) {
      const rest = leaderboard.slice(3);
      if (rest.length === 0) { leaderListEl.innerHTML = ''; return; }
      leaderListEl.innerHTML = rest.map((p, i) => {
        const rank = i + 4;
        const pct = rpGrandTotal > 0 ? ((p.total_nilai / rpGrandTotal) * 100).toFixed(1) : 0;
        const posColor = RP_POSISI_COLOR[p.posisi] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
        return `
          <div style="display:flex; align-items:center; gap:14px; padding:12px 16px; background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; animation:fadeInUp 0.4s ${(i * 0.05).toFixed(2)}s both; transition:transform 0.15s,box-shadow 0.15s;" onmouseover="this.style.transform='translateX(4px)';this.style.boxShadow='0 4px 16px rgba(0,0,0,0.08)'" onmouseout="this.style.transform='translateX(0)';this.style.boxShadow='none'">
            <div style="width:32px; height:32px; border-radius:50%; background:var(--sidebar-bg); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; color:var(--text-muted); flex-shrink:0;">${rank}</div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:13px; font-weight:600; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.nama}</div>
              <div style="display:flex; align-items:center; gap:8px; margin-top:3px;">
                <span style="background:${posColor.bg}; color:${posColor.text}; font-size:10px; font-weight:700; padding:1px 7px; border-radius:20px;">${p.posisi}</span>
                <span style="font-size:11px; color:var(--text-muted);">${pct}% dari total</span>
              </div>
            </div>
            <div style="text-align:right; flex-shrink:0;">
              <div style="font-size:13px; font-weight:700; color:var(--success);">${rpFmt(p.total_nilai)}</div>
              <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">${p.total_pencapaian?.toLocaleString('id-ID') || '—'} unit</div>
            </div>
          </div>`;
      }).join('');
    }
  }

  function rpRenderTable() {
    const tbody = document.getElementById('rpTableBody');
    const infoEl = document.getElementById('rpTableInfo');
    if (!tbody) return;

    if (rpFiltered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted);">
        <div style="font-size:32px; margin-bottom:8px;">🔍</div>
        Tidak ada data yang cocok dengan filter.
      </td></tr>`;
      if (infoEl) infoEl.textContent = '0 pekerja';
      return;
    }

    if (infoEl) infoEl.textContent = `${rpFiltered.length} pekerja`;

    tbody.innerHTML = rpFiltered.map((p, i) => {
      const pct = rpGrandTotal > 0 ? ((p.total_nilai / rpGrandTotal) * 100) : 0;
      const pctBar = Math.min(pct, 100).toFixed(1);
      const posColor = RP_POSISI_COLOR[p.posisi] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
      const zonaRows = (p.zona_detail || []).map(z => `
        <tr style="background:var(--sidebar-bg);">
          <td></td>
          <td colspan="2" style="font-size:11px; color:var(--text-muted); padding-left:36px;">↳ ${z.zona}</td>
          <td style="text-align:right; font-size:11px; color:var(--text-muted);">${(z.pencapaian||0).toLocaleString('id-ID')} ${z.satuan||''}</td>
          <td style="text-align:right; font-size:11px; color:var(--text-muted);">${rpFmt(z.nilai)}</td>
          <td colspan="2"></td>
        </tr>`).join('');

      return `
        <tr style="animation:fadeInUp 0.3s ${Math.min(i * 0.03, 0.3).toFixed(2)}s both; cursor:pointer;" onclick="rpToggleDetail(this)" onmouseover="this.style.background='var(--sidebar-bg)'" onmouseout="this.style.background=''">
          <td style="text-align:center; font-weight:700; color:var(--text-muted);">${i + 1}</td>
          <td>
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:34px; height:34px; border-radius:50%; background:linear-gradient(135deg,${posColor.text}22,${posColor.text}44); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; color:${posColor.text}; flex-shrink:0;">${(p.nama||'?').charAt(0).toUpperCase()}</div>
              <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${p.nama}</div>
            </div>
          </td>
          <td><span style="background:${posColor.bg}; color:${posColor.text}; border:1px solid ${posColor.border}; font-size:11px; font-weight:700; padding:3px 9px; border-radius:20px;">${p.posisi}</span></td>
          <td style="text-align:right; font-size:13px; font-weight:600;">${(p.total_pencapaian||0).toLocaleString('id-ID')}</td>
          <td style="text-align:right; font-size:13px; font-weight:700; color:var(--success);">${rpFmt(p.total_nilai)}</td>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="flex:1; height:7px; background:var(--card-border); border-radius:10px; overflow:hidden;">
                <div style="height:100%; width:0%; background:linear-gradient(90deg,#7c3aed,#4f46e5); border-radius:10px; transition:width 1s ease; animation:rpBarGrow_${i} 1s 0.5s forwards;" data-width="${pctBar}%"></div>
              </div>
              <span style="font-size:11px; color:var(--text-muted); white-space:nowrap;">${pct.toFixed(1)}%</span>
            </div>
          </td>
          <td style="text-align:center;">
            <svg width="14" height="14" fill="none" stroke="var(--text-muted)" stroke-width="2" viewBox="0 0 24 24" class="rp-chevron" style="transition:transform 0.2s;"><path d="M19 9l-7 7-7-7"/></svg>
          </td>
        </tr>
        <tr class="rp-detail-row" style="display:none;">
          ${zonaRows ? `<td colspan="7" style="padding:0;">${zonaRows ? `<table style="width:100%;">${zonaRows}</table>` : ''}</td>` : `<td colspan="7" style="text-align:center; color:var(--text-muted); font-size:12px; padding:10px;">Tidak ada detail zona.</td>`}
        </tr>`;
    }).join('');

    // Animate progress bars
    requestAnimationFrame(() => {
      tbody.querySelectorAll('[data-width]').forEach(bar => {
        setTimeout(() => { bar.style.width = bar.dataset.width; }, 100);
      });
    });
  }

  function rpToggleDetail(row) {
    const next = row.nextElementSibling;
    const chevron = row.querySelector('.rp-chevron');
    if (!next || !next.classList.contains('rp-detail-row')) return;
    const isOpen = next.style.display !== 'none';
    next.style.display = isOpen ? 'none' : 'table-row';
    if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
  }
  window.rpToggleDetail = rpToggleDetail;

  function rpApplyFilter() {
    const q      = (document.getElementById('rpSearchInput')?.value || '').toLowerCase().trim();
    const posisi = document.getElementById('rpFilterPosisi')?.value || '';
    rpFiltered = rpAllData.filter(p => {
      const matchQ = !q || (p.nama||'').toLowerCase().includes(q);
      const matchP = !posisi || p.posisi === posisi;
      return matchQ && matchP;
    });

    // Update kartu Total Pekerja yang terfilter
    const pekerjaEl = document.getElementById('rpTotalPekerja');
    if (pekerjaEl) {
      pekerjaEl.textContent = rpFiltered.length;
    }

    // Render ulang Leaderboard agar ikut terfilter
    rpRenderLeaderboard(rpFiltered);

    // Render ulang tabel
    rpRenderTable();
  }
  window.rpApplyFilter = rpApplyFilter;

  async function exportRekapPendapatanExcel() {
    if (!rpFiltered.length) { showToast('Tidak ada data untuk diekspor.', 'warning'); return; }
    const mode = document.getElementById('rpModePicker')?.value || 'bulan';
    let url;
    if (mode === 'bulan') {
      const bulan = document.getElementById('rpBulanInput')?.value;
      if (!bulan) return;
      url = `/api/rekap-pendapatan/export?bulan=${bulan}`;
    } else {
      const dari   = document.getElementById('rpTanggalMulai')?.value;
      const sampai = document.getElementById('rpTanggalAkhir')?.value;
      if (!dari || !sampai) return;
      url = `/api/rekap-pendapatan/export?tanggalMulai=${dari}&tanggalAkhir=${sampai}`;
    }

    const posisi = document.getElementById('rpFilterPosisi')?.value || '';
    const search = document.getElementById('rpSearchInput')?.value || '';
    if (posisi) url += `&posisi=${encodeURIComponent(posisi)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    window.location.href = url;
  }
  window.exportRekapPendapatanExcel = exportRekapPendapatanExcel;

  // Init: set default bulan ke bulan ini
  (function initRpDefaults() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const bulanEl = document.getElementById('rpBulanInput');
    if (bulanEl && !bulanEl.value) bulanEl.value = `${y}-${m}`;
    const todayStr = now.toISOString().slice(0, 10);
    const mulaiEl  = document.getElementById('rpTanggalMulai');
    const akhirEl  = document.getElementById('rpTanggalAkhir');
    if (mulaiEl && !mulaiEl.value) mulaiEl.value = `${y}-${m}-01`;
    if (akhirEl && !akhirEl.value) akhirEl.value = todayStr;
  })();

  // ============= KETENTUAN HARGA =============

  const ZONA_BY_POSISI = {
    Picker: ['AMBIENT', 'CHILLER', 'FREEZER'],
    Sorter: ['AMBIENT', 'CHILLER', 'FREEZER'],
    Loader: ['AMBIENT, CHILLER, FREEZER']
  };

  function onHargaPosisiChange() {
    const posisi = document.getElementById('hargaPosisi').value;
    const zonaSelect = document.getElementById('hargaZona');
    const satuanInput = document.getElementById('hargaSatuan');
    zonaSelect.innerHTML = '<option value="">— Pilih Zona —</option>';

    if (posisi && ZONA_BY_POSISI[posisi]) {
      ZONA_BY_POSISI[posisi].forEach(z => {
        const opt = document.createElement('option');
        opt.value = z; opt.textContent = z;
        zonaSelect.appendChild(opt);
      });
      // Loader: auto-select & disable zona
      if (posisi === 'Loader') {
        zonaSelect.value = 'AMBIENT, CHILLER, FREEZER';
        zonaSelect.disabled = true;
      } else {
        zonaSelect.disabled = false;
      }
      satuanInput.value = posisi === 'Picker' ? 'pcs' : 'kontainer';
    } else {
      satuanInput.value = '';
      zonaSelect.disabled = false;
    }
  }
  window.onHargaPosisiChange = onHargaPosisiChange;

  async function loadKetentuanHarga() {
    const tbody = document.getElementById('hargaTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7"><div class="loading-spinner"><div class="spin"></div></div></td></tr>';
    try {
      const data = await fetch('/api/ketentuan-harga').then(r => r.json());
      if (!Array.isArray(data) || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--text-secondary); font-size:13px;"><div style="font-size:32px; margin-bottom:10px;">💰</div>Belum ada ketentuan harga. Tambahkan melalui form di sebelah kiri.</td></tr>';
        return;
      }
      const posisiBadgeColor = { 'Picker': '#8b5cf6', 'Sorter': '#10b981', 'Loader': '#f59e0b' };
      tbody.innerHTML = data.map(h => {
        const color = posisiBadgeColor[h.posisi] || '#6b7280';
        const updatedAt = h.updated_at ? new Date(h.updated_at).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) : '—';
        return `<tr>
          <td><span class="badge" style="background:${color}20; color:${color}; font-size:11px; padding:3px 8px; border-radius:8px;">${h.posisi}</span></td>
          <td style="font-size:12px;">${h.zona}</td>
          <td style="font-weight:700; color:var(--success);">Rp ${(h.harga || 0).toLocaleString('id-ID', { minimumFractionDigits: Number.isInteger(h.harga) ? 0 : 2, maximumFractionDigits: 2 })}</td>
          <td><span style="font-size:11px; color:var(--text-secondary);">${h.satuan}</span></td>
          <td style="font-size:12px; color:var(--text-secondary); max-width:160px;">${h.keterangan || '—'}</td>
          <td style="font-size:11px; color:var(--text-secondary);">${updatedAt}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-outline btn-icon" onclick="editHarga('${h.id}','${h.posisi}','${h.zona}',${h.harga},'${(h.keterangan||'').replace(/'/g,"\\'")}','${h.satuan}')" title="Edit">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn-danger btn-icon" onclick="deleteHarga('${h.id}')" title="Hapus">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--error);">Gagal memuat ketentuan harga.</td></tr>';
    }
  }
  window.loadKetentuanHarga = loadKetentuanHarga;

  async function submitHargaForm(e) {
    e.preventDefault();
    const editId    = document.getElementById('hargaEditId').value;
    const posisi    = document.getElementById('hargaPosisi').value;
    const zona      = document.getElementById('hargaZona').value;
    const harga     = document.getElementById('hargaNominal').value;
    const keterangan = document.getElementById('hargaKeterangan').value;
    const btn       = document.getElementById('hargaSubmitBtn');

    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      let res;
      if (editId) {
        res = await fetch(`/api/ketentuan-harga/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ harga: parseFloat(harga), keterangan })
        });
      } else {
        res = await fetch('/api/ketentuan-harga', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ posisi, zona, harga: parseFloat(harga), keterangan })
        });
      }
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menyimpan.');
      showToast(editId ? 'Ketentuan harga diperbarui!' : 'Ketentuan harga ditambahkan!', 'success');
      cancelHargaEdit();
      loadKetentuanHarga();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }
  window.submitHargaForm = submitHargaForm;

  function editHarga(id, posisi, zona, harga, keterangan, satuan) {
    document.getElementById('hargaEditId').value    = id;
    document.getElementById('hargaPosisi').value    = posisi;
    document.getElementById('hargaPosisi').disabled = true;
    onHargaPosisiChange();
    document.getElementById('hargaZona').value      = zona;
    document.getElementById('hargaZona').disabled   = true;
    document.getElementById('hargaNominal').value   = harga;
    document.getElementById('hargaSatuan').value    = satuan;
    document.getElementById('hargaKeterangan').value = keterangan;
    document.getElementById('hargaFormTitle').textContent = 'Edit Ketentuan Harga';
    document.getElementById('hargaSubmitBtn').innerHTML = '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg> Perbarui Harga';
    document.getElementById('hargaCancelEditBtn').style.display = 'inline-flex';
    document.getElementById('hargaNominal').focus();
    // Scroll form into view
    document.getElementById('hargaForm').closest('.table-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.editHarga = editHarga;

  function cancelHargaEdit() {
    document.getElementById('hargaEditId').value = '';
    document.getElementById('hargaForm').reset();
    document.getElementById('hargaPosisi').disabled = false;
    document.getElementById('hargaZona').disabled = false;
    document.getElementById('hargaZona').innerHTML = '<option value="">— Pilih zona dulu —</option>';
    document.getElementById('hargaSatuan').value = '';
    document.getElementById('hargaFormTitle').textContent = 'Tambah Ketentuan Harga';
    document.getElementById('hargaSubmitBtn').innerHTML = '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Simpan Ketentuan Harga';
    document.getElementById('hargaCancelEditBtn').style.display = 'none';
  }
  window.cancelHargaEdit = cancelHargaEdit;

  async function deleteHarga(id) {
    const confirmed = await showConfirmModal({
      title: 'Hapus Ketentuan Harga',
      message: 'Yakin ingin menghapus ketentuan harga ini? Tindakan tidak dapat dibatalkan.',
      icon: '🗑️', okText: 'Hapus', okClass: 'btn-danger'
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/ketentuan-harga/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Ketentuan harga dihapus.', 'success');
      loadKetentuanHarga();
    } catch { showToast('Gagal menghapus ketentuan harga.', 'error'); }
  }
  window.deleteHarga = deleteHarga;