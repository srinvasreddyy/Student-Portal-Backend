const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { generateTokens } = require('../utils/tokenUtils');

const refreshTokenSchema = new mongoose.Schema({
    tokenHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    passwordHash: { type: String, required: true },
    role: {
        type: String,
        enum: ['student', 'company_admin', 'university_admin', 'super_admin'],
        required: true,
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'suspended', 'rejected'],
        default: 'pending'
    },
    profile: { type: mongoose.Schema.Types.Mixed }, // Dynamic subdocument based on role
    emailVerified: { type: Boolean, default: false },
    emailVerifyHash: { type: String },
    resetPasswordHash: { type: String },
    resetPasswordExpiry: { type: Date },
    refreshTokens: [refreshTokenSchema],
    tokenVersion: { type: Number, default: 0 }, // Tracks mass revocations
    activeProjectRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    portfolio: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PortfolioItem' }]
}, { timestamps: true });

// Hash password before saving if modified
userSchema.pre('save', async function (next) {
    if (!this.isModified('passwordHash')) return next();

    try {
        const saltRounds = 12; // Configurable bcrypt rounds
        if (!this.passwordHash.startsWith('$2b$') && !this.passwordHash.startsWith('$2a$')) {
            this.passwordHash = await bcrypt.hash(this.passwordHash, saltRounds);
        }
        next();
    } catch (err) {
        next(err);
    }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Generate auth tokens
userSchema.methods.generateAuthTokens = async function () {
    return generateTokens(this);
};

// Add a hashed refresh token to the array
userSchema.methods.addRefreshToken = function (hashedToken) {
    this.refreshTokens.push({ tokenHash: hashedToken });
};

// Revoke a specific refresh token matching the hash
userSchema.methods.revokeRefreshToken = function (hashedToken) {
    this.refreshTokens = this.refreshTokens.filter(rt => rt.tokenHash !== hashedToken);
};

// Check if user is in one of the given roles
userSchema.methods.isInRole = function (...roles) {
    return roles.includes(this.role);
};

module.exports = mongoose.model('User', userSchema);
