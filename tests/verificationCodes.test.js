import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createApp } from '../index.js';
import { createVerificationCode } from '../routes/verificationCodes.js';

let app;

beforeAll(async () => {
  app = await createApp(global.testDb);
});

const HOUR = 60 * 60 * 1000;

async function authenticatedRequest(email = 'viewer@example.com') {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/register').send({
    firstName: 'Viewer',
    lastName: 'User',
    email,
    password: 'password123',
  });
  return agent;
}

async function adminRequest() {
  const agent = await authenticatedRequest('admin@example.com');
  await global.testDb.collection('users').updateOne(
    { email: 'admin@example.com' },
    { $set: { isAdmin: true } },
  );
  return agent;
}

// Registers a user and signs them up as a volunteer for the listing.
async function volunteerRequest(listing, email = 'viewer@example.com') {
  const agent = await authenticatedRequest(email);
  const user = await global.testDb.collection('users').findOne({ email });
  await global.testDb.collection('listings').updateOne(
    { _id: listing._id },
    { $addToSet: { volunteers: user._id } },
  );
  return agent;
}

async function insertListing(overrides = {}) {
  const listing = {
    _id: new ObjectId(),
    title: 'Beach cleanup',
    clubId: new ObjectId(),
    startsAt: new Date(Date.now() - HOUR),
    endsAt: new Date(Date.now() + HOUR),
    location: { name: 'North Beach', address: '', isRemote: false },
    isCancelled: false,
    volunteers: [],
    ...overrides,
  };
  await global.testDb.collection('listings').insertOne(listing);
  return listing;
}

async function insertCode(listingId, code = '123456') {
  await global.testDb.collection('verificationCodes').insertOne({ code, listingId, createdAt: new Date() });
  return code;
}

async function timelineOf(email = 'viewer@example.com') {
  return (await global.testDb.collection('users').findOne({ email })).timeline;
}

describe('createVerificationCode', () => {
  it('stores a 6-digit code linked to the listing', async () => {
    const listingId = new ObjectId();

    const verificationCode = await createVerificationCode(listingId);

    expect(verificationCode.code).toMatch(/^\d{6}$/);
    expect(await global.testDb.collection('verificationCodes').findOne({ _id: verificationCode._id })).toEqual(
      expect.objectContaining({ code: verificationCode.code, listingId }),
    );
  });

  it('generates a new code when the first one is already in use', async () => {
    await insertCode(new ObjectId(), '111111');
    const generated = ['111111', '222222'];

    const verificationCode = await createVerificationCode(new ObjectId(), () => generated.shift());

    expect(verificationCode.code).toBe('222222');
    expect(await global.testDb.collection('verificationCodes').countDocuments({ code: '111111' })).toBe(1);
  });
});

describe('GET /api/v1/verification-codes', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/verification-codes');

    expect(res.status).toBe(401);
  });

  it('lists every code, with its listing title, for admins', async () => {
    const first = await insertListing({ title: 'Beach cleanup' });
    const second = await insertListing({ title: 'Food drive' });
    await insertCode(first._id, '111111');
    await insertCode(second._id, '222222');
    const admin = await adminRequest();

    const res = await admin.get('/api/v1/verification-codes');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: '111111', listingId: first._id.toString(), listingTitle: 'Beach cleanup' }),
      expect.objectContaining({ code: '222222', listingId: second._id.toString(), listingTitle: 'Food drive' }),
    ]));
  });

  it('filters by listingId', async () => {
    const first = await insertListing();
    const second = await insertListing();
    await insertCode(first._id, '111111');
    await insertCode(second._id, '222222');
    const admin = await adminRequest();

    const res = await admin.get('/api/v1/verification-codes').query({ listingId: second._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([expect.objectContaining({ code: '222222' })]);
  });

  it('only shows club leaders the codes for their own clubs\' listings', async () => {
    const clubId = new ObjectId();
    const ownListing = await insertListing({ clubId });
    const otherListing = await insertListing();
    await insertCode(ownListing._id, '111111');
    await insertCode(otherListing._id, '222222');
    const leader = await authenticatedRequest('leader@example.com');
    await global.testDb.collection('users').updateOne(
      { email: 'leader@example.com' },
      { $set: { clubManagement: [clubId] } },
    );

    const res = await leader.get('/api/v1/verification-codes');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([expect.objectContaining({ code: '111111' })]);
  });

  it('returns no codes to users who do not lead a club', async () => {
    const listing = await insertListing();
    await insertCode(listing._id);
    const member = await authenticatedRequest('member@example.com');

    const res = await member.get('/api/v1/verification-codes');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('rejects an invalid listingId', async () => {
    const admin = await adminRequest();

    const res = await admin.get('/api/v1/verification-codes').query({ listingId: 'not-an-id' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/v1/verification-codes/redeem', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/v1/verification-codes/redeem').send({ code: '123456' });

    expect(res.status).toBe(401);
  });

  it('adds the listing to a registered volunteer\'s timeline while the listing is in progress', async () => {
    const listing = await insertListing();
    const code = await insertCode(listing._id);
    const agent = await volunteerRequest(listing);

    const res = await agent.post('/api/v1/verification-codes/redeem').send({ code });

    expect(res.status).toBe(200);
    expect(res.body.timeline).toEqual([listing._id.toString()]);
    expect(res.body.passwordHash).toBeUndefined();
    expect(await timelineOf()).toEqual([listing._id]);
  });

  it('does not add the same listing twice', async () => {
    const listing = await insertListing();
    const code = await insertCode(listing._id);
    const agent = await volunteerRequest(listing);

    await agent.post('/api/v1/verification-codes/redeem').send({ code });
    const res = await agent.post('/api/v1/verification-codes/redeem').send({ code });

    expect(res.status).toBe(200);
    expect(res.body.timeline).toEqual([listing._id.toString()]);
  });

  it('rejects a code for a listing the user is not registered for', async () => {
    const listing = await insertListing();
    const code = await insertCode(listing._id);
    const agent = await authenticatedRequest();

    const res = await agent.post('/api/v1/verification-codes/redeem').send({ code });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('you are not registered for this listing');
    expect(await timelineOf()).toEqual([]);
  });

  it.each([
    ['has not started', { startsAt: new Date(Date.now() + HOUR), endsAt: new Date(Date.now() + 2 * HOUR) }, 'listing has not started yet'],
    ['has already ended', { startsAt: new Date(Date.now() - 2 * HOUR), endsAt: new Date(Date.now() - HOUR) }, 'listing has already ended'],
    ['is cancelled', { isCancelled: true }, 'listing has been cancelled'],
  ])('rejects a code when the listing %s', async (_description, overrides, message) => {
    const listing = await insertListing(overrides);
    const code = await insertCode(listing._id);
    const agent = await volunteerRequest(listing);

    const res = await agent.post('/api/v1/verification-codes/redeem').send({ code });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe(message);
    expect(await timelineOf()).toEqual([]);
  });

  it('returns 404 for a code that does not exist', async () => {
    const agent = await authenticatedRequest();

    const res = await agent.post('/api/v1/verification-codes/redeem').send({ code: '999999' });

    expect(res.status).toBe(404);
  });

  it('returns 404 when the code\'s listing no longer exists', async () => {
    const code = await insertCode(new ObjectId());
    const agent = await authenticatedRequest();

    const res = await agent.post('/api/v1/verification-codes/redeem').send({ code });

    expect(res.status).toBe(404);
  });

  it.each([['too short', '12345'], ['not numeric', '12ab56']])('rejects a code that is %s', async (_description, code) => {
    const agent = await authenticatedRequest();

    const res = await agent.post('/api/v1/verification-codes/redeem').send({ code });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('User timeline', () => {
  it('returns an empty timeline for users stored without one', async () => {
    const legacyUser = {
      _id: new ObjectId(),
      firstName: 'Legacy',
      lastName: 'User',
      email: 'legacy@example.com',
      passwordHash: 'not-used-in-this-test',
      isAdmin: false,
      clubManagement: [],
      createdAt: new Date(),
    };
    await global.testDb.collection('users').insertOne(legacyUser);
    const viewer = await authenticatedRequest();

    const res = await viewer.get(`/api/v1/users/${legacyUser._id}`);

    expect(res.status).toBe(200);
    expect(res.body.timeline).toEqual([]);
  });
});

describe('GET /api/v1/users/:id/timeline', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get(`/api/v1/users/${new ObjectId()}/timeline`);

    expect(res.status).toBe(401);
  });

  it('returns the checked-in listings, newest first, with their club name', async () => {
    const clubId = new ObjectId();
    await global.testDb.collection('clubs').insertOne({ _id: clubId, name: 'Green Team', leaders: [] });
    const older = await insertListing({ title: 'Older event', clubId, startsAt: new Date('2024-01-01'), endsAt: new Date('2024-01-02') });
    const newer = await insertListing({ title: 'Newer event', clubId, startsAt: new Date('2025-01-01'), endsAt: new Date('2025-01-02') });
    const notCheckedIn = await insertListing({ title: 'Skipped event' });
    await authenticatedRequest('profile@example.com');
    const profileUser = await global.testDb.collection('users').findOne({ email: 'profile@example.com' });
    await global.testDb.collection('users').updateOne(
      { _id: profileUser._id },
      { $set: { timeline: [older._id, newer._id] } },
    );
    const viewer = await authenticatedRequest();

    const res = await viewer.get(`/api/v1/users/${profileUser._id}/timeline`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((listing) => listing.title)).toEqual(['Newer event', 'Older event']);
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      _id: newer._id.toString(),
      clubName: 'Green Team',
      location: expect.objectContaining({ name: 'North Beach' }),
    }));
    expect(res.body.data.some((listing) => listing._id === notCheckedIn._id.toString())).toBe(false);
  });

  it('skips listings that have since been deleted', async () => {
    const listing = await insertListing();
    await authenticatedRequest('profile@example.com');
    await global.testDb.collection('users').updateOne(
      { email: 'profile@example.com' },
      { $set: { timeline: [listing._id, new ObjectId()] } },
    );
    const profileUser = await global.testDb.collection('users').findOne({ email: 'profile@example.com' });
    const viewer = await authenticatedRequest();

    const res = await viewer.get(`/api/v1/users/${profileUser._id}/timeline`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 404 for an unknown user', async () => {
    const viewer = await authenticatedRequest();

    const res = await viewer.get(`/api/v1/users/${new ObjectId()}/timeline`);

    expect(res.status).toBe(404);
  });
});
