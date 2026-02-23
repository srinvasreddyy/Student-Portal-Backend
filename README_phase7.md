# Phase 7: Real-time Group Chat

This documentation covers the newly added real-time chat functionality using Socket.io, Express, and MongoDB.

## Features implemented
- WebSocket authentication via JWT handshake.
- Auto-joining based on RBAC & DB validation (`Project` ACL).
- Message persistence in MongoDB (`ChatMessage`) with multi-field indexing for optimal pagination (`projectId`, `createdAt DESC`).
- REST endpoints for scrolling historical messages via Keyser Cursor pagination.
- Secure rate limiting (per socket configuration) to prevent flooding.
- Extensible profanity filtering middleware.
- Attachment routing hooks (multipart uploading to Mongo GridFS / Cloud Storage decoupled).
- Offline email notifications stub using `notificationService`.

## Environment Variables
Make sure these variables are correctly set in the backend `.env` file:
```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/student_platform
JWT_SECRET=your_jwt_secret
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
# REDIS_URL=redis://localhost:6379 # Uncomment when scaling
```

## Running the Server Locally
To start the server incorporating both the Express REST APIs and the Socket.IO real-time endpoints:

```bash
cd backend
npm run dev
# Or for tests
npm test tests/chat.persistence.test.js
npm test tests/chat.socket.test.js
```

## Scaling with Redis Adapter

By default, the server currently runs in-memory. If deploying multiple instances (e.g., in a Kubernetes replica set, AWS ECS, or PM2 cluster), Node memory scopes stay isolated. A message emitted on Instance 1 will not magically reach a user connected to Instance 2.

**How to Scale:**
Enable the **Socket.io Redis adapter** (`@socket.io/redis-adapter`):
1. Provision a Redis database (self-hosted via docker/apt-get, or managed like AWS ElastiCache / Redis Labs). 
   - *Self-hosted logic*: Harder to maintain HA (High Availability), but free and fully controlled.
   - *Managed service logic*: Expensive, but automatically handles clustering and failovers.
2. In `src/sockets/index.js`, uncomment the Redis configurations (using `createClient` from the `redis` npm package).
3. The adapter intercepts all `io.emit` and `socket.broadcast` requests, pub/subbing them through Redis, successfully broadcasting messages across *all* connected servers without impacting client implementations.

## Example Socket Event Flow

**1. Authentication:**
```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: {
    token: "Bearer eyJhbGc..."
  }
});
```

**2. Join Project:**
```javascript
socket.emit('room:join', { projectId: '64a...xxx' }, (ack) => {
    if (ack.success) {
         console.log('Joined room:', ack.room);
    } else {
         console.error('Failed to join:', ack.error);
    }
});
```

**3. Sending Message:**
```javascript
socket.emit('message:send', {
    projectId: '64a...xxx',
    text: 'Hello team!',
    attachments: [] // fileId references array
}, (ack) => {
    console.log('Ack saved messageId:', ack.messageId); 
});
```

**4. Receiving Message:**
```javascript
socket.on('message:new', (msg) => {
    // => { _id: "...", text: "Hello team!", senderName: "Alice", createdAt: "2024-...", ... }
    renderMessage(msg);
});
```

**REST File Attachments Flow:**
1. Send `FormData` containing the file to `POST /api/chat/projects/:projectId/messages/:messageId/attachments`.
2. The server will ingest via Multer and append the metadata gridfs id to `message.attachments`.
3. Read the stream later via `GET /api/chat/files/:fileId`.
