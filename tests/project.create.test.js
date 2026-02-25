const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Project = require('../src/models/Project');
const config = require('../src/config');
const jwt = require('jsonwebtoken');

describe('Project Create Flow', () => {
    let companyToken;
    let studentToken;
    let companyAdminId;

    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) await mongoose.connect(config.db.uri);

        const companyUser = await User.create({ email: 'company@test.com', passwordHash: 'hash', role: 'company_admin', status: 'active' });
        companyAdminId = companyUser._id;
        companyToken = jwt.sign({ id: companyUser._id, role: 'company_admin', status: 'active' }, config.jwt.secret, { expiresIn: '15m' });

        const stdUser = await User.create({ email: 'studentX@test.com', passwordHash: 'hash', role: 'student', status: 'active' });
        studentToken = jwt.sign({ id: stdUser._id, role: 'student', status: 'active' }, config.jwt.secret, { expiresIn: '15m' });
    });

    afterAll(async () => { await mongoose.connection.close(); });
    beforeEach(async () => { await Project.deleteMany({}); });

    it('1. Create project validates payload constraints', async () => {
        const payload = {
            title: 'Test Project',
            description: 'A great project',
            roles: ['Frontend'],
            maxStudents: 0, // invalid
            durationWeeks: 5  // invalid
        };
        const res = await request(app).post('/projects').set('Authorization', `Bearer ${companyToken}`).send(payload);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/max|duration/i);
    });

    it('2. Students cannot create projects', async () => {
        const payload = { title: 'Test', description: 'Desc', roles: ['Backend'], maxStudents: 2, durationWeeks: 4 };
        const res = await request(app).post('/projects').set('Authorization', `Bearer ${studentToken}`).send(payload);
        expect(res.status).toBe(403);
    });

    it('3. Successful project creation by authorized company', async () => {
        const payload = { title: 'Awesome Project', description: 'Desc', roles: ['Backend'], maxStudents: 2, durationWeeks: 3 };
        const res = await request(app).post('/projects').set('Authorization', `Bearer ${companyToken}`).send(payload);

        expect(res.status).toBe(201);
        expect(res.body.data.authorType).toBe('company');
        expect(res.body.data.status).toBe('open');
        expect(res.body.data.title).toBe('Awesome Project');

        const inDb = await Project.findById(res.body.data._id);
        expect(inDb.authorRef.toString()).toBe(companyAdminId.toString());
    });
});
