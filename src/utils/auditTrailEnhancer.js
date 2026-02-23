const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

/**
 * Enhances audit logging by automatically extracting context from the Express Request object.
 */
class AuditTrailEnhancer {
    /**
     * @param {Object} req - Express request
     * @param {String} action - Identifier (e.g. 'USER_LOGIN', 'PROJECT_CREATED')
     * @param {Object} details - Additional metadata
     * @param {String} status - 'success' or 'failure'
     */
    static async log(req, action, details = {}, status = 'success') {
        try {
            const auditEntry = new AuditLog({
                action,
                userRef: req.user ? req.user.id : null,
                role: req.user ? req.user.role : null,
                ipAddress: req.ip,
                userAgent: req.get('user-agent'),
                endpoint: req.originalUrl,
                method: req.method,
                status,
                details
            });

            await auditEntry.save();
        } catch (error) {
            // We do not want audit failures to crash the primary user flow. 
            // We drop it to standard logs instead.
            logger.error('Failed to write to AuditLog collection', { error: error.message, action });
        }
    }
}

module.exports = AuditTrailEnhancer;
