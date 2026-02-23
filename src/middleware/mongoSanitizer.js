/**
 * Consulted Docs:
 * Mongoose Security (NoSQL Injection API): https://mongoosejs.com/docs/security.html
 * express-mongo-sanitize: https://github.com/fiznool/express-mongo-sanitize
 * OWASP Injection Prevention Checklists: https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html
 */

const mongoSanitize = require('express-mongo-sanitize');

/**
 * Middleware wrapper. 
 * Strips any keys in req.body, req.query, or req.params that begin with `$` or contain `.`
 * This prevents operators like `$gt`, `$ne`, or `$where` from being mass-injected into queries unescaped.
 */
const mongoInjectionSanitizer = () => {
    // We replace forbidden characters with a safe placeholder instead of just removing the key silently 
    // to preserve structure but neuter the operator payload.
    return mongoSanitize({
        replaceWith: '_',
        onSanitize: ({ req, key }) => {
            console.warn(`[NoSQL Injection Alert] Sanitized key starting with $ or . in payload. Path: ${req.originalUrl}, Key: ${key}`);
        }
    });
};

module.exports = mongoInjectionSanitizer;
