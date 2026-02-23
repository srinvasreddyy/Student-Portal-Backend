/**
 * Consulted Docs:
 * OWASP Credential Stuffing Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html
 * OWASP Authentication Cheat Sheet (Account Lockout): https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout
 *
 * MIGRATION & OPERATIONS NOTES:
 * Currently using in-memory `Map` as fallback. In production cluster (multi-instance/PM2),
 * this MUST be migrated to Redis. Provide `redisClient` to store keys durably.
 * WARNING: In-memory store implies lack of durability and cluster isolation! 
 */

const { bruteForce: forceConfig } = require('../config/security');
const logger = require('../utils/logger'); // We will build logger later

// In-Memory fallback store
// Format: { [email_or_ip]: { count: number, lockedUntil: Date } }
const bruteForceStore = new Map();

class BruteForceProtector {
    /**
     * Middleware wrapped around auth/login endpoints.
     * Extracts email (or IP if unauthenticated) and enforces lockout rules.
     */
    static enforce() {
        return (req, res, next) => {
            const key = req.body.email ? req.body.email.toLowerCase() : req.ip;
            const record = bruteForceStore.get(key);

            if (record) {
                if (record.lockedUntil && record.lockedUntil > new Date()) {
                    logger.warn(`Locked account attempt`, { account: key, ip: req.ip });
                    return res.status(423).json({
                        success: false,
                        error: 'ACCOUNT_LOCKED',
                        message: `Account is temporarily locked due to too many failed attempts. Try again later.`,
                        lockedUntil: record.lockedUntil
                    });
                }

                // Lock implies it expired, reset count immediately before next attempt
                if (record.lockedUntil && record.lockedUntil <= new Date()) {
                    bruteForceStore.delete(key);
                }
            }
            next();
        };
    }

    /**
     * Call this when a login attempt fails (e.g. invalid password)
     */
    static async recordFailure(identifier) {
        const key = identifier.toLowerCase();
        let record = bruteForceStore.get(key) || { count: 0, lockedUntil: null };

        record.count += 1;

        if (record.count >= forceConfig.maxFailures) {
            const lockDurationMs = forceConfig.lockDurationMinutes * 60 * 1000;
            record.lockedUntil = new Date(Date.now() + lockDurationMs);
            logger.warn(`Account/IP locked out due to brute force`, { key });
        }

        bruteForceStore.set(key, record);
    }

    /**
     * Call this when a login attempt succeeds. Resets counters.
     */
    static async reset(identifier) {
        const key = identifier.toLowerCase();
        if (bruteForceStore.has(key)) {
            bruteForceStore.delete(key);
        }
    }

    // Admin Utility
    static forceUnlock(identifier) {
        bruteForceStore.delete(identifier.toLowerCase());
    }
}

module.exports = BruteForceProtector;
