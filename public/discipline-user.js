/**
 * ============================================================
 * MODUL KINERJA SAYA (USER VIEW) — SS08 OPERATIONAL PORTAL
 * ============================================================
 * Strict Data Isolation:
 * - Hanya mengambil dan menampilkan catatan kinerja milik user yang sedang login
 * - Mendukung fitur "Ajukan Klarifikasi" beserta lampiran bukti pendukung
 * - Menampilkan status poin (AKTIF vs EXPIRED) secara transparan & konstruktif
 * ============================================================
 */

(function () {
  'use strict';

  const state = {
    initialized: false,
    loading: false,
    summaryData: null,
    filterStatus: 'all',
    selectedIncident: null
  };

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateID(dateStr) {
    if (!dateStr) return '-';
    try {
      const clean = String(dateStr).slice(0, 10);
      const parts = clean.split('-');
      if (parts.length === 3) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
        const m = parseInt(parts[1], 10) - 1;
        return `${parseInt(parts[2], 10)} ${months[m] || parts[1]} ${parts[0]}`;
      }
      return clean;
    } catch (_) {
      return String(dateStr);
    }
  }

  function formatDateTimeID(isoStr) {
    if (!isoStr) return '-';
    try {
      return new Date(isoStr).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return String(isoStr);
    }
  }

  function notify(msg, type = 'success') {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
      return;
    }
    const toast = document.getElementById('userDisciplineToast');
    if (toast) {
      toast.textContent = msg;
      toast.style.display = 'block';
      toast.style.background = type === 'error' ? '#dc2626' : '#059669';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 3500);
    } else {
      alert(msg);
    }
  }

  function getPointStatusBadge(status) {
    if (status === 'ACTIVE') return '<span class="disc-badge disc-badge-active"><span class="disc-badge-dot"></span>POIN AKTIF</span>';
    if (status === 'EXPIRED') return '<span class="disc-badge disc-badge-expired"><span class="disc-badge-dot"></span>EXPIRED (0 Poin Aktif)</span>';
    if (status === 'CANCELLED') return '<span class="disc-badge disc-badge-cancelled"><span class="disc-badge-dot"></span>DIBATALKAN</span>';
    return `<span class="disc-badge disc-badge-expired">${esc(status)}</span>`;
  }

  function getCaseStatusBadge(statusKasus, requiresHrReview) {
    if (requiresHrReview || statusKasus === 'NEED_HR_REVIEW') {
      return '<span class="disc-badge disc-badge-hr"><span class="disc-badge-dot"></span>Perlu Review Atasan / HR</span>';
    }
    if (statusKasus === 'IN_REVIEW') return '<span class="disc-badge disc-badge-review"><span class="disc-badge-dot"></span>Menunggu Review Klarifikasi</span>';
    if (statusKasus === 'RESOLVED') return '<span class="disc-badge disc-badge-resolved"><span class="disc-badge-dot"></span>Selesai Pembinaan</span>';
    if (statusKasus === 'CANCELLED') return '<span class="disc-badge disc-badge-cancelled">Dibatalkan</span>';
    return '<span class="disc-badge disc-badge-open"><span class="disc-badge-dot"></span>Tercatat</span>';
  }

  function getAppealBadge(appeal) {
    if (!appeal) return '';
    if (appeal.status === 'PENDING') {
      return '<span class="disc-badge disc-badge-pending"><span class="disc-badge-dot"></span>Klarifikasi Menunggu Review</span>';
    }
    if (appeal.status === 'APPROVED') {
      return '<span class="disc-badge disc-badge-approved"><span class="disc-badge-dot"></span>Klarifikasi Diterima</span>';
    }
    if (appeal.status === 'REJECTED') {
      return '<span class="disc-badge disc-badge-rejected"><span class="disc-badge-dot"></span>Klarifikasi Ditolak</span>';
    }
    return '';
  }

  function updateSidebarBadge(unreadCount) {
    const badge = document.getElementById('kinerjaSayaBadge');
    if (!badge) return;
    const count = Number(unreadCount) || 0;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  async function pollBackgroundBadge() {
    try {
      const res = await fetch('/api/discipline/my/summary', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.success) {
        state.summaryData = data;
        updateSidebarBadge(data.unread_count || 0);
      }
    } catch (_) {
      // ignore background poll error
    }
  }

  function ensureModalsExist() {
    if (document.getElementById('userDiscDetailModal')) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="userDisciplineToast" style="display:none;position:fixed;bottom:24px;right:24px;z-index:10050;color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:700;box-shadow:0 10px 25px rgba(0,0,0,0.2);"></div>

      <!-- MODAL 1: DETAIL CATATAN KINERJA USER -->
      <div class="disc-modal-overlay" id="userDiscDetailModal">
        <div class="disc-modal" style="max-width:700px;">
          <div class="disc-modal-header">
            <div class="disc-modal-title">
              <span>📋 Detail Catatan Kinerja</span>
              <span class="disc-code" id="userDiscModalCode">-</span>
            </div>
            <button type="button" class="disc-modal-close" onclick="DisciplineUserModule.closeModal('userDiscDetailModal')">&times;</button>
          </div>
          <div class="disc-modal-body" id="userDiscDetailBody"></div>
          <div class="disc-modal-footer" id="userDiscDetailFooter">
            <button type="button" class="disc-btn disc-btn-outline" onclick="DisciplineUserModule.closeModal('userDiscDetailModal')">Tutup</button>
          </div>
        </div>
      </div>

      <!-- MODAL 2: AJUKAN KLARIFIKASI -->
      <div class="disc-modal-overlay" id="userDiscAppealModal">
        <div class="disc-modal" style="max-width:580px;">
          <div class="disc-modal-header">
            <div class="disc-modal-title">💬 Ajukan Klarifikasi Catatan Kinerja</div>
            <button type="button" class="disc-modal-close" onclick="DisciplineUserModule.closeModal('userDiscAppealModal')">&times;</button>
          </div>
          <form id="userDiscAppealForm" onsubmit="DisciplineUserModule.submitAppeal(event)">
            <div class="disc-modal-body">
              <input type="hidden" id="userAppealIncidentId">
              <div id="userAppealIncidentInfo" style="background:rgba(37,99,235,0.06);border:1px solid rgba(37,99,235,0.2);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12.5px;"></div>

              <div class="disc-field" style="margin-bottom:14px;">
                <label class="disc-label">Alasan Pengajuan Klarifikasi <span class="req">*</span></label>
                <input type="text" class="disc-input" id="userAppealAlasan" required maxlength="200" placeholder="Contoh: Kendala sistem scanner / instruksi khusus dari Leader Shift">
              </div>

              <div class="disc-field" style="margin-bottom:14px;">
                <label class="disc-label">Kronologi Kejadian Versi Anda <span class="req">*</span></label>
                <textarea class="disc-textarea" id="userAppealKronologi" required rows="4" placeholder="Jelaskan kronologi kejadian secara lengkap, jujur, dan sopan agar dapat direview secara objektif oleh Admin/Atasan..."></textarea>
              </div>

              <div class="disc-field">
                <label class="disc-label">Lampiran Bukti Pendukung (Opsional, Maks 3 File JPG/PNG/PDF)</label>
                <input type="file" class="disc-input" id="userAppealFiles" multiple accept=".jpg,.jpeg,.png,.webp,.pdf">
                <div class="disc-help">Unggah foto bukti atau dokumen pendukung jika ada (maksimal 10MB per file).</div>
              </div>
            </div>
            <div class="disc-modal-footer">
              <button type="button" class="disc-btn disc-btn-outline" onclick="DisciplineUserModule.closeModal('userDiscAppealModal')">Batal</button>
              <button type="submit" class="disc-btn disc-btn-primary" id="userAppealSubmitBtn">Kirim Pengajuan Klarifikasi</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }

  async function init() {
    ensureModalsExist();
    const panel = document.getElementById('panel-kinerja-saya');
    if (!panel) return;

    if (!state.initialized) {
      panel.innerHTML = `
        <div class="disc-wrap" style="padding-top:4px;">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
            <div>
              <h2 style="font-size:19px;font-weight:800;margin:0;color:var(--text-primary,#0f172a);display:flex;align-items:center;gap:8px;">
                <span>🛡️</span> Catatan Kinerja & Evaluasi Saya
              </h2>
              <p style="font-size:12.5px;color:var(--text-muted,#64748b);margin:4px 0 0 0;">
                Informasi catatan pembinaan, riwayat poin disiplin pribadi, dan pengajuan klarifikasi. Data ini bersifat pribadi dan hanya dapat dilihat oleh Anda.
              </p>
            </div>
            <button type="button" class="disc-btn disc-btn-outline disc-btn-sm" onclick="DisciplineUserModule.refresh()">
              🔄 Muat Ulang
            </button>
          </div>

          <div id="userDiscNotifContainer"></div>

          <!-- 4 KARTU UTAMA KINERJA SAYA -->
          <div class="disc-stats-grid" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));">
            <div class="disc-stat-card">
              <div class="disc-stat-top">
                <span class="disc-stat-label">Poin Aktif Saat Ini</span>
                <div class="disc-stat-icon amber">⚡</div>
              </div>
              <div class="disc-stat-value" id="userCardPoinAktif">0</div>
              <div class="disc-stat-sub" id="userCardPoinAktifSub">Poin yang masih dalam masa berlaku</div>
            </div>

            <div class="disc-stat-card">
              <div class="disc-stat-top">
                <span class="disc-stat-label">Kejadian Bulan Ini</span>
                <div class="disc-stat-icon blue">📅</div>
              </div>
              <div class="disc-stat-value" id="userCardBulanIni">0</div>
              <div class="disc-stat-sub">Catatan pada bulan berjalan</div>
            </div>

            <div class="disc-stat-card">
              <div class="disc-stat-top">
                <span class="disc-stat-label">Total Kejadian Periode Ini</span>
                <div class="disc-stat-icon green">📊</div>
              </div>
              <div class="disc-stat-value" id="userCardPeriodeIni">0</div>
              <div class="disc-stat-sub" id="userCardTotalPoinPeriode">Total poin periode: 0 poin</div>
            </div>

            <div class="disc-stat-card">
              <div class="disc-stat-top">
                <span class="disc-stat-label">Klarifikasi Menunggu Review</span>
                <div class="disc-stat-icon red">💬</div>
              </div>
              <div class="disc-stat-value" id="userCardKlarifikasiPending">0</div>
              <div class="disc-stat-sub">Pengajuan sedang ditinjau Admin</div>
            </div>
          </div>

          <!-- FILTER & TIMELINE RIWAYAT -->
          <div class="disc-card">
            <div class="disc-card-header">
              <div>
                <div class="disc-card-title">📜 Riwayat Catatan Kinerja & Pembinaan</div>
                <div class="disc-card-subtitle">Setiap poin yang melewati masa berlaku otomatis berstatus EXPIRED (tidak dihitung sebagai Poin Aktif), namun riwayat tetap tersimpan sebagai bahan evaluasi.</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <select class="disc-select" id="userDiscStatusFilter" style="width:auto;min-width:165px;" onchange="DisciplineUserModule.onFilterChange(this.value)">
                  <option value="all">Semua Status Poin</option>
                  <option value="ACTIVE">Poin Aktif</option>
                  <option value="EXPIRED">Sudah Expired</option>
                  <option value="CANCELLED">Dibatalkan (0 Poin)</option>
                </select>
              </div>
            </div>
            <div class="disc-card-body" id="userDiscTimelineContainer">
              <div class="disc-empty">Memuat riwayat catatan kinerja...</div>
            </div>
          </div>
        </div>
      `;
      state.initialized = true;
    }

    await refresh();
  }

  async function refresh() {
    const timelineEl = document.getElementById('userDiscTimelineContainer');
    if (timelineEl && !state.summaryData) {
      timelineEl.innerHTML = '<div class="disc-empty">Memuat data Kinerja Saya...</div>';
    }

    try {
      const res = await fetch('/api/discipline/my/summary', { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal memuat data Kinerja Saya.');
      }
      state.summaryData = data;
      updateSidebarBadge(data.unread_count || 0);
      renderSummary();
    } catch (err) {
      if (timelineEl) {
        timelineEl.innerHTML = `<div class="disc-empty" style="color:#dc2626;">${esc(err.message)}</div>`;
      }
    }
  }

  function onFilterChange(val) {
    state.filterStatus = val || 'all';
    renderTimeline();
  }

  function renderSummary() {
    const data = state.summaryData;
    if (!data) return;

    const cards = data.cards || {};
    const poinAktifEl = document.getElementById('userCardPoinAktif');
    const bulanIniEl = document.getElementById('userCardBulanIni');
    const periodeIniEl = document.getElementById('userCardPeriodeIni');
    const totalPoinPeriodeEl = document.getElementById('userCardTotalPoinPeriode');
    const klarifikasiEl = document.getElementById('userCardKlarifikasiPending');

    if (poinAktifEl) {
      poinAktifEl.textContent = cards.poin_aktif ?? 0;
      poinAktifEl.style.color = (cards.poin_aktif || 0) > 0 ? '#d97706' : '#059669';
    }
    if (bulanIniEl) bulanIniEl.textContent = cards.kejadian_bulan_ini ?? 0;
    if (periodeIniEl) periodeIniEl.textContent = cards.total_kejadian_periode_ini ?? 0;
    if (totalPoinPeriodeEl) {
      totalPoinPeriodeEl.textContent = `Total poin periode: ${cards.total_poin_periode_ini ?? 0} poin (termasuk expired)`;
    }
    if (klarifikasiEl) klarifikasiEl.textContent = cards.klarifikasi_menunggu_review ?? 0;

    renderNotifications(data.notifications || []);
    renderTimeline();
  }

  function renderNotifications(notifications) {
    const container = document.getElementById('userDiscNotifContainer');
    if (!container) return;

    if (!notifications || notifications.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="disc-user-notif-banner">
        <div class="disc-user-notif-text">
          <span style="font-size:20px;">🔔</span>
          <div>
            <div style="font-weight:800;margin-bottom:2px;">Pemberitahuan Catatan Kinerja (${notifications.length} Baru)</div>
            <div style="font-size:12.5px;font-weight:500;">
              ${notifications.map(n => `• ${esc(n.message)}`).join('<br>')}
            </div>
          </div>
        </div>
        <button type="button" class="disc-btn disc-btn-outline disc-btn-sm" onclick="DisciplineUserModule.markNotificationsRead()">
          ✓ Tandai Sudah Dibaca
        </button>
      </div>
    `;
  }

  async function markNotificationsRead() {
    try {
      await fetch('/api/discipline/my/notifications/read', {
        method: 'POST',
        credentials: 'same-origin'
      });
      if (state.summaryData) {
        state.summaryData.notifications = [];
        state.summaryData.unread_count = 0;
      }
      updateSidebarBadge(0);
      renderNotifications([]);
    } catch (_) {
      // ignore
    }
  }

  function renderTimeline() {
    const container = document.getElementById('userDiscTimelineContainer');
    if (!container || !state.summaryData) return;

    const allItems = state.summaryData.timeline || [];
    const items = state.filterStatus === 'all'
      ? allItems
      : allItems.filter(i => i.status_poin === state.filterStatus);

    if (items.length === 0) {
      container.innerHTML = `
        <div class="disc-empty">
          <div class="disc-empty-icon">🌟</div>
          <div class="disc-empty-title">Tidak Ada Catatan Pelanggaran / Poin Disiplin</div>
          <div class="disc-empty-sub">
            ${state.filterStatus === 'all'
              ? 'Terima kasih atas dedikasi dan kedisiplinan kerja Anda. Pertahankan kinerja terbaik Anda!'
              : 'Tidak ada catatan kinerja untuk filter status poin yang dipilih.'}
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="disc-timeline">
        ${items.map(inc => {
          const dotClass = inc.status_poin === 'EXPIRED'
            ? 'expired'
            : (inc.status_poin === 'CANCELLED' ? 'cancelled' : '');

          const latestAppeal = inc.latest_appeal || null;
          const canAppeal = inc.status_poin !== 'CANCELLED' && (!latestAppeal || latestAppeal.status !== 'PENDING');

          return `
            <div class="disc-timeline-item">
              <div class="disc-timeline-dot ${dotClass}"></div>
              <div class="disc-timeline-card">
                <div class="disc-timeline-top">
                  <div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                      <span class="disc-code">${esc(inc.incident_code)}</span>
                      <span style="font-size:12.5px;font-weight:700;color:var(--text-secondary,#475569);">📅 Tanggal Kejadian: ${formatDateID(inc.incident_date)}</span>
                      ${getPointStatusBadge(inc.status_poin)}
                      ${getCaseStatusBadge(inc.status_kasus, inc.requires_hr_review)}
                      ${getAppealBadge(latestAppeal)}
                    </div>
                    <div class="disc-timeline-title">${esc(inc.kategori_nama)} — ${esc(inc.subkategori)}</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:20px;font-weight:800;color:${inc.status_poin === 'ACTIVE' && inc.poin > 0 ? '#dc2626' : '#64748b'};">
                      +${inc.poin} Poin
                    </div>
                    <div style="font-size:11px;color:var(--text-muted,#64748b);">
                      ${inc.status_poin === 'EXPIRED'
                        ? `Sudah Expired (${formatDateID(inc.expired_at)})`
                        : inc.status_poin === 'CANCELLED'
                          ? 'Poin Dibatalkan (0)'
                          : `Berlaku s/d ${formatDateID(inc.expired_at)}`}
                    </div>
                  </div>
                </div>

                <div class="disc-timeline-desc">
                  <strong>Kronologi Kejadian:</strong><br>
                  ${esc(inc.kronologi)}
                </div>

                ${inc.catatan_pembinaan ? `
                  <div class="disc-coaching-box">
                    <strong>💡 Catatan Pembinaan / Evaluasi:</strong><br>
                    ${esc(inc.catatan_pembinaan)}
                  </div>
                ` : ''}

                ${latestAppeal ? `
                  <div style="margin-top:10px;padding:10px 12px;border-radius:8px;background:${latestAppeal.status === 'APPROVED' ? 'rgba(16,185,129,0.08)' : latestAppeal.status === 'REJECTED' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)'};border:1px solid rgba(148,163,184,0.25);font-size:12px;">
                    <div style="font-weight:700;margin-bottom:3px;">
                      Status Klarifikasi Anda: ${latestAppeal.status === 'PENDING' ? '⏳ Menunggu Review Admin' : latestAppeal.status === 'APPROVED' ? '✅ Klarifikasi Diterima' : '❌ Klarifikasi Ditolak'}
                    </div>
                    <div><strong>Alasan Anda:</strong> ${esc(latestAppeal.alasan)}</div>
                    ${latestAppeal.review_notes ? `<div style="margin-top:4px;"><strong>Keputusan / Catatan Review Admin:</strong> ${esc(latestAppeal.review_notes)}</div>` : ''}
                  </div>
                ` : ''}

                <div class="disc-timeline-meta" style="justify-content:space-between;align-items:center;">
                  <div style="display:flex;gap:14px;flex-wrap:wrap;">
                    <span>👤 Posisi: <strong>${esc(inc.posisi)}</strong></span>
                    <span>📝 Dicatat oleh: <strong>${esc(inc.created_by_name || 'Admin')}</strong> (${formatDateTimeID(inc.created_at)})</span>
                  </div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="disc-btn disc-btn-outline disc-btn-sm" onclick="DisciplineUserModule.openDetail('${esc(inc.id)}')">
                      🔍 Lihat Detail
                    </button>
                    ${canAppeal && !latestAppeal ? `
                      <button type="button" class="disc-btn disc-btn-primary disc-btn-sm" onclick="DisciplineUserModule.openAppealModal('${esc(inc.id)}')">
                        💬 Ajukan Klarifikasi
                      </button>
                    ` : ''}
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  async function openDetail(incidentId) {
    ensureModalsExist();
    const modal = document.getElementById('userDiscDetailModal');
    const body = document.getElementById('userDiscDetailBody');
    const footer = document.getElementById('userDiscDetailFooter');
    const codeEl = document.getElementById('userDiscModalCode');

    if (body) body.innerHTML = '<div class="disc-empty">Memuat detail catatan kinerja...</div>';
    if (modal) modal.classList.add('active');

    try {
      const res = await fetch(`/api/discipline/my/incidents/${encodeURIComponent(incidentId)}`, {
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal memuat detail catatan kinerja.');
      }

      const inc = data.incident;
      state.selectedIncident = inc;
      if (codeEl) codeEl.textContent = inc.incident_code;

      const latestAppeal = (inc.appeals || [])[0] || null;

      body.innerHTML = `
        <div class="disc-detail-grid" style="margin-bottom:16px;">
          <div class="disc-detail-box">
            <div class="disc-detail-label">Tanggal Kejadian</div>
            <div class="disc-detail-val">${formatDateID(inc.incident_date)}</div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Kategori & Pelanggaran</div>
            <div class="disc-detail-val">${esc(inc.kategori_nama)} — ${esc(inc.subkategori)}</div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Jumlah Poin & Status</div>
            <div class="disc-detail-val" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-size:16px;font-weight:800;color:#dc2626;">+${inc.poin} Poin</span>
              ${getPointStatusBadge(inc.status_poin)}
            </div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Masa Berlaku Poin</div>
            <div class="disc-detail-val">
              ${inc.masa_berlaku_bulan} Bulan (s/d ${formatDateID(inc.expired_at)})
            </div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Dicatat Oleh</div>
            <div class="disc-detail-val">${esc(inc.created_by_name || 'Administrator')}</div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Waktu Pencatatan</div>
            <div class="disc-detail-val">${formatDateTimeID(inc.created_at)}</div>
          </div>
        </div>

        <div class="disc-detail-box" style="margin-bottom:14px;">
          <div class="disc-detail-label">Kronologi / Deskripsi Kejadian</div>
          <div class="disc-detail-val" style="white-space:pre-line;font-weight:500;line-height:1.55;">${esc(inc.kronologi)}</div>
        </div>

        ${inc.catatan_pembinaan ? `
          <div class="disc-coaching-box" style="margin-bottom:14px;">
            <strong>💡 Catatan Pembinaan / Arahan Perbaikan:</strong><br>
            <span style="white-space:pre-line;">${esc(inc.catatan_pembinaan)}</span>
          </div>
        ` : ''}

        <!-- LAMPIRAN BUKTI -->
        ${(inc.attachments && inc.attachments.length > 0) ? `
          <div class="disc-detail-box" style="margin-bottom:14px;">
            <div class="disc-detail-label">📎 Lampiran Bukti (${inc.attachments.length})</div>
            <div class="disc-att-list" style="margin-top:8px;">
              ${inc.attachments.map(att => `
                <a class="disc-att-chip" href="${esc(att.signed_url || '#')}" target="_blank" rel="noopener noreferrer">
                  <span>📄 ${esc(att.original_filename)}</span>
                  <span style="font-size:10.5px;color:#64748b;">(${att.source_type === 'APPEAL' ? 'Bukti Klarifikasi' : 'Bukti Kejadian'})</span>
                </a>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- RIWAYAT PENYESUAIAN POIN (ADJUSTMENTS) -->
        ${(inc.adjustments && inc.adjustments.length > 0) ? `
          <div class="disc-detail-box" style="margin-bottom:14px;">
            <div class="disc-detail-label">⚖️ Riwayat Penyesuaian Poin (Adjustment)</div>
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">
              ${inc.adjustments.map(adj => `
                <div style="padding:8px 10px;border-radius:8px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);font-size:12px;">
                  <div style="font-weight:700;color:#059669;">
                    Poin diubah dari ${adj.previous_points} menjadi ${adj.new_points} (${esc(adj.adjustment_type)})
                  </div>
                  <div style="margin-top:2px;">Alasan: ${esc(adj.reason)}</div>
                  <div style="font-size:11px;color:#64748b;margin-top:2px;">Oleh ${esc(adj.created_by_name || adj.adjusted_by_name || 'Administrator')} pada ${formatDateTimeID(adj.created_at)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- RIWAYAT KLARIFIKASI -->
        ${(inc.appeals && inc.appeals.length > 0) ? `
          <div class="disc-detail-box">
            <div class="disc-detail-label">💬 Riwayat Klarifikasi Anda</div>
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">
              ${inc.appeals.map(ap => `
                <div style="padding:10px 12px;border-radius:8px;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.25);font-size:12.5px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <strong>Diajukan pada ${formatDateTimeID(ap.created_at)}</strong>
                    ${getAppealBadge(ap)}
                  </div>
                  <div><strong>Alasan:</strong> ${esc(ap.alasan)}</div>
                  <div style="margin-top:4px;white-space:pre-line;"><strong>Kronologi Anda:</strong> ${esc(ap.kronologi_user)}</div>
                  ${ap.review_notes ? `
                    <div style="margin-top:8px;padding-top:8px;border-top:1px dashed rgba(148,163,184,0.3);">
                      <strong>Catatan Review Admin (${esc(ap.reviewed_by_name || 'Admin')}):</strong><br>
                      ${esc(ap.review_notes)}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      `;

      if (footer) {
        const canAppeal = inc.status_poin !== 'CANCELLED' && !latestAppeal;
        footer.innerHTML = `
          ${canAppeal ? `
            <button type="button" class="disc-btn disc-btn-primary" onclick="DisciplineUserModule.closeModal('userDiscDetailModal'); DisciplineUserModule.openAppealModal('${esc(inc.id)}')">
              💬 Ajukan Klarifikasi
            </button>
          ` : ''}
          <button type="button" class="disc-btn disc-btn-outline" onclick="DisciplineUserModule.closeModal('userDiscDetailModal')">Tutup</button>
        `;
      }
    } catch (err) {
      if (body) {
        body.innerHTML = `<div class="disc-empty" style="color:#dc2626;">${esc(err.message)}</div>`;
      }
    }
  }

  function openAppealModal(incidentId) {
    ensureModalsExist();
    const allItems = (state.summaryData && state.summaryData.timeline) || [];
    const inc = allItems.find(i => i.id === incidentId) || state.selectedIncident;
    if (!inc) return;

    document.getElementById('userAppealIncidentId').value = inc.id;
    document.getElementById('userAppealAlasan').value = '';
    document.getElementById('userAppealKronologi').value = '';
    const fileInput = document.getElementById('userAppealFiles');
    if (fileInput) fileInput.value = '';

    const infoEl = document.getElementById('userAppealIncidentInfo');
    if (infoEl) {
      infoEl.innerHTML = `
        <div style="font-weight:800;margin-bottom:2px;">${esc(inc.incident_code)} — ${esc(inc.kategori_nama)}: ${esc(inc.subkategori)}</div>
        <div>Tanggal Kejadian: <strong>${formatDateID(inc.incident_date)}</strong> | Poin Tercatat: <strong>+${inc.poin} Poin</strong></div>
      `;
    }

    const modal = document.getElementById('userDiscAppealModal');
    if (modal) modal.classList.add('active');
  }

  async function submitAppeal(e) {
    e.preventDefault();
    const incidentId = document.getElementById('userAppealIncidentId').value;
    const alasan = document.getElementById('userAppealAlasan').value.trim();
    const kronologi = document.getElementById('userAppealKronologi').value.trim();
    const filesInput = document.getElementById('userAppealFiles');
    const submitBtn = document.getElementById('userAppealSubmitBtn');

    if (!alasan || !kronologi) {
      notify('Alasan dan kronologi versi Anda wajib diisi.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Mengirim...';
    }

    try {
      const formData = new FormData();
      formData.append('alasan', alasan);
      formData.append('kronologi_user', kronologi);
      if (filesInput && filesInput.files && filesInput.files.length > 0) {
        Array.from(filesInput.files).slice(0, 3).forEach(file => {
          formData.append('evidence_files', file);
        });
      }

      const res = await fetch(`/api/discipline/my/incidents/${encodeURIComponent(incidentId)}/appeals`, {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengirim pengajuan klarifikasi.');
      }

      closeModal('userDiscAppealModal');
      notify('Pengajuan klarifikasi berhasil dikirim dan sedang menunggu review Admin.', 'success');
      await refresh();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Pengajuan Klarifikasi';
      }
    }
  }

  // Jalankan pengecekan badge notifikasi saat halaman user dimuat
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(pollBackgroundBadge, 1200);
  });

  window.DisciplineUserModule = {
    init,
    refresh,
    onFilterChange,
    openDetail,
    openAppealModal,
    submitAppeal,
    markNotificationsRead,
    closeModal,
    pollBackgroundBadge
  };
})();
