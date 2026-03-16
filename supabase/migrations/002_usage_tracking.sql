-- ============================================================
-- Phase 6: Task Runs + LLM Usage Tracking
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.task_runs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_email          TEXT NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('frontend', 'extension', 'telegram')),
  channel             TEXT NOT NULL,
  command_text        TEXT NOT NULL,
  provider            TEXT,
  model               TEXT,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'stopped', 'error')),
  agent_session_id    UUID REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  prompt_tokens       BIGINT NOT NULL DEFAULT 0,
  completion_tokens   BIGINT NOT NULL DEFAULT 0,
  total_tokens        BIGINT NOT NULL DEFAULT 0,
  input_cost_usd      NUMERIC(14, 6) NOT NULL DEFAULT 0,
  output_cost_usd     NUMERIC(14, 6) NOT NULL DEFAULT 0,
  total_cost_usd      NUMERIC(14, 6) NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_task_runs_user_id_started_at
  ON public.task_runs(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_runs_agent_session_id
  ON public.task_runs(agent_session_id);

CREATE TABLE IF NOT EXISTS public.llm_usage_events (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id             UUID REFERENCES public.task_runs(id) ON DELETE SET NULL,
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_email          TEXT NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('frontend', 'extension', 'telegram')),
  channel             TEXT NOT NULL,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  input_tokens        BIGINT NOT NULL DEFAULT 0,
  output_tokens       BIGINT NOT NULL DEFAULT 0,
  total_tokens        BIGINT NOT NULL DEFAULT 0,
  input_cost_usd      NUMERIC(14, 6) NOT NULL DEFAULT 0,
  output_cost_usd     NUMERIC(14, 6) NOT NULL DEFAULT 0,
  total_cost_usd      NUMERIC(14, 6) NOT NULL DEFAULT 0,
  price_known         BOOLEAN NOT NULL DEFAULT FALSE,
  pricing_source      TEXT,
  pricing_version     TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_user_id_created_at
  ON public.llm_usage_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_task_id
  ON public.llm_usage_events(task_id);

ALTER TABLE public.task_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_runs_select_own ON public.task_runs;
CREATE POLICY task_runs_select_own ON public.task_runs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS task_runs_insert_own ON public.task_runs;
CREATE POLICY task_runs_insert_own ON public.task_runs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS task_runs_update_own ON public.task_runs;
CREATE POLICY task_runs_update_own ON public.task_runs
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS llm_usage_events_select_own ON public.llm_usage_events;
CREATE POLICY llm_usage_events_select_own ON public.llm_usage_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS llm_usage_events_insert_own ON public.llm_usage_events;
CREATE POLICY llm_usage_events_insert_own ON public.llm_usage_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.task_runs IS 'Unified user task ledger for frontend, extension, and Telegram initiated work.';
COMMENT ON TABLE public.llm_usage_events IS 'Per-call LLM usage, token counts, and computed cost by task.';
