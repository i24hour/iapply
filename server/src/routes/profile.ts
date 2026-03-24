import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

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
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Supabase profile error:', error);
        throw createError('Failed to fetch profile', 500);
    }
    
    if (!profile) {
      throw createError('Profile not found', 404);
    }

    res.json({ 
      success: true, 
      data: {
        userId: profile.user_id,
        fullName: profile.full_name,
        phone: profile.phone,
        location: profile.location,
        skills: profile.skills || [],
        experienceYears: profile.experience_years || 0,
        preferredRoles: profile.preferred_roles || [],
        createdAt: profile.created_at,
        updatedAt: profile.updated_at
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update profile
router.put('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = updateProfileSchema.parse(req.body);

    const updateData: any = { user_id: req.userId, updated_at: new Date().toISOString() };
    if (data.fullName !== undefined) updateData.full_name = data.fullName;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.skills !== undefined) updateData.skills = data.skills;
    if (data.experienceYears !== undefined) updateData.experience_years = data.experienceYears;
    if (data.preferredRoles !== undefined) updateData.preferred_roles = data.preferredRoles;

    const { data: profile, error } = await supabase
      .from('profiles')
      .upsert(updateData, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
        console.error('Supabase profile update error:', error);
        throw createError('Failed to update profile', 500);
    }

    res.json({ 
      success: true, 
      data: {
        userId: profile.user_id,
        fullName: profile.full_name,
        phone: profile.phone,
        location: profile.location,
        skills: profile.skills || [],
        experienceYears: profile.experience_years || 0,
        preferredRoles: profile.preferred_roles || [],
        createdAt: profile.created_at,
        updatedAt: profile.updated_at
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
