const { Server } = require('socket.io');
const socketAuth = require('../middleware/socketAuth');
const { withRateLimit } = require('../middleware/socketRateLimiter');
const { filterProfanity } = require('../middleware/profanityFilter');
const chatService = require('../services/chatService');
const xss = require('xss');
const logger = require('../utils/logger');
// const { createAdapter } = require('@socket.io/redis-adapter');
// const { createClient } = require('redis');

/**
 * Socket.IO Documentation Consulted:
 * Auth & Middleware: https://socket.io/docs/v4/middlewares/
 * Rooms: https://socket.io/docs/v4/rooms/
 * Redis Adapter: https://socket.io/docs/v4/redis-adapter/
 * Emitting events: https://socket.io/docs/v4/emitting-events/
 */

function initSocketServer(httpServer, options = {}) {
    const io = new Server(httpServer, {
        cors: {
            origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
            methods: ['GET', 'POST']
        }
    });

    /**
     * SCALING WITH REDIS ADAPTER (Commented out for local execution without Redis requirement)
     * 
     * To scale Socket.IO across multiple Node instances (horizontal scaling), 
     * you need a Pub/Sub mechanism so an event emitted on Server A reaches clients on Server B.
     * 
     * Tradeoffs: 
     * - Free/self-hosted: Run a local Redis instance (`redis-server`). High performance, but you manage it.
     * - Managed/Paid: Use Redis Labs or AWS ElastiCache. Easier ops, but costs money.
     * 
     * Setup Code:
     * if (options.redisUrl || process.env.REDIS_URL) {
     *     const pubClient = createClient({ url: options.redisUrl || process.env.REDIS_URL });
     *     const subClient = pubClient.duplicate();
     *     Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
     *         io.adapter(createAdapter(pubClient, subClient));
     *         logger.info('Socket.IO Redis Adapter initialized.');
     *     });
     * }
     */

    // 1. Authentication Middleware
    io.use(socketAuth);

    io.on('connection', (socket) => {
        logger.info(`Socket connected: User ${socket.user.id} (Role: ${socket.user.role}) - Socket ID: ${socket.id}`);

        /**
         * Room Lifecycle - Joining a Project Room
         * Client request: socket.emit('room:join', { projectId: 'xxx' })
         */
        socket.on('room:join', async (payload, ack) => {
            try {
                const { projectId } = payload;
                if (!projectId) {
                    if (ack) return ack({ success: false, error: 'Missing projectId' });
                    return;
                }

                // Verify ACL: Is user allowed to join this project room?
                const isAuthorized = await chatService.checkUserRoomAccess(socket.user.id, socket.user.role, projectId);

                if (!isAuthorized) {
                    logger.warn(`User ${socket.user.id} attempted to join unauthorized room project:${projectId}`);
                    if (ack) return ack({ success: false, error: 'Unauthorized to join room' });
                    return;
                }

                const roomName = `project:${projectId}`;
                socket.join(roomName);
                logger.info(`Socket ${socket.id} (User ${socket.user.id}) joined room ${roomName}`);

                if (ack) ack({ success: true, room: roomName });

                // Optional: broadcast to room that someone joined
                // socket.to(roomName).emit('room:member_joined', { userId: socket.user.id, name: socket.user.name });

            } catch (err) {
                logger.error(`Error joining room: ${err.message}`);
                if (ack) ack({ success: false, error: 'Internal server error while joining room' });
            }
        });

        /**
         * Message Events - Sending a message
         * Wrapped with Rate Limiter
         */
        socket.on('message:send', withRateLimit(async (payload, ack) => {
            try {
                const { projectId, text, attachments } = payload;

                if (!projectId || (!text && (!attachments || attachments.length === 0))) {
                    if (ack) return ack({ success: false, error: 'Invalid message payload' });
                    return;
                }

                const roomName = `project:${projectId}`;
                // Check if socket is actually in the room (basic sub check)
                if (!socket.rooms.has(roomName)) {
                    if (ack) return ack({ success: false, error: 'You must join the room before sending messages' });
                    return;
                }

                // Sanitize input (prevent XSS)
                let sanitizedText = xss(text || '');

                // Profanity filter
                const { sanitized, blocked, error: filterErr } = filterProfanity(sanitizedText, 'block');
                if (blocked) {
                    if (ack) return ack({ success: false, error: filterErr });
                    return;
                }
                sanitizedText = sanitized;

                // Persist message to DB via ChatService
                const savedMessage = await chatService.saveMessage({
                    projectId,
                    senderRef: socket.user.id,
                    senderName: socket.user.name,
                    text: sanitizedText,
                    attachments: attachments || [] // Expecting Array of { fileId, filename, mimeType, size }
                });

                // Broadcast to the room
                io.to(roomName).emit('message:new', savedMessage);

                // Return ack to sender
                if (ack) ack({ success: true, messageId: savedMessage._id, timestamp: savedMessage.createdAt });

                // Handle offline notifications (async, fire-and-forget)
                // Passing the 'io' instance or using interconnected service to find offline members
                chatService.handleOfflineNotifications(projectId, savedMessage, io).catch(e => logger.error(`Offline notify fail: ${e.message}`));

            } catch (err) {
                logger.error(`Error sending message: ${err.message}`);
                if (ack) ack({ success: false, error: 'Internal error sending message' });
            }
        }, socket));

        /**
         * Typing Indicators
         */
        socket.on('typing:start', (payload) => {
            const { projectId } = payload;
            if (projectId && socket.rooms.has(`project:${projectId}`)) {
                socket.to(`project:${projectId}`).emit('typing:start', { userId: socket.user.id, name: socket.user.name });
            }
        });

        socket.on('typing:stop', (payload) => {
            const { projectId } = payload;
            if (projectId && socket.rooms.has(`project:${projectId}`)) {
                socket.to(`project:${projectId}`).emit('typing:stop', { userId: socket.user.id });
            }
        });

        /**
         * Message Editing & Deletion
         */
        socket.on('message:delete', async (payload, ack) => {
            try {
                const { projectId, messageId } = payload;
                if (!projectId || !messageId) {
                    if (ack) return ack({ success: false, error: 'Missing parameters' });
                    return;
                }

                const roomName = `project:${projectId}`;
                if (!socket.rooms.has(roomName) && socket.user.role !== 'super_admin') {
                    if (ack) return ack({ success: false, error: 'Must join room first' });
                    return;
                }

                // Delete via ChatService (handles authorization internally)
                const deletedMsg = await chatService.deleteMessage(messageId, socket.user.id, socket.user.role, projectId);

                // Broadcast deletion to all connected clients in the room
                io.to(roomName).emit('message:deleted', { messageId: deletedMsg._id, projectId });

                if (ack) ack({ success: true, messageId: deletedMsg._id });
            } catch (err) {
                logger.error(`Error deleting message via socket: ${err.message}`);
                if (ack) ack({ success: false, error: err.message || 'Internal error deleting message' });
            }
        });

        socket.on('disconnect', (reason) => {
            logger.info(`Socket disconnected: User ${socket.user.id} - Reason: ${reason}`);
        });
    });

    return io;
}

module.exports = { initSocketServer };
