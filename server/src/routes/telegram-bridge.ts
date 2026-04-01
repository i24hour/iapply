// API routes for the Chrome Extension ↔ Telegram Bot bridge
// All routes now require a valid Supabase JWT token
import { Router, Request, Response, NextFunction } from 'express';
import { getPendingCommand, completeCommand, addLog, setAgentStatus, getRecentLogs, pushCommand, setRecordingStatus, getRecordingStatus } from '../lib/agent-commands.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import fs from 'fs';
import path from 'path';

const router = Router();
const CAPTURE_RETENTION = 120;

type AgentCapture = {
  id: string;
  url: string;
  createdAt: string;
};

const captureStore = new Map<string, AgentCapture[]>();

function addCapture(userId: string, capture: AgentCapture) {
  const existing = captureStore.get(userId) || [];
  existing.push(capture);
  if (existing.length > CAPTURE_RETENTION) {
    existing.splice(0, existing.length - CAPTURE_RETENTION);
  }
  captureStore.set(userId, existing);
}

function getRecentCaptures(userId: string, limit: number) {
  const existing = captureStore.get(userId) || [];
  return existing.slice(-limit).reverse();
}

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

router.post('/request-screenshot', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const command = pushCommand({
    userId: req.userId,
    type: 'request_screenshot',
    payload: {},
  });

  return res.json({ success: true, data: { commandId: command.id } });
});

router.post('/manual-click', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const targetText = String(req.body?.targetText || '').trim();
  if (!targetText) {
    return res.status(400).json({ success: false, error: 'targetText is required' });
  }

  const command = pushCommand({
    userId: req.userId,
    type: 'manual_click',
    payload: { targetText: targetText.slice(0, 120) },
  });

  return res.json({ success: true, data: { commandId: command.id } });
});

router.post('/start-recording', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const command = pushCommand({
    userId: req.userId,
    type: 'start_recording',
    payload: {},
  });

  return res.json({ success: true, data: { commandId: command.id } });
});

router.post('/stop-recording', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const command = pushCommand({
    userId: req.userId,
    type: 'stop_recording',
    payload: {},
  });

  return res.json({ success: true, data: { commandId: command.id } });
});

router.post('/recording-status', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  setRecordingStatus(req.userId, Boolean(req.body?.active));
  return res.json({ success: true });
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

// Extension uploads periodic recording frames here.
router.post('/capture', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const { screenshotBase64 } = req.body;
  if (!screenshotBase64) {
    return res.status(400).json({ success: false, error: 'Missing screenshotBase64' });
  }

  try {
    const capturesDir = path.join(process.cwd(), 'uploads', 'agent-captures');
    if (!fs.existsSync(capturesDir)) {
      fs.mkdirSync(capturesDir, { recursive: true });
    }

    const base64Data = String(screenshotBase64).replace(/^data:image\/\w+;base64,/, '');
    const filename = `${req.userId}-${Date.now()}.jpg`;
    const filepath = path.join(capturesDir, filename);
    fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));

    const capture: AgentCapture = {
      id: filename,
      url: `/uploads/agent-captures/${filename}`,
      createdAt: new Date().toISOString(),
    };
    addCapture(req.userId, capture);

    return res.json({ success: true, data: capture });
  } catch (error) {
    console.error('Failed to persist capture frame:', error);
    return res.status(500).json({ success: false, error: 'Failed to persist capture frame' });
  }
});

// Frontend polls this endpoint to show extension logs and visual progress in chat.
router.get('/live', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const logsLimit = Math.min(Math.max(Number(req.query.logs || 30), 1), 100);
  const screenshotsLimit = Math.min(Math.max(Number(req.query.screenshots || 3), 1), 20);
  const recordingsLimit = Math.min(Math.max(Number(req.query.recordings || 12), 1), 60);

  const logs = getRecentLogs(req.userId, logsLimit).map((log) => ({
    timestamp: log.timestamp.toISOString(),
    message: log.message,
    isError: log.isError,
  }));

  const { data: screenshots } = await supabase
    .from('applications')
    .select('id, screenshot_url, applied_at, created_at')
    .eq('user_id', req.userId)
    .not('screenshot_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(screenshotsLimit);

  return res.json({
    success: true,
    data: {
      logs,
      recordingActive: getRecordingStatus(req.userId),
      recordings: getRecentCaptures(req.userId, recordingsLimit),
      screenshots: (screenshots || []).map((item: any) => ({
        id: item.id,
        url: item.screenshot_url,
        createdAt: item.applied_at || item.created_at,
      })),
    },
  });
});

export default router;
