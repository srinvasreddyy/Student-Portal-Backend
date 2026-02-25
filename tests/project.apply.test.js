const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Project = require('../src/models/Project');
const config = require('../src/config');
const jwt = require('jsonwebtoken');

describe('Project Apply & Complete Lifecycle', () => {
    let companyToken, studentToken1, studentToken2, student1Id, student2Id, companyUserId;
    let projId, proj2Id;

    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) await mongoose.connect(config.db.uri);

        const companyUser = await User.create({ email: 'company@test.com', passwordHash: 'hash', role: 'company_admin', status: 'active', organizationId: new mongoose.Types.ObjectId() });
        companyUserId = companyUser._id;
        companyToken = jwt.sign({ id: companyUser._id, role: 'company_admin', status: 'active', organizationId: companyUserId }, config.jwt.secret, { expiresIn: '15m' });

        const std1 = await User.create({ email: 's1@test.com', passwordHash: 'hash', role: 'student', status: 'active', portfolio: [] });
        student1Id = std1._id;
        studentToken1 = jwt.sign({ id: std1._id, role: 'student', status: 'active' }, config.jwt.secret, { expiresIn: '15m' });

        const std2 = await User.create({ email: 's2@test.com', passwordHash: 'hash', role: 'student', status: 'active' });
        student2Id = std2._id;
        studentToken2 = jwt.sign({ id: std2._id, role: 'student', status: 'active' }, config.jwt.secret, { expiresIn: '15m' });
    });

    afterAll(async () => { await mongoose.connection.close(); });
    beforeEach(async () => {
        await Project.deleteMany({});
        await User.updateMany({}, { $unset: { activeProjectRef: 1 } }); // Reset users
        const p1 = await Project.create({ authorRef: companyUserId, authorType: 'company', authorModel: 'Company', title: 'P1', description: 'desc', roles: ['SE'], maxStudents: 1, durationWeeks: 2, status: 'open' });
        const p2 = await Project.create({ authorRef: companyUserId, authorType: 'company', authorModel: 'Company', title: 'P2', description: 'desc', roles: ['FE'], maxStudents: 2, durationWeeks: 2, status: 'open' });
        projId = p1._id;
        proj2Id = p2._id;
    });

    it('1. Student applies to open open project successfully', async () => {
        const res = await request(app).post(`/projects/${projId}/apply`).set('Authorization', `Bearer ${studentToken1}`);
        expect(res.status).toBe(200);
        expect(res.body.applied).toBe(true);

        const project = await Project.findById(projId);
        expect(project.applicants.length).toBe(1);
        expect(project.applicants[0].studentRef.toString()).toBe(student1Id.toString());
    });

    it('2. Student cannot apply twice', async () => {
        await request(app).post(`/projects/${projId}/apply`).set('Authorization', `Bearer ${studentToken1}`);
        const res2 = await request(app).post(`/projects/${projId}/apply`).set('Authorization', `Bearer ${studentToken1}`);

        expect(res2.status).toBe(400);
        expect(res2.body.message).toBe('already_applied');
    });

    it('3. Withdraw application logic', async () => {
        await request(app).post(`/projects/${projId}/apply`).set('Authorization', `Bearer ${studentToken1}`);
        const withdrawRes = await request(app).post(`/projects/${projId}/withdraw`).set('Authorization', `Bearer ${studentToken1}`);
        expect(withdrawRes.status).toBe(200);

        const project = await Project.findById(projId);
        expect(project.applicants.length).toBe(0);
    });

    it('4. Owner accepts student - sets active project and cleans pending', async () => {
        // Apply to both projects
        await request(app).post(`/projects/${projId}/apply`).set('Authorization', `Bearer ${studentToken1}`);
        await request(app).post(`/projects/${proj2Id}/apply`).set('Authorization', `Bearer ${studentToken1}`);

        // Accept on P1
        const acceptRes = await request(app).post(`/projects/${projId}/accept`)
            .set('Authorization', `Bearer ${companyToken}`).send({ studentRef: student1Id });

        expect(acceptRes.status).toBe(200);
        expect(acceptRes.body.accepted).toBe(true);

        const p1 = await Project.findById(projId);
        expect(p1.acceptedStudents.length).toBe(1);
        expect(p1.applicants.length).toBe(0);

        // Because maxStudents=1, status should auto switch to in_progress
        expect(p1.status).toBe('in_progress');

        // Check if student was removed from P2 applicants (the cleanup across other projects)
        const p2 = await Project.findById(proj2Id);
        expect(p2.applicants.length).toBe(0);

        // Check activeProjectRef attached to user
        const u = await User.findById(student1Id);
        expect(u.activeProjectRef.toString()).toBe(projId.toString());
    });

    it('5. Cannot apply if student is active somewhere else', async () => {
        // Mock active project state
        await User.findByIdAndUpdate(student1Id, { activeProjectRef: new mongoose.Types.ObjectId() });
        const res = await request(app).post(`/projects/${projId}/apply`).set('Authorization', `Bearer ${studentToken1}`);
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('student_already_active');
    });

    it('6. Complete Project flow', async () => {
        // Setup accepted active
        await request(app).post(`/projects/${projId}/apply`).set('Authorization', `Bearer ${studentToken1}`);
        await request(app).post(`/projects/${projId}/accept`).set('Authorization', `Bearer ${companyToken}`).send({ studentRef: student1Id });

        // Complete the project
        const completeRes = await request(app).post(`/projects/${projId}/complete`).set('Authorization', `Bearer ${companyToken}`);
        expect(completeRes.status).toBe(200);

        const p1 = await Project.findById(projId);
        expect(p1.status).toBe('completed');

        // Verify active status cleared and portoflio updated
        const u = await User.findById(student1Id);
        expect(u.activeProjectRef).toBeUndefined(); // Unset

        const items = await mongoose.model('PortfolioItem').find({ ownerRef: student1Id });
        expect(items.length).toBeGreaterThan(0);
        expect(items[0].url).toContain(projId.toString());
    });
});
