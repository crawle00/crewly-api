import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

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

const normalizeInterests = (interests) => {
  if (interests === undefined || interests === null) return [];
  if (!Array.isArray(interests)) return null;
  if (!interests.every((i) => typeof i === 'string')) return null;
  return interests.map((i) => i.trim()).filter(Boolean);
};

router.post('/register', async (req, res) => {
  const { firstName, lastName, email, password, pfp, bio, interests } = req.body ?? {};
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'firstName, lastName, email and password are required' });
  }
  if (pfp !== undefined && pfp !== null && typeof pfp !== 'string') {
    return res.status(400).json({ error: 'pfp must be a string' });
  }
  if (bio !== undefined && bio !== null && typeof bio !== 'string') {
    return res.status(400).json({ error: 'bio must be a string' });
  }

  const normalizedInterests = normalizeInterests(interests);
  if (normalizedInterests === null) {
    return res.status(400).json({ error: 'interests must be an array of strings' });
  }

  const users = getDb().collection('users');
  const normalizedEmail = String(email).trim().toLowerCase();
  if (await users.findOne({ email: normalizedEmail })) {
    return res.status(409).json({ error: 'email already registered' });
  }

  const user = {
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 10),
    isAdmin: false,
    clubManagement: [],
    pfp: pfp ?? null,
    bio: bio ? String(bio).trim() : null,
    interests: normalizedInterests,
    timeline: [],
    createdAt: new Date(),
  };
  user._id = (await users.insertOne(user)).insertedId;

  req.session.userId = user._id.toString();
  res.status(201).json(publicUser(user));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const user = await getDb().collection('users').findOne({ email: normalizedEmail });

  if (!user || !(await bcrypt.compare(password ?? '', user.passwordHash ?? ''))) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  req.session.userId = user._id.toString();
  res.json(publicUser(user));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.status(204).end());
});

router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

export default router;
