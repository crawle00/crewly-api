import request from 'supertest';
import { createApp } from '../index.js';

let app;

beforeAll(async () => {
  app = await createApp(global.testDb);
});

describe('Auth Endpoints', () => {
  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          password: 'password123',
        });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe('john@example.com');
      expect(res.body.firstName).toBe('John');
    });

    it('should reject duplicate email', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          password: 'password123',
        });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'john@example.com',
          password: 'password456',
        });

      expect(res.status).toBe(409);
    });

    it('should reject invalid email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'John',
          lastName: 'Doe',
          email: 'invalid-email',
          password: 'password123',
        });

      expect(res.status).toBe(400);
    });

    it('should reject short password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          password: 'short',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          password: 'password123',
        });
    });

    it('should login with correct credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'john@example.com',
          password: 'password123',
        });

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('john@example.com');
    });

    it('should reject invalid password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'john@example.com',
          password: 'wrongpassword',
        });

      expect(res.status).toBe(401);
    });

    it('should reject non-existent user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout');

      expect(res.status).toBe(204);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
    });
  });
  describe('PATCH /api/v1/auth/me', () => {
    async function registeredAgent(email = 'jane@example.com') {
      const agent = request.agent(app);
      await agent.post('/api/v1/auth/register').send({
        firstName: 'Jane',
        lastName: 'Doe',
        email,
        password: 'password123',
      });
      return agent;
    }

    it('should reject unauthenticated requests', async () => {
      const res = await request(app).patch('/api/v1/auth/me').send({ firstName: 'New' });
      expect(res.status).toBe(401);
    });

    it('should update the password and allow login with the new password', async () => {
      const agent = await registeredAgent();
      const updateRes = await agent.patch('/api/v1/auth/me').send({
        currentPassword: 'password123',
        password: 'newpassword456',
      });
      expect(updateRes.status).toBe(200);

      await agent.post('/api/v1/auth/logout');

      const oldPasswordLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'jane@example.com',
        password: 'password123',
      });
      expect(oldPasswordLogin.status).toBe(401);

      const newPasswordLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'jane@example.com',
        password: 'newpassword456',
      });
      expect(newPasswordLogin.status).toBe(200);
      expect(newPasswordLogin.body.email).toBe('jane@example.com');
    });
    it('should reject a password change with an incorrect current password', async () => {
      const agent = await registeredAgent('wrong-current@example.com');

      const res = await agent.patch('/api/v1/auth/me').send({
        currentPassword: 'notmypassword',
        password: 'newpassword456',
      });

      expect(res.status).toBe(401);
    });

    it('should reject a password change with no current password provided', async () => {
      const agent = await registeredAgent('missing-current@example.com');

      const res = await agent.patch('/api/v1/auth/me').send({ password: 'newpassword456' });

      expect(res.status).toBe(400);
    });

    it('should reject a password shorter than 8 characters', async () => {
      const agent = await registeredAgent('short-pw@example.com');
      const res = await agent.patch('/api/v1/auth/me').send({ password: 'short' });
      expect(res.status).toBe(400);
    });

    it('should update profile fields without requiring a password', async () => {
      const agent = await registeredAgent('profile-update@example.com');
      const res = await agent.patch('/api/v1/auth/me').send({ bio: 'Loves volunteering' });
      expect(res.status).toBe(200);
      expect(res.body.bio).toBe('Loves volunteering');
    });

    it('should not leak the password hash in the response', async () => {
      const agent = await registeredAgent('no-leak@example.com');
      const res = await agent.patch('/api/v1/auth/me').send({
        currentPassword: 'password123',
        password: 'anotherpassword1',
      });
      expect(res.status).toBe(200);
      expect(res.body.passwordHash).toBeUndefined();
    });
  });
  describe('DELETE /api/v1/auth/me', () => {
    async function registeredAgent(email) {
      const agent = request.agent(app);
      const res = await agent.post('/api/v1/auth/register').send({
        firstName: 'Delete',
        lastName: 'Me',
        email,
        password: 'password123',
      });
      return { agent, userId: res.body._id };
    }

    async function adminAgent(email = 'delete-admin@example.com') {
      const { agent, userId } = await registeredAgent(email);
      await global.testDb.collection('users').updateOne(
        { email },
        { $set: { isAdmin: true } },
      );
      return { agent, userId };
    }

    it('should reject unauthenticated requests', async () => {
      const res = await request(app).delete('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('should delete the account and destroy the session', async () => {
      const { agent } = await registeredAgent('delete-basic@example.com');
      const deleteRes = await agent.delete('/api/v1/auth/me');
      expect(deleteRes.status).toBe(204);

      const meRes = await agent.get('/api/v1/auth/me');
      expect(meRes.status).toBe(401);

      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: 'delete-basic@example.com',
        password: 'password123',
      });
      expect(loginRes.status).toBe(401);
    });

    it('should remove the deleted user from any clubs they lead', async () => {
      const { agent: admin } = await adminAgent();
      const { agent: leaderAgent, userId: leaderId } = await registeredAgent('delete-leader@example.com');

      const clubRes = await admin.post('/api/v1/clubs').send({ name: 'Cleanup Club' });
      await admin.put(`/api/v1/clubs/${clubRes.body._id}/leaders/${leaderId}`);

      const deleteRes = await leaderAgent.delete('/api/v1/auth/me');
      expect(deleteRes.status).toBe(204);

      const club = await global.testDb.collection('clubs').findOne({ name: 'Cleanup Club' });
      expect(club.leaders).toEqual([]);
    });

    it('should remove the deleted user from any listing volunteer lists', async () => {
      const { agent: admin } = await adminAgent('delete-admin-2@example.com');
      const { agent: leaderAgent, userId: leaderId } = await registeredAgent('delete-listing-leader@example.com');
      const { agent: volunteerAgent, userId: volunteerId } = await registeredAgent('delete-volunteer@example.com');

      const clubRes = await admin.post('/api/v1/clubs').send({ name: 'Volunteer Cleanup Club' });
      await admin.put(`/api/v1/clubs/${clubRes.body._id}/leaders/${leaderId}`);

      const listingRes = await leaderAgent.post('/api/v1/jobs/list').send({
        clubId: clubRes.body._id,
        title: 'Cleanup Test Listing',
        description: 'Testing volunteer cleanup on account deletion.',
        location: { name: 'Somewhere', address: '', isRemote: true },
        startsAt: '2099-01-01T10:00:00.000Z',
        endsAt: '2099-01-01T12:00:00.000Z',
      });

      const volunteerRes = await volunteerAgent.post(`/api/v1/jobs/listing/${listingRes.body._id}/volunteers`);
      expect(volunteerRes.status).toBe(200);
      expect(volunteerRes.body.volunteers.map(String)).toContain(volunteerId);

      const deleteRes = await volunteerAgent.delete('/api/v1/auth/me');
      expect(deleteRes.status).toBe(204);

      const listing = await global.testDb.collection('listings').findOne({ title: 'Cleanup Test Listing' });
      expect(listing.volunteers).toEqual([]);
    });
  });

});