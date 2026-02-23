const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const Company = require('../src/models/Company');
const config = require('../src/config');
const axios = require('axios');
const bcrypt = require('bcrypt');

// Mock out external dependencies
jest.mock('axios');
jest.mock('nodemailer', () => ({
    createTransport: jest.fn().mockReturnValue({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' })
    }),
    getTestMessageUrl: jest.fn()
}));

// Setup app router for testing since it mounts routes in app.js
const companiesRoutes = require('../src/routes/companies');
app.use('/companies', companiesRoutes);

describe('Company Verification Subsystem', () => {
    beforeAll(async () => {
        // Only strictly for valid connection
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(config.db.uri || 'mongodb://localhost:27017/mern_db_test');
        }
    });

    afterAll(async () => {
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        await Company.deleteMany({});
        jest.clearAllMocks();
    });

    it('1. UK lookup success - saves company with companies_house provider', async () => {
        // Mock response matching UK Companies house
        axios.get.mockResolvedValueOnce({
            data: { company_name: 'ACME UK LTD', company_number: '12345678' }
        });

        const payload = {
            country: 'UK',
            companyNumber: '12345678',
            name: 'Acme',
            website: 'https://acme.co.uk',
            companyEmail: 'admin@acme.co.uk',
        };

        const res = await request(app).post('/companies/apply').send(payload);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.lookup.provider).toBe('companies_house');

        const company = await Company.findById(res.body.applicationId);
        expect(company.officialName).toBe('ACME UK LTD');
        expect(company.status).toBe('pending');
    });

    it('2. OpenCorporates success - saves company with opencorporates provider', async () => {
        // Mock global response
        axios.get.mockResolvedValueOnce({
            data: {
                results: {
                    companies: [{ company: { name: 'ACME GLOBAL US', company_number: 'US123' } }]
                }
            }
        });

        const payload = {
            country: 'US',
            name: 'ACME GLOBAL US',
            website: 'https://acme.com',
            companyEmail: 'admin@acme.com',
        };

        const res = await request(app).post('/companies/apply').send(payload);

        expect(res.status).toBe(201);
        expect(res.body.lookup.provider).toBe('opencorporates');

        const company = await Company.findById(res.body.applicationId);
        expect(company.officialName).toBe('ACME GLOBAL US');
        expect(company.companyNumber).toBe('US123');
    });

    it('3. Domain mismatch - responds with warning', async () => {
        axios.get.mockResolvedValueOnce({ data: { results: { companies: [] } } }); // No match

        const payload = {
            country: 'IN',
            name: 'Acme India',
            website: 'https://acme.in',
            companyEmail: 'admin@otherdomain.com', // Mismatch
        };

        const res = await request(app).post('/companies/apply').send(payload);

        expect(res.status).toBe(201);
        expect(res.body.warning).toBe('domain_mismatch');
    });

    it('4. Email Verification Success - sets emailVerified true', async () => {
        const code = '123456';
        const hash = await bcrypt.hash(code, 10);

        const company = await Company.create({
            country: 'UK',
            status: 'pending',
            verification: {
                emailTokenHash: hash,
                tokenExpiry: new Date(Date.now() + 10000), // future
                externalLookup: { provider: 'companies_house' }
            }
        });

        const res = await request(app).post(`/companies/${company._id}/verify-email`).send({ code });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('verified'); // auto verified since provider is rigid

        const updated = await Company.findById(company._id);
        expect(updated.verification.emailVerified).toBe(true);
    });

    it('5. Expired Token - returns error', async () => {
        const code = '123456';
        const hash = await bcrypt.hash(code, 10);

        const company = await Company.create({
            country: 'US',
            status: 'pending',
            verification: {
                emailTokenHash: hash,
                tokenExpiry: new Date(Date.now() - 10000), // past
            }
        });

        const res = await request(app).post(`/companies/${company._id}/verify-email`).send({ code });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('token_expired');
    });

    it('6. Audit logs - tracks apply event', async () => {
        axios.get.mockResolvedValueOnce({ data: { results: { companies: [] } } });

        const payload = {
            country: 'CA',
            name: 'Acme Canada',
            website: 'https://acme.ca',
            companyEmail: 'admin@acme.ca',
        };

        const res = await request(app).post('/companies/apply').send(payload);
        const company = await Company.findById(res.body.applicationId);

        expect(company.auditLogs.length).toBeGreaterThan(0);
        expect(company.auditLogs[0].action).toBe('company_apply');
    });

    it('7. No match fallback - requires upload', async () => {
        axios.get.mockResolvedValueOnce({ data: { results: { companies: [] } } });

        const payload = {
            country: 'JP',
            name: 'Acme Japan',
            website: 'https://acme.jp',
            companyEmail: 'admin@acme.jp',
        };

        const res = await request(app).post('/companies/apply').send(payload);
        expect(res.status).toBe(201);
        expect(res.body.lookup.provider).toBe('opencorporates_no_match');

        // Test the upload-doc boundary (mock validation failure for ease)
        const uploadRes = await request(app).post(`/companies/${res.body.applicationId}/upload-doc`);
        expect(uploadRes.status).toBe(400); // 400 since no file attached, but route exists
    });
});
