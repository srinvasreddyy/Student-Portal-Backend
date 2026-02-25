// In-memory store for rate limiting (can be swapped for Redis if needed later)
const messageCounts = new Map();

// Configuration
const MAX_MESSAGES = 5; // Max messages allowed in the time window
const WINDOW_MS = 1000;  // 1 second window

/**
 * Basic in-memory rate limiter per socket.
 * Prevents a single connection from flooding the chat.
 */
const socketRateLimiter = (socket, next) => {
    socket.onAny((event, ...args) => {
        if (event !== 'message:send') return; // Only rate limit message sends 

        const now = Date.now();
        const sid = socket.id;

        if (!messageCounts.has(sid)) {
            messageCounts.set(sid, []);
        }

        const timestamps = messageCounts.get(sid);

        // Remove timestamps older than the window
        while (timestamps.length > 0 && timestamps[0] <= now - WINDOW_MS) {
            timestamps.shift();
        }

        if (timestamps.length >= MAX_MESSAGES) {
            // Drop message by not emitting or by sending error ack
            socket.emit('error', { message: 'Rate limit exceeded. Try again later.' });
            // By returning from here, we prevent the usual handler from executing, 
            // but this requires integration depending on how handlers are attached.
            // Using socket middleware for rate-limiting events in Socket.io usually
            // involves checking before processing the specific event.
            // For simplicity, we just attach a flag or throw an error.
            return;
        }

        timestamps.push(now);
    });

    // Clean up on disconnect
    socket.on('disconnect', () => {
        messageCounts.delete(socket.id);
    });

    next();
};

/**
 * Alternate approach using a helper function to wrap event handlers directly.
 * This is more robust for checking limits per event.
 */
const withRateLimit = (handler, socket) => {
    return (payload, ack) => {
        const now = Date.now();
        if (!socket) {
            // Failsafe if socket is somehow undefined (e.g. in certain test setups)
            return handler(payload, ack);
        }
        const key = socket.id; // Could also use socket.user.id for user-level limiting across tabs

        if (!messageCounts.has(key)) {
            messageCounts.set(key, []);
        }

        const timestamps = messageCounts.get(key);

        while (timestamps.length > 0 && timestamps[0] <= now - WINDOW_MS) {
            timestamps.shift();
        }

        if (timestamps.length >= MAX_MESSAGES) {
            if (typeof ack === 'function') {
                ack({ success: false, error: 'Rate limit exceeded' });
            } else {
                socket.emit('error', { type: 'rate_limit', message: 'You are sending messages too fast.' });
            }
            return;
        }

        timestamps.push(now);
        handler(payload, ack);
    };
};

module.exports = { socketRateLimiter, withRateLimit };
