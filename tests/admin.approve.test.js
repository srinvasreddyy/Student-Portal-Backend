const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const Company = require('../src/models/Company');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const EmailSendAttempt = require('../src/models/EmailSendAttempt');
const config = require('../src/config');
const jwt = require('jsonwebtoken');

jest.mock('nodemailer', () => ({
    createTransport: jest.fn().mockReturnValue({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'm-id', response: '250 OK' })
    })
}));

describe('Admin Applications Routing & Workflows', () => {
    let adminToken;
    let standardToken;
    let companyId;
    let adminUserId;

    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) await mongoose.connect(config.db.uri);

        // Prep users
        const adminUser = await User.create({ email: 'super@test.com', passwordHash: 'hash', role: 'super_admin', status: 'active' });
        adminUserId = adminUser._id;
        adminToken = jwt.sign({ id: adminUser._id, role: 'super_admin', status: 'active' }, config.jwt.secret, { expiresIn: '15m' });

        const stdUser = await User.create({ email: 'student@test.com', passwordHash: 'hash', role: 'student', status: 'active' });
        standardToken = jwt.sign({ id: stdUser._id, role: 'student', status: 'active' }, config.jwt.secret, { expiresIn: '15m' });
    });

    afterAll(async () => { await mongoose.connection.close(); });
    beforeEach(async () => {
        await Company.deleteMany({});
        await AuditLog.deleteMany({});
        await EmailSendAttempt.deleteMany({});
        jest.clearAllMocks();

        // Seed general company used for testing
        const c = await Company.create({ country: 'US', officialName: 'Testing Co', companyEmail: 'rep@testco.com', status: 'pending' });
        companyId = c._id;
    });

    it('1. Auth restriction checks', async () => {
        const resNoAuth = await request(app).get('/admin/applications?type=company');
        expect(resNoAuth.status).toBe(401);

        const resStd = await request(app).get('/admin/applications?type=company').set('Authorization', `Bearer ${standardToken}`);
        expect(resStd.status).toBe(403);

        const resAdmin = await request(app).get('/admin/applications?type=company').set('Authorization', `Bearer ${adminToken}`);
        expect(resAdmin.status).toBe(200);
    });

    it('2. Approve path — SuperAdmin approves pending company', async () => {
        const payload = { notify: true, message: 'Welcome!', type: 'company' };
        const res = await request(app).post(`/admin/applications/${companyId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`).send(payload);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('verified');
        expect(res.body.emailAttemptId).toBeDefined();

        // Check if logs are written correctly out to target docs
        const c = await Company.findById(companyId);
        expect(c.status).toBe('verified');
        expect(c.auditLogs.length).toBe(1);

        const logs = await AuditLog.find({ targetId: companyId });
        expect(logs.length).toBe(1);
        expect(logs[0].actionType).toBe('approve');

        // Check EmailAttempt queue record created
        const attempt = await EmailSendAttempt.findOne({ applicationId: companyId });
        expect(attempt.status).toBe('sent');
        expect(attempt.sendKey).toContain('approve_');
    });

    it('3. Reject path — rejects with reason', async () => {
        const res = await request(app).post(`/admin/applications/${companyId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ notify: true, reason: 'Does not meet requirements', type: 'company' });

        expect(res.status).toBe(200);

        const c = await Company.findById(companyId);
        expect(c.status).toBe('rejected');

        const tryEmail = await EmailSendAttempt.findOne({});
        expect(tryEmail.template).toBe('reject');
    });

    it('4. Hold path — places on hold, no email', async () => {
        const res = await request(app).post(`/admin/applications/${companyId}/hold`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ notify: false, reason: 'Need more docs', type: 'company' });

        expect(res.status).toBe(200);

        const c = await Company.findById(companyId);
        expect(c.status).toBe('on_hold');

        const tryEmail = await EmailSendAttempt.findOne({});
        expect(tryEmail).toBeNull(); // notify: false
    });

    it('5. Invalid transition — approve already verified returns 400', async () => {
        await Company.findByIdAndUpdate(companyId, { status: 'verified' });

        const res = await request(app).post(`/admin/applications/${companyId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ notify: false, type: 'company' });

        expect(res.status).toBe(400);

        // However, it should still log the failing attempt internally
        const logs = await AuditLog.find({ targetId: companyId, 'details.failed': true });
        expect(logs.length).toBe(1);
    });

    it('6. Idempotent email sends — repeated approve request limits sent email attempts', async () => {
        const payload = { notify: true, type: 'company' };
        await request(app).post(`/admin/applications/${companyId}/approve`).set('Authorization', `Bearer ${adminToken}`).send(payload);

        // We spoof the status back to pending to simulate hitting the controller twice legitimately in logic
        await Company.findByIdAndUpdate(companyId, { status: 'pending' });

        const res2 = await request(app).post(`/admin/applications/${companyId}/approve`).set('Authorization', `Bearer ${adminToken}`).send(payload);

        // Controller parses our idempotent flag properly in the background wrapper
        expect(res2.status).toBe(200);
        // We shouldn't generate 2 email rows with identical sendKeys normally, uniqueness guarantees
        const emailCounts = await EmailSendAttempt.countDocuments({ applicationId: companyId });
        expect(emailCounts).toBe(1);
    });
});
