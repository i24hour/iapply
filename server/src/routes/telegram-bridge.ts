// API routes for the Chrome Extension ↔ Telegram Bot bridge
// All routes now require a valid Supabase JWT token
import { Router, Request, Response, NextFunction } from 'express';
import { getPendingCommand, completeCommand, addLog, setAgentStatus } from '../lib/agent-commands.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Extension polls this every 5 seconds to get new commands from Telegram
// JWT auth ensures only the real extension (belonging to the user) can poll
router.get('/poll', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const cmd = getPendingCommand(req.userId);
  if (!cmd) {
    return res.json({ success: true, command: null });
  }

  res.json({
    success: true,
    command: {
      id: cmd.id,
      type: cmd.type,
      payload: cmd.payload,
    },
  });
});

// Extension marks a command as complete
router.post('/complete/:id', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const ok = completeCommand(req.userId, req.params.id);
  res.json({ success: ok });
});

// Extension sends live logs here → forwarded to Telegram via listener
router.post('/log', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const { message, isError } = req.body;
  if (message) {
    addLog(req.userId, message, !!isError);
  }
  res.json({ success: true });
});

// Extension reports its status
router.post('/status', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const { status } = req.body;
  if (status) {
    setAgentStatus(req.userId, status);
  }
  res.json({ success: true });
});

// Extension posts a live screenshot requested from Telegram
router.post('/screenshot', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const { screenshotBase64 } = req.body;
  if (screenshotBase64) {
    try {
      const { sendTelegramPhoto } = await import('../lib/telegram.js');
      const base64Data = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      await sendTelegramPhoto(req.userId, buffer);
    } catch (e) {
      console.error('Failed to send screenshot to Telegram', e);
    }
  }
  res.json({ success: true });
});

export default router;
