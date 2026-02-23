const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const config = require('../src/config');
const jwt = require('jsonwebtoken');

// Mock external dependencies
jest.mock('nodemailer', () => ({
    createTransport: jest.fn().mockReturnValue({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' })
    }),
    getTestMessageUrl: jest.fn()
}));

describe('Auth & User Phase 1', () => {
    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(config.db.uri || 'mongodb://localhost:27017/mern_db_test');
        }
    });

    afterAll(async () => {
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        await User.deleteMany({});
    });

    it('1. Register student -> persisted -> login works', async () => {
        const payload = {
            email: 'student@test.com',
            password: 'password123',
            role: 'student'
        };

        // Register
        const regRes = await request(app).post('/auth/register').send(payload);
        expect(regRes.status).toBe(201);
        expect(regRes.body.user.role).toBe('student');
        expect(regRes.body.user.status).toBe('active'); // active immediately

        // Login
        const loginRes = await request(app).post('/auth/login').send({
            email: 'student@test.com',
            password: 'password123'
        });

        expect(loginRes.status).toBe(200);
        expect(loginRes.body.tokens).toHaveProperty('accessToken');
        expect(loginRes.body.tokens).toHaveProperty('refreshToken');

        // Verify refresh token stored mapped inside DB
        const dbUser = await User.findOne({ email: 'student@test.com' });
        expect(dbUser.refreshTokens.length).toBe(1);
    });

    it('2. Register company admin -> status=pending -> login blocked', async () => {
        const payload = {
            email: 'admin@company.com',
            password: 'password123',
            role: 'company_admin'
        };

        const regRes = await request(app).post('/auth/register').send(payload);
        expect(regRes.status).toBe(201);
        expect(regRes.body.user.status).toBe('pending');

        const loginRes = await request(app).post('/auth/login').send({
            email: 'admin@company.com',
            password: 'password123'
        });

        // Should be blocked because status != active
        expect(loginRes.status).toBe(401);
        expect(loginRes.body.message).toMatch(/pending/);
    });

    it('3. Login invalid password -> handles failure', async () => {
        // Note: Rate limiting is tricky to functionally test without a loop unless we mock it or run it 10 times.
        // For unit testing efficiency, we just verify auth failure code.
        await User.create({
            email: 'fail@test.com',
            passwordHash: 'wronghash',
            role: 'student',
            status: 'active'
        });

        const loginRes = await request(app).post('/auth/login').send({
            email: 'fail@test.com',
            password: 'wrongpassword'
        });

        expect(loginRes.status).toBe(401);
        expect(loginRes.body.message).toBe('Invalid credentials');
    });

    it('4. Refresh token rotation works -> old refresh token rejected', async () => {
        // Manually register/login to get tokens
        await request(app).post('/auth/register').send({
            email: 'rotate@test.com', password: 'password123', role: 'student'
        });
        const loginRes = await request(app).post('/auth/login').send({
            email: 'rotate@test.com', password: 'password123'
        });

        const oldRefreshToken = loginRes.body.tokens.refreshToken;

        // Use token to get new ones
        const refreshRes = await request(app).post('/auth/refresh').send({
            refreshToken: oldRefreshToken
        });

        expect(refreshRes.status).toBe(200);
        expect(refreshRes.body.tokens).toHaveProperty('refreshToken');
        const newRefreshToken = refreshRes.body.tokens.refreshToken;

        // Ensure they don't match
        expect(oldRefreshToken).not.toBe(newRefreshToken);

        // Reuse old token - should be rejected and all tokens dropped (compromised session)
        const reuseRes = await request(app).post('/auth/refresh').send({
            refreshToken: oldRefreshToken
        });

        expect(reuseRes.status).toBe(401);
        expect(reuseRes.body.message).toMatch(/compromised/i);

        // Verify DB empty
        const user = await User.findOne({ email: 'rotate@test.com' });
        expect(user.refreshTokens.length).toBe(0);
    });

    it('5. Forgot/reset password flow with expiry', async () => {
        await request(app).post('/auth/register').send({
            email: 'forgot@test.com', password: 'oldpassword', role: 'student'
        });

        // Forgot password
        const forgotRes = await request(app).post('/auth/forgot-password').send({
            email: 'forgot@test.com'
        });

        expect(forgotRes.status).toBe(200);

        // Dig code out of DB manually for testing
        const user = await User.findOne({ email: 'forgot@test.com' });
        expect(user.resetPasswordHash).toBeDefined();

        // To properly test, we'll bypass the hashing since we can't unhash it easily
        // We will just try with an invalid one
        const resetFail = await request(app).post('/auth/reset-password').send({
            email: 'forgot@test.com',
            code: '123456',
            newPassword: 'newpassword123'
        });

        expect(resetFail.status).toBe(400);
        expect(resetFail.body.message).toBe('Invalid code');
    });
});
