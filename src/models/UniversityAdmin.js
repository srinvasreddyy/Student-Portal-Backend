const mongoose = require('mongoose');

const universityAdminSchema = new mongoose.Schema(
    {
        organizationName: { type: String, required: true },
        country: { type: String, required: true },
        website: { type: String, required: true },
        officialEmail: {
            type: String,
            unique: true,
            required: true,
            lowercase: true,
            trim: true
        },
        phone: { type: String, required: true },
        representativeName: { type: String, required: true },
        isVerified: { type: Boolean, default: false },
        verificationMethod: {
            type: String,
            enum: ['internal_domain_match', 'manual', 'pending'],
            default: 'pending'
        },
        password: { type: String, required: true },
        role: { type: String, default: 'university' }
    },
    { timestamps: true }
);

// Compound index to prevent duplicate organizations per country
universityAdminSchema.index({ organizationName: 1, country: 1 }, { unique: true });

module.exports = mongoose.model('UniversityAdmin', universityAdminSchema);
