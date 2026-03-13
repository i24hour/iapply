-- ============================================================
-- Phase 5: iApply Security & Supabase DB Migration
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- Enable UUID extension (usually pre-enabled on Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Users table ─────────────────────────────────────────────────────────────
-- Mirrors auth.users with extra fields for Telegram linking
CREATE TABLE IF NOT EXISTS public.users (
  id              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,
  full_name       TEXT,
  avatar_url      TEXT,
  telegram_chat_id BIGINT     UNIQUE,
  telegram_linked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Automatically create a user row when someone signs up via Google OAuth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it exists, then recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── Agent Sessions table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status              TEXT        NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'stopped', 'error')),
  search_query        TEXT,
  applications_count  INTEGER     NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own row
DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own ON public.users FOR UPDATE USING (auth.uid() = id);

-- Users can only see their own sessions
DROP POLICY IF EXISTS sessions_select_own ON public.agent_sessions;
CREATE POLICY sessions_select_own ON public.agent_sessions FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sessions_insert_own ON public.agent_sessions;
CREATE POLICY sessions_insert_own ON public.agent_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role bypasses RLS automatically (no need to add policies for it)

COMMENT ON TABLE public.users IS 'iApply user profiles, linked from Supabase Auth';
COMMENT ON TABLE public.agent_sessions IS 'Job application sessions run by the Chrome extension agent';
