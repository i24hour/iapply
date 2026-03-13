import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { db } from '../lib/mockData.js';

const router = Router();

const updateProfileSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  skills: z.array(z.string()).optional(),
  experienceYears: z.number().min(0).max(50).optional(),
  preferredRoles: z.array(z.string()).optional(),
});

// Get profile
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const profile = db.profiles.find((p) => p.userId === req.userId);
    if (!profile) {
      throw createError('Profile not found', 404);
    }
    res.json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
});

// Update profile
router.put('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = updateProfileSchema.parse(req.body);

    const index = db.profiles.findIndex((p) => p.userId === req.userId);
    if (index === -1) {
      throw createError('Profile not found', 404);
    }

    db.profiles[index] = { ...db.profiles[index], ...data, updatedAt: new Date() };
    res.json({ success: true, data: db.profiles[index] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    next(error);
  }
});

export default router;
