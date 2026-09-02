import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { conflict, unauthorized } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const email = z.string().trim().toLowerCase().pipe(z.email());
const nonEmpty = z.string().trim().min(1);

const registerSchema = z.object({
  firstName: nonEmpty,
  lastName: nonEmpty,
  email,
  password: z.string().min(8),
  pfp: z.string().nullish().default(null),
  bio: z.string().trim().nullish().default(null),
  interests: z.array(nonEmpty).default([]),
});

const loginSchema = z.object({
  email,
  password: z.string(),
});

export const publicUser = (u) => ({
  _id: u._id,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  isAdmin: u.isAdmin,
  clubManagement: u.clubManagement,
  pfp: u.pfp,
  bio: u.bio,
  interests: u.interests,
  timeline: u.timeline,
});

router.post('/register', validate({ body: registerSchema }), async (req, res, next) => {
  const { firstName, lastName, email, password, pfp, bio, interests } = req.body;

  const users = getDb().collection('users');
  if (await users.findOne({ email })) {
    return next(conflict('email already registered'));
  }

  const user = {
    firstName,
    lastName,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    isAdmin: false,
    clubManagement: [],
    pfp,
    bio,
    interests,
    timeline: [],
    createdAt: new Date(),
  };
  user._id = (await users.insertOne(user)).insertedId;

  req.session.userId = user._id.toString();
  res.status(201).json(publicUser(user));
});

router.post('/login', validate({ body: loginSchema }), async (req, res, next) => {
  const { email, password } = req.body;
  const user = await getDb().collection('users').findOne({ email });

  if (!user || !(await bcrypt.compare(password, user.passwordHash ?? ''))) {
    return next(unauthorized('invalid credentials'));
  }

  req.session.userId = user._id.toString();
  res.json(publicUser(user));
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => (err ? next(err) : res.status(204).end()));
});

router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

export default router;
