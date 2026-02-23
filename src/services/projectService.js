/**
 * Docs read & endpoints cited:
 * - Mongoose Transactions: https://mongoosejs.com/docs/transactions.html
 * - MongoDB Transactions: https://www.mongodb.com/docs/manual/core/transactions/
 * - MongoDB Core API (Session): https://www.mongodb.com/docs/manual/reference/method/Session.startTransaction/
 */

const mongoose = require('mongoose');
const Project = require('../models/Project');
const User = require('../models/User');
const PortfolioItem = require('../models/PortfolioItem');
const { withTransaction } = require('../utils/transactionUtils');

exports.createProject = async (authorId, authorType, payload) => {
    const project = new Project({
        authorRef: authorId,
        authorType: authorType,
        authorModel: authorType === 'company' ? 'Company' : 'University',
        title: payload.title,
        description: payload.description,
        roles: payload.roles,
        techStack: payload.techStack || [],
        videoUrl: payload.videoUrl,
        maxStudents: payload.maxStudents,
        durationWeeks: payload.durationWeeks,
        status: 'open'
    });
    await project.save();
    return project;
};

exports.applyToProject = async (projectId, studentId) => {
    // Basic pre-checks via explicit find
    const project = await Project.findById(projectId);
    if (!project) {
        const err = new Error('project_not_found'); err.status = 404; throw err;
    }
    if (project.status !== 'open') {
        const err = new Error('project_not_open'); err.status = 400; throw err;
    }

    const student = await User.findById(studentId);
    if (student.activeProjectRef) {
        const err = new Error('student_already_active'); err.status = 400; throw err;
    }

    const alreadyApplied = project.applicants.some(a => a.studentRef.toString() === studentId.toString());
    if (alreadyApplied) {
        const err = new Error('already_applied'); err.status = 400; throw err;
    }

    // Atomic addition
    const result = await Project.findOneAndUpdate(
        { _id: projectId, status: 'open', 'applicants.studentRef': { $ne: studentId } },
        { $addToSet: { applicants: { studentRef: studentId, appliedAt: new Date() } } },
        { new: true }
    );

    if (!result) {
        // Condition failed (maybe it got filled/closed between checks, or concurrency hit)
        const err = new Error('could_not_apply'); err.status = 409; throw err;
    }

    return true;
};

exports.withdrawApplication = async (projectId, studentId) => {
    const result = await Project.findOneAndUpdate(
        { _id: projectId, status: 'open', 'applicants.studentRef': studentId },
        { $pull: { applicants: { studentRef: studentId } } },
        { new: true }
    );

    if (!result) {
        const err = new Error('not_applied_or_project_not_open'); err.status = 400; throw err;
    }
    return true;
};

exports.acceptStudent = async (projectId, studentId, authorId) => {
    const conn = mongoose.connection;
    return await withTransaction(conn, async (session) => {
        // Refetch project inside session, lock it down optionally, but for Mongoose transactional reads 
        // changes made after this point by others will trigger a transient error on commit
        const project = await Project.findOne({ _id: projectId, authorRef: authorId }).session(session).exec();

        if (!project) throw Object.assign(new Error('project_not_found_or_forbidden'), { status: 404 });
        if (project.status !== 'open') throw Object.assign(new Error('project_not_open'), { status: 400 });
        if (project.acceptedStudents.length >= project.maxStudents) throw Object.assign(new Error('no_slots'), { status: 409 });

        const student = await User.findById(studentId).session(session).exec();
        if (!student) throw Object.assign(new Error('student_not_found'), { status: 404 });
        if (student.activeProjectRef) throw Object.assign(new Error('student_already_active'), { status: 400 });

        // Add to accepted
        project.acceptedStudents.push({ studentRef: studentId, acceptedAt: new Date() });

        // Remove from applicants
        project.applicants = project.applicants.filter(a => a.studentRef.toString() !== studentId.toString());

        // Update Project Status if full
        if (project.acceptedStudents.length === project.maxStudents) {
            project.status = 'in_progress';
        }

        await project.save({ session });

        // Update student
        student.activeProjectRef = project._id;
        await student.save({ session });

        // Remove student from all other pending applications across open projects
        await Project.updateMany(
            { 'applicants.studentRef': studentId, _id: { $ne: project._id }, status: 'open' },
            { $pull: { applicants: { studentRef: studentId } } }
        ).session(session);

        return { accepted: true, projectId: project._id, status: project.status };
    });
};

exports.rejectApplicant = async (projectId, studentId, authorId) => {
    const result = await Project.findOneAndUpdate(
        { _id: projectId, authorRef: authorId, status: 'open', 'applicants.studentRef': studentId },
        { $pull: { applicants: { studentRef: studentId } } },
        { new: true }
    );

    if (!result) {
        const err = new Error('applicant_not_found_or_forbidden'); err.status = 404; throw err;
    }
    return true;
};

exports.completeProject = async (projectId, authorId) => {
    const conn = mongoose.connection;
    return await withTransaction(conn, async (session) => {
        const project = await Project.findOne({ _id: projectId, authorRef: authorId }).session(session).exec();

        if (!project) throw Object.assign(new Error('project_not_found_or_forbidden'), { status: 404 });
        if (project.status !== 'in_progress') throw Object.assign(new Error('project_not_in_progress'), { status: 400 });

        project.status = 'completed';
        await project.save({ session });

        // Find accepted students
        const studentIds = project.acceptedStudents.map(a => a.studentRef);

        const portfolioDocs = studentIds.map(sid => ({
            ownerRef: sid,
            type: 'project',
            title: project.title,
            description: project.description,
            tags: project.roles,
            url: `/projects/${project._id}`,
            visibility: 'public'
        }));

        if (portfolioDocs.length > 0) {
            await PortfolioItem.insertMany(portfolioDocs, { session });
        }

        // Clear their activeProjectRef
        await User.updateMany(
            { _id: { $in: studentIds } },
            { $unset: { activeProjectRef: 1 } }
        ).session(session);

        return { completed: true, projectId: project._id };
    });
};

exports.cancelProject = async (projectId, authorId) => {
    const project = await Project.findOneAndUpdate(
        { _id: projectId, authorRef: authorId, status: { $in: ['open', 'in_progress'] } },
        { status: 'cancelled' },
        { new: true }
    );

    if (!project) {
        const err = new Error('project_not_found_or_cannot_cancel'); err.status = 400; throw err;
    }

    // Free accepted students if any
    if (project.acceptedStudents.length > 0) {
        const studentIds = project.acceptedStudents.map(a => a.studentRef);
        await User.updateMany(
            { _id: { $in: studentIds } },
            { $unset: { activeProjectRef: 1 } }
        );
    }

    return true;
};
