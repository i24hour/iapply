-- ============================================================
-- Phase 6: iApply domain tables required by server routes
-- Run this after 001_initial_schema.sql and 002_usage_tracking.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Keep updated_at current on updates
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Profiles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID        NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  full_name         TEXT,
  phone             TEXT,
  location          TEXT,
  skills            TEXT[]      NOT NULL DEFAULT '{}',
  experience_years  INTEGER     NOT NULL DEFAULT 0,
  preferred_roles   TEXT[]      NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Resumes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.resumes (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  file_name    TEXT        NOT NULL,
  file_url     TEXT        NOT NULL,
  parsed_data  JSONB,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resumes_user_uploaded_at
  ON public.resumes (user_id, uploaded_at DESC);

-- ─── Job Preferences ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_preferences (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID        NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  roles             TEXT[]      NOT NULL DEFAULT '{}',
  locations         TEXT[]      NOT NULL DEFAULT '{}',
  remote_only       BOOLEAN     NOT NULL DEFAULT FALSE,
  min_salary        INTEGER,
  max_salary        INTEGER,
  experience_level  TEXT        NOT NULL DEFAULT 'any',
  job_types         TEXT[]      NOT NULL DEFAULT ARRAY['full-time']::TEXT[],
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_job_preferences_updated_at ON public.job_preferences;
CREATE TRIGGER trg_job_preferences_updated_at
  BEFORE UPDATE ON public.job_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Jobs ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jobs (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform       TEXT        NOT NULL,
  external_id    TEXT        NOT NULL,
  company        TEXT        NOT NULL,
  title          TEXT        NOT NULL,
  description    TEXT        NOT NULL,
  location       TEXT        NOT NULL,
  url            TEXT        NOT NULL,
  salary         TEXT,
  is_easy_apply  BOOLEAN     NOT NULL DEFAULT FALSE,
  posted_at      TIMESTAMPTZ,
  scraped_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, external_id)
);

-- ─── Applications ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.applications (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  job_id          UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'pending',
  screenshot_url  TEXT,
  applied_at      TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_user_status
  ON public.applications (user_id, status);

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS resumes_select_own ON public.resumes;
CREATE POLICY resumes_select_own ON public.resumes
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS resumes_insert_own ON public.resumes;
CREATE POLICY resumes_insert_own ON public.resumes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS resumes_update_own ON public.resumes;
CREATE POLICY resumes_update_own ON public.resumes
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS preferences_select_own ON public.job_preferences;
CREATE POLICY preferences_select_own ON public.job_preferences
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS preferences_insert_own ON public.job_preferences;
CREATE POLICY preferences_insert_own ON public.job_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS preferences_update_own ON public.job_preferences;
CREATE POLICY preferences_update_own ON public.job_preferences
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS jobs_select_all ON public.jobs;
CREATE POLICY jobs_select_all ON public.jobs
  FOR SELECT USING (true);
DROP POLICY IF EXISTS jobs_insert_authenticated ON public.jobs;
CREATE POLICY jobs_insert_authenticated ON public.jobs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS jobs_update_authenticated ON public.jobs;
CREATE POLICY jobs_update_authenticated ON public.jobs
  FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS applications_select_own ON public.applications;
CREATE POLICY applications_select_own ON public.applications
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS applications_insert_own ON public.applications;
CREATE POLICY applications_insert_own ON public.applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS applications_update_own ON public.applications;
CREATE POLICY applications_update_own ON public.applications
  FOR UPDATE USING (auth.uid() = user_id);

COMMENT ON TABLE public.profiles IS 'User profile fields used by iApply automation';
COMMENT ON TABLE public.resumes IS 'Uploaded/generated resumes and parsed metadata';
COMMENT ON TABLE public.job_preferences IS 'Per-user job preference filters';
COMMENT ON TABLE public.jobs IS 'Scraped job listings from LinkedIn';
COMMENT ON TABLE public.applications IS 'User applications mapped to scraped jobs';
