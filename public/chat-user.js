'use strict';

/**
 * ====================================================================
 * SS08 USER FLOATING CHAT MODULE
 * Non-intrusive bottom-right floating chat for operational users
 * Adaptive polling, offline graceful handling, full XSS protection
 * ====================================================================
 */

// Version constant — bump this whenever chat-user.js changes so DevTools
// Console confirms the browser is executing the correct version.
const CHAT_UI_VERSION = '2757c8f-status-sync-v2';
console.info('[Chat] version:', CHAT_UI_VERSION);

const USER_AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
  'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
  'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)',
  'linear-gradient(135deg, #10B981 0%, #047857 100%)',
  'linear-gradient(135deg, #F59E0B 0%, #B45309 100%)',
  'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)',
  'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)'
];

function getUserAvatarGradient(str) {
  if (!str) return USER_AVATAR_GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return USER_AVATAR_GRADIENTS[Math.abs(hash) % USER_AVATAR_GRADIENTS.length];
}

const FloatingChat = (function() {
  let isOpen = false;
  let chatStatus = 'ACTIVE';
  let chatSettings = null;
  let currentConvId = null;
  let conversations = [];
  let currentMessages = [];
  let messagePollingInterval = null;
  let convPollingInterval = null;
  let unreadPollingInterval = null;
  let presenceInterval = null;
  let lastMsgId = null;
  let lastMsgCreatedAt = null;
  let isHiddenTab = false;
  let isSearchMode = false;

  async function init() {
    try {
      const statusData = await loadStatus();
      console.info('[Chat] init: status from server =', statusData ? statusData.status : 'null/undefined');
      if (!statusData || statusData.status === 'DISABLED') {
        // Chat disabled completely - not mounting UI
        console.info('[Chat] init: chat DISABLED — not mounting UI');
        return;
      }
      chatStatus = statusData.status || 'ACTIVE';
      chatSettings = statusData;

      injectHTML();

      // Apply initial status UI (e.g. if loaded while READ_ONLY)
      applyStatusUI(chatStatus);

      startUnreadPolling();
      startPresenceHeartbeat();
      startStatusPolling(); // Refresh status every 25s in background

      document.addEventListener('visibilitychange', handleVisibilityChange);
      // Also refresh on window focus (tab switch back, impersonation context switch, etc.)
      window.addEventListener('focus', () => { refreshChatStatus(); });
    } catch(err) {
      // If unauthorized or endpoint unavailable, fail silently
      console.warn('[Chat] init failed:', err.message);
    }
  }

  function injectHTML() {
    // Floating circular button with SS08 Royal Blue gradient
    const btn = document.createElement('button');
    btn.id = 'chat-float-btn';
    btn.setAttribute('aria-label', 'Buka Live Chat');
    btn.title = 'Live Chat SS08';
    btn.innerHTML = `<svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`;

    const badge = document.createElement('span');
    badge.className = 'chat-unread-badge';
    badge.id = 'chat-btn-badge';
    badge.style.display = 'none';
    btn.appendChild(badge);
    btn.onclick = togglePanel;
    document.body.appendChild(btn);

    // Sliding chat panel drawer
    const panel = document.createElement('div');
    panel.id = 'chat-float-panel';
    panel.className = 'chat-float-panel hidden';
    panel.innerHTML = `
      <div style="padding:14px 18px;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);color:#fff;display:flex;align-items:center;justify-content:space-between;border-top-left-radius:20px;border-top-right-radius:20px;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <button id="chat-back-btn" class="hidden" style="background:rgba(255,255,255,0.15);border:none;color:#fff;cursor:pointer;padding:4px 6px;border-radius:6px;display:flex;align-items:center;" title="Kembali">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div>
            <div id="chat-header-title" style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;">Live Chat SS08</div>
            <div id="chat-header-status" style="font-size:11px;opacity:0.85;margin-top:1px;">Komunikasi Operasional</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button id="chat-new-dm-btn" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:99px;padding:4px 10px;font-size:11.5px;font-weight:700;cursor:pointer;transition:background 0.15s;" title="Mulai Obrolan Baru">+ Chat</button>
          <button id="chat-close-btn" style="background:transparent;border:none;color:#fff;cursor:pointer;padding:4px;display:flex;opacity:0.85;" title="Tutup">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div id="chat-readonly-banner" class="chat-readonly-banner hidden" style="display:none;padding:6px 12px;font-size:11px;background:#FEF3C7;color:#92400E;text-align:center;font-weight:600;">
        Mode Baca Saja — Pengiriman pesan baru dinonaktifkan.
      </div>
      <div id="chat-panel-body" style="flex:1;display:flex;flex-direction:column;overflow:hidden;background:#FAFBFD;">
        <!-- View 1: Conversation List -->
        <div id="chat-conv-view" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
          <div id="chat-search-bar" style="display:none;padding:8px 12px;border-bottom:1px solid #E2E8F0;background:#fff;">
            <input type="text" id="chat-user-search-input" class="chat-search-input" placeholder="Cari rekan kerja..." style="height:36px;font-size:12px;padding:0 12px;" />
          </div>
          <div id="chat-conv-list" style="flex:1;overflow-y:auto;padding:8px;"></div>
        </div>

        <!-- View 2: Message Thread -->
        <div id="chat-msg-view" class="hidden" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
          <div id="chat-messages" style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;"></div>
          <div id="chat-input-area" class="chat-composer-wrap" style="padding:10px 14px;border-top:1px solid #E2E8F0;background:#fff;">
            <div class="chat-composer-inner" style="padding:3px 4px 3px 12px;">
              <input type="text" id="chat-input" class="chat-composer-input" placeholder="Tulis pesan..." maxlength="4000" autocomplete="off" style="font-size:13px;" />
              <button id="chat-send-btn" class="chat-send-icon-btn" style="width:32px;height:32px;" title="Kirim">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // Event handlers
    document.getElementById('chat-close-btn').onclick = closePanel;
    document.getElementById('chat-back-btn').onclick = backToList;
    document.getElementById('chat-send-btn').onclick = sendMessage;
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    document.getElementById('chat-new-dm-btn').onclick = toggleUserSearch;
    document.getElementById('chat-user-search-input').addEventListener('input', (e) => {
      debounceSearch(e.target.value.trim());
    });
  }

  async function loadStatus() {
    const res = await fetch('/api/chat/status', {
      credentials: 'include',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    if (!res.ok) throw new Error('Failed to load status');
    return res.json();
  }

  /**
   * Refresh chat status from server and apply UI state immediately.
   * Called on openPanel(), tab focus/visibility, and periodic interval.
   * Fixes stale chatStatus variable that caused READ_ONLY banner to persist
   * even after admin changed status to ACTIVE.
   */
  async function refreshChatStatus() {
    try {
      const data = await loadStatus();
      const prevStatus = chatStatus;
      const newStatus = data.status || 'ACTIVE';
      chatStatus = newStatus;
      chatSettings = data;

      // Diagnostic: visible in DevTools Console
      console.info('[Chat] refresh status response:', { status: data.status });
      console.info('[Chat] previous status:', prevStatus, '→ new status:', newStatus);

      if (newStatus === 'DISABLED') {
        // Chat got disabled – hide launcher and close panel
        const floatBtn = document.getElementById('chat-float-btn');
        if (floatBtn) floatBtn.style.display = 'none';
        closePanel();
        return;
      }

      // Ensure launcher is visible (may have been hidden before)
      const floatBtn = document.getElementById('chat-float-btn');
      if (floatBtn) floatBtn.style.display = '';

      applyStatusUI(newStatus);
    } catch (e) {
      // Network failure – leave current UI state unchanged
      console.warn('[Chat] refreshChatStatus failed:', e.message);
    }
  }

  /**
   * Apply READ_ONLY / ACTIVE visual state to the panel.
   * Uses style.display as primary mechanism (more specific than className)
   * because the banner element has inline display:none by default.
   * Safe to call even when panel is closed.
   */
  function applyStatusUI(status) {
    console.info('[Chat] applyStatusUI:', status);
    const banner    = document.getElementById('chat-readonly-banner');
    const inputArea = document.getElementById('chat-input-area');
    const chatInput = document.getElementById('chat-input');
    const sendBtn   = document.getElementById('chat-send-btn');

    if (status === 'READ_ONLY') {
      // Show banner, hide composer
      if (banner)    { banner.style.display = 'block'; banner.classList.remove('hidden'); }
      if (inputArea) { inputArea.style.display = 'none'; inputArea.classList.add('hidden'); }
      if (chatInput) { chatInput.disabled = true; chatInput.setAttribute('readonly', 'readonly'); }
      if (sendBtn)   { sendBtn.disabled = true; }
    } else {
      // ACTIVE — hide banner, show composer, clear ALL blocking states
      if (banner)    { banner.style.display = 'none'; banner.classList.add('hidden'); }
      if (inputArea) { inputArea.style.display = ''; inputArea.classList.remove('hidden'); }
      if (chatInput) { chatInput.disabled = false; chatInput.removeAttribute('readonly'); chatInput.style.pointerEvents = ''; }
      if (sendBtn)   { sendBtn.disabled = false; sendBtn.style.pointerEvents = ''; }
    }
  }

  let statusPollingInterval = null;

  function startStatusPolling() {
    if (statusPollingInterval) clearInterval(statusPollingInterval);
    // Lightweight background sync every 25 seconds
    statusPollingInterval = setInterval(() => {
      refreshChatStatus();
    }, 25000);
  }

  function togglePanel() {
    if (isOpen) closePanel();
    else openPanel();
  }

  function openPanel() {
    isOpen = true;
    const panel = document.getElementById('chat-float-panel');
    if (panel) panel.classList.remove('hidden');

    console.info('[Chat] openPanel: current chatStatus =', chatStatus, '— refreshing from server...');
    // Always refresh status from server when opening – fixes stale chatStatus bug
    refreshChatStatus();

    loadConversations();
    startConvPolling();
    stopUnreadPolling();
  }

  function closePanel() {
    isOpen = false;
    const panel = document.getElementById('chat-float-panel');
    if (panel) panel.classList.add('hidden');

    stopConvPolling();
    stopMessagePolling();
    startUnreadPolling();
  }

  async function loadConversations() {
    try {
      const res = await fetch('/api/chat/conversations', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      conversations = await res.json();
      if (!isSearchMode) {
        renderConversations(conversations);
      }
    } catch(err) {
      console.error('Failed to load conversations', err);
    }
  }

  function renderConversations(convs) {
    const list = document.getElementById('chat-conv-list');
    if (!list) return;
    list.innerHTML = '';

    if (convs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty-state-wrap';
      empty.style.padding = '30px 10px';
      empty.innerHTML = `
        <div class="chat-empty-illustration" style="width:56px;height:56px;margin-bottom:10px;">
          <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
        </div>
        <div style="font-size:13px;font-weight:700;color:var(--chat-text);">Belum Ada Percakapan</div>
        <div style="font-size:11.5px;color:var(--chat-text-muted);margin-top:4px;">Klik tombol "+ Chat" untuk mencari rekan kerja.</div>
      `;
      list.appendChild(empty);
      return;
    }

    convs.forEach(c => {
      const el = document.createElement('div');
      el.className = 'chat-conv-item';
      el.onclick = () => openConversation(c.id, c.display_name || c.name);

      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'chat-avatar-wrap';

      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      avatar.style.width = '38px';
      avatar.style.height = '38px';
      avatar.style.borderRadius = '12px';
      avatar.style.fontSize = '14px';
      const dName = c.display_name || c.name || 'Percakapan';
      avatar.textContent = dName.charAt(0).toUpperCase();
      avatar.style.background = c.is_group 
        ? 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' 
        : getUserAvatarGradient(dName);

      avatarWrap.appendChild(avatar);

      if (!c.is_group && c.other_user_online) {
        const dot = document.createElement('span');
        dot.className = 'chat-online-dot';
        dot.style.width = '10px';
        dot.style.height = '10px';
        avatarWrap.appendChild(dot);
      }

      const body = document.createElement('div');
      body.className = 'chat-conv-content';

      const row = document.createElement('div');
      row.className = 'chat-conv-row-top';

      const title = document.createElement('span');
      title.className = 'chat-conv-title';
      title.textContent = dName;

      const time = document.createElement('span');
      time.className = 'chat-conv-time';
      if (c.updated_at) time.textContent = formatTime(c.updated_at);

      row.appendChild(title);
      row.appendChild(time);

      const rowBtm = document.createElement('div');
      rowBtm.className = 'chat-conv-row-bottom';

      const preview = document.createElement('span');
      preview.className = 'chat-conv-preview';
      preview.textContent = c.last_message?.content || (c.is_former_member ? '(Keluar dari grup)' : 'Mulai percakapan');

      rowBtm.appendChild(preview);

      if ((c.unread_count || 0) > 0) {
        const unread = document.createElement('span');
        unread.className = 'chat-unread-badge';
        unread.textContent = c.unread_count > 99 ? '99+' : String(c.unread_count);
        rowBtm.appendChild(unread);
      }

      body.appendChild(row);
      body.appendChild(rowBtm);

      el.appendChild(avatarWrap);
      el.appendChild(body);
      list.appendChild(el);
    });
  }

  async function openConversation(convId, convName) {
    currentConvId = convId;
    isSearchMode = false;
    document.getElementById('chat-search-bar').style.display = 'none';
    document.getElementById('chat-conv-view').classList.add('hidden');
    document.getElementById('chat-msg-view').classList.remove('hidden');
    document.getElementById('chat-back-btn').classList.remove('hidden');
    document.getElementById('chat-header-title').textContent = convName || 'Percakapan';

    stopConvPolling();
    await loadMessages(convId);
    startMessagePolling(convId);
    markRead(convId, lastMsgId);
  }

  function backToList() {
    currentConvId = null;
    document.getElementById('chat-conv-view').classList.remove('hidden');
    document.getElementById('chat-msg-view').classList.add('hidden');
    document.getElementById('chat-back-btn').classList.add('hidden');
    document.getElementById('chat-header-title').textContent = 'Live Chat SS08';

    stopMessagePolling();
    loadConversations();
    startConvPolling();
  }

  async function loadMessages(convId, afterId, afterCreatedAt) {
    try {
      let url = `/api/chat/conversations/${convId}/messages?limit=30`;
      if (afterId && afterCreatedAt) {
        url += `&after_id=${encodeURIComponent(afterId)}&after_created_at=${encodeURIComponent(afterCreatedAt)}`;
      }
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const msgs = await res.json();
      const msgArray = Array.isArray(msgs) ? msgs : (msgs.messages || []);

      if (afterId) {
        if (msgArray.length > 0) {
          currentMessages = currentMessages.concat(msgArray);
          renderMessages(msgArray, true);
        }
      } else {
        currentMessages = msgArray;
        renderMessages(msgArray, false);
      }

      if (currentMessages.length > 0) {
        const last = currentMessages[currentMessages.length - 1];
        lastMsgId = last.id;
        lastMsgCreatedAt = last.created_at;
      }
    } catch (err) {
      console.error('Failed to load messages', err);
    }
  }

  function renderMessages(messages, appendOnly) {
    const container = document.getElementById('chat-messages');
    if (!appendOnly) container.innerHTML = '';

    messages.forEach(msg => {
      const el = createMsgElement(msg);
      container.appendChild(el);
    });

    container.scrollTop = container.scrollHeight;
  }

  function createMsgElement(msg) {
    const row = document.createElement('div');
    row.className = 'chat-message-row ' + (msg.isOwn ? 'sent' : 'recv');
    row.style.maxWidth = '82%';

    if (!msg.isOwn && msg.users) {
      const sender = document.createElement('span');
      sender.className = 'chat-sender-name';
      sender.textContent = msg.users.nama_lengkap || msg.users.username || 'User';
      row.appendChild(sender);
    }

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble-card' + (msg.deleted_at ? ' deleted' : '');
    bubble.style.padding = '8px 12px';
    bubble.style.fontSize = '13px';
    bubble.textContent = msg.deleted_at ? 'Pesan ini telah dihapus' : msg.content;

    const meta = document.createElement('div');
    meta.className = 'chat-bubble-meta';
    meta.textContent = formatTime(msg.created_at);

    row.appendChild(bubble);
    row.appendChild(meta);
    return row;
  }

  async function sendMessage() {
    if (!currentConvId) return;
    // Do NOT block on stale chatStatus here – server's requireChatWriteAllowed
    // is the authoritative gate (returns 403 when not ACTIVE).
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';

    // Optimistic UI update
    const tempMsg = {
      content,
      isOwn: true,
      created_at: new Date().toISOString()
    };
    renderMessages([tempMsg], true);

    try {
      const res = await fetch(`/api/chat/conversations/${currentConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content, message_type: 'text' })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Gagal mengirim');
      }
      loadMessages(currentConvId, lastMsgId, lastMsgCreatedAt);
    } catch(err) {
      console.error('Send error:', err);
    }
  }

  async function markRead(convId, msgId) {
    if (!msgId) return;
    try {
      await fetch(`/api/chat/conversations/${convId}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message_id: msgId })
      });
      updateUnreadBadge();
    } catch (e) {}
  }

  async function updateUnreadBadge() {
    try {
      const res = await fetch('/api/chat/unread-count', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const count = typeof data === 'number' ? data : (data.total_unread || data.unread_count || data.count || 0);
      const badge = document.getElementById('chat-btn-badge');
      if (badge) {
        if (count > 0) {
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch(e) {}
  }

  // --- Search Users for New DM ---
  let searchTimer = null;
  function debounceSearch(q) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => executeSearchUsers(q), 300);
  }

  function toggleUserSearch() {
    isSearchMode = !isSearchMode;
    const searchBar = document.getElementById('chat-search-bar');
    const searchBtn = document.getElementById('chat-new-dm-btn');
    if (isSearchMode) {
      searchBar.style.display = 'block';
      searchBtn.textContent = '✕ Batal';
      const input = document.getElementById('chat-user-search-input');
      input.value = '';
      input.focus();
      executeSearchUsers('');
    } else {
      searchBar.style.display = 'none';
      searchBtn.textContent = '+ Chat';
      renderConversations(conversations);
    }
  }

  async function executeSearchUsers(query) {
    const list = document.getElementById('chat-conv-list');
    list.innerHTML = '<div style="padding:16px;text-align:center;color:#94A3B8;font-size:12px;">Mencari rekan kerja...</div>';

    try {
      const res = await fetch(`/api/chat/users?search=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Search failed');
      const users = await res.json();
      list.innerHTML = '';

      if (users.length === 0) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#94A3B8;font-size:12px;">User tidak ditemukan.</div>';
        return;
      }

      users.forEach(u => {
        const el = document.createElement('div');
        el.className = 'chat-conv-item';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.gap = '10px';
        el.style.padding = '10px 12px';
        el.style.cursor = 'pointer';
        el.onclick = () => startDirectMessage(u.id);

        const avatar = document.createElement('div');
        avatar.className = 'chat-avatar';
        avatar.style.width = '34px';
        avatar.style.height = '34px';
        avatar.style.borderRadius = '10px';
        avatar.style.fontSize = '13px';
        const name = u.nama_lengkap || u.username;
        avatar.textContent = name.charAt(0).toUpperCase();
        avatar.style.background = getUserAvatarGradient(name);

        const info = document.createElement('div');
        info.style.flex = '1';
        info.style.minWidth = '0';

        const nameEl = document.createElement('div');
        nameEl.style.fontSize = '13px';
        nameEl.style.fontWeight = '700';
        nameEl.style.color = '#0F172A';
        nameEl.textContent = name;

        const roleEl = document.createElement('div');
        roleEl.style.fontSize = '11px';
        roleEl.style.color = '#64748B';
        roleEl.textContent = `${u.posisi || u.role} • @${u.username}`;

        info.appendChild(nameEl);
        info.appendChild(roleEl);

        el.appendChild(avatar);
        el.appendChild(info);
        list.appendChild(el);
      });
    } catch(err) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:#EF4444;font-size:12px;">Gagal mencari user.</div>';
    }
  }

  async function startDirectMessage(targetUserId) {
    try {
      const res = await fetch('/api/chat/conversations/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ target_user_id: targetUserId })
      });
      if (!res.ok) throw new Error('Gagal memulai chat');
      const data = await res.json();
      toggleUserSearch(); // Close search mode
      await loadConversations();
      openConversation(data.conversation?.id || data.id, data.conversation?.name);
    } catch(err) {
      alert(err.message);
    }
  }

  // --- Background Polling ---
  function startConvPolling() {
    stopConvPolling();
    const interval = isHiddenTab ? 60000 : 8000;
    convPollingInterval = setInterval(() => {
      if (!isSearchMode) loadConversations();
    }, interval);
  }

  function stopConvPolling() {
    if (convPollingInterval) clearInterval(convPollingInterval);
  }

  function startMessagePolling(convId) {
    stopMessagePolling();
    const interval = isHiddenTab ? 30000 : 3000;
    messagePollingInterval = setInterval(() => {
      if (currentConvId === convId) {
        loadMessages(convId, lastMsgId, lastMsgCreatedAt);
      }
    }, interval);
  }

  function stopMessagePolling() {
    if (messagePollingInterval) clearInterval(messagePollingInterval);
  }

  function startUnreadPolling() {
    if (unreadPollingInterval) clearInterval(unreadPollingInterval);
    updateUnreadBadge();
    unreadPollingInterval = setInterval(() => {
      if (!isHiddenTab) updateUnreadBadge();
    }, 30000);
  }

  function stopUnreadPolling() {
    if (unreadPollingInterval) clearInterval(unreadPollingInterval);
  }

  function startPresenceHeartbeat() {
    if (presenceInterval) clearInterval(presenceInterval);
    fetch('/api/chat/presence', { method: 'POST', credentials: 'include' }).catch(()=>{});
    presenceInterval = setInterval(() => {
      if (!isHiddenTab) {
        fetch('/api/chat/presence', { method: 'POST', credentials: 'include' }).catch(()=>{});
      }
    }, 45000);
  }

  function handleVisibilityChange() {
    isHiddenTab = document.hidden;
    if (isHiddenTab) {
      if (currentConvId) startMessagePolling(currentConvId);
      if (isOpen && !currentConvId) startConvPolling();
    } else {
      // Tab became visible – always re-sync status from server
      refreshChatStatus();

      if (currentConvId) {
        loadMessages(currentConvId, lastMsgId, lastMsgCreatedAt);
        startMessagePolling(currentConvId);
      }
      if (isOpen) {
        loadConversations();
        startConvPolling();
      }
      updateUnreadBadge();
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

  return { init };
})();

// Auto-initialize if running on operational frontend
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => FloatingChat.init());
  } else {
    FloatingChat.init();
  }
}
