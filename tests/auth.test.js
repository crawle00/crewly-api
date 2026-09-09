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
});