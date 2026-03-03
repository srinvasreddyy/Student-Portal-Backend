const mongoose = require('mongoose');

const applicantSchema = new mongoose.Schema({
    studentRef: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    appliedAt: { type: Date, default: Date.now }
}, { _id: false });

const acceptedStudentSchema = new mongoose.Schema({
    studentRef: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    acceptedAt: { type: Date, default: Date.now }
}, { _id: false });

const documentSchema = new mongoose.Schema({
    tag: { type: String, required: true },
    url: { type: String }, // For external links
    fileId: { type: String }, // Cloudinary public_id OR GridFS files
    fileName: { type: String }
}, { _id: true });

const videoSchema = new mongoose.Schema({
    tag: { type: String, required: true },
    url: { type: String, required: true }
}, { _id: false });

const projectSchema = new mongoose.Schema({
    postedByModel: { type: String, enum: ['Company', 'University'], required: true },
    postedBy: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'postedByModel' },
    streamChannelId: { type: String },

    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    roles: [{ type: String, required: true }],
    techStack: [{ type: String }],

    // Updated Media & Documents
    video: videoSchema,
    projectDocuments: [documentSchema],

    // Legacy fallback
    videoUrl: { type: String },

    maxStudentsRequired: { type: Number, required: true, min: 1 },
    durationInWeeks: { type: Number, required: true, max: 4 },

    status: {
        type: String,
        enum: ['open', 'in_progress', 'completed', 'cancelled'],
        default: 'open'
    },

    appliedStudents: [applicantSchema],
    acceptedStudents: [acceptedStudentSchema],

    sourceCodeUrl: { type: String }, // Provided by admin when marking project complete
    productionUrl: { type: String }  // Optional production/deployment link
}, { timestamps: true });

// Indexes for query performance
projectSchema.index({ status: 1 });
projectSchema.index({ postedBy: 1, postedByModel: 1 });

projectSchema.index({ 'acceptedStudents.studentRef': 1 }); // Lookup students in projects
projectSchema.index({ 'appliedStudents.studentRef': 1 });

// Virtuals
projectSchema.virtual('isFilled').get(function () {
    return this.acceptedStudents.length >= this.maxStudentsRequired;
});

projectSchema.virtual('availableSlots').get(function () {
    return Math.max(0, this.maxStudentsRequired - this.acceptedStudents.length);
});

projectSchema.set('toJSON', { virtuals: true });
projectSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Project', projectSchema);