// Maps storing hit counts + timestamps for global limits and user limits
const emailHistory = new Map();
const userEmailHistory = new Map();

// Limits configuration. Can be env vars later
const GLOBAL_LIMIT = process.env.GLOBAL_EMAIL_RATE_LIMIT || 1000; // max emails per hour system-wide
const USER_LIMIT = process.env.USER_EMAIL_RATE_LIMIT || 10;      // max emails per user per hour
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Very basic sliding window rate limiter for email emissions. 
 * Prevents malicious scripts trying to send thousands of reset-password links via public endpoints.
 * Should be attached to high-risk routes that trigger emails (e.g., POST /auth/forgot-password).
 * Note: `createNotification` for internal API doesn't use this, but public flows should.
 */
const emailRateLimiter = (req, res, next) => {
    // 1. Bypass check if authorized admin/super_admin is doing an internal command
    if (req.user && req.user.role === 'super_admin') {
        return next();
    }

    const now = Date.now();
    const userId = req.user ? req.user.id : req.ip; // Fallback to IP for unauth routes like register/forgot-passwd

    // --- Global check ---
    if (!emailHistory.has('global')) emailHistory.set('global', []);
    const gHist = emailHistory.get('global');
    while (gHist.length > 0 && gHist[0] <= now - WINDOW_MS) gHist.shift();

    if (gHist.length >= GLOBAL_LIMIT) {
        console.warn(`[RateLimit] Global email sending limits reached!`);
        return res.status(429).json({ success: false, message: 'Email service max capacity reached. Try again later.', code: 'email_rate_limited_global' });
    }

    // --- User check ---
    if (!userEmailHistory.has(userId)) userEmailHistory.set(userId, []);
    const uHist = userEmailHistory.get(userId);
    while (uHist.length > 0 && uHist[0] <= now - WINDOW_MS) uHist.shift();

    if (uHist.length >= USER_LIMIT) {
        console.warn(`[RateLimit] User/IP ${userId} hit email rate limit.`);
        return res.status(429).json({ success: false, message: 'You have requested too many emails recently. Try again later.', code: 'email_rate_limited' });
    }

    // --- Record intent to send (we record synchronously assuming route succeeds) ---
    gHist.push(now);
    uHist.push(now);

    next();
};

module.exports = { emailRateLimiter };
