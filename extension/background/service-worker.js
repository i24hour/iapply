import { startAgent, stopAgent, getAgentStatus } from './agent-core.js';

const API_URL = 'https://iapply-telegram-bot.onrender.com';
const TELEGRAM_POLL_INTERVAL = 5000;
const MAX_LOG_ENTRIES = 300;

let telegramPollTimer = null;
let agentLogs = [];

function appendAgentLog(message, isError = false) {
  agentLogs.push({ message, isError, timestamp: Date.now() });
  if (agentLogs.length > MAX_LOG_ENTRIES) {
    agentLogs = agentLogs.slice(-MAX_LOG_ENTRIES);
  }
}

// ─── JWT helper: get the stored Supabase access token ────────────────────────
async function getAuthHeaders() {
  const result = await chrome.storage.local.get(['supabase_token']);
  const token = result.supabase_token;
  if (!token) return { 'Content-Type': 'application/json' };
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start_agent') {
    agentLogs = [];
    appendAgentLog('Agent start requested.');
    startAgent(message.config);
    sendResponse({ success: true });
  } else if (message.action === 'stop_agent') {
    appendAgentLog('Agent stop requested.');
    stopAgent();
    sendResponse({ success: true });
  } else if (message.action === 'get_agent_status') {
    sendResponse(getAgentStatus());
    return true;
  } else if (message.action === 'get_agent_logs') {
    sendResponse({ success: true, logs: agentLogs });
    return true;
  } else if (message.action === 'agent_log') {
    appendAgentLog(message.message, message.isError);
    forwardLogToBackend(message.message, message.isError);
  } else if (message.action === 'set_token') {
    // Called by popup after Google OAuth to save the JWT
    chrome.storage.local.set({ supabase_token: message.token });
    sendResponse({ success: true });
  }
});

// Forward agent logs to backend → Telegram
async function forwardLogToBackend(message, isError = false) {
  try {
    const headers = await getAuthHeaders();
    await fetch(`${API_URL}/agent/log`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, isError }),
    });
  } catch {}
}

// Poll Telegram bridge for commands
async function pollTelegramBridge() {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/agent/poll`, { headers });

    // If 401, the user isn't logged in yet — just skip silently
    if (response.status === 401) return;

    const data = await response.json();

    if (data.success && data.command) {
      const cmd = data.command;

      if (cmd.type === 'start_agent') {
        const settings = await new Promise(resolve => {
          chrome.storage.local.get(['llm_provider', 'llm_api_key', 'llm_model', 'llm_base_url'], resolve);
        });

        const config = {
          provider: cmd.payload.provider || settings.llm_provider || 'gemini',
          apiKey: cmd.payload.apiKey || settings.llm_api_key || '',
          model: cmd.payload.model || settings.llm_model || '',
          baseUrl: settings.llm_base_url || '',
          searchQuery: cmd.payload.searchQuery || 'Software Engineer',
        };

        startAgent(config);

        fetch(`${API_URL}/agent/status`, {
          method: 'POST',
          headers: await getAuthHeaders(),
          body: JSON.stringify({ status: 'running' }),
        }).catch(() => {});

      } else if (cmd.type === 'stop_agent') {
        stopAgent();

        fetch(`${API_URL}/agent/status`, {
          method: 'POST',
          headers: await getAuthHeaders(),
          body: JSON.stringify({ status: 'idle' }),
        }).catch(() => {});

      } else if (cmd.type === 'request_screenshot') {
        try {
          const allTabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
          const tabToCapture = allTabs[0];

          if (!tabToCapture) {
            forwardLogToBackend('No LinkedIn tab found to capture.', true);
          } else {
            await chrome.windows.update(tabToCapture.windowId, { focused: true });
            await chrome.tabs.update(tabToCapture.id, { active: true });
            await new Promise(r => setTimeout(r, 800));

            chrome.tabs.captureVisibleTab(tabToCapture.windowId, { format: 'jpeg', quality: 40 }, async (dataUrl) => {
              if (chrome.runtime.lastError || !dataUrl) {
                forwardLogToBackend('Screenshot capture failed: ' + (chrome.runtime.lastError?.message || 'No data'), true);
                return;
              }
              try {
                const res = await fetch(`${API_URL}/agent/screenshot`, {
                  method: 'POST',
                  headers: await getAuthHeaders(),
                  body: JSON.stringify({ screenshotBase64: dataUrl }),
                });
                if (!res.ok) {
                  forwardLogToBackend('Screenshot upload failed: HTTP ' + res.status, true);
                }
              } catch (fetchErr) {
                forwardLogToBackend('Screenshot upload error: ' + fetchErr.message, true);
              }
            });
          }
        } catch (e) {
          forwardLogToBackend('Screenshot error: ' + e.message, true);
        }
      }

      // Mark command as completed
      fetch(`${API_URL}/agent/complete/${cmd.id}`, {
        method: 'POST',
        headers: await getAuthHeaders(),
      }).catch(() => {});
    }
  } catch {
    // Backend not reachable — silently ignore
  }
}

// Start Telegram bridge polling on extension load
function startTelegramPolling() {
  if (telegramPollTimer) return;
  telegramPollTimer = setInterval(pollTelegramBridge, TELEGRAM_POLL_INTERVAL);
  pollTelegramBridge(); // Poll immediately
}

// Auto-start polling when extension loads
startTelegramPolling();
