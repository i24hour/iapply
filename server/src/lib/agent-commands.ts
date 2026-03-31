import { supabase } from './supabase.js';

export interface AgentCommand {
  id: string;
  userId: string;
  type:
    | 'start_agent'
    | 'stop_agent'
    | 'request_screenshot'
    | 'start_recording'
    | 'stop_recording'
    | 'manual_click';
  payload: {
    searchQuery?: string;
    count?: number;
    userGoal?: string;
    applyMode?: 'easy' | 'apply' | 'easy_jd_resume';
    resumeMode?: 'easy' | 'apply' | 'easy_jd_resume';
    provider?: string;
    model?: string;
    apiKey?: string;
    taskId?: string;
    targetText?: string;
  };
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  createdAt: Date;
}

export interface AgentLog {
  userId: string;
  timestamp: Date;
  message: string;
  isError: boolean;
}

type AgentStateStatus = 'idle' | 'running' | 'error';

type LogListener = (log: AgentLog) => void | Promise<void>;
const logListeners: LogListener[] = [];

function normalizePayload(payload: unknown) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as AgentCommand['payload'];
  }
  return {};
}

function mapCommandRow(row: any): AgentCommand {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: String(row.type) as AgentCommand['type'],
    payload: normalizePayload(row.payload),
    status: String(row.status) as AgentCommand['status'],
    createdAt: new Date(row.created_at || Date.now()),
  };
}

export function onAgentLog(listener: LogListener) {
  logListeners.push(listener);
}

export function removeLogListener(listener: LogListener) {
  const idx = logListeners.indexOf(listener);
  if (idx >= 0) logListeners.splice(idx, 1);
}

export async function pushCommand(
  cmd: Omit<AgentCommand, 'id' | 'status' | 'createdAt'>
): Promise<AgentCommand> {
  const { data, error } = await supabase
    .from('agent_commands')
    .insert({
      user_id: cmd.userId,
      type: cmd.type,
      payload: cmd.payload || {},
      status: 'pending',
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to enqueue command: ${error?.message || 'unknown_error'}`);
  }

  return mapCommandRow(data);
}

export async function getPendingCommand(userId: string): Promise<AgentCommand | null> {
  const { data: nextCmd, error } = await supabase
    .from('agent_commands')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !nextCmd) return null;

  const { data: marked, error: markError } = await supabase
    .from('agent_commands')
    .update({
      status: 'in_progress',
      consumed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', nextCmd.id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (markError || !marked) return null;
  return mapCommandRow(marked);
}

export async function completeCommand(userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('agent_commands')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .in('status', ['pending', 'in_progress'])
    .select('id')
    .maybeSingle();

  return Boolean(!error && data?.id);
}

export async function addLog(userId: string, message: string, isError = false) {
  const log: AgentLog = {
    userId,
    timestamp: new Date(),
    message: String(message || ''),
    isError: Boolean(isError),
  };

  await supabase.from('agent_logs').insert({
    user_id: userId,
    message: log.message,
    is_error: log.isError,
    created_at: log.timestamp.toISOString(),
  });

  for (const listener of logListeners) {
    try {
      await listener(log);
    } catch {
      // Ignore listener failures.
    }
  }
}

export async function getRecentLogs(userId: string, count = 20): Promise<AgentLog[]> {
  const limit = Math.min(Math.max(Number(count) || 20, 1), 200);
  const { data } = await supabase
    .from('agent_logs')
    .select('user_id,message,is_error,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data || [])
    .map((row: any) => ({
      userId: String(row.user_id),
      message: String(row.message || ''),
      isError: Boolean(row.is_error),
      timestamp: new Date(row.created_at || Date.now()),
    }))
    .reverse();
}

export async function setAgentStatus(userId: string, status: AgentStateStatus) {
  await supabase.from('agent_state').upsert(
    {
      user_id: userId,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
}

export async function getAgentStatus(userId: string): Promise<AgentStateStatus> {
  const { data, error } = await supabase
    .from('agent_state')
    .select('status')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data?.status) return 'idle';
  const status = String(data.status);
  if (status === 'running' || status === 'error') return status;
  return 'idle';
}

export async function setRecordingStatus(userId: string, active: boolean) {
  await supabase.from('agent_state').upsert(
    {
      user_id: userId,
      recording_active: Boolean(active),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
}

export async function getRecordingStatus(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('agent_state')
    .select('recording_active')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return false;
  return Boolean(data?.recording_active);
}
