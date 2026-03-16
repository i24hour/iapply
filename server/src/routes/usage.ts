import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { createTaskRun, recordUsageEvent, updateTaskRunStatus } from '../lib/usage-tracking.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

const createTaskSchema = z.object({
  source: z.enum(['frontend', 'extension', 'telegram']),
  channel: z.string().min(1).max(100),
  commandText: z.string().min(1).max(500),
  agentSessionId: z.string().uuid().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

router.post('/tasks', authenticate, async (req: AuthRequest, res) => {
  if (!req.userId || !req.user?.email) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
    const payload = createTaskSchema.parse(req.body);
    const task = await createTaskRun({
      userId: req.userId,
      userEmail: req.user.email || '',
      source: payload.source,
      channel: payload.channel,
      commandText: payload.commandText,
      metadata: payload.metadata,
      agentSessionId: payload.agentSessionId,
    });

    if (!task) {
      return res.status(500).json({ success: false, error: 'Failed to create task run' });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors[0]?.message || 'Invalid payload' });
    }
    console.error('Failed to create usage task:', error);
    res.status(500).json({ success: false, error: 'Failed to create usage task' });
  }
});

const recordUsageSchema = z.object({
  taskId: z.string().uuid().optional().nullable(),
  source: z.enum(['frontend', 'extension', 'telegram']),
  channel: z.string().min(1).max(100),
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

router.post('/llm', authenticate, async (req: AuthRequest, res) => {
  if (!req.userId || !req.user?.email) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
    const payload = recordUsageSchema.parse(req.body);
    await recordUsageEvent({
      taskId: payload.taskId,
      userId: req.userId,
      userEmail: req.user.email || '',
      source: payload.source,
      channel: payload.channel,
      provider: payload.provider,
      model: payload.model,
      inputTokens: payload.inputTokens,
      outputTokens: payload.outputTokens,
      totalTokens: payload.totalTokens,
      metadata: payload.metadata,
    });

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors[0]?.message || 'Invalid payload' });
    }
    console.error('Failed to record LLM usage:', error);
    res.status(500).json({ success: false, error: 'Failed to record LLM usage' });
  }
});

const updateTaskStatusSchema = z.object({
  status: z.enum(['queued', 'running', 'completed', 'stopped', 'error']),
});

router.post('/tasks/:id/status', authenticate, async (req: AuthRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
    const payload = updateTaskStatusSchema.parse(req.body);
    await updateTaskRunStatus(req.params.id, req.userId, payload.status);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors[0]?.message || 'Invalid payload' });
    }
    console.error('Failed to update task status:', error);
    res.status(500).json({ success: false, error: 'Failed to update task status' });
  }
});

router.get('/tasks', authenticate, async (req: AuthRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

  try {
    const { data, error } = await supabase
      .from('task_runs')
      .select('*')
      .eq('user_id', req.userId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to list task runs:', error);
      return res.status(500).json({ success: false, error: 'Failed to load task usage' });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('Unexpected task listing error:', error);
    res.status(500).json({ success: false, error: 'Failed to load task usage' });
  }
});

export default router;
