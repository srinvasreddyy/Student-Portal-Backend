const express = require('express');
const router = express.Router();
const universitiesController = require('../controllers/universitiesController');
const asyncWrapper = require('../middleware/asyncWrapper');
const fileUpload = require('../middleware/fileUpload');
const rateLimit = require('express-rate-limit');

// Protect external searches
const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
// Protect applies
const applyLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });

// GET /universities/search?q=Harvard&country=US
router.get('/search', searchLimiter, asyncWrapper(universitiesController.search));

// POST /universities/apply
router.post('/apply', applyLimiter, asyncWrapper(universitiesController.applyUniversity));

// POST /universities/:id/verify-email
router.post('/:id/verify-email', asyncWrapper(universitiesController.verifyEmail));

// GET /universities/:id/status
router.get('/:id/status', asyncWrapper(universitiesController.getStatus));

// POST /universities/:id/upload-doc
router.post('/:id/upload-doc', fileUpload, asyncWrapper(universitiesController.uploadDocument));

module.exports = router;
