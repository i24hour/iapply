// In-memory command queue for the Chrome Extension agent
// The Telegram bot pushes commands here, the extension polls them

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
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: Date;
}

export interface AgentLog {
  userId: string;
  timestamp: Date;
  message: string;
  isError: boolean;
}

type AgentState = {
  commands: AgentCommand[];
  logs: AgentLog[];
  status: 'idle' | 'running' | 'error';
  recordingActive: boolean;
};

const userState = new Map<string, AgentState>();

function getState(userId: string): AgentState {
  let state = userState.get(userId);
  if (!state) {
    state = { commands: [], logs: [], status: 'idle', recordingActive: false };
    userState.set(userId, state);
  }
  return state;
}

// Listeners for real-time log forwarding (Telegram, etc.)
type LogListener = (log: AgentLog) => void;
const logListeners: LogListener[] = [];

export function onAgentLog(listener: LogListener) {
  logListeners.push(listener);
}

export function removeLogListener(listener: LogListener) {
  const idx = logListeners.indexOf(listener);
  if (idx >= 0) logListeners.splice(idx, 1);
}

export function pushCommand(cmd: Omit<AgentCommand, 'id' | 'status' | 'createdAt'>): AgentCommand {
  const state = getState(cmd.userId);
  const command: AgentCommand = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: cmd.userId,
    type: cmd.type,
    payload: cmd.payload,
    status: 'pending',
    createdAt: new Date(),
  };
  state.commands.push(command);
  return command;
}

export function getPendingCommand(userId: string): AgentCommand | null {
  const state = getState(userId);
  const cmd = state.commands.find((c) => c.status === 'pending');
  if (cmd) cmd.status = 'in_progress';
  return cmd || null;
}

export function completeCommand(userId: string, id: string): boolean {
  const state = getState(userId);
  const cmd = state.commands.find((c) => c.id === id);
  if (cmd) {
    cmd.status = 'completed';
    return true;
  }
  return false;
}

export function addLog(userId: string, message: string, isError = false) {
  const state = getState(userId);
  const log: AgentLog = { userId, timestamp: new Date(), message, isError };
  state.logs.push(log);
  // Keep only last 200 logs per user
  if (state.logs.length > 200) state.logs.splice(0, state.logs.length - 200);
  // Notify all listeners
  for (const listener of logListeners) {
    try { listener(log); } catch {}
  }
}

export function getRecentLogs(userId: string, count = 20): AgentLog[] {
  return getState(userId).logs.slice(-count);
}

export function setAgentStatus(userId: string, status: 'idle' | 'running' | 'error') {
  getState(userId).status = status;
}

export function getAgentStatus(userId: string) {
  return getState(userId).status;
}

export function setRecordingStatus(userId: string, active: boolean) {
  getState(userId).recordingActive = active;
}

export function getRecordingStatus(userId: string) {
  return getState(userId).recordingActive;
}
