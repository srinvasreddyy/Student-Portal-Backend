/**
 * Role-Based Access Control (RBAC) Guard Middleware
 * Ensure all admin and owner-only routes use the guard.
 */

const logger = require('../utils/logger'); // Will be created in utils

/**
 * Middleware factory to enforce RBAC.
 * @param {string[]} allowedRoles - Array of roles allowed to access the route. e.g. ['super_admin']
 */
const roleGuard = (allowedRoles = []) => {
    return (req, res, next) => {
        if (!req.user) {
            logger.warn('RoleGuard blocked request: Unauthenticated user attempted to access protected route', { path: req.originalUrl, ip: req.ip });
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            logger.warn(`RoleGuard blocked request: Role ${req.user.role} attempted access to route requiring ${allowedRoles.join(',')}`, {
                userId: req.user.id,
                path: req.originalUrl,
                ip: req.ip
            });
            return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
        }

        next();
    };
};

module.exports = roleGuard;
