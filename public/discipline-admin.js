'use strict';

(function () {
  function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDateId(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return escHtml(dateStr);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtDateTimeId(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return escHtml(isoStr);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  function notifyToast(msg, type = 'success') {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    } else {
      alert(msg);
    }
  }

  function getPointStatusBadge(status) {
    if (status === 'ACTIVE') return '<span class="disc-badge status-active">● Aktif</span>';
    if (status === 'EXPIRED') return '<span class="disc-badge status-expired">● Expired</span>';
    if (status === 'CANCELLED') return '<span class="disc-badge status-cancelled">✓ Dibatalkan</span>';
    return `<span class="disc-badge">${escHtml(status)}</span>`;
  }

  function getSeverityBadge(sev, requiresHr) {
    if (requiresHr || sev === 'CRITICAL') {
      return '<span class="disc-badge hr-review">⚠️ Perlu Review Atasan / HR</span>';
    }
    if (sev === 'HIGH') return '<span class="disc-badge sev-high">Tinggi</span>';
    if (sev === 'MEDIUM') return '<span class="disc-badge sev-medium">Sedang</span>';
    return '<span class="disc-badge sev-low">Ringan</span>';
  }

  function getKasusBadge(statusKasus) {
    const map = {
      OPEN: '<span class="disc-badge sev-low">Terbuka</span>',
      IN_REVIEW: '<span class="disc-badge appeal-pending">⏳ Menunggu Review Klarifikasi</span>',
      RESOLVED: '<span class="disc-badge appeal-approved">✓ Selesai Dibina</span>',
      NEED_HR_REVIEW: '<span class="disc-badge hr-review">⚠️ Perlu Review Atasan / HR</span>',
      CANCELLED: '<span class="disc-badge status-cancelled">Dibatalkan</span>'
    };
    return map[statusKasus] || `<span class="disc-badge">${escHtml(statusKasus)}</span>`;
  }

  function getAppealBadge(status) {
    if (status === 'PENDING') return '<span class="disc-badge appeal-pending">⏳ Menunggu Review</span>';
    if (status === 'APPROVED') return '<span class="disc-badge appeal-approved">✓ Diterima</span>';
    if (status === 'REJECTED') return '<span class="disc-badge appeal-rejected">✗ Ditolak</span>';
    return '';
  }

  const DisciplineAdminModule = {
    users: [],
    categories: [],
    settings: {},
    lastBaseDataFetchAt: 0,
    historyPage: 1,
    historyLimit: 15,
    currentHistoryItems: [],
    pendingConfirmFormData: null,

    renderPageSkeleton(container, badgeText, title, subtitle) {
      if (!container) return;
      container.innerHTML = `
        <div class="disc-hero">
          <div>
            <div class="disc-hero-badge">${badgeText}</div>
            <h1 class="disc-hero-title">${title}</h1>
            <p class="disc-hero-sub">${subtitle}</p>
          </div>
        </div>
        <div style="text-align:left;margin-bottom:14px;">
          <div class="disc-page-loader-banner">
            <span class="disc-page-loader-dot"></span>
            <span>Sedang memuat data Poin &amp; Disiplin...</span>
          </div>
        </div>
        <div class="disc-kpi-grid">
          ${[1, 2, 3, 4].map(() => `
            <div class="disc-kpi-card">
              <div class="disc-skeleton disc-skeleton-line" style="width:55%;"></div>
              <div class="disc-skeleton disc-skeleton-value" style="margin-top:6px;"></div>
              <div class="disc-skeleton disc-skeleton-line" style="width:75%;margin-top:6px;"></div>
            </div>
          `).join('')}
        </div>
        <div class="disc-card" style="padding:24px;">
          <div class="disc-skeleton disc-skeleton-line" style="width:35%;height:16px;margin-bottom:16px;"></div>
          <div class="disc-skeleton disc-skeleton-line" style="width:100%;height:42px;margin-bottom:12px;"></div>
          <div class="disc-skeleton disc-skeleton-line" style="width:92%;height:42px;margin-bottom:12px;"></div>
          <div class="disc-skeleton disc-skeleton-line" style="width:85%;height:42px;"></div>
        </div>
      `;
    },

    setDashboardContentLoading() {
      const barSkeleton = `
        <div style="display:flex;flex-direction:column;gap:12px;padding:6px 0;">
          <div>
            <div class="disc-skeleton disc-skeleton-line" style="width:48%;margin-bottom:6px;"></div>
            <div class="disc-skeleton" style="width:100%;height:8px;border-radius:99px;"></div>
          </div>
          <div>
            <div class="disc-skeleton disc-skeleton-line" style="width:62%;margin-bottom:6px;"></div>
            <div class="disc-skeleton" style="width:82%;height:8px;border-radius:99px;"></div>
          </div>
          <div>
            <div class="disc-skeleton disc-skeleton-line" style="width:40%;margin-bottom:6px;"></div>
            <div class="disc-skeleton" style="width:65%;height:8px;border-radius:99px;"></div>
          </div>
        </div>
      `;
      const listSkeleton = `
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div class="disc-skeleton" style="width:100%;height:52px;border-radius:12px;"></div>
          <div class="disc-skeleton" style="width:100%;height:52px;border-radius:12px;"></div>
        </div>
      `;
      const catEl = document.getElementById('discChartCategory');
      const trendEl = document.getElementById('discChartTrend');
      const posEl = document.getElementById('discChartPosisi');
      const expEl = document.getElementById('discListExpiring');
      const repEl = document.getElementById('discListRepeatCoaching');
      if (catEl) catEl.innerHTML = barSkeleton;
      if (posEl) posEl.innerHTML = barSkeleton;
      if (expEl) expEl.innerHTML = listSkeleton;
      if (repEl) repEl.innerHTML = listSkeleton;
      if (trendEl) {
        trendEl.innerHTML = [45, 70, 55, 85, 60, 90].map(h => `
          <div class="disc-trend-col">
            <div class="disc-skeleton" style="width:20px;height:10px;border-radius:4px;"></div>
            <div class="disc-trend-bar-wrap">
              <div class="disc-skeleton" style="width:100%;height:${h}%;border-radius:8px;"></div>
            </div>
            <div class="disc-skeleton" style="width:28px;height:10px;border-radius:4px;"></div>
          </div>
        `).join('');
      }
    },

    async ensureBaseData(force = false) {
      if (!force && this.users.length > 0 && this.categories.length > 0 && (Date.now() - this.lastBaseDataFetchAt < 25000)) {
        return;
      }
      try {
        const [uRes, cRes, sRes] = await Promise.all([
          fetch('/api/users', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
          fetch('/api/discipline/categories', { credentials: 'include' }).then(r => r.ok ? r.json() : { categories: [] }),
          fetch('/api/discipline/settings', { credentials: 'include' }).then(r => r.ok ? r.json() : { settings: {} })
        ]);
        this.users = (Array.isArray(uRes) ? uRes : []).filter(u => u.role !== 'admin' && u.is_active !== false);
        this.categories = cRes.categories || [];
        this.settings = sRes.settings || {};
        this.lastBaseDataFetchAt = Date.now();
      } catch (e) {
        console.error('ensureBaseData error:', e);
      }
    },

    // ===================== MPP WIDGET =====================
    async loadMppWidget() {
      try {
        const res = await fetch('/api/discipline/widget-summary', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const cards = data.cards || {};

        const monthEl = document.getElementById('discMppWidgetMonth');
        const appealEl = document.getElementById('discMppWidgetAppeals');
        const hrEl = document.getElementById('discMppWidgetHr');
        const navBadge = document.getElementById('nav-discipline-appeals-badge');

        if (monthEl) monthEl.textContent = `${cards.total_kejadian_bulan_ini || 0} kejadian bulan ini`;
        if (appealEl) appealEl.textContent = `${cards.klarifikasi_menunggu_review || 0} klarifikasi menunggu`;
        if (hrEl) {
          hrEl.textContent = `${cards.perlu_review_hr_count || 0} perlu review atasan`;
          hrEl.style.display = (cards.perlu_review_hr_count || 0) > 0 ? 'inline-flex' : 'none';
        }
        if (navBadge) {
          const cnt = cards.klarifikasi_menunggu_review || 0;
          navBadge.textContent = cnt;
          navBadge.style.display = cnt > 0 ? 'inline-block' : 'none';
        }
      } catch (e) {
        console.warn('loadMppWidget error:', e.message);
      }
    },

    // ===================== 1. DASHBOARD =====================
    async initDashboard() {
      const container = document.getElementById('page-discipline-dashboard');
      if (!container) return;

      if (!container.dataset.rendered && this.categories.length === 0) {
        this.renderPageSkeleton(
          container,
          '🛡️ Monitoring &amp; Pembinaan Kinerja',
          'Dashboard Poin &amp; Disiplin',
          'Pemantauan objektif catatan kinerja, analisis tren operasional, dan evaluasi pembinaan karyawan SS08.'
        );
      }

      await this.ensureBaseData();
      const uniqueCats = [...new Set(this.categories.map(c => c.nama_kategori))];

      if (!container.dataset.rendered) {
        container.innerHTML = `
          <div class="disc-hero">
            <div>
              <div class="disc-hero-badge">🛡️ Monitoring &amp; Pembinaan Kinerja</div>
              <h1 class="disc-hero-title">Dashboard Poin &amp; Disiplin</h1>
              <p class="disc-hero-sub">Pemantauan objektif catatan kinerja, analisis tren operasional, dan evaluasi pembinaan karyawan SS08.</p>
            </div>
            <div class="disc-hero-actions">
              <button class="disc-btn-hero" onclick="showPage('discipline-input')">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4"/></svg>
                Input Kejadian Baru
              </button>
              <button class="disc-btn-hero" style="background:rgba(255,255,255,0.16);color:#fff;border:1px solid rgba(255,255,255,0.3);" onclick="showPage('discipline-history')">
                Riwayat &amp; Export
              </button>
            </div>
          </div>

          <!-- Filter Bar -->
          <div class="disc-filter-card">
            <div class="disc-filter-grid">
              <div class="disc-field-group">
                <label class="disc-field-label">Dari Tanggal</label>
                <input type="date" id="discDashDateFrom" class="disc-input" onchange="DisciplineAdminModule.loadDashboardData()">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Sampai Tanggal</label>
                <input type="date" id="discDashDateTo" class="disc-input" onchange="DisciplineAdminModule.loadDashboardData()">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Posisi</label>
                <select id="discDashPosisi" class="disc-select" onchange="DisciplineAdminModule.loadDashboardData()">
                  <option value="all">Semua Posisi</option>
                  <option value="Picker">Picker</option>
                  <option value="Sorter">Sorter</option>
                  <option value="Loader">Loader</option>
                  <option value="Return">Return</option>
                  <option value="QC Outbound">QC Outbound</option>
                </select>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Kategori</label>
                <select id="discDashKategori" class="disc-select" data-searchable="true" onchange="DisciplineAdminModule.loadDashboardData()">
                  <option value="all">Semua Kategori</option>
                  ${uniqueCats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}
                </select>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Status Poin</label>
                <select id="discDashStatus" class="disc-select" onchange="DisciplineAdminModule.loadDashboardData()">
                  <option value="all">Semua Status</option>
                  <option value="ACTIVE">Poin Aktif</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="CANCELLED">Dibatalkan</option>
                </select>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Cari Karyawan</label>
                <input type="text" id="discDashUserSearch" class="disc-input" placeholder="Ketik nama..." oninput="DisciplineAdminModule.loadDashboardData()">
              </div>
            </div>
          </div>

          <!-- 4 Main Stat Cards -->
          <div class="disc-kpi-grid">
            <div class="disc-kpi-card">
              <div class="disc-kpi-top">
                <span class="disc-kpi-label">Total Kejadian Bulan Ini</span>
                <div class="disc-kpi-icon blue">📋</div>
              </div>
              <div class="disc-kpi-value" id="discKpiMonth">0</div>
              <div class="disc-kpi-sub">Tercatat pada bulan berjalan</div>
            </div>
            <div class="disc-kpi-card">
              <div class="disc-kpi-top">
                <span class="disc-kpi-label">Total Poin Aktif</span>
                <div class="disc-kpi-icon rose">⚡</div>
              </div>
              <div class="disc-kpi-value" id="discKpiActivePoints">0</div>
              <div class="disc-kpi-sub">Poin yang belum melewati masa berlaku</div>
            </div>
            <div class="disc-kpi-card">
              <div class="disc-kpi-top">
                <span class="disc-kpi-label">User Memiliki Poin Aktif</span>
                <div class="disc-kpi-icon amber">👥</div>
              </div>
              <div class="disc-kpi-value" id="discKpiActiveUsers">0</div>
              <div class="disc-kpi-sub">Karyawan dalam masa pembinaan aktif</div>
            </div>
            <div class="disc-kpi-card" style="cursor:pointer;" onclick="showPage('discipline-appeals')">
              <div class="disc-kpi-top">
                <span class="disc-kpi-label">Klarifikasi Menunggu Review</span>
                <div class="disc-kpi-icon purple">💬</div>
              </div>
              <div class="disc-kpi-value" id="discKpiPendingAppeals">0</div>
              <div class="disc-kpi-sub" style="color:var(--primary);font-weight:600;">Klik untuk tinjau pengajuan →</div>
            </div>
          </div>

          <!-- Analytics Grid Row 1 -->
          <div class="disc-analytics-grid">
            <div class="disc-card">
              <div class="disc-card-header">
                <div>
                  <div class="disc-card-title">📊 Kategori Kesalahan Terbanyak</div>
                  <div class="disc-card-sub">Distribusi frekuensi kejadian untuk fokus perbaikan SOP</div>
                </div>
              </div>
              <div id="discChartCategory" class="disc-bar-list"></div>
            </div>

            <div class="disc-card">
              <div class="disc-card-header">
                <div>
                  <div class="disc-card-title">📈 Trend Jumlah Kejadian per Bulan</div>
                  <div class="disc-card-sub">Perkembangan jumlah kejadian dalam 6 bulan terakhir</div>
                </div>
              </div>
              <div id="discChartTrend" class="disc-trend-chart"></div>
            </div>
          </div>

          <!-- Analytics Grid Row 2 -->
          <div class="disc-analytics-grid">
            <div class="disc-card">
              <div class="disc-card-header">
                <div>
                  <div class="disc-card-title">🏷️ Jumlah Kejadian per Posisi</div>
                  <div class="disc-card-sub">Perbandingan catatan kejadian antar divisi operasional</div>
                </div>
              </div>
              <div id="discChartPosisi" class="disc-bar-list"></div>
            </div>

            <div class="disc-card">
              <div class="disc-card-header">
                <div>
                  <div class="disc-card-title">⏳ Poin Aktif yang Akan Expired (30 Hari)</div>
                  <div class="disc-card-sub">Poin yang segera berakhir masa berlakunya</div>
                </div>
              </div>
              <div id="discListExpiring" class="disc-coaching-list"></div>
            </div>
          </div>

          <!-- Repeat Incident & Coaching Alert (Non-shaming, constructive coaching focus) -->
          <div class="disc-card" style="margin-bottom:24px;">
            <div class="disc-card-header">
              <div>
                <div class="disc-card-title">🩺 Monitoring Pembinaan &amp; Kejadian Berulang (30 Hari Terakhir)</div>
                <div class="disc-card-sub">Daftar karyawan yang memerlukan sesi pembinaan (coaching) atau review lebih lanjut oleh Atasan / HR</div>
              </div>
            </div>
            <div id="discListRepeatCoaching" class="disc-coaching-list"></div>
          </div>
        `;
        container.dataset.rendered = 'true';
      }

      if (typeof window.initCustomSelects === 'function') {
        window.initCustomSelects(container);
      }

      await this.loadDashboardData();
    },

    async loadDashboardData() {
      this.setDashboardContentLoading();
      try {
        const params = new URLSearchParams({
          date_from: document.getElementById('discDashDateFrom')?.value || '',
          date_to: document.getElementById('discDashDateTo')?.value || '',
          posisi: document.getElementById('discDashPosisi')?.value || 'all',
          kategori: document.getElementById('discDashKategori')?.value || 'all',
          status_poin: document.getElementById('discDashStatus')?.value || 'all',
          user_search: document.getElementById('discDashUserSearch')?.value || ''
        });
        const res = await fetch('/api/discipline/dashboard?' + params.toString(), { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();

        const c = data.cards || {};
        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl('discKpiMonth', c.total_kejadian_bulan_ini || 0);
        setEl('discKpiActivePoints', c.total_poin_aktif || 0);
        setEl('discKpiActiveUsers', c.user_memiliki_poin_aktif || 0);
        setEl('discKpiPendingAppeals', c.klarifikasi_menunggu_review || 0);

        const navBadge = document.getElementById('nav-discipline-appeals-badge');
        if (navBadge) {
          navBadge.textContent = c.klarifikasi_menunggu_review || 0;
          navBadge.style.display = (c.klarifikasi_menunggu_review || 0) > 0 ? 'inline-block' : 'none';
        }

        // 1. Render Category Bars
        const catEl = document.getElementById('discChartCategory');
        if (catEl) {
          const list = data.by_category || [];
          if (list.length === 0) {
            catEl.innerHTML = '<div style="text-align:center;padding:28px;color:var(--text-muted);font-size:13px;">Belum ada data kejadian pada filter ini.</div>';
          } else {
            const maxCnt = Math.max(...list.map(x => x.count), 1);
            catEl.innerHTML = list.map(item => {
              const pct = Math.round((item.count / maxCnt) * 100);
              return `
                <div class="disc-bar-item">
                  <div class="disc-bar-label-row">
                    <span>${escHtml(item.kategori)}</span>
                    <span style="color:var(--text-muted);">${item.count} kejadian (${item.total_poin} poin)</span>
                  </div>
                  <div class="disc-bar-track">
                    <div class="disc-bar-fill" style="width:${pct}%"></div>
                  </div>
                </div>
              `;
            }).join('');
          }
        }

        // 2. Render Monthly Trend
        const trendEl = document.getElementById('discChartTrend');
        if (trendEl) {
          const months = data.monthly_trend || [];
          const maxM = Math.max(...months.map(m => m.count), 1);
          trendEl.innerHTML = months.map(m => {
            const pct = Math.max(6, Math.round((m.count / maxM) * 100));
            return `
              <div class="disc-trend-col">
                <div class="disc-trend-val">${m.count}</div>
                <div class="disc-trend-bar-wrap">
                  <div class="disc-trend-bar" style="height:${pct}%" title="${escHtml(m.label)}: ${m.count} kejadian (${m.total_poin} poin)"></div>
                </div>
                <div class="disc-trend-label">${escHtml(m.label)}</div>
              </div>
            `;
          }).join('');
        }

        // 3. Render Posisi Breakdown
        const posEl = document.getElementById('discChartPosisi');
        if (posEl) {
          const posList = data.by_posisi || [];
          const maxP = Math.max(...posList.map(p => p.count), 1);
          posEl.innerHTML = posList.map(p => {
            const pct = Math.round((p.count / maxP) * 100);
            return `
              <div class="disc-bar-item">
                <div class="disc-bar-label-row">
                  <span>${escHtml(p.posisi)}</span>
                  <span style="color:var(--text-muted);">${p.count} kejadian • ${p.active_points} poin aktif</span>
                </div>
                <div class="disc-bar-track">
                  <div class="disc-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,#10B981,#34D399);"></div>
                </div>
              </div>
            `;
          }).join('');
        }

        // 4. Render Expiring Points
        const expEl = document.getElementById('discListExpiring');
        if (expEl) {
          const expList = data.expiring_soon || [];
          if (expList.length === 0) {
            expEl.innerHTML = '<div style="text-align:center;padding:28px;color:var(--text-muted);font-size:13px;">Tidak ada poin aktif yang akan expired dalam 30 hari ke depan.</div>';
          } else {
            expEl.innerHTML = expList.slice(0, 6).map(item => `
              <div class="disc-coaching-item">
                <div>
                  <div style="font-weight:700;font-size:13px;color:var(--text);">${escHtml(item.nama_lengkap)} <span style="font-weight:500;color:var(--text-muted);">(${escHtml(item.posisi)})</span></div>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${escHtml(item.subkategori)} • +${item.poin} Poin</div>
                </div>
                <div style="text-align:right;">
                  <span class="disc-badge appeal-pending">Expired ${fmtDateId(item.expired_at)} (${item.days_left} hari)</span>
                </div>
              </div>
            `).join('');
          }
        }

        // 5. Render Repeat Incidents & Coaching Focus
        const repEl = document.getElementById('discListRepeatCoaching');
        if (repEl) {
          const repList = data.repeat_users_30d || [];
          if (repList.length === 0) {
            repEl.innerHTML = '<div style="text-align:center;padding:28px;color:var(--text-muted);font-size:13px;">✅ Tidak ada karyawan dengan kejadian berulang atau ambang batas review saat ini.</div>';
          } else {
            repEl.innerHTML = repList.map(u => `
              <div class="disc-coaching-item">
                <div>
                  <div style="font-weight:700;font-size:14px;color:var(--text);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span>${escHtml(u.nama_lengkap)}</span>
                    <span class="disc-badge sev-low">${escHtml(u.posisi)}</span>
                    ${u.needs_hr_review
                      ? '<span class="disc-badge hr-review">⚠️ Perlu Review Atasan / HR</span>'
                      : '<span class="disc-badge appeal-pending">🩺 Perlu Pembinaan / Coaching</span>'}
                  </div>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
                    <strong>${u.recent_count_30d} kejadian</strong> dalam 30 hari terakhir • Total Poin Aktif: <strong>${u.active_points} Poin</strong> • Topik: ${escHtml((u.recent_topics || []).join(', '))}
                  </div>
                </div>
                <div>
                  <button class="btn btn-outline" style="font-size:12px;padding:6px 12px;" onclick="DisciplineAdminModule.openUserHistory('${escHtml(u.nama_lengkap)}')">
                    Lihat Riwayat Pembinaan
                  </button>
                </div>
              </div>
            `).join('');
          }
        }
      } catch (e) {
        console.error('loadDashboardData error:', e);
      }
    },

    openUserHistory(userName) {
      window.showPage('discipline-history');
      setTimeout(() => {
        const searchEl = document.getElementById('discHistSearch');
        if (searchEl) {
          searchEl.value = userName;
          this.loadHistory(1);
        }
      }, 100);
    },

    // ===================== 2. INPUT KEJADIAN =====================
    async initInputPage() {
      const container = document.getElementById('page-discipline-input');
      if (!container) return;

      if (this.users.length === 0) {
        this.renderPageSkeleton(container, 'Menyiapkan Formulir Input Kejadian & Daftar Karyawan…');
      }
      await this.ensureBaseData();
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
      const activeCats = this.categories.filter(c => c.is_active !== false);
      const uniqueKategoriNames = [...new Set(activeCats.map(c => c.nama_kategori))];
      const defaultMonths = this.settings.default_expiry_months || 3;

      container.innerHTML = `
        <div class="disc-hero">
          <div>
            <div class="disc-hero-badge">📝 Pencatatan Terstruktur &amp; Audit Trail</div>
            <h1 class="disc-hero-title">Input Kejadian &amp; Catatan Kinerja</h1>
            <p class="disc-hero-sub">Setiap poin yang diberikan wajib memiliki kronologi kejadian yang jelas, objektif, dan disertai catatan pembinaan.</p>
          </div>
        </div>

        <div class="disc-card" style="max-width:920px;margin:0 auto 28px auto;">
          <form id="discInputForm" onsubmit="DisciplineAdminModule.previewIncidentConfirmation(event)">
            <div class="disc-analytics-grid" style="margin-bottom:16px;">
              <div class="disc-field-group">
                <label class="disc-field-label">Tanggal Kejadian <span style="color:#EF4444">*</span></label>
                <input type="date" id="discInDate" class="disc-input" value="${today}" required onchange="DisciplineAdminModule.updateExpiryPreview()">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Pilih Karyawan <span style="color:#EF4444">*</span></label>
                <select id="discInUser" class="disc-select" data-searchable="true" required onchange="DisciplineAdminModule.onUserSelectChange()">
                  <option value="">— Pilih Karyawan Operasional —</option>
                  ${this.users.map(u => `<option value="${escHtml(u.id)}" data-posisi="${escHtml(u.posisi || 'Operasional')}" data-nik="${escHtml(u.nik || '-')}" data-nama="${escHtml(u.nama_lengkap || u.username)}">${escHtml(u.nama_lengkap || u.username)} (${escHtml(u.posisi || '-')})</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="disc-analytics-grid" style="margin-bottom:16px;">
              <div class="disc-field-group">
                <label class="disc-field-label">Posisi / Jabatan (Otomatis)</label>
                <input type="text" id="discInPosisi" class="disc-input" placeholder="Otomatis mengikuti karyawan" readonly style="background:rgba(100,116,139,0.08);font-weight:700;">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Kategori Pelanggaran <span style="color:#EF4444">*</span></label>
                <select id="discInKategori" class="disc-select" data-searchable="true" required onchange="DisciplineAdminModule.onKategoriSelectChange()">
                  <option value="">— Pilih Kategori —</option>
                  ${uniqueKategoriNames.map(k => `<option value="${escHtml(k)}">${escHtml(k)}</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="disc-analytics-grid" style="margin-bottom:16px;">
              <div class="disc-field-group">
                <label class="disc-field-label">Jenis Pelanggaran / Subkategori <span style="color:#EF4444">*</span></label>
                <select id="discInSubkategori" class="disc-select" data-searchable="true" required onchange="DisciplineAdminModule.onSubkategoriSelectChange()">
                  <option value="">— Pilih Kategori Terlebih Dahulu —</option>
                </select>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Tingkat Severity &amp; Status Review</label>
                <div id="discInSeverityPreview" style="padding:9px 12px;border-radius:10px;border:1.5px solid var(--card-border);background:rgba(100,116,139,0.05);font-size:13px;min-height:40px;display:flex;align-items:center;">
                  Pilih jenis pelanggaran untuk melihat tingkat severity
                </div>
              </div>
            </div>

            <div class="disc-analytics-grid" style="margin-bottom:16px;">
              <div class="disc-field-group">
                <label class="disc-field-label">Jumlah Poin (Default Otomatis, Dapat Di-override) <span style="color:#EF4444">*</span></label>
                <div style="display:flex;gap:10px;align-items:center;">
                  <input type="number" id="discInPoin" class="disc-input" min="0" max="100" value="1" required ${this.settings.allow_admin_override_points === false ? 'readonly' : ''}>
                  <span id="discInDefaultPoinHint" style="font-size:12px;color:var(--text-muted);white-space:nowrap;">Default: -</span>
                </div>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Masa Berlaku Poin (Bulan) <span style="color:#EF4444">*</span></label>
                <div style="display:flex;gap:10px;align-items:center;">
                  <input type="number" id="discInMasaBerlaku" class="disc-input" min="1" max="36" value="${defaultMonths}" required onchange="DisciplineAdminModule.updateExpiryPreview()" oninput="DisciplineAdminModule.updateExpiryPreview()">
                  <span id="discInExpiryPreview" class="disc-badge status-expired">Expired: -</span>
                </div>
              </div>
            </div>

            <div class="disc-field-group" style="margin-bottom:16px;">
              <label class="disc-field-label">Kronologi / Deskripsi Kejadian <span style="color:#EF4444">*</span></label>
              <textarea id="discInKronologi" class="disc-textarea" rows="4" required placeholder="Jelaskan secara spesifik waktu, tempat, nomor batch/SKU, dan kronologi kejadian yang dapat dipertanggungjawabkan..."></textarea>
            </div>

            <div class="disc-analytics-grid" style="margin-bottom:16px;">
              <div class="disc-field-group">
                <label class="disc-field-label">Catatan Pembinaan (Dilihat oleh Karyawan)</label>
                <textarea id="discInPembinaan" class="disc-textarea" rows="3" placeholder="Arahan perbaikan agar kesalahan tidak terulang kembali..."></textarea>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Catatan Internal Admin (Rahasia / Hanya Admin)</label>
                <textarea id="discInInternal" class="disc-textarea" rows="3" placeholder="Catatan internal manajemen/HR (tidak ditampilkan ke karyawan)..."></textarea>
              </div>
            </div>

            <div class="disc-analytics-grid" style="margin-bottom:20px;">
              <div class="disc-field-group">
                <label class="disc-field-label">Upload Bukti Foto / Dokumen PDF (Opsional, Maks 5 File)</label>
                <input type="file" id="discInFiles" class="disc-input" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.pdf">
                <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;cursor:pointer;">
                  <input type="checkbox" id="discInShowEvidence" ${this.settings.show_evidence_to_user_default !== false ? 'checked' : ''}>
                  <span>Izinkan karyawan melihat lampiran bukti kejadian ini di halaman Kinerja Saya</span>
                </label>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Status Kasus Awal</label>
                <select id="discInStatusKasus" class="disc-select">
                  <option value="OPEN">Terbuka (Dalam Pembinaan)</option>
                  <option value="RESOLVED">Selesai Dibina</option>
                  <option value="NEED_HR_REVIEW">Perlu Review Atasan / HR</option>
                </select>
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:12px;padding-top:14px;border-top:1px solid var(--card-border);">
              <button type="reset" class="btn btn-outline" onclick="setTimeout(()=>{const sub=document.getElementById('discInSubkategori');if(sub)sub.innerHTML='<option value=&quot;&quot;>— Pilih Kategori Terlebih Dahulu —</option>';DisciplineAdminModule.updateExpiryPreview();if(typeof window.initCustomSelects==='function')window.initCustomSelects(document.getElementById('page-discipline-input'));},50)">Reset Form</button>
              <button type="submit" class="btn btn-primary" style="padding:10px 22px;font-weight:700;">
                Lanjut &amp; Konfirmasi Simpan →
              </button>
            </div>
          </form>
        </div>
      `;

      if (typeof window.initCustomSelects === 'function') {
        window.initCustomSelects(container);
      }
      this.updateExpiryPreview();
    },

    onUserSelectChange() {
      const sel = document.getElementById('discInUser');
      const posEl = document.getElementById('discInPosisi');
      if (!sel || !posEl) return;
      const opt = sel.options[sel.selectedIndex];
      posEl.value = opt && opt.dataset.posisi ? opt.dataset.posisi : '';
    },

    onKategoriSelectChange() {
      const kat = document.getElementById('discInKategori')?.value || '';
      const subSel = document.getElementById('discInSubkategori');
      if (!subSel) return;

      const matching = this.categories.filter(c => c.is_active !== false && c.nama_kategori === kat);
      if (matching.length === 0) {
        subSel.innerHTML = '<option value="">— Pilih Kategori Terlebih Dahulu —</option>';
        return;
      }
      subSel.innerHTML = '<option value="">— Pilih Jenis Pelanggaran —</option>' +
        matching.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.nama_pelanggaran)} (+${c.default_poin} Poin)</option>`).join('');
      if (matching.length === 1) {
        subSel.value = matching[0].id;
        this.onSubkategoriSelectChange();
      }
    },

    onSubkategoriSelectChange() {
      const catId = document.getElementById('discInSubkategori')?.value;
      const cat = this.categories.find(c => c.id === catId);
      if (!cat) return;

      const poinInput = document.getElementById('discInPoin');
      const hintEl = document.getElementById('discInDefaultPoinHint');
      const masaEl = document.getElementById('discInMasaBerlaku');
      const sevEl = document.getElementById('discInSeverityPreview');
      const kasusEl = document.getElementById('discInStatusKasus');

      if (poinInput) poinInput.value = cat.default_poin;
      if (hintEl) hintEl.textContent = `Default: ${cat.default_poin} poin`;
      if (masaEl) masaEl.value = cat.masa_berlaku_bulan || 3;
      if (sevEl) {
        sevEl.innerHTML = `${getSeverityBadge(cat.severity, cat.requires_hr_review)} <span style="margin-left:8px;font-size:12px;color:var(--text-muted);">${escHtml(cat.deskripsi || '')}</span>`;
      }
      if (kasusEl && (cat.requires_hr_review || cat.severity === 'CRITICAL')) {
        kasusEl.value = 'NEED_HR_REVIEW';
      }
      this.updateExpiryPreview();
    },

    updateExpiryPreview() {
      const dStr = document.getElementById('discInDate')?.value;
      const mVal = parseInt(document.getElementById('discInMasaBerlaku')?.value, 10) || 3;
      const prevEl = document.getElementById('discInExpiryPreview');
      if (!dStr || !prevEl) return;

      const parts = dStr.split('-').map(Number);
      const dt = new Date(Date.UTC(parts[0], (parts[1] - 1) + mVal, parts[2]));
      const expStr = dt.toISOString().slice(0, 10);
      prevEl.textContent = `Expired: ${fmtDateId(expStr)}`;
    },

    previewIncidentConfirmation(e) {
      e.preventDefault();
      const userSel = document.getElementById('discInUser');
      const userOpt = userSel?.options[userSel.selectedIndex];
      const subId = document.getElementById('discInSubkategori')?.value;
      const cat = this.categories.find(c => c.id === subId);

      if (!userSel?.value || !cat) {
        notifyToast('Pilih karyawan dan jenis pelanggaran terlebih dahulu.', 'error');
        return;
      }

      const incident_date = document.getElementById('discInDate').value;
      const poin = parseInt(document.getElementById('discInPoin').value, 10) || 0;
      const masa_berlaku_bulan = parseInt(document.getElementById('discInMasaBerlaku').value, 10) || 3;
      const kronologi = document.getElementById('discInKronologi').value.trim();
      const catatan_pembinaan = document.getElementById('discInPembinaan').value.trim();
      const catatan_internal = document.getElementById('discInInternal').value.trim();
      const status_kasus = document.getElementById('discInStatusKasus').value;
      const show_evidence_to_user = document.getElementById('discInShowEvidence').checked;
      const filesInput = document.getElementById('discInFiles');

      const parts = incident_date.split('-').map(Number);
      const expStr = new Date(Date.UTC(parts[0], (parts[1] - 1) + masa_berlaku_bulan, parts[2])).toISOString().slice(0, 10);

      this.pendingConfirmFormData = {
        user_id: userSel.value,
        user_nama: userOpt.dataset.nama,
        posisi: document.getElementById('discInPosisi').value,
        category_id: cat.id,
        kategori_nama: cat.nama_kategori,
        subkategori: cat.nama_pelanggaran,
        severity: cat.severity,
        requires_hr_review: cat.requires_hr_review,
        default_poin: cat.default_poin,
        poin,
        masa_berlaku_bulan,
        incident_date,
        expired_at: expStr,
        kronologi,
        catatan_pembinaan,
        catatan_internal,
        status_kasus,
        show_evidence_to_user,
        files: filesInput?.files || []
      };

      const d = this.pendingConfirmFormData;
      this.openModal(
        'Konfirmasi Pencatatan Kejadian Disiplin',
        `
          <div style="background:rgba(37,99,235,0.06);border:1px solid rgba(37,99,235,0.2);border-radius:12px;padding:14px 16px;margin-bottom:16px;font-size:13px;">
            Harap periksa kembali ringkasan data kejadian berikut sebelum disimpan. Data yang disimpan akan tercatat di <strong>Audit Log</strong> dan mengirimkan notifikasi ke karyawan.
          </div>
          <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;font-size:13px;">
            <div style="color:var(--text-muted);font-weight:600;">Karyawan:</div>
            <div style="font-weight:800;">${escHtml(d.user_nama)} (${escHtml(d.posisi)})</div>
            <div style="color:var(--text-muted);font-weight:600;">Tanggal Kejadian:</div>
            <div>${fmtDateId(d.incident_date)}</div>
            <div style="color:var(--text-muted);font-weight:600;">Kategori &amp; Jenis:</div>
            <div><strong>${escHtml(d.kategori_nama)}</strong> — ${escHtml(d.subkategori)}</div>
            <div style="color:var(--text-muted);font-weight:600;">Jumlah Poin:</div>
            <div><span class="disc-badge status-active">+${d.poin} Poin</span> ${d.poin !== d.default_poin ? `<span style="font-size:11px;color:var(--text-muted);">(Override dari default ${d.default_poin} poin)</span>` : ''}</div>
            <div style="color:var(--text-muted);font-weight:600;">Masa Berlaku:</div>
            <div>${d.masa_berlaku_bulan} Bulan (Expired: <strong>${fmtDateId(d.expired_at)}</strong>)</div>
            <div style="color:var(--text-muted);font-weight:600;">Kronologi:</div>
            <div style="white-space:pre-wrap;background:rgba(100,116,139,0.06);padding:10px;border-radius:8px;">${escHtml(d.kronologi)}</div>
            <div style="color:var(--text-muted);font-weight:600;">Pembinaan:</div>
            <div>${escHtml(d.catatan_pembinaan || '-')}</div>
            <div style="color:var(--text-muted);font-weight:600;">Lampiran Bukti:</div>
            <div>${d.files.length} file dipilih (${d.show_evidence_to_user ? 'Ditampilkan ke user' : 'Hanya internal admin'})</div>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="DisciplineAdminModule.closeModal()">Periksa Kembali</button>
          <button class="btn btn-primary" id="discBtnConfirmSubmit" onclick="DisciplineAdminModule.submitConfirmedIncident()">✓ Ya, Simpan Kejadian</button>
        `
      );
    },

    async submitConfirmedIncident() {
      const d = this.pendingConfirmFormData;
      if (!d) return;
      const btn = document.getElementById('discBtnConfirmSubmit');
      if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

      try {
        const fd = new FormData();
        fd.append('user_id', d.user_id);
        fd.append('posisi', d.posisi);
        fd.append('category_id', d.category_id);
        fd.append('kategori_nama', d.kategori_nama);
        fd.append('subkategori', d.subkategori);
        fd.append('severity', d.severity);
        fd.append('requires_hr_review', String(d.requires_hr_review));
        fd.append('default_poin', String(d.default_poin));
        fd.append('poin', String(d.poin));
        fd.append('masa_berlaku_bulan', String(d.masa_berlaku_bulan));
        fd.append('incident_date', d.incident_date);
        fd.append('kronologi', d.kronologi);
        fd.append('catatan_pembinaan', d.catatan_pembinaan);
        fd.append('catatan_internal', d.catatan_internal);
        fd.append('status_kasus', d.status_kasus);
        fd.append('show_evidence_to_user', String(d.show_evidence_to_user));

        for (let i = 0; i < d.files.length; i++) {
          fd.append('evidence_files', d.files[i]);
        }

        const res = await fetch('/api/discipline/incidents', {
          method: 'POST',
          credentials: 'include',
          body: fd
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menyimpan kejadian.');

        this.closeModal();
        notifyToast(`Kejadian ${data.incident.incident_code} berhasil disimpan & masuk Audit Log!`, 'success');
        this.pendingConfirmFormData = null;
        this.loadMppWidget();
        window.showPage('discipline-history');
      } catch (err) {
        notifyToast(err.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✓ Ya, Simpan Kejadian'; }
      }
    },

    // ===================== 3. RIWAYAT POIN & KEJADIAN =====================
    async initHistoryPage() {
      const container = document.getElementById('page-discipline-history');
      if (!container) return;

      if (!container.dataset.rendered) {
        this.renderPageSkeleton(container, 'Menyiapkan Halaman Riwayat Poin & Kejadian…');
      }
      await this.ensureBaseData();
      const uniqueCats = [...new Set(this.categories.map(c => c.nama_kategori))];

      if (!container.dataset.rendered) {
        container.innerHTML = `
          <div class="disc-hero">
            <div>
              <div class="disc-hero-badge">🗂️ Audit Trail &amp; Histori Kejadian</div>
              <h1 class="disc-hero-title">Riwayat Poin &amp; Catatan Kinerja</h1>
              <p class="disc-hero-sub">Histori kejadian disimpan permanen. Gunakan fitur Adjustment jika diperlukan koreksi atau pembatalan poin.</p>
            </div>
            <div class="disc-hero-actions">
              <button class="disc-btn-hero" onclick="DisciplineAdminModule.exportExcel()">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 10v6m0 0l-3-3m3 3l3-3M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1"/></svg>
                Export Excel Sesuai Filter
              </button>
              <button class="disc-btn-hero" style="background:rgba(255,255,255,0.18);color:#fff;" onclick="showPage('discipline-input')">
                + Input Kejadian
              </button>
            </div>
          </div>

          <div class="disc-filter-card">
            <div class="disc-filter-grid">
              <div class="disc-field-group">
                <label class="disc-field-label">Cari Nama / Kronologi / ID</label>
                <input type="text" id="discHistSearch" class="disc-input" placeholder="Cari nama, NIK, kronologi..." oninput="DisciplineAdminModule.loadHistory(1)">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Dari Tanggal</label>
                <input type="date" id="discHistDateFrom" class="disc-input" onchange="DisciplineAdminModule.loadHistory(1)">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Sampai Tanggal</label>
                <input type="date" id="discHistDateTo" class="disc-input" onchange="DisciplineAdminModule.loadHistory(1)">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Posisi</label>
                <select id="discHistPosisi" class="disc-select" onchange="DisciplineAdminModule.loadHistory(1)">
                  <option value="all">Semua Posisi</option>
                  <option value="Picker">Picker</option>
                  <option value="Sorter">Sorter</option>
                  <option value="Loader">Loader</option>
                  <option value="Return">Return</option>
                  <option value="QC Outbound">QC Outbound</option>
                </select>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Kategori</label>
                <select id="discHistKategori" class="disc-select" data-searchable="true" onchange="DisciplineAdminModule.loadHistory(1)">
                  <option value="all">Semua Kategori</option>
                  ${uniqueCats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}
                </select>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Status Poin</label>
                <select id="discHistStatusPoin" class="disc-select" onchange="DisciplineAdminModule.loadHistory(1)">
                  <option value="all">Semua (Aktif/Expired/Batal)</option>
                  <option value="ACTIVE">Poin Aktif</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="CANCELLED">Dibatalkan</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Summary Strip -->
          <div id="discHistSummaryStrip" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;"></div>

          <div class="table-card">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID &amp; Tanggal</th>
                    <th>Karyawan</th>
                    <th>Kategori &amp; Pelanggaran</th>
                    <th>Kronologi</th>
                    <th>Poin</th>
                    <th>Masa Berlaku</th>
                    <th>Status</th>
                    <th>Dicatat Oleh</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody id="discHistTableBody">
                  <tr><td colspan="9" style="text-align:center;padding:32px;">Memuat data...</td></tr>
                </tbody>
              </table>
            </div>
            <div id="discHistPagination" style="padding:14px 20px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--card-border);flex-wrap:wrap;gap:10px;"></div>
          </div>
        `;
        container.dataset.rendered = 'true';
        if (typeof window.initCustomSelects === 'function') {
          window.initCustomSelects(container);
        }
      }

      await this.loadHistory(1);
    },

    getHistoryFilterParams(page = 1) {
      return new URLSearchParams({
        search: document.getElementById('discHistSearch')?.value || '',
        date_from: document.getElementById('discHistDateFrom')?.value || '',
        date_to: document.getElementById('discHistDateTo')?.value || '',
        posisi: document.getElementById('discHistPosisi')?.value || 'all',
        kategori: document.getElementById('discHistKategori')?.value || 'all',
        status_poin: document.getElementById('discHistStatusPoin')?.value || 'all',
        page: String(page),
        limit: String(this.historyLimit)
      });
    },

    async loadHistory(page = 1) {
      this.historyPage = page;
      const tbody = document.getElementById('discHistTableBody');
      if (!tbody) return;

      tbody.innerHTML = Array(4).fill(0).map(() => `
        <tr>
          <td colspan="9" style="padding:14px 20px;">
            <div class="disc-skeleton" style="height:26px;border-radius:8px;width:100%;"></div>
          </td>
        </tr>
      `).join('');

      try {
        const params = this.getHistoryFilterParams(page);
        const res = await fetch('/api/discipline/incidents?' + params.toString(), { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat riwayat.');

        this.currentHistoryItems = data.items || [];
        const s = data.summary || {};
        const strip = document.getElementById('discHistSummaryStrip');
        if (strip) {
          strip.innerHTML = `
            <span class="disc-badge sev-low" style="padding:6px 14px;font-size:12px;">Total Kejadian Filter: <strong>${s.total_incidents || 0}</strong></span>
            <span class="disc-badge status-active" style="padding:6px 14px;font-size:12px;">Total Poin Aktif: <strong>${s.active_points || 0} Poin</strong></span>
            <span class="disc-badge appeal-pending" style="padding:6px 14px;font-size:12px;">Total Poin Periode: <strong>${s.period_points || 0} Poin</strong></span>
            <span class="disc-badge status-expired" style="padding:6px 14px;font-size:12px;">Expired: <strong>${s.expired_count || 0}</strong></span>
            <span class="disc-badge status-cancelled" style="padding:6px 14px;font-size:12px;">Dibatalkan: <strong>${s.cancelled_count || 0}</strong></span>
          `;
        }

        if (this.currentHistoryItems.length === 0) {
          tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:42px;color:var(--text-muted);">Tidak ada data kejadian yang cocok dengan filter.</td></tr>`;
        } else {
          tbody.innerHTML = this.currentHistoryItems.map(inc => `
            <tr>
              <td>
                <div style="font-family:monospace;font-size:11px;font-weight:700;color:var(--primary);">${escHtml(inc.incident_code)}</div>
                <div style="font-size:12px;font-weight:600;margin-top:2px;">${fmtDateId(inc.incident_date)}</div>
              </td>
              <td>
                <div style="font-weight:700;color:var(--text);">${escHtml(inc.user_name_snapshot)}</div>
                <div style="font-size:11px;color:var(--text-muted);">${escHtml(inc.posisi)} • NIK: ${escHtml(inc.nik_snapshot || '-')}</div>
              </td>
              <td>
                <div style="font-weight:700;font-size:12px;">${escHtml(inc.subkategori)}</div>
                <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">
                  <span class="disc-badge sev-low">${escHtml(inc.kategori_nama)}</span>
                  ${getSeverityBadge(inc.severity, inc.requires_hr_review)}
                </div>
              </td>
              <td style="max-width:240px;">
                <div style="font-size:12px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escHtml(inc.kronologi)}</div>
                ${inc.attachments_count > 0 ? `<div style="font-size:11px;color:var(--primary);margin-top:3px;">📎 ${inc.attachments_count} lampiran bukti</div>` : ''}
              </td>
              <td>
                <div style="font-size:15px;font-weight:800;color:${inc.status_poin === 'ACTIVE' ? '#DC2626' : 'var(--text-muted)'};">+${inc.poin} Poin</div>
                ${inc.adjustments_count > 0 ? `<div style="font-size:10px;color:#D97706;font-weight:700;">Adjusted (${inc.adjustments_count}x)</div>` : ''}
              </td>
              <td>
                <div style="font-size:12px;">${inc.masa_berlaku_bulan} Bulan</div>
                <div style="font-size:11px;color:var(--text-muted);">Exp: ${fmtDateId(inc.expired_at)}</div>
              </td>
              <td>
                <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
                  ${getPointStatusBadge(inc.status_poin)}
                  ${getKasusBadge(inc.status_kasus)}
                </div>
              </td>
              <td>
                <div style="font-size:12px;font-weight:600;">${escHtml(inc.created_by_name)}</div>
                <div style="font-size:10px;color:var(--text-muted);">${fmtDateTimeId(inc.created_at)}</div>
              </td>
              <td>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  <button class="btn btn-outline" style="padding:5px 9px;font-size:11px;" onclick="DisciplineAdminModule.openIncidentDetailModal('${escHtml(inc.id)}')">Detail</button>
                  <button class="btn btn-outline" style="padding:5px 9px;font-size:11px;" onclick="DisciplineAdminModule.openEditIncidentModal('${escHtml(inc.id)}')">Edit</button>
                  <button class="btn btn-primary" style="padding:5px 9px;font-size:11px;" onclick="DisciplineAdminModule.openAdjustmentModal('${escHtml(inc.id)}')">Adjustment</button>
                  ${inc.status_poin !== 'CANCELLED' ? `<button class="btn btn-outline" style="padding:5px 9px;font-size:11px;border-color:rgba(239,68,68,0.4);color:#DC2626;" onclick="DisciplineAdminModule.openCancelIncidentModal('${escHtml(inc.id)}')">Batalkan Kejadian</button>` : ''}
                </div>
              </td>
            </tr>
          `).join('');
        }

        const pagEl = document.getElementById('discHistPagination');
        if (pagEl) {
          pagEl.innerHTML = `
            <div style="font-size:12px;color:var(--text-muted);">Menampilkan halaman <strong>${data.page}</strong> dari <strong>${data.totalPages}</strong> (${data.total} kejadian)</div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-outline" style="padding:5px 12px;font-size:12px;" ${data.page <= 1 ? 'disabled' : ''} onclick="DisciplineAdminModule.loadHistory(${data.page - 1})">← Sebelumnya</button>
              <button class="btn btn-outline" style="padding:5px 12px;font-size:12px;" ${data.page >= data.totalPages ? 'disabled' : ''} onclick="DisciplineAdminModule.loadHistory(${data.page + 1})">Berikutnya →</button>
            </div>
          `;
        }
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#EF4444;">${escHtml(err.message)}</td></tr>`;
      }
    },

    exportExcel() {
      const params = this.getHistoryFilterParams(1);
      window.location.href = '/api/discipline/export?' + params.toString();
    },

    async openIncidentDetailModal(incidentId) {
      try {
        const res = await fetch(`/api/discipline/incidents/${incidentId}`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat detail kejadian.');
        const inc = data.incident;

        const attHtml = (inc.attachments || []).length === 0
          ? '<div style="font-size:12px;color:var(--text-muted);">Tidak ada lampiran bukti.</div>'
          : `<div style="display:flex;gap:10px;flex-wrap:wrap;">
              ${inc.attachments.map(a => `
                <a href="${escHtml(a.signed_url || '#')}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size:12px;padding:6px 12px;">
                  📎 ${escHtml(a.original_filename)} (${escHtml(a.source_type)})
                </a>
              `).join('')}
            </div>`;

        const adjHtml = (inc.adjustments || []).length === 0
          ? '<div style="font-size:12px;color:var(--text-muted);">Belum pernah dilakukan adjustment poin.</div>'
          : `<div style="display:flex;flex-direction:column;gap:8px;">
              ${inc.adjustments.map(ad => `
                <div style="padding:10px 12px;border-radius:10px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);font-size:12px;">
                  <div style="font-weight:700;">${escHtml(ad.adjustment_type)}: ${ad.previous_points} Poin → ${ad.new_points} Poin (${escHtml(ad.previous_status)} → ${escHtml(ad.new_status)})</div>
                  <div style="margin-top:2px;">Alasan: ${escHtml(ad.reason)}</div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Oleh: ${escHtml(ad.created_by_name)} • ${fmtDateTimeId(ad.created_at)}</div>
                </div>
              `).join('')}
            </div>`;

        this.openModal(
          `Detail Kejadian — ${inc.incident_code}`,
          `
            <div style="display:grid;grid-template-columns:150px 1fr;gap:10px;font-size:13px;margin-bottom:16px;">
              <div style="color:var(--text-muted);font-weight:600;">Karyawan:</div>
              <div style="font-weight:800;">${escHtml(inc.user_name_snapshot)} (${escHtml(inc.posisi)} • NIK: ${escHtml(inc.nik_snapshot || '-')})</div>
              <div style="color:var(--text-muted);font-weight:600;">Tanggal Kejadian:</div>
              <div>${fmtDateId(inc.incident_date)} (Dicatat oleh ${escHtml(inc.created_by_name)} pada ${fmtDateTimeId(inc.created_at)})</div>
              <div style="color:var(--text-muted);font-weight:600;">Pelanggaran:</div>
              <div><strong>${escHtml(inc.kategori_nama)}</strong> — ${escHtml(inc.subkategori)} ${getSeverityBadge(inc.severity, inc.requires_hr_review)}</div>
              <div style="color:var(--text-muted);font-weight:600;">Poin &amp; Status:</div>
              <div><strong>+${inc.poin} Poin</strong> (Default: ${inc.default_poin}) &nbsp; ${getPointStatusBadge(inc.status_poin)} &nbsp; ${getKasusBadge(inc.status_kasus)}</div>
              <div style="color:var(--text-muted);font-weight:600;">Masa Berlaku:</div>
              <div>${inc.masa_berlaku_bulan} Bulan — Expired pada <strong>${fmtDateId(inc.expired_at)}</strong></div>
              <div style="color:var(--text-muted);font-weight:600;">Kronologi:</div>
              <div style="white-space:pre-wrap;background:rgba(100,116,139,0.06);padding:10px;border-radius:8px;">${escHtml(inc.kronologi)}</div>
              <div style="color:var(--text-muted);font-weight:600;">Catatan Pembinaan:</div>
              <div>${escHtml(inc.catatan_pembinaan || '-')}</div>
              <div style="color:var(--text-muted);font-weight:600;">Catatan Internal:</div>
              <div style="color:#B45309;">${escHtml(inc.catatan_internal || '-')}</div>
            </div>
            <div style="margin-bottom:14px;">
              <div class="disc-field-label" style="margin-bottom:6px;">Lampiran Bukti (Private Storage Signed URL)</div>
              ${attHtml}
            </div>
            <div>
              <div class="disc-field-label" style="margin-bottom:6px;">Riwayat Adjustment / Koreksi Poin</div>
              ${adjHtml}
            </div>
          `,
          `
            ${inc.status_poin !== 'CANCELLED' ? `<button class="btn btn-outline" style="border-color:rgba(239,68,68,0.4);color:#DC2626;" onclick="DisciplineAdminModule.openCancelIncidentModal('${escHtml(inc.id)}')">🚫 Batalkan Kejadian</button>` : ''}
            <button class="btn btn-primary" onclick="DisciplineAdminModule.closeModal()">Tutup</button>
          `
        );
      } catch (err) {
        notifyToast(err.message, 'error');
      }
    },

    async openEditIncidentModal(incidentId) {
      try {
        const res = await fetch(`/api/discipline/incidents/${incidentId}`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat kejadian.');
        const inc = data.incident;

        this.openModal(
          `Edit Catatan Kejadian — ${inc.incident_code}`,
          `
            <div style="display:flex;flex-direction:column;gap:12px;">
              <div class="disc-analytics-grid" style="margin-bottom:0;">
                <div class="disc-field-group">
                  <label class="disc-field-label">Tanggal Kejadian</label>
                  <input type="date" id="discEditDate" class="disc-input" value="${escHtml(inc.incident_date)}">
                </div>
                <div class="disc-field-group">
                  <label class="disc-field-label">Masa Berlaku (Bulan)</label>
                  <input type="number" id="discEditMonths" class="disc-input" min="1" max="36" value="${inc.masa_berlaku_bulan}">
                </div>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Status Kasus</label>
                <select id="discEditStatusKasus" class="disc-select">
                  <option value="OPEN" ${inc.status_kasus === 'OPEN' ? 'selected' : ''}>Terbuka (Dalam Pembinaan)</option>
                  <option value="IN_REVIEW" ${inc.status_kasus === 'IN_REVIEW' ? 'selected' : ''}>Menunggu Review Klarifikasi</option>
                  <option value="RESOLVED" ${inc.status_kasus === 'RESOLVED' ? 'selected' : ''}>Selesai Dibina</option>
                  <option value="NEED_HR_REVIEW" ${inc.status_kasus === 'NEED_HR_REVIEW' ? 'selected' : ''}>Perlu Review Atasan / HR</option>
                </select>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Kronologi Kejadian</label>
                <textarea id="discEditKronologi" class="disc-textarea" rows="3">${escHtml(inc.kronologi)}</textarea>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Catatan Pembinaan</label>
                <textarea id="discEditPembinaan" class="disc-textarea" rows="2">${escHtml(inc.catatan_pembinaan || '')}</textarea>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Catatan Internal Admin</label>
                <textarea id="discEditInternal" class="disc-textarea" rows="2">${escHtml(inc.catatan_internal || '')}</textarea>
              </div>
              <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
                <input type="checkbox" id="discEditShowEvidence" ${inc.show_evidence_to_user ? 'checked' : ''}>
                <span>Tampilkan bukti lampiran ke karyawan</span>
              </label>
            </div>
          `,
          `
            <button class="btn btn-outline" onclick="DisciplineAdminModule.closeModal()">Batal</button>
            <button class="btn btn-primary" onclick="DisciplineAdminModule.saveEditedIncident('${escHtml(inc.id)}')">Simpan Perubahan</button>
          `
        );
      } catch (err) {
        notifyToast(err.message, 'error');
      }
    },

    async saveEditedIncident(incidentId) {
      try {
        const payload = {
          incident_date: document.getElementById('discEditDate').value,
          masa_berlaku_bulan: parseInt(document.getElementById('discEditMonths').value, 10) || 3,
          status_kasus: document.getElementById('discEditStatusKasus').value,
          kronologi: document.getElementById('discEditKronologi').value.trim(),
          catatan_pembinaan: document.getElementById('discEditPembinaan').value.trim(),
          catatan_internal: document.getElementById('discEditInternal').value.trim(),
          show_evidence_to_user: document.getElementById('discEditShowEvidence').checked
        };
        const res = await fetch(`/api/discipline/incidents/${incidentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memperbarui kejadian.');

        this.closeModal();
        notifyToast('Data kejadian berhasil diperbarui & dicatat di Audit Log.', 'success');
        this.loadHistory(this.historyPage);
      } catch (err) {
        notifyToast(err.message, 'error');
      }
    },

    async openAdjustmentModal(incidentId, defaultType = 'REDUCE_POINTS') {
      let inc = this.currentHistoryItems.find(i => i.id === incidentId);
      if (!inc) {
        try {
          const res = await fetch(`/api/discipline/incidents/${incidentId}`, { credentials: 'include' });
          const data = await res.json();
          if (res.ok && data.incident) inc = data.incident;
        } catch (e) {}
      }
      if (!inc) return;

      const isCancel = defaultType === 'CANCEL_INCIDENT';
      this.openModal(
        isCancel ? `Batalkan Kejadian — ${inc.incident_code}` : `Adjustment / Pembatalan Poin — ${inc.incident_code}`,
        `
          <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.28);border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:12px;">
            Sesuai kebijakan audit SS08, record kejadian <strong>tidak pernah dihapus</strong>. Gunakan mekanisme Adjustment / Pembatalan di bawah ini untuk mengoreksi atau membatalkan kejadian salah input.
          </div>
          <div style="margin-bottom:12px;font-size:13px;">
            Karyawan: <strong>${escHtml(inc.user_name_snapshot)}</strong> • Poin Saat Ini: <strong style="color:#DC2626;">+${inc.poin} Poin</strong> (${escHtml(inc.status_poin)})
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div class="disc-field-group">
              <label class="disc-field-label">Jenis Adjustment <span style="color:#EF4444">*</span></label>
              <select id="discAdjType" class="disc-select" onchange="DisciplineAdminModule.onAdjTypeChange(${inc.poin})">
                <option value="REDUCE_POINTS" ${!isCancel ? 'selected' : ''}>Pengurangan / Koreksi Poin</option>
                <option value="CANCEL_INCIDENT" ${isCancel ? 'selected' : ''}>Batalkan Kejadian (Set 0 Poin &amp; Status CANCELLED)</option>
                <option value="INCREASE_POINTS">Penambahan Poin</option>
                <option value="RESTORE_POINTS">Pemulihan Poin</option>
              </select>
            </div>
            <div class="disc-field-group">
              <label class="disc-field-label">Nilai Poin Baru Sesudah Adjustment <span style="color:#EF4444">*</span></label>
              <input type="number" id="discAdjNewPoints" class="disc-input" min="0" max="100" value="${isCancel ? 0 : Math.max(0, inc.poin - 1)}" ${isCancel ? 'readonly' : ''}>
            </div>
            <div class="disc-field-group">
              <label class="disc-field-label">Alasan Pembatalan / Perubahan (Wajib untuk Audit Trail) <span style="color:#EF4444">*</span></label>
              <textarea id="discAdjReason" class="disc-textarea" rows="3" placeholder="Contoh: Salah pilih user saat input kejadian / Koreksi hasil verifikasi ulang CCTV..."></textarea>
            </div>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="DisciplineAdminModule.closeModal()">Batal</button>
          <button class="btn btn-primary" onclick="DisciplineAdminModule.submitAdjustment('${escHtml(inc.id)}')">${isCancel ? 'Konfirmasi Batalkan Kejadian' : 'Simpan Adjustment'}</button>
        `
      );
    },

    async openCancelIncidentModal(incidentId) {
      await this.openAdjustmentModal(incidentId, 'CANCEL_INCIDENT');
    },

    onAdjTypeChange(currentPoin) {
      const t = document.getElementById('discAdjType')?.value;
      const inp = document.getElementById('discAdjNewPoints');
      if (!inp) return;
      if (t === 'CANCEL_INCIDENT') {
        inp.value = 0;
        inp.readOnly = true;
      } else {
        inp.readOnly = false;
        if (t === 'REDUCE_POINTS') inp.value = Math.max(0, currentPoin - 1);
      }
    },

    async submitAdjustment(incidentId) {
      const adjustment_type = document.getElementById('discAdjType')?.value;
      const new_points = parseInt(document.getElementById('discAdjNewPoints')?.value, 10);
      const reason = document.getElementById('discAdjReason')?.value.trim();

      if (!reason) {
        notifyToast('Alasan perubahan wajib diisi untuk Audit Trail.', 'error');
        return;
      }

      try {
        const res = await fetch(`/api/discipline/incidents/${incidentId}/adjustments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ adjustment_type, new_points, reason })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menyimpan adjustment.');

        this.closeModal();
        notifyToast('Adjustment poin berhasil disimpan & tercatat di Audit Log!', 'success');
        this.loadHistory(this.historyPage);
        this.loadMppWidget();
      } catch (err) {
        notifyToast(err.message, 'error');
      }
    },

    // ===================== 4. MASTER PELANGGARAN =====================
    async initCategoriesPage() {
      const container = document.getElementById('page-discipline-categories');
      if (!container) return;

      if (this.categories.length === 0) {
        this.renderPageSkeleton(container, 'Memuat Master Pelanggaran & Bobot Poin…');
      }
      await this.ensureBaseData();

      container.innerHTML = `
        <div class="disc-hero">
          <div>
            <div class="disc-hero-badge">⚙️ Standarisasi Kategori &amp; Poin</div>
            <h1 class="disc-hero-title">Master Pelanggaran &amp; Bobot Poin</h1>
            <p class="disc-hero-sub">Kelola daftar kategori kesalahan, poin default, masa berlaku, dan penanda khusus untuk kejadian berat yang memerlukan review Atasan / HR.</p>
          </div>
          <div class="disc-hero-actions">
            <button class="disc-btn-hero" onclick="DisciplineAdminModule.openCategoryModal()">
              + Tambah Master Pelanggaran
            </button>
          </div>
        </div>

        <div class="table-card">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kategori</th>
                  <th>Nama Pelanggaran</th>
                  <th>Deskripsi</th>
                  <th>Default Poin</th>
                  <th>Severity / Tingkat</th>
                  <th>Masa Berlaku</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody id="discCatTableBody"></tbody>
            </table>
          </div>
        </div>
      `;

      this.renderCategoriesTable();
    },

    renderCategoriesTable() {
      const tbody = document.getElementById('discCatTableBody');
      if (!tbody) return;
      if (this.categories.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;">Belum ada master pelanggaran.</td></tr>';
        return;
      }

      tbody.innerHTML = this.categories.map(c => `
        <tr>
          <td style="font-weight:700;">${escHtml(c.nama_kategori)}</td>
          <td style="font-weight:700;color:var(--text);">${escHtml(c.nama_pelanggaran)}</td>
          <td style="font-size:12px;color:var(--text-muted);max-width:260px;">${escHtml(c.deskripsi || '-')}</td>
          <td><span class="disc-badge status-active">+${c.default_poin} Poin</span></td>
          <td>${getSeverityBadge(c.severity, c.requires_hr_review)}</td>
          <td>${c.masa_berlaku_bulan || 3} Bulan</td>
          <td>
            ${c.is_active !== false
              ? '<span class="disc-badge appeal-approved">Aktif</span>'
              : '<span class="disc-badge status-expired">Nonaktif</span>'}
          </td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-outline" style="padding:5px 10px;font-size:11px;" onclick="DisciplineAdminModule.openCategoryModal('${escHtml(c.id)}')">Edit</button>
              <button class="btn btn-outline" style="padding:5px 10px;font-size:11px;" onclick="DisciplineAdminModule.toggleCategory('${escHtml(c.id)}', ${c.is_active === false})">
                ${c.is_active !== false ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    },

    openCategoryModal(catId = null) {
      const cat = catId ? this.categories.find(c => c.id === catId) : null;
      this.openModal(
        cat ? 'Edit Master Pelanggaran' : 'Tambah Master Pelanggaran Baru',
        `
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div class="disc-analytics-grid" style="margin-bottom:0;">
              <div class="disc-field-group">
                <label class="disc-field-label">Nama Kategori <span style="color:#EF4444">*</span></label>
                <input type="text" id="discCatKategori" class="disc-input" placeholder="Contoh: Picking, Kehadiran, K3..." value="${escHtml(cat?.nama_kategori || '')}">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Nama Pelanggaran <span style="color:#EF4444">*</span></label>
                <input type="text" id="discCatNama" class="disc-input" placeholder="Contoh: Salah SKU / Salah Qty" value="${escHtml(cat?.nama_pelanggaran || '')}">
              </div>
            </div>
            <div class="disc-field-group">
              <label class="disc-field-label">Deskripsi</label>
              <textarea id="discCatDesc" class="disc-textarea" rows="2" placeholder="Penjelasan singkat kriteria pelanggaran...">${escHtml(cat?.deskripsi || '')}</textarea>
            </div>
            <div class="disc-analytics-grid" style="margin-bottom:0;">
              <div class="disc-field-group">
                <label class="disc-field-label">Default Poin <span style="color:#EF4444">*</span></label>
                <input type="number" id="discCatPoin" class="disc-input" min="0" max="100" value="${cat ? cat.default_poin : 3}">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Masa Berlaku Poin (Bulan) <span style="color:#EF4444">*</span></label>
                <input type="number" id="discCatMonths" class="disc-input" min="1" max="36" value="${cat ? cat.masa_berlaku_bulan : 3}">
              </div>
            </div>
            <div class="disc-field-group">
              <label class="disc-field-label">Tingkat / Severity</label>
              <select id="discCatSeverity" class="disc-select">
                <option value="LOW" ${cat?.severity === 'LOW' ? 'selected' : ''}>Ringan (Low)</option>
                <option value="MEDIUM" ${(!cat || cat?.severity === 'MEDIUM') ? 'selected' : ''}>Sedang (Medium)</option>
                <option value="HIGH" ${cat?.severity === 'HIGH' ? 'selected' : ''}>Tinggi (High)</option>
                <option value="CRITICAL" ${cat?.severity === 'CRITICAL' ? 'selected' : ''}>Berat / Kritis (Tampilkan: Perlu Review Atasan / HR)</option>
              </select>
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
              <input type="checkbox" id="discCatHrReview" ${cat?.requires_hr_review ? 'checked' : ''}>
              <span>Tandai sebagai <strong>Perlu Review Atasan / HR</strong> (untuk kejadian berat seperti manipulasi data, fraud, integritas, kecelakaan berat)</span>
            </label>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="DisciplineAdminModule.closeModal()">Batal</button>
          <button class="btn btn-primary" onclick="DisciplineAdminModule.saveCategory('${escHtml(cat?.id || '')}')">Simpan Master Pelanggaran</button>
        `
      );
    },

    async saveCategory(catId = '') {
      const rawPoin = parseInt(document.getElementById('discCatPoin')?.value, 10);
      const payload = {
        nama_kategori: document.getElementById('discCatKategori')?.value.trim(),
        nama_pelanggaran: document.getElementById('discCatNama')?.value.trim(),
        deskripsi: document.getElementById('discCatDesc')?.value.trim(),
        default_poin: (!isNaN(rawPoin) && rawPoin >= 0) ? rawPoin : 1,
        masa_berlaku_bulan: parseInt(document.getElementById('discCatMonths')?.value, 10) || 3,
        severity: document.getElementById('discCatSeverity')?.value || 'MEDIUM',
        requires_hr_review: document.getElementById('discCatHrReview')?.checked || false
      };

      try {
        const url = catId ? `/api/discipline/categories/${catId}` : '/api/discipline/categories';
        const method = catId ? 'PUT' : 'POST';
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menyimpan master pelanggaran.');

        this.closeModal();
        notifyToast('Master pelanggaran berhasil disimpan.', 'success');
        await this.ensureBaseData(true);
        this.renderCategoriesTable();
      } catch (err) {
        notifyToast(err.message, 'error');
      }
    },

    async toggleCategory(catId, nextActive) {
      try {
        const res = await fetch(`/api/discipline/categories/${catId}/toggle`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ is_active: nextActive })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal mengubah status.');
        notifyToast('Status master pelanggaran diperbarui.', 'success');
        await this.ensureBaseData(true);
        this.renderCategoriesTable();
      } catch (err) {
        notifyToast(err.message, 'error');
      }
    },

    // ===================== 5. KLARIFIKASI USER =====================
    async initAppealsPage() {
      const container = document.getElementById('page-discipline-appeals');
      if (!container) return;

      container.innerHTML = `
        <div class="disc-hero">
          <div>
            <div class="disc-hero-badge">⚖️ Hak Jawab &amp; Verifikasi Objektif</div>
            <h1 class="disc-hero-title">Review Klarifikasi Karyawan</h1>
            <p class="disc-hero-sub">Tinjau alasan dan kronologi versi karyawan. Jika klarifikasi diterima, sistem akan melakukan Adjustment poin tanpa menghapus histori kejadian.</p>
          </div>
        </div>

        <div class="disc-filter-card">
          <div class="disc-filter-grid">
            <div class="disc-field-group">
              <label class="disc-field-label">Status Klarifikasi</label>
              <select id="discAppStatusFilter" class="disc-select" onchange="DisciplineAdminModule.loadAppeals()">
                <option value="all">Semua Status</option>
                <option value="PENDING">Menunggu Review</option>
                <option value="APPROVED">Diterima</option>
                <option value="REJECTED">Ditolak</option>
              </select>
            </div>
            <div class="disc-field-group">
              <label class="disc-field-label">Cari Karyawan / Alasan</label>
              <input type="text" id="discAppSearch" class="disc-input" placeholder="Ketik nama atau alasan..." oninput="DisciplineAdminModule.loadAppeals()">
            </div>
          </div>
        </div>

        <div id="discAppealsList" style="display:flex;flex-direction:column;gap:14px;"></div>
      `;

      if (typeof window.initCustomSelects === 'function') {
        window.initCustomSelects(container);
      }
      await this.loadAppeals();
    },

    async loadAppeals() {
      const listEl = document.getElementById('discAppealsList');
      if (!listEl) return;

      listEl.innerHTML = `
        <div class="disc-skeleton" style="height:120px;border-radius:16px;"></div>
        <div class="disc-skeleton" style="height:120px;border-radius:16px;"></div>
      `;

      try {
        const params = new URLSearchParams({
          status: document.getElementById('discAppStatusFilter')?.value || 'all',
          search: document.getElementById('discAppSearch')?.value || ''
        });
        const res = await fetch('/api/discipline/appeals?' + params.toString(), { credentials: 'include' });
        const data = await res.json();
        const appeals = data.appeals || [];
        this.currentAppeals = appeals;

        if (appeals.length === 0) {
          listEl.innerHTML = '<div class="disc-card" style="text-align:center;padding:42px;color:var(--text-muted);">Belum ada pengajuan klarifikasi pada filter ini.</div>';
          return;
        }

        listEl.innerHTML = appeals.map(ap => {
          const inc = ap.incident || {};
          return `
            <div class="disc-card">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
                <div>
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-weight:800;font-size:15px;">${escHtml(ap.user_name_snapshot)}</span>
                    <span class="disc-badge sev-low">${escHtml(inc.posisi || '-')}</span>
                    <span style="font-family:monospace;font-size:12px;color:var(--primary);font-weight:700;">${escHtml(inc.incident_code || '-')}</span>
                    ${getAppealBadge(ap.status)}
                  </div>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">
                    Diajukan pada ${fmtDateTimeId(ap.created_at)} • Pelanggaran: <strong>${escHtml(inc.subkategori || '-')} (+${inc.poin ?? 0} Poin)</strong>
                  </div>
                </div>
                <div>
                  ${ap.status === 'PENDING'
                    ? `<button class="btn btn-primary" style="font-size:12px;padding:8px 16px;" onclick="DisciplineAdminModule.openAppealReviewModal('${escHtml(ap.id)}')">⚖️ Proses Review Klarifikasi</button>`
                    : `<span style="font-size:12px;color:var(--text-muted);">Direview oleh <strong>${escHtml(ap.reviewed_by_name || '-')}</strong> (${fmtDateTimeId(ap.reviewed_at)})</span>`}
                </div>
              </div>

              <div class="disc-analytics-grid" style="margin-bottom:0;">
                <div style="background:rgba(100,116,139,0.06);padding:12px 14px;border-radius:12px;font-size:12px;">
                  <div style="font-weight:700;margin-bottom:4px;color:var(--text-muted);">📋 Kronologi Pencatatan Admin (${fmtDateId(inc.incident_date)}):</div>
                  <div style="white-space:pre-wrap;">${escHtml(inc.kronologi || '-')}</div>
                </div>
                <div style="background:rgba(37,99,235,0.06);padding:12px 14px;border-radius:12px;font-size:12px;border:1px solid rgba(37,99,235,0.15);">
                  <div style="font-weight:700;margin-bottom:4px;color:var(--primary);">💬 Klarifikasi Karyawan (${escHtml(ap.alasan)}):</div>
                  <div style="white-space:pre-wrap;">${escHtml(ap.kronologi_user)}</div>
                  ${(ap.attachments || []).length > 0 ? `
                    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                      ${ap.attachments.map(a => `<a href="${escHtml(a.signed_url || '#')}" target="_blank" rel="noopener noreferrer" class="disc-badge sev-low">📎 ${escHtml(a.original_filename)}</a>`).join('')}
                    </div>
                  ` : ''}
                </div>
              </div>

              ${ap.review_notes ? `
                <div style="margin-top:12px;padding:10px 14px;border-radius:10px;background:rgba(16,185,129,0.08);font-size:12px;">
                  <strong>Keputusan Admin:</strong> ${escHtml(ap.review_notes)}
                </div>
              ` : ''}
            </div>
          `;
        }).join('');
      } catch (err) {
        listEl.innerHTML = `<div class="disc-card" style="color:#EF4444;">${escHtml(err.message)}</div>`;
      }
    },

    openAppealReviewModal(appealId) {
      const ap = (this.currentAppeals || []).find(a => a.id === appealId);
      if (!ap) return;
      const inc = ap.incident || {};

      this.openModal(
        `Review Klarifikasi — ${ap.user_name_snapshot}`,
        `
          <div style="font-size:13px;margin-bottom:14px;">
            Kejadian: <strong>${escHtml(inc.incident_code)}</strong> — ${escHtml(inc.subkategori)} (Poin Saat Ini: <strong>+${inc.poin} Poin</strong>)
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div class="disc-field-group">
              <label class="disc-field-label">Keputusan Review <span style="color:#EF4444">*</span></label>
              <select id="discRevDecision" class="disc-select" onchange="DisciplineAdminModule.onRevDecisionChange()">
                <option value="APPROVED">✓ Terima Klarifikasi (Lakukan Adjustment / Pembatalan Poin)</option>
                <option value="REJECTED">✗ Tolak Klarifikasi (Poin Tetap Berlaku)</option>
              </select>
            </div>
            <div id="discRevAdjustmentBox" style="padding:12px 14px;border-radius:12px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);display:flex;flex-direction:column;gap:10px;">
              <div class="disc-field-group">
                <label class="disc-field-label">Tindakan Adjustment Poin (Histori Tidak Dihapus)</label>
                <select id="discRevAdjType" class="disc-select" onchange="DisciplineAdminModule.onRevAdjTypeChange(${inc.poin || 0})">
                  <option value="CANCEL_INCIDENT">Batalkan Poin Kejadian (Ubah menjadi 0 Poin / CANCELLED)</option>
                  <option value="APPEAL_APPROVED">Kurangi / Koreksi Poin</option>
                </select>
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Poin Baru Sesudah Klarifikasi</label>
                <input type="number" id="discRevNewPoints" class="disc-input" value="0" min="0" max="100" readonly>
              </div>
            </div>
            <div class="disc-field-group">
              <label class="disc-field-label">Catatan / Alasan Keputusan Review <span style="color:#EF4444">*</span></label>
              <textarea id="discRevNotes" class="disc-textarea" rows="3" placeholder="Tuliskan alasan persetujuan atau penolakan klarifikasi ini..."></textarea>
            </div>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="DisciplineAdminModule.closeModal()">Batal</button>
          <button class="btn btn-primary" onclick="DisciplineAdminModule.submitAppealReview('${escHtml(ap.id)}')">Simpan Keputusan Review</button>
        `
      );
    },

    onRevDecisionChange() {
      const dec = document.getElementById('discRevDecision')?.value;
      const box = document.getElementById('discRevAdjustmentBox');
      if (box) box.style.display = dec === 'APPROVED' ? 'flex' : 'none';
    },

    onRevAdjTypeChange(curPoin) {
      const t = document.getElementById('discRevAdjType')?.value;
      const inp = document.getElementById('discRevNewPoints');
      if (!inp) return;
      if (t === 'CANCEL_INCIDENT') {
        inp.value = 0;
        inp.readOnly = true;
      } else {
        inp.readOnly = false;
        inp.value = Math.max(0, curPoin - 1);
      }
    },

    async submitAppealReview(appealId) {
      const decision = document.getElementById('discRevDecision')?.value;
      const adjustment_type = document.getElementById('discRevAdjType')?.value;
      const new_points = parseInt(document.getElementById('discRevNewPoints')?.value, 10) || 0;
      const review_notes = document.getElementById('discRevNotes')?.value.trim();

      if (!review_notes) {
        notifyToast('Catatan / alasan keputusan review wajib diisi.', 'error');
        return;
      }

      try {
        const res = await fetch(`/api/discipline/appeals/${appealId}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ decision, adjustment_type, new_points, review_notes })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menyimpan review klarifikasi.');

        this.closeModal();
        notifyToast('Keputusan review klarifikasi berhasil disimpan!', 'success');
        await this.loadAppeals();
        this.loadMppWidget();
      } catch (err) {
        notifyToast(err.message, 'error');
      }
    },

    // ===================== 6. PENGATURAN DISIPLIN =====================
    async initSettingsPage() {
      const container = document.getElementById('page-discipline-settings');
      if (!container) return;

      if (!this._baseDataLoaded) {
        this.renderPageSkeleton(container, 'Memuat Pengaturan Poin & Disiplin…');
      }
      await this.ensureBaseData();
      const s = this.settings || {};
      const hrThresholdVal = (s.hr_review_point_threshold === null || s.hr_review_point_threshold === undefined || s.hr_review_point_threshold === '')
        ? ''
        : s.hr_review_point_threshold;
      const isHrThresholdEnabled = s.enable_hr_review_threshold !== false && hrThresholdVal !== '' && Number(hrThresholdVal) > 0;

      container.innerHTML = `
        <div class="disc-hero">
          <div>
            <div class="disc-hero-badge">⚙️ Konfigurasi Sistem Disiplin</div>
            <h1 class="disc-hero-title">Pengaturan Poin &amp; Disiplin</h1>
            <p class="disc-hero-sub">Atur masa berlaku default, parameter deteksi kejadian berulang, dan ambang peringatan review Atasan / HR.</p>
          </div>
        </div>

        <div class="disc-card" style="max-width:760px;margin:0 auto;">
          <form onsubmit="DisciplineAdminModule.saveSettings(event)" style="display:flex;flex-direction:column;gap:16px;">
            <div class="disc-analytics-grid" style="margin-bottom:0;">
              <div class="disc-field-group">
                <label class="disc-field-label">Default Masa Berlaku Poin (Bulan)</label>
                <input type="number" id="discSetExpiryMonths" class="disc-input" min="1" max="36" value="${s.default_expiry_months || 3}">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Ambang Poin Aktif "Perlu Review Atasan / HR" (Opsional)</label>
                <input type="number" id="discSetHrThreshold" class="disc-input" min="1" max="100" placeholder="Kosongkan jika belum digunakan" value="${escHtml(String(hrThresholdVal))}" ${!isHrThresholdEnabled ? 'disabled' : ''}>
                <span style="font-size:11px;color:var(--text-muted);margin-top:4px;">Kosongkan atau nonaktifkan checkbox di bawah jika hanya ingin menandai kategori berat (Critical / Requires HR Review).</span>
              </div>
            </div>

            <div class="disc-analytics-grid" style="margin-bottom:0;">
              <div class="disc-field-group">
                <label class="disc-field-label">Rentang Deteksi Kejadian Berulang (Hari)</label>
                <input type="number" id="discSetRepeatDays" class="disc-input" min="7" max="365" value="${s.repeat_incident_days || 30}">
              </div>
              <div class="disc-field-group">
                <label class="disc-field-label">Frekuensi Minimal Kejadian Berulang</label>
                <input type="number" id="discSetRepeatCount" class="disc-input" min="2" max="20" value="${s.repeat_incident_threshold || 2}">
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:12px;background:rgba(100,116,139,0.06);">
              <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;">
                <input type="checkbox" id="discSetEnableHrThreshold" ${isHrThresholdEnabled ? 'checked' : ''} onchange="DisciplineAdminModule.onToggleHrThresholdSetting()">
                <span>Aktifkan ambang poin otomatis untuk status <strong>"Perlu Review Atasan / HR"</strong></span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;">
                <input type="checkbox" id="discSetAllowOverride" ${s.allow_admin_override_points !== false ? 'checked' : ''}>
                <span>Izinkan Admin melakukan override nilai poin default saat input kejadian</span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;">
                <input type="checkbox" id="discSetShowEvidence" ${s.show_evidence_to_user_default !== false ? 'checked' : ''}>
                <span>Tampilkan bukti lampiran ke karyawan secara default</span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;">
                <input type="checkbox" id="discSetEnableAppeals" ${s.enable_user_appeals !== false ? 'checked' : ''}>
                <span>Aktifkan fitur "Ajukan Klarifikasi" pada halaman Kinerja Saya</span>
              </label>
            </div>

            <div style="display:flex;justify-content:flex-end;">
              <button type="submit" class="btn btn-primary" style="padding:10px 24px;font-weight:700;">💾 Simpan Pengaturan</button>
            </div>
          </form>
        </div>
      `;
    },

    onToggleHrThresholdSetting() {
      const enabled = document.getElementById('discSetEnableHrThreshold')?.checked;
      const inp = document.getElementById('discSetHrThreshold');
      if (!inp) return;
      inp.disabled = !enabled;
      if (!enabled) {
        inp.value = '';
      }
    },

    async saveSettings(e) {
      e.preventDefault();
      const rawHrStr = (document.getElementById('discSetHrThreshold')?.value ?? '').trim();
      const parsedHr = rawHrStr === '' ? null : parseInt(rawHrStr, 10);
      const enableCheckbox = document.getElementById('discSetEnableHrThreshold')?.checked !== false;
      const effectiveHrThreshold = (enableCheckbox && parsedHr !== null && !isNaN(parsedHr) && parsedHr > 0) ? parsedHr : null;

      const payload = {
        default_expiry_months: parseInt(document.getElementById('discSetExpiryMonths')?.value, 10) || 3,
        enable_hr_review_threshold: effectiveHrThreshold !== null,
        hr_review_point_threshold: effectiveHrThreshold,
        repeat_incident_days: parseInt(document.getElementById('discSetRepeatDays')?.value, 10) || 30,
        repeat_incident_threshold: parseInt(document.getElementById('discSetRepeatCount')?.value, 10) || 2,
        allow_admin_override_points: document.getElementById('discSetAllowOverride')?.checked || false,
        show_evidence_to_user_default: document.getElementById('discSetShowEvidence')?.checked || false,
        enable_user_appeals: document.getElementById('discSetEnableAppeals')?.checked || false
      };

      try {
        const res = await fetch('/api/discipline/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menyimpan pengaturan.');
        this.settings = data.settings;
        notifyToast('Pengaturan Poin & Disiplin berhasil disimpan!', 'success');
        this.loadMppWidget();
      } catch (err) {
        notifyToast(err.message, 'error');
      }
    },

    // ===================== MODAL HELPER =====================
    openModal(title, bodyHtml, footerHtml) {
      let overlay = document.getElementById('discAdminModalOverlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'discAdminModalOverlay';
        overlay.className = 'disc-modal-overlay';
        overlay.innerHTML = `
          <div class="disc-modal" onclick="event.stopPropagation()">
            <div class="disc-modal-header">
              <h3 class="disc-modal-title" id="discAdminModalTitle"></h3>
              <button class="btn btn-outline" style="padding:4px 10px;" onclick="DisciplineAdminModule.closeModal()">✕</button>
            </div>
            <div class="disc-modal-body" id="discAdminModalBody"></div>
            <div class="disc-modal-footer" id="discAdminModalFooter"></div>
          </div>
        `;
        overlay.addEventListener('click', () => this.closeModal());
        document.body.appendChild(overlay);
      }
      document.getElementById('discAdminModalTitle').textContent = title;
      document.getElementById('discAdminModalBody').innerHTML = bodyHtml;
      document.getElementById('discAdminModalFooter').innerHTML = footerHtml || '';
      overlay.classList.add('visible');
      if (typeof window.initCustomSelects === 'function') {
        window.initCustomSelects(overlay);
      }
    },

    closeModal() {
      if (typeof window.closeAllCustomDropdowns === 'function') {
        window.closeAllCustomDropdowns();
      }
      const overlay = document.getElementById('discAdminModalOverlay');
      if (overlay) overlay.classList.remove('visible');
    },

    // Aliases for showPage compatibility
    initInput() { return this.initInputPage(); },
    initHistory() { return this.initHistoryPage(); },
    initCategories() { return this.initCategoriesPage(); },
    initAppeals() { return this.initAppealsPage(); },
    initSettings() { return this.initSettingsPage(); }
  };

  window.DisciplineAdminModule = DisciplineAdminModule;
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => DisciplineAdminModule.loadMppWidget(), 1200);
  });
})();
