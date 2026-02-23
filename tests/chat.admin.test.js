const request = require('supertest');
const app = require('../src/app');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Project = require('../src/models/Project');
const ChatMessage = require('../src/models/ChatMessage');
const TokenUtils = require('../src/utils/tokenUtils');

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
    await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

describe('Super Admin Chat Moderation (Phase 10)', () => {

    let studentToken;
    let otherStudentToken;
    let adminToken;
    let projectId;
    let messageId;

    beforeAll(async () => {
        const student = await User.create({ email: 's1@chat.com', passwordHash: 'hash', role: 'student', status: 'active' });
        studentToken = TokenUtils.generateAccessToken(student);

        const otherStudent = await User.create({ email: 's2@chat.com', passwordHash: 'hash', role: 'student', status: 'active' });
        otherStudentToken = TokenUtils.generateAccessToken(otherStudent);

        const admin = await User.create({ email: 'admin@chat.com', passwordHash: 'hash', role: 'super_admin', status: 'active' });
        adminToken = TokenUtils.generateAccessToken(admin);

        const project = await Project.create({
            title: 'Test Project',
            description: 'Desc',
            roles: ['developer'],
            authorRef: new mongoose.Types.ObjectId(),
            authorModel: 'Company',
            authorType: 'company',
            durationWeeks: 4,
            maxStudents: 5,
            status: 'in_progress',
            slots: 2,
            acceptedStudents: [{ studentRef: student._id }, { studentRef: otherStudent._id }]
        });
        projectId = project._id;

        const message = await ChatMessage.create({
            projectId: project._id,
            senderRef: student._id,
            senderName: 'Student 1',
            text: 'Hello world'
        });
        messageId = message._id;
    });

    test('Another student cannot delete someone else\'s message', async () => {
        const res = await request(app)
            .delete(`/chat/projects/${projectId}/messages/${messageId}`)
            .set('Authorization', `Bearer ${otherStudentToken}`);

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/Forbidden/i);
    });

    test('Student can delete their own message', async () => {
        // Create a new message just for this test
        const msg = await ChatMessage.create({
            projectId,
            senderRef: (await User.findOne({ email: 's1@chat.com' }))._id,
            senderName: 'Student 1',
            text: 'My Message'
        });

        const res = await request(app)
            .delete(`/chat/projects/${projectId}/messages/${msg._id}`)
            .set('Authorization', `Bearer ${studentToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.deleted).toBe(true);
        expect(res.body.data.text).toBe('This message was deleted');
    });

    test('Super Admin can force delete ANY message', async () => {
        // messageId was created by s1@chat.com
        const res = await request(app)
            .delete(`/chat/projects/${projectId}/messages/${messageId}`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.deleted).toBe(true);
        expect(res.body.data.text).toBe('This message was deleted');
    });

});
