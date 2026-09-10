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

async function createClub(name = 'Robotics Club') {
  const admin = await authenticatedRequest('admin@example.com');

  await global.testDb.collection('users').updateOne(
    { email: 'admin@example.com' },
    { $set: { isAdmin: true } },
  );

  const response = await admin
    .post('/api/v1/clubs')
    .send({ name, pfp: 'robotics.png' });

  return { admin, club: response.body };
}

async function createListing() {
  const { admin, club } = await createClub();

  const leader = await authenticatedRequest('leader@example.com');

  const leaderUser = await global.testDb.collection('users').findOne({
    email: 'leader@example.com',
  });

  await admin.put(`/api/v1/clubs/${club._id}/leaders/${leaderUser._id}`);

  const listing = await global.testDb.collection('listings').insertOne({
    title: 'Build a robot',
    description: 'Help students build a line-following robot.',
    clubId: new ObjectId(club._id),
    createdBy: leaderUser._id,
    status: 'draft',
    volunteers: [],
    isCancelled: false,
    startsAt: new Date('2099-01-01T10:00:00.000Z'),
    endsAt: new Date('2099-01-01T12:00:00.000Z'),
    createdAt: new Date(),
  });

  return listing.insertedId;
}

describe('POST /api/v1/reports', () => {
  it('creates a report for an existing listing', async () => {
    const listingId = await createListing();
    const user = await authenticatedRequest('reporter@example.com');

    const res = await user.post('/api/v1/reports').send({
      listingId: listingId.toString(),
      reports: 'This listing contains inappropriate content.',
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        listingId: listingId.toString(),
        reports: 'This listing contains inappropriate content.',
      }),
    );

    expect(res.body.userId).toBeDefined();
    expect(res.body.createdAt).toBeDefined();

    const report = await global.testDb.collection('reports').findOne({
      _id: new ObjectId(res.body._id),
    });

    expect(report).toEqual(
      expect.objectContaining({
        listingId,
        reports: 'This listing contains inappropriate content.',
      }),
    );
  });

  it('returns not found when the listing does not exist', async () => {
    const user = await authenticatedRequest('reporter@example.com');

    const res = await user.post('/api/v1/reports').send({
      listingId: new ObjectId().toString(),
      reports: 'This listing contains inappropriate content.',
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('listing not found');
  });
});


describe('GET /api/v1/reports/:listingId', () => {
  it('returns reports for a listing with user information', async () => {
    const listingId = await createListing();

    const reporter = await authenticatedRequest('reporter@example.com');

    await reporter.post('/api/v1/reports').send({
      listingId: listingId.toString(),
      reports: 'First report',
    });

    await reporter.post('/api/v1/reports').send({
      listingId: listingId.toString(),
      reports: 'Second report',
    });

    const res = await reporter.get(
      `/api/v1/reports/${listingId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    expect(res.body[0]).toEqual(
      expect.objectContaining({
        listingId: listingId.toString(),
        reports: 'First report',
        firstName: 'Viewer',
        lastName: 'User',
      }),
    );

    expect(res.body[1]).toEqual(
      expect.objectContaining({
        listingId: listingId.toString(),
        reports: 'Second report',
        firstName: 'Viewer',
        lastName: 'User',
      }),
    );
  });

  it('returns an empty array when the listing has no reports', async () => {
    const listingId = await createListing();
    const user = await authenticatedRequest('report-reader@example.com');

    const res = await user.get(
      `/api/v1/reports/${listingId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});