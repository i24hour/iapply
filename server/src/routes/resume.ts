import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { Resume } from '../models/Resume.js';
import { Profile } from '../models/Profile.js';
import { createError } from '../middleware/error-handler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

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
    const resume = await Resume.findOne({ userId: req.userId }).sort({ uploadedAt: -1 });

    if (!resume) {
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

          await Profile.findOneAndUpdate(
            { userId: req.userId },
            {
              fullName: parsedData.fullName || 'User',
              phone: parsedData.phone,
              location: parsedData.location,
              skills: parsedData.skills || [],
              experienceYears: parsedData.experienceYears || 0,
              userId: req.userId,
            },
            { upsert: true, new: true }
          );
        }
      } catch (aiError) {
        console.error('AI service error:', aiError);
      }

      const resume = await Resume.create({
        userId: req.userId!,
        fileName: req.file.originalname,
        fileUrl,
        parsedData: parsedData || undefined,
      });

      res.status(201).json({ success: true, data: resume });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
