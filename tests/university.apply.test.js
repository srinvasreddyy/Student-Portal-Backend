const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const University = require('../src/models/University');
const config = require('../src/config');
const axios = require('axios');
const bcrypt = require('bcrypt');

jest.mock('axios');
jest.mock('nodemailer', () => ({
    createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' }) }),
    getTestMessageUrl: jest.fn()
}));

describe('University Verify & Apply Subsystem', () => {
    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) await mongoose.connect(config.db.uri || 'mongodb://localhost:27017/mern_db_test');
    });

    afterAll(async () => {
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        await University.deleteMany({});
        jest.clearAllMocks();
    });

    it('4. Apply with discovered domain — successful apply sends verification email and creates pending app', async () => {
        // Mock dataset lookup
        axios.get.mockResolvedValueOnce({
            data: [{ name: 'University of Example', country: 'US', domains: ['example.edu'], web_pages: [] }]
        });

        const payload = {
            country: 'US',
            universityName: 'University of Example',
            representative: { email: 'admin@example.edu', name: 'Dr Bob' }
        };

        const res = await request(app).post('/universities/apply').send(payload);

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('pending');
        expect(res.body.domains).toContain('example.edu');
        expect(res.body.message).toBe('verification_code_sent');
        // Because admin@example.edu matches example.edu, there should be no warning
        expect(res.body.warning).toBeNull();
    });

    it('5. Verify email happy path — valid code verifies and sets emailVerified true', async () => {
        const hash = await bcrypt.hash('123456', 10);
        const uni = await University.create({
            name: 'Test Uni',
            country: 'US',
            verification: {
                emailTokenHash: hash,
                tokenExpiry: new Date(Date.now() + 10000),
                externalLookup: { provider: 'hipo_labs' }
            }
        });

        const res = await request(app).post(`/universities/${uni._id}/verify-email`).send({ code: '123456' });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/verified/i);

        const dbUni = await University.findById(uni._id);
        expect(dbUni.verification.emailVerified).toBe(true);
        expect(dbUni.verified).toBe(true); // Should auto-verify because provider is hipo_labs
    });

    it('6. Domain mismatch warning', async () => {
        axios.get.mockResolvedValueOnce({
            data: [{ name: 'University of Example', country: 'US', domains: ['example.edu'], web_pages: [] }]
        });

        const payload = {
            country: 'US',
            universityName: 'University of Example',
            officialDomain: 'example.edu',
            representative: { email: 'admin@otherdomain.com', name: 'Dr Bob' }
        };

        const res = await request(app).post('/universities/apply').send(payload);

        expect(res.status).toBe(201);
        expect(res.body.warning).toBe('domain_mismatch');

        // Still saves the mismatch domain just in case
        const dbUni = await University.findById(res.body.applicationId);
        expect(dbUni.domains).toContain('otherdomain.com');
        expect(dbUni.domains).toContain('example.edu');
    });

    it('7. Upload fallback logic (No upstream matches)', async () => {
        axios.get.mockResolvedValueOnce({ data: [] }); // 0 matches

        const payload = {
            country: 'Unknown',
            universityName: 'Unknown Uni',
            representative: { email: 'admin@gmail.com', name: 'Dr Bob' }
        };

        const res = await request(app).post('/universities/apply').send(payload);

        expect(res.status).toBe(201);
        // With no domains returning and a free email, it flags to upload
        expect(res.body.warning).toBe('no_domain_found');
        expect(res.body.message).toBe('requires_upload_fallback');
    });

    it('8. Audit logs created for app lifecycle', async () => {
        axios.get.mockResolvedValueOnce({ data: [] });
        const res = await request(app).post('/universities/apply').send({
            country: 'CA', universityName: 'Log Uni', representative: { email: 'admin@log.ca' }
        });

        const statusRes = await request(app).get(`/universities/${res.body.applicationId}/status`);
        expect(statusRes.status).toBe(200);

        const logs = statusRes.body.data.auditLogs;
        expect(logs.length).toBeGreaterThan(0);
        expect(logs[0].action).toBe('university_apply');
    });
});
