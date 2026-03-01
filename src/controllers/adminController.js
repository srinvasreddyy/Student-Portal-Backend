const mongoose = require('mongoose');
const Company = require('../models/Company');
const University = require('../models/University');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { sendWithRetry, templates } = require('../services/mailer');

async function getTarget(id, type) {
    if (type === 'company') return await Company.findById(id);
    if (type === 'university') return await University.findById(id);
    throw new Error('Invalid target type');
}

exports.listApplications = async (req, res, next) => {
    try {
        const { type, status, q, page = 1, limit = 10, sort = '-createdAt' } = req.query;
        let Model = Company; // default
        if (type === 'university') Model = University;

        const query = {};
        if (status) query.status = status;
        if (q) {
            query.$or = [
                { 'officialName': new RegExp(q, 'i') },
                { 'name': new RegExp(q, 'i') },
                { 'country': new RegExp(q, 'i') },
                { 'companyEmail': new RegExp(q, 'i') }
            ];
        }

        const items = await Model.find(query)
            .select('-verification.emailTokenHash -verification.tokenExpiry -auditLogs')
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await Model.countDocuments(query);

        res.status(200).json({ success: true, count: items.length, total, data: items });
    } catch (err) { next(err); }
};

exports.getApplication = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { type } = req.query;

        if (!['company', 'university'].includes(type)) {
            return res.status(400).json({ success: false, message: '?type=company or university required' });
        }

        const model = await getTarget(id, type);
        if (!model) return res.status(404).json({ success: false, message: 'Not found' });

        // Safely strip secrets manually or rely on select (doing manually to preserve nested objects)
        const safeModel = model.toObject();
        if (safeModel.verification) {
            delete safeModel.verification.emailTokenHash;
            delete safeModel.verification.tokenExpiry;
        }

        // Fetch recent logs separately since we normalized
        const recentLogs = await AuditLog.find({ targetId: id, targetType: type })
            .sort({ createdAt: -1 })
            .limit(20);

        safeModel.recentLogs = recentLogs;

        res.status(200).json({ success: true, data: safeModel });
    } catch (err) { next(err); }
};

exports.approveApplication = async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { id } = req.params;
        const { notify, message, onboardingUrl, type } = req.body;

        if (!['company', 'university'].includes(type)) return res.status(400).json({ success: false, message: 'type required' });

        const appModel = await getTarget(id, type);
        if (!appModel) return res.status(404).json({ success: false, message: 'Not found' });

        if (appModel.status === 'verified') {
            await session.abortTransaction();
            // Still log they tried
            await AuditLog.create([{
                actorEmail: req.user.email, actorRole: req.user.role, targetType: type, targetId: id,
                actionType: 'approve', details: { reason: 'Attempted to approve already verified app', failed: true }
            }]);
            return res.status(400).json({ success: false, message: 'Application is already verified' });
        }

        // Apply transition
        appModel.status = 'verified';
        if (type === 'university') appModel.verified = true;

        // Activate associated User account
        if (appModel.representative && appModel.representative.user) {
            const associatedUser = await User.findById(appModel.representative.user);
            if (associatedUser) {
                associatedUser.status = 'active';
                await associatedUser.save({ session });
            }
        } else {
            // Fallback: Try matching by email
            const emailToMatch = type === 'company' ? appModel.companyEmail : appModel.representative?.email;
            if (emailToMatch) {
                const associatedUser = await User.findOne({ email: emailToMatch.toLowerCase() });
                if (associatedUser) {
                    associatedUser.status = 'active';
                    await associatedUser.save({ session });
                }
            }
        }

        // Create log & link it
        const [logEntry] = await AuditLog.create([{
            actorEmail: req.user.email,
            actorRef: req.user._id,
            actorRole: req.user.role,
            targetType: type,
            targetId: appModel._id,
            actionType: 'approve',
            details: { message, onboardingUrl },
            ip: req.ip,
            userAgent: req.get('User-Agent')
        }], { session });

        appModel.auditLogs.push(logEntry._id);
        await appModel.save({ session });

        // Hold commit until email queue row is generated

        // Send Email OUTSIDE transaction so we don't hold the lock if SMTP is slow
        let emailAttemptId = null;
        if (notify) {
            const emailAddress = type === 'company' ? appModel.companyEmail : appModel.representative?.email;
            const decisionKey = `approve_${appModel._id}_v1`; // basic idempotency 

            if (emailAddress) {
                const result = await sendWithRetry({
                    applicationId: appModel._id,
                    targetType: type,
                    to: emailAddress,
                    subject: 'Your Application has been Approved!',
                    templateName: 'approve',
                    htmlContent: templates.approve(onboardingUrl) + (message ? `<p><strong>Note:</strong> ${message}</p>` : ''),
                    sendKey: decisionKey
                });
                emailAttemptId = result.messageId;
            }
        }

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({ success: true, status: appModel.status, auditLogId: logEntry._id, emailAttemptId });
    } catch (err) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }
        session.endSession();
        next(err);
    }
};

exports.holdApplication = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason, expectedAction, notify, type } = req.body;

        if (!reason || reason.length > 2000) return res.status(400).json({ success: false, message: 'Reason required & < 2000 chars' });

        const appModel = await getTarget(id, type);
        if (!appModel) return res.status(404).json({ success: false, message: 'Not found' });

        appModel.status = 'on_hold';

        const logEntry = await AuditLog.create({
            actorEmail: req.user.email, actorRef: req.user._id, actorRole: req.user.role,
            targetType: type, targetId: appModel._id, actionType: 'hold',
            details: { reason, expectedAction }, ip: req.ip, userAgent: req.get('User-Agent')
        });

        appModel.auditLogs.push(logEntry._id);
        await appModel.save();

        if (notify) {
            const emailAddress = type === 'company' ? appModel.companyEmail : appModel.representative?.email;
            if (emailAddress) {
                await sendWithRetry({
                    applicationId: appModel._id, targetType: type, to: emailAddress,
                    subject: 'Application Needs Attention', templateName: 'hold',
                    htmlContent: templates.hold(reason) + (expectedAction ? `<p><strong>Required Action:</strong> ${expectedAction}</p>` : ''),
                    sendKey: `hold_${appModel._id}_${Date.now()}` // Allow multiple holds over time
                });
            }
        }

        res.status(200).json({ success: true, status: appModel.status, auditLogId: logEntry._id });
    } catch (err) { next(err); }
};

exports.rejectApplication = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason, notify, type } = req.body;

        if (!reason || reason.length > 2000) return res.status(400).json({ success: false, message: 'Reason required & < 2000 chars' });

        const appModel = await getTarget(id, type);
        if (!appModel) return res.status(404).json({ success: false, message: 'Not found' });

        appModel.status = 'rejected';

        const logEntry = await AuditLog.create({
            actorEmail: req.user.email, actorRef: req.user._id, actorRole: req.user.role,
            targetType: type, targetId: appModel._id, actionType: 'reject',
            details: { reason }, ip: req.ip, userAgent: req.get('User-Agent')
        });

        appModel.auditLogs.push(logEntry._id);
        await appModel.save();

        if (notify) {
            const emailAddress = type === 'company' ? appModel.companyEmail : appModel.representative?.email;
            if (emailAddress) {
                await sendWithRetry({
                    applicationId: appModel._id, targetType: type, to: emailAddress,
                    subject: 'Application Update (Rejected)', templateName: 'reject',
                    htmlContent: templates.reject(reason),
                    sendKey: `reject_${appModel._id}_${Date.now()}`
                });
            }
        }

        res.status(200).json({ success: true, status: appModel.status, auditLogId: logEntry._id });
    } catch (err) {
        next(err);
    }
};

exports.addNote = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { note, type } = req.body;
        if (!note) return res.status(400).json({ success: false, message: 'Note string required' });

        const appModel = await getTarget(id, type);
        if (!appModel) return res.status(404).json({ success: false, message: 'Not found' });

        const logEntry = await AuditLog.create({
            actorEmail: req.user.email, actorRef: req.user._id, actorRole: req.user.role,
            targetType: type, targetId: appModel._id, actionType: 'add_note',
            details: { note }, ip: req.ip, userAgent: req.get('User-Agent')
        });

        appModel.auditLogs.push(logEntry._id);
        await appModel.save();

        res.status(201).json({ success: true, auditLogId: logEntry._id });
    } catch (err) { next(err); }
};

exports.resendDecisionEmail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { actionType, force, type, reason } = req.body;  // Action type is 'approve', 'hold', 'reject'

        const appModel = await getTarget(id, type);
        const emailAddress = type === 'company' ? appModel.companyEmail : appModel.representative?.email;

        if (!emailAddress) return res.status(400).json({ success: false, message: 'No email found' });

        let htmlContent = '';
        let subject = '';

        if (actionType === 'approve') {
            subject = 'Your Application has been Approved!';
            htmlContent = templates.approve();
        } else if (actionType === 'hold') {
            subject = 'Application Needs Attention';
            htmlContent = templates.hold(reason || 'See portal for details');
        } else if (actionType === 'reject') {
            subject = 'Application Update (Rejected)';
            htmlContent = templates.reject(reason || 'See portal for details');
        } else {
            return res.status(400).json({ success: false, message: 'Invalid actionType to resend' });
        }

        // We use a new sendkey bypass or use force
        const decisionKey = force ? `resend_${actionType}_${appModel._id}_${Date.now()}` : `${actionType}_${appModel._id}_v1`;

        const result = await sendWithRetry({
            applicationId: appModel._id, targetType: type, to: emailAddress,
            subject, templateName: actionType, htmlContent,
            sendKey: decisionKey, force
        });

        await AuditLog.create({
            actorEmail: req.user.email, actorRole: req.user.role, targetType: type, targetId: appModel._id,
            actionType: 'resend_email', details: { resentAction: actionType, success: result.success }
        });

        res.status(200).json({ success: true, result });
    } catch (err) { next(err); }
};

exports.listAuditLogs = async (req, res, next) => {
    try {
        const { actorEmail, actionType, targetType, dateFrom, dateTo, page = 1, limit = 20 } = req.query;

        const query = {};
        if (actorEmail) query.actorEmail = actorEmail;
        if (actionType) query.actionType = actionType;
        if (targetType) query.targetType = targetType;
        if (dateFrom || dateTo) {
            query.createdAt = {};
            if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
            if (dateTo) query.createdAt.$lte = new Date(dateTo);
        }

        const logs = await AuditLog.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await AuditLog.countDocuments(query);

        res.status(200).json({ success: true, count: logs.length, total, data: logs });
    } catch (err) { next(err); }
};
