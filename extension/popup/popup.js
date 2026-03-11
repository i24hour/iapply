// Popup script for Job Auto Apply extension

const API_URL = 'http://localhost:3001';

// DOM Elements
const loginForm = document.getElementById('loginForm');
const dashboard = document.getElementById('dashboard');
const errorMessage = document.getElementById('errorMessage');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userEmail = document.getElementById('userEmail');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const jobsScraped = document.getElementById('jobsScraped');
const jobsApplied = document.getElementById('jobsApplied');

// State
let isRunning = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await getAuth();
  if (auth.token) {
    showDashboard(auth.email);
    fetchStatus();
  } else {
    showLogin();
  }
});

// Auth helpers
async function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['auth_token', 'user_email'], (result) => {
      resolve({
        token: result.auth_token,
        email: result.user_email
      });
    });
  });
}

async function setAuth(token, email) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ auth_token: token, user_email: email }, resolve);
  });
}

async function clearAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['auth_token', 'user_email'], resolve);
  });
}

// UI helpers
function showLogin() {
  loginForm.style.display = 'flex';
  dashboard.style.display = 'none';
  hideError();
}

function showDashboard(email) {
  loginForm.style.display = 'none';
  dashboard.style.display = 'block';
  userEmail.textContent = email;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
}

function hideError() {
  errorMessage.style.display = 'none';
}

function updateStatus(running, scraped = 0, applied = 0) {
  isRunning = running;
  statusDot.classList.toggle('active', running);
  statusText.textContent = running ? 'Running' : 'Idle';
  jobsScraped.textContent = scraped;
  jobsApplied.textContent = applied;
  startBtn.style.display = running ? 'none' : 'block';
  stopBtn.style.display = running ? 'block' : 'none';
}

// API calls
async function apiCall(endpoint, method = 'GET', body = null) {
  const auth = await getAuth();
  
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    }
  };
  
  if (auth.token) {
    options.headers['Authorization'] = `Bearer ${auth.token}`;
  }
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(`${API_URL}${endpoint}`, options);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  
  return data;
}

// Event handlers
loginBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  
  if (!email || !password) {
    showError('Please enter email and password');
    return;
  }
  
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in...';
  hideError();
  
  try {
    const response = await apiCall('/auth/login', 'POST', { email, password });
    await setAuth(response.data.token, response.data.user.email);
    showDashboard(response.data.user.email);
    fetchStatus();
  } catch (error) {
    showError(error.message);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
});

logoutBtn.addEventListener('click', async () => {
  await clearAuth();
  showLogin();
  emailInput.value = '';
  passwordInput.value = '';
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  
  try {
    // Send message to content script to start scraping
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('linkedin.com')) {
      showError('Please navigate to LinkedIn Jobs page first');
      startBtn.disabled = false;
      return;
    }
    
    // Start automation via backend
    await apiCall('/automation/start', 'POST', { count: 10 });
    
    // Notify content script
    chrome.tabs.sendMessage(tab.id, { action: 'start_scraping' });
    
    updateStatus(true);
  } catch (error) {
    showError(error.message);
  } finally {
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  
  try {
    await apiCall('/automation/stop', 'POST');
    updateStatus(false);
    
    // Notify content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'stop' });
    }
  } catch (error) {
    showError(error.message);
  } finally {
    stopBtn.disabled = false;
  }
});

// Fetch status
async function fetchStatus() {
  try {
    const response = await apiCall('/automation/status');
    updateStatus(
      response.data.isRunning,
      response.data.jobsScraped,
      response.data.jobsApplied
    );
  } catch (error) {
    console.error('Failed to fetch status:', error);
  }
}

// Poll for status updates
setInterval(fetchStatus, 5000);

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'status_update') {
    fetchStatus();
  }
});
