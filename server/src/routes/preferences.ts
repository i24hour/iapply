import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

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
    const { data: preferences, error } = await supabase
      .from('job_preferences')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Supabase preferences error:', error);
        throw createError('Failed to fetch preferences', 500);
    }

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

    res.json({ 
        success: true, 
        data: {
            userId: preferences.user_id,
            roles: preferences.roles || [],
            locations: preferences.locations || [],
            remoteOnly: preferences.remote_only || false,
            minSalary: preferences.min_salary,
            maxSalary: preferences.max_salary,
            experienceLevel: preferences.experience_level || 'any',
            jobTypes: preferences.job_types || ['full-time'],
            createdAt: preferences.created_at,
            updatedAt: preferences.updated_at
        } 
    });
  } catch (error) {
    next(error);
  }
});

// Update preferences
router.put('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = updatePreferencesSchema.parse(req.body);
    const now = new Date().toISOString();

    const updateData: any = { user_id: req.userId, updated_at: now };
    if (data.roles !== undefined) updateData.roles = data.roles;
    if (data.locations !== undefined) updateData.locations = data.locations;
    if (data.remoteOnly !== undefined) updateData.remote_only = data.remoteOnly;
    if (data.minSalary !== undefined) updateData.min_salary = data.minSalary;
    if (data.maxSalary !== undefined) updateData.max_salary = data.maxSalary;
    if (data.experienceLevel !== undefined) updateData.experience_level = data.experienceLevel;
    if (data.jobTypes !== undefined) updateData.job_types = data.jobTypes;

    const { data: preferences, error } = await supabase
        .from('job_preferences')
        .upsert(updateData, { onConflict: 'user_id' })
        .select()
        .single();
        
    if (error) {
        console.error('Supabase preferences update error:', error);
        throw createError('Failed to update preferences', 500);
    }

    res.json({ 
        success: true, 
        data: {
            userId: preferences.user_id,
            roles: preferences.roles || [],
            locations: preferences.locations || [],
            remoteOnly: preferences.remote_only || false,
            minSalary: preferences.min_salary,
            maxSalary: preferences.max_salary,
            experienceLevel: preferences.experience_level || 'any',
            jobTypes: preferences.job_types || ['full-time'],
            createdAt: preferences.created_at,
            updatedAt: preferences.updated_at
        } 
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    next(error);
  }
});

export default router;
