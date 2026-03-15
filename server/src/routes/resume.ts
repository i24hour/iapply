import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

// Configure multer for file uploads
const uploadDir = path.join(process.cwd(), 'uploads', 'resumes');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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

      const fileUrl = `/uploads/resumes/${req.file.filename}`;

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

export default router;