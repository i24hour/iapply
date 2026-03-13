// In-memory command queue for the Chrome Extension agent
// The Telegram bot pushes commands here, the extension polls them

export interface AgentCommand {
  id: string;
  type: 'start_agent' | 'stop_agent' | 'request_screenshot';
  payload: {
    searchQuery?: string;
    provider?: string;
    model?: string;
    apiKey?: string;
  };
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: Date;
}

export interface AgentLog {
  timestamp: Date;
  message: string;
  isError: boolean;
}

let commands: AgentCommand[] = [];
let logs: AgentLog[] = [];
let agentStatus: 'idle' | 'running' | 'error' = 'idle';

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
  const command: AgentCommand = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: cmd.type,
    payload: cmd.payload,
    status: 'pending',
    createdAt: new Date(),
  };
  commands.push(command);
  return command;
}

export function getPendingCommand(): AgentCommand | null {
  const cmd = commands.find(c => c.status === 'pending');
  if (cmd) cmd.status = 'in_progress';
  return cmd || null;
}

export function completeCommand(id: string): boolean {
  const cmd = commands.find(c => c.id === id);
  if (cmd) {
    cmd.status = 'completed';
    return true;
  }
  return false;
}

export function addLog(message: string, isError = false) {
  const log: AgentLog = { timestamp: new Date(), message, isError };
  logs.push(log);
  // Keep only last 200 logs
  if (logs.length > 200) logs.splice(0, logs.length - 200);
  // Notify all listeners
  for (const listener of logListeners) {
    try { listener(log); } catch {}
  }
}

export function getRecentLogs(count = 20): AgentLog[] {
  return logs.slice(-count);
}

export function setAgentStatus(status: 'idle' | 'running' | 'error') {
  agentStatus = status;
}

export function getAgentStatus() {
  return agentStatus;
}
