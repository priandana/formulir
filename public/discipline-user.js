/**
 * ============================================================================
 * SS08 — Portal User: "Kinerja Saya" (Poin Disiplin & Catatan Pembinaan)
 * Modern, Transparent, Professional & Non-Punitive User Experience
 * Strictly isolated to the currently authenticated operational user.
 * ============================================================================
 */
(function () {
  'use strict';

  const state = {
    summary: null,
    selectedIncident: null,
    initialized: false,
    loading: false,
    error: null
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

  function formatDate(dStr) {
    if (!dStr) return '-';
    const s = String(dStr).slice(0, 10);
    const parts = s.split('-');
    if (parts.length !== 3) return esc(dStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
    const m = parseInt(parts[1], 10) - 1;
    return `${parseInt(parts[2], 10)} ${months[m] || parts[1]} ${parts[0]}`;
  }

  function formatDateTime(iso) {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return esc(iso);
      return d.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return esc(iso);
    }
  }

  function notifyToast(msg, type = 'success') {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
      return;
    }
    const t = document.getElementById('toast');
    if (t) {
      t.textContent = msg;
      t.className = 'toast show ' + (type === 'error' ? 'error' : 'success');
      setTimeout(() => t.classList.remove('show'), 3200);
    } else {
      alert(msg);
    }
  }

  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    return data;
  }

  function getPointStatusBadge(status) {
    const s = String(status || 'ACTIVE').toUpperCase();
    if (s === 'ACTIVE') {
      return `<span class="disc-badge disc-badge-active"><span class="disc-badge-dot"></span>ACTIVE</span>`;
    }
    if (s === 'EXPIRED') {
      return `<span class="disc-badge disc-badge-expired"><span class="disc-badge-dot"></span>EXPIRED</span>`;
    }
    if (s === 'CANCELLED') {
      return `<span class="disc-badge disc-badge-cancelled"><span class="disc-badge-dot"></span>CANCELLED</span>`;
    }
    return `<span class="disc-badge">${esc(s)}</span>`;
  }

  function getSeverityBadge(sev) {
    const s = String(sev || 'LOW').toUpperCase();
    const map = {
      LOW: { cls: 'sev-low', label: 'Severity: LOW' },
      MEDIUM: { cls: 'sev-medium', label: 'Severity: MEDIUM' },
      HIGH: { cls: 'sev-high', label: 'Severity: HIGH' },
      CRITICAL: { cls: 'sev-critical', label: 'Severity: CRITICAL' }
    };
    const item = map[s] || { cls: 'sev-low', label: `Severity: ${s}` };
    return `<span class="disc-badge ${item.cls}">${esc(item.label)}</span>`;
  }

  function getCaseStatusBadge(status, requiresHr, severity) {
    const s = String(status || 'OPEN').toUpperCase();
    const isCritOrHr = Boolean(requiresHr || String(severity || '').toUpperCase() === 'CRITICAL' || s === 'NEED_HR_REVIEW');
    const badges = [];

    if (s === 'IN_REVIEW') {
      badges.push(`<span class="disc-badge disc-badge-review">Status Kasus: IN REVIEW</span>`);
    } else if (s === 'RESOLVED') {
      badges.push(`<span class="disc-badge disc-badge-resolved">Status Kasus: RESOLVED</span>`);
    } else if (s === 'CANCELLED') {
      badges.push(`<span class="disc-badge disc-badge-cancelled">Status Kasus: CANCELLED</span>`);
    } else if (s === 'NEED_HR_REVIEW') {
      badges.push(`<span class="disc-badge disc-badge-hr">Perlu Review Atasan / HR</span>`);
    } else {
      badges.push(`<span class="disc-badge disc-badge-open">Status Kasus: OPEN</span>`);
    }

    if (isCritOrHr && s !== 'NEED_HR_REVIEW' && s !== 'CANCELLED') {
      badges.push(`<span class="disc-badge disc-badge-hr">Perlu Review Atasan / HR</span>`);
    }
    return badges.join(' ');
  }

  function getAppealStatusBadge(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'PENDING') {
      return `<span class="disc-badge disc-badge-pending">Klarifikasi sedang direview</span>`;
    }
    if (s === 'APPROVED') {
      return `<span class="disc-badge disc-badge-approved">Klarifikasi Diterima</span>`;
    }
    if (s === 'REJECTED') {
      return `<span class="disc-badge disc-badge-rejected">Klarifikasi Ditolak</span>`;
    }
    return '';
  }

  /**
   * Evaluates the 4-tier Status Kinerja Saat Ini from summary cards & timeline
   */
  function evaluateUserStatusKinerja(summaryData) {
    const cards = (summaryData && summaryData.cards) || {};
    const settings = (summaryData && summaryData.settings) || {};
    const timeline = (summaryData && summaryData.timeline) || [];

    const poinAktif = Number(cards.poin_aktif) || 0;
    const activeIncidents = timeline.filter(i => i.status_poin === 'ACTIVE');
    const kejadianAktif = cards.kejadian_aktif !== undefined
      ? Number(cards.kejadian_aktif)
      : activeIncidents.length;

    const hrThresholdRaw = cards.hr_review_point_threshold !== undefined
      ? cards.hr_review_point_threshold
      : settings.hr_review_point_threshold;
    const hrThreshold = (hrThresholdRaw !== null && hrThresholdRaw !== undefined && Number(hrThresholdRaw) > 0)
      ? Number(hrThresholdRaw)
      : null;
    const enableThreshold = Boolean(
      (cards.enable_hr_review_threshold !== undefined
        ? cards.enable_hr_review_threshold === true
        : settings.enable_hr_review_threshold === true) &&
      hrThreshold !== null &&
      hrThreshold > 0
    );

    const repeatDays = Number(cards.repeat_incident_days || settings.repeat_incident_days) || 30;
    const repeatThreshold = Number(cards.repeat_incident_threshold || settings.repeat_incident_threshold) || 2;
    const hasRepeatIncident = Boolean(cards.has_repeat_incident);
    const recentIncidentCount = Number(cards.recent_incident_count) || 0;

    const hasCritOrHrActive = activeIncidents.some(
      i =>
        Boolean(i.requires_hr_review) ||
        String(i.severity || '').toUpperCase() === 'CRITICAL' ||
        String(i.status_kasus || '').toUpperCase() === 'NEED_HR_REVIEW'
    );

    let level = 'NORMAL';
    let description = 'Tidak ada catatan yang memerlukan perhatian khusus saat ini.';

    if (!enableThreshold) {
      // A. Threshold OFF: Never use stored hr_review_point_threshold or 60% rule
      // Priority: REVIEW_HR > WARNING > ATTENTION > NORMAL
      if (hasCritOrHrActive || cards.status_level === 'REVIEW_HR') {
        level = 'REVIEW_HR';
        description = 'Catatan Anda memerlukan review lebih lanjut oleh Atasan / HR.';
      } else if (hasRepeatIncident || cards.status_level === 'WARNING') {
        level = 'WARNING';
        description = 'Terdapat kejadian berulang dalam rentang pemantauan. Perhatikan catatan pembinaan dan hindari pengulangan kejadian.';
      } else if (poinAktif > 0 || cards.status_level === 'ATTENTION') {
        level = 'ATTENTION';
        description = 'Terdapat catatan aktif yang perlu diperhatikan. Silakan lihat detail pembinaan pada riwayat kejadian.';
      } else {
        level = 'NORMAL';
        description = 'Tidak ada catatan yang memerlukan perhatian khusus saat ini.';
      }
    } else {
      // B. Threshold ON: Use hrThreshold (>= 100% -> REVIEW_HR, >= 60% -> WARNING, > 0 -> ATTENTION, 0 -> NORMAL)
      // Priority: REVIEW_HR > WARNING > ATTENTION > NORMAL
      const warningPointCutoff = hrThreshold * 0.6;
      if (hasCritOrHrActive || poinAktif >= hrThreshold || cards.status_level === 'REVIEW_HR') {
        level = 'REVIEW_HR';
        description = 'Catatan Anda memerlukan review lebih lanjut oleh Atasan / HR.';
      } else if (hasRepeatIncident || poinAktif >= warningPointCutoff || cards.status_level === 'WARNING') {
        level = 'WARNING';
        description = 'Poin aktif Anda cukup tinggi. Perhatikan catatan pembinaan dan hindari pengulangan kejadian.';
      } else if (poinAktif > 0 || cards.status_level === 'ATTENTION') {
        level = 'ATTENTION';
        description = 'Terdapat catatan aktif yang perlu diperhatikan. Silakan lihat detail pembinaan pada riwayat kejadian.';
      } else {
        level = 'NORMAL';
        description = 'Tidak ada catatan yang memerlukan perhatian khusus saat ini.';
      }
    }

    if (level === 'REVIEW_HR') {
      return {
        level: 'REVIEW_HR',
        themeClass: 'status-theme-review',
        pillClass: 'pill-review',
        label: 'Perlu Review Atasan / HR',
        description: cards.status_description || description,
        iconSvg: `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
        poinAktif,
        kejadianAktif,
        enableThreshold,
        hrThreshold: enableThreshold ? hrThreshold : null,
        hasRepeatIncident,
        recentIncidentCount,
        repeatDays,
        repeatThreshold
      };
    }

    if (level === 'WARNING') {
      return {
        level: 'WARNING',
        themeClass: 'status-theme-warning',
        pillClass: 'pill-warning',
        label: 'Warning',
        description: cards.status_description || description,
        iconSvg: `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
        poinAktif,
        kejadianAktif,
        enableThreshold,
        hrThreshold: enableThreshold ? hrThreshold : null,
        hasRepeatIncident,
        recentIncidentCount,
        repeatDays,
        repeatThreshold
      };
    }

    if (level === 'ATTENTION') {
      return {
        level: 'ATTENTION',
        themeClass: 'status-theme-attention',
        pillClass: 'pill-attention',
        label: 'Perlu Perhatian',
        description: cards.status_description || description,
        iconSvg: `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
        poinAktif,
        kejadianAktif,
        enableThreshold,
        hrThreshold: enableThreshold ? hrThreshold : null,
        hasRepeatIncident,
        recentIncidentCount,
        repeatDays,
        repeatThreshold
      };
    }

    return {
      level: 'NORMAL',
      themeClass: 'status-theme-normal',
      pillClass: 'pill-normal',
      label: 'Normal',
      description: cards.status_description || description,
      iconSvg: `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>`,
      poinAktif,
      kejadianAktif,
      enableThreshold,
      hrThreshold: enableThreshold ? hrThreshold : null,
      hasRepeatIncident,
      recentIncidentCount,
      repeatDays,
      repeatThreshold
    };
  }

  // ===================== INJECT USER TAB & PANEL =====================
  function injectUserUI() {
    if (!document.getElementById('disc-user-css')) {
      const link = document.createElement('link');
      link.id = 'disc-user-css';
      link.rel = 'stylesheet';
      link.href = '/css/discipline.css?v=2.3';
      document.head.appendChild(link);
    }

    const sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav && !document.getElementById('tab-kinerja-saya')) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      btn.id = 'tab-kinerja-saya';
      btn.type = 'button';
      btn.setAttribute('onclick', "window.DisciplineUser.openTab()");
      btn.innerHTML = `
        <div class="sidebar-item-icon">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
          </svg>
        </div>
        <span class="sidebar-item-text">Kinerja Saya</span>
        <span id="kinerja-saya-nav-badge" style="display:none;margin-left:auto;background:#EF4444;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;">0</span>
      `;
      sidebarNav.appendChild(btn);
    }

    const contentArea = document.querySelector('.content-area');
    let panel = document.getElementById('panel-kinerja-saya');
    if (contentArea && !panel) {
      panel = document.createElement('div');
      panel.className = 'tab-panel';
      panel.id = 'panel-kinerja-saya';
      contentArea.appendChild(panel);
    }

    if (panel) {
      panel.innerHTML = `
        <div class="disc-user-page-wrap">
          <!-- Modern Header Banner -->
          <div class="disc-user-header-card">
            <div>
              <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.16);padding:4px 12px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:8px;">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                Portal Kinerja &amp; Pembinaan
              </div>
              <h1 class="disc-user-header-title">Kinerja Saya</h1>
              <p class="disc-user-header-sub">Informasi transparan mengenai poin aktif, status pembinaan, masa berlaku catatan, dan pengajuan klarifikasi.</p>
            </div>
            <button type="button" class="disc-user-refresh-btn" id="disc-user-refresh-btn" onclick="window.DisciplineUser.refresh()">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              <span>Refresh Data</span>
            </button>
          </div>

          <!-- Private Notification Container -->
          <div id="disc-user-notifications"></div>

          <!-- Main Dynamic Content Container (Skeleton / Content / Error) -->
          <div id="disc-user-main-body"></div>
        </div>
      `;
    }

    if (!document.getElementById('disc-user-modals')) {
      const modalWrap = document.createElement('div');
      modalWrap.id = 'disc-user-modals';
      modalWrap.innerHTML = `
        <!-- Detail Kejadian Modal -->
        <div class="disc-modal-overlay" id="disc-user-detail-modal" onclick="if(event.target===this) window.DisciplineUser.closeDetailModal()">
          <div class="disc-modal">
            <div class="disc-modal-header">
              <div>
                <h3 class="disc-modal-title" id="disc-user-detail-title">Detail Catatan Kinerja</h3>
                <div style="font-size:12px;color:var(--text-muted,#64748B);margin-top:2px;">Informasi lengkap catatan kejadian, pembinaan, dan klarifikasi</div>
              </div>
              <button type="button" class="disc-modal-close" aria-label="Tutup" onclick="window.DisciplineUser.closeDetailModal()">&times;</button>
            </div>
            <div class="disc-modal-body" id="disc-user-detail-body"></div>
            <div class="disc-modal-footer" id="disc-user-detail-footer">
              <button type="button" class="disc-btn disc-btn-outline" onclick="window.DisciplineUser.closeDetailModal()">Tutup</button>
            </div>
          </div>
        </div>

        <!-- Modal Ajukan Klarifikasi -->
        <div class="disc-modal-overlay" id="disc-user-appeal-modal" onclick="if(event.target===this) window.DisciplineUser.closeAppealModal()">
          <div class="disc-modal" style="max-width:580px;">
            <div class="disc-modal-header">
              <div>
                <h3 class="disc-modal-title">Ajukan Klarifikasi Kejadian</h3>
                <div style="font-size:12px;color:var(--text-muted,#64748B);margin-top:2px;">Sampaikan penjelasan dan kronologi aktual secara objektif</div>
              </div>
              <button type="button" class="disc-modal-close" aria-label="Tutup" onclick="window.DisciplineUser.closeAppealModal()">&times;</button>
            </div>
            <form id="disc-user-appeal-form" onsubmit="event.preventDefault(); window.DisciplineUser.submitAppeal();">
              <div class="disc-modal-body" style="display:flex;flex-direction:column;gap:14px;">
                <input type="hidden" id="disc-appeal-incident-id">
                <div id="disc-appeal-incident-summary" style="padding:12px 14px;border-radius:12px;background:rgba(37,99,235,0.06);border:1px solid rgba(37,99,235,0.18);font-size:12.5px;line-height:1.5;"></div>
                <div class="disc-field-group">
                  <label class="disc-field-label" for="disc-appeal-alasan">Alasan Utama Klarifikasi <span style="color:#EF4444">*</span></label>
                  <input type="text" class="disc-input" id="disc-appeal-alasan" placeholder="Contoh: Kendala sistem scan / penyesuaian instruksi lapangan..." required maxlength="200">
                </div>
                <div class="disc-field-group">
                  <label class="disc-field-label" for="disc-appeal-kronologi">Kronologi Lengkap Versi Anda <span style="color:#EF4444">*</span></label>
                  <textarea class="disc-textarea" id="disc-appeal-kronologi" rows="4" placeholder="Jelaskan urutan kejadian secara jelas dan faktual untuk bahan pertimbangan review..." required></textarea>
                </div>
                <div class="disc-field-group">
                  <label class="disc-field-label" for="disc-appeal-file">Lampiran Bukti Pendukung (Opsional — JPG, PNG, WEBP, PDF maks 5MB)</label>
                  <input type="file" class="disc-input" id="disc-appeal-file" accept=".jpg,.jpeg,.png,.webp,.pdf">
                </div>
              </div>
              <div class="disc-modal-footer">
                <button type="button" class="disc-btn disc-btn-outline" onclick="window.DisciplineUser.closeAppealModal()">Batal</button>
                <button type="submit" class="disc-btn disc-btn-primary" id="disc-appeal-submit-btn">Kirim Klarifikasi</button>
              </div>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(modalWrap);
    }

    hookSwitchTab();
  }

  function openTab() {
    document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const tabEl = document.getElementById('tab-kinerja-saya');
    const panelEl = document.getElementById('panel-kinerja-saya');
    if (tabEl) tabEl.classList.add('active');
    if (panelEl) panelEl.classList.add('active');
    if (typeof window.closeMobileSidebar === 'function') window.closeMobileSidebar();
    try { sessionStorage.setItem('ss08_active_tab', 'kinerja-saya'); } catch (_) {}
    refreshSummary();
  }

  function hookSwitchTab() {
    if (typeof window.switchTab === 'function' && !window.__discSwitchTabHooked) {
      const origSwitchTab = window.switchTab;
      window.switchTab = function (tab) {
        if (tab === 'kinerja-saya') {
          openTab();
          return;
        }
        return origSwitchTab.apply(this, arguments);
      };
      window.__discSwitchTabHooked = true;
    }
  }

  // ===================== 7. SKELETON LOADING & ERROR STATES =====================
  function renderLoadingSkeleton() {
    const mainEl = document.getElementById('disc-user-main-body');
    if (!mainEl) return;
    mainEl.innerHTML = `
      <div class="disc-page-loader-banner" role="status" aria-live="polite">
        <span class="disc-page-loader-dot"></span>
        <span>Memuat ringkasan dan riwayat kinerja Anda...</span>
      </div>

      <!-- 4 Top Summary Skeleton Cards (Never show 0 while loading) -->
      <div class="disc-user-kpi-grid">
        ${[1, 2, 3, 4].map(() => `
          <div class="disc-user-kpi-card">
            <div class="disc-user-kpi-top">
              <div class="disc-skeleton disc-skeleton-line" style="width:58%;height:12px;"></div>
              <div class="disc-skeleton" style="width:38px;height:38px;border-radius:12px;"></div>
            </div>
            <div class="disc-skeleton disc-skeleton-value" style="width:48%;height:30px;margin:4px 0;"></div>
            <div class="disc-skeleton disc-skeleton-line" style="width:78%;height:11px;"></div>
          </div>
        `).join('')}
      </div>

      <!-- Status Kinerja Skeleton Card -->
      <div class="disc-status-hero-card" style="margin-bottom:22px;">
        <div style="display:flex;align-items:flex-start;gap:16px;">
          <div class="disc-skeleton" style="width:48px;height:48px;border-radius:14px;flex-shrink:0;"></div>
          <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
            <div class="disc-skeleton disc-skeleton-line" style="width:160px;height:11px;"></div>
            <div class="disc-skeleton disc-skeleton-line" style="width:220px;height:20px;"></div>
            <div class="disc-skeleton disc-skeleton-line" style="width:85%;height:13px;"></div>
          </div>
        </div>
        <div style="margin-top:18px;padding-top:16px;border-top:1px solid rgba(148,163,184,0.18);">
          <div class="disc-skeleton disc-skeleton-line" style="width:45%;height:12px;margin-bottom:8px;"></div>
          <div class="disc-skeleton" style="width:100%;height:10px;border-radius:99px;"></div>
        </div>
      </div>

      <!-- Timeline Skeleton Card -->
      <div class="disc-card">
        <div class="disc-card-header">
          <div style="width:100%;">
            <div class="disc-skeleton disc-skeleton-line" style="width:200px;height:16px;margin-bottom:6px;"></div>
            <div class="disc-skeleton disc-skeleton-line" style="width:320px;height:12px;"></div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px;">
          ${[1, 2].map(() => `
            <div style="border:1px solid var(--card-border,#E2E8F0);border-radius:16px;padding:18px;">
              <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;">
                <div class="disc-skeleton disc-skeleton-line" style="width:42%;height:15px;"></div>
                <div class="disc-skeleton disc-skeleton-line" style="width:90px;height:22px;border-radius:99px;"></div>
              </div>
              <div class="disc-skeleton disc-skeleton-line" style="width:92%;height:13px;margin-bottom:8px;"></div>
              <div class="disc-skeleton disc-skeleton-line" style="width:65%;height:13px;"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderErrorState(errMsg) {
    const mainEl = document.getElementById('disc-user-main-body');
    if (!mainEl) return;
    mainEl.innerHTML = `
      <div class="disc-user-state-card" role="alert">
        <div class="disc-user-state-icon error">
          <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
        </div>
        <h3 class="disc-user-state-title">Data kinerja gagal dimuat.</h3>
        <p class="disc-user-state-sub">${esc(errMsg || 'Terjadi kendala saat mengambil data kinerja Anda. Silakan periksa koneksi dan coba kembali.')}</p>
        <div style="margin-top:18px;">
          <button type="button" class="disc-btn disc-btn-primary" onclick="window.DisciplineUser.refresh()">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Coba Lagi
          </button>
        </div>
      </div>
    `;
  }

  // ===================== FETCH & RENDER SUMMARY =====================
  async function refreshSummary() {
    if (state.loading) return;
    state.loading = true;
    state.error = null;
    renderLoadingSkeleton();

    try {
      const data = await apiFetch('/api/discipline/my/summary');
      state.summary = data;
      state.loading = false;
      renderUserNotifications(data);
      renderUserMainBody(data);
    } catch (err) {
      state.loading = false;
      state.error = err.message || 'Gagal memuat data kinerja.';
      renderErrorState(state.error);
    }
  }

  function renderUserNotifications(data) {
    const unread = Number(data.unread_count) || 0;
    const navBadge = document.getElementById('kinerja-saya-nav-badge');
    if (navBadge) {
      if (unread > 0) {
        navBadge.textContent = unread;
        navBadge.style.display = 'inline-block';
      } else {
        navBadge.style.display = 'none';
      }
    }

    const notifEl = document.getElementById('disc-user-notifications');
    if (!notifEl) return;
    const notifs = data.notifications || [];
    if (notifs.length === 0) {
      notifEl.innerHTML = '';
      return;
    }

    notifEl.innerHTML = `
      <div class="disc-user-notif-banner">
        <div class="disc-user-notif-text">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(245,158,11,0.16);color:#D97706;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
          </div>
          <div>
            <div style="font-weight:800;font-size:13.5px;color:var(--text,#0F172A);">${esc(notifs[0].title)}</div>
            <div style="font-size:12.5px;color:var(--text-muted,#475569);margin-top:2px;">
              ${esc(notifs[0].message)}
              ${notifs.length > 1 ? ` (+${notifs.length - 1} pemberitahuan lainnya)` : ''}
            </div>
          </div>
        </div>
        <button type="button" class="disc-btn disc-btn-sm disc-btn-outline" onclick="window.DisciplineUser.markNotificationsRead()">
          Tandai Sudah Dibaca
        </button>
      </div>
    `;
  }

  function renderUserMainBody(data) {
    const mainEl = document.getElementById('disc-user-main-body');
    if (!mainEl) return;

    const cards = data.cards || {};
    const settings = data.settings || {};
    const timeline = data.timeline || [];

    const activeIncidentsCount = cards.kejadian_aktif !== undefined
      ? Number(cards.kejadian_aktif)
      : timeline.filter(i => i.status_poin === 'ACTIVE').length;
    const poinAktif = Number(cards.poin_aktif) || 0;
    const kejadianBulanIni = Number(cards.kejadian_bulan_ini) || 0;
    const klarifikasiPending = Number(cards.klarifikasi_menunggu_review) || 0;

    const statusInfo = evaluateUserStatusKinerja(data);
    const appealsAllowed = settings.enable_user_appeals !== false;

    // 3. Progress Poin Section (Threshold ON vs OFF)
    let progressSectionHtml = '';
    if (statusInfo.enableThreshold && statusInfo.hrThreshold > 0) {
      const pct = Math.min(100, Math.round((poinAktif / statusInfo.hrThreshold) * 100));
      progressSectionHtml = `
        <div class="disc-status-progress-box" id="disc-user-progress-section">
          <div class="disc-status-progress-header">
            <span class="disc-status-progress-label">Indikator Poin Aktif</span>
            <span class="disc-status-progress-text" id="disc-user-progress-text">${poinAktif} dari ${statusInfo.hrThreshold} poin menuju ambang review</span>
          </div>
          <div class="disc-status-progress-track" role="progressbar" aria-valuenow="${poinAktif}" aria-valuemin="0" aria-valuemax="${statusInfo.hrThreshold}">
            <div class="disc-status-progress-fill" style="width:${pct}%;"></div>
          </div>
        </div>
      `;
    } else {
      progressSectionHtml = `
        <div class="disc-status-progress-box" id="disc-user-progress-section">
          <div class="disc-status-no-threshold-row">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:rgba(37,99,235,0.10);color:#2563EB;font-weight:800;font-size:13px;">${poinAktif}</span>
              <div>
                <div style="font-size:13px;font-weight:800;color:var(--text,#0F172A);" id="disc-user-progress-text">Poin Aktif Saat Ini: ${poinAktif}</div>
                <div style="font-size:11.5px;color:var(--text-muted,#64748B);">Status ditentukan berdasarkan poin aktif, tingkat keparahan kejadian, dan riwayat pembinaan.</div>
              </div>
            </div>
            <div style="font-size:12px;font-weight:700;color:var(--text-muted,#475569);">
              ${activeIncidentsCount} Kejadian Aktif
            </div>
          </div>
        </div>
      `;
    }

    // Repeat Incident Indicator
    const repeatIndicatorHtml = statusInfo.hasRepeatIncident
      ? `
        <div class="disc-repeat-indicator" id="disc-user-repeat-indicator">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" style="flex-shrink:0;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span>Terdapat kejadian berulang dalam ${statusInfo.repeatDays} hari terakhir.</span>
        </div>
      `
      : '';

    // 4. Riwayat Kejadian (Timeline / Empty State)
    let timelineSectionHtml = '';
    if (timeline.length === 0) {
      timelineSectionHtml = `
        <div class="disc-user-state-card" id="disc-user-empty-state">
          <div class="disc-user-state-icon">
            <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          </div>
          <h3 class="disc-user-state-title">Belum ada catatan kinerja.</h3>
          <p class="disc-user-state-sub">Riwayat kejadian dan informasi poin akan tampil di sini apabila tersedia.</p>
        </div>
      `;
    } else {
      timelineSectionHtml = `
        <div class="disc-timeline" id="disc-user-timeline-list">
          ${timeline.map(inc => renderTimelineItemCard(inc, appealsAllowed)).join('')}
        </div>
      `;
    }

    mainEl.innerHTML = `
      <!-- 1. Top 4 Summary Cards -->
      <div class="disc-user-kpi-grid" id="disc-user-kpi-grid">
        <!-- Card 1: Poin Aktif -->
        <div class="disc-user-kpi-card">
          <div class="disc-user-kpi-top">
            <span class="disc-user-kpi-label">Poin Aktif</span>
            <div class="disc-user-kpi-icon ${poinAktif > 0 ? 'amber' : 'emerald'}">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
          </div>
          <div class="disc-user-kpi-val" id="disc-kpi-poin-aktif">${poinAktif}</div>
          <div class="disc-user-kpi-sub">Total poin dalam masa berlaku aktif</div>
        </div>

        <!-- Card 2: Kejadian Aktif -->
        <div class="disc-user-kpi-card">
          <div class="disc-user-kpi-top">
            <span class="disc-user-kpi-label">Kejadian Aktif</span>
            <div class="disc-user-kpi-icon blue">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
              </svg>
            </div>
          </div>
          <div class="disc-user-kpi-val" id="disc-kpi-kejadian-aktif">${activeIncidentsCount}</div>
          <div class="disc-user-kpi-sub">Catatan dengan status poin aktif</div>
        </div>

        <!-- Card 3: Kejadian Bulan Ini -->
        <div class="disc-user-kpi-card">
          <div class="disc-user-kpi-top">
            <span class="disc-user-kpi-label">Kejadian Bulan Ini</span>
            <div class="disc-user-kpi-icon purple">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
          </div>
          <div class="disc-user-kpi-val" id="disc-kpi-kejadian-bulan">${kejadianBulanIni}</div>
          <div class="disc-user-kpi-sub">Tercatat pada bulan berjalan</div>
        </div>

        <!-- Card 4: Klarifikasi Menunggu Review -->
        <div class="disc-user-kpi-card">
          <div class="disc-user-kpi-top">
            <span class="disc-user-kpi-label">Klarifikasi Menunggu Review</span>
            <div class="disc-user-kpi-icon ${klarifikasiPending > 0 ? 'amber' : 'blue'}">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
              </svg>
            </div>
          </div>
          <div class="disc-user-kpi-val" id="disc-kpi-klarifikasi-pending">${klarifikasiPending}</div>
          <div class="disc-user-kpi-sub">Pengajuan sedang ditinjau Admin</div>
        </div>
      </div>

      <!-- 2. Card Status Disiplin / Kinerja ("Status Kinerja Saat Ini") -->
      <div class="disc-status-hero-card ${statusInfo.themeClass}" id="disc-user-status-card" data-status-level="${statusInfo.level}">
        <div class="disc-status-hero-top">
          <div class="disc-status-hero-main">
            <div class="disc-status-icon-box">
              ${statusInfo.iconSvg}
            </div>
            <div style="flex:1;">
              <div class="disc-status-eyebrow">Status Kinerja Saat Ini</div>
              <div class="disc-status-title-row">
                <h2 class="disc-status-title" id="disc-user-status-title">${esc(statusInfo.label)}</h2>
                <span class="disc-status-pill ${statusInfo.pillClass}" id="disc-user-status-badge">
                  <span class="disc-badge-dot"></span>
                  ${esc(statusInfo.label)}
                </span>
              </div>
              <p class="disc-status-desc" id="disc-user-status-desc">${esc(statusInfo.description)}</p>
            </div>
          </div>
        </div>
        ${progressSectionHtml}
        ${repeatIndicatorHtml}
      </div>

      <!-- 4. Riwayat Kejadian (Timeline / List) -->
      <div class="disc-card">
        <div class="disc-card-header">
          <div>
            <div class="disc-card-title">
              <svg width="18" height="18" fill="none" stroke="#2563EB" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Riwayat Kejadian &amp; Catatan Pembinaan
            </div>
            <div class="disc-card-sub">Klik pada salah satu kartu kejadian untuk melihat rincian lengkap atau mengajukan klarifikasi.</div>
          </div>
          <span style="font-size:12px;font-weight:700;color:var(--text-muted,#64748B);">${timeline.length} Catatan</span>
        </div>
        ${timelineSectionHtml}
      </div>
    `;
  }

  function renderTimelineItemCard(inc, appealsAllowed) {
    const dotClass = inc.status_poin === 'EXPIRED'
      ? 'dot-expired'
      : (inc.status_poin === 'CANCELLED' ? 'dot-cancelled' : 'dot-active');

    const pointChipClass = inc.status_poin === 'EXPIRED'
      ? 'pts-expired'
      : (inc.status_poin === 'CANCELLED' ? 'pts-cancelled' : 'pts-active');

    const latestAppeal = inc.latest_appeal || (inc.appeals && inc.appeals[0]) || null;
    const canSubmitAppeal = appealsAllowed && inc.status_poin !== 'CANCELLED' && inc.status_kasus !== 'CANCELLED' && !latestAppeal;

    const initialPoin = inc.default_poin !== undefined ? Number(inc.default_poin) : Number(inc.poin);
    const currentPoin = Number(inc.poin) || 0;
    const wasAdjusted = initialPoin !== currentPoin || (inc.adjustments && inc.adjustments.length > 0);

    let appealFeedbackHtml = '';
    if (latestAppeal) {
      const borderCol = latestAppeal.status === 'APPROVED'
        ? '#10B981'
        : (latestAppeal.status === 'REJECTED' ? '#EF4444' : '#F59E0B');
      const bgCol = latestAppeal.status === 'APPROVED'
        ? 'rgba(16, 185, 129, 0.06)'
        : (latestAppeal.status === 'REJECTED' ? 'rgba(239, 68, 68, 0.06)' : 'rgba(245, 158, 11, 0.06)');

      appealFeedbackHtml = `
        <div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:${bgCol};border:1px solid var(--card-border,#E2E8F0);border-left:3.5px solid ${borderCol};font-size:12.5px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <strong style="color:var(--text,#0F172A);">Status Klarifikasi</strong>
            ${getAppealStatusBadge(latestAppeal.status)}
          </div>
          <div style="color:var(--text-muted,#475569);">Alasan Anda: ${esc(latestAppeal.alasan)}</div>
          ${latestAppeal.review_notes ? `
            <div style="margin-top:6px;padding-top:6px;border-top:1px dashed rgba(148,163,184,0.3);color:var(--text,#0F172A);">
              <strong>Catatan Review Admin:</strong> ${esc(latestAppeal.review_notes)}
            </div>
          ` : ''}
        </div>
      `;
    }

    return `
      <div class="disc-user-timeline-card" onclick="window.DisciplineUser.openDetailModal('${esc(inc.id)}')">
        <div class="disc-timeline-dot ${dotClass}"></div>

        <div class="disc-user-timeline-header">
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <span class="disc-code">${esc(inc.incident_code)}</span>
              <span style="font-size:12px;font-weight:700;color:var(--text-muted,#64748B);">${formatDate(inc.incident_date)}</span>
              <span class="disc-user-timeline-cat">• ${esc(inc.kategori_nama)}</span>
            </div>
            <div class="disc-user-timeline-subcat">${esc(inc.subkategori)}</div>
          </div>

          <div class="disc-user-timeline-badges">
            <span class="disc-point-chip ${pointChipClass}">+${currentPoin} Poin</span>
            ${getPointStatusBadge(inc.status_poin)}
          </div>
        </div>

        <!-- Status Kasus & Severity Badges Row -->
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
          ${getCaseStatusBadge(inc.status_kasus, inc.requires_hr_review, inc.severity)}
          ${getSeverityBadge(inc.severity)}
          ${wasAdjusted ? `<span class="disc-badge" style="background:rgba(37,99,235,0.08);color:#1D4ED8;border:1px solid rgba(37,99,235,0.2);">Poin Awal: +${initialPoin}</span>` : ''}
        </div>

        <div class="disc-timeline-desc">${esc(inc.kronologi)}</div>

        ${inc.catatan_pembinaan ? `
          <div class="disc-coaching-box">
            <strong>Catatan Pembinaan / Arahan Perbaikan:</strong><br>
            ${esc(inc.catatan_pembinaan)}
          </div>
        ` : ''}

        ${appealFeedbackHtml}

        <div class="disc-user-timeline-footer">
          <div class="disc-user-timeline-meta-list">
            <span>📅 Tanggal Kejadian: <strong>${formatDate(inc.incident_date)}</strong></span>
            <span>⏳ Masa Berlaku s/d: <strong>${formatDate(inc.expired_at)}</strong> (${Number(inc.masa_berlaku_bulan) || 3} bln)</span>
          </div>
          <div class="disc-user-timeline-actions" onclick="event.stopPropagation();">
            ${canSubmitAppeal ? `
              <button type="button" class="disc-btn disc-btn-sm disc-btn-primary" onclick="window.DisciplineUser.openAppealModal('${esc(inc.id)}')">
                Ajukan Klarifikasi
              </button>
            ` : (latestAppeal ? getAppealStatusBadge(latestAppeal.status) : '')}
            <button type="button" class="disc-btn disc-btn-sm disc-btn-outline" onclick="window.DisciplineUser.openDetailModal('${esc(inc.id)}')">
              Lihat Detail
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ===================== 5. DETAIL KEJADIAN MODAL =====================
  async function openDetailModal(incidentId) {
    try {
      const res = await apiFetch(`/api/discipline/my/incidents/${encodeURIComponent(incidentId)}`);
      const inc = res.incident || res;
      state.selectedIncident = inc;

      const modal = document.getElementById('disc-user-detail-modal');
      const body = document.getElementById('disc-user-detail-body');
      const footer = document.getElementById('disc-user-detail-footer');
      const title = document.getElementById('disc-user-detail-title');

      if (title) title.textContent = `Detail Kejadian — ${inc.incident_code}`;

      const settings = (state.summary && state.summary.settings) || {};
      const appealsAllowed = settings.enable_user_appeals !== false;
      const latestAppeal = inc.latest_appeal || (inc.appeals && inc.appeals[0]) || null;
      const canAppeal = appealsAllowed && inc.status_poin !== 'CANCELLED' && inc.status_kasus !== 'CANCELLED' && !latestAppeal;

      const poinAwal = inc.default_poin !== undefined ? Number(inc.default_poin) : Number(inc.poin) || 0;
      const poinTerbaru = Number(inc.poin) || 0;
      const poinAktifEfektif = inc.status_poin === 'ACTIVE' ? poinTerbaru : 0;

      body.innerHTML = `
        <div class="disc-detail-grid" style="margin-bottom:16px;">
          <div class="disc-detail-box">
            <div class="disc-detail-label">Kode Incident</div>
            <div class="disc-detail-val"><span class="disc-code">${esc(inc.incident_code)}</span></div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Tanggal Kejadian</div>
            <div class="disc-detail-val">${formatDate(inc.incident_date)}</div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Kategori</div>
            <div class="disc-detail-val">${esc(inc.kategori_nama)}</div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Jenis Pelanggaran</div>
            <div class="disc-detail-val">${esc(inc.subkategori)}</div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Poin Awal</div>
            <div class="disc-detail-val">+${poinAwal} Poin</div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Poin Aktif Terbaru</div>
            <div class="disc-detail-val" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span>+${poinAktifEfektif} Poin ${poinTerbaru !== poinAktifEfektif ? `(Tercatat: +${poinTerbaru})` : ''}</span>
              ${getPointStatusBadge(inc.status_poin)}
            </div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Severity</div>
            <div class="disc-detail-val">${getSeverityBadge(inc.severity)}</div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Status Kasus</div>
            <div class="disc-detail-val" style="display:flex;gap:6px;flex-wrap:wrap;">
              ${getCaseStatusBadge(inc.status_kasus, inc.requires_hr_review, inc.severity)}
            </div>
          </div>
          <div class="disc-detail-box">
            <div class="disc-detail-label">Tanggal Expired</div>
            <div class="disc-detail-val">${formatDate(inc.expired_at)} (${Number(inc.masa_berlaku_bulan) || 3} Bulan)</div>
          </div>
        </div>

        <div class="disc-detail-box" style="margin-bottom:12px;">
          <div class="disc-detail-label">Kronologi Kejadian</div>
          <div class="disc-detail-val" style="font-weight:500;line-height:1.6;white-space:pre-wrap;">${esc(inc.kronologi)}</div>
        </div>

        <div class="disc-coaching-box" style="margin-bottom:14px;">
          <strong>Catatan Pembinaan / Arahan Perbaikan:</strong><br>
          ${inc.catatan_pembinaan ? esc(inc.catatan_pembinaan) : '<span style="color:var(--text-muted,#64748B);">Tidak ada catatan pembinaan khusus.</span>'}
        </div>

        ${inc.attachments && inc.attachments.length > 0 ? `
          <div style="margin-bottom:14px;">
            <div class="disc-detail-label" style="margin-bottom:6px;">Bukti / Lampiran</div>
            <div class="disc-att-list">
              ${inc.attachments.map(a => `
                <a class="disc-att-chip" href="${esc(a.signed_url || ('/api/discipline/attachments/' + a.id + '/url'))}" target="_blank" rel="noopener">
                  📎 ${esc(a.original_filename)} <span style="opacity:0.75;">(${a.source_type === 'APPEAL' ? 'Klarifikasi' : 'Kejadian'})</span>
                </a>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${inc.adjustments && inc.adjustments.length > 0 ? `
          <div style="margin-bottom:14px;">
            <div class="disc-detail-label" style="margin-bottom:6px;">Riwayat Adjustment Poin</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${inc.adjustments.map(adj => `
                <div style="padding:10px 12px;border-radius:10px;background:rgba(37,99,235,0.05);border:1px solid rgba(37,99,235,0.16);font-size:12.5px;">
                  <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-weight:700;color:var(--text,#0F172A);">
                    <span>${esc(adj.adjustment_type)}: +${adj.previous_points} Poin &rarr; +${adj.new_points} Poin (${esc(adj.new_status)})</span>
                    <span style="font-size:11.5px;color:var(--text-muted,#64748B);">${formatDateTime(adj.created_at)}</span>
                  </div>
                  <div style="margin-top:4px;color:var(--text-muted,#475569);">Alasan: ${esc(adj.reason)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div>
          <div class="disc-detail-label" style="margin-bottom:6px;">Status Klarifikasi</div>
          ${inc.appeals && inc.appeals.length > 0 ? `
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${inc.appeals.map(ap => `
                <div style="padding:12px 14px;border-radius:10px;border:1px solid var(--card-border,#E2E8F0);background:rgba(148,163,184,0.05);font-size:12.5px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                    <strong>Diajukan pada ${formatDateTime(ap.created_at)}</strong>
                    ${getAppealStatusBadge(ap.status)}
                  </div>
                  <div style="margin-bottom:4px;"><strong>Alasan:</strong> ${esc(ap.alasan)}</div>
                  <div style="color:var(--text-muted,#475569);white-space:pre-wrap;"><strong>Kronologi Anda:</strong> ${esc(ap.kronologi_user)}</div>
                  ${ap.review_notes ? `
                    <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--card-border,#CBD5E1);">
                      <strong>Hasil Review Admin (${ap.reviewed_by_name ? esc(ap.reviewed_by_name) : 'Admin'}):</strong><br>
                      ${esc(ap.review_notes)}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          ` : `
            <div style="padding:12px 14px;border-radius:10px;border:1px dashed var(--card-border,#CBD5E1);font-size:12.5px;color:var(--text-muted,#64748B);">
              Belum ada pengajuan klarifikasi untuk catatan kejadian ini.
            </div>
          `}
        </div>
      `;

      footer.innerHTML = `
        ${canAppeal ? `
          <button type="button" class="disc-btn disc-btn-primary" onclick="window.DisciplineUser.closeDetailModal(); window.DisciplineUser.openAppealModal('${esc(inc.id)}')">
            Ajukan Klarifikasi
          </button>
        ` : ''}
        <button type="button" class="disc-btn disc-btn-outline" onclick="window.DisciplineUser.closeDetailModal()">Tutup</button>
      `;

      modal.classList.add('active');
    } catch (err) {
      notifyToast(err.message || 'Gagal memuat detail kejadian.', 'error');
    }
  }

  function closeDetailModal() {
    const m = document.getElementById('disc-user-detail-modal');
    if (m) m.classList.remove('active');
  }

  function openAppealModal(incidentId) {
    const timeline = (state.summary && state.summary.timeline) || [];
    const inc = timeline.find(i => i.id === incidentId) || state.selectedIncident;
    if (!inc) return;

    document.getElementById('disc-appeal-incident-id').value = inc.id;
    document.getElementById('disc-appeal-alasan').value = '';
    document.getElementById('disc-appeal-kronologi').value = '';
    const fileInput = document.getElementById('disc-appeal-file');
    if (fileInput) fileInput.value = '';

    const summaryBox = document.getElementById('disc-appeal-incident-summary');
    if (summaryBox) {
      summaryBox.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
          <span class="disc-code">${esc(inc.incident_code)}</span>
          <span style="font-weight:700;color:#B91C1C;">+${inc.poin} Poin</span>
        </div>
        <div style="font-weight:800;color:var(--text,#0F172A);">${esc(inc.kategori_nama)} — ${esc(inc.subkategori)}</div>
        <div style="font-size:12px;color:var(--text-muted,#64748B);margin-top:2px;">Tanggal Kejadian: ${formatDate(inc.incident_date)}</div>
      `;
    }

    const modal = document.getElementById('disc-user-appeal-modal');
    if (modal) modal.classList.add('active');
  }

  function closeAppealModal() {
    const m = document.getElementById('disc-user-appeal-modal');
    if (m) m.classList.remove('active');
  }

  async function submitAppeal() {
    const incidentId = document.getElementById('disc-appeal-incident-id').value;
    const alasan = document.getElementById('disc-appeal-alasan').value.trim();
    const kronologi_user = document.getElementById('disc-appeal-kronologi').value.trim();
    const fileInput = document.getElementById('disc-appeal-file');
    const btn = document.getElementById('disc-appeal-submit-btn');

    if (!alasan || !kronologi_user) {
      notifyToast('Alasan dan kronologi versi Anda wajib diisi.', 'error');
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = 'Mengirim...';

      if (fileInput && fileInput.files && fileInput.files[0]) {
        const fd = new FormData();
        fd.append('alasan', alasan);
        fd.append('kronologi_user', kronologi_user);
        fd.append('evidence_files', fileInput.files[0]);
        await apiFetch(`/api/discipline/my/incidents/${encodeURIComponent(incidentId)}/appeals`, {
          method: 'POST',
          body: fd
        });
      } else {
        await apiFetch(`/api/discipline/my/incidents/${encodeURIComponent(incidentId)}/appeals`, {
          method: 'POST',
          body: JSON.stringify({ alasan, kronologi_user })
        });
      }

      notifyToast('Klarifikasi berhasil dikirim dan sedang menunggu review Admin.');
      closeAppealModal();
      await refreshSummary();
    } catch (err) {
      notifyToast(err.message || 'Gagal mengirim klarifikasi.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Kirim Klarifikasi';
    }
  }

  async function markNotificationsRead() {
    try {
      await apiFetch('/api/discipline/my/notifications/read', { method: 'POST' });
      await refreshSummary();
    } catch (_) {}
  }

  async function updateNavBadgeSilently() {
    try {
      const data = await apiFetch('/api/discipline/my/summary');
      state.summary = data;
      renderUserNotifications(data);
    } catch (_) {}
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    injectUserUI();

    try {
      const savedTab = sessionStorage.getItem('ss08_active_tab');
      if (savedTab === 'kinerja-saya') {
        setTimeout(() => {
          if (typeof window.switchTab === 'function') {
            window.switchTab('kinerja-saya');
          }
        }, 250);
      } else {
        updateNavBadgeSilently();
      }
    } catch (_) {
      updateNavBadgeSilently();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('load', hookSwitchTab);

  window.DisciplineUser = {
    openTab,
    refresh: refreshSummary,
    openDetailModal,
    closeDetailModal,
    openAppealModal,
    closeAppealModal,
    submitAppeal,
    markNotificationsRead
  };
})();
