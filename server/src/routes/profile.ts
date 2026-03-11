import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Profile } from '../models/Profile.js';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

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
    const profile = await Profile.findOne({ userId: req.userId });

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

    const profile = await Profile.findOneAndUpdate(
      { userId: req.userId },
      { ...data, userId: req.userId },
      { upsert: true, new: true, runValidators: true }
    );

    res.json({ success: true, data: profile });
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

export default router;
