const { verifyAccessToken } = require('../utils/tokenUtils');
const User = require('../models/User');

/**
 * Socket.io middleware to authenticate connections via JWT.
 * Validates the token and attaches the user document to `socket.user`.
 * 
 * https://socket.io/docs/v4/middlewares/ (Socket.io middleware docs)
 */
const socketAuth = async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;

        if (!token || !token.startsWith('Bearer ')) {
            const err = new Error('Authentication error: Missing or invalid token format');
            err.data = { type: 'unauthorized', code: 'MISSING_TOKEN' };
            return next(err); // Reject socket connection
        }

        const jwtToken = token.split(' ')[1];
        const decoded = verifyAccessToken(jwtToken);

        if (!decoded) {
            const err = new Error('Authentication error: Invalid or expired token');
            err.data = { type: 'unauthorized', code: 'INVALID_TOKEN' };
            return next(err);
        }

        const user = await User.findById(decoded.id).select('_id email role status profile');

        if (!user) {
            const err = new Error('Authentication error: User not found');
            err.data = { type: 'unauthorized', code: 'USER_NOT_FOUND' };
            return next(err);
        }

        if (user.status !== 'active') {
            const err = new Error('Authentication error: User account is not active');
            err.data = { type: 'forbidden', code: 'USER_NOT_ACTIVE' };
            return next(err);
        }

        // Attach user object to socket for use in event handlers
        socket.user = {
            id: user._id.toString(),
            email: user.email,
            role: user.role,
            // Assuming profile name exists; adjust based on actual profile schema
            name: user.profile?.name || user.profile?.firstName || user.email.split('@')[0]
        };

        next(); // Proceed with connection
    } catch (err) {
        return next(new Error(`Authentication error: ${err.message}`));
    }
};

module.exports = socketAuth;
