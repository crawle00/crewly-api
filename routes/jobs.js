import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../db.js';
import { forbidden, notFound } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';

const router = Router();
const nonEmpty = z.string().trim().min(1);
const objectId = z.string().refine((id) => ObjectId.isValid(id), 'invalid id');
const stringArray = (value) => {
	if (value === undefined) return [];
	const values = Array.isArray(value) ? value : [value];
	return values.flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
};

const listingSchema = z.object({
	clubId: objectId,
	title: nonEmpty,
	description: nonEmpty,
	bannerImage: z.string().nullable().default(null),
	location: z.object({
		name: nonEmpty,
		address: z.string().trim().default(''),
		isRemote: z.boolean().default(false),
	}),
	startsAt: z.coerce.date(),
	endsAt: z.coerce.date(),
	timezone: z.string().trim().default('UTC'),
	capacity: z.number().int().positive().nullable().default(null),
	estimatedHours: z.number().positive().optional(),
	tags: z.array(nonEmpty).default([]),
	skillTags: z.array(nonEmpty).default([]),
	cause: z.string().trim().default(''),
	workType: z.string().trim().default(''),
	requirements: z.array(nonEmpty).default([]),
	contactEmail: z.string().trim().email().optional(),
}).superRefine((listing, context) => {
	if (listing.endsAt <= listing.startsAt) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'must be after startsAt' });
	}
	if (listing.startsAt <= new Date()) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['startsAt'], message: 'must be in the future' });
	}
});

const listingUpdateSchema = z.object({
	title: nonEmpty,
	description: nonEmpty,
	bannerImage: z.string().nullable(),
	location: z.object({
		name: nonEmpty,
		address: z.string().trim(),
		isRemote: z.boolean(),
	}),
	startsAt: z.coerce.date().optional(),
	endsAt: z.coerce.date().optional(),
	timezone: z.string().trim(),
	capacity: z.number().int().positive().nullable(),
	estimatedHours: z.number().positive().optional(),
	tags: z.array(nonEmpty),
	cause: z.string().trim(),
	workType: z.string().trim(),
	requirements: z.array(nonEmpty),
	skillTags: z.array(nonEmpty),
	contactEmail: z.string().trim().email().optional(),
	isCancelled: z.boolean(),
}).strict().partial().refine((listing) => Object.keys(listing).length > 0, {
	message: 'at least one field is required',
});

const listingParamsSchema = z.object({
	id: objectId,
});

const browseQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(250).default(50),
	tag: z.preprocess(stringArray, z.array(nonEmpty).default([])),
	tags: z.preprocess(stringArray, z.array(nonEmpty).default([])),
	tagMode: z.enum(['any', 'all']).default('any'),
	clubId: z.preprocess(stringArray, z.array(objectId).default([])),
	startsBefore: z.coerce.date().optional(),
	startsAfter: z.coerce.date().optional(),
	endsBefore: z.coerce.date().optional(),
	endsAfter: z.coerce.date().optional(),
	sort: z.enum(['startsAt', 'newest', 'title']).default('startsAt'),
	order: z.enum(['asc', 'desc']).default('asc'),
}).strict();

router.post('/list', validate({ body: listingSchema }), async (req, res, next) => {
	const { clubId, ...listingDetails } = req.body;
	const clubs = getDb().collection('clubs');
	const clubObjectId = new ObjectId(clubId);
	const club = await clubs.findOne({
		_id: clubObjectId,
		leaders: req.user._id,
	});
	const managesClub = req.user.clubManagement?.some((managedClubId) => String(managedClubId) === clubId);
	if (!club) {
		const existingClub = await clubs.findOne({ _id: clubObjectId });
		if (!existingClub) return next(notFound('club not found'));
		return next(forbidden('user is not a club leader'));
	}
	if (!managesClub) return next(forbidden('user is not a club leader'));

	const listing = {
		...listingDetails,
		clubId: clubObjectId,
		createdBy: req.user._id,
		status: 'draft',
		volunteers: [],
		isCancelled: false,
		createdAt: new Date(),
	};
	listing._id = (await getDb().collection('listings').insertOne(listing)).insertedId;

	res.status(201).json(listing);
});

router.get('/listings', validate({ query: browseQuerySchema }), async (req, res) => {
	const { page, limit, tag, tags, tagMode, clubId, startsBefore, startsAfter, endsBefore, endsAfter, sort, order } = req.query;
	const requestedTags = [...new Set([...tag, ...tags])];
	const filter = { isCancelled: { $ne: true } };
	if (requestedTags.length > 0) {
		filter.tags = tagMode === 'all' ? { $all: requestedTags } : { $in: requestedTags };
	}
	if (clubId.length > 0) filter.clubId = { $in: clubId.map((id) => new ObjectId(id)) };
	if (startsBefore || startsAfter) {
		filter.startsAt = {};
		if (startsBefore) filter.startsAt.$lt = startsBefore;
		if (startsAfter) filter.startsAt.$gt = startsAfter;
	}
	if (endsBefore || endsAfter) {
		filter.endsAt = {};
		if (endsBefore) filter.endsAt.$lt = endsBefore;
		if (endsAfter) filter.endsAt.$gt = endsAfter;
	}

	const direction = order === 'desc' ? -1 : 1;
	const sortSpec = sort === 'newest'
		? { createdAt: direction, _id: 1 }
		: sort === 'title'
			? { title: direction, _id: 1 }
			: { startsAt: direction, _id: 1 };
	const listings = getDb().collection('listings');
	const total = await listings.countDocuments(filter);
	const data = await listings.find(filter)
		.sort(sortSpec)
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

router.patch('/listing/:id', validate({ params: listingParamsSchema, body: listingUpdateSchema }), async (req, res, next) => {
	const listings = getDb().collection('listings');
	const listing = await listings.findOne({ _id: new ObjectId(req.params.id) });
	if (!listing) return next(notFound('listing not found'));

	const clubs = getDb().collection('clubs');
	const club = await clubs.findOne({ _id: listing.clubId, leaders: req.user._id });
	const managesClub = req.user.clubManagement?.some((managedClubId) => String(managedClubId) === String(listing.clubId));
	if (!club || !managesClub) return next(forbidden('user is not a club leader'));

	const updates = req.body;
	const startsAt = updates.startsAt ?? listing.startsAt;
	const endsAt = updates.endsAt ?? listing.endsAt;
	if (startsAt <= new Date()) return next(forbidden('listing start time must be in the future'));
	if (endsAt <= startsAt) return next(forbidden('listing end time must be after start time'));

	const updatedListing = await listings.findOneAndUpdate(
		{ _id: listing._id },
		{ $set: { ...updates, updatedAt: new Date() } },
		{ returnDocument: 'after' },
	);
	res.json(updatedListing);
});

router.get('/listing/:id', validate({ params: listingParamsSchema }), async (req, res, next) => {
	const listing = await getDb().collection('listings').findOne({ _id: new ObjectId(req.params.id) });
	if (!listing) return next(notFound('listing not found'));

	res.json(listing);
});

export default router;