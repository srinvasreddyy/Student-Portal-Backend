/**
 * Consulted Docs:
 * Helmet: https://helmetjs.github.io/
 * Express Security Best Practices: https://expressjs.com/en/advanced/best-practice-security.html
 * OWASP Secure Headers Project: https://owasp.org/www-project-secure-headers/
 */

const helmet = require('helmet');

/**
 * Provides comprehensive security header configuration.
 * 
 * - CSP (Content-Security-Policy): Mitigates XSS and data injection attacks by restricting 
 *   locations from which scripts, styles, and other resources can be loaded.
 * - HSTS (Strict-Transport-Security): Enforces HTTPS in production to prevent MIME downgrade/MitM.
 * - X-Frame-Options (frameguard): Prevents Clickjacking by disallowing iframe embedding.
 * - X-Content-Type-Options: Prevents MIME sniffing.
 * - Referrer-Policy: Controls how much referrer information is included with requests.
 * - Removes X-Powered-By: Obscures application stack details (Express framework signature).
 */
const securityHeaders = (isProduction = process.env.NODE_ENV === 'production') => {
    return helmet({
        // Content Security Policy
        // Restricts resource loading to 'self' primarily.
        // In production, inline scripts are completely blocked.
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", isProduction ? "" : "'unsafe-inline'"], // Allow quick dev tools
                styleSrc: ["'self'", "'unsafe-inline'"], // React/Frontend often injects styles inline
                imgSrc: ["'self'", 'data:', 'https:'],
                connectSrc: ["'self'"],
                fontSrc: ["'self'", 'https:', 'data:'],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameAncestors: ["'none'"], // Supercedes X-Frame-Options where CSP is supported
            }
        },
        // HTTP Strict Transport Security (HSTS)
        hsts: isProduction ? {
            maxAge: 31536000, // 1 year in seconds
            includeSubDomains: true,
            preload: true
        } : false, // Disabled in dev so localhost HTTP works fine
        // X-Frame-Options
        frameguard: {
            action: 'deny'
        },
        // Referrer-Policy
        referrerPolicy: {
            policy: 'strict-origin-when-cross-origin'
        },
        // Disables the `X-Powered-By` header (Express)
        hidePoweredBy: true,
        // Prevents Internet Explorer from executing downloads in site's context
        ieNoOpen: true,
        // X-Content-Type-Options
        noSniff: true,
        // X-Permitted-Cross-Domain-Policies
        permittedCrossDomainPolicies: {
            permittedPolicies: 'none'
        },
        // Cross-Origin policies
        crossOriginEmbedderPolicy: false, // Too aggressive for many SPAs, leaving config open
        crossOriginOpenerPolicy: { policy: 'same-origin' },
        crossOriginResourcePolicy: { policy: 'same-origin' }
    });
};

module.exports = securityHeaders;
