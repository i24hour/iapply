import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AutomationCommand } from '../models/AutomationCommand.js';
import { Application } from '../models/Application.js';
import { JobPreferences } from '../models/JobPreferences.js';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

const startAutomationSchema = z.object({
  count: z.number().min(1).max(100).default(10),
});

// Get automation status
router.get('/status', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const activeCommand = await AutomationCommand.findOne({
      userId: req.userId,
      status: { $in: ['pending', 'in_progress'] },
    }).sort({ createdAt: -1 });

    const [applied, failed, total] = await Promise.all([
      Application.countDocuments({ userId: req.userId, status: 'applied' }),
      Application.countDocuments({ userId: req.userId, status: 'failed' }),
      Application.countDocuments({ userId: req.userId }),
    ]);

    res.json({
      success: true,
      data: {
        isRunning: !!activeCommand,
        currentAction: activeCommand?.action,
        jobsScraped: total,
        jobsApplied: applied,
        jobsFailed: failed,
        startedAt: activeCommand?.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Start automation
router.post('/start', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { count } = startAutomationSchema.parse(req.body);

    const activeCommand = await AutomationCommand.findOne({
      userId: req.userId,
      status: { $in: ['pending', 'in_progress'] },
    });

    if (activeCommand) {
      throw createError('Automation is already running', 400);
    }

    const preferences = await JobPreferences.findOne({ userId: req.userId });

    const command = await AutomationCommand.create({
      userId: req.userId!,
      action: 'scrape_jobs',
      payload: {
        count,
        roles: preferences?.roles || [],
        locations: preferences?.locations || [],
      },
      status: 'pending',
    });

    res.json({
      success: true,
      data: {
        commandId: command._id,
        message: `Started automation to apply to ${count} jobs`,
      },
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

// Pause automation
router.post('/pause', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await AutomationCommand.updateMany(
      { userId: req.userId, status: { $in: ['pending', 'in_progress'] } },
      { status: 'completed' }
    );

    res.json({ success: true, message: 'Automation paused' });
  } catch (error) {
    next(error);
  }
});

// Stop automation
router.post('/stop', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await AutomationCommand.updateMany(
      { userId: req.userId, status: { $in: ['pending', 'in_progress'] } },
      { status: 'completed' }
    );

    res.json({ success: true, message: 'Automation stopped' });
  } catch (error) {
    next(error);
  }
});

export default router;
