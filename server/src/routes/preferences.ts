import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { db } from '../lib/mockData.js';

const router = Router();

const updatePreferencesSchema = z.object({
  roles: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),
  remoteOnly: z.boolean().optional(),
  minSalary: z.number().min(0).optional().nullable(),
  maxSalary: z.number().min(0).optional().nullable(),
  experienceLevel: z.enum(['entry', 'mid', 'senior', 'lead', 'any']).optional(),
  jobTypes: z.array(z.enum(['full-time', 'part-time', 'contract', 'internship'])).optional(),
});

// Get preferences
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const preferences = db.preferences.find((p) => p.userId === req.userId);

    if (!preferences) {
      return res.json({
        success: true,
        data: {
          userId: req.userId,
          roles: [],
          locations: [],
          remoteOnly: false,
          minSalary: null,
          maxSalary: null,
          experienceLevel: 'any',
          jobTypes: ['full-time'],
        },
      });
    }

    res.json({ success: true, data: preferences });
  } catch (error) {
    next(error);
  }
});

// Update preferences
router.put('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = updatePreferencesSchema.parse(req.body);

    const index = db.preferences.findIndex((p) => p.userId === req.userId);
    const now = new Date();

    if (index === -1) {
      const newPref = {
        _id: req.userId!,
        userId: req.userId!,
        roles: [],
        locations: [],
        remoteOnly: false,
        minSalary: null,
        maxSalary: null,
        experienceLevel: 'any',
        jobTypes: ['full-time'],
        ...data,
        createdAt: now,
        updatedAt: now,
      };
      db.preferences.push(newPref);
      return res.json({ success: true, data: newPref });
    }

    db.preferences[index] = { ...db.preferences[index], ...data, updatedAt: now };
    res.json({ success: true, data: db.preferences[index] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    next(error);
  }
});

export default router;
