const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const StudentProfile = require('../src/models/StudentProfile');
const config = require('../src/config');
const jwt = require('jsonwebtoken');

describe('Student Profile CRUD Flows', () => {
    let studentToken;
    let studentId;

    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) await mongoose.connect(config.db.uri);
        const std1 = await User.create({ email: 'p1@test.com', passwordHash: 'hash', role: 'student', status: 'active', name: 'John Doe' });
        studentId = std1._id;
        studentToken = jwt.sign({ id: std1._id, role: 'student', status: 'active' }, config.jwt.secret, { expiresIn: '15m' });
    });

    afterAll(async () => { await mongoose.connection.close(); });
    beforeEach(async () => {
        await StudentProfile.deleteMany({});
    });

    it('1. Fetches an empty profile by default natively upserting it', async () => {
        const res = await request(app).get('/students/me').set('Authorization', `Bearer ${studentToken}`);
        expect(res.status).toBe(200);
        expect(res.body.data.userRef.toString()).toBe(studentId.toString());
        expect(res.body.data.education.length).toBe(0);
    });

    it('2. Updates profile arrays seamlessly', async () => {
        const payload = {
            bio: 'A passionate developer',
            techStack: ['React', 'Node.js', 'MongoDB'],
            education: [{
                institution: 'MIT',
                degree: 'BSc',
                field: 'Computer Science',
                startYear: 2020,
                endYear: 2024
            }],
            experience: [{
                title: 'Intern',
                company: 'TechCorp',
                description: 'Coded stuff'
            }],
            privacy: { publicProfile: true, portfolioPublic: true }
        };

        const res = await request(app).put('/students/me').set('Authorization', `Bearer ${studentToken}`).send(payload);
        expect(res.status).toBe(200);
        expect(res.body.data.bio).toBe('A passionate developer');
        expect(res.body.data.techStack).toContain('Node.js');
        expect(res.body.data.education[0].institution).toBe('MIT');
    });

    it('3. Public access blocks hidden profiles', async () => {
        await StudentProfile.create({ userRef: studentId, privacy: { publicProfile: false } });

        const res = await request(app).get(`/students/${studentId}/profile`);
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/private/i);
    });
});
