const mongoose = require('mongoose');
const chatService = require('../src/services/chatService');
const ChatMessage = require('../src/models/ChatMessage');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create();
    await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
    await mongoose.connection.close();
    await mongoServer.stop();
});

describe('Chat Persistence and Pagination', () => {
    let projectId;
    let userRef;

    beforeAll(async () => {
        projectId = new mongoose.Types.ObjectId();
        userRef = new mongoose.Types.ObjectId();

        // Seed 100 messages for the project
        const ops = [];
        for (let i = 0; i < 100; i++) {
            // slightly offset createdAt for reliable sort testing
            const createdAt = new Date(Date.now() - (100 - i) * 1000);
            ops.push({
                projectId,
                senderRef: userRef,
                senderName: `Test User ${i}`,
                text: `Message ${i}`,
                createdAt
            });
        }
        await ChatMessage.insertMany(ops);
    });

    test('can retrieve paginated messages', async () => {
        // Fetch first page (most recent 20)
        const limit = 20;
        const page1 = await chatService.getMessages(projectId, limit);

        expect(page1.length).toBe(20);
        // The most recent message should be 'Message 99'
        expect(page1[0].text).toBe('Message 99');
        // The last message in page 1 should be 'Message 80'
        expect(page1[19].text).toBe('Message 80');

        // Fetch second page using cursor of the last message in page 1
        const beforeId = page1[19]._id;
        const beforeDate = page1[19].createdAt;

        const page2 = await chatService.getMessages(projectId, limit, beforeId, beforeDate);
        expect(page2.length).toBe(20);
        expect(page2[0].text).toBe('Message 79');
        expect(page2[19].text).toBe('Message 60');
    });

    test('can save new message and attach file metadata', async () => {
        const saved = await chatService.saveMessage({
            projectId,
            senderRef: userRef,
            senderName: 'Attachment Tester',
            text: 'Check this out',
            attachments: []
        });

        expect(saved._id).toBeDefined();

        const fileData = {
            fileId: new mongoose.Types.ObjectId(),
            filename: 'test.png',
            mimeType: 'image/png',
            size: 1024
        };

        const updated = await chatService.attachFileToMessage(saved._id, fileData);
        expect(updated.attachments.length).toBe(1);
        expect(updated.attachments[0].filename).toBe('test.png');
    });
});
