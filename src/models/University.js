const mongoose = require('mongoose');
const AuditLog = require('./AuditLog');

const verificationSchema = new mongoose.Schema({
    emailVerified: { type: Boolean, default: false },
    requiresManualVerification: { type: Boolean, default: true }, // CHANGED: ALL admins require manual verification by default
    needsDomainManualVerification: { type: Boolean, default: false }, // ADDED: Specific flag for domain mismatches
    emailTokenHash: { type: String },
    tokenExpiry: { type: Date },
    domainCheckedAt: { type: Date },
    externalLookup: {
        provider: { type: String }, // e.g., 'hipo_labs', 'ocr_fallback'
        rawResponse: { type: mongoose.Schema.Types.Mixed }, // Truncated/capped if too large
        fetchedAt: { type: Date, default: Date.now },
    },
});

const universitySchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        country: { type: String, required: true },
        domains: [{ type: String }], // Normalized (lowercase, base domain via PSL)
        website: { type: String },
        verified: { type: Boolean, default: false },
        representative: {
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            name: { type: String },
            role: { type: String },
            dob: { type: Date },
            location: { type: String },
            email: { type: String }, // Will now be strictly synced with User login email
        },
        status: {
            type: String,
            enum: ['pending', 'verified', 'on_hold', 'rejected'],
            default: 'pending',
        },
        verification: { type: verificationSchema, default: () => ({}) },
        // MIGRATION NOTE: We swapped embedded `auditLogs: [auditLogSchema]` out for centralized references
        auditLogs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AuditLog' }],
        documents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'fs.files' }],
    },
    { timestamps: true }
);

// Indexes
universitySchema.index({ country: 1, name: 1 }); // Search performance
universitySchema.index({ status: 1 }); // Admin listing

// Statics for normalizing domains
universitySchema.statics.normalizeDomain = function (domain, pslLibrary) {
    if (!domain) return null;
    const parsed = pslLibrary.parse(domain);
    if (parsed && parsed.domain) return parsed.domain.toLowerCase();
    return domain.toLowerCase();
};

// Methods to add audit logs
universitySchema.methods.addAuditLog = async function (actorEmail, actorRole, action, details, options = {}) {
    const logs = await AuditLog.create([{
        actorEmail: actorEmail,
        actorRole: actorRole || 'system',
        targetType: 'university',
        targetId: this._id,
        actionType: action,
        details: details
    }], options);
    this.auditLogs.push(logs[0]._id);
};

// Atomically mark verification status
universitySchema.methods.markVerificationStatus = async function (status, actorEmail = 'system', actorRole = 'system', reason = null) {
    this.status = status;
    if (status === 'verified') {
        this.verified = true;
    } else {
        this.verified = false;
    }
    await this.addAuditLog(actorEmail, actorRole, `marked_status_${status}`, { reason });
    return this.save();
};

module.exports = mongoose.model('University', universitySchema);