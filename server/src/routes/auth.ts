import { Router } from 'express';
import { supabase, upsertUser } from '../lib/supabase.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

// ─── Google OAuth: redirect to Google via Supabase ───────────────────────────
router.get('/google', async (_req, res) => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${process.env.APP_URL}/auth/callback`,
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
  const code = req.query.code as string;

  if (!code) {
    return res.status(400).send('Missing OAuth code');
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
  } catch (e) {
    console.error('Failed to upsert user in DB:', e);
  }

  // Redirect back to extension or return token in URL hash
  const redirectUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/auth/success#token=${session.access_token}`;
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
