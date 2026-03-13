// Elements
const elProvider = document.getElementById('provider');
const elApiKey = document.getElementById('apiKey');
const elModel = document.getElementById('model');
const elBaseUrl = document.getElementById('baseUrl');
const elSaveSettingsBtn = document.getElementById('saveSettingsBtn');

const elSearchQuery = document.getElementById('searchQuery');
const elPostTitleQuery = document.getElementById('postTitleQuery');
const elPostKeywords = document.getElementById('postKeywords');
const elJobTabBtn = document.getElementById('jobTabBtn');
const elPostTabBtn = document.getElementById('postTabBtn');
const elJobTabPanel = document.getElementById('jobTabPanel');
const elPostTabPanel = document.getElementById('postTabPanel');
const elStartAgentBtn = document.getElementById('startAgentBtn');
const elStopAgentBtn = document.getElementById('stopAgentBtn');
const elStartPostBtn = document.getElementById('startPostBtn');
const elStopPostBtn = document.getElementById('stopPostBtn');
const elStatusDot = document.getElementById('statusDot');
const elStatusText = document.getElementById('statusText');
const elLogFeed = document.getElementById('logFeed');

// Load saved settings
chrome.storage.local.get(['llm_provider', 'llm_api_key', 'llm_model', 'llm_base_url', 'search_query', 'post_title_query', 'post_keywords_query'], (res) => {
  if (res.llm_provider) elProvider.value = res.llm_provider;
  if (res.llm_api_key) elApiKey.value = res.llm_api_key;
  if (res.llm_model) elModel.value = res.llm_model;
  if (res.llm_base_url) elBaseUrl.value = res.llm_base_url;
  if (res.search_query) elSearchQuery.value = res.search_query;
  if (res.post_title_query) elPostTitleQuery.value = res.post_title_query;
  if (res.post_keywords_query) elPostKeywords.value = res.post_keywords_query;
});

function activateTab(tab) {
  const isJob = tab === 'job';
  elJobTabBtn.classList.toggle('active', isJob);
  elPostTabBtn.classList.toggle('active', !isJob);
  elJobTabPanel.classList.toggle('active', isJob);
  elPostTabPanel.classList.toggle('active', !isJob);
}

elJobTabBtn.addEventListener('click', () => activateTab('job'));
elPostTabBtn.addEventListener('click', () => activateTab('post'));

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
    searchQuery: elSearchQuery.value
  };

  chrome.storage.local.set({ search_query: config.searchQuery });

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

// Start Post Outreach
elStartPostBtn.addEventListener('click', () => {
  const jobTitle = (elPostTitleQuery.value || '').trim();
  const keywords = (elPostKeywords.value || '').trim();
  chrome.storage.local.set({ post_title_query: jobTitle, post_keywords_query: keywords });

  chrome.runtime.sendMessage({ action: 'start_post_agent', jobTitle, keywords }, (response) => {
    if (response && response.success) {
      elStartPostBtn.style.display = 'none';
      elStopPostBtn.style.display = 'block';
      elStatusDot.classList.add('active');
      elStatusText.textContent = 'Running Posts';
      addLog(`Post outreach started for: ${jobTitle || 'all titles'} | keywords: ${keywords || 'none'}`);
    }
  });
});

// Stop Post Outreach
elStopPostBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stop_post_agent' }, (response) => {
    if (response && response.success) {
      elStartPostBtn.style.display = 'block';
      elStopPostBtn.style.display = 'none';
      elStatusDot.classList.remove('active');
      elStatusText.textContent = 'Idle';
      addLog('Post outreach stopped.');
    }
  });
});

// Helper for UI logging
function addLog(message) {
  const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
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

chrome.runtime.sendMessage({ action: 'get_post_agent_status' }, (status) => {
  if (status && status.running) {
    elStartPostBtn.style.display = 'none';
    elStopPostBtn.style.display = 'block';
    elStatusDot.classList.add('active');
    elStatusText.textContent = 'Running Posts';
    addLog(`Post outreach active for: ${status.jobTitle || 'all titles'} | keywords: ${status.keywords || 'none'}`);
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
  } else if (message.action === 'post_agent_stopped') {
    elStartPostBtn.style.display = 'block';
    elStopPostBtn.style.display = 'none';
    elStatusDot.classList.remove('active');
    elStatusText.textContent = 'Idle';
    addLog('Post outreach stopped by user.');
  }
});
