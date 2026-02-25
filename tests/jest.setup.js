const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const config = require('../src/config');

let mongoServer;

beforeAll(async () => {
    if (!mongoServer) {
        mongoServer = await MongoMemoryReplSet.create();
        const uri = mongoServer.getUri();
        process.env.MONGO_URI = uri;
        config.db.uri = uri;
    }
});

afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    if (mongoServer) {
        await mongoServer.stop();
    }
});
