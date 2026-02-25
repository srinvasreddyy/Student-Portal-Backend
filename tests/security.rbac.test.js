const request = require('supertest');
const app = require('../src/app');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const TokenUtils = require('../src/utils/tokenUtils');
const User = require('../src/models/User');

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create();
    process.env.MONGO_URI = mongoServer.getUri();
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
    await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

describe('Security: RBAC (RoleGuard)', () => {

    let studentToken;
    let adminToken;

    beforeAll(async () => {
        const student = new User({ email: 'student@rbac.com', passwordHash: 'hash', role: 'student', status: 'active' });
        await student.save();
        studentToken = TokenUtils.generateAccessToken(student);

        const admin = new User({ email: 'admin@rbac.com', passwordHash: 'hash', role: 'super_admin', status: 'active' });
        await admin.save();
        adminToken = TokenUtils.generateAccessToken(admin);
    });

    test('Student blocked from admin metrics endpoint', async () => {
        // Assuming /admin/metrics requires 'super_admin' or similar
        const res = await request(app)
            .get('/admin/metrics')
            .set('Authorization', `Bearer ${studentToken}`);

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/Forbidden/);
    });

    test('Super Admin allowed to admin metrics endpoint', async () => {
        const res = await request(app)
            .get('/admin/metrics')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).not.toBe(403);
        expect(res.status).not.toBe(401);
    });

});
