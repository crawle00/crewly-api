import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { notFound } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';

const router = Router();
const nonEmpty = z.string().trim().min(1);

const clubSchema = z.object({
	name: nonEmpty,
	pfp: z.string().nullable().default(null),
});

const clubParamsSchema = z.object({
	id: z.string().refine((id) => ObjectId.isValid(id), 'invalid club id'),
});

const leaderParamsSchema = z.object({
	id: z.string().refine((id) => ObjectId.isValid(id), 'invalid club id'),
	userId: z.string().refine((id) => ObjectId.isValid(id), 'invalid user id'),
});

const listQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(250).default(10),
	search: z.string().trim().default(''),
}).strict();

const withoutPasswordHash = ({ passwordHash: _passwordHash, ...user }) => user;

router.use(requireAdmin);

router.get('/', validate({ query: listQuerySchema }), async (req, res) => {
	const { page, limit, search } = req.query;
	const filter = search ? { name: { $regex: search, $options: 'i' } } : {};
	const clubs = getDb().collection('clubs');
	const total = await clubs.countDocuments(filter);
	const data = await clubs.find(filter)
		.sort({ name: 1, _id: 1 })
		.skip((page - 1) * limit)
		.limit(limit)
		.toArray();

	res.json({
		data,
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

router.post('/', validate({ body: clubSchema }), async (req, res) => {
	const club = {
		name: req.body.name,
		pfp: req.body.pfp,
		leaders: [],
		createdAt: new Date(),
	};
	club._id = (await getDb().collection('clubs').insertOne(club)).insertedId;

	res.status(201).json(club);
});

router.patch('/:id', validate({ params: clubParamsSchema, body: clubSchema.partial() }), async (req, res, next) => {
	const club = await getDb().collection('clubs').findOneAndUpdate(
		{ _id: new ObjectId(req.params.id) },
		{ $set: { ...req.body, updatedAt: new Date() } },
		{ returnDocument: 'after' },
	);
	if (!club) return next(notFound('club not found'));
	res.json(club);
});

router.delete('/:id', validate({ params: clubParamsSchema }), async (req, res, next) => {
	const clubId = new ObjectId(req.params.id);
	const clubs = getDb().collection('clubs');
	const result = await clubs.deleteOne({ _id: clubId });
	if (result.deletedCount === 0) return next(notFound('club not found'));

	await getDb().collection('users').updateMany(
		{ clubManagement: clubId },
		{ $pull: { clubManagement: clubId } },
	);
	res.status(204).end();
});

router.put('/:id/leaders/:userId', validate({ params: leaderParamsSchema }), async (req, res, next) => {
	const { id, userId } = req.params;
	const clubs = getDb().collection('clubs');
	const users = getDb().collection('users');
	const club = await clubs.findOne({ _id: new ObjectId(id) });
	if (!club) return next(notFound('club not found'));

	const user = await users.findOneAndUpdate(
		{ _id: new ObjectId(userId) },
		{ $addToSet: { clubManagement: new ObjectId(id) } },
		{ returnDocument: 'after', projection: { passwordHash: 0 } },
	);
	if (!user) return next(notFound('user not found'));

	await clubs.updateOne(
		{ _id: new ObjectId(id) },
		{ $addToSet: { leaders: new ObjectId(userId) } },
	);
	res.json(withoutPasswordHash(user));
});

router.delete('/:id/leaders/:userId', validate({ params: leaderParamsSchema }), async (req, res, next) => {
	const { id, userId } = req.params;
	const clubs = getDb().collection('clubs');
	const users = getDb().collection('users');
	const club = await clubs.findOne({ _id: new ObjectId(id) });
	if (!club) return next(notFound('club not found'));

	const user = await users.findOneAndUpdate(
		{ _id: new ObjectId(userId) },
		{ $pull: { clubManagement: new ObjectId(id) } },
		{ returnDocument: 'after', projection: { passwordHash: 0 } },
	);
	if (!user) return next(notFound('user not found'));

	await clubs.updateOne(
		{ _id: new ObjectId(id) },
		{ $pull: { leaders: new ObjectId(userId) } },
	);
	res.json(withoutPasswordHash(user));
});

export default router;
