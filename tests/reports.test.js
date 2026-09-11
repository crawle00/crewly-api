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
  it('creates a report for an existing listing', async () => {
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
        reports: 'This listing contains incorrect information.',
      }),
    );

    expect(listing.reports[0].userId).toBeDefined();
    expect(listing.reports[0].createdAt).toBeDefined();
  });

  it('returns not found when the listing does not exist', async () => {
    const user = await authenticatedRequest('reporter@example.com');

    const res = await user.post('/api/v1/reports').send({
      listingId: new ObjectId().toString(),
      reports: 'This listing does not exist.',
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('listing not found');
  });
});


describe('GET /api/v1/reports/:listingId', () => {
  it('returns reports with user information', async () => {
    const listingId = await createListing();

    const reporter = await authenticatedRequest('reporter@example.com');

    const reportRes = await reporter
      .post('/api/v1/reports')
      .send({
        listingId: listingId.toString(),
        reports: 'This listing contains incorrect information.',
      });

    const res = await reporter.get(
      `/api/v1/reports/${listingId}`,
    );

    expect(res.status).toBe(200);

    expect(res.body).toHaveLength(1);

    expect(res.body[0]).toEqual(
      expect.objectContaining({
        _id: reportRes.body._id,
        listingId: listingId.toString(),
        reports: 'This listing contains incorrect information.',
        firstName: 'Viewer',
        lastName: 'User',
      }),
    );

    expect(res.body[0].createdAt).toBeDefined();
  });

  it('returns multiple reports in creation order', async () => {
    const listingId = await createListing();

    const reporter = await authenticatedRequest('reporter@example.com');

    const firstReport = await reporter
      .post('/api/v1/reports')
      .send({
        listingId: listingId.toString(),
        reports: 'First report.',
      });

    const secondReport = await reporter
      .post('/api/v1/reports')
      .send({
        listingId: listingId.toString(),
        reports: 'Second report.',
      });

    const res = await reporter.get(
      `/api/v1/reports/${listingId}`,
    );

    expect(res.status).toBe(200);

    expect(res.body).toHaveLength(2);

    expect(res.body[0]).toEqual(
      expect.objectContaining({
        _id: firstReport.body._id,
        reports: 'First report.',
      }),
    );

    expect(res.body[1]).toEqual(
      expect.objectContaining({
        _id: secondReport.body._id,
        reports: 'Second report.',
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