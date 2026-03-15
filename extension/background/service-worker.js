import { startAgent, stopAgent, getAgentStatus } from './agent-core.js';

const API_URL = 'https://iapply-telegram-bot.onrender.com';
const TELEGRAM_POLL_INTERVAL = 5000;

let telegramPollTimer = null;
let postAgentRunning = false;
let postAgentTabId = null;
let postAgentJobTitle = '';
let postAgentKeywords = '';

async function getAuthHeaders() {
  const result = await chrome.storage.local.get(['supabase_token']);
  const token = result.supabase_token;
  if (!token) return { 'Content-Type': 'application/json' };
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabLoad(tabId, urlIncludes = 'linkedin.com') {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      reject(new Error('Timed out while waiting for LinkedIn tab to load.'));
    }, 25000);

    function handleUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete' && tab?.url?.includes(urlIncludes)) {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(handleUpdated);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(handleUpdated);
  });
}

async function ensureLinkedInContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/linkedin.js'],
  });
}

async function sendMessageWithRetry(tabId, message, retries = 5, delayMs = 1200) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const result = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true, response });
      });
    });

    if (result.ok) {
      return result.response;
    }

    if (attempt < retries) {
      await sleep(delayMs);
    }
  }

  throw new Error('Could not start post outreach in LinkedIn tab after retries.');
}

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
    forwardLogToBackend(message.message, message.isError);
  } else if (message.action === 'set_token') {
    chrome.storage.local.set({ supabase_token: message.token }, () => {
      startTelegramPolling();
      sendResponse({ success: true });
    });
    return true;
  } else if (message.action === 'start_post_agent') {
    startPostAgent(message.jobTitle || '', message.keywords || '')
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.action === 'stop_post_agent') {
    stopPostAgent().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'get_post_agent_status') {
    sendResponse({
      running: postAgentRunning,
      tabId: postAgentTabId,
      jobTitle: postAgentJobTitle,
      keywords: postAgentKeywords,
    });
    return true;
  }
});

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

async function startPostAgent(jobTitle, keywords) {
  if (postAgentRunning) {
    await stopPostAgent();
  }

  postAgentRunning = true;
  postAgentJobTitle = (jobTitle || '').trim();
  postAgentKeywords = (keywords || '').trim();

  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  let tab;
  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { url: 'https://www.linkedin.com/feed/' });
  } else {
    tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' });
  }

  postAgentTabId = tab.id;

  try {
    await waitForTabLoad(postAgentTabId, 'linkedin.com/feed');
    await ensureLinkedInContentScript(postAgentTabId);
    await sendMessageWithRetry(postAgentTabId, {
      action: 'start_post_agent',
      jobTitle: postAgentJobTitle,
      keywords: postAgentKeywords,
    });

    chrome.runtime.sendMessage({
      action: 'agent_log',
      message: `Post agent started for title: ${postAgentJobTitle || 'all'} | keywords: ${postAgentKeywords || 'none'}`,
      isError: false,
    }).catch(() => {});
  } catch (error) {
    postAgentRunning = false;
    postAgentTabId = null;
    chrome.runtime.sendMessage({
      action: 'agent_log',
      message: `Post agent failed to start: ${error.message}`,
      isError: true,
    }).catch(() => {});
    throw error;
  }
}

async function stopPostAgent() {
  postAgentRunning = false;
  if (postAgentTabId) {
    chrome.tabs.sendMessage(postAgentTabId, { action: 'stop_post_agent' }, () => {
      // Ignore runtime error if tab was closed.
    });
  }
  postAgentTabId = null;
  postAgentJobTitle = '';
  postAgentKeywords = '';
  chrome.runtime.sendMessage({ action: 'post_agent_stopped' }).catch(() => {});
}

async function pollTelegramBridge() {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/agent/poll`, { headers });

    if (response.status === 401) return;

    const data = await response.json();
    if (!data.success || !data.command) return;

    const cmd = data.command;

    if (cmd.type === 'start_agent') {
      const settings = await new Promise((resolve) => {
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
          await sleep(800);

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
      } catch (error) {
        forwardLogToBackend('Screenshot error: ' + error.message, true);
      }
    }

    fetch(`${API_URL}/agent/complete/${cmd.id}`, {
      method: 'POST',
      headers: await getAuthHeaders(),
    }).catch(() => {});
  } catch {
    // Backend not reachable.
  }
}

function startTelegramPolling() {
  if (telegramPollTimer) return;
  telegramPollTimer = setInterval(pollTelegramBridge, TELEGRAM_POLL_INTERVAL);
  pollTelegramBridge();
}

startTelegramPolling();
