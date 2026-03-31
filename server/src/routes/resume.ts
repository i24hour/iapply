import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { z } from 'zod';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { generateResumeDocx } from '../lib/resume-docx-generator.js';
import { loadResumeBinary, saveResumeBinary } from '../lib/resume-storage.js';
import { ensureUploadsSubdir, getUploadsPublicUrl } from '../lib/uploads.js';

const router = Router();

// Configure multer for file uploads
const uploadDir = ensureUploadsSubdir('resumes');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req: AuthRequest, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.userId}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and DOCX files are allowed'));
    }
  },
});

const generateResumeSchema = z.object({
  searchQuery: z.string().trim().min(1).max(180).optional(),
  jobTitle: z.string().trim().min(1).max(180).optional(),
  company: z.string().trim().min(1).max(180).optional(),
  jobDescription: z.string().trim().min(1).max(15000).optional(),
});

// Get all resumes for the user
router.get('/all', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { data: resumes, error } = await supabase
      .from('resumes')
      .select('*')
      .eq('user_id', req.userId)
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return next(error);
    }

    res.json({ success: true, data: resumes || [] });
  } catch (error) {
    next(error);
  }
});

// Get resume
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { data: resume, error } = await supabase
      .from('resumes')
      .select('*')
      .eq('user_id', req.userId)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Supabase error:', error);
    }

    if (!resume && !error) {
      throw createError('No resume found', 404);
    } else if (error && error.code === 'PGRST116') {
      throw createError('No resume found', 404);
    }

    res.json({ success: true, data: resume });
  } catch (error) {
    next(error);
  }
});

router.post('/generate', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) {
      throw createError('Not authenticated', 401);
    }

    const payload = generateResumeSchema.parse(req.body || {});

    const [profileResult, latestResumeResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('user_id', req.userId)
        .maybeSingle(),
      supabase
        .from('resumes')
        .select('*')
        .eq('user_id', req.userId)
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (profileResult.error) {
      console.error('Failed to load profile before resume generation:', profileResult.error);
      throw createError('Failed to load profile for resume generation', 500);
    }

    if (latestResumeResult.error) {
      console.error('Failed to load source resume before generation:', latestResumeResult.error);
      throw createError('Failed to load source resume for generation', 500);
    }

    const parsedData =
      latestResumeResult.data?.parsed_data && typeof latestResumeResult.data.parsed_data === 'object'
        ? latestResumeResult.data.parsed_data
        : null;

    const generated = await generateResumeDocx({
      userEmail: req.user?.email || '',
      profile: profileResult.data || null,
      latestParsedResume: parsedData,
      searchQuery: payload.searchQuery,
      jobTitle: payload.jobTitle,
      company: payload.company,
      jobDescription: payload.jobDescription,
    });

    const saved = await saveResumeBinary({
      userId: req.userId,
      fileName: generated.fileName,
      buffer: generated.buffer,
      contentType: generated.contentType,
    });

    const generatedMeta = {
      generated: true,
      generated_at: new Date().toISOString(),
      source_resume_id: latestResumeResult.data?.id || null,
      search_query: payload.searchQuery || null,
      job_title: payload.jobTitle || null,
      company: payload.company || null,
    };

    const { data: resumeRow, error: insertError } = await supabase
      .from('resumes')
      .insert({
        user_id: req.userId,
        file_name: saved.fileName,
        file_url: saved.fileUrl,
        parsed_data: {
          ...(parsedData || {}),
          _generated_meta: generatedMeta,
        },
      })
      .select()
      .single();

    if (insertError || !resumeRow) {
      console.error('Failed to persist generated resume row:', insertError);
      throw createError('Failed to save generated resume metadata', 500);
    }

    res.status(201).json({
      success: true,
      data: {
        resume: resumeRow,
        generated: {
          resumeId: resumeRow.id,
          fileName: saved.fileName,
          contentType: generated.contentType,
          fileBase64: generated.buffer.toString('base64'),
          storage: saved.storage,
          downloadPath: `/resume/${resumeRow.id}/file`,
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0]?.message || 'Invalid payload',
      });
    }
    next(error);
  }
});

// Upload resume
router.post(
  '/upload',
  authenticate,
  upload.single('resume'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw createError('No file uploaded', 400);
      }

      const fileUrl = getUploadsPublicUrl('resumes', req.file.filename);

      let parsedData = null;
      try {
        const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        const fileBuffer = fs.readFileSync(req.file.path);
        const base64 = fileBuffer.toString('base64');

        const response = await axios.post(`${aiServiceUrl}/parse-resume`, {
          fileBase64: base64,
          fileName: req.file.originalname,
        }, { timeout: 30000 });

        if (response.data.success) {
          parsedData = response.data.data;

          await supabase.from('profiles').upsert({
            user_id: req.userId,
            full_name: parsedData.fullName || 'User',
            phone: parsedData.phone,
            location: parsedData.location,
            skills: parsedData.skills || [],
            experience_years: parsedData.experienceYears || 0,
          }, { onConflict: 'user_id' });
        }
      } catch (aiError) {
        console.error('AI service error:', aiError);
      }

      const { data: resume, error } = await supabase.from('resumes').insert({
        user_id: req.userId,
        file_name: req.file.originalname,
        file_url: fileUrl,
        parsed_data: parsedData || null,
      }).select().single();

      if (error) {
        console.error('Supabase insert error:', error);
      }

      res.status(201).json({ success: true, data: resume || { id: 'temp', file_url: fileUrl } });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/:id/file', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) {
      throw createError('Not authenticated', 401);
    }

    const { data: resume, error } = await supabase
      .from('resumes')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .maybeSingle();

    if (error) {
      console.error('Failed to load resume for binary download:', error);
      throw createError('Failed to load resume file', 500);
    }

    if (!resume) {
      throw createError('Resume not found', 404);
    }

    const fallbackName = path.basename(String(resume.file_name || 'resume.docx')).replace(/"/g, '');
    const file = await loadResumeBinary(String(resume.file_url || ''), fallbackName);

    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fallbackName || file.fileName || 'resume.docx'}"`);
    res.send(file.buffer);
  } catch (error) {
    next(error);
  }
});

export default router;
