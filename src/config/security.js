/**
 * Application Security Configuration
 * Centralized settings for limits, tokens, headers, and brute force rules.
 */

module.exports = {
    rateLimits: {
        global: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 100
        },
        strict: {
            windowMs: 15 * 60 * 1000,
            maxRequests: 5 // Auth bounds
        }
    },
    bruteForce: {
        maxFailures: 5,        // Lock account after this many failures in a row
        lockDurationMinutes: 15// Lockout expires after this duration
    },
    jwt: {
        accessExpiresIn: '15m', // Short-lived access
        refreshExpiresIn: '7d'  // Longer refresh validity
    },
    uploads: {
        maxSizeBytes: 10 * 1024 * 1024, // 10MB default
        allowedMimes: [
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ]
    },
    logging: {
        // Fields that the structured logger will redact/mask
        piiFields: ['password', 'passwordHash', 'token', 'refreshToken', 'email']
    }
};
