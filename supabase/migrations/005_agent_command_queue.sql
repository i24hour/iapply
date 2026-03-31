-- Persistent command/log/state storage for serverless runtimes (Vercel)

CREATE TABLE IF NOT EXISTS public.agent_commands (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN (
    'start_agent',
    'stop_agent',
    'request_screenshot',
    'start_recording',
    'stop_recording',
    'manual_click'
  )),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  source        TEXT NOT NULL DEFAULT 'telegram',
  consumed_at   TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_commands_user_status_created
  ON public.agent_commands(user_id, status, created_at);

CREATE TABLE IF NOT EXISTS public.agent_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  is_error    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_user_created
  ON public.agent_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_state (
  user_id           UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'error')),
  recording_active  BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.agent_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_commands_select_own ON public.agent_commands;
CREATE POLICY agent_commands_select_own
  ON public.agent_commands
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS agent_commands_insert_own ON public.agent_commands;
CREATE POLICY agent_commands_insert_own
  ON public.agent_commands
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS agent_commands_update_own ON public.agent_commands;
CREATE POLICY agent_commands_update_own
  ON public.agent_commands
  FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS agent_logs_select_own ON public.agent_logs;
CREATE POLICY agent_logs_select_own
  ON public.agent_logs
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS agent_logs_insert_own ON public.agent_logs;
CREATE POLICY agent_logs_insert_own
  ON public.agent_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS agent_state_select_own ON public.agent_state;
CREATE POLICY agent_state_select_own
  ON public.agent_state
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS agent_state_insert_own ON public.agent_state;
CREATE POLICY agent_state_insert_own
  ON public.agent_state
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS agent_state_update_own ON public.agent_state;
CREATE POLICY agent_state_update_own
  ON public.agent_state
  FOR UPDATE
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.agent_commands IS 'Persistent command queue consumed by extension from /agent/poll';
COMMENT ON TABLE public.agent_logs IS 'Persistent extension runtime logs for Telegram/live dashboard';
COMMENT ON TABLE public.agent_state IS 'Latest extension runtime status and recording state per user';
