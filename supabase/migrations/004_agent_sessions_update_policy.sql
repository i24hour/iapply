-- Fix: allow authenticated users to update their own agent sessions.
-- Without this policy, status transitions (idle -> running -> stopped) fail under RLS.

ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_update_own ON public.agent_sessions;
CREATE POLICY sessions_update_own
  ON public.agent_sessions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

