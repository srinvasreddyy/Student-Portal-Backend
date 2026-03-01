const User = require('../models/User');
const logger = require('./logger');

/**
 * Checks if a Super Admin exists in the database.
 * If not, creates one using credentials from environment variables.
 * Called once during server startup after MongoDB connects.
 */
async function seedSuperAdmin() {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;

    if (!email || !password) {
        logger.warn('SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD not set in .env — skipping Super Admin seed.');
        return;
    }

    try {
        const existing = await User.findOne({ role: 'super_admin' });

        if (existing) {
            logger.info(`Super Admin already exists (${existing.email}). Skipping seed.`);
            return;
        }

        const superAdmin = new User({
            email: email.toLowerCase().trim(),
            passwordHash: password, // Pre-save hook will hash it
            role: 'super_admin',
            status: 'active',
            emailVerified: true,
            profile: {
                name: 'Super Admin'
            }
        });

        await superAdmin.save();
        logger.info(`Super Admin account created successfully (${superAdmin.email}).`);
    } catch (error) {
        logger.error(`Failed to seed Super Admin: ${error.message}`);
    }
}

module.exports = seedSuperAdmin;
