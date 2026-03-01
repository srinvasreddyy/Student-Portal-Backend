const http = require('http');
const mongoose = require('mongoose');

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const seedSuperAdmin = require('./utils/seedSuperAdmin');

const server = http.createServer(app);


const envValidator = require('./utils/envValidator');
try {
    envValidator();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

async function startServer() {
    try {
        // Connect to MongoDB
        await mongoose.connect(config.db.uri);
        logger.info('Connected to MongoDB');

        // Ensure Super Admin exists in the database
        await seedSuperAdmin();

        // Start Express server
        server.listen(config.app.port, () => {
            logger.info(
                `Server running in ${config.app.env} mode on port ${config.app.port}`
            );
        });
    } catch (error) {
        logger.error(`Failed to start server: ${error.message}`);
        process.exit(1);
    }
}

// Handle graceful shutdown
function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
        logger.info('HTTP server closed.');
        try {
            await mongoose.connection.close();
            logger.info('MongoDB connection closed.');
            process.exit(0);
        } catch (error) {
            logger.error(`Error during MongoDB connection closure: ${error.message}`);
            process.exit(1);
        }
    });

    // Force close after 10 seconds
    setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
