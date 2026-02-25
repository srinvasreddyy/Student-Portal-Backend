const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Project = require('../src/models/Project');
const PortfolioItem = require('../src/models/PortfolioItem');
const config = require('../src/config');
const jwt = require('jsonwebtoken');

describe('Student Portfolio & File Streaming Hooks', () => {
    let studentToken;
    let companyToken;
    let studentId;
    let companyUserId;

    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) await mongoose.connect(config.db.uri);

        const std1 = await User.create({ email: 's_port@test.com', passwordHash: 'hash', role: 'student', status: 'active', name: 'John Doe' });
        studentId = std1._id;
        studentToken = jwt.sign({ id: std1._id, role: 'student', status: 'active' }, config.jwt.secret, { expiresIn: '15m' });

        const companyUser = await User.create({ email: 'c_port@test.com', passwordHash: 'hash', role: 'company_admin', status: 'active' });
        companyUserId = companyUser._id;
        companyToken = jwt.sign({ id: companyUser._id, role: 'company_admin', status: 'active' }, config.jwt.secret, { expiresIn: '15m' });

    });

    afterAll(async () => {
        // Cleanup GridFS on Exit simply by wiping db
        try {
            await mongoose.connection.db.dropDatabase();
        } catch (e) { }
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        await PortfolioItem.deleteMany({});
        await Project.deleteMany({});
    });

    it('1. Fails nicely when unsupported body is passed to Portfolio endpoint without file or URL', async () => {
        const res = await request(app).post('/students/me/portfolio').set('Authorization', `Bearer ${studentToken}`).send({ title: 'Missing URL/File' });
        expect(res.status).toBe(400);
    });

    it('2. Ingests Link-only github portfolios', async () => {
        const payload = { title: 'My Open Source', url: 'https://github.com/myrepo', tags: ['Backend'] };
        const res = await request(app).post('/students/me/portfolio').set('Authorization', `Bearer ${studentToken}`).send(payload);

        expect(res.status).toBe(201);
        expect(res.body.data.type).toBe('github'); // Auto detected by validator
        expect(res.body.data.url).toBe('https://github.com/myrepo');
    });

    it('3. Streams raw File Uploads gracefully directly into GridFS & parses MimeType', async () => {
        // We simulate a multipart/form-data upload using supertest attach
        const mockSvgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

        const res = await request(app)
            .post('/students/me/portfolio')
            .set('Authorization', `Bearer ${studentToken}`)
            .field('title', 'My Design File')
            .field('tags', 'svg, design')
            .attach('file', mockSvgContent, 'test.svg');

        expect(res.status).toBe(201);
        expect(res.body.data.originalName).toBe('test.svg');
        // Because <img> uploads are treated dynamically
        expect(res.body.data.storage).toBe('gridfs');
        expect(res.body.data.fileId).toBeDefined();

        // 4. Test the GridFS Range Download endpoints sequentially to verify existence
        const downloadRes = await request(app).get(`/students/me/portfolio/${res.body.data._id}/download`)
            .set('Authorization', `Bearer ${studentToken}`)
            .set('Range', 'bytes=0-10'); // Native HTTP Range

        expect(downloadRes.status).toBe(206); // Partial Content
        expect(downloadRes.headers['content-length']).toBe('11');

        // 5. Test Deletion flushes GridFS natively
        const delRes = await request(app).delete(`/students/me/portfolio/${res.body.data._id}`).set('Authorization', `Bearer ${studentToken}`);
        expect(delRes.status).toBe(204);

        const checkDownloadAfterDelete = await request(app).get(`/students/me/portfolio/${res.body.data._id}/download`).set('Authorization', `Bearer ${studentToken}`);
        expect(checkDownloadAfterDelete.status).toBe(404);
    });

    it('6. Phase 5 Integration -> Project Completion natively spawns Portfolio items directly', async () => {
        const p1 = await Project.create({
            authorRef: companyUserId, authorType: 'company', authorModel: 'Company',
            title: 'P1 Demo', description: 'desc', roles: ['SE'], maxStudents: 1, durationWeeks: 2,
            status: 'in_progress', acceptedStudents: [{ studentRef: studentId }]
        });

        const completeRes = await request(app)
            .post(`/projects/${p1._id}/complete`)
            .set('Authorization', `Bearer ${companyToken}`);

        expect(completeRes.status).toBe(200);

        // Expect the portfolio model to now hold an object for this student natively hooked
        const port = await PortfolioItem.findOne({ ownerRef: studentId, type: 'project' });
        expect(port).toBeDefined();
        expect(port.title).toBe('P1 Demo');
    });

});
