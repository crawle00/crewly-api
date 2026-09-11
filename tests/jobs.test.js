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

async function createListing() {
  const listingId = new ObjectId();
  const userId = new ObjectId();

  await global.testDb.collection('users').insertOne({
    _id: userId,
    firstName: 'Listing',
    lastName: 'Owner',
    email: `owner-${listingId}@example.com`,
  });

  await global.testDb.collection('listings').insertOne({
    _id: listingId,
    title: 'Build a robot',
    description: 'Help students build a line-following robot.',
    createdBy: userId,
    status: 'draft',
    volunteers: [],
    reports: [],
    isCancelled: false,
    startsAt: new Date('2099-01-01T10:00:00.000Z'),
    endsAt: new Date('2099-01-01T12:00:00.000Z'),
    createdAt: new Date(),
  });

  return listingId;
}


describe('POST /api/v1/reports', () => {
  it('creates a report and stores it in the listing reports array', async () => {
    const listingId = await createListing();
    const user = await authenticatedRequest('reporter@example.com');

    const res = await user.post('/api/v1/reports').send({
      listingId: listingId.toString(),
      reports: 'This listing contains incorrect information.',
    });

    expect(res.status).toBe(201);

    expect(res.body).toEqual(
      expect.objectContaining({
        reports: 'This listing contains incorrect information.',
      }),
    );

    expect(res.body._id).toBeDefined();
    expect(res.body.userId).toBeDefined();
    expect(res.body.createdAt).toBeDefined();

    const listing = await global.testDb
      .collection('listings')
      .findOne({
        _id: listingId,
      });

    expect(listing.reports).toHaveLength(1);

    expect(listing.reports[0]).toEqual(
      expect.objectContaining({
        _id: new ObjectId(res.body._id),
        userId: new ObjectId(res.body.userId),
        reports: 'This listing contains incorrect information.',
      }),
    );

    expect(listing.reports[0].createdAt).toBeDefined();
  });

  it('returns not found when the listing does not exist', async () => {
    const user = await authenticatedRequest('missing@example.com');

    const res = await user.post('/api/v1/reports').send({
      listingId: new ObjectId().toString(),
      reports: 'This listing does not exist.',
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('listing not found');
  });
});