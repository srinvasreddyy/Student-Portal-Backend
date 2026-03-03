const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const asyncWrapper = require('../middleware/asyncWrapper');
const adminGuard = require('../middleware/adminAuth');

const authMiddleware = require('../middleware/authMiddleware');

// The `adminGuard` enforces `super_admin` only.
// For recruiters (admin), we explicitly define `authMiddleware.authorize('admin', 'super_admin')`


router.get('/applications', adminGuard, asyncWrapper(adminController.listApplications));
router.get('/applications/:id', adminGuard, asyncWrapper(adminController.getApplication));

router.post('/applications/:id/approve', adminGuard, asyncWrapper(adminController.approveApplication));
router.post('/applications/:id/hold', adminGuard, asyncWrapper(adminController.holdApplication));
router.post('/applications/:id/reject', adminGuard, asyncWrapper(adminController.rejectApplication));

router.post('/applications/:id/resend-decision', adminGuard, asyncWrapper(adminController.resendDecisionEmail));
router.post('/applications/:id/notes', adminGuard, asyncWrapper(adminController.addNote));

router.get('/audit-logs', adminGuard, asyncWrapper(adminController.listAuditLogs));

// Dedicated Users Endpoint
router.get('/users', adminGuard, asyncWrapper(adminController.listUsersByCategory));

// Student account management
router.patch('/students/:id/status', adminGuard, asyncWrapper(adminController.updateStudentStatus));

// Talent Discovery (Accessible by 'company_admin', 'university_admin', and 'super_admin')
const talentSearchGuard = [authMiddleware.authenticate, authMiddleware.authorize('company_admin', 'super_admin', 'university_admin')];

router.get('/portfolios/search', talentSearchGuard, asyncWrapper(adminController.searchPortfolios));
router.get('/students/search', talentSearchGuard, asyncWrapper(adminController.searchStudents));
router.post('/recruitment/send-email', talentSearchGuard, asyncWrapper(adminController.sendRecruitmentEmail));

module.exports = router;