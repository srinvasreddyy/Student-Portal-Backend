const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Project = require('../src/models/Project');
const config = require('../src/config');
const jwt = require('jsonwebtoken');

describe('Project Acceptance Concurrency (Transactions)', () => {
    let companyToken;
    let projId;
    let student1Id, student2Id;

    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) await mongoose.connect(config.db.uri);

        const companyUser = await User.create({ email: 'comp_concur@test.com', passwordHash: 'hash', role: 'company_admin', status: 'active', organizationId: new mongoose.Types.ObjectId() });
        companyToken = jwt.sign({ id: companyUser._id, role: 'company_admin', status: 'active', organizationId: companyUser._id }, config.jwt.secret, { expiresIn: '15m' });

        const std1 = await User.create({ email: 'c1@test.com', passwordHash: 'hash', role: 'student', status: 'active' });
        student1Id = std1._id;

        const std2 = await User.create({ email: 'c2@test.com', passwordHash: 'hash', role: 'student', status: 'active' });
        student2Id = std2._id;
    });

    afterAll(async () => { await mongoose.connection.close(); });
    beforeEach(async () => {
        await Project.deleteMany({});
        await User.updateMany({}, { $unset: { activeProjectRef: 1 } });

        // Single slot project
        const p = await Project.create({
            authorRef: jwt.decode(companyToken).organizationId,
            authorType: 'company',
            authorModel: 'Company',
            title: 'High Demand Project',
            description: 'desc',
            roles: ['SE'],
            maxStudents: 1,  // CRUCIAL: only 1 slot
            durationWeeks: 2,
            status: 'open',
            applicants: [
                { studentRef: student1Id },
                { studentRef: student2Id }
            ]
        });
        projId = p._id;
    });

    it('Concurrency Check: Two concurrent accepts -> only one succeeds, other receives no_slots', async () => {
        // Note: For MongoDB transactions to exhibit write conflicts accurately in a test environment,
        // it strictly requires ReplicaSets. An isolated memory mongod or standalone local DB might
        // artificially serialize everything or outright fail. The core logic handles TransientTransactionErrors
        // under load if it occurs utilizing our retry helper under `utils/transactionUtils.js`.

        // Fire both HTTP requests in parallel
        const [res1, res2] = await Promise.all([
            request(app).post(`/projects/${projId}/accept`).set('Authorization', `Bearer ${companyToken}`).send({ studentRef: student1Id }),
            request(app).post(`/projects/${projId}/accept`).set('Authorization', `Bearer ${companyToken}`).send({ studentRef: student2Id })
        ]);

        // Evaluate results: one SHOULD be 200 OK, the other 409 Conflict ('no_slots')
        const responses = [res1, res2];
        const successRes = responses.find(r => r.status === 200);
        const failRes = responses.find(r => r.status === 409);

        expect(successRes).toBeDefined();
        expect(failRes).toBeDefined();

        expect(successRes.body.accepted).toBe(true);
        expect(failRes.body.message).toBe('no_slots');

        // Check DB state exactly 1 slot filled
        const project = await Project.findById(projId);
        expect(project.acceptedStudents.length).toBe(1);
        expect(project.status).toBe('in_progress'); // Marked full

        // Ensure only one student got active state assigned
        const u1 = await User.findById(student1Id);
        const u2 = await User.findById(student2Id);

        const totalActive = (u1.activeProjectRef ? 1 : 0) + (u2.activeProjectRef ? 1 : 0);
        expect(totalActive).toBe(1);
    });
});
