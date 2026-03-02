const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const asyncWrapper = require('../middleware/asyncWrapper');

const { authenticate } = require('../middleware/authMiddleware');
const BruteForceProtector = require('../middleware/bruteForceProtector');
const { validateRequest, commonSchemas } = require('../middleware/requestSanitizer');

// POST /auth/register
router.post('/register', validateRequest(commonSchemas.register), asyncWrapper(authController.register));

// POST /auth/login
router.post('/login', BruteForceProtector.enforce(), validateRequest(commonSchemas.login), asyncWrapper(authController.login));

// POST /auth/refresh
router.post('/refresh', asyncWrapper(authController.refreshToken));

// POST /auth/logout
router.post('/logout', authenticate, asyncWrapper(authController.logout));

// POST /auth/verify-email
router.post('/verify-email', authenticate, asyncWrapper(authController.verifyEmail));

// POST /auth/forgot-password
router.post('/forgot-password', asyncWrapper(authController.forgotPassword));

// POST /auth/reset-password
router.post('/reset-password', asyncWrapper(authController.resetPassword));

module.exports = router;
