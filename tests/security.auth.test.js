const request = require('supertest');
const app = require('../src/app');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const TokenUtils = require('../src/utils/tokenUtils');
const { MongoMemoryServer } = require('mongodb-memory-server');

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

describe('Security: Authentication & Token Rotation', () => {

    beforeEach(async () => {
        await User.deleteMany({});
    });

    test('Zod Rejecting invalid structures (NoSQL Attempt / Missing Fields)', async () => {
        // Missing password should trigger 400 Validation Error
        let res = await request(app).post('/auth/register').send({ email: 'test@zod.com' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');

        // NoSQL Injection Attempt via Zod/Mongoose Sanitize
        res = await request(app)
            .post('/auth/login')
            .send({ email: { $gt: "" }, password: "Password123!" });

        // Zod intercepts this first because email should be a string, not an object
        expect(res.status).toBe(400);
    });

    test('Refresh Token - Successful Rotation', async () => {
        const user = new User({ email: 'refresh@test.com', passwordHash: 'hashed', role: 'student', status: 'active' });
        await user.save();

        const initialRefreshToken = await TokenUtils.generateRefreshToken(user);

        // Hit the refresh endpoint
        const res = await request(app)
            .post('/auth/refresh')
            .send({ refreshToken: initialRefreshToken });

        expect(res.status).toBe(200);
        expect(res.body.tokens).toHaveProperty('accessToken');
        expect(res.body.tokens).toHaveProperty('refreshToken');
        expect(res.body.tokens.refreshToken).not.toBe(initialRefreshToken);
    });

    test('Refresh Token - Reuse Detection triggers global session wipe', async () => {
        const user = new User({ email: 'reuse@test.com', passwordHash: 'hashed', role: 'student', status: 'active' });
        await user.save();

        // Generate a token
        const compromisedToken = await TokenUtils.generateRefreshToken(user);

        // 1st time - legimiate rotation
        await request(app).post('/auth/refresh').send({ refreshToken: compromisedToken });

        // 2nd time - Attacker uses the OLD token that was just rotated out
        const attackerRes = await request(app).post('/auth/refresh').send({ refreshToken: compromisedToken });

        expect(attackerRes.status).toBe(401);
        expect(attackerRes.body.message).toMatch(/compromised/i);

        // DB Should show NO refresh tokens (sessions wiped)
        const updatedUser = await User.findById(user._id);
        expect(updatedUser.refreshTokens.length).toBe(0);
    });

});
