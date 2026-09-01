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

  db = client.db(process.env.MONGODB_DB || 'crewly');
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('connectDb() must be called before getDb()');
  }
  return db;
}

export function closeDb() {
  return client ? client.close() : Promise.resolve();
}