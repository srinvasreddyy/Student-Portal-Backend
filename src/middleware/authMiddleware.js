const { verifyAccessToken } = require('../utils/tokenUtils');
const User = require('../models/User');

const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = verifyAccessToken(token);

        if (!decoded) {
            return res.status(401).json({ success: false, message: 'Invalid or expired token' });
        }

        // Optional: Load full user to ensure they exist/active
        const user = await User.findById(decoded.id).select('-passwordHash -refreshTokens');
        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }

        // Basic status check for most routes (override per route if needed)
        if (user.status !== 'active' && req.originalUrl !== '/auth/verify-email') {
            return res.status(403).json({ success: false, message: 'Account is not active' });
        }

        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Forbidden: Insufficient role' });
        }
        next();
    };
};

module.exports = { authenticate, authorize };
