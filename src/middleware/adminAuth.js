const authMiddleware = require('./authMiddleware');

const adminGuard = [
    authMiddleware.authenticate,
    authMiddleware.authorize('super_admin')
];

module.exports = adminGuard;
