const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const asyncWrapper = require('../middleware/asyncWrapper');
const adminGuard = require('../middleware/adminAuth');


router.use(adminGuard); // Enforces super_admin rules globally on this route

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

// Student account management
router.patch('/students/:id/status', asyncWrapper(adminController.updateStudentStatus));

module.exports = router;