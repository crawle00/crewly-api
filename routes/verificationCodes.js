import { randomInt } from 'crypto';
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../db.js';
import { forbidden, notFound } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { publicUser } from './auth.js';

const router = Router();
const MAX_CODE_ATTEMPTS = 10;

const listQuerySchema = z.object({
	listingId: z.string().refine((id) => ObjectId.isValid(id), 'invalid listing id').optional(),
}).strict();

const redeemSchema = z.object({
	code: z.string().trim().regex(/^\d{6}$/, 'must be a 6-digit code'),
});

const randomSixDigitCode = () => String(randomInt(100000, 1000000));

// The unique index is what guarantees no two listings share a code; a duplicate-key
// error (E11000) just means the random code was taken, so roll again.
export async function createVerificationCode(listingId, generateCode = randomSixDigitCode) {
	const codes = getDb().collection('verificationCodes');
	await codes.createIndex({ code: 1 }, { unique: true });

	for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
		const verificationCode = { code: generateCode(), listingId, createdAt: new Date() };
		try {
			verificationCode._id = (await codes.insertOne(verificationCode)).insertedId;
			return verificationCode;
		} catch (error) {
			if (error.code !== 11000) throw error;
		}
	}
	throw new Error('unable to generate a unique verification code');
}

router.get('/', validate({ query: listQuerySchema }), async (req, res) => {
	const db = getDb();
	const conditions = [];
	if (req.query.listingId) conditions.push({ listingId: new ObjectId(req.query.listingId) });

	// Admins see every code; club leaders only see codes for their own clubs' listings.
	if (!req.user.isAdmin) {
		const managedClubIds = (req.user.clubManagement ?? []).map((id) => new ObjectId(id));
		const managedListingIds = await db.collection('listings').distinct('_id', { clubId: { $in: managedClubIds } });
		conditions.push({ listingId: { $in: managedListingIds } });
	}

	const data = await db.collection('verificationCodes').aggregate([
		{ $match: conditions.length > 0 ? { $and: conditions } : {} },
		{ $sort: { createdAt: -1, _id: 1 } },
		{ $lookup: { from: 'listings', localField: 'listingId', foreignField: '_id', as: 'listing' } },
		{ $project: { code: 1, listingId: 1, createdAt: 1, listingTitle: { $arrayElemAt: ['$listing.title', 0] } } },
	]).toArray();

	res.json({ data });
});

router.post('/redeem', validate({ body: redeemSchema }), async (req, res, next) => {
	const db = getDb();
	const verificationCode = await db.collection('verificationCodes').findOne({ code: req.body.code });
	if (!verificationCode) return next(notFound('verification code not found'));

	const listing = await db.collection('listings').findOne({ _id: verificationCode.listingId });
	if (!listing) return next(notFound('listing not found'));

	const isRegistered = listing.volunteers?.some((volunteerId) => String(volunteerId) === String(req.user._id));
	if (!isRegistered) return next(forbidden('you are not registered for this listing'));

	const now = new Date();
	if (listing.isCancelled) return next(forbidden('listing has been cancelled'));
	if (now < listing.startsAt) return next(forbidden('listing has not started yet'));
	if (now > listing.endsAt) return next(forbidden('listing has already ended'));

	const user = await db.collection('users').findOneAndUpdate(
		{ _id: req.user._id },
		{ $addToSet: { timeline: listing._id } },
		{ returnDocument: 'after', projection: { passwordHash: 0 } },
	);
	res.json(publicUser(user));
});

export default router;
