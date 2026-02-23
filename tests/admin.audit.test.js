const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const University = require('../src/models/University');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const EmailSendAttempt = require('../src/models/EmailSendAttempt');
const config = require('../src/config');
const jwt = require('jsonwebtoken');

jest.mock('nodemailer', () => ({
    createTransport: jest.fn().mockReturnValue({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'm-id-audit', response: '250 OK' })
    })
}));

describe('Admin Audit & Fetch Workflows', () => {
    let adminToken;
    let uniId;

    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) await mongoose.connect(config.db.uri);
        const adminUser = await User.create({ email: 'super@test.com', passwordHash: 'hash', role: 'super_admin', status: 'active' });
        adminToken = jwt.sign({ id: adminUser._id, role: 'super_admin', status: 'active' }, config.jwt.secret, { expiresIn: '15m' });
    });

    afterAll(async () => { await mongoose.connection.close(); });
    beforeEach(async () => {
        await University.deleteMany({});
        await AuditLog.deleteMany({});
        await EmailSendAttempt.deleteMany({});
        jest.clearAllMocks();

        const u = await University.create({ name: 'Audit Uni', country: 'CA', status: 'pending', representative: { email: 'admin@audit.ca' } });
        uniId = u._id;
    });

    it('1. List applications endpoint includes pagination and filters', async () => {
        // Create a few more unis to test pagination
        await University.create({ name: 'Uni 2', country: 'CA', status: 'pending' });
        await University.create({ name: 'Uni 3', country: 'CA', status: 'verified' });

        const resAll = await request(app).get('/admin/applications?type=university').set('Authorization', `Bearer ${adminToken}`);
        expect(resAll.body.count).toBe(3);

        const resFilter = await request(app).get('/admin/applications?type=university&status=verified').set('Authorization', `Bearer ${adminToken}`);
        expect(resFilter.body.count).toBe(1);

        const resSearch = await request(app).get('/admin/applications?type=university&q=Audit').set('Authorization', `Bearer ${adminToken}`);
        expect(resSearch.body.data[0].name).toBe('Audit Uni');
    });

    it('2. Resend decision logic re-queues email and records attempt', async () => {
        // We reject initially
        await request(app).post(`/admin/applications/${uniId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ notify: true, reason: 'Initial Reject', type: 'university' });

        // Now resend the reject email forcefully
        const resendRes = await request(app).post(`/admin/applications/${uniId}/resend-decision`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ actionType: 'reject', force: true, type: 'university', reason: 'Repeated Reject' });

        expect(resendRes.status).toBe(200);

        // Should be 2 email attempts now
        const emailCounts = await EmailSendAttempt.countDocuments({ applicationId: uniId });
        expect(emailCounts).toBe(2);

        // An audit log for the resend should exist
        const resendLog = await AuditLog.findOne({ actionType: 'resend_email' });
        expect(resendLog).toBeDefined();
    });

    it('3. Admin notes create AuditLog attachments', async () => {
        const noteRes = await request(app).post(`/admin/applications/${uniId}/notes`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ note: 'Called them on phone, waiting for doc', type: 'university' });

        expect(noteRes.status).toBe(201);

        const u = await University.findById(uniId);
        expect(u.auditLogs.length).toBe(1);

        const log = await AuditLog.findById(u.auditLogs[0]);
        expect(log.actionType).toBe('add_note');
        expect(log.details.note).toMatch(/phone/i);
    });

    it('4. Audit query endpoint returns filtered logs', async () => {
        await AuditLog.create([
            { actorEmail: 'super@test.com', actorRole: 'super_admin', targetType: 'university', targetId: uniId, actionType: 'approve', details: {} },
            { actorEmail: 'other@test.com', actorRole: 'super_admin', targetType: 'company', targetId: new mongoose.Types.ObjectId(), actionType: 'reject', details: {} }
        ]);

        const res = await request(app).get('/admin/audit-logs?actionType=approve').set('Authorization', `Bearer ${adminToken}`);
        expect(res.body.count).toBe(1);
        expect(res.body.data[0].actorEmail).toBe('super@test.com');
    });
});
