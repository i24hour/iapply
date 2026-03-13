import { startAgent, stopAgent, getAgentStatus } from './agent-core.js';

const API_URL = 'http://localhost:3001';
const POLL_INTERVAL = 5000;

let pollTimer = null;
let postAgentRunning = false;
let postAgentTabId = null;
let postAgentJobTitle = '';
let postAgentKeywords = '';

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

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start_polling') {
    startPolling();
    sendResponse({ success: true });
  } else if (message.action === 'stop_polling') {
    stopPolling();
    sendResponse({ success: true });
  } else if (message.action === 'get_auth') {
    getAuth().then(sendResponse);
    return true; // Keep channel open for async response
  } else if (message.action === 'start_agent') {
    startAgent(message.config);
    sendResponse({ success: true });
  } else if (message.action === 'stop_agent') {
    stopAgent();
    sendResponse({ success: true });
  } else if (message.action === 'get_agent_status') {
    sendResponse(getAgentStatus());
    return true;
  } else if (message.action === 'start_post_agent') {
    startPostAgent(message.jobTitle || '', message.keywords || '').then(() => sendResponse({ success: true })).catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.action === 'stop_post_agent') {
    stopPostAgent().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'get_post_agent_status') {
    sendResponse({ running: postAgentRunning, tabId: postAgentTabId, jobTitle: postAgentJobTitle, keywords: postAgentKeywords });
    return true;
  }
});

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
    chrome.runtime.sendMessage({ action: 'agent_log', message: `Post agent failed to start: ${error.message}`, isError: true }).catch(() => {});
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

// Auth helper
async function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['auth_token'], (result) => {
      resolve({ token: result.auth_token });
    });
  });
}

// Polling for commands
async function pollForCommands() {
  try {
    const auth = await getAuth();
    if (!auth.token) return;
    
    const response = await fetch(`${API_URL}/extension/commands`, {
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (data.success && data.data) {
      await executeCommand(data.data);
    }
  } catch (error) {
    console.error('Poll error:', error);
  }
}

// Execute automation command
async function executeCommand(command) {
  const { id, action, payload } = command;
  
  // Get active LinkedIn tab
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  
  if (tabs.length === 0) {
    console.log('No LinkedIn tab found');
    await completeCommand(id);
    return;
  }
  
  const tab = tabs[0];
  
  // Send command to content script
  chrome.tabs.sendMessage(tab.id, {
    action: action,
    payload: payload,
    commandId: id
  });
}

// Mark command as complete
async function completeCommand(commandId) {
  try {
    const auth = await getAuth();
    if (!auth.token) return;
    
    await fetch(`${API_URL}/extension/commands/${commandId}/complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Failed to complete command:', error);
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollForCommands, POLL_INTERVAL);
  pollForCommands(); // Poll immediately
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Start polling when extension loads
chrome.runtime.onStartup.addListener(() => {
  getAuth().then(auth => {
    if (auth.token) {
      startPolling();
    }
  });
});

// Listen for storage changes to start/stop polling
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.auth_token) {
    if (changes.auth_token.newValue) {
      startPolling();
    } else {
      stopPolling();
    }
  }
});
