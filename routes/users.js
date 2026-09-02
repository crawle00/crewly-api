import { Router } from 'express';
import { getDb } from '../db.js';
import { publicUser } from './auth.js';

const router = Router();

router.get('/', async (_req, res) => {
  const users = await getDb().collection('users')
    .find({}, { projection: { passwordHash: 0 } })
    .limit(50)
    .toArray();
  res.json(users.map(publicUser));
});

export default router;
