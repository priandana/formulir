-- Migration: Create announcements table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(20) DEFAULT 'info' CHECK (type IN ('info','success','warning','celebration')),
  emoji TEXT DEFAULT '📢',
  is_active BOOLEAN DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookup of active announcements
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements (is_active, created_at DESC);
