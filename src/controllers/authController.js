const User = require('../models/User');
const StudentProfile = require('../models/StudentProfile');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mailer = require('../services/mailer');
const TokenUtils = require('../utils/tokenUtils');
const BruteForceProtector = require('../middleware/bruteForceProtector');
const serverClient = require('../config/streamClient');

// Generate numeric code
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

exports.register = async (req, res, next) => {
    try {
        const {
            email, password, role, profile, representative, companyCandidate,
            // Student-specific fields
            firstName, middleName, lastName,
            currentAcademicStatus, institutionName, institutionWebsite,
            course, fieldOfStudy, courseStartYear, courseEndYear
        } = req.body;

        if (!['student', 'company_admin', 'university_admin'].includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email already in use' });
        }

        const newUser = new User({
            email,
            passwordHash: password, // Pre-save hook will hash it
            role,
            profile: profile || {},
        });

        if (role === 'student') {
            // ── Validate at least 2 of 3 name fields ──
            const nameFields = [firstName, middleName, lastName].filter(n => n && n.trim());
            if (nameFields.length < 2) {
                return res.status(400).json({ success: false, message: 'Please provide at least 2 of 3 name fields (first, middle, last).' });
            }

            newUser.firstName = firstName?.trim();
            newUser.middleName = middleName?.trim();
            newUser.lastName = lastName?.trim();
            newUser.currentAcademicStatus = currentAcademicStatus;
            newUser.institutionName = institutionName;
            newUser.institutionWebsite = institutionWebsite;
            newUser.course = course;
            newUser.fieldOfStudy = fieldOfStudy;
            newUser.courseStartYear = courseStartYear ? Number(courseStartYear) : undefined;
            newUser.courseEndYear = courseEndYear ? Number(courseEndYear) : undefined;

            // ── Domain verification ──
            let domainVerified = false;
            if (institutionWebsite && email) {
                try {
                    const emailDomain = email.toLowerCase().split('@')[1];
                    // Strip protocol and www, extract domain
                    let instDomain = institutionWebsite.toLowerCase()
                        .replace(/^https?:\/\//, '')
                        .replace(/^www\./, '')
                        .split('/')[0]
                        .split(':')[0]; // Remove port if any

                    // Check if email domain matches or is a subdomain of institution domain
                    if (emailDomain === instDomain || emailDomain.endsWith('.' + instDomain)) {
                        domainVerified = true;
                    }
                } catch { /* domain parsing failed — leave as false */ }
            }

            newUser.domainVerified = domainVerified;
            newUser.status = domainVerified ? 'active' : 'pending';
            newUser.isEligibleForProjects = true;
        } else {
            // Ensure newly registered admins start as pending and require Super Admin approval
            newUser.status = 'pending';

            if (representative) newUser.profile.representative = representative;
            if (companyCandidate) newUser.profile.companyCandidate = companyCandidate;
        }

        const verifyCode = generateCode();
        newUser.emailVerifyHash = await bcrypt.hash(verifyCode, 10);

        await newUser.save();

        // ── Auto-create StudentProfile with primary education entry ──
        if (role === 'student') {
            const primaryEducation = {
                institution: institutionName || 'Not specified',
                degree: currentAcademicStatus || '',
                field: fieldOfStudy || '',
                startYear: courseStartYear ? Number(courseStartYear) : undefined,
                endYear: courseEndYear ? Number(courseEndYear) : undefined,
                isPrimary: true
            };
            await StudentProfile.create({
                userRef: newUser._id,
                education: [primaryEducation],
                techStack: [],
                experience: []
            });
        }

        try {
            await mailer.sendEmail(
                newUser.email,
                'Verify your Email',
                `<p>Your code is: <strong>${verifyCode}</strong></p>`
            );
        } catch (e) {
            req.app.locals.logger?.error(`Registration verification email failed ${e.message}`);
        }

        res.status(201).json({
            success: true,
            message: newUser.status === 'pending'
                ? 'Registration successful. Your account is pending domain verification by an administrator.'
                : 'Registration successful',
            user: {
                id: newUser._id, email: newUser.email, role: newUser.role,
                status: newUser.status, domainVerified: newUser.domainVerified,
                firstName: newUser.firstName, lastName: newUser.lastName
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }

        const normalizedEmail = email.toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });

        if (!user) {
            await BruteForceProtector.recordFailure(normalizedEmail || req.ip);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (user.status === 'rejected') {
            return res.status(401).json({ success: false, message: 'Account registration was rejected by Super Admin' });
        }

        // ── Block unapproved accounts ──
        if (user.status === 'pending') {
            if (user.role === 'student') {
                return res.status(403).json({
                    success: false,
                    message: 'Your account is pending domain verification. Please wait for administrator approval.',
                    code: 'ACCOUNT_PENDING'
                });
            }
            if (['company_admin', 'university_admin'].includes(user.role)) {
                await BruteForceProtector.recordFailure(normalizedEmail);
                return res.status(403).json({ success: false, message: 'Contact super admin for approval' });
            }
        }
        if (user.status === 'on_hold' && ['company_admin', 'university_admin'].includes(user.role)) {
            await BruteForceProtector.recordFailure(normalizedEmail);
            return res.status(403).json({ success: false, message: 'Contact super admin for approval' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            await BruteForceProtector.recordFailure(normalizedEmail);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        await BruteForceProtector.reset(normalizedEmail);

        // ── Student eligibility check on every login ──
        if (user.role === 'student' && user.courseEndYear) {
            const currentYear = new Date().getFullYear();
            const wasEligible = user.isEligibleForProjects;
            if (currentYear > user.courseEndYear) {
                user.isEligibleForProjects = false;
            } else {
                user.isEligibleForProjects = true;
            }
            if (user.isEligibleForProjects !== wasEligible) {
                await user.save();
            }
        }

        const accessToken = TokenUtils.generateAccessToken(user);
        const refreshToken = await TokenUtils.generateRefreshToken(user);

        // STREAM CHAT INTEGRATION ON LOGIN
        let streamToken = null;
        try {
            const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
            await serverClient.upsertUser({
                id: user._id.toString(),
                name: displayName,
                role: user.role === 'student' ? 'user' : 'admin'
            });
            streamToken = serverClient.createToken(user._id.toString());
        } catch (streamErr) {
            console.error(`Stream Chat user creation failed: ${streamErr.message}`);
        }

        const tokens = { accessToken, refreshToken, streamToken };

        res.status(200).json({
            success: true, tokens,
            user: {
                id: user._id, email: user.email, role: user.role, status: user.status,
                firstName: user.firstName, lastName: user.lastName,
                isEligibleForProjects: user.isEligibleForProjects,
                domainVerified: user.domainVerified
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.refreshToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(401).json({ success: false, message: 'Refresh token required' });

        try {
            const newTokens = await TokenUtils.rotateRefreshToken(refreshToken, req.ip);
            res.status(200).json({ success: true, tokens: newTokens });
        } catch (error) {
            return res.status(401).json({ success: false, message: error.message || 'Invalid refresh token' });
        }
    } catch (err) {
        next(err);
    }
};

exports.logout = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        if (refreshToken && req.user) {
            const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
            const user = await User.findById(req.user.id);
            if (user) {
                user.revokeRefreshToken(tokenHash);
                await user.save();
            }
        }
        res.status(200).json({ success: true, message: 'Logged out' });
    } catch (err) {
        next(err);
    }
};

exports.verifyEmail = async (req, res, next) => {
    try {
        const { code } = req.body;
        const user = await User.findById(req.user.id);

        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.emailVerified) return res.status(400).json({ success: false, message: 'Already verified' });

        if (!user.emailVerifyHash) return res.status(400).json({ success: false, message: 'No code generated' });

        const isMatch = await bcrypt.compare(code, user.emailVerifyHash);
        if (!isMatch) return res.status(400).json({ success: false, message: 'Invalid code' });

        user.emailVerified = true;
        user.emailVerifyHash = undefined;
        await user.save();

        res.status(200).json({ success: true, message: 'Email verified' });
    } catch (err) {
        next(err);
    }
};

exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email: email?.toLowerCase() });
        if (!user) {
            return res.status(200).json({ success: true, message: 'If account exists, email sent.' });
        }

        const code = generateCode();
        user.resetPasswordHash = await bcrypt.hash(code, 10);
        user.resetPasswordExpiry = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();

        await mailer.sendEmail(
            user.email,
            'Password Reset',
            `<p>Your password reset code is: <strong>${code}</strong></p>`
        );

        res.status(200).json({ success: true, message: 'If account exists, email sent.' });
    } catch (err) {
        next(err);
    }
};

exports.resetPassword = async (req, res, next) => {
    try {
        const { email, code, newPassword } = req.body;
        const user = await User.findOne({ email: email?.toLowerCase() });

        if (!user || !user.resetPasswordHash || !user.resetPasswordExpiry || user.resetPasswordExpiry < new Date()) {
            return res.status(400).json({ success: false, message: 'Invalid or expired token' });
        }

        const isMatch = await bcrypt.compare(code, user.resetPasswordHash);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Invalid code' });
        }

        user.passwordHash = newPassword;
        user.resetPasswordHash = undefined;
        user.resetPasswordExpiry = undefined;
        await user.save();

        await TokenUtils.revokeAllUserTokens(user._id);

        res.status(200).json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
        next(err);
    }
};