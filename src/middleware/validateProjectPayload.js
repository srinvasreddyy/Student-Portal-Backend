const validator = require('validator');

const validateProjectPayload = (req, res, next) => {
    const { title, description, roles, maxStudents, durationWeeks } = req.body;

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

    if (req.body.videoUrl && !validator.isURL(req.body.videoUrl)) {
        return res.status(400).json({ success: false, message: 'Invalid videoUrl' });
    }

    next();
};

module.exports = validateProjectPayload;
