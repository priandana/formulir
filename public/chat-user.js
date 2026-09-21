'use strict';

/**
 * ====================================================================
 * SS08 OPERATIONAL USER LIVE CHAT MODULE (V3.0 - SHARED ADMIN INBOX)
 * Direct Support Desk with Admin SS08 • Zero Peer-to-Peer
 * Adaptive polling, offline graceful handling, full XSS protection
 * ====================================================================
 */

const CHAT_UI_VERSION = 'v3.0-shared-inbox';
console.info('[Chat] version:', CHAT_UI_VERSION);

const FloatingChat = (function() {
  let isOpen = false;
  let chatStatus = 'ACTIVE';
  let chatSettings = null;
  let currentConvId = null;
  let isConvLoading = false;
  let convLoadError = null;
  let currentMessages = [];
  let messagePollingInterval = null;
  let unreadPollingInterval = null;
  let statusPollingInterval = null;
  let presenceInterval = null;
  let lastMsgId = null;
  let lastMsgCreatedAt = null;
  let isHiddenTab = false;

  async function init() {
    try {
      const statusData = await loadStatus();
      console.info('[Chat] init: status from server =', statusData ? statusData.status : 'null/undefined');
      if (!statusData || statusData.status === 'DISABLED') {
        console.info('[Chat] init: chat DISABLED — not mounting UI');
        return;
      }
      chatStatus = statusData.status || 'ACTIVE';
      chatSettings = statusData;

      injectHTML();
      applyStatusUI(chatStatus);

      startUnreadPolling();
      startPresenceHeartbeat();
      startStatusPolling();

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', () => { refreshChatStatus(); });
    } catch(err) {
      console.warn('[Chat] init failed:', err.message);
    }
  }

  function injectHTML() {
    // 1. Floating circular button
    const btn = document.createElement('button');
    btn.id = 'chat-float-btn';
    btn.setAttribute('aria-label', 'Buka Live Chat Admin');
    btn.title = 'Live Chat Admin SS08';
    btn.innerHTML = `<svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`;

    const badge = document.createElement('span');
    badge.className = 'chat-unread-badge';
    badge.id = 'chat-btn-badge';
    badge.style.display = 'none';
    btn.appendChild(badge);
    btn.onclick = togglePanel;
    document.body.appendChild(btn);

    // 2. Sliding chat panel drawer (Direct Helpdesk thread)
    const panel = document.createElement('div');
    panel.id = 'chat-float-panel';
    panel.className = 'chat-float-panel hidden';
    panel.innerHTML = `
      <div style="padding:14px 18px;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);color:#fff;display:flex;align-items:center;justify-content:space-between;border-top-left-radius:20px;border-top-right-radius:20px;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <div style="width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#fff;flex-shrink:0;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z"/></svg>
          </div>
          <div>
            <div id="chat-header-title" style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;">Live Chat SS08</div>
            <div id="chat-header-status" style="font-size:11px;opacity:0.9;margin-top:2px;display:flex;align-items:center;gap:5px;">
              <span style="width:7px;height:7px;border-radius:50%;background:#10B981;display:inline-block;"></span>
              <span>Chat dengan Admin SS08</span>
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button id="chat-close-btn" style="background:rgba(255,255,255,0.15);border:none;color:#fff;cursor:pointer;padding:6px;display:flex;border-radius:8px;transition:background 0.15s;" title="Tutup">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div id="chat-readonly-banner" class="chat-readonly-banner hidden" style="display:none;padding:8px 14px;font-size:11.5px;background:#FEF3C7;color:#92400E;text-align:center;font-weight:600;border-bottom:1px solid #FDE68A;">
        Mode Baca Saja — Pengiriman pesan baru dinonaktifkan.
      </div>
      <div id="chat-panel-body" style="flex:1;display:flex;flex-direction:column;overflow:hidden;background:#FAFBFD;">
        <div id="chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;"></div>
        <div id="chat-input-area" class="chat-composer-wrap" style="padding:10px 14px;border-top:1px solid #E2E8F0;background:#fff;">
          <div class="chat-composer-inner" style="padding:4px 6px 4px 12px;display:flex;align-items:center;gap:6px;">
            <input type="file" id="chat-file-input" style="display:none;" accept="image/*,.pdf,.xlsx,.xls,.docx,.doc" />
            <button id="chat-attach-btn" type="button" style="background:transparent;border:none;color:#64748B;cursor:pointer;padding:6px;display:flex;align-items:center;justify-content:center;border-radius:8px;" title="Kirim Lampiran">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
            </button>
            <input type="text" id="chat-input" class="chat-composer-input" placeholder="Menyiapkan percakapan..." maxlength="4000" autocomplete="off" disabled style="font-size:13px;flex:1;" />
            <button id="chat-send-btn" class="chat-send-icon-btn" style="width:34px;height:34px;flex-shrink:0;" title="Kirim" disabled>
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // Event handlers
    document.getElementById('chat-close-btn').onclick = closePanel;
    document.getElementById('chat-send-btn').onclick = sendMessage;
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    const fileInput = document.getElementById('chat-file-input');
    const attachBtn = document.getElementById('chat-attach-btn');
    if (attachBtn && fileInput) {
      attachBtn.onclick = () => fileInput.click();
      fileInput.onchange = handleFileUpload;
    }
  }

  async function loadStatus() {
    const res = await fetch('/api/chat/status', {
      credentials: 'include',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    if (!res.ok) throw new Error('Failed to load status');
    return res.json();
  }

  async function refreshChatStatus() {
    try {
      const data = await loadStatus();
      const prevStatus = chatStatus;
      const newStatus = data.status || 'ACTIVE';
      chatStatus = newStatus;
      chatSettings = data;

      console.info('[Chat] refresh status response:', { status: data.status });
      console.info('[Chat] previous status:', prevStatus, '→ new status:', newStatus);

      if (newStatus === 'DISABLED') {
        const floatBtn = document.getElementById('chat-float-btn');
        if (floatBtn) floatBtn.style.display = 'none';
        closePanel();
        return;
      }

      const floatBtn = document.getElementById('chat-float-btn');
      if (floatBtn) floatBtn.style.display = '';

      applyStatusUI(newStatus);
    } catch (e) {
      console.warn('[Chat] refreshChatStatus failed:', e.message);
    }
  }

  function applyStatusUI(status) {
    console.info('[Chat] applyStatusUI:', status);
    const banner    = document.getElementById('chat-readonly-banner');
    const inputArea = document.getElementById('chat-input-area');
    const chatInput = document.getElementById('chat-input');
    const sendBtn   = document.getElementById('chat-send-btn');
    const attachBtn = document.getElementById('chat-attach-btn');

    if (status === 'READ_ONLY') {
      if (banner)    { banner.style.display = 'block'; banner.classList.remove('hidden'); }
      if (inputArea) { inputArea.style.display = 'none'; inputArea.classList.add('hidden'); }
      if (chatInput) { chatInput.disabled = true; chatInput.setAttribute('readonly', 'readonly'); }
      if (sendBtn)   { sendBtn.disabled = true; }
      if (attachBtn) { attachBtn.disabled = true; }
    } else {
      // ACTIVE
      if (banner)    { banner.style.display = 'none'; banner.classList.add('hidden'); }
      if (inputArea) { inputArea.style.display = ''; inputArea.classList.remove('hidden'); }
      // Only enable composer input if conversation is ready
      if (currentConvId) {
        if (chatInput) {
          chatInput.disabled = false;
          chatInput.removeAttribute('readonly');
          chatInput.placeholder = 'Tulis pesan ke Admin SS08...';
        }
        if (sendBtn) sendBtn.disabled = false;
        if (attachBtn) attachBtn.disabled = false;
      }
    }
  }

  function startStatusPolling() {
    if (statusPollingInterval) clearInterval(statusPollingInterval);
    statusPollingInterval = setInterval(() => {
      refreshChatStatus();
    }, 25000);
  }

  function togglePanel() {
    if (isOpen) closePanel();
    else openPanel();
  }

  async function openPanel() {
    isOpen = true;
    const panel = document.getElementById('chat-float-panel');
    if (panel) panel.classList.remove('hidden');

    console.info('[Chat] openPanel: current chatStatus =', chatStatus, '— initializing support conversation...');
    await refreshChatStatus();

    // Find or create the User <-> Admin support conversation
    if (!currentConvId) {
      await loadSupportConversation();
    } else {
      await loadMessages(currentConvId);
      startMessagePolling(currentConvId);
    }

    stopUnreadPolling();
  }

  function closePanel() {
    isOpen = false;
    const panel = document.getElementById('chat-float-panel');
    if (panel) panel.classList.add('hidden');

    stopMessagePolling();
    startUnreadPolling();
  }

  // --- Auto-create / Fetch Support Conversation ---
  async function loadSupportConversation() {
    if (isConvLoading) return;
    isConvLoading = true;
    convLoadError = null;

    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    if (chatInput) {
      chatInput.disabled = true;
      chatInput.placeholder = 'Menyiapkan percakapan...';
    }
    if (sendBtn) sendBtn.disabled = true;

    renderLoadingState();

    try {
      const res = await fetch('/api/chat/support', {
        credentials: 'include',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal membuka percakapan dengan Admin');
      }

      const data = await res.json();
      currentConvId = data.conversation.id;

      if (chatStatus === 'ACTIVE' && chatInput) {
        chatInput.disabled = false;
        chatInput.removeAttribute('readonly');
        chatInput.placeholder = 'Tulis pesan ke Admin SS08...';
        chatInput.focus();
        if (sendBtn) sendBtn.disabled = false;
      }

      await loadMessages(currentConvId);
      startMessagePolling(currentConvId);
    } catch (err) {
      convLoadError = err.message;
      renderErrorState(err.message);
    } finally {
      isConvLoading = false;
    }
  }

  function renderLoadingState() {
    const list = document.getElementById('chat-messages');
    if (!list) return;
    list.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;color:#64748B;text-align:center;">
        <div style="width:32px;height:32px;border:3px solid #E2E8F0;border-top-color:#2563EB;border-radius:50%;animation:chatSpin 0.8s linear infinite;margin-bottom:12px;"></div>
        <div style="font-size:13px;font-weight:600;color:#0F172A;">Menghubungkan ke Admin SS08...</div>
        <div style="font-size:11.5px;color:#94A3B8;margin-top:4px;">Memuat riwayat percakapan</div>
      </div>
      <style>@keyframes chatSpin { to { transform: rotate(360deg); } }</style>
    `;
  }

  function renderErrorState(errMsg) {
    const list = document.getElementById('chat-messages');
    if (!list) return;
    list.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px 20px;text-align:center;">
        <div style="width:48px;height:48px;border-radius:14px;background:#FEE2E2;color:#EF4444;display:flex;align-items:center;justify-content:center;margin-bottom:12px;">
          <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        </div>
        <div style="font-size:13.5px;font-weight:700;color:#0F172A;">Gagal Membuka Percakapan</div>
        <div style="font-size:12px;color:#64748B;margin:6px 0 16px;line-height:1.4;">${escapeHtml(errMsg || 'Tidak dapat terhubung ke server chat.')}</div>
        <button onclick="FloatingChat.retrySupportChat()" style="background:#2563EB;color:#fff;border:none;padding:8px 16px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,0.25);">Coba Lagi</button>
      </div>
    `;
  }

  async function loadMessages(convId, afterId = null, afterCreatedAt = null) {
    try {
      let url = `/api/chat/conversations/${convId}/messages?limit=40`;
      if (afterId && afterCreatedAt) {
        url = `/api/chat/poll/${convId}?after_id=${afterId}&after_created_at=${encodeURIComponent(afterCreatedAt)}`;
      }

      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();

      const newMsgs = Array.isArray(data) ? data : (data.messages || []);
      if (afterId && afterCreatedAt) {
        if (newMsgs.length > 0) {
          currentMessages = currentMessages.concat(newMsgs);
          renderMessages(newMsgs, true);
        }
      } else {
        currentMessages = newMsgs;
        renderMessages(currentMessages, false);
      }

      if (currentMessages.length > 0) {
        const lastMsg = currentMessages[currentMessages.length - 1];
        lastMsgId = lastMsg.id;
        lastMsgCreatedAt = lastMsg.created_at;
        // Mark as read
        markRead(convId, lastMsgId);
      }
    } catch(err) {
      console.error('Error loading messages:', err);
    }
  }

  function renderMessages(msgs, isAppend = false) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    if (!isAppend) {
      container.innerHTML = '';
      if (msgs.length === 0) {
        const welcome = document.createElement('div');
        welcome.className = 'chat-empty-state-wrap';
        welcome.style.padding = '40px 14px';
        welcome.style.textAlign = 'center';
        welcome.innerHTML = `
          <div style="width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,#EFF6FF 0%,#DBEAFE 100%);color:#2563EB;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;box-shadow:0 4px 12px rgba(37,99,235,0.1);">
            <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
          </div>
          <div style="font-size:14px;font-weight:800;color:#0F172A;letter-spacing:-0.01em;">Hubungi Admin SS08</div>
          <div style="font-size:12px;color:#64748B;margin-top:6px;line-height:1.5;max-width:280px;margin-left:auto;margin-right:auto;">
            Gunakan Live Chat untuk menghubungi Administrator terkait kebutuhan operasional atau kendala kerja Anda.
          </div>
        `;
        container.appendChild(welcome);
        return;
      }
    }

    msgs.forEach(m => {
      const bubble = createMessageBubble(m);
      container.appendChild(bubble);
    });

    container.scrollTop = container.scrollHeight;
  }

  function createMessageBubble(m) {
    const isOwn = !!m.isOwn;
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.alignItems = isOwn ? 'flex-end' : 'flex-start';
    row.style.marginBottom = '10px';

    if (!isOwn) {
      const senderLabel = document.createElement('div');
      senderLabel.style.fontSize = '11px';
      senderLabel.style.fontWeight = '700';
      senderLabel.style.color = '#2563EB';
      senderLabel.style.marginBottom = '3px';
      senderLabel.style.marginLeft = '4px';
      senderLabel.style.display = 'flex';
      senderLabel.style.alignItems = 'center';
      senderLabel.style.gap = '4px';
      senderLabel.innerHTML = `
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#2563EB;"></span>
        <span>Admin SS08</span>
      `;
      row.appendChild(senderLabel);
    }

    const bubble = document.createElement('div');
    bubble.className = isOwn ? 'chat-bubble chat-bubble-outgoing' : 'chat-bubble chat-bubble-incoming';
    bubble.style.maxWidth = '85%';
    bubble.style.padding = '9px 13px';
    bubble.style.borderRadius = isOwn ? '16px 16px 4px 16px' : '16px 16px 16px 4px';
    bubble.style.fontSize = '13px';
    bubble.style.lineHeight = '1.45';
    bubble.style.wordBreak = 'break-word';

    if (isOwn) {
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
              <img src="/api/chat/attachments/${att.id}" style="max-width:100%;max-height:180px;border-radius:10px;object-fit:cover;display:block;margin-bottom:6px;" alt="${escapeHtml(att.original_filename)}" />
            </a>
          `;
        } else {
          attEl.innerHTML = `
            <a href="/api/chat/attachments/${att.id}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${isOwn ? 'rgba(255,255,255,0.15)' : '#F1F5F9'};border-radius:8px;color:${isOwn ? '#fff' : '#0F172A'};text-decoration:none;font-size:12px;font-weight:600;">
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
    meta.style.opacity = isOwn ? '0.85' : '0.6';
    meta.style.color = isOwn ? '#fff' : '#64748B';

    const timeSpan = document.createElement('span');
    timeSpan.textContent = formatTime(m.created_at);
    meta.appendChild(timeSpan);

    if (isOwn) {
      const checkSpan = document.createElement('span');
      checkSpan.innerHTML = `✓✓`;
      checkSpan.style.fontSize = '11px';
      meta.appendChild(checkSpan);
    }

    bubble.appendChild(meta);
    row.appendChild(bubble);
    return row;
  }

  async function sendMessage() {
    if (!currentConvId) return;
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
        throw new Error(errData.error || 'Gagal mengirim pesan');
      }
      loadMessages(currentConvId, lastMsgId, lastMsgCreatedAt);
    } catch(err) {
      console.error('Send error:', err);
      alert(err.message);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !currentConvId) return;

    const maxSize = (chatSettings?.max_attachment_size_mb || 10) * 1024 * 1024;
    if (file.size > maxSize) {
      alert(`Ukuran file melebihi batas (${chatSettings?.max_attachment_size_mb || 10}MB)`);
      e.target.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('conversation_id', currentConvId);
    formData.append('file', file);

    try {
      const attachBtn = document.getElementById('chat-attach-btn');
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
      await loadMessages(currentConvId, lastMsgId, lastMsgCreatedAt);
    } catch(err) {
      alert(err.message);
    } finally {
      e.target.value = '';
      const attachBtn = document.getElementById('chat-attach-btn');
      if (attachBtn) attachBtn.disabled = false;
    }
  }

  async function markRead(convId, msgId) {
    if (!msgId || !convId) return;
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

  // --- Background Polling ---
  function startMessagePolling(convId) {
    stopMessagePolling();
    const interval = isHiddenTab ? 25000 : 3000;
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
    }, 25000);
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
    } else {
      refreshChatStatus();
      if (isOpen && currentConvId) {
        loadMessages(currentConvId, lastMsgId, lastMsgCreatedAt);
        startMessagePolling(currentConvId);
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
    refreshChatStatus,
    retrySupportChat: () => {
      currentConvId = null;
      loadSupportConversation();
    }
  };
})();

// Auto-initialize if running on operational frontend
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => FloatingChat.init());
  } else {
    FloatingChat.init();
  }
}
