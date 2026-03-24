import { Router, Response, NextFunction } from 'express';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

// List applications
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    
    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;

    const { data: userApps, error, count } = await supabase
        .from('applications')
        .select('*', { count: 'exact' })
        .eq('user_id', req.userId)
        .order('created_at', { ascending: false })
        .range(start, end);

    if (error) {
        console.error('Supabase applications list error:', error);
        throw createError('Failed to fetch applications', 500);
    }

    const items = (userApps || []).map((app) => ({
      ...app,
      id: app.id,
      job: null,
    }));

    const total = count || 0;

    res.json({
      success: true,
      data: {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get application by ID
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { data: application, error } = await supabase
        .from('applications')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Supabase application error:', error);
        throw createError('Failed to fetch application', 500);
    }

    if (!application) {
      throw createError('Application not found', 404);
    }

    res.json({ success: true, data: { ...application, id: application.id, job: null } });
  } catch (error) {
    next(error);
  }
});

export default router;
