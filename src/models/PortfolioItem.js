const mongoose = require('mongoose');

const portfolioItemSchema = new mongoose.Schema({
    ownerRef: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['github', 'website', 'video', 'document', 'image', 'project'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 2000 },
    tags: [{ type: String }],

    url: { type: String }, // For link-only Items and Completed Projects
    coverImage: { type: String }, // External URL or relative path to our GridFS file service

    fileId: { type: String }, // Cloudinary public_id OR GridFS file ID
    mimeType: { type: String },
    size: { type: Number },
    originalName: { type: String },
    storage: { type: String, enum: ['gridfs', 'external'], default: 'gridfs' }, // ready for S3 migration

    visibility: { type: String, enum: ['private', 'public', 'unlisted'], default: 'public' },

    source: { type: String, enum: ['app', 'user'], default: 'user' }, // 'app' = completed via platform project, 'user' = manually added
    projectRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' } // Links back to the originating project (app-completed only)
}, { timestamps: true });

portfolioItemSchema.index({ ownerRef: 1, createdAt: -1 });

module.exports = mongoose.model('PortfolioItem', portfolioItemSchema);
