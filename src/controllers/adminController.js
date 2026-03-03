const mongoose = require('mongoose');
const Company = require('../models/Company');
const University = require('../models/University');
const User = require('../models/User');
const StudentProfile = require('../models/StudentProfile');
const PortfolioItem = require('../models/PortfolioItem');
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
        let Model = Company;
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

// NEW CONTROLLER: Complete Category-wise User List
exports.listUsersByCategory = async (req, res, next) => {
    try {
        const { category, q, page = 1, limit = 12 } = req.query; // category: 'student', 'company', 'university'

        let data = [];
        let total = 0;
        const skip = (page - 1) * limit;

        if (category === 'student') {
            const query = { role: 'student' };
            if (q) query.email = new RegExp(q, 'i');

            const users = await User.find(query).select('-passwordHash -refreshTokens').sort('-createdAt').skip(skip).limit(parseInt(limit)).lean();
            total = await User.countDocuments(query);

            // Attach profiles
            for (let user of users) {
                user.studentProfile = await StudentProfile.findOne({ userRef: user._id }).lean();
            }
            data = users;
        } else {
            let Model = category === 'university' ? University : Company;
            const query = {};
            if (q) query.$or = [{ 'officialName': new RegExp(q, 'i') }, { 'name': new RegExp(q, 'i') }, { 'companyEmail': new RegExp(q, 'i') }];

            data = await Model.find(query).select('-verification').sort('-createdAt').skip(skip).limit(parseInt(limit)).lean();
            total = await Model.countDocuments(query);

            // Link back to user login info
            for (let org of data) {
                if (org.representative?.user) {
                    const loginInfo = await User.findById(org.representative.user).select('email status role').lean();
                    org.systemAccount = loginInfo;
                }
            }
        }

        res.status(200).json({ success: true, total, data });
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

        const safeModel = model.toObject();
        if (safeModel.verification) {
            delete safeModel.verification.emailTokenHash;
            delete safeModel.verification.tokenExpiry;
        }

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

        // Ensure we check all relevant flags
        if (appModel.status === 'verified' || appModel.isVerified === true) {
            await session.abortTransaction();
            await AuditLog.create([{
                actorEmail: req.user.email, actorRole: req.user.role, targetType: type, targetId: id,
                actionType: 'approve', details: { reason: 'Attempted to approve already verified app', failed: true }
            }]);
            return res.status(400).json({ success: false, message: 'Application is already verified' });
        }

        appModel.status = 'verified';
        appModel.verified = true; // For legacy structure compatibility
        appModel.isVerified = true; // Sets the flag used by Admin Schemas
        appModel.verificationMethod = 'manual'; // Approved by Super Admin explicitly

        // Activate associated User account to enable their login
        let userWasActivated = false;
        if (appModel.representative && appModel.representative.user) {
            const associatedUser = await User.findById(appModel.representative.user);
            if (associatedUser) {
                associatedUser.status = 'active'; // This opens the login gate
                await associatedUser.save({ session });
                userWasActivated = true;
            }
        }

        // Fallback: Try matching by email
        if (!userWasActivated) {
            const emailToMatch = type === 'company' ? appModel.companyEmail : appModel.representative?.email;
            if (emailToMatch) {
                const associatedUser = await User.findOne({ email: emailToMatch.toLowerCase() });
                if (associatedUser) {
                    associatedUser.status = 'active'; // This opens the login gate
                    await associatedUser.save({ session });
                }
            }
        }

        // Log the approval
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

        let emailAttemptId = null;
        if (notify) {
            const emailAddress = type === 'company' ? appModel.companyEmail : appModel.representative?.email;
            const decisionKey = `approve_${appModel._id}_v1`;

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

        res.status(200).json({ success: true, status: appModel.status, isVerified: appModel.isVerified, auditLogId: logEntry._id, emailAttemptId });
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
                    sendKey: `hold_${appModel._id}_${Date.now()}`
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
        const { actionType, force, type, reason } = req.body;

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

// ── Student account status management (approve / reject / suspend) ──
exports.updateStudentStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['active', 'suspended', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Status must be active, suspended, or rejected' });
        }

        const user = await User.findById(id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.role !== 'student') return res.status(400).json({ success: false, message: 'This endpoint is only for student accounts' });

        const previousStatus = user.status;
        user.status = status;
        if (status === 'active') user.domainVerified = true; // Admin-approved counts as verified
        await user.save();

        // Audit log
        await AuditLog.create({
            actorEmail: req.user.email, actorRef: req.user._id, actorRole: req.user.role,
            targetType: 'student', targetId: user._id,
            actionType: `student_${status}`,
            details: { previousStatus, newStatus: status },
            ip: req.ip, userAgent: req.get('User-Agent')
        });

        res.status(200).json({ success: true, message: `Student account ${status}`, data: { id: user._id, status: user.status, domainVerified: user.domainVerified } });
    } catch (err) { next(err); }
};

// ── Portfolio Search (Talent Discovery) ──
exports.searchPortfolios = async (req, res, next) => {
    try {
        const { q, source, skills, institution, hasExperience, page = 1, limit = 12 } = req.query;

        const query = { visibility: 'public' };

        // 1. Portfolio Item textual search
        if (q && q.trim().length >= 2) {
            const regex = new RegExp(q.trim(), 'i');
            query.$or = [
                { title: regex },
                { description: regex },
                { tags: regex }
            ];
        }

        // 2. Exact match filter on PortfolioItem
        if (source && (source === 'app' || source === 'user')) {
            query.source = source;
        }

        // 3. Profile-based filters (need to find matching users first)
        const profileFilters = {};
        if (skills && skills.trim()) {
            // Assumes comma-separated skills in query: ?skills=react,node
            const skillsArray = skills.split(',').map(s => new RegExp(`^${s.trim()}$`, 'i'));
            profileFilters.techStack = { $all: skillsArray };
        }
        if (institution && institution.trim()) {
            profileFilters['education.institution'] = new RegExp(institution.trim(), 'i');
        }
        if (hasExperience === 'true') {
            profileFilters['experience.0'] = { $exists: true }; // Must have at least one experience entry
        }

        // If any profile filters apply, resolve the matching user IDs
        if (Object.keys(profileFilters).length > 0) {
            const matchingProfiles = await StudentProfile.find(profileFilters).select('userRef').lean();
            const allowedUserIds = matchingProfiles.map(p => p.userRef);

            // If we already have a filter on ownerRef (highly unlikely in current design), merge it. Otherwise set it.
            if (query.ownerRef && query.ownerRef.$in) {
                // Intersect the arrays (edge case safety)
                const existingStrs = query.ownerRef.$in.map(id => id.toString());
                query.ownerRef.$in = allowedUserIds.filter(id => existingStrs.includes(id.toString()));
            } else {
                query.ownerRef = { $in: allowedUserIds };
            }

            // If profile filters returned 0 matches, the portfolio query should safely return 0 matches.
            if (allowedUserIds.length === 0) {
                return res.status(200).json({ success: true, total: 0, count: 0, data: [] });
            }
        }

        const skip = (page - 1) * limit;

        const items = await PortfolioItem.find(query)
            .populate('ownerRef', 'firstName lastName email institutionName course fieldOfStudy')
            .populate('projectRef', 'title description techStack roles durationInWeeks postedByModel sourceCodeUrl productionUrl status')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await PortfolioItem.countDocuments(query);

        res.status(200).json({ success: true, total, count: items.length, data: items });
    } catch (err) { next(err); }
};

// ── Student Search (Talent Discovery - Students Tab) ──
exports.searchStudents = async (req, res, next) => {
    try {
        const { q, passoutYear, degreeCategory, hasExperience, skills, page = 1, limit = 12 } = req.query;

        const profileQuery = { 'privacy.publicProfile': true };

        // Profile-based Filters
        if (passoutYear && !isNaN(passoutYear)) {
            profileQuery['education.endYear'] = parseInt(passoutYear);
        }

        if (degreeCategory && degreeCategory.trim()) {
            profileQuery['education.degree'] = new RegExp(degreeCategory.trim(), 'i');
        }

        if (hasExperience === 'true') {
            profileQuery['experience.0'] = { $exists: true };
        }

        if (skills && skills.trim()) {
            const skillsArray = skills.split(',').map(s => new RegExp(`^${s.trim()}$`, 'i'));
            profileQuery.techStack = { $all: skillsArray };
        }

        // If there's a text query 'q', we need to match it against User info (name, email)
        // OR against Profile info (bio, techStack). 
        // Best approach: If 'q' exists, find matching User IDs first, 
        // then combine with the profileQuery.
        if (q && q.trim().length >= 2) {
            const regex = new RegExp(q.trim(), 'i');

            // 1. Find matched users
            const matchedUsers = await User.find({
                role: 'student',
                status: 'active',
                $or: [
                    { firstName: regex },
                    { lastName: regex },
                    { email: regex },
                    { institutionName: regex }
                ]
            }).select('_id').lean();

            const matchedUserIds = matchedUsers.map(u => u._id);

            // 2. We also allow matching profile text directly
            profileQuery.$or = [
                { userRef: { $in: matchedUserIds } },
                { bio: regex },
                { techStack: regex }
            ];
        } else {
            // Guarantee we only list active students if no 'q' search is done
            const activeUsers = await User.find({ role: 'student', status: 'active' }).select('_id').lean();
            profileQuery.userRef = { $in: activeUsers.map(u => u._id) };
        }

        const skip = (page - 1) * limit;

        const profiles = await StudentProfile.find(profileQuery)
            .populate('userRef', 'firstName lastName email institutionName course fieldOfStudy status domainVerified')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await StudentProfile.countDocuments(profileQuery);

        res.status(200).json({ success: true, total, count: profiles.length, data: profiles });
    } catch (err) { next(err); }
};

// ── Send Recruitment Email ──
exports.sendRecruitmentEmail = async (req, res, next) => {
    try {
        const { studentId, subject, body } = req.body;
        if (!studentId || !subject || !body) {
            return res.status(400).json({ success: false, message: 'studentId, subject, and body are required' });
        }

        const student = await User.findById(studentId).select('email firstName lastName');
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const { sendEmail } = require('../services/mailer');

        const htmlContent = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #0ea5e9 0%, #8b5cf6 100%); padding: 2rem; border-radius: 12px 12px 0 0;">
                    <h1 style="color: #fff; margin: 0; font-size: 1.5rem;">Recruitment Opportunity</h1>
                    <p style="color: rgba(255,255,255,0.85); margin: 0.5rem 0 0; font-size: 0.9rem;">From the Global Academy Platform</p>
                </div>
                <div style="background: #ffffff; padding: 2rem; border: 1px solid #e2e8f0; border-top: none;">
                    <p style="color: #334155; margin: 0 0 0.5rem;">Hi ${student.firstName || 'Student'},</p>
                    <div style="color: #475569; line-height: 1.7; white-space: pre-wrap;">${body}</div>
                </div>
                <div style="background: #f8fafc; padding: 1.5rem 2rem; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; text-align: center;">
                    <p style="color: #94a3b8; font-size: 0.8rem; margin: 0;">Sent via Global Academy Platform</p>
                </div>
            </div>
        `;

        await sendEmail(student.email, subject, htmlContent);

        // Audit log
        await AuditLog.create({
            actorEmail: req.user.email, actorRef: req.user._id, actorRole: req.user.role,
            targetType: 'student', targetId: studentId,
            actionType: 'recruitment_email',
            details: { subject, recipientEmail: student.email },
            ip: req.ip, userAgent: req.get('User-Agent')
        });

        res.status(200).json({ success: true, message: 'Recruitment email sent successfully' });
    } catch (err) { next(err); }
};