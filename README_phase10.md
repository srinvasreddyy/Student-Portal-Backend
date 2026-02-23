# Phase 10: Super Admin Chat Moderation

## Overview
Phase 10 formally introduces native **Message Deletion and Content Moderation** to the real-time project collaboration chat rooms. It allows room participants to delete their own messages, while granting Super Admins global override capabilities to scrub unwanted or malicious message content.

## Architecture Updates

### 1. The Core Scrubbing Engine (`chatService.js`)
Instead of performing a "Hard Delete" (which creates disjointed UI threads and loss of forensic data), the backend performs a **Soft Delete**:
- The `deleted` boolean flag is flipped to `true`.
- The `deletedAt` timestamp is pinned.
- The `text` body is entirely scrubbed and replaced with generic placeholder text.
- Any associated `attachments` array is wiped.
- A standard Server `AuditLog` is created tying the Actor (Sender or Super Admin) to the `ChatMessage` modification.

### 2. Live WebSockets Push (`sockets/index.js`)
When a user emits `message:delete`, the backend safely resolves the authorization cascade within the ChatService. Assuming success:
1. The message string is destroyed in MongoDB.
2. The server acknowledges the sender with `success: true`.
3. The server immediately broadcasts an `io.emit('message:deleted', { messageId })` to the entire room so all attached frontends drop the message from view natively. 

### 3. REST Backup (`chatController.js`)
An equivalent `DELETE /projects/:id/messages/:messageId` route exists. This REST invocation utilizes exactly the same `chatService.deleteMessage` pipeline natively, guaranteeing no authentication drift.

## Tests Framework
Run `npm test tests/chat` or explicitly execute:
```bash
$env:NODE_OPTIONS="--experimental-vm-modules"; npx jest tests/chat.admin.test.js
```
The suite verifies precisely:
1. Students *cannot* delete other users' messages (`403 Forbidden`).
2. Senders perfectly capable of scrubbing their own text dynamically via their JWT.
3. Super Admins dynamically possess universal deletion authority across any room regardless of participation logic.
