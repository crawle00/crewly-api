import { MongoClient, ServerApiVersion } from 'mongodb';

let client;
let db;

export async function connectDb() {
  client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();
  await client.db('admin').command({ ping: 1 });

  db = client.db('crewly');
  return db;
}

export function getDb() {
  if (!db) throw new Error('Connect to the database first.');
  return db;
}

export function closeDb() {
  return client ? client.close() : Promise.resolve();
}