import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createApp } from '../index.js';

let app;

beforeAll(async () => {
  app = await createApp(global.testDb);
});

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
  const agent = await authenticatedRequest();
  await global.testDb.collection('users').updateOne(
    { email: 'viewer@example.com' },
    { $set: { isAdmin: true } },
  );
  return agent;
}

async function createClub(name = 'Robotics Club') {
  const admin = await adminRequest();
  const response = await admin.post('/api/v1/clubs').send({ name, pfp: 'robotics.png' });
  return { admin, club: response.body };
}

async function createUser() {
  const agent = await authenticatedRequest('leader@example.com');
  return global.testDb.collection('users').findOne({ email: 'leader@example.com' });
}

const listingDetails = {
  title: 'Build a robot',
  description: 'Help students build a line-following robot.',
  bannerImage: 'robot-banner.png',
  location: {
    name: 'Engineering Lab',
    address: '123 Campus Way',
    isRemote: false,
  },
  startsAt: '2099-01-01T10:00:00.000Z',
  endsAt: '2099-01-01T12:00:00.000Z',
  timezone: 'America/New_York',
  capacity: 20,
  estimatedHours: 2,
  tags: ['community', 'education'],
  cause: 'STEM education',
  workType: 'hands-on',
  requirements: ['Closed-toe shoes'],
  contactEmail: 'robotics@example.com',
  skillTags: ['welding', 'electronics'],
};

describe('POST /api/v1/jobs/list', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/v1/jobs/list').send(listingDetails);

    expect(res.status).toBe(401);
  });

  it('rejects a user who is not a club leader', async () => {
    const { club } = await createClub();
    const agent = await authenticatedRequest('member@example.com');

    const res = await agent.post('/api/v1/jobs/list').send({ ...listingDetails, clubId: club._id });

    expect(res.status).toBe(403);
  });

  it('allows a club leader to create a listing', async () => {
    const { admin, club } = await createClub();
    const leader = await createUser();
    await admin.put(`/api/v1/clubs/${club._id}/leaders/${leader._id}`);
    const leaderAgent = request.agent(app);
    await leaderAgent.post('/api/v1/auth/login').send({
      email: 'leader@example.com',
      password: 'password123',
    });

    const res = await leaderAgent.post('/api/v1/jobs/list').send({ ...listingDetails, clubId: club._id });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      title: listingDetails.title,
      description: listingDetails.description,
      clubId: club._id,
      createdBy: leader._id.toString(),
      status: 'draft',
      volunteers: [],
      isCancelled: false,
    }));
    expect(res.body.location).toEqual(listingDetails.location);
    expect(res.body.passwordHash).toBeUndefined();
    expect(await global.testDb.collection('listings').findOne({ _id: new ObjectId(res.body._id) })).toEqual(
      expect.objectContaining({ clubId: new ObjectId(club._id), createdBy: leader._id, status: 'draft' }),
    );
  });

  it.each([
    ['missing title', { title: undefined }],
    ['ends before starts', { startsAt: '2099-01-01T12:00:00.000Z', endsAt: '2099-01-01T10:00:00.000Z' }],
    ['past start', { startsAt: '2020-01-01T10:00:00.000Z' }],
  ])('rejects %s', async (_description, overrides) => {
    const { admin, club } = await createClub();
    const leader = await createUser();
    await admin.put(`/api/v1/clubs/${club._id}/leaders/${leader._id}`);
    const leaderAgent = request.agent(app);
    await leaderAgent.post('/api/v1/auth/login').send({ email: 'leader@example.com', password: 'password123' });

    const res = await leaderAgent.post('/api/v1/jobs/list').send({ ...listingDetails, clubId: club._id, ...overrides });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/v1/jobs/listing/:id', () => {
  it('returns listing information to an authenticated user', async () => {
    const { admin, club } = await createClub();
    const leader = await createUser();
    await admin.put(`/api/v1/clubs/${club._id}/leaders/${leader._id}`);
    const leaderAgent = request.agent(app);
    await leaderAgent.post('/api/v1/auth/login').send({ email: 'leader@example.com', password: 'password123' });
    const created = await leaderAgent.post('/api/v1/jobs/list').send({ ...listingDetails, clubId: club._id });
    const viewer = await authenticatedRequest('reader@example.com');

    const initialRes = await viewer.get(`/api/v1/jobs/listing/${created.body._id}`);

    expect(initialRes.status).toBe(200);
    await global.testDb.collection('listings').updateOne(
      { _id: new ObjectId(created.body._id) },
      { $set: { volunteers: [new ObjectId('507f1f77bcf86cd799439011')] } },
    );

    const res = await viewer.get(`/api/v1/jobs/listing/${created.body._id}`);

    expect(res.body).toEqual(expect.objectContaining({
      _id: created.body._id,
      title: listingDetails.title,
      clubId: club._id,
      status: 'draft',
      volunteers: ['507f1f77bcf86cd799439011'],
    }));
  });

  it('returns not found for an unknown listing', async () => {
    const viewer = await authenticatedRequest('reader@example.com');

    const res = await viewer.get(`/api/v1/jobs/listing/${new ObjectId()}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/jobs/listings', () => {
  async function seedListings() {
    const clubOneId = new ObjectId();
    const clubTwoId = new ObjectId();
    await global.testDb.collection('clubs').insertMany([
      { _id: clubOneId, name: 'Robotics Club', leaders: [] },
      { _id: clubTwoId, name: 'Garden Club', leaders: [] },
    ]);
    await global.testDb.collection('listings').insertMany([
      {
        _id: new ObjectId(), title: 'Robot build', clubId: clubOneId,
        tags: ['community', 'education'], skillTags: ['welding'],
        startsAt: new Date('2099-01-01T10:00:00Z'), endsAt: new Date('2099-01-01T12:00:00Z'),
        createdAt: new Date('2026-01-01'), isCancelled: false,
      },
      {
        _id: new ObjectId(), title: 'Garden cleanup', clubId: clubTwoId,
        tags: ['community'], skillTags: ['gardening'],
        startsAt: new Date('2099-01-02T10:00:00Z'), endsAt: new Date('2099-01-02T12:00:00Z'),
        createdAt: new Date('2026-01-02'), isCancelled: false,
      },
      {
        _id: new ObjectId(), title: 'Cancelled event', clubId: clubOneId,
        tags: ['community', 'education'], skillTags: ['welding'],
        startsAt: new Date('2099-01-03T10:00:00Z'), endsAt: new Date('2099-01-03T12:00:00Z'),
        createdAt: new Date('2026-01-03'), isCancelled: true,
      },
    ]);
    return { clubOneId, clubTwoId };
  }

  it('filters tags with any or all matching and filters by club', async () => {
    const { clubOneId } = await seedListings();
    const viewer = await authenticatedRequest('listing-reader@example.com');

    const any = await viewer.get('/api/v1/jobs/listings?tag=education&tag=missing');
    const all = await viewer.get('/api/v1/jobs/listings?tags=community,education&tagMode=all&clubId=' + clubOneId);

    expect(any.status).toBe(200);
    expect(any.body.data.map((listing) => listing.title)).toEqual(['Robot build']);
    expect(all.status).toBe(200);
    expect(all.body.data.map((listing) => listing.title)).toEqual(['Robot build']);
  });

  it('sorts and paginates listings and excludes cancelled listings', async () => {
    await seedListings();
    const viewer = await authenticatedRequest('listing-reader@example.com');

    const res = await viewer.get('/api/v1/jobs/listings?page=2&limit=1&sort=newest&order=desc');

    expect(res.status).toBe(200);
    expect(res.body.data.map((listing) => listing.title)).toEqual(['Robot build']);
    expect(res.body.page).toEqual({
      number: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
      hasNext: false,
      hasPrevious: true,
    });
  });

  it('filters listings by before and after start and end times', async () => {
    await seedListings();
    const viewer = await authenticatedRequest('listing-reader@example.com');

    const res = await viewer.get(
      '/api/v1/jobs/listings?startsAfter=2099-01-01T12:00:00.000Z&startsBefore=2099-01-03T00:00:00.000Z&endsAfter=2099-01-01T11:00:00.000Z&endsBefore=2099-01-03T00:00:00.000Z',
    );

    expect(res.status).toBe(200);
    expect(res.body.data.map((listing) => listing.title)).toEqual(['Garden cleanup']);
  });

  it('rejects invalid listing time filters', async () => {
    const viewer = await authenticatedRequest('listing-reader@example.com');

    const res = await viewer.get('/api/v1/jobs/listings?startsAfter=not-a-date');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a limit above 250', async () => {
    const viewer = await authenticatedRequest('listing-reader@example.com');

    const res = await viewer.get('/api/v1/jobs/listings?limit=251');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('PATCH /api/v1/jobs/listing/:id', () => {
  async function createLeaderListing() {
    const { admin, club } = await createClub();
    const leader = await createUser();
    await admin.put(`/api/v1/clubs/${club._id}/leaders/${leader._id}`);
    const leaderAgent = request.agent(app);
    await leaderAgent.post('/api/v1/auth/login').send({ email: 'leader@example.com', password: 'password123' });
    const created = await leaderAgent.post('/api/v1/jobs/list').send({ ...listingDetails, clubId: club._id });
    return { admin, club, leader, leaderAgent, listing: created.body };
  }

  it('allows a leader to edit listing details and cancellation state', async () => {
    const { leaderAgent, listing } = await createLeaderListing();

    const res = await leaderAgent.patch(`/api/v1/jobs/listing/${listing._id}`).send({
      title: 'Updated robot project',
      description: 'An updated volunteer project.',
      isCancelled: true,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      title: 'Updated robot project',
      description: 'An updated volunteer project.',
      isCancelled: true,
      volunteers: [],
    }));
    expect(res.body.clubId).toBe(listing.clubId);
  });

  it('rejects edits from a user who does not lead the listing club', async () => {
    const { listing } = await createLeaderListing();
    const nonLeader = await authenticatedRequest('member@example.com');

    const res = await nonLeader.patch(`/api/v1/jobs/listing/${listing._id}`).send({ title: 'Unauthorized edit' });

    expect(res.status).toBe(403);
  });

  it('does not allow volunteers to be edited', async () => {
    const { leaderAgent, listing } = await createLeaderListing();
    const volunteerId = new ObjectId();
    await global.testDb.collection('listings').updateOne(
      { _id: new ObjectId(listing._id) },
      { $set: { volunteers: [volunteerId] } },
    );

    const res = await leaderAgent.patch(`/api/v1/jobs/listing/${listing._id}`).send({ volunteers: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const unchanged = await global.testDb.collection('listings').findOne({ _id: new ObjectId(listing._id) });
    expect(unchanged.volunteers).toEqual([volunteerId]);
  });

  it('rejects edits that move a listing into the past', async () => {
    const { leaderAgent, listing } = await createLeaderListing();

    const res = await leaderAgent.patch(`/api/v1/jobs/listing/${listing._id}`).send({
      startsAt: '2020-01-01T10:00:00.000Z',
    });

    expect(res.status).toBe(403);
  });
});
