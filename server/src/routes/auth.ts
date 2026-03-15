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

// ─── Google OAuth: redirect to Google via Supabase ───────────────────────────
router.get('/google', async (req, res) => {
  const requestHost = (req.headers['x-forwarded-host'] as string) || req.get('host') || '';
  const telegramId = req.query.telegram_id as string;
  const isTelegramAuth = !!telegramId;
  if (telegramId) {
    res.cookie('telegram_auth_id', telegramId, { maxAge: 10 * 60 * 1000, httpOnly: true, secure: true, sameSite: 'none' });
  }

  const redirectTarget = isTelegramAuth
    ? `${getAppUrl(requestHost)}/auth/callback`
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
  const telegramId = req.cookies.telegram_auth_id;

  if (!code) {
    const loginUrl = `${getClientUrl(requestHost)}/login`;
    if (oauthError) {
      const query = new URLSearchParams({ oauth: 'failed', reason: oauthError });
      if (oauthErrorDescription) query.set('message', oauthErrorDescription);
      return res.redirect(`${loginUrl}?${query.toString()}`);
    }
    return res.redirect(`${loginUrl}?oauth=retry`);
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
    }
  } catch (e) {
    console.error('Failed to upsert user or link telegram in DB:', e);
  }

  if (telegramId) {
    res.clearCookie('telegram_auth_id');
    const botUsername = (process.env.TELEGRAM_BOT_USERNAME || 'infiniteapplybot').replace('@', '');
    const tgDeepLink = `tg://resolve?domain=${botUsername}&start=success`;
    const webBotLink = `https://t.me/${botUsername}?start=success`;

    return res
      .status(200)
      .send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authentication Successful</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fb; margin: 0; }
      .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
      .card { max-width: 520px; width: 100%; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 28px; text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,.05); }
      h1 { margin: 0 0 12px; color: #111827; font-size: 28px; }
      p { margin: 0 0 20px; color: #4b5563; line-height: 1.5; }
      .btn { display: inline-block; padding: 12px 18px; border-radius: 10px; background: #2563eb; color: #fff; text-decoration: none; font-weight: 600; }
      .sub { margin-top: 12px; font-size: 13px; color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>✅ Verified Successfully</h1>
        <p>Your account is linked. Tap below to continue in Telegram bot.</p>
        <a class="btn" id="openBot" href="${webBotLink}">Go back to bot</a>
        <div class="sub">If Telegram does not open automatically, tap the button again.</div>
      </div>
    </div>
    <script>
      (function () {
        var opened = false;
        function openDeepLink() {
          if (opened) return;
          opened = true;
          window.location.href = '${tgDeepLink}';
          setTimeout(function () {
            window.location.href = '${webBotLink}';
          }, 900);
        }
        setTimeout(openDeepLink, 200);
        var btn = document.getElementById('openBot');
        if (btn) {
          btn.addEventListener('click', function () {
            opened = true;
          });
        }
      })();
    </script>
  </body>
</html>`);
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
