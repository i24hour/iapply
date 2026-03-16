import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { createTaskRun, stopOpenTasksForUser } from '../lib/usage-tracking.js';

const router = Router();

const startAutomationSchema = z.object({
  count: z.number().min(1).max(100).default(10),
  source: z.enum(['frontend', 'extension', 'telegram']).optional().default('frontend'),
  channel: z.string().min(1).max(100).optional().default('dashboard_chat'),
  commandText: z.string().min(1).max(500).optional(),
});

// Get automation status
router.get('/status', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { data: activeCommand } = await supabase
      .from('agent_sessions')
      .select('*')
      .eq('user_id', req.userId)
      .in('status', ['running', 'idle'])
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    const { count: applied } = await supabase.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', req.userId).eq('status', 'applied');
    const { count: failed } = await supabase.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', req.userId).eq('status', 'failed');
    const { count: total } = await supabase.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', req.userId);

    res.json({
      success: true,
      data: {
        isRunning: !!activeCommand,
        currentAction: activeCommand?.status === 'running' ? 'applying' : 'idle',
        jobsScraped: total || 0,
        jobsApplied: applied || 0,
        jobsFailed: failed || 0,
        startedAt: activeCommand?.started_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Start automation
router.post('/start', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { count, source, channel, commandText } = startAutomationSchema.parse(req.body);

    const { data: activeCommand } = await supabase
      .from('agent_sessions')
      .select('*')
      .eq('user_id', req.userId)
      .in('status', ['running', 'idle'])
      .limit(1)
      .single();

    if (activeCommand) {
      throw createError('Automation is already running', 400);
    }

    const { data: preferences } = await supabase.from('job_preferences').select('*').eq('user_id', req.userId).single();

    const searchQuery = JSON.stringify({
      count,
      roles: preferences?.roles || [],
      locations: preferences?.locations || []
    });

    const { data: command, error } = await supabase.from('agent_sessions').insert({
      user_id: req.userId,
      search_query: searchQuery,
      applications_count: count,
      status: 'idle',
    }).select().single();

    if (error) {
      console.error('Supabase error inserting agent_session:', error);
      throw createError('Failed to start automation', 500);
    }

    if (req.user?.email) {
      await createTaskRun({
        userId: req.userId!,
        userEmail: req.user.email,
        source,
        channel,
        commandText: commandText || `apply ${count} jobs`,
        agentSessionId: command?.id || null,
        metadata: {
          count,
          roles: preferences?.roles || [],
          locations: preferences?.locations || [],
        },
      });
    }

    res.json({
      success: true,
      data: {
        commandId: command?.id,
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
    await supabase
      .from('agent_sessions')
      .update({ status: 'stopped' })
      .eq('user_id', req.userId)
      .in('status', ['idle', 'running']);

    await stopOpenTasksForUser(req.userId!);

    res.json({ success: true, message: 'Automation paused' });
  } catch (error) {
    next(error);
  }
});

// Stop automation
router.post('/stop', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await supabase
      .from('agent_sessions')
      .update({ status: 'stopped' })
      .eq('user_id', req.userId)
      .in('status', ['idle', 'running']);

    await stopOpenTasksForUser(req.userId!);

    res.json({ success: true, message: 'Automation stopped' });
  } catch (error) {
    next(error);
  }
});

export default router;
