const rateLimit = require('express-rate-limit');

// Strict rate limit for auth endpoints to prevent brute-force
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 auth requests per 15 minutes
    message: 'Too many authentication attempts from this IP, please try again after 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    authLimiter
};
