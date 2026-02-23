const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    actorRef: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional, can be system
    actorEmail: { type: String, required: true, index: true }, // Denormalized for fast queries
    actorRole: { type: String, required: true },

    targetType: { type: String, enum: ['company', 'university', 'system'], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },

    actionType: {
        type: String,
        enum: ['approve', 'reject', 'hold', 'resend_email', 'add_note', 'apply', 'upload'],
        required: true
    },

    details: { type: mongoose.Schema.Types.Mixed }, // Freeform JSON, minimal PII
    ip: { type: String },
    userAgent: { type: String },
}, { timestamps: true });

// Specific query access patterns
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ actorRef: 1, createdAt: -1 });

// Note on TTL Index:
// To ensure immutable historical records for compliance, we do NOT use an automated TTL drop. 
// Instead, for DB growth strategy at scale, we recommend partitioning by year 
// or chron-job archiving to S3 after 12 months.
// Example TTL (Do not uncomment unless legally required to wipe):
// auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 31536000 }); // 1 Year

module.exports = mongoose.model('AuditLog', auditLogSchema);
