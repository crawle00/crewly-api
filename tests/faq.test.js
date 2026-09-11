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


describe('POST /api/v1/faq', () => {
  it('creates a question for an existing listing', async () => {
    const listingId = await createListing();
    const user = await authenticatedRequest('questioner@example.com');

    const res = await user.post('/api/v1/faq').send({
      listingId: listingId.toString(),
      question: 'What should I bring?',
    });

    expect(res.status).toBe(201);

    expect(res.body).toEqual(
      expect.objectContaining({
        listingId: listingId.toString(),
        question: 'What should I bring?',
        replies: [],
      }),
    );

    expect(res.body._id).toBeDefined();
    expect(res.body.userId).toBeDefined();
    expect(res.body.createdAt).toBeDefined();

    const question = await global.testDb
      .collection('questions')
      .findOne({
        _id: new ObjectId(res.body._id),
      });

    expect(question).toEqual(
      expect.objectContaining({
        listingId,
        question: 'What should I bring?',
        replies: [],
      }),
    );
  });

  it('returns not found when the listing does not exist', async () => {
    const user = await authenticatedRequest('questioner@example.com');

    const res = await user.post('/api/v1/faq').send({
      listingId: new ObjectId().toString(),
      question: 'What should I bring?',
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('listing not found');
  });
});


describe('GET /api/v1/faq/:listingId', () => {
  it('returns questions with user information and nested replies', async () => {
    const listingId = await createListing();

    const questioner = await authenticatedRequest('questioner@example.com');

    const questionRes = await questioner.post('/api/v1/faq').send({
      listingId: listingId.toString(),
      question: 'What should I bring?',
    });

    const questionId = questionRes.body._id;

    const reply1Res = await questioner
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'You should bring closed-toe shoes.',
      });

    const reply2Res = await questioner
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'Are sneakers okay?',
        parentReplyId: reply1Res.body._id,
      });

    const reply3Res = await questioner
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'Yes, sneakers are fine.',
        parentReplyId: reply2Res.body._id,
      });

    const res = await questioner.get(
      `/api/v1/faq/${listingId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    expect(res.body[0]).toEqual(
      expect.objectContaining({
        _id: questionId,
        listingId: listingId.toString(),
        question: 'What should I bring?',
        firstName: 'Viewer',
        lastName: 'User',
      }),
    );

    expect(res.body[0].replies).toHaveLength(1);

    const firstReply = res.body[0].replies[0];

    expect(firstReply).toEqual(
      expect.objectContaining({
        _id: reply1Res.body._id,
        questionId,
        reply: 'You should bring closed-toe shoes.',
        firstName: 'Viewer',
        lastName: 'User',
      }),
    );

    expect(firstReply.replies).toHaveLength(1);

    const secondReply = firstReply.replies[0];

    expect(secondReply).toEqual(
      expect.objectContaining({
        _id: reply2Res.body._id,
        questionId,
        reply: 'Are sneakers okay?',
        firstName: 'Viewer',
        lastName: 'User',
      }),
    );

    expect(secondReply.replies).toHaveLength(1);

    const thirdReply = secondReply.replies[0];

    expect(thirdReply).toEqual(
      expect.objectContaining({
        _id: reply3Res.body._id,
        questionId,
        reply: 'Yes, sneakers are fine.',
        firstName: 'Viewer',
        lastName: 'User',
      }),
    );

    expect(thirdReply.replies).toEqual([]);
  });

  it('returns an empty array when the listing has no questions', async () => {
    const listingId = await createListing();
    const user = await authenticatedRequest('faq-reader@example.com');

    const res = await user.get(
      `/api/v1/faq/${listingId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});


describe('POST /api/v1/faq/:questionId/replies', () => {
  async function createQuestion() {
    const listingId = await createListing();
    const user = await authenticatedRequest('questioner@example.com');

    const res = await user.post('/api/v1/faq').send({
      listingId: listingId.toString(),
      question: 'What should I bring?',
    });

    return {
      listingId,
      questionId: res.body._id,
      user,
    };
  }

  it('creates a direct reply to a question', async () => {
    const { questionId, user } = await createQuestion();

    const res = await user
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'Closed-toe shoes are required.',
      });

    expect(res.status).toBe(201);

    expect(res.body).toEqual(
      expect.objectContaining({
        reply: 'Closed-toe shoes are required.',
        replies: [],
      }),
    );

    expect(res.body._id).toBeDefined();
    expect(res.body.userId).toBeDefined();
    expect(res.body.createdAt).toBeDefined();

    const question = await global.testDb
      .collection('questions')
      .findOne({
        _id: new ObjectId(questionId),
      });

    expect(question.replies).toHaveLength(1);

    expect(question.replies[0]).toEqual(
      expect.objectContaining({
        _id: new ObjectId(res.body._id),
        reply: 'Closed-toe shoes are required.',
        replies: [],
      }),
    );
  });

  it('creates a nested reply to another reply', async () => {
    const { questionId, user } = await createQuestion();

    const parentRes = await user
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'Bring closed-toe shoes.',
      });

    const childRes = await user
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'Are sneakers okay?',
        parentReplyId: parentRes.body._id,
      });

    expect(childRes.status).toBe(201);

    expect(childRes.body).toEqual(
      expect.objectContaining({
        reply: 'Are sneakers okay?',
        replies: [],
      }),
    );

    const question = await global.testDb
      .collection('questions')
      .findOne({
        _id: new ObjectId(questionId),
      });

    expect(question.replies).toHaveLength(1);

    expect(question.replies[0].replies).toHaveLength(1);

    expect(question.replies[0].replies[0]).toEqual(
      expect.objectContaining({
        _id: new ObjectId(childRes.body._id),
        reply: 'Are sneakers okay?',
        replies: [],
      }),
    );
  });

  it('creates a deeply nested reply', async () => {
    const { questionId, user } = await createQuestion();

    const reply1 = await user
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'First reply.',
      });

    const reply2 = await user
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'Second reply.',
        parentReplyId: reply1.body._id,
      });

    const reply3 = await user
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'Third reply.',
        parentReplyId: reply2.body._id,
      });

    expect(reply3.status).toBe(201);

    const question = await global.testDb
      .collection('questions')
      .findOne({
        _id: new ObjectId(questionId),
      });

    expect(question.replies[0].reply).toBe(
      'First reply.',
    );

    expect(question.replies[0].replies[0].reply).toBe(
      'Second reply.',
    );

    expect(
      question.replies[0].replies[0].replies[0].reply,
    ).toBe('Third reply.');
  });

  it('returns not found when the question does not exist', async () => {
    const user = await authenticatedRequest('questioner@example.com');

    const res = await user
      .post(`/api/v1/faq/${new ObjectId()}/replies`)
      .send({
        reply: 'This should fail.',
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('question not found');
  });

  it('rejects an invalid parent reply id', async () => {
    const { questionId, user } = await createQuestion();

    const res = await user
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'This should fail.',
        parentReplyId: 'not-a-valid-object-id',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid parent reply id');
  });

  it('returns not found when the parent reply does not exist', async () => {
    const { questionId, user } = await createQuestion();

    const res = await user
      .post(`/api/v1/faq/${questionId}/replies`)
      .send({
        reply: 'This should fail.',
        parentReplyId: new ObjectId().toString(),
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('parent reply not found');
  });

  it('does not allow a parent reply from another question', async () => {
    const firstQuestion = await createQuestion();

    const secondQuestionRes = await firstQuestion.user
      .post('/api/v1/faq')
      .send({
        listingId: firstQuestion.listingId.toString(),
        question: 'What time does it start?',
      });

    const parentRes = await firstQuestion.user
      .post(`/api/v1/faq/${firstQuestion.questionId}/replies`)
      .send({
        reply: 'It starts at 10 AM.',
      });

    const res = await firstQuestion.user
      .post(`/api/v1/faq/${secondQuestionRes.body._id}/replies`)
      .send({
        reply: 'This should fail.',
        parentReplyId: parentRes.body._id,
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('parent reply not found');
  });
});