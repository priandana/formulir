'use strict';

/**
 * ====================================================================
 * SS08 ENTERPRISE LIVE CHAT ADMIN MODULE (V3.0 - SHARED ADMIN INBOX)
 * Helpdesk Model: Operational Users ↔ Admin Team Shared Inbox
 * Zero External Dependencies • Pure Vanilla JS • XSS-Safe DOM APIs
 * ====================================================================
 */

const CHAT_ADMIN_VERSION = 'v3.0-shared-inbox';
console.info('[ChatAdmin] version:', CHAT_ADMIN_VERSION);

// Avatar Gradient Palette for dynamic user initial avatars
const CHAT_AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)', // Royal Blue
  'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)', // Violet
  'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)', // Cyan
  'linear-gradient(135deg, #10B981 0%, #047857 100%)', // Emerald
  'linear-gradient(135deg, #F59E0B 0%, #B45309 100%)', // Amber
  'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)', // Pink
  'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)'  // Indigo
];

function getChatAvatarGradient(str) {
  if (!str) return CHAT_AVATAR_GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CHAT_AVATAR_GRADIENTS[Math.abs(hash) % CHAT_AVATAR_GRADIENTS.length];
}

const ChatAdminModule = (function() {
  let currentConvId = null;
  let conversations = [];
  let currentMessages = [];
  let currentSettings = null;
  let msgPollingInterval = null;
  let inboxPollingInterval = null;
  let presenceInterval = null;
  let lastMsgId = null;
  let lastMsgCreatedAt = null;
  let currentFilter = 'all';
  let searchQuery = '';
  let isPageActive = false;
  let activeUserData = null;
  let isRightPanelOpen = false;

  async function init() {
    isPageActive = true;
    renderChatPage();
    await checkChatStatus();
    await loadInbox();
    startInboxPolling();
    startPresenceHeartbeat();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('keydown', handleGlobalKeydown);
  }

  function destroy() {
    isPageActive = false;
    clearAllIntervals();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.removeEventListener('keydown', handleGlobalKeydown);
  }

  function handleGlobalKeydown(e) {
    if (e.key === 'Escape') {
      closeStartChatModal();
    }
  }

  function clearAllIntervals() {
    if (msgPollingInterval) clearInterval(msgPollingInterval);
    if (inboxPollingInterval) clearInterval(inboxPollingInterval);
    if (presenceInterval) clearInterval(presenceInterval);
  }

  async function checkChatStatus() {
    try {
      const res = await fetch('/api/chat/settings', { credentials: 'include' });
      if (!res.ok) return;
      currentSettings = await res.json();
      updateStatusBanner(currentSettings.status);
    } catch(e) {
      console.warn('[LiveChat] Could not load settings status', e);
    }
  }

  function updateStatusBanner(status) {
    const banner = document.getElementById('admin-chat-status-banner');
    if (!banner) return;

    if (status === 'DISABLED') {
      banner.style.display = 'flex';
      banner.className = 'chat-disabled-banner';
      banner.innerHTML = `
        <div class="chat-disabled-banner-left">
          <div class="chat-disabled-icon-wrap">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m4.07-12.07A9 9 0 115.93 18.07 9 9 0 0116.07 4.93zM15 9l-6 6"/></svg>
          </div>
          <div>
            <div class="chat-disabled-text-title">Mode Live Chat: NONAKTIF (DISABLED)</div>
            <div class="chat-disabled-text-desc">Pengguna operasional belum dapat melihat atau menggunakan live chat. Chat tersembunyi dengan aman.</div>
          </div>
        </div>
        <button class="chat-disabled-btn" onclick="if(typeof showPage==='function') showPage('chat-settings');">Buka Pengaturan</button>
      `;
    } else if (status === 'READ_ONLY') {
      banner.style.display = 'flex';
      banner.className = 'chat-disabled-banner';
      banner.style.background = 'linear-gradient(90deg, #FFFBEB 0%, #FEF3C7 100%)';
      banner.style.borderColor = '#FDE68A';
      banner.innerHTML = `
        <div class="chat-disabled-banner-left">
          <div class="chat-disabled-icon-wrap" style="background:#FEF3C7;color:#D97706;">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <div>
            <div class="chat-disabled-text-title" style="color:#92400E;">Mode Live Chat: HANYA BACA (READ ONLY)</div>
            <div class="chat-disabled-text-desc" style="color:#B45309;">Pengguna hanya dapat membaca riwayat percakapan lampau. Pengiriman pesan ditutup.</div>
          </div>
        </div>
        <button class="chat-disabled-btn" style="border-color:#FCD34D;color:#92400E;" onclick="if(typeof showPage==='function') showPage('chat-settings');">Buka Pengaturan</button>
      `;
    } else {
      banner.style.display = 'none';
    }
  }

  function renderChatPage() {
    const container = document.getElementById('page-live-chat') || document.getElementById('chat-admin-container');
    if (!container) return;
    container.style.display = 'block';

    container.innerHTML = `
      <div class="chat-admin-layout" id="chat-admin-layout-main">
        <!-- 1. LEFT PANEL: Shared Admin Inbox (~25%, 320px) -->
        <div class="chat-left-panel">
          <div class="chat-panel-header">
            <div class="chat-panel-title-wrap">
              <h3 class="chat-panel-title">Inbox Admin</h3>
              <p class="chat-panel-subtitle">Pesan masuk dari pengguna operasional</p>
            </div>
            <div class="chat-header-actions">
              <button id="admin-new-chat-btn" class="chat-pill-btn chat-pill-btn-primary" title="Mulai Percakapan ke Pengguna">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
                <span>+ Chat</span>
              </button>
            </div>
          </div>

          <!-- Search Bar -->
          <div class="chat-search-wrap">
            <div class="chat-search-inner">
              <span class="chat-search-icon">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              </span>
              <input type="text" id="admin-conv-search" class="chat-search-input" placeholder="Cari nama / username / posisi..." autocomplete="off" />
              <button id="admin-search-clear" class="chat-search-clear" style="display:none;" title="Hapus pencarian">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </div>

          <!-- Filter Segmented Tabs -->
          <div class="chat-filter-segmented" style="overflow-x:auto;padding-bottom:2px;">
            <button class="chat-filter-tab active" data-filter="all">Semua</button>
            <button class="chat-filter-tab" data-filter="unread">
              <span>Belum Dibaca</span>
              <span id="filter-unread-count" class="chat-filter-count" style="display:none;">0</span>
            </button>
            <button class="chat-filter-tab" data-filter="picker">Picker</button>
            <button class="chat-filter-tab" data-filter="sorter">Sorter</button>
            <button class="chat-filter-tab" data-filter="loader">Loader</button>
            <button class="chat-filter-tab" data-filter="return">Return</button>
            <button class="chat-filter-tab" data-filter="qc_outbound">QC Out</button>
          </div>

          <!-- Inbox Conversation List -->
          <div id="admin-conv-list" class="chat-conv-list"></div>
        </div>

        <!-- 2. CENTER PANEL: Conversation Thread (~50-55%) -->
        <div class="chat-center-panel" id="admin-chat-center">
          <div id="admin-chat-status-banner" style="display:none;"></div>

          <!-- Thread Header -->
          <div class="chat-thread-header" id="admin-thread-header">
            <div class="chat-thread-header-left">
              <button id="admin-mobile-back-btn" class="chat-thread-back-btn" title="Kembali ke inbox">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
              </button>
              <div id="admin-chat-header-avatar" class="chat-avatar" style="width:40px;height:40px;border-radius:12px;display:none;"></div>
              <div class="chat-thread-header-info">
                <div id="admin-chat-header-title" class="chat-thread-header-title">Pilih Percakapan</div>
                <div id="admin-chat-header-subtitle" class="chat-thread-header-subtitle">Pilih pengguna di sebelah kiri untuk membaca dan membalas pesan</div>
              </div>
            </div>
            <div class="chat-thread-header-actions" id="admin-chat-header-actions" style="display:none;">
              <button id="admin-toggle-info-btn" class="chat-icon-btn" title="Profil Pengguna">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </button>
            </div>
          </div>

          <!-- Messages Area -->
          <div id="admin-chat-messages" class="chat-messages-area">
            <div class="chat-empty-state-wrap">
              <div class="chat-empty-illustration">
                <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
              </div>
              <h4 class="chat-empty-title">Shared Admin Inbox</h4>
              <p class="chat-empty-desc">Seluruh pesan dari pengguna operasional masuk ke inbox ini secara terpusat. Pilih percakapan untuk merespons.</p>
              <div class="chat-empty-actions">
                <button class="chat-pill-btn chat-pill-btn-primary" onclick="ChatAdminModule.openStartChatModal()">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
                  <span>Mulai Chat ke Pengguna</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Sticky Composer -->
          <div class="chat-composer-wrap" id="admin-chat-input-area" style="display:none;">
            <div class="chat-composer-inner">
              <input type="file" id="admin-file-input" style="display:none;" accept="image/*,.pdf,.xlsx,.xls,.docx,.doc" />
              <button id="admin-attach-btn" type="button" class="chat-icon-btn" style="width:34px;height:34px;border:none;color:#64748B;" title="Kirim Lampiran">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
              </button>
              <input type="text" id="admin-chat-input" class="chat-composer-input" placeholder="Tulis balasan Admin... (Tekan Enter untuk mengirim)" maxlength="4000" autocomplete="off" />
              <button id="admin-chat-send-btn" class="chat-send-icon-btn" title="Kirim Balasan">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- 3. RIGHT PANEL: Operational User Info (~20-25%, 300px) -->
        <div class="chat-right-panel" id="admin-chat-right">
          <div class="chat-info-header">
            <span>Informasi Pengguna</span>
            <button id="admin-close-info-btn" class="chat-icon-btn" style="width:28px;height:28px;border:none;display:none;" title="Tutup Detail">✕</button>
          </div>
          <div id="admin-chat-info" class="chat-info-body">
            <div style="text-align:center;padding:40px 10px;color:var(--chat-text-muted);">
              <svg width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" style="margin-bottom:10px;opacity:0.6;"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
              <div style="font-size:13px;font-weight:600;color:var(--chat-text);">Tidak ada percakapan aktif</div>
              <div style="font-size:12px;margin-top:4px;">Pilih percakapan untuk melihat profil dan berkas pengguna.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal: Start Chat with Operational User -->
      <div id="modal-start-chat" class="chat-modal-backdrop" style="display:none;">
        <div class="chat-modal-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:32px;height:32px;border-radius:8px;background:#EFF6FF;color:#2563EB;display:flex;align-items:center;justify-content:center;">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
              </div>
              <h4 style="margin:0;font-size:16px;font-weight:800;color:#0F172A;">Mulai Chat ke Pengguna</h4>
            </div>
            <button id="modal-close-start-chat" class="chat-icon-btn" style="width:30px;height:30px;border:none;">✕</button>
          </div>
          <p style="font-size:12.5px;color:#64748B;margin:0 0 12px;">Pilih karyawan operasional untuk membuka atau memulai percakapan dukungan.</p>
          <div class="chat-search-inner" style="margin-bottom:12px;">
            <span class="chat-search-icon">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </span>
            <input type="text" id="start-chat-user-search" class="chat-search-input" placeholder="Cari nama, username, atau posisi..." style="height:38px;" />
          </div>
          <div id="start-chat-user-results" style="max-height:280px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:12px;padding:6px;background:#FAFAFA;"></div>
        </div>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    // Search input
    const searchInput = document.getElementById('admin-conv-search');
    const searchClear = document.getElementById('admin-search-clear');
    if (searchInput) {
      searchInput.oninput = (e) => {
        searchQuery = e.target.value.trim();
        if (searchClear) searchClear.style.display = searchQuery ? 'flex' : 'none';
        debounce(loadInbox, 300)();
      };
    }
    if (searchClear) {
      searchClear.onclick = () => {
        if (searchInput) searchInput.value = '';
        searchQuery = '';
        searchClear.style.display = 'none';
        loadInbox();
      };
    }

    // Filter tabs
    const filterTabs = document.querySelectorAll('.chat-filter-tab');
    filterTabs.forEach(tab => {
      tab.onclick = () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.getAttribute('data-filter') || 'all';
        loadInbox();
      };
    });

    // Start Chat modal
    const startChatBtn = document.getElementById('admin-new-chat-btn');
    if (startChatBtn) startChatBtn.onclick = openStartChatModal;

    const modalClose = document.getElementById('modal-close-start-chat');
    if (modalClose) modalClose.onclick = closeStartChatModal;

    const modalSearch = document.getElementById('start-chat-user-search');
    if (modalSearch) {
      modalSearch.oninput = (e) => {
        debounce(() => searchEligibleUsers(e.target.value.trim()), 300)();
      };
    }

    // Composer
    const sendBtn = document.getElementById('admin-chat-send-btn');
    const input = document.getElementById('admin-chat-input');
    if (sendBtn) sendBtn.onclick = sendAdminMessage;
    if (input) {
      input.onkeypress = (e) => {
        if (e.key === 'Enter') sendAdminMessage();
      };
    }

    // Attachments
    const fileInput = document.getElementById('admin-file-input');
    const attachBtn = document.getElementById('admin-attach-btn');
    if (attachBtn && fileInput) {
      attachBtn.onclick = () => fileInput.click();
      fileInput.onchange = handleAdminFileUpload;
    }

    // Mobile back button
    const mobileBack = document.getElementById('admin-mobile-back-btn');
    if (mobileBack) {
      mobileBack.onclick = () => {
        const layout = document.getElementById('chat-admin-layout-main');
        if (layout) layout.classList.remove('mobile-show-center');
      };
    }

    // Toggle info panel
    const toggleInfo = document.getElementById('admin-toggle-info-btn');
    const closeInfo = document.getElementById('admin-close-info-btn');
    if (toggleInfo) {
      toggleInfo.onclick = () => {
        isRightPanelOpen = !isRightPanelOpen;
        const layout = document.getElementById('chat-admin-layout-main');
        if (layout) layout.classList.toggle('show-right-panel', isRightPanelOpen);
      };
    }
    if (closeInfo) {
      closeInfo.onclick = () => {
        isRightPanelOpen = false;
        const layout = document.getElementById('chat-admin-layout-main');
        if (layout) layout.classList.remove('show-right-panel');
      };
    }
  }

  async function loadInbox() {
    try {
      let url = `/api/chat/admin/inbox?filter=${encodeURIComponent(currentFilter)}`;
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;

      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Gagal mengambil data inbox');
      conversations = await res.json();

      renderInboxList(conversations);
      updateTotalUnreadBadge();
    } catch(err) {
      console.error('Error loading admin inbox:', err);
    }
  }

  function renderInboxList(convs) {
    const list = document.getElementById('admin-conv-list');
    if (!list) return;

    if (convs.length === 0) {
      list.innerHTML = `
        <div style="padding:40px 16px;text-align:center;color:#64748B;">
          <div style="width:48px;height:48px;border-radius:14px;background:#F1F5F9;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;color:#94A3B8;">
            <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
          </div>
          <div style="font-size:13px;font-weight:700;color:#0F172A;">Tidak ada percakapan</div>
          <div style="font-size:11.5px;color:#94A3B8;margin-top:4px;">Belum ada pesan masuk pada filter ini.</div>
        </div>
      `;
      return;
    }

    list.innerHTML = '';
    convs.forEach(c => {
      const row = document.createElement('div');
      row.className = `chat-conv-item ${c.id === currentConvId ? 'active' : ''}`;
      row.onclick = () => selectConversation(c);

      const user = c.user || {};
      const initials = (user.nama_lengkap || user.username || '?').substring(0, 2).toUpperCase();
      const gradient = getChatAvatarGradient(user.nama_lengkap || user.username);
      const isOnline = !!user.is_online;
      const unread = c.unread_count || 0;

      const lastContent = c.last_message ? (c.last_message.message_type === 'attachment' ? '📎 [Lampiran]' : c.last_message.content) : 'Belum ada pesan';
      const lastTime = c.last_message ? formatTime(c.last_message.created_at) : '';

      row.innerHTML = `
        <div class="chat-conv-avatar-wrap" style="position:relative;flex-shrink:0;">
          <div class="chat-avatar" style="background:${gradient};width:42px;height:42px;border-radius:14px;color:#fff;font-weight:800;font-size:13.5px;display:flex;align-items:center;justify-content:center;">
            ${initials}
          </div>
          ${isOnline ? '<span style="position:absolute;bottom:-1px;right:-1px;width:11px;height:11px;border-radius:50%;background:#10B981;border:2px solid #fff;"></span>' : ''}
        </div>
        <div class="chat-conv-content" style="flex:1;min-width:0;margin-left:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
            <div style="font-size:13.5px;font-weight:700;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${escapeHtml(user.nama_lengkap || user.username)}
            </div>
            <div style="font-size:11px;color:#94A3B8;font-weight:500;white-space:nowrap;margin-left:6px;">
              ${lastTime}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:#EFF6FF;color:#2563EB;">
              ${escapeHtml(user.posisi || 'Operasional')}
            </span>
            ${user.tipe_karyawan ? `<span style="font-size:10px;font-weight:600;color:#64748B;">• ${escapeHtml(user.tipe_karyawan)}</span>` : ''}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:12px;color:${unread > 0 ? '#0F172A' : '#64748B'};font-weight:${unread > 0 ? '700' : '400'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${escapeHtml(lastContent)}
            </div>
            ${unread > 0 ? `<span style="background:#EF4444;color:#fff;font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:99px;margin-left:6px;flex-shrink:0;">${unread}</span>` : ''}
          </div>
        </div>
      `;
      list.appendChild(row);
    });
  }

  async function selectConversation(conv) {
    currentConvId = conv.id;
    activeUserData = conv.user;

    // Update active highlight in left list
    document.querySelectorAll('.chat-conv-item').forEach(el => el.classList.remove('active'));
    renderInboxList(conversations);

    // Update mobile drawer transition
    const layout = document.getElementById('chat-admin-layout-main');
    if (layout) layout.classList.add('mobile-show-center');

    // Update thread header
    const avatarEl = document.getElementById('admin-chat-header-avatar');
    const titleEl = document.getElementById('admin-chat-header-title');
    const subEl = document.getElementById('admin-chat-header-subtitle');
    const actionsEl = document.getElementById('admin-chat-header-actions');
    const inputArea = document.getElementById('admin-chat-input-area');

    if (avatarEl && activeUserData) {
      avatarEl.style.display = 'flex';
      avatarEl.style.background = getChatAvatarGradient(activeUserData.nama_lengkap || activeUserData.username);
      avatarEl.textContent = (activeUserData.nama_lengkap || activeUserData.username || '?').substring(0, 2).toUpperCase();
    }
    if (titleEl && activeUserData) {
      titleEl.textContent = activeUserData.nama_lengkap || activeUserData.username;
    }
    if (subEl && activeUserData) {
      const statusText = activeUserData.is_online ? 'Online' : 'Offline';
      subEl.innerHTML = `
        <span>${escapeHtml(activeUserData.posisi || 'Operasional')}</span>
        <span>•</span>
        <span>${escapeHtml(activeUserData.tipe_karyawan || 'Karyawan')}</span>
        <span>•</span>
        <span style="color:${activeUserData.is_online ? '#10B981' : '#94A3B8'};font-weight:600;">${statusText}</span>
      `;
    }
    if (actionsEl) actionsEl.style.display = 'flex';
    if (inputArea) inputArea.style.display = 'block';

    renderRightPanelInfo(activeUserData);

    await loadMessages(conv.id);
    startMessagePolling(conv.id);

    // Focus input
    const input = document.getElementById('admin-chat-input');
    if (input) input.focus();
  }

  function renderRightPanelInfo(user) {
    const infoBody = document.getElementById('admin-chat-info');
    if (!infoBody || !user) return;

    const initials = (user.nama_lengkap || user.username || '?').substring(0, 2).toUpperCase();
    const gradient = getChatAvatarGradient(user.nama_lengkap || user.username);
    const statusText = user.is_online ? 'Sedang Aktif (Online)' : (user.last_seen_at ? `Terakhir dilihat ${formatTime(user.last_seen_at)}` : 'Offline');

    infoBody.innerHTML = `
      <div style="padding:16px;text-align:center;border-bottom:1px solid #E2E8F0;background:#FAFBFD;">
        <div style="width:64px;height:64px;border-radius:20px;background:${gradient};color:#fff;font-weight:800;font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;box-shadow:0 4px 14px rgba(0,0,0,0.08);">
          ${initials}
        </div>
        <div style="font-size:15px;font-weight:800;color:#0F172A;line-height:1.2;">${escapeHtml(user.nama_lengkap || user.username)}</div>
        <div style="font-size:12px;color:#64748B;margin-top:3px;">@${escapeHtml(user.username)}</div>
        <div style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;background:${user.is_online ? '#ECFDF5' : '#F1F5F9'};color:${user.is_online ? '#059669' : '#64748B'};font-size:11px;font-weight:700;">
          <span style="width:6px;height:6px;border-radius:50%;background:${user.is_online ? '#10B981' : '#94A3B8'};"></span>
          <span>${statusText}</span>
        </div>
      </div>

      <div style="padding:16px;">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#94A3B8;letter-spacing:0.05em;margin-bottom:10px;">Detail Profil</div>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;">
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#64748B;">Posisi</span>
            <span style="font-weight:700;color:#0F172A;">${escapeHtml(user.posisi || '-')}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#64748B;">Tipe Karyawan</span>
            <span style="font-weight:700;color:#0F172A;">${escapeHtml(user.tipe_karyawan || '-')}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#64748B;">Akses Chat</span>
            <span style="font-weight:700;color:#10B981;">Aktif</span>
          </div>
        </div>
      </div>
    `;
  }

  async function loadMessages(convId) {
    try {
      const res = await fetch(`/api/chat/conversations/${convId}/messages?limit=50`, { credentials: 'include' });
      if (!res.ok) throw new Error('Gagal memuat pesan');
      currentMessages = await res.json();
      renderMessages(currentMessages);

      if (currentMessages.length > 0) {
        const last = currentMessages[currentMessages.length - 1];
        lastMsgId = last.id;
        lastMsgCreatedAt = last.created_at;
        // Mark read for admin team
        await fetch(`/api/chat/conversations/${convId}/read`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message_id: last.id })
        });
      }
    } catch(err) {
      console.error('Error loading messages:', err);
    }
  }

  function renderMessages(msgs) {
    const container = document.getElementById('admin-chat-messages');
    if (!container) return;

    if (msgs.length === 0) {
      container.innerHTML = `
        <div style="padding:60px 20px;text-align:center;color:#64748B;">
          <div style="width:48px;height:48px;border-radius:14px;background:#EFF6FF;color:#2563EB;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
            <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
          </div>
          <div style="font-size:14px;font-weight:700;color:#0F172A;">Belum ada pesan</div>
          <div style="font-size:12px;color:#94A3B8;margin-top:4px;">Tulis pesan di bawah untuk memulai koordinasi dengan pengguna ini.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    msgs.forEach(m => {
      const isFromAdmin = !!m.is_admin_sender;
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.alignItems = isFromAdmin ? 'flex-end' : 'flex-start';
      row.style.marginBottom = '12px';

      // Sender badge
      const senderBadge = document.createElement('div');
      senderBadge.style.fontSize = '11px';
      senderBadge.style.fontWeight = '700';
      senderBadge.style.marginBottom = '3px';
      senderBadge.style.marginLeft = isFromAdmin ? '0' : '4px';
      senderBadge.style.marginRight = isFromAdmin ? '4px' : '0';

      if (isFromAdmin) {
        senderBadge.style.color = '#2563EB';
        senderBadge.textContent = m.isOwn ? 'Anda (Admin)' : `Admin (${m.sender_name || 'Admin'})`;
      } else {
        senderBadge.style.color = '#475569';
        senderBadge.textContent = m.sender_name || activeUserData?.nama_lengkap || 'Pengguna';
      }
      row.appendChild(senderBadge);

      // Bubble
      const bubble = document.createElement('div');
      bubble.className = isFromAdmin ? 'chat-bubble chat-bubble-outgoing' : 'chat-bubble chat-bubble-incoming';
      bubble.style.maxWidth = '78%';
      bubble.style.padding = '10px 14px';
      bubble.style.borderRadius = isFromAdmin ? '16px 16px 4px 16px' : '16px 16px 16px 4px';
      bubble.style.fontSize = '13px';
      bubble.style.lineHeight = '1.45';
      bubble.style.wordBreak = 'break-word';

      if (isFromAdmin) {
        bubble.style.background = 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)';
        bubble.style.color = '#FFFFFF';
        bubble.style.boxShadow = '0 2px 8px rgba(37,99,235,0.2)';
      } else {
        bubble.style.background = '#FFFFFF';
        bubble.style.color = '#0F172A';
        bubble.style.border = '1px solid #E2E8F0';
        bubble.style.boxShadow = '0 1px 4px rgba(0,0,0,0.03)';
      }

      // Attachments
      if (m.message_type === 'attachment' && m.chat_attachments && m.chat_attachments.length > 0) {
        m.chat_attachments.forEach(att => {
          const isImg = (att.mime_type || '').startsWith('image/');
          const attEl = document.createElement('div');
          attEl.style.marginTop = '4px';
          if (isImg) {
            attEl.innerHTML = `
              <a href="/api/chat/attachments/${att.id}" target="_blank" rel="noopener">
                <img src="/api/chat/attachments/${att.id}" style="max-width:100%;max-height:200px;border-radius:10px;object-fit:cover;display:block;margin-bottom:6px;" alt="${escapeHtml(att.original_filename)}" />
              </a>
            `;
          } else {
            attEl.innerHTML = `
              <a href="/api/chat/attachments/${att.id}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${isFromAdmin ? 'rgba(255,255,255,0.15)' : '#F1F5F9'};border-radius:8px;color:${isFromAdmin ? '#fff' : '#0F172A'};text-decoration:none;font-size:12px;font-weight:600;">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(att.original_filename)}</span>
              </a>
            `;
          }
          bubble.appendChild(attEl);
        });
      }

      if (m.content) {
        const textEl = document.createElement('div');
        textEl.textContent = m.content;
        bubble.appendChild(textEl);
      }

      const meta = document.createElement('div');
      meta.style.fontSize = '10px';
      meta.style.marginTop = '4px';
      meta.style.display = 'flex';
      meta.style.alignItems = 'center';
      meta.style.justifyContent = 'flex-end';
      meta.style.gap = '4px';
      meta.style.opacity = isFromAdmin ? '0.85' : '0.6';
      meta.style.color = isFromAdmin ? '#fff' : '#64748B';

      const timeSpan = document.createElement('span');
      timeSpan.textContent = formatTime(m.created_at);
      meta.appendChild(timeSpan);

      bubble.appendChild(meta);
      row.appendChild(bubble);
      container.appendChild(row);
    });

    container.scrollTop = container.scrollHeight;
  }

  async function sendAdminMessage() {
    if (!currentConvId) return;
    const input = document.getElementById('admin-chat-input');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';

    try {
      const res = await fetch(`/api/chat/conversations/${currentConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content, message_type: 'text' })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Gagal mengirim pesan');
      }
      await loadMessages(currentConvId);
      loadInbox();
    } catch(err) {
      alert(err.message);
    }
  }

  async function handleAdminFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !currentConvId) return;

    const maxSize = (currentSettings?.max_attachment_size_mb || 10) * 1024 * 1024;
    if (file.size > maxSize) {
      alert(`Ukuran file melebihi batas (${currentSettings?.max_attachment_size_mb || 10}MB)`);
      e.target.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('conversation_id', currentConvId);
    formData.append('file', file);

    try {
      const attachBtn = document.getElementById('admin-attach-btn');
      if (attachBtn) attachBtn.disabled = true;

      const res = await fetch('/api/chat/attachments', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Gagal mengunggah lampiran');
      }
      await loadMessages(currentConvId);
      loadInbox();
    } catch(err) {
      alert(err.message);
    } finally {
      e.target.value = '';
      const attachBtn = document.getElementById('admin-attach-btn');
      if (attachBtn) attachBtn.disabled = false;
    }
  }

  // --- Start Chat Modal (Admin Only) ---
  function openStartChatModal() {
    const modal = document.getElementById('modal-start-chat');
    if (modal) modal.style.display = 'flex';
    searchEligibleUsers('');
    const input = document.getElementById('start-chat-user-search');
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  function closeStartChatModal() {
    const modal = document.getElementById('modal-start-chat');
    if (modal) modal.style.display = 'none';
  }

  async function searchEligibleUsers(q) {
    const container = document.getElementById('start-chat-user-results');
    if (!container) return;

    try {
      let url = '/api/chat/users';
      if (q) url += `?search=${encodeURIComponent(q)}`;

      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Gagal mengambil daftar pengguna');
      const users = await res.json();

      if (users.length === 0) {
        container.innerHTML = `<div style="padding:20px;text-align:center;color:#64748B;font-size:12px;">Tidak ditemukan pengguna operasional.</div>`;
        return;
      }

      container.innerHTML = '';
      users.forEach(u => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '10px 12px';
        item.style.borderBottom = '1px solid #E2E8F0';
        item.style.cursor = 'pointer';
        item.style.borderRadius = '8px';
        item.onmouseenter = () => item.style.background = '#EFF6FF';
        item.onmouseleave = () => item.style.background = 'transparent';

        const gradient = getChatAvatarGradient(u.nama_lengkap || u.username);
        const initials = (u.nama_lengkap || u.username || '?').substring(0, 2).toUpperCase();

        item.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;min-width:0;">
            <div style="width:34px;height:34px;border-radius:10px;background:${gradient};color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              ${initials}
            </div>
            <div style="min-width:0;">
              <div style="font-size:13px;font-weight:700;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(u.nama_lengkap || u.username)}</div>
              <div style="font-size:11px;color:#64748B;">${escapeHtml(u.posisi || 'Operasional')} • ${escapeHtml(u.tipe_karyawan || 'PHL')}</div>
            </div>
          </div>
          <button style="background:#2563EB;color:#fff;border:none;padding:5px 12px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;">Chat</button>
        `;

        item.onclick = () => startChatWithUser(u);
        container.appendChild(item);
      });
    } catch(err) {
      container.innerHTML = `<div style="padding:16px;text-align:center;color:#EF4444;font-size:12px;">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function startChatWithUser(user) {
    try {
      const res = await fetch('/api/chat/admin/start-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ target_user_id: user.id })
      });
      if (!res.ok) throw new Error('Gagal memulai percakapan');
      const data = await res.json();

      closeStartChatModal();
      await loadInbox();

      // Find and select
      const found = conversations.find(c => c.id === data.conversation.id);
      if (found) {
        selectConversation(found);
      } else {
        selectConversation({
          id: data.conversation.id,
          user: user
        });
      }
    } catch(err) {
      alert(err.message);
    }
  }

  // --- Background Polling ---
  function startInboxPolling() {
    if (inboxPollingInterval) clearInterval(inboxPollingInterval);
    inboxPollingInterval = setInterval(() => {
      if (isPageActive && !document.hidden) {
        loadInbox();
      }
    }, 6000);
  }

  function startMessagePolling(convId) {
    if (msgPollingInterval) clearInterval(msgPollingInterval);
    msgPollingInterval = setInterval(() => {
      if (isPageActive && currentConvId === convId && !document.hidden) {
        loadMessages(convId);
      }
    }, 3000);
  }

  function startPresenceHeartbeat() {
    if (presenceInterval) clearInterval(presenceInterval);
    fetch('/api/chat/presence', { method: 'POST', credentials: 'include' }).catch(()=>{});
    presenceInterval = setInterval(() => {
      if (isPageActive && !document.hidden) {
        fetch('/api/chat/presence', { method: 'POST', credentials: 'include' }).catch(()=>{});
      }
    }, 45000);
  }

  function handleVisibilityChange() {
    if (!document.hidden && isPageActive) {
      loadInbox();
      if (currentConvId) loadMessages(currentConvId);
    }
  }

  async function updateTotalUnreadBadge() {
    try {
      const res = await fetch('/api/chat/unread-count', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const count = data.total_unread || data.unread_count || 0;
      const badge = document.getElementById('filter-unread-count');
      if (badge) {
        if (count > 0) {
          badge.textContent = String(count);
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch(e) {}
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch(e) {
      return '';
    }
  }

  function debounce(fn, delay) {
    let t;
    return function(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    init,
    destroy,
    openStartChatModal,
    closeStartChatModal
  };
})();

/**
 * ====================================================================
 * SS08 CHAT SETTINGS MODULE (V3.0 - HELP DESK MODEL)
 * ====================================================================
 */
const ChatSettingsModule = (function() {
  let initialSettings = {};
  let selectedStatus = 'DISABLED';

  async function init() {
    renderSettingsForm();
    await loadSettings();
  }

  function renderSettingsForm() {
    const container = document.getElementById('page-chat-settings');
    if (!container) return;
    container.style.display = 'block';

    container.innerHTML = `
      <div class="chat-settings-wrap">
        <!-- 1. Intro Page Header -->
        <div class="chat-settings-header">
          <div class="chat-settings-header-left">
            <div class="chat-settings-icon-badge">
              <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
            </div>
            <div>
              <h2 class="chat-settings-title">Pengaturan Live Chat</h2>
              <p class="chat-settings-subtitle">Kelola ketersediaan helpdesk terpusat, fitur lampiran, dan hak akses posisi operasional SS08.</p>
            </div>
          </div>
          <div id="settings-status-chip-wrap">
            <span class="chat-status-chip disabled" id="settings-status-chip">● Status: Nonaktif</span>
          </div>
        </div>

        <!-- Informational Card: Helpdesk Model -->
        <div style="background:linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);border:1px solid #BFDBFE;border-radius:16px;padding:16px 20px;margin-bottom:24px;display:flex;align-items:flex-start;gap:14px;">
          <div style="width:36px;height:36px;border-radius:10px;background:#2563EB;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <div>
            <div style="font-size:14px;font-weight:800;color:#1E40AF;">Model Percakapan: User Operasional → Admin SS08</div>
            <div style="font-size:12.5px;color:#1E3A8A;margin-top:4px;line-height:1.5;">
              Live Chat dirancang sebagai <strong>Shared Admin Inbox (Pusat Bantuan Terpusat)</strong>. Pengguna operasional (Picker, Sorter, Loader, Return, QC) hanya berkomunikasi langsung dengan tim Administrator. Tidak ada fitur chat antar-karyawan.
            </div>
          </div>
        </div>

        <!-- 2. Status Interactive Cards (ACTIVE / READ_ONLY / DISABLED) -->
        <div class="chat-status-cards-grid">
          <!-- Card 1: ACTIVE -->
          <div class="chat-status-card status-active" data-status="ACTIVE" onclick="ChatSettingsModule.selectStatus('ACTIVE')">
            <div class="chat-status-card-header">
              <div class="chat-status-card-icon">
                <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </div>
              <span class="chat-status-check-indicator" style="color:#10B981;"></span>
            </div>
            <div>
              <h4 class="chat-status-card-title">Aktif Penuh (Production)</h4>
              <p class="chat-status-card-desc">User dapat mengirim pesan ke Admin, Admin dapat merespons, dan lampiran file aktif.</p>
            </div>
          </div>

          <!-- Card 2: READ ONLY -->
          <div class="chat-status-card status-readonly" data-status="READ_ONLY" onclick="ChatSettingsModule.selectStatus('READ_ONLY')">
            <div class="chat-status-card-header">
              <div class="chat-status-card-icon">
                <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
              </div>
              <span class="chat-status-check-indicator" style="color:#F59E0B;"></span>
            </div>
            <div>
              <h4 class="chat-status-card-title">Hanya Baca (Read Only)</h4>
              <p class="chat-status-card-desc">Pengguna hanya dapat membaca riwayat percakapan lampau. Pengiriman pesan baru ditutup.</p>
            </div>
          </div>

          <!-- Card 3: DISABLED -->
          <div class="chat-status-card status-disabled selected" data-status="DISABLED" onclick="ChatSettingsModule.selectStatus('DISABLED')">
            <div class="chat-status-card-header">
              <div class="chat-status-card-icon">
                <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
              </div>
              <span class="chat-status-check-indicator" style="color:#EF4444;"></span>
            </div>
            <div>
              <h4 class="chat-status-card-title">Nonaktif (Disabled)</h4>
              <p class="chat-status-card-desc">Fitur chat disembunyikan sepenuhnya dari operasional. Akses perpesanan diblokir oleh server.</p>
            </div>
          </div>
        </div>

        <!-- 3. Feature Switches Section -->
        <div class="chat-section-card">
          <div class="chat-section-header">
            <h3 class="chat-section-title">Fitur & Fungsionalitas Chat</h3>
            <p class="chat-section-desc">Aktifkan atau nonaktifkan fitur spesifik perpesanan.</p>
          </div>

          <div class="chat-toggle-item">
            <div class="chat-toggle-left">
              <div class="chat-toggle-icon">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
              </div>
              <div>
                <div class="chat-toggle-title">Lampiran File & Gambar</div>
                <div class="chat-toggle-desc">Izinkan pengunggahan gambar atau dokumen kerja dalam chat.</div>
              </div>
            </div>
            <label class="chat-switch">
              <input type="checkbox" id="setting-allow-attachment" onchange="ChatSettingsModule.markDirty()" />
              <span class="chat-switch-slider"></span>
            </label>
          </div>

          <div class="chat-toggle-item">
            <div class="chat-toggle-left">
              <div class="chat-toggle-icon">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
              </div>
              <div>
                <div class="chat-toggle-title">Tanda Baca (Read Receipts)</div>
                <div class="chat-toggle-desc">Tampilkan indikator centang dua biru saat pesan telah dibaca oleh penerima.</div>
              </div>
            </div>
            <label class="chat-switch">
              <input type="checkbox" id="setting-show-read-receipt" onchange="ChatSettingsModule.markDirty()" />
              <span class="chat-switch-slider"></span>
            </label>
          </div>

          <div class="chat-toggle-item">
            <div class="chat-toggle-left">
              <div class="chat-toggle-icon">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.828a5 5 0 010-7.072m7.072 0a5 5 0 010 7.072M12 12h.01"/></svg>
              </div>
              <div>
                <div class="chat-toggle-title">Status Online (Kehadiran Realtime)</div>
                <div class="chat-toggle-desc">Tampilkan titik hijau realtime jika karyawan sedang aktif di dashboard.</div>
              </div>
            </div>
            <label class="chat-switch">
              <input type="checkbox" id="setting-show-online" onchange="ChatSettingsModule.markDirty()" />
              <span class="chat-switch-slider"></span>
            </label>
          </div>

          <div class="chat-toggle-item">
            <div class="chat-toggle-left">
              <div class="chat-toggle-icon">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
              </div>
              <div>
                <div class="chat-toggle-title">Notifikasi Browser</div>
                <div class="chat-toggle-desc">Minta izin browser untuk memunculkan notifikasi desktop saat ada pesan baru.</div>
              </div>
            </div>
            <label class="chat-switch">
              <input type="checkbox" id="setting-allow-browser-notification" onchange="ChatSettingsModule.markDirty()" />
              <span class="chat-switch-slider"></span>
            </label>
          </div>

          <!-- Max Attachment Size -->
          <div style="padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:700;font-size:13.5px;color:#0F172A;">Batas Ukuran Lampiran (MB)</div>
              <div style="font-size:12px;color:#64748B;margin-top:2px;">Ukuran berkas maksimum yang dapat diunggah per berkas (1 - 50 MB).</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="number" id="setting-max-attachment-size" min="1" max="50" style="width:80px;height:38px;padding:0 10px;border-radius:10px;border:1px solid #CBD5E1;font-weight:700;font-size:14px;color:#0F172A;text-align:center;" onchange="ChatSettingsModule.markDirty()" />
              <span style="font-weight:700;font-size:13px;color:#64748B;">MB</span>
            </div>
          </div>
        </div>

        <!-- 4. Role Access Section -->
        <div class="chat-section-card">
          <div class="chat-section-header">
            <h3 class="chat-section-title">Akses Posisi Operasional</h3>
            <p class="chat-section-desc">Pilih posisi karyawan operasional yang memiliki izin mengakses Live Chat ke Admin.</p>
          </div>

          <div class="chat-role-grid">
            <div class="chat-role-card locked">
              <div class="chat-role-card-left">
                <div class="chat-role-badge-icon" style="background:#EFF6FF;color:#2563EB;">★</div>
                <div>
                  <div class="chat-role-name">Administrator</div>
                  <div class="chat-role-sub">Akses Wajib • Pengelola Shared Inbox</div>
                </div>
              </div>
              <span style="font-size:11px;font-weight:700;color:#2563EB;background:#EFF6FF;padding:3px 8px;border-radius:6px;">Terkunci</span>
            </div>

            <div class="chat-role-card">
              <div class="chat-role-card-left">
                <div class="chat-role-badge-icon">📦</div>
                <div>
                  <div class="chat-role-name">Picker</div>
                  <div class="chat-role-sub">Karyawan Picking Outbound</div>
                </div>
              </div>
              <label class="chat-switch">
                <input type="checkbox" id="role-picker" onchange="ChatSettingsModule.markDirty()" />
                <span class="chat-switch-slider"></span>
              </label>
            </div>

            <div class="chat-role-card">
              <div class="chat-role-card-left">
                <div class="chat-role-badge-icon">🔀</div>
                <div>
                  <div class="chat-role-name">Sorter</div>
                  <div class="chat-role-sub">Karyawan Sorting & Staging</div>
                </div>
              </div>
              <label class="chat-switch">
                <input type="checkbox" id="role-sorter" onchange="ChatSettingsModule.markDirty()" />
                <span class="chat-switch-slider"></span>
              </label>
            </div>

            <div class="chat-role-card">
              <div class="chat-role-card-left">
                <div class="chat-role-badge-icon">🚚</div>
                <div>
                  <div class="chat-role-name">Loader</div>
                  <div class="chat-role-sub">Karyawan Loading & Dispatch</div>
                </div>
              </div>
              <label class="chat-switch">
                <input type="checkbox" id="role-loader" onchange="ChatSettingsModule.markDirty()" />
                <span class="chat-switch-slider"></span>
              </label>
            </div>

            <div class="chat-role-card">
              <div class="chat-role-card-left">
                <div class="chat-role-badge-icon">↩️</div>
                <div>
                  <div class="chat-role-name">Return</div>
                  <div class="chat-role-sub">Karyawan Retur & Inbound</div>
                </div>
              </div>
              <label class="chat-switch">
                <input type="checkbox" id="role-return" onchange="ChatSettingsModule.markDirty()" />
                <span class="chat-switch-slider"></span>
              </label>
            </div>

            <div class="chat-role-card">
              <div class="chat-role-card-left">
                <div class="chat-role-badge-icon">🛡️</div>
                <div>
                  <div class="chat-role-name">QC Outbound</div>
                  <div class="chat-role-sub">Pemeriksaan Kualitas Paket</div>
                </div>
              </div>
              <label class="chat-switch">
                <input type="checkbox" id="role-qc-outbound" onchange="ChatSettingsModule.markDirty()" />
                <span class="chat-switch-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Sticky Save Floating Bar -->
        <div class="chat-sticky-save" id="chat-sticky-save-bar" style="display:none;">
          <div class="chat-sticky-save-left">
            <span style="font-weight:700;font-size:13.5px;color:#0F172A;">Ada perubahan yang belum disimpan</span>
            <span style="font-size:12px;color:#64748B;">Klik Simpan untuk menerapkan konfigurasi ke production.</span>
          </div>
          <div class="chat-sticky-save-right">
            <button class="chat-btn-cancel" onclick="ChatSettingsModule.resetForm()">Batal</button>
            <button class="chat-btn-save" id="btn-save-settings-sticky" onclick="ChatSettingsModule.saveSettings()">
              Simpan Pengaturan
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function selectStatus(status) {
    selectedStatus = status;
    const cards = document.querySelectorAll('.chat-status-card');
    cards.forEach(c => {
      if (c.getAttribute('data-status') === status) {
        c.classList.add('selected');
      } else {
        c.classList.remove('selected');
      }
    });

    const chip = document.getElementById('settings-status-chip');
    if (chip) {
      chip.className = `chat-status-chip ${status.toLowerCase()}`;
      if (status === 'ACTIVE') chip.textContent = '● Status: Aktif Penuh';
      else if (status === 'READ_ONLY') chip.textContent = '● Status: Hanya Baca';
      else chip.textContent = '● Status: Nonaktif';
    }

    markDirty();
  }

  async function loadSettings() {
    try {
      const res = await fetch('/api/chat/settings', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load settings');
      const s = await res.json();
      initialSettings = JSON.parse(JSON.stringify(s));
      populateForm(s);
      hideDirtyBar();
    } catch(err) {
      showToast('Gagal memuat pengaturan: ' + err.message, 'error');
    }
  }

  function populateForm(s) {
    selectedStatus = s.status || 'DISABLED';
    selectStatus(selectedStatus);

    const attInput = document.getElementById('setting-allow-attachment');
    if (attInput) attInput.checked = s.allow_attachment !== false;

    const readInput = document.getElementById('setting-show-read-receipt');
    if (readInput) readInput.checked = s.show_read_receipt !== false;

    const onlineInput = document.getElementById('setting-show-online');
    if (onlineInput) onlineInput.checked = s.show_online_status !== false;

    const notifInput = document.getElementById('setting-allow-browser-notification');
    if (notifInput) notifInput.checked = !!s.allow_browser_notification;

    const sizeInput = document.getElementById('setting-max-attachment-size');
    if (sizeInput) sizeInput.value = s.max_attachment_size_mb || 10;

    const roles = s.role_access || {};
    const rp = document.getElementById('role-picker');
    if (rp) rp.checked = roles.Picker !== false;
    const rs = document.getElementById('role-sorter');
    if (rs) rs.checked = roles.Sorter !== false;
    const rl = document.getElementById('role-loader');
    if (rl) rl.checked = roles.Loader !== false;
    const rr = document.getElementById('role-return');
    if (rr) rr.checked = roles.Return !== false;
    const rq = document.getElementById('role-qc-outbound');
    if (rq) rq.checked = roles['QC Outbound'] !== false;

    hideDirtyBar();
  }

  function markDirty() {
    const saveBar = document.getElementById('chat-sticky-save-bar');
    if (saveBar) saveBar.style.display = 'flex';
  }

  function hideDirtyBar() {
    const saveBar = document.getElementById('chat-sticky-save-bar');
    if (saveBar) saveBar.style.display = 'none';
  }

  function resetForm() {
    populateForm(initialSettings);
  }

  async function saveSettings() {
    const btn = document.getElementById('btn-save-settings-sticky');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';
    }

    const payload = {
      status: selectedStatus,
      allow_direct_message: true,
      allow_group_chat: false,
      allow_attachment: document.getElementById('setting-allow-attachment').checked,
      show_read_receipt: document.getElementById('setting-show-read-receipt').checked,
      show_online_status: document.getElementById('setting-show-online').checked,
      show_typing_indicator: false,
      allow_browser_notification: document.getElementById('setting-allow-browser-notification').checked,
      max_attachment_size_mb: parseInt(document.getElementById('setting-max-attachment-size').value) || 10,
      role_access: {
        admin: true,
        Picker: document.getElementById('role-picker').checked,
        Sorter: document.getElementById('role-sorter').checked,
        Loader: document.getElementById('role-loader').checked,
        Return: document.getElementById('role-return').checked,
        'QC Outbound': document.getElementById('role-qc-outbound').checked
      }
    };

    try {
      const res = await fetch('/api/chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Gagal menyimpan');
      }
      initialSettings = JSON.parse(JSON.stringify(payload));
      showToast('✓ Pengaturan Live Chat berhasil disimpan!', 'success');
      hideDirtyBar();
    } catch(err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Simpan Pengaturan';
      }
    }
  }

  function showToast(msg, type) {
    const existing = document.querySelector('.chat-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `chat-toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  return {
    init,
    selectStatus,
    markDirty,
    resetForm,
    saveSettings
  };
})();

window.ChatAdminModule = ChatAdminModule;
window.ChatSettingsModule = ChatSettingsModule;
