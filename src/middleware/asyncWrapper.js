/**
 * Helper to wrap async route handlers
 * passes any errors to the express error handler via next()
 */
const asyncWrapper = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncWrapper;
