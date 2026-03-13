import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { db, generateId } from '../lib/mockData.js';

const router = Router();

const signupSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/signup', async (req, res, next) => {
  try {
    const { fullName, email, password } = signupSchema.parse(req.body);

    const existing = db.users.find((u) => u.email === email);
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    const id = generateId();

    const user = { _id: id, id, email, passwordHash, createdAt: now, updatedAt: now };
    db.users.push(user);

    db.profiles.push({
      _id: generateId(),
      userId: id,
      fullName,
      skills: [],
      experienceYears: 0,
      preferredRoles: [],
      createdAt: now,
      updatedAt: now,
    });

    const token = jwt.sign({ userId: id }, process.env.JWT_SECRET || 'local-dev-secret', { expiresIn: '7d' });

    res.json({
      success: true,
      data: {
        user: { id, email, createdAt: now, updatedAt: now },
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = db.users.find((u) => u.email === email);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'local-dev-secret', { expiresIn: '7d' });

    res.json({
      success: true,
      data: {
        user: { id: user._id, email: user.email, createdAt: user.createdAt, updatedAt: user.updatedAt },
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = db.users.find((u) => u._id === req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      data: { id: user._id, email: user.email, createdAt: user.createdAt, updatedAt: user.updatedAt },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
