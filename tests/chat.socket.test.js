const mongoose = require('mongoose');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { createServer } = require('http');
const { initSocketServer } = require('../src/sockets');
const { generateTokens } = require('../src/utils/tokenUtils');
const User = require('../src/models/User');
const Project = require('../src/models/Project');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let io, serverSocket, clientSocket;
let httpServer;
let testUser, testProject, validToken;
let port;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    httpServer = createServer();
    io = initSocketServer(httpServer);

    await new Promise((resolve) => {
        httpServer.listen(() => {
            port = httpServer.address().port;
            resolve();
        });
    });

    testUser = await User.create({
        email: 'test@student.com',
        passwordHash: 'hashedpwd',
        role: 'student',
        status: 'active',
        profile: { firstName: 'Test', lastName: 'Student' }
    });

    const tokens = generateTokens(testUser);
    validToken = tokens.accessToken;

    testProject = await Project.create({
        authorRef: new mongoose.Types.ObjectId(),
        authorType: 'company',
        authorModel: 'Company',
        title: 'Test Project',
        description: 'Testing chat',
        roles: ['Developer'],
        maxStudents: 5,
        durationWeeks: 4,
        status: 'in_progress',
        acceptedStudents: [{ studentRef: testUser._id }]
    });
});

afterAll(async () => {
    if (io) io.close();
    if (clientSocket) clientSocket.close();
    if (mongoose.connection.readyState) {
        await mongoose.connection.close();
    }
    if (mongoServer) {
        await mongoServer.stop();
    }
});

describe('Socket.io Integration Tests', () => {
    test('should reject unauthenticated connections', (done) => {
        const socket = new Client(`http://localhost:${port}`);
        socket.on('connect_error', (err) => {
            expect(err.message).toMatch(/Authentication error/);
            socket.close();
            done();
        });
    });

    test('should accept authenticated connections', (done) => {
        clientSocket = new Client(`http://localhost:${port}`, {
            auth: { token: `Bearer ${validToken}` }
        });

        clientSocket.on('connect', () => {
            expect(clientSocket.connected).toBe(true);
            done();
        });
    });

    test('authorized user can join project room', (done) => {
        clientSocket.emit('room:join', { projectId: testProject._id.toString() }, (response) => {
            expect(response.success).toBe(true);
            expect(response.room).toBe(`project:${testProject._id.toString()}`);
            done();
        });
    });

    test('unauthorized user cannot join project room', (done) => {
        const unauthorizedUser = new mongoose.Types.ObjectId();
        const tokens = generateTokens({ _id: unauthorizedUser, role: 'student', email: 'unauth@test.com', status: 'active' });

        const badClient = new Client(`http://localhost:${port}`, {
            auth: { token: `Bearer ${tokens.accessToken}` }
        });

        badClient.on('connect', () => {
            // Let's create a temp user in DB to pass socketAuth (which queries DB)
            User.create({
                _id: unauthorizedUser,
                email: 'unauth@test.com',
                passwordHash: 'xx',
                role: 'student',
                status: 'active'
            }).then(() => {
                badClient.emit('room:join', { projectId: testProject._id.toString() }, (response) => {
                    expect(response.success).toBe(false);
                    expect(response.error).toMatch(/Unauthorized/);
                    badClient.close();
                    done();
                });
            });
        });
    });

    test('receives broadcast message when another user sends', (done) => {
        // Re-joining just to ensure state
        clientSocket.emit('room:join', { projectId: testProject._id.toString() }, () => {

            // We simulate "another user" sending by just having the same user send a msg 
            // and capturing the broadast event message:new
            clientSocket.on('message:new', (msg) => {
                expect(msg.text).toBe('Hello World');
                expect(msg.senderRef).toBe(testUser._id.toString());
                done();
            });

            clientSocket.emit('message:send', {
                projectId: testProject._id.toString(),
                text: 'Hello World'
            }, (response) => {
                expect(response.success).toBe(true);
                expect(response.messageId).toBeDefined();
            });
        });
    });
});
