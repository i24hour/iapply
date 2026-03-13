// API routes for the Chrome Extension ↔ Telegram Bot bridge
// These are UNAUTHENTICATED for local dev simplicity
import { Router, Request, Response } from 'express';
import { getPendingCommand, completeCommand, addLog, setAgentStatus } from '../lib/agent-commands.js';

const router = Router();

// Extension polls this every 5 seconds to get new commands from Telegram
router.get('/poll', (_req: Request, res: Response) => {
  const cmd = getPendingCommand();
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
router.post('/complete/:id', (req: Request, res: Response) => {
  const ok = completeCommand(req.params.id);
  res.json({ success: ok });
});

// Extension sends live logs here → forwarded to Telegram via listener
router.post('/log', (req: Request, res: Response) => {
  const { message, isError } = req.body;
  if (message) {
    addLog(message, !!isError);
  }
  res.json({ success: true });
});

// Extension reports its status
router.post('/status', (req: Request, res: Response) => {
  const { status } = req.body;
  if (status) {
    setAgentStatus(status);
  }
  res.json({ success: true });
});

export default router;
