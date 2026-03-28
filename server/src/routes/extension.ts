import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { getTaskRunByAgentSession, updateTaskRunStatus } from '../lib/usage-tracking.js';

const router = Router();

function escapeTelegramMarkdown(value: string) {
  return String(value || '').replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Get pending commands for extension
router.get('/commands', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { data: command } = await supabase
      .from('agent_sessions')
      .select('*')
      .eq('user_id', req.userId)
      .eq('status', 'idle')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (!command) {
      return res.json({ success: true, data: null });
    }

    await supabase
      .from('agent_sessions')
      .update({ status: 'running' })
      .eq('id', command.id);

    const taskRun = await getTaskRunByAgentSession(command.id);

    res.json({
      success: true,
      data: {
        id: command.id,
        action: 'scrape_jobs',
        payload: {
          ...JSON.parse(command.search_query || '{}'),
          taskId: taskRun?.id || null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// Update command status
router.post('/commands/:id/complete', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { data: command, error } = await supabase
      .from('agent_sessions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!command || command.user_id !== req.userId) {
      throw createError('Command not found', 404);
    }

    await supabase
      .from('agent_sessions')
      .update({ status: 'stopped' })
      .eq('id', req.params.id);

    const taskRun = await getTaskRunByAgentSession(req.params.id);
    if (taskRun?.id) {
      await updateTaskRunStatus(taskRun.id, req.userId!, 'completed');
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

const submitJobsSchema = z.object({
  jobs: z.array(z.object({
    platform: z.string(),
    externalId: z.string(),
    company: z.string(),
    title: z.string(),
    description: z.string(),
    location: z.string(),
    url: z.string().url(),
    salary: z.string().optional(),
    isEasyApply: z.boolean().default(false),
  })),
});

// Submit scraped jobs
router.post('/jobs', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { jobs } = submitJobsSchema.parse(req.body);

    const createdJobs = [];

    for (const job of jobs) {
      const { data: upsertedJob, error } = await supabase
        .from('jobs')
        .upsert({
          platform: job.platform,
          external_id: job.externalId,
          company: job.company,
          title: job.title,
          description: job.description,
          location: job.location,
          url: job.url,
          salary: job.salary,
          is_easy_apply: job.isEasyApply
        }, { onConflict: 'platform,external_id' })
        .select()
        .single();
      
      if (upsertedJob) {
        createdJobs.push(upsertedJob);
      }
    }

    // Create pending applications (skip duplicates)
    for (const job of createdJobs) {
      await supabase
        .from('applications')
        .upsert({
          user_id: req.userId,
          job_id: job.id,
          status: 'pending'
        }, { onConflict: 'user_id,job_id', ignoreDuplicates: true });
    }

    res.json({
      success: true,
      data: { jobsCreated: createdJobs.length },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0].message,
      });
    }
    next(error);
  }
});

const submitApplicationSchema = z.object({
  jobId: z.string(),
  success: z.boolean(),
  screenshotBase64: z.string().optional(),
  errorMessage: z.string().optional(),
});

// Submit application result
router.post('/application', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { jobId, success: wasSuccessful, screenshotBase64, errorMessage } = submitApplicationSchema.parse(req.body);

    let screenshotUrl: string | undefined;

    if (screenshotBase64) {
      const screenshotsDir = path.join(process.cwd(), 'uploads', 'screenshots');
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }

      const filename = `${req.userId}-${jobId}-${Date.now()}.png`;
      const filepath = path.join(screenshotsDir, filename);
      const buffer = Buffer.from(screenshotBase64, 'base64');
      fs.writeFileSync(filepath, buffer);
      screenshotUrl = `/uploads/screenshots/${filename}`;
    }

    const { data: result, error } = await supabase
      .from('applications')
      .update({
        status: wasSuccessful ? 'applied' : 'failed',
        screenshot_url: screenshotUrl,
        applied_at: wasSuccessful ? new Date().toISOString() : null,
        error_message: errorMessage,
      })
      .eq('user_id', req.userId)
      .eq('job_id', jobId)
      .select();

    if (wasSuccessful && req.userId) {
      try {
        const { data: job } = await supabase
          .from('jobs')
          .select('company,title')
          .eq('id', jobId)
          .maybeSingle();

        const company = escapeTelegramMarkdown(job?.company || 'Unknown Company');
        const title = escapeTelegramMarkdown(job?.title || 'Unknown Role');
        const { sendTelegramMessage } = await import('../lib/telegram.js');
        await sendTelegramMessage(req.userId, `✅ Applied to *${company}* \\- *${title}*`);
      } catch (notifyError) {
        console.error('Failed to send per-application Telegram update:', notifyError);
      }
    }

    res.json({ success: true, data: { updated: result?.length || 0 } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0].message,
      });
    }
    next(error);
  }
});

// Get pending jobs to apply
router.get('/jobs/pending', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { data: applications } = await supabase
      .from('applications')
      .select('*, jobs(*)')
      .eq('user_id', req.userId)
      .eq('status', 'pending')
      .limit(10);

    res.json({
      success: true,
      data: (applications || []).map((app: any) => ({
        applicationId: app.id,
        job: app.jobs,
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
