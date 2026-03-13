import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Try loading .env from server/ directory (works from any cwd)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
// Also try cwd-relative path as fallback
dotenv.config({ path: path.resolve(process.cwd(), 'server', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import express from 'express';
import cors from 'cors';
// import { connectDB } from './lib/mongodb.js'; // disabled for local dev (no DB needed)
import { errorHandler } from './middleware/error-handler.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import resumeRouter from './routes/resume.js';
import preferencesRouter from './routes/preferences.js';
import automationRouter from './routes/automation.js';
import applicationsRouter from './routes/applications.js';
import extensionRouter from './routes/extension.js';
import telegramBridgeRouter from './routes/telegram-bridge.js';
import { startTelegramBot } from './lib/telegram.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

app.use('/auth', authRouter);
app.use('/profile', profileRouter);
app.use('/resume', resumeRouter);
app.use('/preferences', preferencesRouter);
app.use('/automation', automationRouter);
app.use('/applications', applicationsRouter);
app.use('/extension', extensionRouter);
app.use('/agent', telegramBridgeRouter);

app.use(errorHandler);

// Prevent unhandled promise rejections from crashing the server
process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});

async function start() {
  // await connectDB(); // disabled for local dev
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT} (in-memory mode)`);
    
    // Start Telegram bot if token is configured
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (telegramToken) {
      startTelegramBot(telegramToken);
    } else {
      console.log('ℹ️  Set TELEGRAM_BOT_TOKEN in .env to enable Telegram bot control.');
    }
  });
}

start().catch(console.error);
