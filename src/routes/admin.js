const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const asyncWrapper = require('../middleware/asyncWrapper');
const adminGuard = require('../middleware/adminAuth');
const rateLimit = require('express-rate-limit');

// 300 reqs a day for admin sweeps
const adminLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 300 });

router.use(adminGuard); // Enforces super_admin rules globally on this route
router.use(adminLimiter);

router.get('/applications', asyncWrapper(adminController.listApplications));
router.get('/applications/:id', asyncWrapper(adminController.getApplication));

router.post('/applications/:id/approve', asyncWrapper(adminController.approveApplication));
router.post('/applications/:id/hold', asyncWrapper(adminController.holdApplication));
router.post('/applications/:id/reject', asyncWrapper(adminController.rejectApplication));

router.post('/applications/:id/resend-decision', asyncWrapper(adminController.resendDecisionEmail));
router.post('/applications/:id/notes', asyncWrapper(adminController.addNote));

router.get('/audit-logs', asyncWrapper(adminController.listAuditLogs));

// Dedicated Users Endpoint
router.get('/users', asyncWrapper(adminController.listUsersByCategory));

module.exports = router;