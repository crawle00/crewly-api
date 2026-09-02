import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

let mongoServer;
let client;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  client = new MongoClient(mongoUri);
  await client.connect();

  global.testDbClient = client;
  global.testDb = client.db('test');
});

afterAll(async () => {
  if (client) await client.close();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  const collections = await global.testDb.listCollections().toArray();
  for (const collection of collections) {
    await global.testDb.collection(collection.name).deleteMany({});
  }
});