/**
 * Consulted Docs:
 * Auth0 JWT Best Practices: https://auth0.com/docs/secure/tokens/json-web-tokens/json-web-token-best-practices
 * OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const { jwt: jwtConfig } = require('../config/security');
const logger = require('./logger');
const User = require('../models/User');

class TokenUtils {
    /**
     * Generate short-lived stateless Access Token
     */
    static generateAccessToken(user) {
        return jwt.sign(
            {
                id: user._id,
                role: user.role,
                status: user.status,
                tokenVersion: user.tokenVersion || 0 // Used for global rapid invalidation
            },
            config.jwt.secret,
            { expiresIn: jwtConfig.accessExpiresIn || '15m' }
        );
    }

    /**
     * Generate opaque long-lived Refresh Token (Cryptographically secure random string)
     * We store the HASH in the database, handing the plaintext to the user.
     */
    static async generateRefreshToken(user) {
        const randomHex = crypto.randomBytes(40).toString('hex');
        const plainTextToken = `${user._id.toString()}.${randomHex}`;

        // Store hashed version in DB
        const hashedToken = crypto.createHash('sha256').update(plainTextToken).digest('hex');

        // Expiration calculation
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 7); // 7 days from now

        // Push to user's allowed list of devices/sessions
        user.refreshTokens = user.refreshTokens || [];
        user.refreshTokens.push({
            tokenHash: hashedToken,
            expiresAt: expiryDate
        });

        await user.save();
        return plainTextToken;
    }

    /**
     * Verify an opaque Refresh Token, rotate it, and detect reuse!
     * 
     * @param {string} userId
     * @param {string} incomingPlainTextToken 
     */
    static async rotateRefreshToken(incomingPlainTextToken, reqIp) {
        if (!incomingPlainTextToken || typeof incomingPlainTextToken !== 'string') {
            throw new Error('Invalid token format');
        }
        const parts = incomingPlainTextToken.split('.');
        if (parts.length !== 2) throw new Error('Invalid token format');
        const userId = parts[0];

        const user = await User.findById(userId);
        if (!user) throw new Error('User not found');

        const incomingHash = crypto.createHash('sha256').update(incomingPlainTextToken).digest('hex');

        // Find if this token exists in user's active sessions
        const tokenIndex = (user.refreshTokens || []).findIndex(rt => rt.tokenHash === incomingHash);

        if (tokenIndex === -1) {
            // Security Alert: Refresh Token Reuse Detection
            // If the token is not found, but it was presented by the client, it could mean:
            // 1. Legitimate concurrent race condition (rare with strict frontends)
            // 2. Token theft. An attacker reused a token the legitimate user already rotated.

            // ACTION: Revoke all sessions for this user.
            logger.warn(`REFRESH TOKEN REUSE DETECTED! Revoking all sessions for user.`, { userId, ip: reqIp });
            user.refreshTokens = [];
            await user.save();
            throw new Error('TOKEN_REUSE_DETECTED');
        }

        const matchedToken = user.refreshTokens[tokenIndex];

        // Check Expiry
        if (matchedToken.expiresAt < new Date()) {
            // Remove expired token
            user.refreshTokens.splice(tokenIndex, 1);
            await user.save();
            throw new Error('REFRESH_TOKEN_EXPIRED');
        }

        // ROTATION: Remove the old token, issue a new one
        user.refreshTokens.splice(tokenIndex, 1);

        const newPlainTextToken = crypto.randomBytes(40).toString('hex');
        const newHashedToken = crypto.createHash('sha256').update(newPlainTextToken).digest('hex');

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 7);

        user.refreshTokens.push({
            tokenHash: newHashedToken,
            expiresAt: expiryDate
        });

        await user.save();

        // Also optionally mint a new Access Token here returning both
        const newAccessToken = this.generateAccessToken(user);

        return { accessToken: newAccessToken, refreshToken: newPlainTextToken };
    }

    /**
     * Verify Access Token standard (For authMiddleware)
     */
    static verifyAccessToken(token) {
        try {
            return jwt.verify(token, config.jwt.secret);
        } catch (error) {
            return null;
        }
    }

    /**
     * Global session revocation. Bumps `tokenVersion`. Core JWT signature remains valid, 
     * but we check `user.tokenVersion` during sensitive DB queries to actively reject.
     */
    static async revokeAllUserTokens(userId) {
        await User.findByIdAndUpdate(userId, {
            $inc: { tokenVersion: 1 }, // Invalidate all extant native access JWTs functionally
            $set: { refreshTokens: [] } // Wipes all long lived active sessions
        });
    }
}

module.exports = TokenUtils;
