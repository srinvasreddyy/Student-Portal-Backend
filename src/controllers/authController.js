const User = require('../models/User');
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
        const { email, password, role, profile, representative, companyCandidate } = req.body;

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
            newUser.status = 'active'; 
        } else {
            // Ensure newly registered admins start as pending and require Super Admin approval
            newUser.status = 'pending';
            
            if (representative) newUser.profile.representative = representative;
            if (companyCandidate) newUser.profile.companyCandidate = companyCandidate;
        }

        const verifyCode = generateCode();
        newUser.emailVerifyHash = await bcrypt.hash(verifyCode, 10);

        await newUser.save();

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
            message: 'Registration successful',
            user: { id: newUser._id, email: newUser.email, role: newUser.role, status: newUser.status }
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

        // ==========================================
        // NEW LOGIC: Block unapproved Admins directly at Login
        // ==========================================
        if (['company_admin', 'university_admin'].includes(user.role)) {
            if (user.status === 'pending' || user.status === 'on_hold') {
                await BruteForceProtector.recordFailure(normalizedEmail);
                return res.status(403).json({ success: false, message: 'Contact super admin for approval' });
            }
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            await BruteForceProtector.recordFailure(normalizedEmail);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        await BruteForceProtector.reset(normalizedEmail);

        const accessToken = TokenUtils.generateAccessToken(user);
        const refreshToken = await TokenUtils.generateRefreshToken(user);

        let streamToken = null;
        try {
            await serverClient.upsertUser({
                id: user._id.toString(),
                name: user.email,
                role: user.role === 'student' ? 'user' : 'admin'
            });
            streamToken = serverClient.createToken(user._id.toString());
        } catch (streamErr) {
            console.error(`Stream Chat user creation failed: ${streamErr.message}`);
        }

        const tokens = { accessToken, refreshToken, streamToken };

        res.status(200).json({ success: true, tokens, user: { id: user._id, email: user.email, role: user.role, status: user.status } });
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