const API_URL = 'https://iapply-telegram-bot.onrender.com';

const statusEl = document.getElementById('status');
const closeBtn = document.getElementById('closeBtn');

function setStatus(message, variant = '') {
  statusEl.textContent = message;
  statusEl.className = `status${variant ? ` ${variant}` : ''}`;
}

async function verifyAndStoreToken(token) {
  const response = await fetch(`${API_URL}/auth/verify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Token verification failed with status ${response.status}`);
  }

  const payload = await response.json();
  await chrome.storage.local.set({
    supabase_token: token,
    auth_user_email: payload?.data?.email || '',
    auth_user_id: payload?.data?.id || '',
  });

  await chrome.runtime.sendMessage({ action: 'set_token', token });
}

async function completeExtensionAuth() {
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const token = hashParams.get('access_token') || hashParams.get('token');

  if (!token) {
    setStatus('No token found. Please sign in again from the extension.', 'error');
    return;
  }

  try {
    setStatus('Verifying account...');
    await verifyAndStoreToken(token);
    setStatus('Extension connected successfully. You can now use the same account with the website, Telegram, and the extension.', 'success');
  } catch (error) {
    console.error('Extension auth callback failed:', error);
    setStatus('Could not connect the extension. Please try again.', 'error');
  }
}

closeBtn.addEventListener('click', () => {
  window.close();
});

completeExtensionAuth();
