import { Router, Response, NextFunction } from 'express';
import { Application } from '../models/Application.js';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

// List applications
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;

    const [applications, total] = await Promise.all([
      Application.find({ userId: req.userId })
        .populate('jobId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize),
      Application.countDocuments({ userId: req.userId }),
    ]);

    // Map to match expected shape (job instead of jobId)
    const items = applications.map((app) => {
      const obj = app.toObject();
      return { ...obj, id: obj._id, job: obj.jobId, jobId: undefined };
    });

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
    const application = await Application.findById(req.params.id).populate('jobId');

    if (!application || application.userId.toString() !== req.userId) {
      throw createError('Application not found', 404);
    }

    const obj = application.toObject();
    res.json({ success: true, data: { ...obj, id: obj._id, job: obj.jobId } });
  } catch (error) {
    next(error);
  }
});

export default router;
