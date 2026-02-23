const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const EmailSendAttempt = require('../src/models/EmailSendAttempt');
const mailerService = require('../src/services/mailer');
const emailJobProcessor = require('../src/jobs/emailJobProcessor');

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
    await mongoose.connection.close();
    await mongoServer.stop();
});

describe('Mailer Retry and Processor Worker', () => {

    afterEach(async () => {
        await EmailSendAttempt.deleteMany({});
    });

    test('should requeue and backoff on transient failure', async () => {
        const doc = await EmailSendAttempt.create({
            to: 'reject@test.com',
            subject: 'Fail me',
            status: 'queued',
            templateName: 'verify_email'
        });

        // Mock the transporter inside mailerService to throw an error
        mailerService.init = jest.fn().mockResolvedValue();
        mailerService.transporter = {
            sendMail: jest.fn().mockRejectedValue({ message: 'SMTP Error Timeout', responseCode: 421 })
        };

        // Manually run a queue pass
        await emailJobProcessor.processQueue();

        // Check it failed and retried
        const updated = await EmailSendAttempt.findById(doc._id);
        expect(updated.status).toBe('queued'); // Still queued waiting for backoff
        expect(updated.attempts).toBe(1);
        expect(updated.lastError).toMatch(/SMTP Error/);
    });

    test('should eventually fail permanently after max retries', async () => {
        const doc = await EmailSendAttempt.create({
            to: 'reject2@test.com',
            subject: 'Fail me hard',
            status: 'queued',
            attempts: 3, // At max limit before this pass
            templateName: 'verify_email'
        });

        // Force ready condition by manipulating updatedAt to bypass backoff
        await EmailSendAttempt.updateOne({ _id: doc._id }, { $set: { updatedAt: new Date(1) } });

        mailerService.init = jest.fn().mockResolvedValue();
        mailerService.transporter = {
            sendMail: jest.fn().mockRejectedValue(new Error('Persistent failure'))
        };

        await emailJobProcessor.processQueue();

        const finalDoc = await EmailSendAttempt.findById(doc._id);
        expect(finalDoc.status).toBe('failed');
        expect(finalDoc.attempts).toBe(4);
    });

    test('should send successfully and mark sent', async () => {
        const doc = await EmailSendAttempt.create({
            to: 'success@test.com',
            subject: 'Pass me',
            status: 'queued',
            templateName: 'verify_email'
        });

        mailerService.init = jest.fn().mockResolvedValue();
        mailerService.transporter = {
            sendMail: jest.fn().mockResolvedValue({ messageId: 'm123', response: '250 OK' })
        };

        await emailJobProcessor.processQueue();

        const successDoc = await EmailSendAttempt.findById(doc._id);
        expect(successDoc.status).toBe('sent');
        expect(successDoc.messageId).toBe('m123');
        expect(successDoc.attempts).toBe(1);
    });
});
