const express = require('express');
const router = express.Router();
const universitiesController = require('../controllers/universitiesController');
const asyncWrapper = require('../middleware/asyncWrapper');
const fileUpload = require('../middleware/fileUpload');


// GET /universities/search?q=Harvard&country=US
router.get('/search', asyncWrapper(universitiesController.search));

// POST /universities/apply
router.post('/apply', asyncWrapper(universitiesController.applyUniversity));

// POST /universities/:id/verify-email
router.post('/:id/verify-email', asyncWrapper(universitiesController.verifyEmail));

// GET /universities/:id/status
router.get('/:id/status', asyncWrapper(universitiesController.getStatus));

// POST /universities/:id/upload-doc
router.post('/:id/upload-doc', fileUpload, asyncWrapper(universitiesController.uploadDocument));

module.exports = router;
