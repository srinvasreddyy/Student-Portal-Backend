const chatService = require('../services/chatService');
const Project = require('../models/Project');
const mongoose = require('mongoose');

// We simulate file upload to GridFS or storage location.
// In actual use, middleware/fileUpload.js handles multipart to memory/disk, then stream to DB/S3
const getMessages = async (req, res, next) => {
    try {
        const { id: projectId } = req.params;
        const { limit = 50, beforeDate, beforeId } = req.query;

        // Authorize user (must be in the project)
        const hasAccess = await chatService.checkUserRoomAccess(req.user.id, req.user.role, projectId);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const messages = await chatService.getMessages(projectId, limit, beforeId, beforeDate);

        // Compute next cursor from the last element if we fetched any
        let nextCursor = null;
        if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            nextCursor = {
                beforeId: lastMsg._id,
                beforeDate: lastMsg.createdAt
            };
        }

        res.status(200).json({
            success: true,
            data: messages,
            nextCursor,
            hasMore: messages.length === parseInt(limit, 10)
        });
    } catch (err) {
        next(err);
    }
};

const getRooms = async (req, res, next) => {
    try {
        const userId = req.user.id;
        let query = {};

        // Find projects where the user is an accepted student or author
        if (req.user.role === 'student') {
            query = { 'acceptedStudents.studentRef': userId };
        } else if (req.user.role === 'company_admin' || req.user.role === 'university_admin') {
            query = { authorRef: userId };
        } else if (req.user.role === 'super_admin') {
            query = {}; // all projects
        }

        const projects = await Project.find(query).select('_id title status');
        res.status(200).json({ success: true, data: projects });

    } catch (err) {
        next(err);
    }
};

/**
 * Handle File Upload for Chat Attachments
 * Expects the file to be uploaded via multer middleware, attaching info to req.file
 */
const uploadAttachment = async (req, res, next) => {
    try {
        const { id: projectId, messageId } = req.params;

        // Authorize
        const hasAccess = await chatService.checkUserRoomAccess(req.user.id, req.user.role, projectId);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        // Normally, save file to GridFS or Cloud Storage (e.g., S3). Here we assume req.file contains needed metadata.
        const fileData = {
            fileId: new mongoose.Types.ObjectId(), // Or the actual GridFS ID if uploaded directly to MongoDB
            filename: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size
        };

        const updatedMessage = await chatService.attachFileToMessage(messageId, fileData);

        if (!updatedMessage) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        res.status(201).json({ success: true, data: updatedMessage });

    } catch (err) {
        next(err);
    }
};

/**
 * Download a specific file
 * In practice: stream from GridFS/S3
 */
const downloadFile = async (req, res, next) => {
    try {
        const { fileId } = req.params;
        const { projectId } = req.query; // Usually need context to check ACL

        if (projectId) {
            const hasAccess = await chatService.checkUserRoomAccess(req.user.id, req.user.role, projectId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
        }

        // Mocking file download response. If GridFS:
        // const gfs = ...
        // gfs.openDownloadStream(new mongoose.Types.ObjectId(fileId)).pipe(res);

        res.status(200).json({
            success: true,
            message: `Mock stream download for file ${fileId}`
        });

    } catch (err) {
        next(err);
    }
};

/**
 * REST endpoint to delete a specific message
 */
const deleteMessage = async (req, res, next) => {
    try {
        const { id: projectId, messageId } = req.params;

        // Authorize (Service handles the strict delete validation)
        const hasAccess = await chatService.checkUserRoomAccess(req.user.id, req.user.role, projectId);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const deletedMsg = await chatService.deleteMessage(messageId, req.user.id, req.user.role, projectId);

        res.status(200).json({ success: true, message: 'Message deleted successfully', data: deletedMsg });
    } catch (err) {
        if (err.message.includes('Forbidden')) {
            return res.status(403).json({ success: false, message: err.message });
        }
        if (err.message.includes('not found')) {
            return res.status(404).json({ success: false, message: err.message });
        }
        next(err);
    }
};

module.exports = {
    getMessages,
    getRooms,
    uploadAttachment,
    downloadFile,
    deleteMessage
};
