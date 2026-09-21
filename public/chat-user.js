'use strict';

/**
 * SS08 User Floating Chat Module
 * Non-intrusive bottom-right floating chat for operational users
 * Adaptive polling, offline graceful handling, full XSS protection
 */
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
      if (!statusData || statusData.status === 'DISABLED') {
        // Chat disabled completely - don't show UI
        return;
      }
      chatStatus = statusData.status || 'ACTIVE';
      chatSettings = statusData;

      injectHTML();
      startUnreadPolling();
      startPresenceHeartbeat();

      document.addEventListener('visibilitychange', handleVisibilityChange);
    } catch(err) {
      // If unauthorized or endpoint unavailable, fail silently
      console.log('[LiveChat] Chat not available or user not logged in');
    }
  }

  function injectHTML() {
    // Floating circular button
    const btn = document.createElement('button');
    btn.id = 'chat-float-btn';
    btn.setAttribute('aria-label', 'Buka Live Chat');
    btn.innerHTML = `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`;

    const badge = document.createElement('span');
    badge.className = 'chat-unread-badge';
    badge.id = 'chat-btn-badge';
    badge.style.display = 'none';
    btn.appendChild(badge);
    btn.onclick = togglePanel;
    document.body.appendChild(btn);

    // Sliding chat panel
    const panel = document.createElement('div');
    panel.id = 'chat-float-panel';
    panel.className = 'chat-float-panel hidden';
    panel.innerHTML = `
      <div class="chat-panel-header" style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <button id="chat-back-btn" class="hidden" style="background:transparent;border:none;color:#fff;cursor:pointer;padding:4px;display:flex;" title="Kembali">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <span id="chat-header-title" style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Pesan</span>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <button id="chat-new-dm-btn" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;" title="Mulai Obrolan Baru">+ Chat</button>
          <button id="chat-close-btn" style="background:transparent;border:none;color:#fff;cursor:pointer;padding:4px;display:flex;" title="Tutup">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div id="chat-readonly-banner" class="chat-readonly-banner hidden" style="padding:6px 12px;font-size:11px;background:#FEF3C7;color:#92400E;text-align:center;font-weight:600;">
        Mode Baca Saja — Pengiriman pesan baru dinonaktifkan.
      </div>
      <div id="chat-panel-body" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        <!-- View 1: Conversation List -->
        <div id="chat-conv-view" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
          <div id="chat-search-bar" style="display:none;padding:8px 10px;border-bottom:1px solid #E2E8F0;">
            <input type="text" id="chat-user-search-input" class="chat-input" placeholder="Cari rekan kerja..." style="width:100%;box-sizing:border-box;font-size:12px;padding:6px 10px;" />
          </div>
          <div id="chat-conv-list" style="flex:1;overflow-y:auto;padding:6px;"></div>
        </div>

        <!-- View 2: Message Thread -->
        <div id="chat-msg-view" class="hidden" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
          <div id="chat-messages" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;"></div>
          <div id="chat-input-area" class="chat-input-area" style="padding:8px 10px;display:flex;gap:6px;border-top:1px solid #E2E8F0;">
            <input type="text" id="chat-input" class="chat-input" placeholder="Ketik pesan..." maxlength="4000" autocomplete="off" style="flex:1;" />
            <button id="chat-send-btn" class="chat-send-btn" title="Kirim">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
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
    const res = await fetch('/api/chat/status', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load status');
    return res.json();
  }

  function togglePanel() {
    if (isOpen) closePanel();
    else openPanel();
  }

  function openPanel() {
    isOpen = true;
    const panel = document.getElementById('chat-float-panel');
    if (panel) panel.classList.remove('hidden');

    loadConversations();
    startConvPolling();
    stopUnreadPolling();

    if (chatStatus === 'READ_ONLY') {
      const banner = document.getElementById('chat-readonly-banner');
      if (banner) banner.classList.remove('hidden');
      const inputArea = document.getElementById('chat-input-area');
      if (inputArea) inputArea.classList.add('hidden');
    }
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
      empty.className = 'chat-empty-state';
      empty.style.padding = '24px 12px';
      empty.style.textAlign = 'center';
      const text = document.createElement('div');
      text.className = 'chat-empty-text';
      text.style.fontSize = '12px';
      text.style.color = '#94A3B8';
      text.textContent = 'Belum ada percakapan. Klik "+ Chat" untuk memulai obrolan!';
      empty.appendChild(text);
      list.appendChild(empty);
      return;
    }

    convs.forEach(c => {
      const el = document.createElement('div');
      el.className = 'chat-conv-item';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.padding = '8px 10px';
      el.style.cursor = 'pointer';
      el.style.borderRadius = '8px';
      el.style.transition = 'background 0.15s';
      el.onmouseover = () => el.style.backgroundColor = '#F8FAFC';
      el.onmouseout = () => el.style.backgroundColor = 'transparent';
      el.onclick = () => openConversation(c.id, c.display_name || c.name);

      const avatar = document.createElement('div');
      avatar.style.width = '32px';
      avatar.style.height = '32px';
      avatar.style.borderRadius = '50%';
      avatar.style.backgroundColor = c.is_group ? '#7C3AED' : '#4F46E5';
      avatar.style.color = '#fff';
      avatar.style.display = 'flex';
      avatar.style.alignItems = 'center';
      avatar.style.justifyContent = 'center';
      avatar.style.fontWeight = '700';
      avatar.style.fontSize = '13px';
      avatar.style.flexShrink = '0';
      avatar.textContent = (c.display_name || c.name || '?').charAt(0).toUpperCase();

      const body = document.createElement('div');
      body.style.flex = '1';
      body.style.minWidth = '0';
      body.style.marginLeft = '8px';

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';

      const title = document.createElement('div');
      title.className = 'chat-conv-title';
      title.style.fontWeight = '600';
      title.style.fontSize = '13px';
      title.style.whiteSpace = 'nowrap';
      title.style.overflow = 'hidden';
      title.style.textOverflow = 'ellipsis';
      title.textContent = c.display_name || c.name || 'Percakapan';

      const time = document.createElement('span');
      time.style.fontSize = '10px';
      time.style.color = '#94A3B8';
      if (c.updated_at) time.textContent = formatTime(c.updated_at);

      row.appendChild(title);
      row.appendChild(time);

      const preview = document.createElement('div');
      preview.style.fontSize = '11px';
      preview.style.color = '#64748B';
      preview.style.whiteSpace = 'nowrap';
      preview.style.overflow = 'hidden';
      preview.style.textOverflow = 'ellipsis';
      preview.style.marginTop = '2px';
      preview.textContent = c.last_message?.content || (c.is_former_member ? '(Keluar dari grup)' : 'Mulai percakapan');

      body.appendChild(row);
      body.appendChild(preview);

      el.appendChild(avatar);
      el.appendChild(body);

      if ((c.unread_count || 0) > 0) {
        const unread = document.createElement('span');
        unread.className = 'chat-unread-badge';
        unread.style.marginLeft = '6px';
        unread.textContent = c.unread_count > 99 ? '99+' : c.unread_count;
        el.appendChild(unread);
      }

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
    document.getElementById('chat-header-title').textContent = 'Pesan';

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
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-message-wrapper ' + (msg.isOwn ? 'sent' : 'recv');

    if (!msg.isOwn && msg.users) {
      const sender = document.createElement('span');
      sender.style.fontSize = '10px';
      sender.style.fontWeight = '600';
      sender.style.color = '#64748B';
      sender.style.marginBottom = '2px';
      sender.textContent = msg.users.nama_lengkap || msg.users.username || 'User';
      wrapper.appendChild(sender);
    }

    const content = document.createElement('div');
    content.className = 'chat-bubble ' + (msg.isOwn ? 'sent' : 'recv');
    content.textContent = msg.content;

    const time = document.createElement('div');
    time.className = 'chat-msg-meta ' + (msg.isOwn ? 'sent' : 'recv');
    time.textContent = formatTime(msg.created_at);

    wrapper.appendChild(content);
    wrapper.appendChild(time);
    return wrapper;
  }

  async function sendMessage() {
    if (!currentConvId || chatStatus === 'READ_ONLY') return;
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
    list.innerHTML = '<div style="padding:12px;font-size:12px;color:#64748B;text-align:center;">Mencari user...</div>';

    try {
      const res = await fetch(`/api/chat/users?search=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Search failed');
      const users = await res.json();
      list.innerHTML = '';

      if (users.length === 0) {
        list.innerHTML = '<div style="padding:16px;font-size:12px;color:#64748B;text-align:center;">User tidak ditemukan.</div>';
        return;
      }

      users.forEach(u => {
        const item = document.createElement('div');
        item.style.padding = '8px 10px';
        item.style.cursor = 'pointer';
        item.style.borderRadius = '6px';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.onmouseover = () => item.style.backgroundColor = '#F1F5F9';
        item.onmouseout = () => item.style.backgroundColor = 'transparent';

        const name = document.createElement('div');
        name.style.fontSize = '12px';
        name.style.fontWeight = '600';
        name.textContent = u.nama_lengkap || u.username;

        const role = document.createElement('div');
        role.style.fontSize = '10px';
        role.style.color = '#64748B';
        role.textContent = u.posisi || u.role;

        item.appendChild(name);
        item.appendChild(role);

        item.onclick = async () => {
          toggleUserSearch();
          try {
            const createRes = await fetch('/api/chat/conversations/direct', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ target_user_id: u.id })
            });
            if (!createRes.ok) throw new Error('Gagal memulai chat');
            const data = await createRes.json();
            const convId = data.conversation?.id || data.id;
            await loadConversations();
            openConversation(convId, u.nama_lengkap || u.username);
          } catch(err) {
            alert(err.message);
          }
        };

        list.appendChild(item);
      });
    } catch(err) {
      list.innerHTML = '<div style="padding:12px;font-size:12px;color:#EF4444;text-align:center;">Gagal mencari user.</div>';
    }
  }

  // --- Polling & Heartbeat ---
  function startMessagePolling(convId) {
    stopMessagePolling();
    const interval = isHiddenTab ? 60000 : 3000;
    messagePollingInterval = setInterval(() => {
      if (currentConvId === convId) {
        loadMessages(convId, lastMsgId, lastMsgCreatedAt);
      }
    }, interval);
  }

  function stopMessagePolling() {
    if (messagePollingInterval) clearInterval(messagePollingInterval);
  }

  function startConvPolling() {
    stopConvPolling();
    const interval = isHiddenTab ? 60000 : 10000;
    convPollingInterval = setInterval(() => {
      if (!isSearchMode) loadConversations();
    }, interval);
  }

  function stopConvPolling() {
    if (convPollingInterval) clearInterval(convPollingInterval);
  }

  function startUnreadPolling() {
    stopUnreadPolling();
    const interval = isHiddenTab ? 120000 : 30000;
    unreadPollingInterval = setInterval(updateUnreadBadge, interval);
    updateUnreadBadge();
  }

  function stopUnreadPolling() {
    if (unreadPollingInterval) clearInterval(unreadPollingInterval);
  }

  function startPresenceHeartbeat() {
    stopPresenceHeartbeat();
    fetch('/api/chat/presence', { method: 'POST', credentials: 'include' }).catch(()=>{});
    presenceInterval = setInterval(() => {
      if (!document.hidden) {
        fetch('/api/chat/presence', { method: 'POST', credentials: 'include' }).catch(()=>{});
      }
    }, 45000);
  }

  function stopPresenceHeartbeat() {
    if (presenceInterval) clearInterval(presenceInterval);
  }

  function handleVisibilityChange() {
    isHiddenTab = document.hidden;
    if (isOpen) {
      if (currentConvId) startMessagePolling(currentConvId);
      else startConvPolling();
    } else {
      startUnreadPolling();
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

  function destroy() {
    stopMessagePolling();
    stopConvPolling();
    stopUnreadPolling();
    stopPresenceHeartbeat();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }

  return { init, destroy, toggle: togglePanel };
})();

document.addEventListener('DOMContentLoaded', () => FloatingChat.init());
window.addEventListener('beforeunload', () => FloatingChat.destroy());
