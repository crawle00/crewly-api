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

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

export function requireClubManager(clubIdParam = 'clubId') {
  return (req, res, next) => {
    const clubId = req.params?.[clubIdParam];
    const manages = req.user?.clubManagement?.some((id) => String(id) === String(clubId));
    if (!req.user?.isAdmin && !manages) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
