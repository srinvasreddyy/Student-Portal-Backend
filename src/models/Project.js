const mongoose = require('mongoose');

const applicantSchema = new mongoose.Schema({
    studentRef: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    appliedAt: { type: Date, default: Date.now }
}, { _id: false });

const acceptedStudentSchema = new mongoose.Schema({
    studentRef: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    acceptedAt: { type: Date, default: Date.now }
}, { _id: false });

const projectSchema = new mongoose.Schema({
    authorRef: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'authorModel' },
    authorType: { type: String, enum: ['company', 'university'], required: true },
    authorModel: { type: String, enum: ['Company', 'University'], required: true }, // For dynamic refPath

    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    roles: [{ type: String, required: true }],
    techStack: [{ type: String }],
    videoUrl: { type: String },

    maxStudents: { type: Number, required: true, min: 1 },
    durationWeeks: { type: Number, required: true, min: 1, max: 4 },

    status: {
        type: String,
        enum: ['open', 'in_progress', 'completed', 'cancelled'],
        default: 'open'
    },

    applicants: [applicantSchema],
    acceptedStudents: [acceptedStudentSchema]
}, { timestamps: true });

// Indexes for feed and quick lookups
projectSchema.index({ status: 1, createdAt: -1 });
projectSchema.index({ 'acceptedStudents.studentRef': 1 }); // Lookup students in projects
projectSchema.index({ 'applicants.studentRef': 1 });

// Virtuals
projectSchema.virtual('isFilled').get(function () {
    return this.acceptedStudents.length >= this.maxStudents;
});

projectSchema.virtual('availableSlots').get(function () {
    return Math.max(0, this.maxStudents - this.acceptedStudents.length);
});

// Ensure virtuals are included when converting to JSON/Object
projectSchema.set('toJSON', { virtuals: true });
projectSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Project', projectSchema);
