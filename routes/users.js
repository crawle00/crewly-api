import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../db.js';
import { notFound } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const userIdSchema = z.object({
  id: z.string().refine((id) => ObjectId.isValid(id), 'invalid user id'),
});

const basicUser = (user) => ({
  _id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  pfp: user.pfp,
  bio: user.bio,
  timeline: user.timeline,
});

const withoutPasswordHash = ({ passwordHash: _passwordHash, ...user }) => user;

const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(250).default(50),
    sort: z.enum(['name', 'firstName', 'lastName', 'email', 'createdAt']).default('name'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

router.get('/', validate({ query: listQuerySchema }), async (req, res) => {
  const { page, limit, sort, order } = req.query;
  const direction = order === 'desc' ? -1 : 1;
  const sortSpec = sort === 'name'
    ? { firstName: direction, lastName: direction, _id: 1 }
    : { [sort]: direction, _id: 1 };
  const usersCollection = getDb().collection('users');
  const total = await usersCollection.countDocuments();
  const users = await usersCollection
    .find({}, { projection: { passwordHash: 0 } })
    .sort(sortSpec)
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  res.json({
    data: users.map(req.user.isAdmin ? withoutPasswordHash : basicUser),
    page: {
      number: page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrevious: page > 1,
    },
  });
});

router.get('/:id', validate({ params: userIdSchema }), async (req, res, next) => {
  const user = await getDb().collection('users').findOne(
    { _id: new ObjectId(req.params.id) },
    { projection: { passwordHash: 0 } },
  );

  if (!user) return next(notFound('user not found'));

  res.json(req.user.isAdmin ? user : basicUser(user));
});

export default router;