const Project = require('../models/Project');
const projectService = require('../services/projectService');
const storageService = require('../services/storageService');
const serverClient = require('../config/streamClient');

exports.createProject = async (req, res, next) => {
    try {
        if (!['company_admin', 'university_admin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Only companies and universities can create projects' });
        }
        const authorType = req.user.role === 'company_admin' ? 'company' : 'university';
        const authorId = req.user.organizationId || req.user._id;

        const project = await projectService.createProject(authorId, authorType, req.body);
        res.status(201).json({ success: true, data: project });
    } catch (err) { next(err); }
};

exports.uploadDocument = async (req, res, next) => {
    try {
        if (!req.streamedFile) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const { fileId, filename } = await storageService.uploadFileStream({
            fileStream: req.streamedFile.stream,
            filename: req.streamedFile.filename,
            metadata: {
                uploader: req.user._id,
                type: 'project_document',
                mimeType: req.streamedFile.mimeType
            }
        });

        res.status(200).json({ success: true, fileId, filename });
    } catch (err) { next(err); }
};

exports.downloadDocument = async (req, res, next) => {
    try {
        await storageService.downloadFileStream(req.params.fileId, res, req.headers);
    } catch (err) { next(err); }
};

exports.listProjects = async (req, res, next) => {
    try {
        const { techStack, authorType, q, page = 1, limit = 10 } = req.query;
        const query = { status: 'open' };

        if (techStack) query.techStack = { $in: techStack.split(',') };
        if (authorType) query.postedByModel = authorType === 'company' ? 'Company' : 'University';
        if (q) query.$or = [{ title: new RegExp(q, 'i') }, { description: new RegExp(q, 'i') }];

        const skip = (page - 1) * limit;

        const pipeline = [
            { $match: query },
            { $addFields: { currentAcceptedCount: { $size: { $ifNull: ["$acceptedStudents", []] } } } },
            { $match: { $expr: { $lt: ["$currentAcceptedCount", "$maxStudentsRequired"] } } },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: parseInt(limit) }
        ];

        const openProjects = await Project.aggregate(pipeline);

        const totalPipeline = [
            { $match: query },
            { $addFields: { currentAcceptedCount: { $size: { $ifNull: ["$acceptedStudents", []] } } } },
            { $match: { $expr: { $lt: ["$currentAcceptedCount", "$maxStudentsRequired"] } } },
            { $count: "total" }
        ];

        const totalResult = await Project.aggregate(totalPipeline);
        const total = totalResult.length > 0 ? totalResult[0].total : 0;

        res.status(200).json({ success: true, count: openProjects.length, total, data: openProjects });
    } catch (err) { next(err); }
};

exports.getProject = async (req, res, next) => {
    try {
        const project = await Project.findById(req.params.id)
            .populate('acceptedStudents.studentRef');

        if (!project) return res.status(404).json({ success: false, message: 'Not found' });

        const orgIdStr = req.user?.organizationId?.toString();
        const userIdStr = req.user?._id?.toString();
        const postedByIdStr = project.postedBy?.toString();

        const isOwner = req.user && (
            postedByIdStr === orgIdStr ||
            postedByIdStr === userIdStr
        );
        const isAdmin = req.user && req.user.role === 'super_admin';

        // Populate postedBy after ownership check
        await project.populate({ path: 'postedBy', strictPopulate: false });

        let safeData = project.toObject();

        if (!isOwner && !isAdmin) {
            delete safeData.appliedStudents;
        } else {
            await project.populate('appliedStudents.studentRef');
            safeData = project.toObject();
        }

        res.status(200).json({ success: true, data: safeData });
    } catch (err) { next(err); }
};

exports.applyToProject = async (req, res, next) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Only students can apply' });
        await projectService.applyToProject(req.params.id, req.user._id);
        res.status(200).json({ success: true, applied: true, projectId: req.params.id });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
    }
};

exports.withdrawApplication = async (req, res, next) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Forbidden' });
        await projectService.withdrawApplication(req.params.id, req.user._id);
        res.status(200).json({ success: true, withdrawn: true });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
    }
};

exports.acceptStudent = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { studentRef } = req.body;
        const authorId = req.user.organizationId || req.user._id;

        if (!studentRef) return res.status(400).json({ success: false, message: 'studentRef required' });
        const result = await projectService.acceptStudent(id, studentRef, authorId);
        res.status(200).json({ success: true, ...result });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
    }
};

exports.removeStudent = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { studentRef } = req.body;
        const authorId = req.user.organizationId || req.user._id;

        if (!studentRef) return res.status(400).json({ success: false, message: 'studentRef required' });
        const result = await projectService.removeStudent(id, studentRef, authorId);
        res.status(200).json({ success: true, ...result });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
    }
};

exports.rejectApplicant = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { studentRef, reason } = req.body;
        const authorId = req.user.organizationId || req.user._id;
        await projectService.rejectApplicant(id, studentRef, authorId);
        res.status(200).json({ success: true, rejected: true });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
    }
};

exports.completeProject = async (req, res, next) => {
    try {
        const authorId = req.user.organizationId || req.user._id;
        const result = await projectService.completeProject(req.params.id, authorId);
        res.status(200).json({ success: true, ...result });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
    }
};

exports.cancelProject = async (req, res, next) => {
    try {
        const authorId = req.user.organizationId || req.user._id;
        await projectService.cancelProject(req.params.id, authorId);
        res.status(200).json({ success: true, cancelled: true });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
    }
};

exports.adminListProjects = async (req, res, next) => {
    try {
        const projects = await Project.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, count: projects.length, data: projects });
    } catch (err) { next(err); }
};

exports.adminDeleteProject = async (req, res, next) => {
    try {
        const project = await Project.findById(req.params.id);
        if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

        // Delete associated Chat Channel
        if (project.streamChannelId) {
            try {
                const channel = serverClient.channel('messaging', project.streamChannelId);
                await channel.delete();
            } catch (err) {
                console.warn('Could not delete stream channel or it did not exist', err.message);
            }
        }

        await Project.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Project and Chat deleted completely.' });
    } catch (err) { next(err); }
};

exports.getMyProjects = async (req, res, next) => {
    try {
        const userId = req.user.organizationId || req.user._id;
        const role = req.user.role;
        let query = {};

        if (['company_admin', 'university_admin'].includes(role)) {
            query = { postedBy: userId };
        } else if (role === 'student') {
            query = { 'acceptedStudents.studentRef': userId };
        } else if (role === 'super_admin') {
            query = {};
        }

        const projects = await Project.find(query).sort({ createdAt: -1 });
        res.status(200).json({ success: true, count: projects.length, data: projects });
    } catch (err) { next(err); }
};

exports.updateProjectMedia = async (req, res, next) => {
    try {
        const authorId = req.user.organizationId || req.user._id;
        const project = await projectService.updateProjectMedia(req.params.id, authorId, req.body);
        res.status(200).json({ success: true, data: project });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
    }
};