const logger = require('../utils/logger');
const config = require('../config');

// Centralized JSON error handler with status codes and no secrets in responses.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || 500;

    // Do not print secrets in logs. Sanitize req/res objects if needed.
    logger.error(`[${req.method} ${req.url}] ${err.message}`);
    if (err.stack && config.app.env !== 'production') {
        logger.error(err.stack);
    }

    res.status(statusCode).json({
        success: false,
        message: statusCode === 500 && config.app.env === 'production'
            ? 'Internal Server Error'
            : err.message,
        ...(config.app.env === 'development' && { stack: err.stack }),
    });
};

module.exports = errorHandler;
