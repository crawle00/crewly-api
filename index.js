import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDb, closeDb } from './db.js';
import { loadUser, requireAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import pingRouter from './routes/ping.js';
import usersRouter from './routes/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, 'secrets/atlas-credentials.env'), quiet: true });

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 },
}));
app.use(loadUser);

app.get('/', (_req, res) => {
  res.send('Welcome to Crewly API');
});

app.use('/ping', pingRouter);
app.use('/auth', authRouter);
app.use('/users', requireAuth, usersRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

try {
  await connectDb();
  console.log('Connected to MongoDB');
} catch (err) {
  console.error('Failed to connect to MongoDB:', err.message);
  process.exit(1);
}

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