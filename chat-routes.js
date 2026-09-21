'use strict';
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

// Allowed MIME types for chat attachments
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 
  'image/png', 
  'image/gif', 
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

// Helper: compute direct_key canonical form
function computeDirectKey(uuidA, uuidB) {
  return [uuidA, uuidB].sort().join('_');
}

// Helper: escape HTML entities (for storage validation, not for XSS — XSS prevention is on frontend)
function stripNullBytes(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\x00/g, '');
}

module.exports = function setupChatRoutes(app, db, jwt, JWT_SECRET) {
  
  // --- Local Middleware ---
  const requireAuth = async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized. Silakan login terlebih dahulu.' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (!decoded.userId && decoded.id) decoded.userId = decoded.id;
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Sesi login habis atau tidak valid. Silakan login kembali.' });
    }
  };

  const requireAdmin = async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized.' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak. Hanya untuk Admin.' });
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Sesi tidak valid.' });
    }
  };

  const getChatSettings = async () => { 
    return await db.getChatSettings(); 
  };

  const requireChatAccess = async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const settings = await getChatSettings();
      
      // Admin bypasses status check for admin routes, but regular users don't. 
      // This middleware is used generally, so we check if disabled.
      if (settings.status === 'DISABLED' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Fitur chat sedang dinonaktifkan.' });
      }
      
      // Check role access
      if (req.user.role !== 'admin') {
        let isAllowed = false;
        // Normalize user posisi to lowercase for case-insensitive comparison
        // (DB may store 'Picker' while JWT token may have 'PICKER')
        const userPosisi = (req.user.posisi || '').toLowerCase();

        if (Array.isArray(settings.role_access)) {
          isAllowed = settings.role_access.some(r => r.toLowerCase() === userPosisi);
        } else if (settings.role_access && typeof settings.role_access === 'object') {
          if (Array.isArray(settings.role_access.operasional)) {
            isAllowed = settings.role_access.operasional.some(r => r.toLowerCase() === userPosisi);
          } else {
            // Object keys like { "Picker": true, "Sorter": true }
            isAllowed = Object.entries(settings.role_access).some(
              ([key, val]) => key.toLowerCase() === userPosisi && val === true
            );
          }
        }
        if (!isAllowed) {
          return res.status(403).json({ error: 'Role Anda tidak memiliki akses ke fitur chat.' });
        }
      }
      
      req.chatSettings = settings;
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  };

  const requireActiveChatParticipant = (getConvId) => async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const conversationId = typeof getConvId === 'function' ? getConvId(req) : req.params[getConvId];
      if (!conversationId) return res.status(400).json({ error: 'Conversation ID required' });
      
      const isActive = await db.isActiveParticipant(conversationId, req.user.userId);
      if (!isActive) return res.status(403).json({ error: 'Anda bukan partisipan aktif dalam obrolan ini.' });
      
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  };

  const requireChatParticipantOrFormer = (getConvId) => async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const conversationId = typeof getConvId === 'function' ? getConvId(req) : req.params[getConvId];
      if (!conversationId) return res.status(400).json({ error: 'Conversation ID required' });
      
      const periods = await db.getUserMembershipPeriods(conversationId, req.user.userId);
      if (!periods || periods.length === 0) {
        return res.status(403).json({ error: 'Anda tidak memiliki akses ke obrolan ini.' });
      }
      req.participantPeriods = periods;
      req.participantInfo = periods[periods.length - 1];
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  };

  const requireChatWriteAllowed = async (req, res, next) => {
    try {
      const settings = await getChatSettings();
      if (settings.status !== 'ACTIVE') {
        return res.status(403).json({ error: 'Chat sedang dalam mode ' + settings.status });
      }
      req.chatSettings = settings;
      next();
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  
  // Multer for chat attachments
  const uploadChatFile = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // we will enforce dynamic max size later in logic
  });
  
  // --- Routes ---

  // GET /api/chat/status
  app.get('/api/chat/status', requireAuth, async (req, res) => {
    try {
      const settings = await getChatSettings();
      res.set('Cache-Control', 'no-store');
      res.json({
        status: settings.status,
        allow_direct_message: settings.allow_direct_message,
        allow_group_chat: settings.allow_group_chat,
        allow_attachment: settings.allow_attachment,
        show_typing_indicator: settings.show_typing_indicator,
        show_read_receipt: settings.show_read_receipt,
        show_online_status: settings.show_online_status
      });
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil status chat' });
    }
  });

  // GET /api/chat/settings (Admin only)
  app.get('/api/chat/settings', requireAdmin, async (req, res) => {
    try {
      const settings = await getChatSettings();
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil pengaturan chat' });
    }
  });

  // PUT /api/chat/settings (Admin only)
  app.put('/api/chat/settings', requireAdmin, async (req, res) => {
    try {
      const { status, allow_direct_message, allow_group_chat, allow_attachment, show_read_receipt, show_online_status, show_typing_indicator, allow_browser_notification, max_attachment_size_mb, role_access } = req.body;
      
      if (!['ACTIVE', 'READ_ONLY', 'DISABLED'].includes(status)) {
        return res.status(400).json({ error: 'Status tidak valid.' });
      }
      
      const newSettings = {
        status, allow_direct_message, allow_group_chat, allow_attachment, show_read_receipt, show_online_status, show_typing_indicator, allow_browser_notification, max_attachment_size_mb, role_access
      };
      
      const updated = await db.saveChatSettings(newSettings);
      await db.insertAuditLog(req.user.username, 'UPDATE_CHAT_SETTINGS', `Mengubah pengaturan chat menjadi: ${status}`);
      
      res.json({ success: true, settings: updated });
    } catch (err) {
      res.status(500).json({ error: 'Gagal menyimpan pengaturan chat' });
    }
  });

  // POST /api/chat/presence
  app.post('/api/chat/presence', requireAuth, async (req, res) => {
    try {
      await db.updatePresence(req.user.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Gagal update presence' });
    }
  });

  // GET /api/chat/conversations
  app.get('/api/chat/conversations', requireAuth, requireChatAccess, async (req, res) => {
    try {
      const conversations = await db.getUserConversations(req.user.userId);
      res.json(conversations);
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil percakapan' });
    }
  });

  // POST /api/chat/conversations/direct
  app.post('/api/chat/conversations/direct', requireAuth, requireChatAccess, requireChatWriteAllowed, async (req, res) => {
    try {
      const { target_user_id } = req.body;
      if (!target_user_id) return res.status(400).json({ error: 'Target user ID diperlukan.' });
      if (target_user_id === req.user.userId) return res.status(400).json({ error: 'Tidak dapat mengirim pesan ke diri sendiri.' });
      
      if (!req.chatSettings.allow_direct_message) {
        return res.status(403).json({ error: 'Direct message dinonaktifkan.' });
      }
      
      const conv = await db.findOrCreateDirectConversation(req.user.userId, target_user_id, req.user.userId);
      res.json({ success: true, conversation: conv });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Gagal membuat percakapan' });
    }
  });

  // POST /api/chat/conversations/group
  app.post('/api/chat/conversations/group', requireAdmin, requireChatWriteAllowed, async (req, res) => {
    try {
      const { name, member_ids } = req.body;
      if (!name || name.length > 100) return res.status(400).json({ error: 'Nama grup tidak valid (maksimal 100 karakter).' });
      if (!Array.isArray(member_ids) || member_ids.length === 0) return res.status(400).json({ error: 'Daftar anggota tidak valid.' });
      
      if (!req.chatSettings.allow_group_chat) {
        return res.status(403).json({ error: 'Group chat dinonaktifkan.' });
      }
      
      const conv = await db.createGroupConversation(name, member_ids, req.user.userId);
      await db.insertAuditLog(req.user.username, 'CREATE_GROUP_CHAT', `Membuat grup chat: ${name}`);
      res.json({ success: true, conversation: conv });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Gagal membuat grup' });
    }
  });

  // GET /api/chat/conversations/:conversationId
  app.get('/api/chat/conversations/:conversationId', requireAuth, requireChatParticipantOrFormer('conversationId'), async (req, res) => {
    try {
      const details = await db.getConversationDetails(req.params.conversationId);
      res.json(details);
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil detail percakapan' });
    }
  });

  // GET /api/chat/conversations/:conversationId/messages
  app.get('/api/chat/conversations/:conversationId/messages', requireAuth, requireChatParticipantOrFormer('conversationId'), async (req, res) => {
    try {
      let { limit, before_id, after_id } = req.query;
      limit = Math.min(parseInt(limit) || 30, 50);
      
      // Use participant info to restrict query up to removed_at
      const removedAt = req.participantInfo.removed_at || null;
      
      const result = await db.getMessages(req.params.conversationId, req.user.userId, { 
        limit, 
        beforeId: before_id, 
        afterId: after_id,
        removedAt 
      });
      
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil pesan' });
    }
  });

  // POST /api/chat/conversations/:conversationId/messages
  app.post('/api/chat/conversations/:conversationId/messages', requireAuth, requireActiveChatParticipant('conversationId'), requireChatWriteAllowed, async (req, res) => {
    try {
      let { content, message_type = 'text', reply_to_message_id, idempotency_key } = req.body;
      const conversationId = req.params.conversationId;
      
      if (!content || content.length < 1 || content.length > 4000) {
        return res.status(400).json({ error: 'Panjang pesan harus 1-4000 karakter.' });
      }
      if (!['text', 'attachment'].includes(message_type)) {
        return res.status(400).json({ error: 'Tipe pesan tidak valid.' });
      }
      
      content = stripNullBytes(content);
      
      const rateLimit = await db.checkRateLimit(req.user.userId, 60000, 30);
      if (rateLimit && rateLimit.allowed === false) {
        return res.status(429).json({ error: 'Anda mengirim pesan terlalu cepat.' });
      }
      
      const msg = await db.sendMessage({
        conversationId,
        senderId: req.user.userId,
        content,
        messageType: message_type,
        replyTo: reply_to_message_id,
        idempotencyKey: idempotency_key
      });
      
      res.json({ success: true, message: msg });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Gagal mengirim pesan' });
    }
  });

  // PATCH /api/chat/messages/:messageId
  app.patch('/api/chat/messages/:messageId', requireAuth, requireChatWriteAllowed, async (req, res) => {
    try {
      let { content } = req.body;
      const messageId = req.params.messageId;
      
      if (!content || content.length < 1 || content.length > 4000) {
        return res.status(400).json({ error: 'Panjang pesan harus 1-4000 karakter.' });
      }
      content = stripNullBytes(content);
      
      const msg = await db.getMessage(messageId);
      if (!msg) return res.status(404).json({ error: 'Pesan tidak ditemukan' });
      if (msg.sender_user_id !== req.user.userId) return res.status(403).json({ error: 'Hanya pengirim yang bisa mengedit pesan ini.' });
      if (msg.is_deleted) return res.status(400).json({ error: 'Pesan sudah dihapus.' });
      
      const updated = await db.editMessage(messageId, req.user.userId, content);
      res.json({ success: true, message: updated });
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengedit pesan' });
    }
  });

  // DELETE /api/chat/messages/:messageId
  app.delete('/api/chat/messages/:messageId', requireAuth, requireChatWriteAllowed, async (req, res) => {
    try {
      const messageId = req.params.messageId;
      const msg = await db.getMessage(messageId);
      if (!msg) return res.status(404).json({ error: 'Pesan tidak ditemukan' });
      
      // Admin can delete any message in conversations they are active participants in.
      let canDelete = false;
      if (msg.sender_user_id === req.user.userId) {
        canDelete = true;
      } else if (req.user.role === 'admin') {
        const isActive = await db.isActiveParticipant(msg.conversation_id, req.user.userId);
        if (isActive) canDelete = true;
      }
      
      if (!canDelete) return res.status(403).json({ error: 'Akses ditolak.' });
      
      await db.softDeleteMessage(messageId, req.user.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Gagal menghapus pesan' });
    }
  });

  // PATCH /api/chat/conversations/:conversationId/read
  app.patch('/api/chat/conversations/:conversationId/read', requireAuth, requireActiveChatParticipant('conversationId'), async (req, res) => {
    try {
      const message_id = req.body.message_id || req.body.last_read_message_id;
      if (!message_id) return res.status(400).json({ error: 'Message ID diperlukan' });
      
      // Verify message belongs to this conversation (prevent cross-conversation last_read injection)
      const msg = await db.getMessage(message_id);
      if (!msg) return res.status(404).json({ error: 'Pesan tidak ditemukan' });
      if (msg.conversation_id !== req.params.conversationId) {
        return res.status(400).json({ error: 'Message ID tidak sesuai dengan percakapan ini' });
      }

      await db.updateLastRead(req.params.conversationId, req.user.userId, message_id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Gagal update status dibaca' });
    }
  });

  // GET /api/chat/unread-count & /api/chat/unread
  const handleUnreadCount = async (req, res) => {
    try {
      const counts = await db.getUnreadCounts(req.user.userId);
      const total = typeof counts === 'number' ? counts : (counts.total_unread || counts.count || 0);
      res.json({ success: true, total_unread: total, unread_count: total });
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil unread count' });
    }
  };
  app.get('/api/chat/unread-count', requireAuth, handleUnreadCount);
  app.get('/api/chat/unread', requireAuth, handleUnreadCount);

  // POST /api/chat/attachments
  app.post('/api/chat/attachments', requireAuth, requireChatWriteAllowed, uploadChatFile.single('file'), async (req, res) => {
    try {
      if (!req.chatSettings.allow_attachment) return res.status(403).json({ error: 'Lampiran dinonaktifkan' });
      
      const { conversation_id } = req.body;
      if (!conversation_id) return res.status(400).json({ error: 'Conversation ID diperlukan' });
      
      const isActive = await db.isActiveParticipant(conversation_id, req.user.userId);
      if (!isActive) return res.status(403).json({ error: 'Anda bukan partisipan aktif' });
      
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'File diperlukan' });
      
      const maxSize = (req.chatSettings.max_attachment_size_mb || 10) * 1024 * 1024;
      if (file.size > maxSize) return res.status(400).json({ error: `Ukuran file melebihi batas (${req.chatSettings.max_attachment_size_mb || 10}MB)` });
      
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res.status(400).json({ error: 'Tipe file tidak diizinkan' });
      }
      
      const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.-]/g, '');
      const uuidFilename = `${uuidv4()}${ext}`;
      
      const { error: uploadErr } = await db.supabase.storage.from('chat-attachments').upload(uuidFilename, file.buffer, { 
        contentType: file.mimetype, 
        upsert: false 
      });
      
      if (uploadErr) throw uploadErr;
      
      // Optional caption or attachment-only (content can be null)
      const caption = req.body.caption || req.body.content || null;
      const content = caption ? stripNullBytes(caption.trim()) : null;

      let msg;
      try {
        msg = await db.sendMessage({
          conversationId: conversation_id,
          senderId: req.user.userId,
          content: content,
          messageType: 'attachment',
          attachmentInfo: {
            filename: file.originalname,
            storage_path: uuidFilename,
            mimetype: file.mimetype,
            size: file.size
          }
        });
      } catch (dbErr) {
        // Rollback storage upload on DB failure
        await db.supabase.storage.from('chat-attachments').remove([uuidFilename]);
        throw dbErr;
      }
      
      res.json({ success: true, message: msg });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Gagal mengupload lampiran' });
    }
  });

  // GET /api/chat/attachments/:attachmentId
  app.get('/api/chat/attachments/:attachmentId', requireAuth, async (req, res) => {
    try {
      const attachmentId = req.params.attachmentId;
      const attachment = await db.getAttachment(attachmentId);
      if (!attachment) return res.status(404).json({ error: 'Lampiran tidak ditemukan' });
      
      const msg = await db.getMessage(attachment.message_id);
      if (!msg) return res.status(404).json({ error: 'Pesan terkait tidak ditemukan' });
      
      // Enforce membership period access
      const periods = await db.getUserMembershipPeriods(msg.conversation_id, req.user.userId);
      if (!periods || periods.length === 0) return res.status(403).json({ error: 'Akses ditolak' });
      
      const msgTime = new Date(msg.created_at).getTime();
      const canRead = periods.some(p => {
        const joinTime = new Date(p.joined_at).getTime();
        const removeTime = p.removed_at ? new Date(p.removed_at).getTime() : Infinity;
        return msgTime >= joinTime && msgTime <= removeTime;
      });
      
      if (!canRead) return res.status(403).json({ error: 'Akses ditolak' });
      
      const { data, error } = await db.supabase.storage.from('chat-attachments').createSignedUrl(attachment.storage_path, 3600);
      if (error) throw error;
      
      res.redirect(data.signedUrl);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Gagal mengambil lampiran' });
    }
  });

  // GET /api/chat/groups/:conversationId
  app.get('/api/chat/groups/:conversationId', requireAuth, requireActiveChatParticipant('conversationId'), async (req, res) => {
    try {
      const info = await db.getGroupInfo(req.params.conversationId);
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil info grup' });
    }
  });

  // PUT /api/chat/groups/:conversationId/name
  app.put('/api/chat/groups/:conversationId/name', requireAdmin, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'Nama grup diperlukan' });
      
      const updated = await db.updateGroupName(req.params.conversationId, name);
      await db.insertAuditLog(req.user.username, 'UPDATE_GROUP_NAME', `Mengubah nama grup menjadi: ${name}`);
      res.json({ success: true, group: updated });
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengubah nama grup' });
    }
  });

  // POST /api/chat/groups/:conversationId/members
  app.post('/api/chat/groups/:conversationId/members', requireAdmin, async (req, res) => {
    try {
      const { user_id } = req.body;
      if (!user_id) return res.status(400).json({ error: 'User ID diperlukan' });
      
      await db.addParticipant(req.params.conversationId, user_id);
      await db.insertAuditLog(req.user.username, 'ADD_GROUP_MEMBER', `Menambahkan anggota ke grup ${req.params.conversationId}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Gagal menambahkan anggota' });
    }
  });

  // DELETE /api/chat/groups/:conversationId/members/:userId
  app.delete('/api/chat/groups/:conversationId/members/:userId', requireAdmin, async (req, res) => {
    try {
      await db.removeParticipant(req.params.conversationId, req.params.userId);
      await db.insertAuditLog(req.user.username, 'REMOVE_GROUP_MEMBER', `Menghapus anggota dari grup ${req.params.conversationId}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Gagal menghapus anggota' });
    }
  });

  // GET /api/chat/users
  app.get('/api/chat/users', requireAuth, requireChatAccess, async (req, res) => {
    try {
      const { search } = req.query;
      const users = await db.getChatEligibleUsers(req.user.userId, search);
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil daftar pengguna' });
    }
  });

  // GET /api/chat/presence/:conversationId
  app.get('/api/chat/presence/:conversationId', requireAuth, requireActiveChatParticipant('conversationId'), async (req, res) => {
    try {
      const presence = await db.getPresence(req.params.conversationId);
      // Compute is_online here or inside db.getPresence
      const updatedPresence = presence.map(p => ({
        ...p,
        is_online: p.last_seen_at ? (new Date() - new Date(p.last_seen_at) < 120000) : false
      }));
      res.json(updatedPresence);
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil presence' });
    }
  });

  // POST /api/chat/typing/:conversationId
  app.post('/api/chat/typing/:conversationId', requireAuth, requireActiveChatParticipant('conversationId'), async (req, res) => {
    try {
      const settings = await getChatSettings();
      if (!settings.show_typing_indicator) return res.status(403).json({ error: 'Indikator mengetik dinonaktifkan' });
      
      await db.updateTyping(req.params.conversationId, req.user.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Gagal update typing status' });
    }
  });

  // GET /api/chat/typing/:conversationId
  app.get('/api/chat/typing/:conversationId', requireAuth, requireActiveChatParticipant('conversationId'), async (req, res) => {
    try {
      const settings = await getChatSettings();
      if (!settings.show_typing_indicator) return res.json([]);
      
      const typingUsers = await db.getTypingUsers(req.params.conversationId, req.user.userId);
      res.json(typingUsers);
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil typing users' });
    }
  });

  // GET /api/chat/poll/:conversationId
  app.get('/api/chat/poll/:conversationId', requireAuth, requireChatParticipantOrFormer('conversationId'), async (req, res) => {
    try {
      const { after_id, after_created_at } = req.query;
      const conversationId = req.params.conversationId;
      
      const removedAt = req.participantInfo.removed_at || null;
      
      const messages = await db.getMessages(conversationId, req.user.userId, { 
        afterId: after_id, 
        afterCreatedAt: after_created_at,
        removedAt,
        limit: 50 // reasonable poll limit
      });
      
      let typing = [];
      const settings = await getChatSettings();
      if (settings.show_typing_indicator && !removedAt) {
        typing = await db.getTypingUsers(conversationId, req.user.userId);
      }
      
      const updatedReadStates = await db.getUpdatedReadStates(conversationId, req.user.userId);
      
      res.json({
        messages: Array.isArray(messages) ? messages : (messages?.messages || []),
        typing,
        read_states: updatedReadStates
      });
    } catch (err) {
      res.status(500).json({ error: 'Gagal poll obrolan' });
    }
  });

};
