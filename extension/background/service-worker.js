import { startAgent, stopAgent, getAgentStatus } from './agent-core.js';

const API_URL = 'http://localhost:3001';
const TELEGRAM_POLL_INTERVAL = 5000;

let telegramPollTimer = null;

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start_agent') {
    startAgent(message.config);
    sendResponse({ success: true });
  } else if (message.action === 'stop_agent') {
    stopAgent();
    sendResponse({ success: true });
  } else if (message.action === 'get_agent_status') {
    sendResponse(getAgentStatus());
    return true;
  } else if (message.action === 'agent_log') {
    // Forward agent logs to the backend (for Telegram)
    forwardLogToBackend(message.message, message.isError);
  }
});

// Forward agent logs to backend → Telegram
async function forwardLogToBackend(message, isError = false) {
  try {
    await fetch(`${API_URL}/agent/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, isError }),
    });
  } catch {}
}

// Poll Telegram bridge for commands
async function pollTelegramBridge() {
  try {
    const response = await fetch(`${API_URL}/agent/poll`);
    const data = await response.json();

    if (data.success && data.command) {
      const cmd = data.command;

      if (cmd.type === 'start_agent') {
        // Load LLM settings from chrome.storage and merge with Telegram payload
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

        // Report status back
        fetch(`${API_URL}/agent/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'running' }),
        }).catch(() => {});

      } else if (cmd.type === 'stop_agent') {
        stopAgent();

        fetch(`${API_URL}/agent/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'idle' }),
        }).catch(() => {});
      } else if (cmd.type === 'request_screenshot') {
        // Capture screenshot from any LinkedIn tab
        try {
          const allTabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
          const tabToCapture = allTabs[0];

          if (!tabToCapture) {
            forwardLogToBackend('No LinkedIn tab found to capture.', true);
          } else {
            // Bring the tab's window into focus for capture
            await chrome.windows.update(tabToCapture.windowId, { focused: true });
            await chrome.tabs.update(tabToCapture.id, { active: true });

            // Wait for the window to paint before capturing
            await new Promise(r => setTimeout(r, 800));

            chrome.tabs.captureVisibleTab(tabToCapture.windowId, { format: 'jpeg', quality: 40 }, async (dataUrl) => {
              if (chrome.runtime.lastError || !dataUrl) {
                forwardLogToBackend('Screenshot capture failed: ' + (chrome.runtime.lastError?.message || 'No data'), true);
                return;
              }
              try {
                const res = await fetch(`${API_URL}/agent/screenshot`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
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
      fetch(`${API_URL}/agent/complete/${cmd.id}`, { method: 'POST' }).catch(() => {});
    }
  } catch (error) {
    // Backend might not be running — silently ignore
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
