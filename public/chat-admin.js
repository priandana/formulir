'use strict';

/**
 * ====================================================================
 * SS08 ENTERPRISE LIVE CHAT ADMIN MODULE
 * Pure Vanilla JS • High-Performance • Zero External Dependencies
 * XSS-Safe via DOM APIs • Responsive Drill-Down on Mobile
 * ====================================================================
 */

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
  let unreadInterval = null;
  let presenceInterval = null;
  let lastMsgId = null;
  let lastMsgCreatedAt = null;
  let currentFilter = 'all'; // 'all' | 'direct' | 'group' | 'unread'
  let isPageActive = false;
  let activeConvData = null;
  let isRightPanelOpen = false;

  async function init() {
    isPageActive = true;
    renderChatPage();
    await checkChatStatus();
    await loadConversations();
    startUnreadBadgePolling();
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
      closeDmModal();
      closeGroupModal();
    }
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
            <div class="chat-disabled-text-desc">Pengguna operasional belum dapat menggunakan fitur ini. Chat tetap aman dan tersembunyi.</div>
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
        <!-- 1. LEFT PANEL: Conversations (~25%, 320px) -->
        <div class="chat-left-panel">
          <div class="chat-panel-header">
            <div class="chat-panel-title-wrap">
              <h3 class="chat-panel-title">Live Chat</h3>
              <p class="chat-panel-subtitle">Komunikasi internal operasional SS08</p>
            </div>
            <div class="chat-header-actions">
              <button id="admin-new-dm-btn" class="chat-pill-btn chat-pill-btn-outline" title="Mulai Pesan Pribadi (DM)">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                <span>+ DM</span>
              </button>
              <button id="admin-new-group-btn" class="chat-pill-btn chat-pill-btn-primary" title="Buat Grup Percakapan Baru">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                <span>+ Grup</span>
              </button>
            </div>
          </div>

          <!-- Modern Search Bar -->
          <div class="chat-search-wrap">
            <div class="chat-search-inner">
              <span class="chat-search-icon">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              </span>
              <input type="text" id="admin-conv-search" class="chat-search-input" placeholder="Cari percakapan atau pengguna..." autocomplete="off" />
              <button id="admin-search-clear" class="chat-search-clear" title="Hapus pencarian">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </div>

          <!-- Filter Segmented Pills -->
          <div class="chat-filter-segmented">
            <button class="chat-filter-tab active" data-filter="all">Semua</button>
            <button class="chat-filter-tab" data-filter="direct">DM</button>
            <button class="chat-filter-tab" data-filter="group">Grup</button>
            <button class="chat-filter-tab" data-filter="unread">
              <span>Belum Dibaca</span>
              <span id="filter-unread-count" class="chat-filter-count" style="display:none;">0</span>
            </button>
          </div>

          <!-- Conversation List -->
          <div id="admin-conv-list" class="chat-conv-list"></div>
        </div>

        <!-- 2. CENTER PANEL: Messages View (~50-55%) -->
        <div class="chat-center-panel" id="admin-chat-center">
          <!-- Disabled Notice Banner -->
          <div id="admin-chat-status-banner" style="display:none;"></div>

          <!-- Thread Header (Sticky) -->
          <div class="chat-thread-header" id="admin-thread-header">
            <div class="chat-thread-header-left">
              <button id="admin-mobile-back-btn" class="chat-thread-back-btn" title="Kembali ke daftar percakapan">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
              </button>
              <div id="admin-chat-header-avatar" class="chat-avatar" style="width:40px;height:40px;border-radius:12px;display:none;"></div>
              <div class="chat-thread-header-info">
                <div id="admin-chat-header-title" class="chat-thread-header-title">Pilih percakapan</div>
                <div id="admin-chat-header-subtitle" class="chat-thread-header-subtitle">Pilih kontak atau grup di sebelah kiri</div>
              </div>
            </div>
            <div class="chat-thread-header-actions" id="admin-chat-header-actions" style="display:none;">
              <button id="admin-toggle-info-btn" class="chat-icon-btn" title="Informasi Percakapan">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </button>
            </div>
          </div>

          <!-- Thread Scroll Area -->
          <div id="admin-chat-messages" class="chat-messages-area">
            <!-- Empty state default -->
            <div class="chat-empty-state-wrap">
              <div class="chat-empty-illustration">
                <svg width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
              </div>
              <h4 class="chat-empty-title">Mulai Percakapan Pertama</h4>
              <p class="chat-empty-desc">Pilih percakapan dari daftar di sebelah kiri, atau mulai pesan langsung dan buat grup baru untuk koordinasi tim operasional.</p>
              <div class="chat-empty-actions">
                <button class="chat-pill-btn chat-pill-btn-primary" onclick="ChatAdminModule.openDmModal()">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                  <span>+ Pesan Pribadi</span>
                </button>
                <button class="chat-pill-btn chat-pill-btn-outline" onclick="ChatAdminModule.openGroupModal()">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                  <span>+ Buat Grup</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Sticky Composer Area -->
          <div class="chat-composer-wrap" id="admin-chat-input-area" style="display:none;">
            <div class="chat-composer-inner">
              <input type="text" id="admin-chat-input" class="chat-composer-input" placeholder="Tulis pesan... (Tekan Enter untuk mengirim)" maxlength="4000" autocomplete="off" />
              <button id="admin-chat-send-btn" class="chat-send-icon-btn" title="Kirim Pesan">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- 3. RIGHT PANEL: Details (~20-25%, 300px) -->
        <div class="chat-right-panel" id="admin-chat-right">
          <div class="chat-info-header">
            <span>Informasi Percakapan</span>
            <button id="admin-close-info-btn" class="chat-icon-btn" style="width:28px;height:28px;border:none;display:none;" title="Tutup Detail">✕</button>
          </div>
          <div id="admin-chat-info" class="chat-info-body">
            <div style="text-align:center;padding:40px 10px;color:var(--chat-text-muted);">
              <svg width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" style="margin-bottom:10px;opacity:0.6;"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <div style="font-size:13px;font-weight:600;color:var(--chat-text);">Tidak ada percakapan aktif</div>
              <div style="font-size:12px;margin-top:4px;">Pilih percakapan untuk melihat profil dan daftar anggota.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal: New Direct Message (DM) -->
      <div id="modal-new-dm" class="chat-modal-backdrop" style="display:none;">
        <div class="chat-modal-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:32px;height:32px;border-radius:8px;background:#EFF6FF;color:#2563EB;display:flex;align-items:center;justify-content:center;">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
              </div>
              <h4 style="margin:0;font-size:16px;font-weight:800;color:#0F172A;">Mulai Pesan Pribadi</h4>
            </div>
            <button id="modal-close-dm" class="chat-icon-btn" style="width:30px;height:30px;border:none;">✕</button>
          </div>
          <p style="font-size:12.5px;color:#64748B;margin:0 0 12px;">Pilih rekan kerja operasional untuk memulai obrolan langsung 1-on-1.</p>
          <div class="chat-search-inner" style="margin-bottom:12px;">
            <span class="chat-search-icon">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </span>
            <input type="text" id="dm-user-search" class="chat-search-input" placeholder="Cari nama atau username..." style="height:38px;" />
          </div>
          <div id="dm-user-results" style="max-height:260px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:12px;padding:6px;background:#FAFAFA;"></div>
        </div>
      </div>

      <!-- Modal: New Group -->
      <div id="modal-new-group" class="chat-modal-backdrop" style="display:none;">
        <div class="chat-modal-card" style="max-width:480px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:32px;height:32px;border-radius:8px;background:#EFF6FF;color:#2563EB;display:flex;align-items:center;justify-content:center;">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              </div>
              <h4 style="margin:0;font-size:16px;font-weight:800;color:#0F172A;">Buat Grup Percakapan Baru</h4>
            </div>
            <button id="modal-close-group" class="chat-icon-btn" style="width:30px;height:30px;border:none;">✕</button>
          </div>
          <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:700;display:block;margin-bottom:6px;color:#334155;">Nama Grup</label>
            <input type="text" id="group-name-input" class="chat-search-input" placeholder="Contoh: Tim Shift Pagi / Logistik" maxlength="100" style="height:38px;padding-left:14px;" />
          </div>
          <div style="margin-bottom:16px;">
            <label style="font-size:12px;font-weight:700;display:block;margin-bottom:6px;color:#334155;">Pilih Anggota</label>
            <input type="text" id="group-member-search" class="chat-search-input" placeholder="Filter nama anggota..." style="height:36px;padding-left:14px;margin-bottom:8px;" />
            <div id="group-member-results" style="max-height:200px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:12px;padding:6px;background:#FAFAFA;"></div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button id="group-cancel-btn" class="chat-pill-btn chat-pill-btn-outline" style="padding:8px 16px;">Batal</button>
            <button id="group-submit-btn" class="chat-pill-btn chat-pill-btn-primary" style="padding:8px 18px;">Buat Grup</button>
          </div>
        </div>
      </div>
    `;

    // Event Bindings
    document.getElementById('admin-chat-send-btn').onclick = sendMessage;
    document.getElementById('admin-chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Mobile Back Button
    const mobileBackBtn = document.getElementById('admin-mobile-back-btn');
    if (mobileBackBtn) {
      mobileBackBtn.onclick = () => {
        const layout = document.getElementById('chat-admin-layout-main');
        if (layout) layout.classList.remove('mobile-view-thread');
      };
    }

    // Toggle Info Panel (tablet / mobile)
    const toggleInfoBtn = document.getElementById('admin-toggle-info-btn');
    if (toggleInfoBtn) {
      toggleInfoBtn.onclick = () => {
        isRightPanelOpen = !isRightPanelOpen;
        const rightPanel = document.getElementById('admin-chat-right');
        if (rightPanel) {
          rightPanel.style.display = isRightPanelOpen ? 'flex' : '';
        }
      };
    }

    // Segmented Filter Tabs
    const filterTabs = container.querySelectorAll('.chat-filter-tab');
    filterTabs.forEach(tab => {
      tab.onclick = () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        renderConversationList(conversations);
      };
    });

    // Search Input & Clear
    const searchInput = document.getElementById('admin-conv-search');
    const searchClear = document.getElementById('admin-search-clear');
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      searchClear.style.display = q ? 'flex' : 'none';
      if (!q) {
        renderConversationList(conversations);
      } else {
        const filtered = conversations.filter(c => {
          const name = (c.display_name || c.name || '').toLowerCase();
          const last = (c.last_message?.content || '').toLowerCase();
          return name.includes(q) || last.includes(q);
        });
        renderConversationList(filtered);
      }
    });
    searchClear.onclick = () => {
      searchInput.value = '';
      searchClear.style.display = 'none';
      renderConversationList(conversations);
      searchInput.focus();
    };

    // Modal triggers
    document.getElementById('admin-new-dm-btn').onclick = openDmModal;
    document.getElementById('modal-close-dm').onclick = closeDmModal;
    document.getElementById('admin-new-group-btn').onclick = openGroupModal;
    document.getElementById('modal-close-group').onclick = closeGroupModal;
    document.getElementById('group-cancel-btn').onclick = closeGroupModal;
    document.getElementById('group-submit-btn').onclick = submitCreateGroup;
  }

  async function loadConversations() {
    try {
      const res = await fetch('/api/chat/conversations', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load conversations');
      conversations = await res.json();
      renderConversationList(conversations);
      updateNavBadge();
    } catch(err) {
      console.error('Error loading conversations:', err);
    }
  }

  function renderConversationList(convs) {
    const list = document.getElementById('admin-conv-list');
    if (!list) return;
    list.innerHTML = '';

    // Calculate unread count for badge
    const totalUnread = convs.filter(c => (c.unread_count || 0) > 0).length;
    const filterBadge = document.getElementById('filter-unread-count');
    if (filterBadge) {
      if (totalUnread > 0) {
        filterBadge.textContent = totalUnread;
        filterBadge.style.display = 'inline-block';
      } else {
        filterBadge.style.display = 'none';
      }
    }

    let filtered = convs;
    if (currentFilter === 'direct') filtered = convs.filter(c => !c.is_group);
    else if (currentFilter === 'group') filtered = convs.filter(c => c.is_group);
    else if (currentFilter === 'unread') filtered = convs.filter(c => (c.unread_count || 0) > 0);

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty-state-wrap';
      empty.style.padding = '40px 14px';

      const icon = document.createElement('div');
      icon.className = 'chat-empty-illustration';
      icon.style.width = '64px';
      icon.style.height = '64px';
      icon.style.marginBottom = '12px';
      icon.innerHTML = `<svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`;

      const title = document.createElement('h5');
      title.style.margin = '0 0 4px';
      title.style.fontSize = '14px';
      title.style.fontWeight = '700';
      title.style.color = 'var(--chat-text)';
      title.textContent = 'Tidak Ada Percakapan';

      const desc = document.createElement('p');
      desc.style.margin = '0';
      desc.style.fontSize = '12px';
      desc.style.color = 'var(--chat-text-muted)';
      desc.textContent = currentFilter === 'unread' ? 'Semua pesan sudah dibaca.' : 'Mulai chat baru menggunakan tombol di atas.';

      empty.appendChild(icon);
      empty.appendChild(title);
      empty.appendChild(desc);
      list.appendChild(empty);
      return;
    }

    filtered.forEach(c => {
      const item = document.createElement('div');
      item.className = 'chat-conv-item' + (c.id === currentConvId ? ' active' : '') + ((c.unread_count || 0) > 0 ? ' unread' : '');
      item.onclick = () => selectConversation(c.id);

      // Avatar with initial gradient
      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'chat-avatar-wrap';

      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      const displayName = c.display_name || c.name || 'Percakapan';
      avatar.textContent = displayName.charAt(0).toUpperCase();
      avatar.style.background = c.is_group 
        ? 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' 
        : getChatAvatarGradient(displayName);

      avatarWrap.appendChild(avatar);

      // Online status dot for DM
      if (!c.is_group && c.other_user_online) {
        const dot = document.createElement('span');
        dot.className = 'chat-online-dot';
        avatarWrap.appendChild(dot);
      }

      // Content text
      const content = document.createElement('div');
      content.className = 'chat-conv-content';

      const rowTop = document.createElement('div');
      rowTop.className = 'chat-conv-row-top';

      const title = document.createElement('span');
      title.className = 'chat-conv-title';
      title.textContent = displayName;

      const time = document.createElement('span');
      time.className = 'chat-conv-time';
      if (c.updated_at) time.textContent = formatTime(c.updated_at);

      rowTop.appendChild(title);
      rowTop.appendChild(time);

      const rowBottom = document.createElement('div');
      rowBottom.className = 'chat-conv-row-bottom';

      const preview = document.createElement('span');
      preview.className = 'chat-conv-preview';
      preview.textContent = c.last_message?.content || (c.is_former_member ? '(Anda telah keluar)' : 'Belum ada pesan');

      rowBottom.appendChild(preview);

      if ((c.unread_count || 0) > 0) {
        const badge = document.createElement('span');
        badge.className = 'chat-unread-badge';
        badge.textContent = c.unread_count > 99 ? '99+' : String(c.unread_count);
        rowBottom.appendChild(badge);
      }

      content.appendChild(rowTop);
      content.appendChild(rowBottom);

      item.appendChild(avatarWrap);
      item.appendChild(content);
      list.appendChild(item);
    });
  }

  async function selectConversation(convId) {
    currentConvId = convId;
    stopMessagePolling();
    lastMsgId = null;
    lastMsgCreatedAt = null;
    currentMessages = [];

    // Trigger mobile responsive drill-down view
    const layout = document.getElementById('chat-admin-layout-main');
    if (layout) layout.classList.add('mobile-view-thread');

    const conv = conversations.find(c => c.id === convId);
    activeConvData = conv;

    const titleEl = document.getElementById('admin-chat-header-title');
    const subEl = document.getElementById('admin-chat-header-subtitle');
    const avatarEl = document.getElementById('admin-chat-header-avatar');
    const inputArea = document.getElementById('admin-chat-input-area');
    const actionsArea = document.getElementById('admin-chat-header-actions');

    if (conv) {
      const dName = conv.display_name || conv.name || 'Percakapan';
      titleEl.textContent = dName;
      subEl.innerHTML = conv.is_group ? 'Grup Komunikasi' : 'Pesan Pribadi (Direct Message)';
      avatarEl.style.display = 'flex';
      avatarEl.textContent = dName.charAt(0).toUpperCase();
      avatarEl.style.background = conv.is_group 
        ? 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' 
        : getChatAvatarGradient(dName);
      if (actionsArea) actionsArea.style.display = 'flex';
    }

    inputArea.style.display = 'block';
    const chatInput = document.getElementById('admin-chat-input');
    if (chatInput) chatInput.focus();

    await loadMessages(convId);
    startMessagePolling(convId);
    loadConversationInfo(convId);
    markRead(convId);
    renderConversationList(conversations);
  }

  async function loadMessages(convId, afterId, afterCreatedAt) {
    try {
      let url = `/api/chat/conversations/${convId}/messages?limit=40`;
      if (afterId && afterCreatedAt) {
        url += `&after_id=${encodeURIComponent(afterId)}&after_created_at=${encodeURIComponent(afterCreatedAt)}`;
      }
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load messages');
      const msgs = await res.json();
      const msgArray = Array.isArray(msgs) ? msgs : (msgs.messages || []);

      if (afterId) {
        if (msgArray.length > 0) {
          currentMessages = currentMessages.concat(msgArray);
          renderMessages(msgArray, 'append');
        }
      } else {
        currentMessages = msgArray;
        renderMessages(msgArray, 'replace');
      }

      if (currentMessages.length > 0) {
        const last = currentMessages[currentMessages.length - 1];
        lastMsgId = last.id;
        lastMsgCreatedAt = last.created_at;
      }
    } catch(err) {
      console.error('Error loading messages:', err);
    }
  }

  function renderMessages(messages, mode) {
    const container = document.getElementById('admin-chat-messages');
    if (!container) return;
    if (mode === 'replace') container.innerHTML = '';

    if (mode === 'replace' && messages.length === 0) {
      const emptyWrap = document.createElement('div');
      emptyWrap.className = 'chat-empty-state-wrap';
      emptyWrap.innerHTML = `
        <div class="chat-empty-illustration" style="width:68px;height:68px;margin-bottom:12px;">
          <svg width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
        </div>
        <h4 class="chat-empty-title" style="font-size:16px;">Belum Ada Pesan</h4>
        <p class="chat-empty-desc" style="font-size:12.5px;margin-bottom:0;">Jadilah yang pertama mengirim pesan dalam obrolan ini.</p>
      `;
      container.appendChild(emptyWrap);
      return;
    }

    let lastDateStr = null;
    messages.forEach(msg => {
      // Day separator
      if (msg.created_at) {
        const dStr = new Date(msg.created_at).toDateString();
        if (dStr !== lastDateStr) {
          lastDateStr = dStr;
          const sep = document.createElement('div');
          sep.className = 'chat-day-separator';
          sep.textContent = formatDaySeparator(msg.created_at);
          container.appendChild(sep);
        }
      }
      container.appendChild(createMessageElement(msg));
    });

    container.scrollTop = container.scrollHeight;
  }

  function createMessageElement(msg) {
    const row = document.createElement('div');
    row.className = 'chat-message-row ' + (msg.isOwn ? 'sent' : 'recv');
    row.id = 'msg-' + msg.id;

    // Sender name (only for received messages)
    if (!msg.isOwn && msg.users) {
      const sender = document.createElement('span');
      sender.className = 'chat-sender-name';
      sender.textContent = msg.users.nama_lengkap || msg.users.username || 'User';
      row.appendChild(sender);
    }

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble-card' + (msg.deleted_at ? ' deleted' : '');

    if (msg.deleted_at) {
      bubble.textContent = 'Pesan ini telah dihapus';
    } else {
      bubble.textContent = msg.content;
      if (msg.edited_at) {
        const editTag = document.createElement('span');
        editTag.style.fontSize = '10px';
        editTag.style.opacity = '0.7';
        editTag.style.marginLeft = '4px';
        editTag.textContent = '(diedit)';
        bubble.appendChild(editTag);
      }
    }

    const meta = document.createElement('div');
    meta.className = 'chat-bubble-meta';
    
    const timeSpan = document.createElement('span');
    timeSpan.textContent = formatTime(msg.created_at);
    meta.appendChild(timeSpan);

    if (msg.isOwn) {
      const checkIcon = document.createElement('span');
      checkIcon.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
      meta.appendChild(checkIcon);
    }

    row.appendChild(bubble);
    row.appendChild(meta);
    return row;
  }

  async function sendMessage() {
    if (!currentConvId) return;
    const input = document.getElementById('admin-chat-input');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';

    // Optimistic UI Append
    const tempMsg = {
      id: 'temp-' + Date.now(),
      content: content,
      isOwn: true,
      created_at: new Date().toISOString()
    };
    renderMessages([tempMsg], 'append');

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
      loadMessages(currentConvId, lastMsgId, lastMsgCreatedAt);
      loadConversations();
    } catch(err) {
      alert('Error mengirim pesan: ' + err.message);
    }
  }

  async function markRead(convId) {
    try {
      await fetch(`/api/chat/conversations/${convId}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message_id: lastMsgId })
      });
      updateNavBadge();
    } catch(e) {}
  }

  async function loadConversationInfo(convId) {
    const infoPanel = document.getElementById('admin-chat-info');
    if (!infoPanel) return;

    try {
      const res = await fetch(`/api/chat/conversations/${convId}`, { credentials: 'include' });
      if (!res.ok) return;
      const conv = await res.json();

      infoPanel.innerHTML = '';

      const dName = conv.name || (conv.type === 'group' ? 'Grup Percakapan' : 'Pesan Pribadi');

      // Profile Card
      const profileCard = document.createElement('div');
      profileCard.className = 'chat-info-profile-card';

      const avatarLg = document.createElement('div');
      avatarLg.className = 'chat-info-avatar-large';
      avatarLg.textContent = dName.charAt(0).toUpperCase();
      avatarLg.style.background = conv.type === 'group' 
        ? 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' 
        : getChatAvatarGradient(dName);

      const nameH = document.createElement('h4');
      nameH.className = 'chat-info-name';
      nameH.textContent = dName;

      const badge = document.createElement('span');
      badge.className = 'chat-info-badge';
      badge.textContent = conv.type === 'group' ? 'Grup Percakapan' : 'Direct Message';

      profileCard.appendChild(avatarLg);
      profileCard.appendChild(nameH);
      profileCard.appendChild(badge);
      infoPanel.appendChild(profileCard);

      // Section: Participants
      const partSec = document.createElement('div');
      const partTitle = document.createElement('div');
      partTitle.className = 'chat-info-section-title';
      partTitle.textContent = `Anggota Terdaftar (${conv.participants?.length || 0})`;
      partSec.appendChild(partTitle);

      const partList = document.createElement('div');
      partList.className = 'chat-participant-list';

      (conv.participants || []).forEach(p => {
        const row = document.createElement('div');
        row.className = 'chat-participant-row';

        const left = document.createElement('div');
        left.className = 'chat-participant-left';

        const pAvatar = document.createElement('div');
        pAvatar.className = 'chat-participant-avatar';
        const pName = p.user?.nama_lengkap || p.user?.username || 'User';
        pAvatar.textContent = pName.charAt(0).toUpperCase();
        pAvatar.style.background = getChatAvatarGradient(pName);
        pAvatar.style.color = '#FFFFFF';

        const nameBox = document.createElement('div');
        const nameText = document.createElement('div');
        nameText.className = 'chat-participant-name';
        nameText.textContent = pName;

        const roleText = document.createElement('div');
        roleText.className = 'chat-participant-role-tag';
        roleText.textContent = (p.user?.posisi || p.user?.role || '') + (p.role === 'admin' ? ' • Admin' : '');

        nameBox.appendChild(nameText);
        nameBox.appendChild(roleText);
        left.appendChild(pAvatar);
        left.appendChild(nameBox);
        row.appendChild(left);
        partList.appendChild(row);
      });

      partSec.appendChild(partList);
      infoPanel.appendChild(partSec);
    } catch(e) {
      console.error('Error loading conversation info:', e);
    }
  }

  // --- Modal Logic ---
  let dmSearchTimer = null;
  function openDmModal() {
    const modal = document.getElementById('modal-new-dm');
    if (modal) modal.style.display = 'flex';
    const search = document.getElementById('dm-user-search');
    if (search) {
      search.value = '';
      searchUsersForDm('');
      search.focus();
      search.oninput = e => {
        clearTimeout(dmSearchTimer);
        dmSearchTimer = setTimeout(() => searchUsersForDm(e.target.value.trim()), 250);
      };
    }
  }

  function closeDmModal() {
    const modal = document.getElementById('modal-new-dm');
    if (modal) modal.style.display = 'none';
  }

  async function searchUsersForDm(query) {
    const results = document.getElementById('dm-user-results');
    if (!results) return;
    results.innerHTML = '<div style="padding:10px;font-size:12px;color:#64748B;text-align:center;">Mencari rekan kerja...</div>';

    try {
      const res = await fetch(`/api/chat/users?search=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Search failed');
      const users = await res.json();
      results.innerHTML = '';

      if (users.length === 0) {
        results.innerHTML = '<div style="padding:14px;font-size:12.5px;color:#64748B;text-align:center;">User tidak ditemukan atau tidak memiliki hak akses chat.</div>';
        return;
      }

      users.forEach(u => {
        const item = document.createElement('div');
        item.style.padding = '8px 12px';
        item.style.cursor = 'pointer';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '10px';
        item.style.borderRadius = '8px';
        item.style.transition = 'background 0.15s';
        item.onmouseover = () => item.style.backgroundColor = '#EFF6FF';
        item.onmouseout = () => item.style.backgroundColor = 'transparent';

        const uAvatar = document.createElement('div');
        uAvatar.style.width = '32px';
        uAvatar.style.height = '32px';
        uAvatar.style.borderRadius = '8px';
        const uName = u.nama_lengkap || u.username;
        uAvatar.textContent = uName.charAt(0).toUpperCase();
        uAvatar.style.background = getChatAvatarGradient(uName);
        uAvatar.style.color = '#FFFFFF';
        uAvatar.style.display = 'flex';
        uAvatar.style.alignItems = 'center';
        uAvatar.style.justifyContent = 'center';
        uAvatar.style.fontWeight = '700';
        uAvatar.style.fontSize = '12px';

        const info = document.createElement('div');
        info.style.flex = '1';
        info.style.minWidth = '0';

        const name = document.createElement('div');
        name.style.fontSize = '13px';
        name.style.fontWeight = '700';
        name.style.color = '#0F172A';
        name.textContent = uName;

        const role = document.createElement('div');
        role.style.fontSize = '11px';
        role.style.color = '#64748B';
        role.textContent = `${u.posisi || u.role} • @${u.username}`;

        info.appendChild(name);
        info.appendChild(role);

        item.appendChild(uAvatar);
        item.appendChild(info);

        item.onclick = async () => {
          closeDmModal();
          try {
            const createRes = await fetch('/api/chat/conversations/direct', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ target_user_id: u.id })
            });
            if (!createRes.ok) throw new Error('Gagal memulai pesan langsung');
            const data = await createRes.json();
            await loadConversations();
            selectConversation(data.conversation?.id || data.id);
          } catch(err) {
            alert(err.message);
          }
        };

        results.appendChild(item);
      });
    } catch(err) {
      results.innerHTML = '<div style="padding:10px;font-size:12px;color:#EF4444;text-align:center;">Gagal memuat daftar user.</div>';
    }
  }

  let selectedGroupMembers = new Set();
  function openGroupModal() {
    const modal = document.getElementById('modal-new-group');
    if (modal) modal.style.display = 'flex';
    document.getElementById('group-name-input').value = '';
    selectedGroupMembers.clear();
    loadUsersForGroup('');
    document.getElementById('group-member-search').oninput = e => {
      loadUsersForGroup(e.target.value.trim());
    };
  }

  function closeGroupModal() {
    const modal = document.getElementById('modal-new-group');
    if (modal) modal.style.display = 'none';
  }

  async function loadUsersForGroup(query) {
    const results = document.getElementById('group-member-results');
    if (!results) return;
    results.innerHTML = '<div style="padding:10px;font-size:12px;color:#64748B;text-align:center;">Memuat daftar user...</div>';

    try {
      const res = await fetch(`/api/chat/users?search=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (!res.ok) return;
      const users = await res.json();
      results.innerHTML = '';

      users.forEach(u => {
        const item = document.createElement('label');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '10px';
        item.style.padding = '8px 10px';
        item.style.cursor = 'pointer';
        item.style.borderRadius = '8px';
        item.onmouseover = () => item.style.backgroundColor = '#EFF6FF';
        item.onmouseout = () => item.style.backgroundColor = 'transparent';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = u.id;
        checkbox.checked = selectedGroupMembers.has(u.id);
        checkbox.onchange = () => {
          if (checkbox.checked) selectedGroupMembers.add(u.id);
          else selectedGroupMembers.delete(u.id);
        };

        const label = document.createElement('span');
        label.style.fontSize = '13px';
        label.style.fontWeight = '600';
        label.style.color = '#1E293B';
        label.textContent = `${u.nama_lengkap || u.username} (${u.posisi || u.role})`;

        item.appendChild(checkbox);
        item.appendChild(label);
        results.appendChild(item);
      });
    } catch(err) {
      results.innerHTML = '<div style="padding:10px;font-size:12px;color:#EF4444;text-align:center;">Gagal memuat user.</div>';
    }
  }

  async function submitCreateGroup() {
    const nameInput = document.getElementById('group-name-input');
    const name = nameInput.value.trim();
    if (!name) {
      alert('Nama grup wajib diisi');
      return;
    }
    if (selectedGroupMembers.size === 0) {
      alert('Pilih minimal satu anggota untuk grup');
      return;
    }

    try {
      const res = await fetch('/api/chat/conversations/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          member_ids: Array.from(selectedGroupMembers)
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Gagal membuat grup');
      }
      const data = await res.json();
      closeGroupModal();
      await loadConversations();
      selectConversation(data.conversation?.id || data.id);
    } catch(err) {
      alert(err.message);
    }
  }

  // --- Polling & Timers ---
  function startMessagePolling(convId) {
    stopMessagePolling();
    const interval = document.hidden ? 60000 : 3000;
    msgPollingInterval = setInterval(() => {
      if (currentConvId === convId && isPageActive) {
        loadMessages(convId, lastMsgId, lastMsgCreatedAt);
      }
    }, interval);
  }

  function stopMessagePolling() {
    if (msgPollingInterval) clearInterval(msgPollingInterval);
  }

  function startUnreadBadgePolling() {
    if (unreadInterval) clearInterval(unreadInterval);
    updateNavBadge();
    unreadInterval = setInterval(() => {
      if (!document.hidden) updateNavBadge();
    }, 30000);
  }

  async function updateNavBadge() {
    try {
      const res = await fetch('/api/chat/unread-count', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const count = typeof data === 'number' ? data : (data.total_unread || data.count || 0);
      const badge = document.getElementById('nav-chat-badge');
      if (badge) {
        if (count > 0) {
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch(e) {}
  }

  function startPresenceHeartbeat() {
    if (presenceInterval) clearInterval(presenceInterval);
    fetch('/api/chat/presence', { method: 'POST', credentials: 'include' }).catch(()=>{});
    presenceInterval = setInterval(() => {
      if (!document.hidden) {
        fetch('/api/chat/presence', { method: 'POST', credentials: 'include' }).catch(()=>{});
      }
    }, 45000);
  }

  function clearAllIntervals() {
    stopMessagePolling();
    if (unreadInterval) clearInterval(unreadInterval);
    if (presenceInterval) clearInterval(presenceInterval);
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      if (currentConvId) startMessagePolling(currentConvId);
    } else {
      if (currentConvId) {
        loadMessages(currentConvId, lastMsgId, lastMsgCreatedAt);
        startMessagePolling(currentConvId);
      }
      loadConversations();
      updateNavBadge();
    }
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

  function formatDaySeparator(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return 'HARI INI';
      const yesterday = new Date();
      yesterday.setDate(now.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) return 'KEMARIN';
      return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch(e) {
      return '';
    }
  }

  return {
    init,
    destroy,
    openDmModal,
    openGroupModal,
    updateNavBadge
  };
})();

/**
 * ====================================================================
 * SS08 CHAT SETTINGS MODULE
 * Interactive Status Cards • iOS-Style Switches • Dirty-State Sticky Bar
 * ====================================================================
 */
const ChatSettingsModule = (function() {
  let initialSettings = {};
  let currentSettings = {};
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
              <p class="chat-settings-subtitle">Kelola ketersediaan sistem, fungsionalitas pesan, dan hak akses posisi operasional SS08.</p>
            </div>
          </div>
          <div id="settings-status-chip-wrap">
            <span class="chat-status-chip disabled" id="settings-status-chip">● Status: Nonaktif</span>
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
              <p class="chat-status-card-desc">User dan Admin dapat mengirim dan membaca pesan, membuat obrolan, dan mengunggah lampiran.</p>
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
            <p class="chat-section-desc">Aktifkan atau nonaktifkan fitur spesifik perpesanan internal.</p>
          </div>

          <div class="chat-toggle-item">
            <div class="chat-toggle-left">
              <div class="chat-toggle-icon">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
              </div>
              <div>
                <div class="chat-toggle-title">Direct Message (Pesan Pribadi)</div>
                <div class="chat-toggle-desc">Izinkan obrolan langsung 1-on-1 antar karyawan atau admin.</div>
              </div>
            </div>
            <label class="chat-switch">
              <input type="checkbox" id="setting-allow-dm" onchange="ChatSettingsModule.markDirty()" />
              <span class="chat-switch-slider"></span>
            </label>
          </div>

          <div class="chat-toggle-item">
            <div class="chat-toggle-left">
              <div class="chat-toggle-icon">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              </div>
              <div>
                <div class="chat-toggle-title">Grup Percakapan</div>
                <div class="chat-toggle-desc">Izinkan pembuatan grup chat untuk koordinasi tim operasional.</div>
              </div>
            </div>
            <label class="chat-switch">
              <input type="checkbox" id="setting-allow-group" onchange="ChatSettingsModule.markDirty()" />
              <span class="chat-switch-slider"></span>
            </label>
          </div>

          <div class="chat-toggle-item">
            <div class="chat-toggle-left">
              <div class="chat-toggle-icon">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
              </div>
              <div>
                <div class="chat-toggle-title">Lampiran File & Gambar</div>
                <div class="chat-toggle-desc">Izinkan pengunggahan gambar atau dokumen dalam chat.</div>
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
                <div class="chat-toggle-title">Tanda Baca (Read Receipt)</div>
                <div class="chat-toggle-desc">Tampilkan tanda centang ganda saat pesan telah dibaca penerima.</div>
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
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z"/></svg>
              </div>
              <div>
                <div class="chat-toggle-title">Status Online (Kehadiran)</div>
                <div class="chat-toggle-desc">Tampilkan indikator titik hijau saat rekan kerja sedang aktif.</div>
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
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </div>
              <div>
                <div class="chat-toggle-title">Indikator Mengetik (Typing)</div>
                <div class="chat-toggle-desc">Tampilkan status saat lawan bicara sedang mengetik balasan.</div>
              </div>
            </div>
            <label class="chat-switch">
              <input type="checkbox" id="setting-show-typing" onchange="ChatSettingsModule.markDirty()" />
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
                <div class="chat-toggle-desc">Minta izin browser untuk memunculkan notifikasi pop-up saat pesan masuk.</div>
              </div>
            </div>
            <label class="chat-switch">
              <input type="checkbox" id="setting-allow-browser-notification" onchange="ChatSettingsModule.markDirty()" />
              <span class="chat-switch-slider"></span>
            </label>
          </div>

          <!-- Attachment Size Limit -->
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
            <div>
              <div style="font-size:13.5px;font-weight:700;color:var(--chat-text);">Batas Ukuran Lampiran</div>
              <div style="font-size:12px;color:var(--chat-text-muted);margin-top:2px;">Ukuran berkas maksimal yang diperbolehkan diunggah (1 - 50 MB).</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="number" id="setting-max-attachment-size" min="1" max="50" style="width:80px;height:38px;padding:0 10px;border-radius:10px;border:1px solid #CBD5E1;font-weight:700;font-size:14px;color:#0F172A;text-align:center;" onchange="ChatSettingsModule.markDirty()" />
              <span style="font-size:13px;font-weight:700;color:#64748B;">MB</span>
            </div>
          </div>
        </div>

        <!-- 4. Role Access Section -->
        <div class="chat-section-card">
          <div class="chat-section-header">
            <h3 class="chat-section-title">Akses Posisi & Role Karyawan</h3>
            <p class="chat-section-desc">Pilih posisi operasional yang diizinkan untuk melihat dan menggunakan Live Chat.</p>
          </div>

          <div class="chat-role-grid">
            <!-- Administrator (Locked) -->
            <div class="chat-role-card locked">
              <div>
                <div style="font-size:13.5px;font-weight:800;color:#1E293B;">Administrator</div>
                <div style="font-size:12px;color:#64748B;">Akses penuh & wajib aktif</div>
              </div>
              <span class="chat-locked-pill">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                <span>TERKUNCI</span>
              </span>
            </div>

            <!-- Picker -->
            <div class="chat-role-card">
              <div>
                <div style="font-size:13.5px;font-weight:700;color:#1E293B;">Picker</div>
                <div style="font-size:12px;color:#64748B;">Karyawan pengambilan barang</div>
              </div>
              <label class="chat-switch">
                <input type="checkbox" id="role-picker" onchange="ChatSettingsModule.markDirty()" />
                <span class="chat-switch-slider"></span>
              </label>
            </div>

            <!-- Sorter -->
            <div class="chat-role-card">
              <div>
                <div style="font-size:13.5px;font-weight:700;color:#1E293B;">Sorter</div>
                <div style="font-size:12px;color:#64748B;">Karyawan sortir barang</div>
              </div>
              <label class="chat-switch">
                <input type="checkbox" id="role-sorter" onchange="ChatSettingsModule.markDirty()" />
                <span class="chat-switch-slider"></span>
              </label>
            </div>

            <!-- Loader -->
            <div class="chat-role-card">
              <div>
                <div style="font-size:13.5px;font-weight:700;color:#1E293B;">Loader</div>
                <div style="font-size:12px;color:#64748B;">Karyawan muat barang / logistik</div>
              </div>
              <label class="chat-switch">
                <input type="checkbox" id="role-loader" onchange="ChatSettingsModule.markDirty()" />
                <span class="chat-switch-slider"></span>
              </label>
            </div>

            <!-- Return -->
            <div class="chat-role-card">
              <div>
                <div style="font-size:13.5px;font-weight:700;color:#1E293B;">Return</div>
                <div style="font-size:12px;color:#64748B;">Karyawan pengembalian kontainer</div>
              </div>
              <label class="chat-switch">
                <input type="checkbox" id="role-return" onchange="ChatSettingsModule.markDirty()" />
                <span class="chat-switch-slider"></span>
              </label>
            </div>

            <!-- QC Outbound -->
            <div class="chat-role-card">
              <div>
                <div style="font-size:13.5px;font-weight:700;color:#1E293B;">QC Outbound</div>
                <div style="font-size:12px;color:#64748B;">Pemeriksaan kualitas keluar</div>
              </div>
              <label class="chat-switch">
                <input type="checkbox" id="role-qc-outbound" onchange="ChatSettingsModule.markDirty()" />
                <span class="chat-switch-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- 5. Sticky Floating Save Bar -->
        <div id="chat-sticky-save-bar" class="chat-sticky-save-bar" style="display:none;">
          <div class="chat-sticky-save-info">
            <span class="chat-dirty-dot"></span>
            <span>Perubahan belum disimpan</span>
          </div>
          <div class="chat-sticky-save-actions">
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
    document.querySelectorAll('.chat-status-card').forEach(card => {
      if (card.dataset.status === status) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    });

    const chip = document.getElementById('settings-status-chip');
    if (chip) {
      chip.className = `chat-status-chip ${status.toLowerCase().replace('_', '')}`;
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
      currentSettings = s;
      populateForm(s);
      hideDirtyBar();
    } catch(err) {
      showToast('Gagal memuat pengaturan: ' + err.message, 'error');
    }
  }

  function populateForm(s) {
    selectedStatus = s.status || 'DISABLED';
    selectStatus(selectedStatus);

    document.getElementById('setting-allow-dm').checked = s.allow_direct_message !== false;
    document.getElementById('setting-allow-group').checked = s.allow_group_chat !== false;
    document.getElementById('setting-allow-attachment').checked = s.allow_attachment !== false;
    document.getElementById('setting-show-read-receipt').checked = s.show_read_receipt !== false;
    document.getElementById('setting-show-online').checked = s.show_online_status !== false;
    document.getElementById('setting-show-typing').checked = !!s.show_typing_indicator;
    document.getElementById('setting-allow-browser-notification').checked = !!s.allow_browser_notification;
    document.getElementById('setting-max-attachment-size').value = s.max_attachment_size_mb || 10;

    const roles = s.role_access || {};
    document.getElementById('role-picker').checked = roles.Picker !== false;
    document.getElementById('role-sorter').checked = roles.Sorter !== false;
    document.getElementById('role-loader').checked = roles.Loader !== false;
    document.getElementById('role-return').checked = roles.Return !== false;
    document.getElementById('role-qc-outbound').checked = roles['QC Outbound'] !== false;

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
      allow_direct_message: document.getElementById('setting-allow-dm').checked,
      allow_group_chat: document.getElementById('setting-allow-group').checked,
      allow_attachment: document.getElementById('setting-allow-attachment').checked,
      show_read_receipt: document.getElementById('setting-show-read-receipt').checked,
      show_online_status: document.getElementById('setting-show-online').checked,
      show_typing_indicator: document.getElementById('setting-show-typing').checked,
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

// Expose globally to Admin shell
window.ChatAdminModule = ChatAdminModule;
window.ChatSettingsModule = ChatSettingsModule;
