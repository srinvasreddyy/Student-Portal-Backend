const express = require('express');
const router = express.Router();
const projectsController = require('../controllers/projectsController');
const asyncWrapper = require('../middleware/asyncWrapper');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const validateProjectPayload = require('../middleware/validateProjectPayload');
const streamUpload = require('../middleware/fileUpload');

// File Upload / Download Routes
router.post('/upload', authenticate, authorize('company_admin', 'university_admin'), streamUpload, asyncWrapper(projectsController.uploadDocument));
router.get('/document/:fileId', authenticate, asyncWrapper(projectsController.downloadDocument));

// Public / Authenticated Student endpoints
router.get('/', authenticate, asyncWrapper(projectsController.listProjects));
router.get('/me', authenticate, asyncWrapper(projectsController.getMyProjects));
router.get('/:id', authenticate, asyncWrapper(projectsController.getProject));

router.post('/:id/apply', authenticate, authorize('student'), asyncWrapper(projectsController.applyToProject));
router.post('/:id/withdraw', authenticate, authorize('student'), asyncWrapper(projectsController.withdrawApplication));

// Owner (Company/University) endpoints
router.post('/', authenticate, authorize('company_admin', 'university_admin'), validateProjectPayload, asyncWrapper(projectsController.createProject));

// NEW: Endpoint to update media without triggering strict text payload validation
router.patch('/:id/media', authenticate, authorize('company_admin', 'university_admin'), asyncWrapper(projectsController.updateProjectMedia));

router.post('/:id/accept', authenticate, authorize('company_admin', 'university_admin'), asyncWrapper(projectsController.acceptStudent));
router.post('/:id/remove', authenticate, authorize('company_admin', 'university_admin'), asyncWrapper(projectsController.removeStudent));
router.post('/:id/reject', authenticate, authorize('company_admin', 'university_admin'), asyncWrapper(projectsController.rejectApplicant));
router.post('/:id/complete', authenticate, authorize('company_admin', 'university_admin'), asyncWrapper(projectsController.completeProject));
router.delete('/:id', authenticate, authorize('company_admin', 'university_admin'), asyncWrapper(projectsController.cancelProject));

// Admin ops
router.get('/admin/all', authenticate, authorize('super_admin'), asyncWrapper(projectsController.adminListProjects));
router.delete('/admin/:id', authenticate, authorize('super_admin'), asyncWrapper(projectsController.adminDeleteProject));

module.exports = router;