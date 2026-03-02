const express = require('express');
const router = express.Router();
const companiesController = require('../controllers/companiesController');
const asyncWrapper = require('../middleware/asyncWrapper');
const fileUpload = require('../middleware/fileUpload');


// POST /companies/apply
router.post('/apply', asyncWrapper(companiesController.applyCompany));

// POST /companies/:id/verify-email
router.post('/:id/verify-email', asyncWrapper(companiesController.verifyEmail));
router.get('/:id/verify-email', asyncWrapper(companiesController.verifyEmail)); // Support for GET link click

// GET /companies/:id/status
router.get('/:id/status', asyncWrapper(companiesController.getCompanyStatus));

// POST /companies/:id/upload-doc
router.post('/:id/upload-doc', fileUpload, asyncWrapper(companiesController.uploadDocument));

// POST /admin/companies/:id/mark (SuperAdmin only in real app, mock auth here)
router.post('/admin/:id/mark', asyncWrapper(companiesController.markCompany));

module.exports = router;
