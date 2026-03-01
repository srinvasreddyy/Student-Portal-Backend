const express = require('express');
const { body } = require('express-validator');
const registrationController = require('../controllers/registrationController');

const router = express.Router();

// Common validation chains
const companySearchValidation = [
    body('companyNumber').trim().notEmpty().withMessage('Company number is required')
];

const verifyDomainValidation = [
    body('website').trim().notEmpty().isURL().withMessage('Valid website URL is required'),
    body('email').trim().notEmpty().isEmail().withMessage('Valid email is required')
];

// FIXED: Changed `representativeName` to `repName` to match the frontend payload
const companyRegistrationValidation = [
    body('organizationName').trim().notEmpty().withMessage('Organization Name is required'),
    body('country').trim().notEmpty().withMessage('Country is required'),
    body('website').trim().isURL().withMessage('Valid website URL is required'),
    body('officialEmail').trim().isEmail().withMessage('Valid Official Email is required'),
    body('phone').trim().notEmpty().withMessage('Phone is required'),
    body('repName').trim().notEmpty().withMessage('Representative Name is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

// --- COMPANY REGISTRATION ROUTES ---
router.post('/company/search-uk', companySearchValidation, registrationController.searchUkCompany);
router.get('/company/global-list', registrationController.getGlobalCompanies);
router.post('/company/verify-domain', verifyDomainValidation, registrationController.verifyCompanyDomain);
router.post('/company/register', companyRegistrationValidation, registrationController.registerCompany);

// --- UNIVERSITY REGISTRATION ROUTES ---
router.get('/university/search-uk', registrationController.searchUkUniversities);
router.get('/university/global-list', registrationController.getGlobalUniversities);
router.post('/university/verify-domain', verifyDomainValidation, registrationController.verifyUniversityDomain);
router.post('/university/register', companyRegistrationValidation, registrationController.registerUniversity);

module.exports = router;