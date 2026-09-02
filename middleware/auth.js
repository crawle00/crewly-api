import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';

export async function loadUser(req, _res, next) {
  if (req.session?.userId) {
    req.user = await getDb().collection('users').findOne(
      { _id: new ObjectId(req.session.userId) },
      { projection: { passwordHash: 0 } },
    );
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}