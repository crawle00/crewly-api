import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const publicUser = (u) => ({
  _id: u._id, name: u.name, email: u.email, orgId: u.orgId, role: u.role,
});

router.post('/register', async (req, res) => {
  const { name, email, password, orgId } = req.body ?? {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }

  const users = getDb().collection('users');
  if (await users.findOne({ email })) {
    return res.status(409).json({ error: 'email already registered' });
  }

  const user = {
    name,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    orgId: orgId || 'default',
    role: 'member',
    createdAt: new Date(),
  };
  user._id = (await users.insertOne(user)).insertedId;

  req.session.userId = user._id.toString();
  res.status(201).json(publicUser(user));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await getDb().collection('users').findOne({ email });

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
  res.json(req.user);
});

export default router;