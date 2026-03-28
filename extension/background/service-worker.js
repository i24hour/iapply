import { startAgent, stopAgent, getAgentStatus } from './agent-core.js';

const API_URL = 'https://iapply-telegram-bot.onrender.com';
const TELEGRAM_POLL_INTERVAL = 5000;
const MAX_DEBUG_LOGS = 250;
const MAX_LOG_ENTRIES = 300;
const RECORDING_INTERVAL_MS = 15000;
const CAPTURE_STALE_LOCK_MS = 7000;
const CAPTURE_FRAME_TIMEOUT_MS = 7500;
const RESUME_SELECT_MIN_SCORE = 6;
const RESUME_SELECT_MIN_MARGIN = 2;

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
let captureInFlightPromise = null;
let captureInFlightStartedAt = 0;
let lastCaptureFailureLogAt = 0;

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
  chrome.runtime
    .sendMessage({ action: 'agent_log', ...entry, _fromServiceWorker: true })
    .catch(() => {});
  return entry;
}

async function emitAgentLog(message, isError = false) {
  const entry = storeDebugLog(message, isError);
  await forwardLogToBackend(entry.message, entry.isError);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label = 'operation') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
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
    await withTimeout(attachDebugger(target), 3000, 'debugger.attach');
    attached = true;
    await withTimeout(sendDebuggerCommand(target, 'Page.enable'), 3000, 'Page.enable');
    const screenshot = await withTimeout(sendDebuggerCommand(target, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 55,
      fromSurface: true,
    }), 4000, 'Page.captureScreenshot');
    const data = screenshot?.data;
    if (!data) return null;
    return `data:image/jpeg;base64,${data}`;
  } catch (error) {
    const now = Date.now();
    if (now - lastCaptureFailureLogAt > 30000) {
      lastCaptureFailureLogAt = now;
      emitAgentLog(`Debugger capture failed: ${error.message || 'unknown error'}`, true).catch(() => {});
    }
    return null;
  } finally {
    if (attached) {
      await withTimeout(detachDebugger(target), 2000, 'debugger.detach').catch(() => {});
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

async function captureAgentFrame({ allowDebugger = true } = {}) {
  if (captureInFlightPromise) {
    if (Date.now() - captureInFlightStartedAt > CAPTURE_STALE_LOCK_MS) {
      captureInFlightPromise = null;
      captureInFlightStartedAt = 0;
      emitAgentLog('Previous capture attempt became stale. Resetting capture lock.', true).catch(() => {});
    } else {
      return captureInFlightPromise;
    }
  }

  captureInFlightStartedAt = Date.now();
  captureInFlightPromise = (async () => {
    const tab = await getPreferredLinkedInTab();
    if (!tab) return null;

    const visibleCapture = await captureTabWindow(tab);
    if (visibleCapture) return visibleCapture;

    if (!allowDebugger) return null;

    // Fallback: capture directly from the target tab even when it is not the visible tab.
    return captureTabViaDebugger(tab.id);
  })();

  try {
    return await withTimeout(captureInFlightPromise, CAPTURE_FRAME_TIMEOUT_MS, 'captureAgentFrame');
  } finally {
    captureInFlightPromise = null;
    captureInFlightStartedAt = 0;
  }
}

async function pushDebugCaptureToTelegram({ reason = '', validationSummary = '', uploadToBackend = true } = {}) {
  const liveFrame = await captureAgentFrame({ allowDebugger: true });
  let source = 'live';
  let dataUrl = liveFrame;

  if (!dataUrl && lastCapturedAgentFrame) {
    dataUrl = lastCapturedAgentFrame;
    source = 'cached';
  }

  if (!dataUrl) {
    return { success: false, error: 'no_frame_available' };
  }

  const captureId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const capturePath = `memory://agent-captures/${captureId}-${source}.jpeg`;
  lastCapturedAgentFrame = dataUrl;
  lastCapturedAgentFrameAt = Date.now();

  let uploaded = false;
  if (uploadToBackend) {
    uploaded = await uploadFrameToEndpoint(dataUrl, '/agent/screenshot');
    await uploadFrameToEndpoint(dataUrl, '/agent/capture');
  }

  const details = [];
  const compactSummary = String(validationSummary || '')
    .replace(/[`*_{}\[\]()#+\-.!|>~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  if (reason) details.push(`reason=${reason}`);
  if (compactSummary) details.push(`errors=${compactSummary}`);
  const suffix = details.length ? ` | ${details.join(' | ')}` : '';

  const mode = uploadToBackend ? (uploaded ? 'sent' : 'captured') : 'captured-local';
  emitAgentLog(`Auto debug screenshot ${mode} (${source})${suffix}.`, uploadToBackend && !uploaded).catch(() => {});

  return {
    success: true,
    uploaded,
    source,
    imageDataUrl: dataUrl,
    capturePath,
  };
}

async function captureAndUploadFrame(trigger = 'interval') {
  try {
    const allowDebugger = trigger === 'manual' || trigger === 'debug';
    const dataUrl = await captureAgentFrame({ allowDebugger });

    if (!dataUrl) {
      const shouldNotifyNoFrame = trigger === 'manual' || trigger === 'debug';
      if (shouldNotifyNoFrame) {
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

function normalizeResumeToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenizeResumeQuery(searchQuery = '') {
  const stopWords = new Set([
    'and', 'with', 'for', 'the', 'from', 'this', 'that', 'role', 'job', 'jobs',
    'india', 'remote', 'hybrid', 'onsite', 'in', 'to', 'of', 'on', 'at',
  ]);
  return String(searchQuery || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !stopWords.has(t));
}

function buildResumeIntentProfile(searchQuery = '') {
  const query = String(searchQuery || '').toLowerCase();
  const queryTokens = tokenizeResumeQuery(query);

  if (/(product manager|product owner|\bproduct\b|\bpm\b)/i.test(query)) {
    return {
      role: 'product',
      queryTokens,
      requiredAnyTokens: ['product', 'pm'],
      positiveTokens: ['product', 'pm', 'manager', 'owner', 'roadmap', 'strategy'],
      disallowedTokens: [
        'sde', 'developer', 'engineer', 'software', 'frontend', 'front end', 'backend', 'back end', 'fullstack', 'full stack',
      ],
    };
  }

  if (/(data analyst|business analyst|\banalyst\b|analytics)/i.test(query)) {
    return {
      role: 'analyst',
      queryTokens,
      requiredAnyTokens: ['analyst', 'analytics', 'data'],
      positiveTokens: ['analyst', 'analytics', 'data', 'bi', 'reporting', 'sql'],
      disallowedTokens: ['product', 'pm', 'manager', 'sde', 'developer', 'engineer', 'software', 'frontend', 'backend'],
    };
  }

  if (/(software engineer|developer|\bsde\b|frontend|backend|fullstack|\bengineer\b)/i.test(query)) {
    return {
      role: 'engineering',
      queryTokens,
      requiredAnyTokens: [
        'engineer', 'engineering', 'developer', 'dev', 'sde', 'software',
        'frontend', 'front end', 'backend', 'back end', 'fullstack', 'full stack',
      ],
      positiveTokens: [
        'engineer', 'engineering', 'developer', 'dev', 'sde', 'software', 'programmer', 'coder',
        'frontend', 'front end', 'backend', 'back end', 'fullstack', 'full stack', 'web', 'application',
      ],
      disallowedTokens: ['product', 'pm', 'manager', 'analyst', 'analytics', 'data analyst', 'business analyst'],
    };
  }

  return {
    role: 'generic',
    queryTokens,
    requiredAnyTokens: queryTokens.filter((t) => t.length > 2).slice(0, 2),
    positiveTokens: queryTokens,
    disallowedTokens: [],
  };
}

function extractSearchQueryFromCommandText(commandText = '') {
  const raw = String(commandText || '').trim();
  if (!raw) return '';

  const match = raw.match(
    /(?:apply|start|begin|run)\s*(?:to|for)?\s*(.+?)(?:\s+\d+\s*jobs?)?(?:\s+based on.*)?$/i
  );
  if (!match?.[1]) return '';

  const cleaned = match[1]
    .replace(/\b(easy\s*apply|jobs?|based on|using|from|with|my|profile|resume|preferences?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || /^\d+$/.test(cleaned)) return '';
  return cleaned;
}

function countTokenHits(text, tokens = []) {
  const hay = normalizeResumeToken(text);
  if (!hay) return 0;
  let hits = 0;
  for (const token of tokens) {
    const normalizedToken = normalizeResumeToken(token);
    if (!normalizedToken) continue;
    if (hay.includes(normalizedToken)) hits += 1;
  }
  return hits;
}

function scoreResumeForQuery(resume, intentProfile) {
  const fileName = String(resume.file_name || '');
  const parsed = resume.parsed_data || {};
  const skills = Array.isArray(parsed.skills) ? parsed.skills.join(' ') : '';
  const titles = [parsed.title, parsed.headline, parsed.summary].filter(Boolean).join(' ');
  const combined = `${fileName} ${skills} ${titles}`.toLowerCase();

  const queryHits = countTokenHits(combined, intentProfile.queryTokens);
  const positiveHits = countTokenHits(combined, intentProfile.positiveTokens);
  const requiredHits = countTokenHits(combined, intentProfile.requiredAnyTokens);
  const negativeHits = countTokenHits(combined, intentProfile.disallowedTokens);

  let score = 0;
  score += queryHits * 2;
  score += positiveHits * 3;
  score += requiredHits * 5;
  score -= negativeHits * 5;

  // Strong guard for role-based mapping: required token missing should be costly.
  if (intentProfile.role !== 'generic' && intentProfile.requiredAnyTokens.length && requiredHits === 0) {
    score -= 8;
  }

  return {
    resume,
    fileName,
    score,
    queryHits,
    positiveHits,
    requiredHits,
    negativeHits,
  };
}

// Fetch resumes and return deterministic selection + confidence.
async function fetchAndSelectResume(searchQuery) {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) return { resume: null, confident: false, reason: 'not_authenticated', intentProfile: buildResumeIntentProfile(searchQuery) };

  const intentProfile = buildResumeIntentProfile(searchQuery);

  try {
    const res = await fetch(`${API_URL}/resume/all`, { headers });
    if (!res.ok) return { resume: null, confident: false, reason: 'resume_fetch_failed', intentProfile };
    const data = await res.json();
    const resumes = data?.data || [];
    if (!resumes.length) return { resume: null, confident: false, reason: 'no_resumes', intentProfile };
    if (resumes.length === 1) {
      return { resume: resumes[0], confident: true, reason: 'single_resume', intentProfile, bestScore: 100, margin: 100 };
    }

    const ranked = resumes
      .map((resume) => scoreResumeForQuery(resume, intentProfile))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const second = ranked[1] || null;
    const margin = second ? best.score - second.score : best.score;

    let confident = true;
    let reason = 'confident';

    if (best.score < RESUME_SELECT_MIN_SCORE) {
      confident = false;
      reason = `low_score:${best.score}`;
    } else if (margin < RESUME_SELECT_MIN_MARGIN) {
      confident = false;
      reason = `low_margin:${margin}`;
    } else if (intentProfile.role !== 'generic' && best.requiredHits === 0) {
      confident = false;
      reason = 'required_tokens_missing';
    } else if (best.negativeHits > 0 && best.requiredHits === 0) {
      confident = false;
      reason = 'negative_tokens_detected';
    }

    return {
      resume: confident ? best.resume : null,
      candidate: best.resume,
      confident,
      reason,
      bestScore: best.score,
      margin,
      intentProfile,
      diagnostics: {
        bestFile: best.fileName,
        bestRequiredHits: best.requiredHits,
        bestNegativeHits: best.negativeHits,
      },
    };
  } catch {
    return { resume: null, confident: false, reason: 'resume_select_exception', intentProfile };
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
      const resumeSelection = await fetchAndSelectResume(searchQuery);
      if (resumeSelection?.confident && resumeSelection?.resume) {
        emitAgentLog(`Resume selected for "${searchQuery}": ${resumeSelection.resume.file_name} (score=${resumeSelection.bestScore}, margin=${resumeSelection.margin})`).catch(() => {});
      } else if (resumeSelection?.candidate) {
        emitAgentLog(
          `Resume selection low-confidence for "${searchQuery}" (${resumeSelection.reason}). Candidate was "${resumeSelection.candidate.file_name}". Submit will be blocked unless intent matches.`,
          true
        ).catch(() => {});
      }

      startAgent({
        ...message.config,
        taskId,
        source: message.config?.source || 'extension',
        channel: message.config?.channel || 'extension_popup',
        selectedResume: resumeSelection?.resume || null,
        resumeIntentTokens: resumeSelection?.intentProfile?.requiredAnyTokens || [],
        resumeDisallowedTokens: resumeSelection?.intentProfile?.disallowedTokens || [],
        resumeSelectionConfident: Boolean(resumeSelection?.confident),
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
  } else if (message.action === 'agent_debug_capture') {
    (async () => {
      const result = await pushDebugCaptureToTelegram({
        reason: String(message.reason || ''),
        validationSummary: String(message.validationSummary || ''),
        uploadToBackend: message.upload !== false,
      });
      sendResponse(result);
    })().catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (message.action === 'agent_log') {
    if (message._fromServiceWorker) {
      // Prevent recursive self-relay loops from runtime broadcast.
      return false;
    }
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
    const payloadCommandText = String(cmd.payload?.commandText || '').trim();
    const payloadSearchQuery = String(cmd.payload?.searchQuery || '').trim();
    const parsedSearchQuery = extractSearchQueryFromCommandText(payloadCommandText);
    const searchQuery = payloadSearchQuery || parsedSearchQuery || [roles[0] || 'Software Engineer', locations[0] || ''].filter(Boolean).join(' ');

    const config = {
      provider: cmd.payload?.provider || settings.llm_provider || 'gemini',
      apiKey: cmd.payload?.apiKey || settings.llm_api_key || '',
      model: cmd.payload?.model || settings.llm_model || 'gemini-3.1-flash-lite-preview',
      baseUrl: cmd.payload?.baseUrl || settings.llm_base_url || '',
      searchQuery,
      count: Number(cmd.payload?.count) > 0 ? Number(cmd.payload.count) : 10,
      taskId: cmd.payload?.taskId || null,
      source: 'frontend',
      channel: 'dashboard_chat',
      agentSessionId: cmd.id,
    };

    const resumeSelection = await fetchAndSelectResume(searchQuery);
    if (resumeSelection?.resume) {
      config.selectedResume = resumeSelection.resume;
      emitAgentLog(`Resume selected for "${searchQuery}": ${resumeSelection.resume.file_name} (score=${resumeSelection.bestScore}, margin=${resumeSelection.margin})`).catch(() => {});
    } else if (resumeSelection?.candidate) {
      emitAgentLog(
        `Resume selection low-confidence for "${searchQuery}" (${resumeSelection.reason}). Candidate was "${resumeSelection.candidate.file_name}". Submit will be blocked unless intent matches.`,
        true
      ).catch(() => {});
    }
    config.resumeIntentTokens = resumeSelection?.intentProfile?.requiredAnyTokens || [];
    config.resumeDisallowedTokens = resumeSelection?.intentProfile?.disallowedTokens || [];
    config.resumeSelectionConfident = Boolean(resumeSelection?.confident);

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

      const resumeSelection = await fetchAndSelectResume(config.searchQuery);
      if (resumeSelection?.resume) {
        config.selectedResume = resumeSelection.resume;
        emitAgentLog(`Resume selected for "${config.searchQuery}": ${resumeSelection.resume.file_name} (score=${resumeSelection.bestScore}, margin=${resumeSelection.margin})`).catch(() => {});
      } else if (resumeSelection?.candidate) {
        emitAgentLog(
          `Resume selection low-confidence for "${config.searchQuery}" (${resumeSelection.reason}). Candidate was "${resumeSelection.candidate.file_name}". Submit will be blocked unless intent matches.`,
          true
        ).catch(() => {});
      }
      config.resumeIntentTokens = resumeSelection?.intentProfile?.requiredAnyTokens || [];
      config.resumeDisallowedTokens = resumeSelection?.intentProfile?.disallowedTokens || [];
      config.resumeSelectionConfident = Boolean(resumeSelection?.confident);

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
        const liveFrame = await captureAgentFrame({ allowDebugger: true });
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
