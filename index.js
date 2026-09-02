import dotenv from 'dotenv';
import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDb, closeDb, getClient } from './db.js';
import { loadUser, requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { globalLimiter } from './middleware/rateLimit.js';
import authRouter from './routes/auth.js';
import pingRouter from './routes/ping.js';
import usersRouter from './routes/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, 'secrets/atlas-credentials.env'), quiet: true });

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  console.error('SESSION_SECRET must be set and at least 32 characters long');
  process.exit(1);
}

export async function createApp(testDb) {
  const app = express();
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  const corsOrigins = (process.env.CORS_ORIGINS).split(',').map((o) => o.trim()).filter(Boolean);

  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(globalLimiter);
  app.use(express.json());

  if (testDb) {
    app.use(session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new (await import('connect-mongo')).default({ client: global.testDbClient, dbName: 'test' }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
      },
    }));
  } else {
    app.use(session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ client: getClient(), dbName: 'crewly', ttl: 24 * 60 * 60 }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
      },
    }));
  }

  app.use(loadUser);

  app.get('/', (_req, res) => {
    res.send('Welcome to Crewly API');
  });

  app.use('/ping', pingRouter);

  const v1 = Router();
  v1.use('/auth', authRouter);
  v1.use('/users', requireAuth, usersRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  try {
    await connectDb();
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const app = await createApp();
  const port = process.env.PORT;

  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      console.log(`${signal} received, shutting down`);
      server.close();
      await closeDb();
    });
  }
}