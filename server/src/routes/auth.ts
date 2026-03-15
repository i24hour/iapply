import { Router } from 'express';
import { supabase, upsertUser } from '../lib/supabase.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

function isRenderRequestHost(host?: string) {
  return !!host && host.includes('onrender.com');
}

function getAppUrl(host?: string) {
  const configured = process.env.APP_URL?.trim();
  const onRender = isRenderRequestHost(host);
  if (configured && !(onRender && configured.includes('localhost'))) {
    return configured;
  }
  if (onRender) return 'https://iapply-telegram-bot.onrender.com';
  return process.env.NODE_ENV === 'production'
    ? 'https://iapply-telegram-bot.onrender.com'
    : 'http://localhost:3001';
}

function getClientUrl(host?: string) {
  const configured = process.env.CLIENT_URL?.trim();
  const onRender = isRenderRequestHost(host);
  if (configured && !(onRender && configured.includes('localhost'))) {
    return configured;
  }
  if (onRender) return 'https://iapply.onrender.com';
  return process.env.NODE_ENV === 'production'
    ? 'https://iapply.onrender.com'
    : 'http://localhost:3000';
}

function getBotUsername() {
  return (process.env.TELEGRAM_BOT_USERNAME || 'infiniteapplybot').replace('@', '');
}

function getTelegramReturnLinks() {
  const botUsername = getBotUsername();
  return {
    botUsername,
    tgDeepLink: `tg://resolve?domain=${botUsername}&start=success`,
    webBotLink: `https://t.me/${botUsername}?start=success`,
  };
}

// ─── Google OAuth: redirect to Google via Supabase ───────────────────────────
router.get('/google', async (req, res) => {
  const requestHost = (req.headers['x-forwarded-host'] as string) || req.get('host') || '';
  const telegramId = req.query.telegram_id as string;
  const isTelegramAuth = !!telegramId;
  console.log('[auth/google]', { requestHost, telegramId, isTelegramAuth });
  if (telegramId) {
    res.cookie('telegram_auth_id', telegramId, { maxAge: 10 * 60 * 1000, httpOnly: true, secure: true, sameSite: 'none' });
  }

  const redirectTarget = isTelegramAuth
    ? `${getAppUrl(requestHost)}/auth/callback?telegram_id=${encodeURIComponent(telegramId)}`
    : `${getClientUrl(requestHost)}/auth/success`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTarget,
      scopes: 'openid email profile',
    },
  });

  if (error || !data?.url) {
    return res.status(500).json({ success: false, error: 'Failed to start Google OAuth' });
  }

  res.redirect(data.url);
});

// ─── Google OAuth: callback from Google ──────────────────────────────────────
router.get('/callback', async (req, res) => {
  const requestHost = (req.headers['x-forwarded-host'] as string) || req.get('host') || '';
  const code = req.query.code as string;
  const oauthError = req.query.error as string | undefined;
  const oauthErrorDescription = req.query.error_description as string | undefined;
  const telegramId = (req.query.telegram_id as string | undefined) || req.cookies.telegram_auth_id;
  console.log('[auth/callback]', {
    requestHost,
    telegramIdFromQuery: req.query.telegram_id,
    telegramIdFromCookie: req.cookies.telegram_auth_id,
    resolvedTelegramId: telegramId,
    hasCode: !!code,
    oauthError,
  });

  if (!code) {
    const loginUrl = `${getClientUrl(requestHost)}/login`;
    const telegramParam = telegramId ? `&telegram_id=${encodeURIComponent(telegramId)}` : '';
    if (oauthError) {
      const query = new URLSearchParams({ oauth: 'failed', reason: oauthError });
      if (oauthErrorDescription) query.set('message', oauthErrorDescription);
      return res.redirect(`${loginUrl}?${query.toString()}${telegramParam}`);
    }
    return res.redirect(`${loginUrl}?oauth=retry${telegramParam}`);
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.session) {
    return res.status(401).send('OAuth exchange failed: ' + error?.message);
  }

  const { session, user } = data;

  // Upsert the user in our public.users table
  try {
    await upsertUser({
      id: user.id,
      email: user.email!,
      full_name: user.user_metadata?.full_name,
      avatar_url: user.user_metadata?.avatar_url,
    });
    
    // Auto-link Telegram if we started the flow from there
    if (telegramId) {
      const { linkTelegramUser } = await import('../lib/supabase.js');
      await linkTelegramUser(user.id, parseInt(telegramId));
      const { refreshBotProfile } = await import('../lib/telegram.js');
      await refreshBotProfile();
    }
  } catch (e) {
    console.error('Failed to upsert user or link telegram in DB:', e);
  }

  if (telegramId) {
    if (req.cookies.telegram_auth_id) {
      res.clearCookie('telegram_auth_id');
    }
    const { botUsername } = getTelegramReturnLinks();
    const redirectUrl =
      `${getClientUrl(requestHost)}/auth/success?from=telegram&bot=${encodeURIComponent(botUsername)}` +
      `#access_token=${session.access_token}&refresh_token=${session.refresh_token}&token=${session.access_token}`;
    return res.redirect(redirectUrl);
  }

  // Redirect to frontend auth success page with session tokens in the URL hash
  const redirectUrl = `${getClientUrl(requestHost)}/auth/success#access_token=${session.access_token}&refresh_token=${session.refresh_token}&token=${session.access_token}`;
  console.log('[auth] OAuth callback host:', requestHost, 'redirecting to:', redirectUrl);
  res.redirect(redirectUrl);
});

// ─── GET /auth/me — get the currently logged-in user ─────────────────────────
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  res.json({
    success: true,
    data: {
      id: req.user.id,
      email: req.user.email,
      full_name: req.user.user_metadata?.full_name,
      avatar_url: req.user.user_metadata?.avatar_url,
    },
  });
});

router.post('/link-telegram', authenticate, async (req: AuthRequest, res) => {
  const telegramId = Number(req.body?.telegramId);

  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  if (!Number.isInteger(telegramId) || telegramId <= 0) {
    return res.status(400).json({ success: false, error: 'Valid telegramId is required' });
  }

  try {
    const { linkTelegramUser } = await import('../lib/supabase.js');
    await linkTelegramUser(req.userId, telegramId);
    const { refreshBotProfile } = await import('../lib/telegram.js');
    await refreshBotProfile();

    res.json({
      success: true,
      data: getTelegramReturnLinks(),
    });
  } catch (error) {
    console.error('Failed to link telegram user:', error);
    res.status(500).json({ success: false, error: 'Failed to link Telegram account' });
  }
});

// ─── POST /auth/verify — verify a token (used by extension) ──────────────────
router.post('/verify', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token' });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }

  res.json({ success: true, data: { id: data.user.id, email: data.user.email } });
});

export default router;
