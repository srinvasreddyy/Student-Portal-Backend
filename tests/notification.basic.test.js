const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const notificationService = require('../src/services/notificationService');
const Notification = require('../src/models/Notification');
const EmailSendAttempt = require('../src/models/EmailSendAttempt');

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create();
    await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
    await mongoose.connection.close();
    await mongoServer.stop();
});

describe('Notification Service', () => {
    let globalUserId;

    beforeAll(() => {
        globalUserId = new mongoose.Types.ObjectId();
    });

    afterEach(async () => {
        await Notification.deleteMany({});
        await EmailSendAttempt.deleteMany({});
    });

    test('should create in-app notification without email', async () => {
        const result = await notificationService.createNotificationAndEmail({
            userRef: globalUserId,
            type: 'system_alert',
            title: 'Test Notification',
            body: 'This is a test',
            sendEmail: false
        });

        expect(result.notificationId).toBeDefined();
        expect(result.emailAttemptId).toBeNull();

        const saved = await Notification.findById(result.notificationId);
        expect(saved.title).toBe('Test Notification');
        expect(saved.deliveredEmail).toBe(false);
    });

    test('should list notifications with pagination', async () => {
        // Create 5 unread notifications
        for (let i = 0; i < 5; i++) {
            await Notification.create({
                userRef: globalUserId,
                type: 'info',
                title: `Msg ${i}`,
                body: '...',
                read: false
            });
        }

        const list = await notificationService.listNotifications(globalUserId, 1, 3);
        expect(list.data.length).toBe(3);
        expect(list.total).toBe(5);
        expect(list.pages).toBe(2);
    });

    test('should mark notifications as read', async () => {
        const n1 = await Notification.create({ userRef: globalUserId, type: 'info', title: '1', body: '1' });
        const n2 = await Notification.create({ userRef: globalUserId, type: 'info', title: '2', body: '2' });

        const count = await notificationService.markRead(globalUserId, [n1._id, n2._id]);
        expect(count).toBe(2);

        const unreadList = await notificationService.listNotifications(globalUserId, 1, 10, true);
        expect(unreadList.data.length).toBe(0); // all read
    });

    test('should create notification and enqueue email successfully', async () => {
        // Create mock user so email lookup works
        const User = require('../src/models/User');
        await User.create({
            _id: globalUserId,
            email: 'test@notif.com',
            passwordHash: 'xx',
            role: 'student'
        });

        const result = await notificationService.createNotificationAndEmail({
            userRef: globalUserId,
            type: 'system_alert',
            title: 'Email Alert',
            body: 'Test',
            sendEmail: true,
            templateName: 'verify_email',
            templatePayload: { userName: 'TestUser', verificationLink: 'http' }
        });

        expect(result.notificationId).toBeDefined();
        expect(result.emailAttemptId).toBeDefined();

        const attempt = await EmailSendAttempt.findById(result.emailAttemptId);
        expect(attempt.status).toBe('queued');
        expect(attempt.to).toBe('test@notif.com');
        expect(attempt.templateName).toBe('verify_email');
    });
});
