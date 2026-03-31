import { Router, Request, Response } from 'express';
import { handleTelegramWebhookUpdate, registerTelegramWebhook } from '../lib/telegram.js';

const router = Router();

function isAuthorizedWebhook(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected) return true;
  const received = String(req.headers['x-telegram-bot-api-secret-token'] || '').trim();
  return received === expected;
}

function isAdminRequest(req: Request) {
  const adminKey = process.env.TELEGRAM_WEBHOOK_ADMIN_KEY?.trim();
  if (!adminKey) return false;
  const headerKey = String(req.headers['x-admin-key'] || '').trim();
  return headerKey === adminKey;
}

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    if (!isAuthorizedWebhook(req)) {
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }

    await handleTelegramWebhookUpdate(req.body as any);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Telegram webhook processing failed:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'webhook_processing_failed',
    });
  }
});

router.post('/webhook/register', async (req: Request, res: Response) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const appUrl = String(req.body?.appUrl || '').trim() || undefined;
    const result = await registerTelegramWebhook(appUrl);
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    console.error('Telegram webhook register failed:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'webhook_register_failed',
    });
  }
});

router.get('/webhook/health', (_req: Request, res: Response) => {
  const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const mode = process.env.TELEGRAM_BOT_MODE?.trim() || 'polling';
  return res.status(200).json({
    success: true,
    data: {
      configured,
      mode,
      path: process.env.TELEGRAM_WEBHOOK_PATH?.trim() || '/telegram/webhook',
    },
  });
});

export default router;
