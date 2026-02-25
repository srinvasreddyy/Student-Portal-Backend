/**
 * Consulted Docs:
 * Zod Documentation: https://zod.dev/
 * OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
 */

const { z } = require('zod');
const logger = require('../utils/logger');

/**
 * Validates req.body, req.query, or req.params against a Zod schema.
 * Prevents mass assignment by stripping unvalidated fields (Zod `strip` by default).
 * Automatically sanitizes inputs based on schema coercions.
 */
const validateRequest = (schema) => async (req, res, next) => {
    try {
        if (schema.body) {
            req.body = await schema.body.parseAsync(req.body);
        }
        if (schema.query) {
            req.query = await schema.query.parseAsync(req.query);
        }
        if (schema.params) {
            req.params = await schema.params.parseAsync(req.params);
        }
        next();
    } catch (error) {
        if (error instanceof z.ZodError) {
            logger.warn('Request payload failed Zod validation', {
                endpoint: req.originalUrl,
                ip: req.ip,
                errors: error.errors
            });
            return res.status(400).json({
                success: false,
                error: 'VALIDATION_ERROR',
                details: (error.issues || error.errors || []).map(e => ({ path: e.path.join('.'), message: e.message }))
            });
        }
        next(error);
    }
};

/**
 * Reusable common schemas for the application
 */
const commonSchemas = {
    // Standard auth login shape
    login: {
        body: z.object({
            email: z.string().email('Invalid email format').trim().toLowerCase(),
            password: z.string().min(8, 'Password must be at least 8 characters')
        }).strict()
    },

    // Registration (base)
    register: {
        body: z.object({
            email: z.string().email().trim().toLowerCase(),
            password: z.string().min(8).regex(/[A-Z]/, 'Must contain at least one uppercase letter').regex(/[0-9]/, 'Must contain at least one number'),
            role: z.enum(['student', 'company_admin', 'university_admin']).optional()
        }).strict()
    }
};

module.exports = {
    validateRequest,
    commonSchemas
};
