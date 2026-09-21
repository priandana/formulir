-- ============================================================
-- SS08 Live Chat — Database Migration & Hardening
-- Version: 1.1.0
-- Date: 2026-09-21
-- ============================================================
-- SAFE & IDEMPOTENT:
-- Additive only. No DROP, no DELETE, no TRUNCATE.
-- Locks down direct Supabase REST API access for all chat tables.
-- Server Express API (via service_role) is the SOLE authorized accessor.
-- Preserves chat history even if operational users are deleted.
-- Supports group membership periods (rejoin history).
-- ============================================================

-- ================================================================
-- 1. chat_conversations
-- ================================================================
CREATE TABLE IF NOT EXISTS chat_conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT        NOT NULL CHECK (type IN ('direct', 'group')),
  name            TEXT,
  -- Canonical direct pair key: min(uuidA,uuidB)||':'||max(uuidA,uuidB)
  direct_key      TEXT,
  -- SET NULL ensures deleting user does not delete historical conversation
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ
);

-- DB-level uniqueness for direct conversations: prevents race condition duplicate DMs
CREATE UNIQUE INDEX IF NOT EXISTS chat_conv_direct_key_unique
  ON chat_conversations(direct_key)
  WHERE type = 'direct' AND direct_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_conv_last_msg_idx
  ON chat_conversations(last_message_at DESC NULLS LAST);

-- ================================================================
-- 2. chat_participants
-- ================================================================
-- Membership periods model:
-- Supports user join -> removed -> join again (rejoin).
-- Old membership history is retained with original joined_at and removed_at.
-- Only ONE active membership row allowed per user per conversation.
CREATE TABLE IF NOT EXISTS chat_participants (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      UUID        NOT NULL REFERENCES chat_conversations(id) ON DELETE RESTRICT,
  user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                 TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'group_admin')),
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = currently active member. Set when user is removed from group.
  removed_at           TIMESTAMPTZ,
  -- Read receipt: FK added after chat_messages table definition
  last_read_message_id UUID,
  last_read_at         TIMESTAMPTZ,
  muted                BOOLEAN     NOT NULL DEFAULT FALSE,
  archived             BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Partial Unique Index: ensures at most ONE active membership per user per conversation
CREATE UNIQUE INDEX IF NOT EXISTS chat_part_conv_user_active_unique
  ON chat_participants(conversation_id, user_id)
  WHERE removed_at IS NULL;

-- Fast lookups
CREATE INDEX IF NOT EXISTS chat_part_user_active_idx
  ON chat_participants(user_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS chat_part_conv_user_idx
  ON chat_participants(conversation_id, user_id);

CREATE INDEX IF NOT EXISTS chat_part_user_read_idx
  ON chat_participants(user_id, last_read_message_id);

-- ================================================================
-- 3. chat_messages
-- ================================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID        NOT NULL REFERENCES chat_conversations(id) ON DELETE RESTRICT,
  -- SET NULL retains message in conversation if user is deleted (never cascade delete history)
  sender_user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  -- Cached sender name ensures author attribution persists even if user row is deleted
  sender_name         TEXT,
  -- Content is nullable for attachment-only messages, but required for text messages
  content             TEXT,
  message_type        TEXT        NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'attachment')),
  reply_to_message_id UUID        REFERENCES chat_messages(id) ON DELETE SET NULL,
  idempotency_key     TEXT,
  edited_at           TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_msg_content_check CHECK (
    (message_type = 'text' AND content IS NOT NULL AND char_length(content) BETWEEN 1 AND 4000)
    OR
    (message_type = 'attachment' AND (content IS NULL OR char_length(content) <= 4000))
  )
);

-- Idempotency key scoped per conversation and sender (prevents cross-user collisions)
CREATE UNIQUE INDEX IF NOT EXISTS chat_msg_idempotency_scoped_idx
  ON chat_messages(conversation_id, sender_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

-- Message pagination index
CREATE INDEX IF NOT EXISTS chat_msg_conv_created_idx
  ON chat_messages(conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS chat_msg_conv_created_id_idx
  ON chat_messages(conversation_id, created_at, id)
  WHERE deleted_at IS NULL;

-- Sender lookup & rate limit check
CREATE INDEX IF NOT EXISTS chat_msg_sender_created_idx
  ON chat_messages(sender_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS chat_msg_ratelimit_idx
  ON chat_messages(sender_user_id, created_at DESC);

-- Add foreign key for last_read_message_id in chat_participants
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chat_part_last_read_fk'
  ) THEN
    ALTER TABLE chat_participants
      ADD CONSTRAINT chat_part_last_read_fk
      FOREIGN KEY (last_read_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ================================================================
-- 4. chat_attachments
-- ================================================================
CREATE TABLE IF NOT EXISTS chat_attachments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        UUID        NOT NULL REFERENCES chat_messages(id) ON DELETE RESTRICT,
  storage_path      TEXT        NOT NULL,
  original_filename TEXT        NOT NULL,
  mime_type         TEXT        NOT NULL,
  file_size         INTEGER     NOT NULL CHECK (file_size > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_attach_msg_idx ON chat_attachments(message_id);

-- ================================================================
-- 5. chat_presence
-- ================================================================
CREATE TABLE IF NOT EXISTS chat_presence (
  user_id      UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- 6. chat_typing (ephemeral)
-- ================================================================
CREATE TABLE IF NOT EXISTS chat_typing (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS chat_typing_conv_idx
  ON chat_typing(conversation_id, updated_at DESC);

-- ================================================================
-- 7. Private Storage Bucket (chat-attachments)
-- ================================================================
-- Creates private bucket for chat attachments idempotently.
-- If bucket already exists, guarantees public = false and applies secure configuration.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760, -- 10MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Explicit hardening: guarantee bucket is definitively private
UPDATE storage.buckets
SET public = false
WHERE id = 'chat-attachments';

-- ================================================================
-- 8. DATABASE HARDENING & ROW LEVEL SECURITY (RLS)
-- ================================================================
-- Direct access from Supabase REST API (browser) using anon or authenticated key
-- is COMPLETELY BLOCKED. No policies exist for anon/authenticated roles.
-- Express server connects using service_role credentials, which bypasses RLS.
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_typing ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke permissions from anon and authenticated roles
REVOKE ALL ON TABLE chat_conversations FROM anon, authenticated;
REVOKE ALL ON TABLE chat_participants FROM anon, authenticated;
REVOKE ALL ON TABLE chat_messages FROM anon, authenticated;
REVOKE ALL ON TABLE chat_attachments FROM anon, authenticated;
REVOKE ALL ON TABLE chat_presence FROM anon, authenticated;
REVOKE ALL ON TABLE chat_typing FROM anon, authenticated;

-- ================================================================
-- 9. Default chat_settings in site_settings (idempotent)
-- ================================================================
-- Default status is DISABLED so feature is dormant upon migration
-- until verified and activated by Administrator in UI.
INSERT INTO site_settings (key, value)
VALUES (
  'chat_settings',
  jsonb_build_object(
    'status', 'DISABLED',
    'allow_direct_message', true,
    'allow_group_chat', true,
    'allow_attachment', true,
    'show_read_receipt', true,
    'show_online_status', true,
    'show_typing_indicator', false,
    'allow_browser_notification', false,
    'max_attachment_size_mb', 10,
    'role_access', jsonb_build_object(
      'admin', true,
      'Picker', true,
      'Sorter', true,
      'Loader', true,
      'Return', true,
      'QC Outbound', true
    )
  )
)
ON CONFLICT (key) DO NOTHING;

-- ================================================================
-- END OF MIGRATION
-- ================================================================
