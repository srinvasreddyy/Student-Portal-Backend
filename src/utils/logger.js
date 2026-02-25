const winston = require('winston');
const securityConfig = require('../config/security');

// Fallback to empty array if config is missing during test runs
const PII_FIELDS = securityConfig?.logging?.piiFields || ['password', 'passwordHash', 'token', 'refreshToken', 'email'];

/**
 * Custom Winston Format to traverse the log object and mask predefined PII fields.
 */
const maskPII = winston.format((info) => {
    const traverseAndMask = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;

        for (const key of Object.keys(obj)) {
            if (PII_FIELDS.includes(key) && typeof obj[key] === 'string') {
                // Mask logic: mask all but first 2 chars and last 2 chars (if long enough)
                const val = obj[key];
                if (val.length > 6) {
                    obj[key] = `${val.substring(0, 2)}***${val.substring(val.length - 2)}`;
                } else {
                    obj[key] = '***MASKED***';
                }
            } else if (typeof obj[key] === 'object') {
                traverseAndMask(obj[key]);
            }
        }
        return obj;
    };

    // Instead of deep cloning the whole info object (which drops Symbols),
    // we should iterate and deep clone/mask only standard properties.
    const maskedInfo = Object.assign({}, info);

    // Copy Symbols over because Winston needs them
    const symbols = Object.getOwnPropertySymbols(info);
    for (const sym of symbols) {
        maskedInfo[sym] = info[sym];
    }

    // Now mask the normal properties
    traverseAndMask(maskedInfo);
    return maskedInfo;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        maskPII(), // Apply PII masking
        winston.format.json() // Output strictly as structured JSON for Datadog, ELK, etc.
    ),
    defaultMeta: { service: 'backend-api' },
    transports: [
        new winston.transports.Console({
            // In dev, you might prefer simple text, but JSON is safer even there
            format: process.env.NODE_ENV === 'development'
                ? winston.format.combine(winston.format.colorize(), winston.format.simple())
                : undefined
        })
    ]
});

// Capture unhandled rejections/exceptions globally utilizing the logger
if (process.env.NODE_ENV === 'production') {
    winston.exceptions.handle(
        new winston.transports.Console()
    );
    winston.rejections.handle(
        new winston.transports.Console()
    );
}

module.exports = logger;
