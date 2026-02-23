const ChatMessage = require('../models/ChatMessage');
const Project = require('../models/Project');
const AuditLog = require('../models/AuditLog');
const mongoose = require('mongoose');

/**
 * References:
 * MongoDB Cursor Pagination: https://www.mongodb.com/docs/manual/reference/method/cursor.sort/#sort-and-index-use
 * GridFS Details: https://www.mongodb.com/docs/manual/core/gridfs/
 */

class ChatService {
    /**
     * Store a chat message in the DB
     */
    async saveMessage({ projectId, senderRef, senderName, text, attachments }) {
        const message = new ChatMessage({
            projectId,
            senderRef,
            senderName,
            text,
            attachments
        });

        const saved = await message.save();

        // Optional: Fire and forget audit log for the action
        try {
            await AuditLog.create({
                actorId: senderRef,
                action: 'message_send',
                resourceName: 'ChatMessage',
                resourceId: saved._id,
                details: { projectId }
            });
        } catch (e) {
            // Log error but don't fail message send
            console.error('Audit log failed', e);
        }

        return saved;
    }

    /**
     * Check if a user is allowed to join the project chat room
     */
    async checkUserRoomAccess(userId, userRole, projectId) {
        if (userRole === 'super_admin') return true; // Super admins can join any room

        const project = await Project.findById(projectId).select('authorRef acceptedStudents');
        if (!project) return false;

        // Is the user the project creator? (Company or University)
        if (project.authorRef.toString() === userId.toString()) return true;

        // Is the user an accepted student for this project?
        const isAccepted = project.acceptedStudents.some(student => student.studentRef.toString() === userId.toString());

        return isAccepted;
    }

    /**
     * Get paginated messages for a room
     */
    async getMessages(projectId, limit = 50, beforeId = null, beforeDate = null) {
        let query = { projectId: new mongoose.Types.ObjectId(projectId), deleted: false };

        // Keyser/Cursor pagination implementation using (createdAt, _id) compound index.
        if (beforeId && beforeDate) {
            query.$or = [
                { createdAt: { $lt: new Date(beforeDate) } },
                {
                    createdAt: new Date(beforeDate),
                    _id: { $lt: new mongoose.Types.ObjectId(beforeId) }
                }
            ];
        } else if (beforeDate) {
            // simple fallback
            query.createdAt = { $lt: new Date(beforeDate) };
        } else if (beforeId) {
            // less ideal but works if timestamps are assumed unique enough
            query._id = { $lt: new mongoose.Types.ObjectId(beforeId) };
        }

        const messages = await ChatMessage.find(query)
            .sort({ createdAt: -1, _id: -1 })
            .limit(parseInt(limit, 10))
            .lean(); // Return plain objects

        return messages;
    }

    /**
     * Attach file metadata to an existing message (or this can just be handled in REST prior to message:send)
     */
    async attachFileToMessage(messageId, fileData) {
        return ChatMessage.findByIdAndUpdate(
            messageId,
            { $push: { attachments: fileData } },
            { new: true }
        );
    }

    /**
     * (Placeholder) Handles queuing notifications for offline users.
     * To be integrated with notificationService.
     */
    async handleOfflineNotifications(projectId, message, ioInstance) {
        const notificationService = require('./notificationService');

        // 1. Get project participants
        const project = await Project.findById(projectId).select('authorRef acceptedStudents');
        if (!project) return;

        const participantIds = [project.authorRef.toString()];
        project.acceptedStudents.forEach(s => participantIds.push(s.studentRef.toString()));

        // 2. Identify who is NOT connected to the socket room
        //    Using ioInstance.sockets.adapter.rooms
        const roomName = `project:${projectId}`;
        let onlineSocketIds = new Set();

        const room = ioInstance.sockets.adapter.rooms.get(roomName);
        if (room) {
            for (const sid of room) {
                const clientSocket = ioInstance.sockets.sockets.get(sid);
                if (clientSocket && clientSocket.user) {
                    onlineSocketIds.add(clientSocket.user.id);
                }
            }
        }

        const offlineUserIds = participantIds.filter(id => !onlineSocketIds.has(id));

        // For offline users, queue an email digest
        if (offlineUserIds.length > 0) {
            await notificationService.queueDigestNotifications(offlineUserIds, projectId, message);
        }
    }
    /**
     * Delete a message (Soft delete or text scrub)
     * Sender or Super Admin can delete it.
     */
    async deleteMessage(messageId, userId, userRole, projectId) {
        const message = await ChatMessage.findById(messageId);

        if (!message) {
            throw new Error('Message not found');
        }

        if (message.projectId.toString() !== projectId.toString()) {
            throw new Error('Message does not belong to the specified project room');
        }

        // Authorization Check
        // Allow if user is super_admin OR user is the original sender
        if (userRole !== 'super_admin' && message.senderRef.toString() !== userId.toString()) {
            throw new Error('Forbidden: You do not have permission to delete this message');
        }

        // Perform Soft Delete (Scrubbing text for compliance)
        message.deleted = true;
        message.deletedAt = new Date();
        message.text = 'This message was deleted';
        message.attachments = []; // Clear attachments
        // We keep senderName/senderRef so the UI knows *who* sent the deleted message

        const savedMessage = await message.save();

        // Optional Audit Logging for Deletion
        try {
            await AuditLog.create({
                actorId: userId,
                action: 'message_delete',
                resourceName: 'ChatMessage',
                resourceId: savedMessage._id,
                details: { projectId, deletedByRole: userRole }
            });
        } catch (e) {
            console.error('Audit log failed during message deletion', e);
        }

        return savedMessage;
    }
}

module.exports = new ChatService();
