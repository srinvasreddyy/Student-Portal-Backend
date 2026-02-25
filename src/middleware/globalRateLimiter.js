/**
 * Consulted Docs:
 * Express Rate Limit: https://github.com/express-rate-limit/express-rate-limit
 * OWASP Automated Threat Handbook (Rate Limiting): https://owasp.org/www-project-automated-threats-to-web-applications/
 */

const rateLimit = require('express-rate-limit');
const { emailRateLimiter } = require('./emailRateLimiter'); // Keep existing specialized limiter

// Central config
const limitsConfig = require('../config/security').rateLimits;

/**
 * Global API rate limiter.
 * Protects against basic volumetric DoS attacks map-ping the entire application surface.
 * e.g., default: 100 requests per sliding 15 minute window per IP
 */
const globalRateLimiter = rateLimit({
    windowMs: limitsConfig.global.windowMs || 15 * 60 * 1000, // 15 mins default
    max: limitsConfig.global.maxRequests || 100, // Limit each IP to 100 requests per `window`
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
        success: false,
        error: 'GLOBAL_RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again after 15 minutes.'
    },
    skip: () => process.env.NODE_ENV === 'test' && process.env.TEST_RATE_LIMITER !== 'true'
    // Uses standard IP headers (x-forwarded-for etc. if proxy configured)
});

/**
 * Strict endpoint rate limiter.
 * Used for high risk endpoints such as Passwords, OTPs, Registrations, Login attempts.
 * e.g., default: 5 attempts per 15 minute window per IP
 */
const strictRateLimiter = rateLimit({
    windowMs: limitsConfig.strict.windowMs || 15 * 60 * 1000,
    max: limitsConfig.strict.maxRequests || 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'STRICT_RATE_LIMIT_EXCEEDED',
        message: 'Too many attempts for this action. Please try again later.'
    },
    skip: () => process.env.NODE_ENV === 'test' && process.env.TEST_RATE_LIMITER !== 'true'
});

module.exports = {
    globalRateLimiter,
    strictRateLimiter,
    emailRateLimiter // Exporting existing
};
