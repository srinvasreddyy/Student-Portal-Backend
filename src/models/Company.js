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
        provider: { type: String }, // 'companies_house', 'opencorporates', 'ocr_fallback', etc.
        rawResponse: { type: mongoose.Schema.Types.Mixed }, // Truncated/capped if too large
        fetchedAt: { type: Date },
    },
});

const companySchema = new mongoose.Schema(
    {
        country: { type: String, required: true },
        companyNumber: { type: String }, // Required logic implemented via validation or controller for UK
        officialName: { type: String },
        aliases: [{ type: String }],
        website: { type: String },
        domains: [{ type: String }], // Normalized, lowercased, public-suffix trimmed variants
        numberOfEmployees: { type: String, enum: ['1-10', '11-50', '51-200', '201-500', '500+'] },
        industry: { type: String },
        fullAddress: { type: String },
        representative: {
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            name: { type: String },
            role: { type: String },
            dob: { type: Date },
            location: { type: String },
        },
        companyEmail: { type: String }, // Ensures login email and company email are uniform
        status: {
            type: String,
            enum: ['pending', 'verified', 'on_hold', 'rejected'],
            default: 'pending',
        },
        verification: { type: verificationSchema, default: () => ({}) },
        // MIGRATION NOTE: We swapped embedded `auditLogs: [auditLogSchema]` out for centralized references
        auditLogs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AuditLog' }],
        documents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'fs.files' }], // GridFS file refs
    },
    { timestamps: true }
);

// Indexes
companySchema.index(
    { country: 1, companyNumber: 1 },
    { unique: true, partialFilterExpression: { companyNumber: { $type: 'string' } } }
);
companySchema.index({ status: 1 });

// Statics for normalizing domains
companySchema.statics.normalizeDomain = function (domain, pslLibrary) {
    if (!domain) return null;
    const parsed = pslLibrary.parse(domain);
    if (parsed && parsed.domain) return parsed.domain.toLowerCase();
    return domain.toLowerCase();
};

// Methods to add audit logs
companySchema.methods.addAuditLog = async function (actorEmail, actorRole, action, details, options = {}) {
    const logs = await AuditLog.create([{
        actorEmail: actorEmail,
        actorRole: actorRole || 'system',
        targetType: 'company',
        targetId: this._id,
        actionType: action,
        details: details
    }], options);
    this.auditLogs.push(logs[0]._id);
};

module.exports = mongoose.model('Company', companySchema);