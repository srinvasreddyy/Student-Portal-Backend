const mailerService = require('./mailer');
const User = require('../models/User');
const Project = require('../models/Project');
const Notification = require('../models/Notification');

/**
 * Handles generating and sending in-app notifications + enqueuing transactional emails.
 */
class NotificationService {

    /**
     * Create Notification record and enqueue Email atomically (logical transaction)
     * For production scale, wrap this in mongoose.startTransaction()
     */
    async createNotificationAndEmail({ userRef, type, title, body, meta, sendEmail, templateName, templatePayload }) {

        // 1. Create In-App Notification
        const notification = new Notification({
            userRef,
            type,
            title,
            body,
            meta,
            deliveredEmail: sendEmail || false
        });
        const savedNotif = await notification.save();

        let emailAttemptId = null;

        // 2. Enqueue Email Send Attempt to Durable Outbox
        if (sendEmail && templateName) {
            const user = await User.findById(userRef).select('email');
            if (user) {
                const enqueued = await mailerService.enqueueMail({
                    to: user.email,
                    subject: title,
                    templateName: templateName,
                    payload: templatePayload,
                    userRef: userRef,
                    // We don't always define sendKey to allow multiples of identical nature, 
                    // but you could add a hashing key here if deduping is required.
                    sendKey: templatePayload.sendKey || null
                });
                emailAttemptId = enqueued.attemptId;
            }
        }

        return { notificationId: savedNotif._id, emailAttemptId };
    }

    /**
     * Fetch paginated notifications for a user
     */
    async listNotifications(userRef, page = 1, limit = 20, unreadOnly = false) {
        const skip = (page - 1) * limit;
        const query = { userRef };
        if (unreadOnly) {
            query.read = false;
        }

        const [data, total] = await Promise.all([
            Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            Notification.countDocuments(query)
        ]);

        return {
            data,
            total,
            page: parseInt(page, 10),
            pages: Math.ceil(total / limit)
        };
    }

    /**
     * Mark an array of notification IDs as read safely
     */
    async markRead(userRef, notificationIds) {
        if (!notificationIds || notificationIds.length === 0) return 0;

        const result = await Notification.updateMany(
            { _id: { $in: notificationIds }, userRef },
            { $set: { read: true } }
        );
        return result.modifiedCount;
    }

    /**
     * Broadcast a notification to all active users matching the given roles.
     * Creates one Notification document per matching user via bulk insert.
     */
    async broadcastNotification({ targetRoles, type, title, body, meta }) {
        const validRoles = ['student', 'company_admin', 'university_admin', 'super_admin'];
        const roles = targetRoles.filter(r => validRoles.includes(r));
        if (roles.length === 0) throw new Error('No valid target roles provided');

        const users = await User.find({ role: { $in: roles }, status: 'active' }).select('_id').lean();
        if (users.length === 0) return { count: 0 };

        const docs = users.map(u => ({
            userRef: u._id,
            type: type || 'admin_broadcast',
            title,
            body,
            meta,
            read: false,
            deliveredEmail: false,
        }));

        await Notification.insertMany(docs);
        return { count: docs.length };
    }

    /**
     * Helper to enqueue offline chat digests bridging from Phase 7.
     * In reality, this should queue ONE job per project to aggregate messages to prevent spam.
     */
    async queueDigestNotifications(userIds, projectId, message) {
        if (!userIds || userIds.length === 0) return;

        try {
            const project = await Project.findById(projectId).select('title');
            if (!project) return;

            for (const uid of userIds) {
                await this.createNotificationAndEmail({
                    userRef: uid,
                    type: 'chat_digest',
                    title: `New Message in ${project.title}`,
                    body: `Sent by ${message.senderName}`,
                    sendEmail: true,
                    templateName: 'student_accepted', // reusing temp template for demo bounds
                    templatePayload: {
                        userName: 'User',
                        projectTitle: project.title,
                        companyName: message.senderName,
                        chatLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/projects/${projectId}/chat`
                    }
                });
            }
        } catch (error) {
            console.error('Failed to send offline digest notifications:', error);
        }
    }
}

module.exports = new NotificationService();
