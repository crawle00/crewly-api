import request from 'supertest';
import { createApp } from '../index.js';

let app;

beforeAll(async () => {
  app = await createApp(global.testDb);
});

async function authenticatedRequest() {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/register').send({
    firstName: 'Viewer',
    lastName: 'User',
    email: 'viewer@example.com',
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

async function seedUsers(count) {
  await global.testDb.collection('users').insertMany(
    Array.from({ length: count }, (_, index) => ({
      firstName: `User${String(index).padStart(3, '0')}`,
      lastName: 'Test',
      email: `user${String(index).padStart(3, '0')}@example.com`,
      passwordHash: 'not-used-in-this-test',
      isAdmin: false,
      clubManagement: [],
      pfp: null,
      bio: null,
      interests: [],
      timeline: [],
      createdAt: new Date(index),
    })),
  );
}

describe('GET /api/v1/users', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/users');

    expect(res.status).toBe(401);
  });

  it('returns the requested page sorted by email', async () => {
    await seedUsers(5);
    const agent = await authenticatedRequest();

    const res = await agent.get('/api/v1/users?page=2&limit=2&sort=email&order=asc');

    expect(res.status).toBe(200);
    expect(res.body.data.map((user) => user.firstName)).toEqual([
      'User002',
      'User003',
    ]);
    expect(res.body.data.every((user) => !('email' in user))).toBe(true);
    expect(res.body.data.every((user) => !('passwordHash' in user))).toBe(true);
    expect(res.body.page).toEqual({
      number: 2,
      limit: 2,
      total: 6,
      totalPages: 3,
      hasNext: true,
      hasPrevious: true,
    });
  });

  it('sorts by name in descending order', async () => {
    await seedUsers(2);
    const agent = await authenticatedRequest();

    const res = await agent.get('/api/v1/users?sort=name&order=desc');

    expect(res.status).toBe(200);
    expect(res.body.data.map((user) => user.firstName)).toEqual(['Viewer', 'User001', 'User000']);
  });

  it('allows a maximum limit of 250', async () => {
    await seedUsers(251);
    const agent = await authenticatedRequest();

    const res = await agent.get('/api/v1/users?limit=250');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(250);
    expect(res.body.page.total).toBe(252);
    expect(res.body.page.totalPages).toBe(2);
  });

  it('returns all non-password fields to admins', async () => {
    await seedUsers(1);
    const agent = await adminRequest();

    const res = await agent.get('/api/v1/users?limit=250');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((user) => !('passwordHash' in user))).toBe(true);
    expect(res.body.data.find((user) => user.email === 'user000@example.com')).toEqual(
      expect.objectContaining({ email: 'user000@example.com', interests: [], isAdmin: false }),
    );
  });

  it.each([
    ['limit above 250', 'limit=251'],
    ['unknown sort field', 'sort=username'],
  ])('rejects %s', async (_description, query) => {
    const agent = await authenticatedRequest();

    const res = await agent.get(`/api/v1/users?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/v1/users/:id', () => {
  it('returns basic information to non-admins', async () => {
    await seedUsers(1);
    const target = await global.testDb.collection('users').findOne({ email: 'user000@example.com' });
    const agent = await authenticatedRequest();

    const res = await agent.get(`/api/v1/users/${target._id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      _id: target._id.toString(),
      firstName: 'User000',
      lastName: 'Test',
      pfp: null,
      bio: null,
      timeline: [],
    });
  });

  it('returns all non-password fields to admins', async () => {
    await seedUsers(1);
    const target = await global.testDb.collection('users').findOne({ email: 'user000@example.com' });
    const agent = await adminRequest();

    const res = await agent.get(`/api/v1/users/${target._id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      email: 'user000@example.com',
      interests: [],
      isAdmin: false,
    }));
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('returns not found for an unknown user', async () => {
    const agent = await authenticatedRequest();

    const res = await agent.get('/api/v1/users/507f1f77bcf86cd799439011');

    expect(res.status).toBe(404);
  });

  it('rejects an invalid user id', async () => {
    const agent = await authenticatedRequest();

    const res = await agent.get('/api/v1/users/not-an-id');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});