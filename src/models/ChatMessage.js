const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true }
}, { _id: false });

const chatMessageSchema = new mongoose.Schema({
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    senderRef: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderName: { type: String, required: true, trim: true }, // Denormalized to avoid joins on high-freq queries
    text: { type: String, default: '' },
    attachments: [attachmentSchema],
    edited: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date }
}, { timestamps: true });

// Compound index for cursor-based pagination (by projectId and createdAt DESC)
// This is critical for scaling message retrieval
chatMessageSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
