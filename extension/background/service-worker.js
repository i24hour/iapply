import { startAgent, stopAgent, getAgentStatus } from './agent-core.js';

const API_URL = 'https://iapply-telegram-bot.onrender.com';
const TELEGRAM_POLL_INTERVAL = 5000;
const MAX_DEBUG_LOGS = 250;
const MAX_LOG_ENTRIES = 300;
const RECORDING_INTERVAL_MS = 15000;

let telegramPollTimer = null;
let recordingTimer = null;
let postAgentRunning = false;
let postAgentTabId = null;
let postAgentJobTitle = '';
let postAgentKeywords = '';
let debugLogs = [];
let agentLogs = [];
let lastCapturedAgentFrame = null;
let lastCapturedAgentFrameAt = 0;

function appendAgentLog(message, isError = false) {
  agentLogs.push({ message, isError, timestamp: Date.now() });
  if (agentLogs.length > MAX_LOG_ENTRIES) {
    agentLogs = agentLogs.slice(-MAX_LOG_ENTRIES);
  }
}

async function getAuthHeaders() {
  const result = await chrome.storage.local.get(['supabase_token']);
  const token = result.supabase_token;
  if (!token) return { 'Content-Type': 'application/json' };
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function hasAuthenticatedUser() {
  const headers = await getAuthHeaders();
  return Boolean(headers.Authorization);
}

async function createTaskRun(payload) {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) return null;

  const response = await fetch(`${API_URL}/usage/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data?.data || null;
}

function storeDebugLog(message, isError = false) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message: String(message || ''),
    isError: Boolean(isError),
    timestamp: new Date().toISOString(),
  };

  debugLogs.push(entry);
  if (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs = debugLogs.slice(-MAX_DEBUG_LOGS);
  }

  chrome.storage.local.set({ agent_debug_logs: debugLogs }).catch?.(() => {});
  chrome.runtime.sendMessage({ action: 'agent_log', ...entry }).catch(() => {});
  return entry;
}

async function emitAgentLog(message, isError = false) {
  const entry = storeDebugLog(message, isError);
  await forwardLogToBackend(entry.message, entry.isError);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachDebugger(target, version = '1.3') {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, version, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(true);
    });
  });
}

function detachDebugger(target) {
  return new Promise((resolve) => {
    chrome.debugger.detach(target, () => resolve(true));
  });
}

function sendDebuggerCommand(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result || null);
    });
  });
}

async function getPreferredLinkedInTab() {
  const status = getAgentStatus();
  const agentTabId = status?.tabId || null;

  if (agentTabId) {
    try {
      const tab = await chrome.tabs.get(agentTabId);
      if (tab?.url?.includes('linkedin.com')) {
        return tab;
      }
    } catch {
      // Agent tab might be closed or replaced. Fall back to discovery.
    }
  }

  const linkedinTabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (!linkedinTabs.length) return null;
  return linkedinTabs.find((t) => t.active) || linkedinTabs[0];
}

async function captureTabWindow(tab) {
  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 40 }, (image) => {
      if (chrome.runtime.lastError || !image) {
        resolve(null);
        return;
      }
      resolve(image);
    });
  });
}

async function captureTabViaDebugger(tabId) {
  if (!tabId) return null;
  const target = { tabId };
  let attached = false;

  try {
    await attachDebugger(target);
    attached = true;
    await sendDebuggerCommand(target, 'Page.enable');
    const screenshot = await sendDebuggerCommand(target, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 55,
      fromSurface: true,
    });
    const data = screenshot?.data;
    if (!data) return null;
    return `data:image/jpeg;base64,${data}`;
  } catch {
    return null;
  } finally {
    if (attached) {
      await detachDebugger(target);
    }
  }
}

async function uploadFrameToEndpoint(dataUrl, endpointPath) {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) return false;

  const response = await fetch(`${API_URL}${endpointPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ screenshotBase64: dataUrl }),
  });

  return response.ok;
}

async function captureAgentFrame() {
  const tab = await getPreferredLinkedInTab();
  if (!tab) return null;

  const visibleCapture = await captureTabWindow(tab);
  if (visibleCapture) return visibleCapture;

  // Fallback: capture directly from the target tab even when it is not the visible tab.
  return captureTabViaDebugger(tab.id);
}

async function captureAndUploadFrame(trigger = 'interval') {
  try {
    const dataUrl = await captureAgentFrame();

    if (!dataUrl) {
      if (trigger !== 'interval') {
        if (lastCapturedAgentFrame) {
          emitAgentLog('Live frame unavailable right now. Sending latest cached agent frame without switching tabs.').catch(() => {});
        } else {
          emitAgentLog('Could not capture frame without switching tabs. Keep LinkedIn agent tab visible in its window once to seed captures.', true).catch(() => {});
        }
      }
      return null;
    }

    lastCapturedAgentFrame = dataUrl;
    lastCapturedAgentFrameAt = Date.now();
    await uploadFrameToEndpoint(dataUrl, '/agent/capture');
    return dataUrl;
  } catch {
    // Ignore transient capture/upload failures.
    return null;
  }
}

async function reportRecordingStatus(active) {
  try {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) return;
    await fetch(`${API_URL}/agent/recording-status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ active: Boolean(active) }),
    });
  } catch {
    // Ignore status reporting errors.
  }
}

function stopLiveRecording() {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
    reportRecordingStatus(false).catch(() => {});
    emitAgentLog('Live recording stopped.').catch(() => {});
  }
}

function startLiveRecording() {
  if (recordingTimer) return;
  reportRecordingStatus(true).catch(() => {});
  emitAgentLog('Live recording started.').catch(() => {});
  recordingTimer = setInterval(() => {
    captureAndUploadFrame('interval').catch(() => {});
  }, RECORDING_INTERVAL_MS);
  captureAndUploadFrame('start').catch(() => {});
}

// Score a resume against a job-title search query using keyword overlap.
// Returns 0 if no tokens match, or the count of matching tokens.
function scoreResumeForQuery(resume, queryTokens) {
  if (!queryTokens.length) return 0;
  const fileName = (resume.file_name || '').toLowerCase();
  const skills = Array.isArray(resume.parsed_data?.skills)
    ? resume.parsed_data.skills.join(' ').toLowerCase()
    : '';
  const combined = `${fileName} ${skills}`;
  return queryTokens.reduce((score, token) => score + (combined.includes(token) ? 1 : 0), 0);
}

// Fetch all uploaded resumes and return the one most relevant to the search query.
async function fetchAndSelectResume(searchQuery) {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) return null;

  try {
    const res = await fetch(`${API_URL}/resume/all`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    const resumes = data?.data || [];
    if (!resumes.length) return null;
    if (resumes.length === 1) return resumes[0];

    const queryTokens = (searchQuery || '')
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    let bestResume = resumes[0];
    let bestScore = scoreResumeForQuery(resumes[0], queryTokens);

    for (let i = 1; i < resumes.length; i++) {
      const score = scoreResumeForQuery(resumes[i], queryTokens);
      if (score > bestScore) {
        bestScore = score;
        bestResume = resumes[i];
      }
    }

    return bestResume;
  } catch {
    return null;
  }
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
    agentLogs = [];
    appendAgentLog('Agent start requested.');
    (async () => {
      let taskId = message.config?.taskId || null;

      if (!taskId) {
        const taskRun = await createTaskRun({
          source: 'extension',
          channel: 'extension_popup',
          commandText: message.config?.searchQuery
            ? `apply ${message.config.searchQuery}`
            : 'start extension agent',
          metadata: {
            initiated_from: 'extension_popup',
          },
        });
        taskId = taskRun?.id || null;
      }

      const searchQuery = message.config?.searchQuery || '';
      const selectedResume = await fetchAndSelectResume(searchQuery);
      if (selectedResume) {
        emitAgentLog(`Resume selected for "${searchQuery}": ${selectedResume.file_name}`).catch(() => {});
      }

      startAgent({
        ...message.config,
        taskId,
        source: message.config?.source || 'extension',
        channel: message.config?.channel || 'extension_popup',
        selectedResume: selectedResume || null,
      });
      startLiveRecording();
      sendResponse({ success: true, taskId });
    })().catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (message.action === 'stop_agent') {
    appendAgentLog('Agent stop requested.');
    stopAgent();
    stopLiveRecording();
    sendResponse({ success: true });
  } else if (message.action === 'start_recording') {
    startLiveRecording();
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'stop_recording') {
    stopLiveRecording();
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'get_agent_status') {
    sendResponse(getAgentStatus());
    return true;
  } else if (message.action === 'get_agent_debug_state') {
    sendResponse({
      logs: debugLogs.slice(-120),
      status: getAgentStatus(),
    });
    return true;
  } else if (message.action === 'get_agent_logs') {
    sendResponse({ success: true, logs: agentLogs });
    return true;
  } else if (message.action === 'agent_log') {
    appendAgentLog(message.message, message.isError);
    emitAgentLog(message.message, message.isError).catch(() => {});
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
  } else if (message.action === 'agent_stopped' || message.action === 'agent_finished' || message.action === 'agent_error') {
    stopLiveRecording();
    return false;
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

    emitAgentLog(`Post agent started for title: ${postAgentJobTitle || 'all'} | keywords: ${postAgentKeywords || 'none'}`).catch(() => {});
  } catch (error) {
    postAgentRunning = false;
    postAgentTabId = null;
    emitAgentLog(`Post agent failed to start: ${error.message}`, true).catch(() => {});
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

async function pollFrontendCommands() {
  try {
    if (!(await hasAuthenticatedUser())) return;

    const response = await fetch(`${API_URL}/extension/commands`, {
      headers: await getAuthHeaders(),
    });

    if (response.status === 401) return;

    const data = await response.json();
    if (!data.success || !data.data) return;

    const cmd = data.data;
    const settings = await new Promise((resolve) => {
      chrome.storage.local.get(['llm_provider', 'llm_api_key', 'llm_model', 'llm_base_url'], resolve);
    });
    const roles = Array.isArray(cmd.payload?.roles) ? cmd.payload.roles.filter(Boolean) : [];
    const locations = Array.isArray(cmd.payload?.locations) ? cmd.payload.locations.filter(Boolean) : [];
    const searchQuery = [roles[0] || 'Software Engineer', locations[0] || ''].filter(Boolean).join(' ');

    const config = {
      provider: cmd.payload?.provider || settings.llm_provider || 'gemini',
      apiKey: cmd.payload?.apiKey || settings.llm_api_key || '',
      model: cmd.payload?.model || settings.llm_model || 'gemini-1.5-flash',
      baseUrl: cmd.payload?.baseUrl || settings.llm_base_url || '',
      searchQuery,
      count: Number(cmd.payload?.count) > 0 ? Number(cmd.payload.count) : 10,
      taskId: cmd.payload?.taskId || null,
      source: 'frontend',
      channel: 'dashboard_chat',
      agentSessionId: cmd.id,
    };

    const selectedResume = await fetchAndSelectResume(searchQuery);
    if (selectedResume) {
      config.selectedResume = selectedResume;
    }

    startAgent(config);
    startLiveRecording();
  } catch {
    // Backend not reachable.
  }
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
        count: Number(cmd.payload.count) > 0 ? Number(cmd.payload.count) : 10,
        userGoal: cmd.payload.userGoal || cmd.payload.searchQuery || 'Apply to relevant LinkedIn jobs.',
        taskId: cmd.payload.taskId || null,
        source: 'telegram',
        channel: 'telegram_bot',
      };

      const selectedResume = await fetchAndSelectResume(config.searchQuery);
      if (selectedResume) {
        config.selectedResume = selectedResume;
      }

      startAgent(config);
      startLiveRecording();

      fetch(`${API_URL}/agent/status`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ status: 'running' }),
      }).catch(() => {});
    } else if (cmd.type === 'stop_agent') {
      stopAgent();
      stopLiveRecording();

      fetch(`${API_URL}/agent/status`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ status: 'idle' }),
      }).catch(() => {});
    } else if (cmd.type === 'request_screenshot') {
      try {
        const liveFrame = await captureAgentFrame();
        if (liveFrame) {
          lastCapturedAgentFrame = liveFrame;
          lastCapturedAgentFrameAt = Date.now();
          const uploaded = await uploadFrameToEndpoint(liveFrame, '/agent/screenshot');
          if (!uploaded) {
            forwardLogToBackend('Screenshot upload failed while sending live frame.', true);
          } else {
            forwardLogToBackend('Sent live screenshot from agent tab.').catch(() => {});
          }
        } else if (lastCapturedAgentFrame) {
          const ageSec = Math.max(1, Math.round((Date.now() - lastCapturedAgentFrameAt) / 1000));
          const uploaded = await uploadFrameToEndpoint(lastCapturedAgentFrame, '/agent/screenshot');
          if (!uploaded) {
            forwardLogToBackend('Screenshot upload failed for cached frame.', true);
          } else {
            forwardLogToBackend(`Sent latest cached screenshot (${ageSec}s old) without switching tabs.`).catch(() => {});
          }
        } else {
          const tab = await getPreferredLinkedInTab();
          if (tab) {
            forwardLogToBackend('Agent tab is not visible right now and no cached screenshot is available yet.', true);
          } else {
            forwardLogToBackend('No LinkedIn tab found to capture.', true);
          }
        }
      } catch (error) {
        forwardLogToBackend('Screenshot error: ' + error.message, true);
      }
    } else if (cmd.type === 'start_recording') {
      startLiveRecording();
    } else if (cmd.type === 'stop_recording') {
      stopLiveRecording();
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
  telegramPollTimer = setInterval(() => {
    pollFrontendCommands();
    pollTelegramBridge();
  }, TELEGRAM_POLL_INTERVAL);
  pollFrontendCommands();
  pollTelegramBridge();
}

startTelegramPolling();
