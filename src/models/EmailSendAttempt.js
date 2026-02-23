const mongoose = require('mongoose');

/**
 * Enhanced schema for robust email queuing and tracking
 */
const emailSendAttemptSchema = new mongoose.Schema({
    applicationId: { type: mongoose.Schema.Types.ObjectId, index: true }, // Optional link
    userRef: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    templateName: { type: String }, // Used to render HTML if defined
    payload: { type: mongoose.Schema.Types.Mixed }, // Template variables

    // Job queue tracking
    status: {
        type: String,
        enum: ['queued', 'sent', 'failed'],
        default: 'queued'
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },

    // SMTP Responses
    messageId: { type: String },
    rawResponse: { type: mongoose.Schema.Types.Mixed }, // Truncated original response

    // Idempotency: prevent double sending e.g. "welcome_email_user123"
    sendKey: { type: String, unique: true, sparse: true }
}, { timestamps: true });

// Optimize query for the job worker to pick up pending emails efficiently
emailSendAttemptSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('EmailSendAttempt', emailSendAttemptSchema);
