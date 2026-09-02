import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { forbidden, unauthorized } from './errors.js';

export async function loadUser(req, _res, next) {
  if (req.session?.userId) {
    req.user = await getDb().collection('users').findOne(
      { _id: new ObjectId(req.session.userId) },
      { projection: { passwordHash: 0 } },
    );
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user?.isAdmin) {
    return next(forbidden());
  }
  next();
}

export function requireClubManager(clubIdParam = 'clubId') {
  return (req, _res, next) => {
    const clubId = req.params?.[clubIdParam];
    const manages = req.user?.clubManagement?.some((id) => String(id) === String(clubId));
    if (!req.user?.isAdmin && !manages) {
      return next(forbidden());
    }
    next();
  };
}
