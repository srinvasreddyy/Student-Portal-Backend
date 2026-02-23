/**
 * Validates critical environment variables at startup.
 * Fails fast if mandatory secrets are missing or weak to prevent insecure runtime states.
 */

const validateEnv = () => {
    const required = ['PORT', 'MONGO_URI', 'JWT_SECRET'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`CRITICAL: Missing required environment variables: ${missing.join(', ')}`);
    }

    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
        throw new Error(`CRITICAL: JWT_SECRET must be at least 32 characters long to ensure cryptic safety against brute forcing.`);
    }

    if (process.env.NODE_ENV === 'production' && !process.env.REFRESH_TOKEN_SECRET) {
        console.warn(`WARNING: REFRESH_TOKEN_SECRET is not set in production. Falling back to JWT_SECRET which reduces rotation isolation.`);
    }
};

module.exports = validateEnv;
