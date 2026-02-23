require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const config = require('../../src/config');
const logger = require('../../src/utils/logger');

// Outline for seeding one SuperAdmin user.
// Execute via `node scripts/seed/sampleSeed.js` after populating .env

async function runSeed() {
    try {
        if (!config.db.uri) {
            throw new Error('MONGO_URI is missing in .env');
        }
        await mongoose.connect(config.db.uri);
        logger.info('Connected to MongoDB for seeding');

        const saltRounds = 10;
        const adminPassword = 'SuperSecretPassword123!';
        const hashedPassword = await bcrypt.hash(adminPassword, saltRounds);

        const superAdmin = {
            email: 'admin@example.com',
            password: hashedPassword,
            role: 'super_admin'
        };

        logger.info(`Sample SuperAdmin data ready to insert: ${superAdmin.email}`);
        // await UserModel.create(superAdmin);

        logger.info('Seeding completed successfully');
    } catch (error) {
        logger.error(`Error seeding data: ${error}`);
    } finally {
        await mongoose.disconnect();
        logger.info('MongoDB disconnected');
        process.exit(0);
    }
}

runSeed();
