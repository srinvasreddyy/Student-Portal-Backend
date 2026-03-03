const mongoose = require('mongoose');

const studentProfileSchema = new mongoose.Schema({
    userRef: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    education: [{
        institution: { type: String, required: true },
        degree: String,
        field: String,
        startYear: Number,
        endYear: Number,
        grade: String,
        isPrimary: { type: Boolean, default: false } // Auto-injected at registration; immutable
    }],
    techStack: [{ type: String }],
    experience: [{
        title: { type: String, required: true },
        company: { type: String, required: true },
        from: Date,
        to: Date,
        isCurrent: { type: Boolean, default: false },
        description: String
    }],
    bio: { type: String, maxlength: 2000 },
    privacy: {
        publicProfile: { type: Boolean, default: true },
        portfolioPublic: { type: Boolean, default: true }
    }
}, { timestamps: true });

module.exports = mongoose.model('StudentProfile', studentProfileSchema);
