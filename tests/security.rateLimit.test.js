const request = require('supertest');
const app = require('../src/app');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const BruteForceProtector = require('../src/middleware/bruteForceProtector');

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
    await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

describe('Security: Rate Limiting & Brute Force', () => {

    beforeEach(() => {
        // Clear in-memory maps for tests
        // Since rate-limit relies on IP, we can mock it by passing a custom IP header or just hitting it rapidly.
        // bruteForceProtector has static forceUnlock
        BruteForceProtector.forceUnlock('test-brute@test.com');
    });

    test('Global Rate Limiter (Simulated)', async () => {
        // It's hard to test 100 requests without making the test slow, 
        // but we can test the headers exist.
        const res = await request(app).get('/healthz');
        expect(res.status).toBe(200);
        expect(res.headers).toHaveProperty('ratelimit-limit');
        expect(res.headers).toHaveProperty('ratelimit-remaining');
    });

    test('Brute Force Protector locks account after 5 failures', async () => {
        const email = 'test-brute@test.com';

        // Hit it 5 times with bad password
        for (let i = 0; i < 5; i++) {
            const res = await request(app)
                .post('/auth/login')
                .send({ email, password: 'wrongpassword' });

            if (i < 4) {
                expect(res.status).toBe(400); // Because Zod fails validation first (or 401 if it gets past Zod)
            }
        }

        // Let's actually hit it directly to trigger the brute force protector lock since Zod might block it before it hits the DB.
        // Wait, Zod requires password to be min 8 chars with uppercase+number.
        // Let's send a valid payload structure but wrong actual password

        const validButWrongPayload = { email, password: 'ValidWrong123!' };

        // 5 attempts
        for (let i = 0; i < 5; i++) {
            await request(app).post('/auth/login').send(validButWrongPayload);
        }

        // The 6th attempt should be blocked with 423
        const lockedRes = await request(app).post('/auth/login').send(validButWrongPayload);
        expect(lockedRes.status).toBe(423);
        expect(lockedRes.body.error).toBe('ACCOUNT_LOCKED');
    });
});
