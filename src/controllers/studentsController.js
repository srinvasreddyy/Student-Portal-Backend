const mongoose = require('mongoose');
const StudentProfile = require('../models/StudentProfile');
const PortfolioItem = require('../models/PortfolioItem');
const { validateLink } = require('../utils/linkValidator');
const storageService = require('../services/storageService');

exports.getProfile = async (req, res, next) => {
    try {
        let profile = await StudentProfile.findOne({ userRef: req.user._id });
        if (!profile) {
            profile = await StudentProfile.create({ userRef: req.user._id, education: [], experience: [], techStack: [] });
        }
        res.status(200).json({ success: true, data: profile });
    } catch (err) { next(err); }
};

exports.updateProfile = async (req, res, next) => {
    try {
        const { education, techStack, experience, bio, privacy } = req.body;

        // ── Protect isPrimary education entry ──
        const existingProfile = await StudentProfile.findOne({ userRef: req.user._id });
        let finalEducation = education || [];

        if (existingProfile) {
            const primaryEntry = (existingProfile.education || []).find(e => e.isPrimary === true);
            if (primaryEntry) {
                // Strip any incoming entries that claim to be primary
                finalEducation = finalEducation.filter(e => !e.isPrimary);
                // Re-inject the original primary entry at index 0
                finalEducation.unshift(primaryEntry.toObject ? primaryEntry.toObject() : primaryEntry);
            }
        }

        const updated = await StudentProfile.findOneAndUpdate(
            { userRef: req.user._id },
            { $set: { education: finalEducation, techStack, experience, bio, privacy } },
            { new: true, runValidators: true, upsert: true }
        );

        res.status(200).json({ success: true, data: updated });
    } catch (err) { next(err); }
};

exports.listPortfolio = async (req, res, next) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        const items = await PortfolioItem.find({ ownerRef: req.user._id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await PortfolioItem.countDocuments({ ownerRef: req.user._id });

        res.status(200).json({ success: true, count: items.length, total, data: items });
    } catch (err) { next(err); }
};

exports.addPortfolioItem = async (req, res, next) => {
    try {
        // Form boundary or JSON handling via busboy middleware (req.body contains fields, req.streamedFile has the file)
        const { title, description, tags, visibility, url, coverImage } = req.body;

        if (!title) return res.status(400).json({ success: false, message: 'Title required' });

        const safeTags = tags ? (Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : []) : [];

        // 1. Handling Link-only submission
        if (url && !req.streamedFile) {
            const { valid, type, normalizedUrl } = validateLink(url);
            if (!valid) return res.status(400).json({ success: false, message: 'Invalid URL format' });

            const item = await PortfolioItem.create({
                ownerRef: req.user._id,
                type,
                title,
                description,
                tags: safeTags,
                url: normalizedUrl,
                visibility: visibility || 'public',
                coverImage,
                source: 'user'
            });
            return res.status(201).json({ success: true, data: item });
        }

        // 2. Handling File Upload (Native GridFS streamed)
        if (req.streamedFile) {
            const { stream, filename, mimeType } = req.streamedFile;

            // We use file-type's wrapper to sniff the stream buffer directly before committing
            // Fallback for missing module in raw node (we didn't install file-type in container test runtime dynamically)
            let actualMime = mimeType;
            let sniffStream = stream;

            try {
                const { fileTypeStream } = await import('file-type');
                sniffStream = await fileTypeStream(stream);
                if (sniffStream.fileType && sniffStream.fileType.mime) {
                    actualMime = sniffStream.fileType.mime;
                }
            } catch (e) { /* fallback */ }

            let itemType = 'document';
            if (actualMime.startsWith('image/')) itemType = 'image';
            else if (actualMime.startsWith('video/')) itemType = 'video';

            const metadata = { ownerRef: req.user._id, originalName: filename, mimeType: actualMime };

            // Upload to GridFS via service
            // Note: stream handles limit truncations natively throwing 'limit' if over 20MB

            let fileData;
            try {
                const gridBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: process.env.GRIDFS_BUCKET_NAME || 'portfolios' });
                const uploadStream = gridBucket.openUploadStream(filename, { metadata });

                await new Promise((resolve, reject) => {
                    uploadStream.on('finish', resolve);
                    uploadStream.on('error', reject);
                    sniffStream.on('error', reject);
                    sniffStream.pipe(uploadStream);
                });

                fileData = { _id: uploadStream.id };

            } catch (e) {
                return next(e);
            }

            const item = await PortfolioItem.create({
                ownerRef: req.user._id,
                type: itemType,
                title,
                description,
                tags: safeTags,
                fileId: fileData._id,
                mimeType: actualMime,
                originalName: filename,
                storage: 'gridfs',
                visibility: visibility || 'public',
                coverImage,
                source: 'user'
            });

            return res.status(201).json({ success: true, data: item });
        }

        res.status(400).json({ success: false, message: 'Provide a valid URL or File upload' });
    } catch (err) { next(err); }
};

exports.deletePortfolioItem = async (req, res, next) => {
    try {
        const item = await PortfolioItem.findOne({ _id: req.params.itemId, ownerRef: req.user._id });
        if (!item) return res.status(404).json({ success: false, message: 'Not found' });

        if (item.fileId && item.storage === 'gridfs') {
            await storageService.deleteFile(item.fileId);
        }

        await PortfolioItem.deleteOne({ _id: item._id });

        res.status(204).json();
    } catch (err) { next(err); }
};

exports.downloadOrViewItemStream = async (req, res, next) => {
    try {
        const { itemId } = req.params;

        // Locate
        const item = await PortfolioItem.findById(itemId);
        if (!item) return res.status(404).json({ success: false, message: 'Item Not found' });

        // Visibility Auth Checks
        if (item.visibility === 'private' && (!req.user || req.user._id.toString() !== item.ownerRef.toString())) {
            return res.status(403).json({ success: false, message: 'Private portfolio item' });
        }

        if (!item.fileId) return res.status(400).json({ success: false, message: 'This is a link item, not file-backed' });

        // Range/Stream header forwarder helper
        await storageService.downloadFileStream(item.fileId, res, req.headers);

    } catch (err) { next(err); }
};

exports.getPublicProfile = async (req, res, next) => {
    try {
        const studentId = req.params.userId;

        const profile = await StudentProfile.findOne({ userRef: studentId }).populate('userRef', 'name email');
        if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });

        if (profile.privacy && profile.privacy.publicProfile === false) {
            const isAdmin = req.user && req.user.role === 'super_admin';
            if (!isAdmin) return res.status(403).json({ success: false, message: 'Profile is private' });
        }

        // Fetch their public portfolio items
        let filter = { ownerRef: studentId, visibility: 'public' };
        if (req.user && req.user.role === 'super_admin') delete filter.visibility; // Admins see all

        const portfolio = await PortfolioItem.find(filter).sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: { profile, portfolio } });
    } catch (err) { next(err); }
};

exports.getStudentPortfolio = async (req, res, next) => {
    try {
        const studentId = req.params.userId;

        const items = await PortfolioItem.find({ ownerRef: studentId, visibility: 'public' })
            .populate('projectRef', 'title description techStack roles durationInWeeks postedByModel sourceCodeUrl productionUrl status')
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({ success: true, count: items.length, data: items });
    } catch (err) { next(err); }
};

exports.uploadPortfolioImage = async (req, res, next) => {
    try {
        if (!req.streamedFile) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const { fileId, filename, url } = await storageService.uploadFileStream({
            fileStream: req.streamedFile.stream,
            filename: req.streamedFile.filename,
            metadata: {
                uploader: req.user._id,
                type: 'portfolio_cover',
                mimeType: req.streamedFile.mimeType
            }
        });

        res.status(200).json({ success: true, fileId, url });
    } catch (err) { next(err); }
};

exports.getPortfolioImage = async (req, res, next) => {
    try {
        await storageService.downloadFileStream(req.params.fileId, res, req.headers);
    } catch (err) { next(err); }
};
