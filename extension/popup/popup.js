// Elements
const elProvider = document.getElementById('provider');
const elApiKey = document.getElementById('apiKey');
const elModel = document.getElementById('model');
const elBaseUrl = document.getElementById('baseUrl');
const elSaveSettingsBtn = document.getElementById('saveSettingsBtn');

const elSearchQuery = document.getElementById('searchQuery');
const elStartAgentBtn = document.getElementById('startAgentBtn');
const elStopAgentBtn = document.getElementById('stopAgentBtn');
const elStatusDot = document.getElementById('statusDot');
const elStatusText = document.getElementById('statusText');
const elLogFeed = document.getElementById('logFeed');

const elAgentMode = document.getElementById('agentMode');
const elOutreachExtraFields = document.getElementById('outreachExtraFields');
const elJobTimeField = document.getElementById('jobTimeField');
const elPostTitle = document.getElementById('postTitle');
const elRelatedKeywords = document.getElementById('relatedKeywords');
const elOutreachEmail = document.getElementById('outreachEmail');
const elJobPostedTime = document.getElementById('jobPostedTime');

const elJobSearchField = document.getElementById('jobSearchField');

// Show/hide mode-specific fields
function syncModeLabel() {
  const isOutreach = elAgentMode.value === 'post_outreach';
  elJobSearchField.style.display = isOutreach ? 'none' : 'block';
  elOutreachExtraFields.style.display = isOutreach ? 'block' : 'none';
  elJobTimeField.style.display = isOutreach ? 'none' : 'block';
}
elAgentMode.addEventListener('change', syncModeLabel);

// Load saved settings
chrome.storage.local.get(['llm_provider', 'llm_api_key', 'llm_model', 'llm_base_url', 'search_query', 'agent_mode', 'post_title', 'related_keywords', 'outreach_email', 'job_posted_time'], (res) => {
  if (res.llm_provider) elProvider.value = res.llm_provider;
  if (res.llm_api_key) elApiKey.value = res.llm_api_key;
  if (res.llm_model) elModel.value = res.llm_model;
  if (res.llm_base_url) elBaseUrl.value = res.llm_base_url;
  if (res.search_query) elSearchQuery.value = res.search_query;
  if (res.agent_mode) elAgentMode.value = res.agent_mode;
  if (res.post_title) elPostTitle.value = res.post_title;
  if (res.related_keywords) elRelatedKeywords.value = res.related_keywords;
  if (res.outreach_email) elOutreachEmail.value = res.outreach_email;
  if (res.job_posted_time) elJobPostedTime.value = res.job_posted_time;
  syncModeLabel();

  // Replay logs when popup opens so user can keep monitoring until stop.
  chrome.runtime.sendMessage({ action: 'get_agent_logs' }, (resp) => {
    if (!resp || !Array.isArray(resp.logs)) return;
    elLogFeed.innerHTML = '';
    if (resp.logs.length === 0) {
      addLog('[System] Ready.');
      return;
    }
    resp.logs.forEach((entry) => {
      addLog(entry.message, entry.isError, entry.timestamp, true);
    });
  });
});

// Save settings
elSaveSettingsBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    llm_provider: elProvider.value,
    llm_api_key: elApiKey.value,
    llm_model: elModel.value,
    llm_base_url: elBaseUrl.value
  }, () => {
    elSaveSettingsBtn.textContent = "Saved!";
    setTimeout(() => elSaveSettingsBtn.textContent = "Save Settings", 1500);
  });
});

// Start Agent
elStartAgentBtn.addEventListener('click', () => {
  const config = {
    provider: elProvider.value,
    apiKey: elApiKey.value,
    model: elModel.value,
    baseUrl: elBaseUrl.value,
    searchQuery: elSearchQuery.value,
    mode: elAgentMode.value,
    postTitle: elPostTitle.value.trim(),
    relatedKeywords: elRelatedKeywords.value.trim(),
    outreachEmail: elOutreachEmail.value.trim(),
    jobPostedTime: elJobPostedTime.value
  };

  if (!config.apiKey || !config.apiKey.trim()) {
    addLog('ERROR: API key is required. Open LLM Configuration and paste a valid key.');
    elStatusText.textContent = 'Error';
    elStatusDot.classList.remove('active');
    return;
  }

  if (config.mode === 'post_outreach' && !config.postTitle && !config.relatedKeywords) {
    addLog('ERROR: In Post Outreach mode, enter at least Title or Keywords.');
    elStatusText.textContent = 'Error';
    elStatusDot.classList.remove('active');
    return;
  }

  chrome.storage.local.set({
    search_query: config.searchQuery,
    agent_mode: config.mode,
    post_title: config.postTitle,
    related_keywords: config.relatedKeywords,
    outreach_email: config.outreachEmail,
    job_posted_time: config.jobPostedTime
  });

  chrome.runtime.sendMessage({ action: 'start_agent', config }, (response) => {
    if (response && response.success) {
      elStartAgentBtn.style.display = 'none';
      elStopAgentBtn.style.display = 'block';
      elStatusDot.classList.add('active');
      elStatusText.textContent = 'Running';
      addLog('Agent started.');
    }
  });
});

// Stop Agent
elStopAgentBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stop_agent' }, (response) => {
    if (response && response.success) {
      elStartAgentBtn.style.display = 'block';
      elStopAgentBtn.style.display = 'none';
      elStatusDot.classList.remove('active');
      elStatusText.textContent = 'Idle';
      addLog('Agent stopped.');
    }
  });
});

// Helper for UI logging
function addLog(message, _isError = false, timestamp = null, skipPrefix = false) {
  const time = timestamp
    ? new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})
    : new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
  const div = document.createElement('div');
  div.className = 'log-entry';
  const text = skipPrefix ? message : `${message}`;
  div.innerHTML = `<span class="log-time">[${time}]</span> ${text}`;
  elLogFeed.appendChild(div);
  elLogFeed.scrollTop = elLogFeed.scrollHeight;
}

// Check background status on popup open
chrome.runtime.sendMessage({ action: 'get_agent_status' }, (status) => {
  if (status && status.state && status.state !== 'IDLE' && status.state !== 'DONE') {
    elStartAgentBtn.style.display = 'none';
    elStopAgentBtn.style.display = 'block';
    elStatusDot.classList.add('active');
    elStatusText.textContent = `Running (Step ${status.step})`;
    addLog(`Resumed monitoring log feed...`);
  }
});

// Listen for broadcasted logs from the background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'agent_log') {
    addLog(message.message, message.isError);
  } else if (message.action === 'agent_finished') {
    elStartAgentBtn.style.display = 'block';
    elStopAgentBtn.style.display = 'none';
    elStatusDot.classList.remove('active');
    elStatusText.textContent = 'Done';
    addLog('Agent finished its task.');
  } else if (message.action === 'agent_error') {
    elStartAgentBtn.style.display = 'block';
    elStopAgentBtn.style.display = 'none';
    elStatusDot.classList.remove('active');
    elStatusDot.style.background = '#ef4444';
    elStatusText.textContent = 'Error';
    addLog(`ERROR: ${message.error}`);
  } else if (message.action === 'agent_stopped') {
    elStartAgentBtn.style.display = 'block';
    elStopAgentBtn.style.display = 'none';
    elStatusDot.classList.remove('active');
    elStatusDot.style.background = '#9ca3af';
    elStatusText.textContent = 'Idle';
  }
});
