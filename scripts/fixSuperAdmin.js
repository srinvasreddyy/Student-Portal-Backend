/**
 * Verify and fix the super admin user.
 * Connects to MongoDB, finds the super_admin user, and resets their password
 * to the value in SUPER_ADMIN_PASSWORD from .env.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const admin = await User.findOne({ role: 'super_admin' });
    if (!admin) {
        console.log('No super_admin found! Creating one...');
        const newAdmin = new User({
            email: process.env.SUPER_ADMIN_EMAIL.toLowerCase().trim(),
            passwordHash: process.env.SUPER_ADMIN_PASSWORD,
            role: 'super_admin',
            status: 'active',
            emailVerified: true,
            profile: { name: 'Super Admin' }
        });
        await newAdmin.save();
        console.log('Super Admin created:', newAdmin.email);
    } else {
        console.log('Found super_admin:', admin.email, '| status:', admin.status);
        console.log('Resetting password to:', process.env.SUPER_ADMIN_PASSWORD);
        admin.passwordHash = process.env.SUPER_ADMIN_PASSWORD;
        admin.status = 'active';
        await admin.save();
        console.log('Password reset done. Verifying...');

        // Verify login works
        const isMatch = await admin.comparePassword(process.env.SUPER_ADMIN_PASSWORD);
        console.log('Password verification:', isMatch ? 'SUCCESS ✓' : 'FAILED ✗');
    }

    await mongoose.disconnect();
    console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
