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

async function createTargetUser() {
  const target = {
    _id: new ObjectId(),
    firstName: 'Club',
    lastName: 'Leader',
    email: 'leader@example.com',
    passwordHash: 'not-used-in-this-test',
    isAdmin: false,
    clubManagement: [],
    pfp: null,
    bio: 'Club leader bio',
    interests: ['engineering'],
    timeline: [],
    createdAt: new Date(),
  };
  await global.testDb.collection('users').insertOne(target);
  return target;
}

describe('POST /api/v1/clubs', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/v1/clubs')
      .send({ name: 'Robotics Club', pfp: 'robotics.png' });

    expect(res.status).toBe(401);
  });

  it('rejects non-admin users', async () => {
    const agent = await authenticatedRequest('nonadmin@example.com');
    const res = await agent
      .post('/api/v1/clubs')
      .send({ name: 'Robotics Club', pfp: 'robotics.png' });

    expect(res.status).toBe(403);
  });

  it('allows admins to create a club', async () => {
    const agent = await adminRequest();
    const res = await agent
      .post('/api/v1/clubs')
      .send({ name: 'Robotics Club', pfp: 'robotics.png' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      name: 'Robotics Club',
      pfp: 'robotics.png',
      leaders: [],
    }));
    expect(res.body._id).toBeDefined();
    expect(await global.testDb.collection('clubs').findOne({ name: 'Robotics Club' })).toEqual(
      expect.objectContaining({ name: 'Robotics Club', pfp: 'robotics.png', leaders: [] }),
    );
  });
});

describe('Club administration', () => {
  it('lists clubs with pagination for admins', async () => {
    const agent = await adminRequest();
    await agent.post('/api/v1/clubs').send({ name: 'Alpha Club' });
    await agent.post('/api/v1/clubs').send({ name: 'Beta Club' });

    const res = await agent.get('/api/v1/clubs').query({ page: 1, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.page).toEqual(expect.objectContaining({ number: 1, limit: 1, total: 2, totalPages: 2, hasNext: true }));
  });

  it('deletes a club and removes its management references', async () => {
    const target = await createTargetUser();
    const agent = await adminRequest();
    const clubRes = await agent.post('/api/v1/clubs').send({ name: 'Temporary Club' });
    await agent.put(`/api/v1/clubs/${clubRes.body._id}/leaders/${target._id}`);

    const res = await agent.delete(`/api/v1/clubs/${clubRes.body._id}`);

    expect(res.status).toBe(204);
    expect(await global.testDb.collection('clubs').findOne({ _id: new ObjectId(clubRes.body._id) })).toBeNull();
    expect((await global.testDb.collection('users').findOne({ _id: target._id })).clubManagement).toEqual([]);
  });

  it('updates a club for admins', async () => {
    const agent = await adminRequest();
    const clubRes = await agent.post('/api/v1/clubs').send({ name: 'Original Club' });

    const res = await agent.patch(`/api/v1/clubs/${clubRes.body._id}`).send({
      name: 'Updated Club',
      pfp: 'updated.png',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ name: 'Updated Club', pfp: 'updated.png' }));
  });
});

describe('Club leader management', () => {
  it('adds a user to club leadership and clubManagement', async () => {
    const target = await createTargetUser();
    const agent = await adminRequest();
    const clubRes = await agent.post('/api/v1/clubs').send({ name: 'Robotics Club' });

    const res = await agent.put(`/api/v1/clubs/${clubRes.body._id}/leaders/${target._id}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('leader@example.com');
    expect(res.body.passwordHash).toBeUndefined();

    const updatedUser = await global.testDb.collection('users').findOne({ _id: target._id });
    const updatedClub = await global.testDb.collection('clubs').findOne({ _id: new ObjectId(clubRes.body._id) });
    expect(updatedUser.clubManagement.map(String)).toEqual([clubRes.body._id]);
    expect(updatedClub.leaders.map(String)).toEqual([target._id.toString()]);
  });

  it('removes a user from club leadership and clubManagement', async () => {
    const target = await createTargetUser();
    const agent = await adminRequest();
    const clubRes = await agent.post('/api/v1/clubs').send({ name: 'Robotics Club' });
    await agent.put(`/api/v1/clubs/${clubRes.body._id}/leaders/${target._id}`);

    const res = await agent.delete(`/api/v1/clubs/${clubRes.body._id}/leaders/${target._id}`);

    expect(res.status).toBe(200);
    const updatedUser = await global.testDb.collection('users').findOne({ _id: target._id });
    const updatedClub = await global.testDb.collection('clubs').findOne({ _id: new ObjectId(clubRes.body._id) });
    expect(updatedUser.clubManagement).toEqual([]);
    expect(updatedClub.leaders).toEqual([]);
  });

  it('rejects leader changes from non-admin users', async () => {
    const target = await createTargetUser();
    const admin = await adminRequest();
    const clubRes = await admin.post('/api/v1/clubs').send({ name: 'Robotics Club' });
    const agent = await authenticatedRequest('nonadmin@example.com');

    const res = await agent.put(`/api/v1/clubs/${clubRes.body._id}/leaders/${target._id}`);

    expect(res.status).toBe(403);
  });

  it('returns not found for unknown clubs or users', async () => {
    const target = await createTargetUser();
    const agent = await adminRequest();
    const missingClubId = new ObjectId();
    const missingUserId = new ObjectId();

    const missingClub = await agent.put(`/api/v1/clubs/${missingClubId}/leaders/${target._id}`);
    const clubRes = await agent.post('/api/v1/clubs').send({ name: 'Robotics Club' });
    const missingUser = await agent.put(`/api/v1/clubs/${clubRes.body._id}/leaders/${missingUserId}`);

    expect(missingClub.status).toBe(404);
    expect(missingUser.status).toBe(404);
  });
});
