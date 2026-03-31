import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middleware/error-handler.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import resumeRouter from './routes/resume.js';
import preferencesRouter from './routes/preferences.js';
import automationRouter from './routes/automation.js';
import applicationsRouter from './routes/applications.js';
import extensionRouter from './routes/extension.js';
import telegramBridgeRouter from './routes/telegram-bridge.js';
import usageRouter from './routes/usage.js';
import telegramWebhookRouter from './routes/telegram-webhook.js';
import { startTelegramBot } from './lib/telegram.js';
import { getUploadsRoot } from './lib/uploads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export function createApp() {
  const app = express();

  const configuredClientOrigin = String(process.env.CLIENT_URL || '').trim();
  const extraAllowedOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(
    [configuredClientOrigin, ...extraAllowedOrigins].filter((origin) => origin && origin !== '*')
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (configuredClientOrigin === '*' || allowedOrigins.has(origin)) return callback(null, true);
        if (/^chrome-extension:\/\//i.test(origin)) return callback(null, true);
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use('/uploads', express.static(getUploadsRoot()));

  app.use('/auth', authRouter);
  app.use('/profile', profileRouter);
  app.use('/resume', resumeRouter);
  app.use('/preferences', preferencesRouter);
  app.use('/automation', automationRouter);
  app.use('/applications', applicationsRouter);
  app.use('/extension', extensionRouter);
  app.use('/agent', telegramBridgeRouter);
  app.use('/usage', usageRouter);
  app.use('/telegram', telegramWebhookRouter);

  app.get('/', (_req, res) => {
    res.json({ status: 'ok', message: '🤖 iApply Backend is running!', uptime: process.uptime() });
  });

  app.use(errorHandler);

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (telegramToken) {
    const mode = process.env.TELEGRAM_BOT_MODE?.trim() === 'webhook' ? 'webhook' : 'polling';
    startTelegramBot(telegramToken, { mode });
  }

  return app;
}

export const app = createApp();
