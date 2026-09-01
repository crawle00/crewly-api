import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDb, closeDb } from './db.js';
import pingRouter from './routes/ping.js';
import usersRouter from './routes/users.js';
dotenv.config({ path: path.join(__dirname, 'secrets/atlas-credentials.env'), quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (_req, res) => {
  res.send('Welcome to Crewly API');
});

app.use('/ping', pingRouter);
app.use('/users', usersRouter);

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