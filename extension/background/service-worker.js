// Background service worker for Job Auto Apply extension

const API_URL = 'http://localhost:3001';
const POLL_INTERVAL = 5000;

let pollTimer = null;

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
  }
});

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
