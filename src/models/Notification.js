const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userRef: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed }, // Arbitrary data (e.g., { projectId: 'xxx' })
    read: { type: Boolean, default: false },
    deliveredEmail: { type: Boolean, default: false } // Was an email concurrently sent for this?
}, { timestamps: true });

// Optimize querying for user notifications and unread counts
notificationSchema.index({ userRef: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
