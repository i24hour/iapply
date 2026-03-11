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
import { connectDB } from './lib/mongodb.js';
import { errorHandler } from './middleware/error-handler.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import resumeRouter from './routes/resume.js';
import preferencesRouter from './routes/preferences.js';
import automationRouter from './routes/automation.js';
import applicationsRouter from './routes/applications.js';
import extensionRouter from './routes/extension.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

app.use('/auth', authRouter);
app.use('/profile', profileRouter);
app.use('/resume', resumeRouter);
app.use('/preferences', preferencesRouter);
app.use('/automation', automationRouter);
app.use('/applications', applicationsRouter);
app.use('/extension', extensionRouter);

app.use(errorHandler);

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
