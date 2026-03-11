import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { AutomationCommand } from '../models/AutomationCommand.js';
import { Job } from '../models/Job.js';
import { Application } from '../models/Application.js';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Get pending commands for extension
router.get('/commands', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const command = await AutomationCommand.findOne({
      userId: req.userId,
      status: 'pending',
    }).sort({ createdAt: 1 });

    if (!command) {
      return res.json({ success: true, data: null });
    }

    await AutomationCommand.updateOne({ _id: command._id }, { status: 'in_progress' });

    res.json({
      success: true,
      data: {
        id: command._id,
        action: command.action,
        payload: command.payload,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Update command status
router.post('/commands/:id/complete', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const command = await AutomationCommand.findById(req.params.id);

    if (!command || command.userId.toString() !== req.userId) {
      throw createError('Command not found', 404);
    }

    await AutomationCommand.updateOne({ _id: req.params.id }, { status: 'completed' });

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

    const createdJobs = await Promise.all(
      jobs.map(async (job) => {
        return Job.findOneAndUpdate(
          { platform: job.platform, externalId: job.externalId },
          job,
          { upsert: true, new: true }
        );
      })
    );

    // Create pending applications (skip duplicates)
    await Promise.all(
      createdJobs.map((job) =>
        Application.findOneAndUpdate(
          { userId: req.userId, jobId: job._id },
          { userId: req.userId, jobId: job._id, status: 'pending' },
          { upsert: true, new: true }
        ).catch(() => {})
      )
    );

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

    const result = await Application.updateMany(
      { userId: req.userId, jobId },
      {
        status: wasSuccessful ? 'applied' : 'failed',
        screenshotUrl,
        appliedAt: wasSuccessful ? new Date() : undefined,
        errorMessage,
      }
    );

    res.json({ success: true, data: { updated: result.modifiedCount } });
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
    const applications = await Application.find({
      userId: req.userId,
      status: 'pending',
    }).populate('jobId').limit(10);

    res.json({
      success: true,
      data: applications.map((app) => ({
        applicationId: app._id,
        job: app.jobId,
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
