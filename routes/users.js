import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const users = await getDb().collection('users')
    .find({ orgId: req.user.orgId }, { projection: { passwordHash: 0 } })
    .limit(50)
    .toArray();
  res.json(users);
});

export default router;
