const notificationService = require('../services/notificationService');
const EmailSendAttempt = require('../models/EmailSendAttempt');

/**
 * Controller for managing in-app notifications and querying email dispatch statuses.
 */

const getNotifications = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, unreadOnly } = req.query;
        const result = await notificationService.listNotifications(
            req.user.id,
            page,
            limit,
            unreadOnly === 'true'
        );

        res.status(200).json({ success: true, ...result });
    } catch (err) {
        next(err);
    }
};

const markAsRead = async (req, res, next) => {
    try {
        const { ids } = req.body; // Array of notification IDs

        if (!Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'ids must be an array' });
        }

        const modifiedCount = await notificationService.markRead(req.user.id, ids);

        res.status(200).json({ success: true, count: modifiedCount });
    } catch (err) {
        next(err);
    }
};

const createNotification = async (req, res, next) => {
    try {
        // Enforce internal/super_admin usage only
        if (req.user.role !== 'super_admin') return res.status(403).json({ success: false, message: 'Forbidden' });

        const { userRef, type, title, body, meta, sendEmail, templateName, templatePayload } = req.body;

        const result = await notificationService.createNotificationAndEmail({
            userRef,
            type: type || 'admin_broadcast',
            title,
            body,
            meta,
            sendEmail,
            templateName,
            templatePayload
        });

        res.status(201).json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

const broadcastNotification = async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ success: false, message: 'Forbidden' });

        const { targetRoles, type, title, body } = req.body;

        if (!Array.isArray(targetRoles) || targetRoles.length === 0) {
            return res.status(400).json({ success: false, message: 'targetRoles must be a non-empty array' });
        }
        if (!title || !body) {
            return res.status(400).json({ success: false, message: 'title and body are required' });
        }

        const result = await notificationService.broadcastNotification({
            targetRoles,
            type: type || 'admin_broadcast',
            title,
            body,
        });

        res.status(201).json({ success: true, count: result.count });
    } catch (err) {
        next(err);
    }
};

/** ADMIN EMAIL VIEWERS */

const getEmailSends = async (req, res, next) => {
    try {
        const { status, userRef, templateName, page = 1, limit = 50 } = req.query;
        let query = {};

        if (status) query.status = status;
        if (userRef) query.userRef = userRef;
        if (templateName) query.templateName = templateName;

        const skip = (page - 1) * limit;

        const [attempts, total] = await Promise.all([
            EmailSendAttempt.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
            EmailSendAttempt.countDocuments(query)
        ]);

        res.status(200).json({
            success: true,
            data: attempts,
            total,
            page: parseInt(page, 10),
            pages: Math.ceil(total / limit)
        });
    } catch (err) {
        next(err);
    }
};

const resendEmail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const attempt = await EmailSendAttempt.findById(id);

        if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });

        // Simple requeue mechanic (resets retries)
        attempt.status = 'queued';
        attempt.attempts = 0;
        await attempt.save();

        res.status(200).json({ success: true, message: 'Requeued successfully', attemptId: attempt._id });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getNotifications,
    markAsRead,
    createNotification,
    broadcastNotification,
    getEmailSends,
    resendEmail
};
