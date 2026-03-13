import { Router, Response, NextFunction } from 'express';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { db } from '../lib/mockData.js';

const router = Router();

// List applications
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;

    const userApps = db.applications
      .filter((a) => a.userId === req.userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = userApps.length;
    const items = userApps.slice((page - 1) * pageSize, page * pageSize).map((app) => ({
      ...app,
      id: app._id,
      job: null, // no job data in mock
    }));

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
    const application = db.applications.find(
      (a) => a._id === req.params.id && a.userId === req.userId
    );

    if (!application) {
      throw createError('Application not found', 404);
    }

    res.json({ success: true, data: { ...application, id: application._id, job: null } });
  } catch (error) {
    next(error);
  }
});

export default router;
