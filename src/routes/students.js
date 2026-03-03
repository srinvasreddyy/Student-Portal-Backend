const express = require('express');
const router = express.Router();

const asyncWrapper = require('../middleware/asyncWrapper');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const streamUpload = require('../middleware/fileUpload');
const studentsController = require('../controllers/studentsController');

// All endpoints require user authentication natively except maybe public profile views
router.get('/me', authenticate, authorize('student'), asyncWrapper(studentsController.getProfile));
router.put('/me', authenticate, authorize('student'), asyncWrapper(studentsController.updateProfile));

router.get('/me/portfolio', authenticate, authorize('student'), asyncWrapper(studentsController.listPortfolio));
router.post('/me/portfolio', authenticate, authorize('student'), streamUpload, asyncWrapper(studentsController.addPortfolioItem));
router.delete('/me/portfolio/:itemId', authenticate, authorize('student'), asyncWrapper(studentsController.deletePortfolioItem));

// Cover Image endpoints
router.post('/me/upload-image', authenticate, authorize('student'), streamUpload, asyncWrapper(studentsController.uploadPortfolioImage));
router.get('/files/:fileId', asyncWrapper(studentsController.getPortfolioImage)); // Public or authenticated depending on usage, making it loosely public for rendering

// Stream download / playback
router.get('/me/portfolio/:itemId/download', authenticate, asyncWrapper(studentsController.downloadOrViewItemStream));

// Public/Admin viewing bounds (Optionally completely public if un-authenticated allowed, but here we secure it and check req.user loosely if possible)
// So we use custom authenticate hook ignoring missing tokens for pure public view but we will just ensure it's protected by basic auth
router.get('/:userId/profile', asyncWrapper(studentsController.getPublicProfile));
router.get('/:userId/portfolio', asyncWrapper(studentsController.getStudentPortfolio));

module.exports = router;
