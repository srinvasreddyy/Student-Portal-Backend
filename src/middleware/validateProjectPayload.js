const validator = require('validator');

const validateProjectPayload = (req, res, next) => {
    const { title, description, roles, maxStudents, durationWeeks, video, projectDocuments } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Title is required' });
    }

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Description is required' });
    }

    if (!Array.isArray(roles) || roles.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one role is required' });
    }

    if (!maxStudents || typeof maxStudents !== 'number' || maxStudents < 1) {
        return res.status(400).json({ success: false, message: 'maxStudents must be a number > 0' });
    }

    if (!durationWeeks || typeof durationWeeks !== 'number' || durationWeeks < 1 || durationWeeks > 4) {
        return res.status(400).json({ success: false, message: 'invalid_duration. Must be 1-4 weeks' });
    }

    if (video) {
        if (!video.tag || !video.url) {
            return res.status(400).json({ success: false, message: 'Video must contain a tag and a url' });
        }
        if (!validator.isURL(video.url)) {
            return res.status(400).json({ success: false, message: 'Invalid video URL format' });
        }
    }

    if (projectDocuments !== undefined) {
        if (!Array.isArray(projectDocuments)) {
            return res.status(400).json({ success: false, message: 'projectDocuments must be an array' });
        }
        for (let doc of projectDocuments) {
            if (!doc.tag) {
                return res.status(400).json({ success: false, message: 'Each document must have a tag (title)' });
            }
            if (doc.url && !validator.isURL(doc.url)) {
                return res.status(400).json({ success: false, message: `Invalid URL for document: ${doc.tag}` });
            }
            if (!doc.url && !doc.fileId) {
                return res.status(400).json({ success: false, message: `Document '${doc.tag}' must contain either a url or file upload` });
            }
        }
    }

    next();
};

module.exports = validateProjectPayload;