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

const companyRegistrationValidation = [
    body('organizationName').trim().notEmpty(),
    body('country').trim().notEmpty(),
    body('website').trim().isURL(),
    body('officialEmail').trim().isEmail(),
    body('phone').trim().notEmpty(),
    body('representativeName').trim().notEmpty(),
    body('password').isLength({ min: 6 })
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
