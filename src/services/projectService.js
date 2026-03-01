/**
 * Docs read & endpoints cited:
 * - Mongoose Transactions: https://mongoosejs.com/docs/transactions.html
 * - MongoDB Transactions: https://www.mongodb.com/docs/manual/core/transactions/
 * - MongoDB Core API (Session): https://www.mongodb.com/docs/manual/reference/method/Session.startTransaction/
 */

const mongoose = require('mongoose');
const Project = require('../models/Project');
const User = require('../models/User');
const StudentProfile = require('../models/StudentProfile');
const PortfolioItem = require('../models/PortfolioItem');
const { withTransaction } = require('../utils/transactionUtils');
const serverClient = require('../config/streamClient');

exports.createProject = async (authorId, authorType, payload) => {
    const project = new Project({
        postedBy: authorId,
        postedByModel: authorType === 'company' ? 'Company' : 'University',
        title: payload.title,
        description: payload.description,
        roles: payload.roles,
        techStack: payload.techStack || [],
        videoUrl: payload.videoUrl,
        maxStudentsRequired: payload.maxStudentsRequired || payload.maxStudents || 1,
        durationInWeeks: payload.durationInWeeks || payload.durationWeeks || 1,
        status: 'open'
    });

    // Create Stream.io Chat Room & Register Users
    const channelId = `project-${project._id.toString()}`;
    try {
        const superAdmin = await User.findOne({ role: 'super_admin' });
        const authorUser = await User.findById(authorId) || await mongoose.model(project.postedByModel).findById(authorId);
        
        const usersToUpsert = [];
        // Upsert Author
        if (authorUser) {
            usersToUpsert.push({ id: authorId.toString(), role: 'admin', name: authorUser.name || authorUser.officialName || authorUser.email || 'Project Admin' });
        } else {
            usersToUpsert.push({ id: authorId.toString(), role: 'admin', name: 'Organization Admin' });
        }
        // Upsert Super Admin
        if (superAdmin) {
            usersToUpsert.push({ id: superAdmin._id.toString(), role: 'admin', name: 'Super Admin' });
        }

        // Register them in stream to ensure they show up in chat
        await serverClient.upsertUsers(usersToUpsert);

        const members = usersToUpsert.map(u => u.id);

        const channel = serverClient.channel('messaging', channelId, {
            name: payload.title,
            created_by_id: authorId.toString(),
            members: members // Contains strictly Admin and Super Admin
        });
        await channel.create();
        project.streamChannelId = channelId;
    } catch (err) {
        console.error('Stream channel creation failed:', err.message);
    }

    await project.save();
    return project;
};

exports.applyToProject = async (projectId, studentId) => {
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

    const alreadyApplied = project.appliedStudents.some(a => a.studentRef.toString() === studentId.toString());
    if (alreadyApplied) {
        const err = new Error('already_applied'); err.status = 400; throw err;
    }

    const result = await Project.findOneAndUpdate(
        { _id: projectId, status: 'open', 'appliedStudents.studentRef': { $ne: studentId } },
        { $addToSet: { appliedStudents: { studentRef: studentId, appliedAt: new Date() } } },
        { new: true }
    );

    if (!result) {
        const err = new Error('could_not_apply'); err.status = 409; throw err;
    }
    return true;
};

exports.withdrawApplication = async (projectId, studentId) => {
    const result = await Project.findOneAndUpdate(
        { _id: projectId, status: 'open', 'appliedStudents.studentRef': studentId },
        { $pull: { appliedStudents: { studentRef: studentId } } },
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
        const project = await Project.findOne({ _id: projectId, postedBy: authorId }).session(session).exec();

        if (!project) throw Object.assign(new Error('project_not_found_or_forbidden'), { status: 404 });
        if (project.status !== 'open') throw Object.assign(new Error('project_not_open'), { status: 400 });
        if (project.acceptedStudents.length >= project.maxStudentsRequired) throw Object.assign(new Error('no_slots'), { status: 409 });

        const studentProfile = await StudentProfile.findOne({ userRef: studentId }).session(session).exec();
        if (studentProfile && studentProfile.status === 'engaged') throw Object.assign(new Error('student_already_engaged'), { status: 400 });

        project.acceptedStudents.push({ studentRef: studentId, acceptedAt: new Date() });
        project.appliedStudents = project.appliedStudents.filter(a => a.studentRef.toString() !== studentId.toString());

        if (project.acceptedStudents.length === project.maxStudentsRequired) {
            project.status = 'in_progress';
        }
        await project.save({ session });

        if (studentProfile) {
            studentProfile.status = 'engaged';
            studentProfile.activeProjectRef = project._id;
            await studentProfile.save({ session });
        }

        await User.findByIdAndUpdate(studentId, { activeProjectRef: project._id }, { session });

        await Project.updateMany(
            { 'appliedStudents.studentRef': studentId, _id: { $ne: project._id }, status: 'open' },
            { $pull: { appliedStudents: { studentRef: studentId } } }
        ).session(session);

        try {
            if (project.streamChannelId) {
                const studentUser = await User.findById(studentId);
                await serverClient.upsertUsers([{ id: studentId.toString(), role: 'user', name: studentUser?.email || 'Student' }]);
                const channel = serverClient.channel('messaging', project.streamChannelId);
                await channel.addMembers([studentId.toString()]);
            }
        } catch (err) {
            console.error('Stream add member failed:', err.message);
        }

        return { accepted: true, projectId: project._id, status: project.status };
    });
};

exports.rejectApplicant = async (projectId, studentId, authorId) => {
    const result = await Project.findOneAndUpdate(
        { _id: projectId, postedBy: authorId, status: 'open', 'appliedStudents.studentRef': studentId },
        { $pull: { appliedStudents: { studentRef: studentId } } },
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
        const project = await Project.findOne({ _id: projectId, postedBy: authorId }).session(session).exec();

        if (!project) throw Object.assign(new Error('project_not_found_or_forbidden'), { status: 404 });
        if (project.status !== 'in_progress') throw Object.assign(new Error('project_not_in_progress'), { status: 400 });

        project.status = 'completed';
        await project.save({ session });

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

        await User.updateMany(
            { _id: { $in: studentIds } },
            { $unset: { activeProjectRef: 1 } }
        ).session(session);

        await StudentProfile.updateMany(
            { userRef: { $in: studentIds } },
            { $unset: { activeProjectRef: 1 }, $set: { status: 'active' } }
        ).session(session);

        return { completed: true, projectId: project._id };
    });
};

exports.cancelProject = async (projectId, authorId) => {
    const project = await Project.findOneAndUpdate(
        { _id: projectId, postedBy: authorId, status: { $in: ['open', 'in_progress'] } },
        { status: 'cancelled' },
        { new: true }
    );

    if (!project) {
        const err = new Error('project_not_found_or_cannot_cancel'); err.status = 400; throw err;
    }

    if (project.acceptedStudents.length > 0) {
        const studentIds = project.acceptedStudents.map(a => a.studentRef);
        await User.updateMany(
            { _id: { $in: studentIds } },
            { $unset: { activeProjectRef: 1 } }
        );
        await StudentProfile.updateMany(
            { userRef: { $in: studentIds } },
            { $unset: { activeProjectRef: 1 }, $set: { status: 'active' } }
        );
    }

    return true;
};