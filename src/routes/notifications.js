const express = require('express');
const router = express.Router();
const notifController = require('../controllers/notificationsController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// Mount router under application (e.g. /api)
// Example: app.use('/api', notificationsRoutes); inside app.js

// Public (Authenticated) endpoints
router.get('/notifications', authenticate, notifController.getNotifications);
router.post('/notifications/mark-read', authenticate, notifController.markAsRead);

// Internal/Admin API endpoints for testing or broadcasting (uses super_admin role checking in controller)
router.post('/notifications', authenticate, notifController.createNotification);

// Super-admin only monitoring views
router.get('/admin/email-sends', authenticate, authorize('super_admin'), notifController.getEmailSends);
router.post('/admin/email-sends/:id/resend', authenticate, authorize('super_admin'), notifController.resendEmail);

module.exports = router;
