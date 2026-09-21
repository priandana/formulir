'use strict';

/**
 * SS08 Admin Live Chat Module
 * Messenger-style 3-panel layout for Admin
 * Zero innerHTML for user-generated content (XSS protection)
 */
const ChatAdminModule = (function() {
  let currentConvId = null;
  let conversations = [];
  let currentMessages = [];
  let msgPollingInterval = null;
  let unreadInterval = null;
  let presenceInterval = null;
  let lastMsgId = null;
  let lastMsgCreatedAt = null;
  let currentFilter = 'all';
  let isPageActive = false;
  let activeParticipants = [];

  function init() {
    isPageActive = true;
    renderChatPage();
    checkChatStatusBanner();
    loadConversations();
    startUnreadBadgePolling();
    startPresenceHeartbeat();
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  function destroy() {
    isPageActive = false;
    clearAllIntervals();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }

  async function checkChatStatusBanner() {
    try {
      const res = await fetch('/api/chat/settings', { credentials: 'include' });
      if (!res.ok) return;
      const s = await res.json();
      const banner = document.getElementById('admin-chat-status-banner');
      if (!banner) return;
      if (s.status === 'DISABLED') {
        banner.style.display = 'flex';
        banner.style.backgroundColor = '#FEF2F2';
        banner.style.borderBottom = '1px solid #FECACA';
        banner.style.color = '#991B1B';
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            <span>⚠️</span>
            <span><strong>Live Chat sedang NONAKTIF (DISABLED).</strong> Fitur chat disembunyikan dari user operasional.</span>
          </div>
          <button onclick="if(typeof showPage==='function') showPage('chat-settings');" style="background:#fff;border:1px solid #F87171;color:#991B1B;font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;">Buka Pengaturan</button>
        `;
      } else if (s.status === 'READ_ONLY') {
        banner.style.display = 'flex';
        banner.style.backgroundColor = '#FFFBEB';
        banner.style.borderBottom = '1px solid #FDE68A';
        banner.style.color = '#92400E';
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            <span>ℹ️</span>
            <span><strong>Live Chat dalam mode READ ONLY.</strong> Pengiriman pesan baru dinonaktifkan.</span>
          </div>
          <button onclick="if(typeof showPage==='function') showPage('chat-settings');" style="background:#fff;border:1px solid #FCD34D;color:#92400E;font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;">Buka Pengaturan</button>
        `;
      } else {
        banner.style.display = 'none';
      }
    } catch(e) {}
  }

  function renderChatPage() {
    const container = document.getElementById('page-live-chat') || document.getElementById('chat-admin-container');
    if (!container) return;
    container.style.display = 'block';

    // Static layout structure only (no user data)
    container.innerHTML = `
      <div class="chat-admin-layout">
        <!-- LEFT PANEL: Conversation List -->
        <div class="chat-left-panel">
          <div class="chat-panel-header" style="display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;font-size:16px;font-weight:700;">Live Chat</h3>
            <div style="display:flex;gap:6px;">
              <button id="admin-new-dm-btn" class="btn btn-outline" style="padding:4px 8px;font-size:12px;" title="Chat Langsung">+ DM</button>
              <button id="admin-new-group-btn" class="btn btn-primary" style="padding:4px 8px;font-size:12px;" title="Buat Grup Baru">+ Grup</button>
            </div>
          </div>
          <div style="padding:8px 12px;border-bottom:1px solid var(--chat-border,#E2E8F0);">
            <input type="text" id="admin-conv-search" class="chat-search-input" placeholder="Cari percakapan..." style="width:100%;box-sizing:border-box;" />
          </div>
          <div style="display:flex;gap:4px;padding:6px 12px;border-bottom:1px solid var(--chat-border,#E2E8F0);font-size:12px;">
            <button class="chat-filter-tab active" data-filter="all" style="flex:1;padding:4px;border:none;background:transparent;cursor:pointer;font-weight:600;border-radius:4px;">Semua</button>
            <button class="chat-filter-tab" data-filter="direct" style="flex:1;padding:4px;border:none;background:transparent;cursor:pointer;font-weight:600;border-radius:4px;">DM</button>
            <button class="chat-filter-tab" data-filter="group" style="flex:1;padding:4px;border:none;background:transparent;cursor:pointer;font-weight:600;border-radius:4px;">Grup</button>
            <button class="chat-filter-tab" data-filter="unread" style="flex:1;padding:4px;border:none;background:transparent;cursor:pointer;font-weight:600;border-radius:4px;">Unread</button>
          </div>
          <div id="admin-conv-list" style="flex:1;overflow-y:auto;padding:6px;"></div>
        </div>

        <!-- CENTER PANEL: Messages View -->
        <div class="chat-center-panel">
          <div id="admin-chat-status-banner" style="display:none;padding:10px 16px;justify-content:space-between;align-items:center;font-size:12px;"></div>
          <div class="chat-panel-header" style="display:flex;align-items:center;justify-content:space-between;min-height:56px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div id="admin-chat-header-avatar" class="chat-avatar" style="width:34px;height:34px;border-radius:50%;background:#4F46E5;color:#fff;display:none;align-items:center;justify-content:center;font-weight:700;font-size:14px;"></div>
              <div>
                <div id="admin-chat-header-title" style="font-weight:700;font-size:15px;">Pilih percakapan</div>
                <div id="admin-chat-header-subtitle" style="font-size:12px;color:var(--chat-text-muted,#94A3B8);"></div>
              </div>
            </div>
            <div id="admin-chat-header-actions" style="display:flex;gap:6px;"></div>
          </div>
          
          <div id="admin-chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;">
            <div class="chat-empty-state" style="margin:auto;text-align:center;padding:40px 20px;">
              <div style="font-size:42px;margin-bottom:10px;">💬</div>
              <div style="font-weight:700;font-size:15px;color:var(--chat-text,#1E293B);margin-bottom:4px;">Pilih atau Mulai Percakapan</div>
              <div class="chat-empty-text" style="color:var(--chat-text-muted,#94A3B8);font-size:13px;max-width:300px;margin:0 auto;">Pilih percakapan dari panel kiri atau klik <b>+ DM</b> / <b>+ Grup</b> untuk membuat percakapan baru.</div>
            </div>
          </div>
          
          <div class="chat-input-area" id="admin-chat-input-area" style="display:none;">
            <input type="text" id="admin-chat-input" class="chat-input" placeholder="Ketik pesan di sini..." maxlength="4000" autocomplete="off" />
            <button id="admin-chat-send-btn" class="chat-send-btn" title="Kirim Pesan">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
        </div>

        <!-- RIGHT PANEL: Details & Participants -->
        <div class="chat-right-panel" id="admin-chat-right">
          <div class="chat-panel-header" style="font-weight:700;font-size:14px;">Informasi Percakapan</div>
          <div id="admin-chat-info" style="padding:16px;">
            <p style="color:var(--chat-text-muted,#94A3B8);font-size:13px;margin:0;">Pilih percakapan untuk melihat detail anggota.</p>
          </div>
        </div>
      </div>

      <!-- Modal: New DM -->
      <div id="modal-new-dm" class="chat-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center;">
        <div style="background:#fff;border-radius:12px;width:90%;max-width:420px;padding:20px;box-shadow:0 10px 25px rgba(0,0,0,0.2);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h4 style="margin:0;font-size:16px;">Mulai Chat Langsung (DM)</h4>
            <button id="modal-close-dm" style="border:none;background:transparent;cursor:pointer;font-size:18px;">✕</button>
          </div>
          <input type="text" id="dm-user-search" class="chat-input" placeholder="Cari nama atau username user..." style="width:100%;box-sizing:border-box;margin-bottom:10px;" />
          <div id="dm-user-results" style="max-height:240px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:8px;padding:4px;"></div>
        </div>
      </div>

      <!-- Modal: New Group -->
      <div id="modal-new-group" class="chat-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center;">
        <div style="background:#fff;border-radius:12px;width:90%;max-width:460px;padding:20px;box-shadow:0 10px 25px rgba(0,0,0,0.2);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h4 style="margin:0;font-size:16px;">Buat Grup Baru</h4>
            <button id="modal-close-group" style="border:none;background:transparent;cursor:pointer;font-size:18px;">✕</button>
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Nama Grup</label>
            <input type="text" id="group-name-input" class="chat-input" placeholder="Contoh: Tim Shift Pagi" maxlength="100" style="width:100%;box-sizing:border-box;" />
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Pilih Anggota</label>
            <input type="text" id="group-member-search" class="chat-input" placeholder="Filter user..." style="width:100%;box-sizing:border-box;margin-bottom:6px;" />
            <div id="group-member-results" style="max-height:180px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:8px;padding:4px;"></div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button id="group-cancel-btn" class="btn btn-outline" style="padding:6px 12px;">Batal</button>
            <button id="group-submit-btn" class="btn btn-primary" style="padding:6px 14px;">Buat Grup</button>
          </div>
        </div>
      </div>
    `;

    // Event Listeners
    document.getElementById('admin-chat-send-btn').onclick = sendMessage;
    document.getElementById('admin-chat-input').addEventListener('keypress', e => {
      if (e.key === 'Enter') sendMessage();
    });

    // Filter tabs
    const filterTabs = container.querySelectorAll('.chat-filter-tab');
    filterTabs.forEach(tab => {
      tab.onclick = () => {
        filterTabs.forEach(t => {
          t.classList.remove('active');
          t.style.background = 'transparent';
          t.style.color = 'inherit';
        });
        tab.classList.add('active');
        tab.style.background = 'var(--chat-primary-light, #EEF2FF)';
        tab.style.color = 'var(--chat-primary, #4F46E5)';
        currentFilter = tab.dataset.filter;
        renderConversationList(conversations);
      };
    });

    // Search filter
    document.getElementById('admin-conv-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase().trim();
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

    // DM Modal trigger
    document.getElementById('admin-new-dm-btn').onclick = () => openDmModal();
    document.getElementById('modal-close-dm').onclick = () => closeDmModal();

    // Group Modal trigger
    document.getElementById('admin-new-group-btn').onclick = () => openGroupModal();
    document.getElementById('modal-close-group').onclick = () => closeGroupModal();
    document.getElementById('group-cancel-btn').onclick = () => closeGroupModal();
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

    let filtered = convs;
    if (currentFilter === 'direct') filtered = convs.filter(c => !c.is_group);
    else if (currentFilter === 'group') filtered = convs.filter(c => c.is_group);
    else if (currentFilter === 'unread') filtered = convs.filter(c => (c.unread_count || 0) > 0);

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty-state';
      empty.style.padding = '30px 16px';
      empty.style.textAlign = 'center';
      const icon = document.createElement('div');
      icon.style.fontSize = '28px';
      icon.style.marginBottom = '6px';
      icon.textContent = '💬';
      const text = document.createElement('div');
      text.className = 'chat-empty-text';
      text.style.fontSize = '13px';
      text.style.fontWeight = '600';
      text.textContent = 'Belum ada percakapan';
      const sub = document.createElement('div');
      sub.style.fontSize = '11px';
      sub.style.color = 'var(--chat-text-muted,#94A3B8)';
      sub.style.marginTop = '4px';
      sub.textContent = 'Klik + DM atau + Grup untuk memulai chat.';
      empty.appendChild(icon);
      empty.appendChild(text);
      empty.appendChild(sub);
      list.appendChild(empty);
      return;
    }

    filtered.forEach(c => {
      const item = document.createElement('div');
      item.className = 'chat-conv-item' + (c.id === currentConvId ? ' active' : '');
      item.onclick = () => selectConversation(c.id);

      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      avatar.style.width = '36px';
      avatar.style.height = '36px';
      avatar.style.borderRadius = '50%';
      avatar.style.backgroundColor = c.is_group ? '#7C3AED' : '#4F46E5';
      avatar.style.color = '#fff';
      avatar.style.display = 'flex';
      avatar.style.alignItems = 'center';
      avatar.style.justifyContent = 'center';
      avatar.style.fontWeight = '700';
      avatar.style.fontSize = '14px';
      avatar.style.flexShrink = '0';
      const initial = (c.display_name || c.name || '?').charAt(0).toUpperCase();
      avatar.textContent = initial;

      const body = document.createElement('div');
      body.style.flex = '1';
      body.style.minWidth = '0';
      body.style.marginLeft = '10px';

      const row1 = document.createElement('div');
      row1.style.display = 'flex';
      row1.style.justifyContent = 'space-between';
      row1.style.alignItems = 'center';

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
      time.style.color = 'var(--chat-text-muted,#94A3B8)';
      time.style.flexShrink = '0';
      if (c.updated_at) {
        time.textContent = formatTime(c.updated_at);
      }

      row1.appendChild(title);
      row1.appendChild(time);

      const row2 = document.createElement('div');
      row2.style.display = 'flex';
      row2.style.justifyContent = 'space-between';
      row2.style.alignItems = 'center';
      row2.style.marginTop = '2px';

      const preview = document.createElement('div');
      preview.style.fontSize = '12px';
      preview.style.color = 'var(--chat-text-muted,#94A3B8)';
      preview.style.whiteSpace = 'nowrap';
      preview.style.overflow = 'hidden';
      preview.style.textOverflow = 'ellipsis';
      preview.textContent = c.last_message?.content || (c.is_former_member ? '(Anda telah keluar)' : 'Belum ada pesan');

      row2.appendChild(preview);

      if ((c.unread_count || 0) > 0) {
        const badge = document.createElement('span');
        badge.className = 'chat-unread-badge';
        badge.textContent = c.unread_count > 99 ? '99+' : String(c.unread_count);
        row2.appendChild(badge);
      }

      body.appendChild(row1);
      body.appendChild(row2);

      item.appendChild(avatar);
      item.appendChild(body);
      list.appendChild(item);
    });
  }

  async function selectConversation(convId) {
    currentConvId = convId;
    stopMessagePolling();
    lastMsgId = null;
    lastMsgCreatedAt = null;
    currentMessages = [];

    const conv = conversations.find(c => c.id === convId);
    const titleEl = document.getElementById('admin-chat-header-title');
    const subEl = document.getElementById('admin-chat-header-subtitle');
    const avatarEl = document.getElementById('admin-chat-header-avatar');
    const inputArea = document.getElementById('admin-chat-input-area');

    if (conv) {
      titleEl.textContent = conv.display_name || conv.name || 'Percakapan';
      subEl.textContent = conv.is_group ? 'Grup Chat' : 'Direct Message';
      avatarEl.style.display = 'flex';
      avatarEl.textContent = (conv.display_name || conv.name || '?').charAt(0).toUpperCase();
      avatarEl.style.backgroundColor = conv.is_group ? '#7C3AED' : '#4F46E5';
    }

    inputArea.style.display = 'flex';
    document.getElementById('admin-chat-input').focus();

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
      const empty = document.createElement('div');
      empty.className = 'chat-empty-state';
      const text = document.createElement('div');
      text.className = 'chat-empty-text';
      text.textContent = 'Belum ada pesan dalam percakapan ini. Kirim pesan pertama!';
      empty.appendChild(text);
      container.appendChild(empty);
      return;
    }

    messages.forEach(msg => {
      container.appendChild(createMessageElement(msg));
    });

    container.scrollTop = container.scrollHeight;
  }

  function createMessageElement(msg) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-message-wrapper ' + (msg.isOwn ? 'sent' : 'recv');
    wrapper.id = 'msg-' + msg.id;

    // Sender name for received messages
    if (!msg.isOwn && msg.users) {
      const sender = document.createElement('span');
      sender.style.fontSize = '11px';
      sender.style.fontWeight = '600';
      sender.style.color = '#64748B';
      sender.style.marginBottom = '2px';
      sender.textContent = msg.users.nama_lengkap || msg.users.username || 'User';
      wrapper.appendChild(sender);
    }

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ' + (msg.isOwn ? 'sent' : 'recv') + (msg.deleted_at ? ' deleted' : '');

    if (msg.deleted_at) {
      const delText = document.createElement('span');
      delText.style.fontStyle = 'italic';
      delText.textContent = 'Pesan ini telah dihapus';
      bubble.appendChild(delText);
    } else {
      const text = document.createElement('span');
      text.textContent = msg.content;
      bubble.appendChild(text);

      if (msg.edited_at) {
        const editedTag = document.createElement('span');
        editedTag.style.fontSize = '10px';
        editedTag.style.opacity = '0.7';
        editedTag.style.marginLeft = '4px';
        editedTag.textContent = '(diedit)';
        bubble.appendChild(editedTag);
      }
    }

    const meta = document.createElement('div');
    meta.className = 'chat-msg-meta ' + (msg.isOwn ? 'sent' : 'recv');
    meta.textContent = formatTime(msg.created_at);

    wrapper.appendChild(bubble);
    wrapper.appendChild(meta);
    return wrapper;
  }

  async function sendMessage() {
    if (!currentConvId) return;
    const input = document.getElementById('admin-chat-input');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';

    // Optimistic UI update
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
        throw new Error(errData.error || 'Gagal mengirim');
      }
      const data = await res.json();
      // Refresh messages
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

      const typeLabel = document.createElement('div');
      typeLabel.style.fontSize = '12px';
      typeLabel.style.fontWeight = '700';
      typeLabel.style.color = '#64748B';
      typeLabel.style.marginBottom = '6px';
      typeLabel.textContent = conv.type === 'group' ? 'GRUP CHAT' : 'DIRECT MESSAGE';
      infoPanel.appendChild(typeLabel);

      const title = document.createElement('h4');
      title.style.margin = '0 0 12px 0';
      title.style.fontSize = '15px';
      title.textContent = conv.name || 'Direct Message';
      infoPanel.appendChild(title);

      const partHeading = document.createElement('div');
      partHeading.style.fontSize = '12px';
      partHeading.style.fontWeight = '700';
      partHeading.style.color = '#64748B';
      partHeading.style.marginBottom = '8px';
      partHeading.textContent = `PARTISIPAN (${conv.participants?.length || 0})`;
      infoPanel.appendChild(partHeading);

      const partList = document.createElement('div');
      partList.style.display = 'flex';
      partList.style.flexDirection = 'column';
      partList.style.gap = '8px';

      (conv.participants || []).forEach(p => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.padding = '4px 0';

        const nameBox = document.createElement('div');
        const pName = document.createElement('div');
        pName.style.fontSize = '13px';
        pName.style.fontWeight = '600';
        pName.textContent = p.user?.nama_lengkap || p.user?.username || 'User';

        const pRole = document.createElement('div');
        pRole.style.fontSize = '11px';
        pRole.style.color = '#64748B';
        pRole.textContent = (p.user?.posisi || p.user?.role || '') + (p.role === 'admin' ? ' (Admin)' : '');

        nameBox.appendChild(pName);
        nameBox.appendChild(pRole);
        row.appendChild(nameBox);
        partList.appendChild(row);
      });

      infoPanel.appendChild(partList);
    } catch(e) {
      console.error('Error loading conversation info:', e);
    }
  }

  // --- Modals: DM & Group ---
  let dmSearchTimer = null;
  function openDmModal() {
    document.getElementById('modal-new-dm').style.display = 'flex';
    document.getElementById('dm-user-search').value = '';
    searchUsersForDm('');
    document.getElementById('dm-user-search').focus();
    document.getElementById('dm-user-search').oninput = e => {
      clearTimeout(dmSearchTimer);
      dmSearchTimer = setTimeout(() => searchUsersForDm(e.target.value.trim()), 300);
    };
  }

  function closeDmModal() {
    document.getElementById('modal-new-dm').style.display = 'none';
  }

  async function searchUsersForDm(query) {
    const results = document.getElementById('dm-user-results');
    results.innerHTML = '<div style="padding:8px;font-size:12px;color:#64748B;">Mencari user...</div>';

    try {
      const res = await fetch(`/api/chat/users?search=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Search failed');
      const users = await res.json();
      results.innerHTML = '';

      if (users.length === 0) {
        results.innerHTML = '<div style="padding:8px;font-size:12px;color:#64748B;">User tidak ditemukan atau tidak memiliki akses chat.</div>';
        return;
      }

      users.forEach(u => {
        const item = document.createElement('div');
        item.style.padding = '8px 12px';
        item.style.cursor = 'pointer';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.borderRadius = '6px';
        item.onmouseover = () => item.style.backgroundColor = '#F1F5F9';
        item.onmouseout = () => item.style.backgroundColor = 'transparent';

        const name = document.createElement('div');
        name.style.fontSize = '13px';
        name.style.fontWeight = '600';
        name.textContent = u.nama_lengkap || u.username;

        const role = document.createElement('div');
        role.style.fontSize = '11px';
        role.style.color = '#64748B';
        role.textContent = u.posisi || u.role;

        item.appendChild(name);
        item.appendChild(role);

        item.onclick = async () => {
          closeDmModal();
          try {
            const createRes = await fetch('/api/chat/conversations/direct', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ target_user_id: u.id })
            });
            if (!createRes.ok) throw new Error('Gagal memulai DM');
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
      results.innerHTML = '<div style="padding:8px;font-size:12px;color:#EF4444;">Gagal mencari user.</div>';
    }
  }

  let selectedGroupMembers = new Set();
  function openGroupModal() {
    document.getElementById('modal-new-group').style.display = 'flex';
    document.getElementById('group-name-input').value = '';
    selectedGroupMembers.clear();
    loadUsersForGroup('');
    document.getElementById('group-member-search').oninput = e => {
      loadUsersForGroup(e.target.value.trim());
    };
  }

  function closeGroupModal() {
    document.getElementById('modal-new-group').style.display = 'none';
  }

  async function loadUsersForGroup(query) {
    const results = document.getElementById('group-member-results');
    results.innerHTML = '<div style="padding:6px;font-size:12px;color:#64748B;">Memuat daftar user...</div>';

    try {
      const res = await fetch(`/api/chat/users?search=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (!res.ok) return;
      const users = await res.json();
      results.innerHTML = '';

      users.forEach(u => {
        const item = document.createElement('label');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        item.style.padding = '6px 8px';
        item.style.cursor = 'pointer';
        item.style.borderRadius = '4px';

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
        label.textContent = `${u.nama_lengkap || u.username} (${u.posisi || u.role})`;

        item.appendChild(checkbox);
        item.appendChild(label);
        results.appendChild(item);
      });
    } catch(err) {
      results.innerHTML = '<div style="padding:6px;font-size:12px;color:#EF4444;">Gagal memuat user.</div>';
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

  // --- Polling & Heartbeat ---
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
      // Slow down polling when hidden
      if (currentConvId) startMessagePolling(currentConvId);
    } else {
      // Resume active polling
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

  return { init, destroy, updateNavBadge };
})();

/**
 * SS08 Admin Chat Settings Module
 */
const ChatSettingsModule = (function() {
  let settings = {};

  async function init() {
    renderSettingsForm();
    await loadSettings();
  }

  function renderSettingsForm() {
    const container = document.getElementById('page-chat-settings');
    if (!container) return;
    container.style.display = 'block';

    container.innerHTML = `
      <div style="max-width:860px;margin:0 auto;padding:16px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 style="margin:0;font-size:20px;font-weight:800;color:var(--text,#1E293B);">Pengaturan Live Chat</h2>
            <p style="margin:4px 0 0;font-size:13px;color:var(--text-muted,#64748B);">Konfigurasi status global, fitur perpesanan, dan hak akses posisi/role karyawan.</p>
          </div>
          <button id="save-chat-settings-btn" class="btn btn-primary" style="display:flex;align-items:center;gap:6px;padding:8px 20px;font-weight:600;">
            <span>Simpan Pengaturan</span>
          </button>
        </div>

        <div id="chat-settings-feedback" style="display:none;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600;"></div>
        
        <div id="chat-settings-status-alert" style="display:none;padding:14px 18px;border-radius:10px;margin-bottom:20px;font-size:13px;line-height:1.5;"></div>

        <!-- 1. Global Status -->
        <div class="card" style="background:#fff;border-radius:12px;padding:22px;margin-bottom:20px;border:1px solid #E2E8F0;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <h3 style="margin:0 0 4px;font-size:15px;font-weight:700;color:var(--text,#1E293B);">Status Live Chat</h3>
          <p style="margin:0 0 16px;font-size:12px;color:var(--text-muted,#64748B);">Tentukan ketersediaan chat di seluruh sistem secara global.</p>
          
          <div style="display:flex;flex-direction:column;gap:12px;">
            <label style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:8px;border:1px solid #E2E8F0;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor='#CBD5E1'" onmouseout="this.style.borderColor='#E2E8F0'">
              <input type="radio" name="chat_status" value="ACTIVE" style="margin-top:3px;" />
              <div>
                <span style="font-weight:700;color:#10B981;font-size:14px;">ACTIVE (Aktif Penuh)</span>
                <div style="font-size:12px;color:#64748B;margin-top:2px;">User dan Admin dapat membaca dan mengirim pesan, membuat DM/grup, dan mengunggah lampiran.</div>
              </div>
            </label>

            <label style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:8px;border:1px solid #E2E8F0;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor='#CBD5E1'" onmouseout="this.style.borderColor='#E2E8F0'">
              <input type="radio" name="chat_status" value="READ_ONLY" style="margin-top:3px;" />
              <div>
                <span style="font-weight:700;color:#F59E0B;font-size:14px;">READ ONLY (Hanya Baca)</span>
                <div style="font-size:12px;color:#64748B;margin-top:2px;">User dan Admin hanya dapat membaca history pesan. Pengiriman pesan baru, upload, dan pembuatan chat diblokir.</div>
              </div>
            </label>

            <label style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:8px;border:1px solid #E2E8F0;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor='#CBD5E1'" onmouseout="this.style.borderColor='#E2E8F0'">
              <input type="radio" name="chat_status" value="DISABLED" style="margin-top:3px;" />
              <div>
                <span style="font-weight:700;color:#EF4444;font-size:14px;">DISABLED (Nonaktif)</span>
                <div style="font-size:12px;color:#64748B;margin-top:2px;">Floating chat disembunyikan untuk user biasa. Endpoint pesan ditolak. Admin tetap dapat mengakses menu ini.</div>
              </div>
            </label>
          </div>
        </div>

        <!-- 2. Feature Toggles -->
        <div class="card" style="background:#fff;border-radius:12px;padding:22px;margin-bottom:20px;border:1px solid #E2E8F0;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <h3 style="margin:0 0 4px;font-size:15px;font-weight:700;color:var(--text,#1E293B);">Fitur & Fungsionalitas</h3>
          <p style="margin:0 0 16px;font-size:12px;color:var(--text-muted,#64748B);">Aktifkan atau nonaktifkan fitur spesifik chat.</p>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="setting-allow-dm" />
              <span style="font-size:13px;font-weight:500;">Izinkan Direct Message (DM)</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="setting-allow-group" />
              <span style="font-size:13px;font-weight:500;">Izinkan Grup Chat</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="setting-allow-attachment" />
              <span style="font-size:13px;font-weight:500;">Izinkan Lampiran File</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="setting-show-read-receipt" />
              <span style="font-size:13px;font-weight:500;">Tampilkan Read Receipt</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="setting-show-online" />
              <span style="font-size:13px;font-weight:500;">Tampilkan Status Online</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="setting-show-typing" />
              <span style="font-size:13px;font-weight:500;">Indikator Mengetik (Typing)</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="setting-allow-browser-notification" />
              <span style="font-size:13px;font-weight:500;">Izinkan Notifikasi Browser</span>
            </label>
          </div>

          <div style="margin-top:18px;padding-top:16px;border-top:1px solid #E2E8F0;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
            <label style="font-size:13px;font-weight:600;color:var(--text,#1E293B);">Maksimal Ukuran Lampiran (MB):</label>
            <input type="number" id="setting-max-attachment-size" min="1" max="50" style="width:100px;padding:6px 12px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;" />
          </div>
        </div>

        <!-- 3. Role Access -->
        <div class="card" style="background:#fff;border-radius:12px;padding:22px;border:1px solid #E2E8F0;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <h3 style="margin:0 0 4px;font-size:15px;font-weight:700;color:var(--text,#1E293B);">Akses Posisi & Role</h3>
          <p style="margin:0 0 16px;font-size:12px;color:var(--text-muted,#64748B);">Pilih posisi operasional yang diizinkan menggunakan Live Chat.</p>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="role-admin" checked disabled />
              <span style="font-size:13px;font-weight:600;color:var(--text,#1E293B);">Administrator (Wajib)</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="role-picker" />
              <span style="font-size:13px;">Picker</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="role-sorter" />
              <span style="font-size:13px;">Sorter</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="role-loader" />
              <span style="font-size:13px;">Loader</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="role-return" />
              <span style="font-size:13px;">Return</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="role-qc-outbound" />
              <span style="font-size:13px;">QC Outbound</span>
            </label>
          </div>
        </div>
      </div>
    `;

    document.getElementById('save-chat-settings-btn').onclick = saveSettings;
  }

  async function loadSettings() {
    try {
      const res = await fetch('/api/chat/settings', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load settings');
      settings = await res.json();
      populateForm(settings);
    } catch(err) {
      showFeedback('Gagal memuat pengaturan: ' + err.message, false);
    }
  }

  function populateForm(s) {
    // Status
    const statusVal = s.status || 'DISABLED';
    const statusRadio = document.querySelector(`input[name="chat_status"][value="${statusVal}"]`);
    if (statusRadio) statusRadio.checked = true;

    // Status Alert Box
    const alertBox = document.getElementById('chat-settings-status-alert');
    if (alertBox) {
      alertBox.style.display = 'block';
      if (statusVal === 'DISABLED') {
        alertBox.style.backgroundColor = '#FEF2F2';
        alertBox.style.border = '1px solid #FECACA';
        alertBox.style.color = '#991B1B';
        alertBox.innerHTML = '⚠️ <strong>Status Live Chat saat ini: DISABLED (Nonaktif).</strong> Fitur chat disembunyikan dari user operasional. Ubah ke ACTIVE dan klik Simpan Pengaturan setelah smoke test selesai.';
      } else if (statusVal === 'READ_ONLY') {
        alertBox.style.backgroundColor = '#FFFBEB';
        alertBox.style.border = '1px solid #FDE68A';
        alertBox.style.color = '#92400E';
        alertBox.innerHTML = '⏸️ <strong>Status Live Chat saat ini: READ ONLY (Hanya Baca).</strong> Pengguna hanya dapat membaca percakapan lampau. Pengiriman pesan baru ditutup.';
      } else {
        alertBox.style.backgroundColor = '#ECFDF5';
        alertBox.style.border = '1px solid #A7F3D0';
        alertBox.style.color = '#065F46';
        alertBox.innerHTML = '✅ <strong>Status Live Chat saat ini: ACTIVE (Aktif Penuh).</strong> Fitur chat aktif untuk seluruh pengguna yang diizinkan.';
      }
    }

    // Feature toggles
    document.getElementById('setting-allow-dm').checked = s.allow_direct_message !== false;
    document.getElementById('setting-allow-group').checked = s.allow_group_chat !== false;
    document.getElementById('setting-allow-attachment').checked = s.allow_attachment !== false;
    document.getElementById('setting-show-read-receipt').checked = s.show_read_receipt !== false;
    document.getElementById('setting-show-online').checked = s.show_online_status !== false;
    document.getElementById('setting-show-typing').checked = !!s.show_typing_indicator;
    const notifEl = document.getElementById('setting-allow-browser-notification');
    if (notifEl) notifEl.checked = !!s.allow_browser_notification;
    document.getElementById('setting-max-attachment-size').value = s.max_attachment_size_mb || 10;

    // Role access
    const roles = s.role_access || {};
    document.getElementById('role-picker').checked = roles.Picker !== false;
    document.getElementById('role-sorter').checked = roles.Sorter !== false;
    document.getElementById('role-loader').checked = roles.Loader !== false;
    document.getElementById('role-return').checked = roles.Return !== false;
    document.getElementById('role-qc-outbound').checked = roles['QC Outbound'] !== false;
  }

  async function saveSettings() {
    const btn = document.getElementById('save-chat-settings-btn');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    const statusInput = document.querySelector('input[name="chat_status"]:checked');
    const status = statusInput ? statusInput.value : 'DISABLED';

    const payload = {
      status,
      allow_direct_message: document.getElementById('setting-allow-dm').checked,
      allow_group_chat: document.getElementById('setting-allow-group').checked,
      allow_attachment: document.getElementById('setting-allow-attachment').checked,
      show_read_receipt: document.getElementById('setting-show-read-receipt').checked,
      show_online_status: document.getElementById('setting-show-online').checked,
      show_typing_indicator: document.getElementById('setting-show-typing').checked,
      allow_browser_notification: document.getElementById('setting-allow-browser-notification')?.checked || false,
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
      showFeedback('Pengaturan Live Chat berhasil disimpan!', true);
      populateForm(payload);
    } catch(err) {
      showFeedback('Error menyimpan: ' + err.message, false);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Simpan Pengaturan';
    }
  }

  function showFeedback(msg, isSuccess) {
    const box = document.getElementById('chat-settings-feedback');
    if (!box) return;
    box.style.display = 'block';
    box.style.backgroundColor = isSuccess ? '#ECFDF5' : '#FEF2F2';
    box.style.color = isSuccess ? '#065F46' : '#991B1B';
    box.style.border = `1px solid ${isSuccess ? '#A7F3D0' : '#FECACA'}`;
    box.textContent = msg;
    setTimeout(() => { box.style.display = 'none'; }, 4000);
  }

  return { init, save: saveSettings };
})();

window.ChatAdminModule = ChatAdminModule;
window.ChatSettingsModule = ChatSettingsModule;
