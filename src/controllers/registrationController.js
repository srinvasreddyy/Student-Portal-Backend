const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Company = require('../models/Company');
const UniversityAdmin = require('../models/UniversityAdmin');
const University = require('../models/University');
const { lookupCompaniesHouse, lookupOpenCorporates } = require('../services/companyLookupService');
const { getUniversitiesByCountry, getGlobalUniversities } = require('../services/universityLookupService');
const { verifyDomainAndEmail, getBaseDomain } = require('../middleware/domainVerifier');
const mailer = require('../services/mailer'); // IMPORTED MAILER
const logger = require('../utils/logger');

// Generate numeric code helper
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Generic error response formatter
const sendError = (res, statusCode, message, errorCode) => {
    return res.status(statusCode).json({
        success: false,
        message,
        errorCode
    });
};

const sendSuccess = (res, data = {}) => {
    return res.status(200).json({
        success: true,
        data
    });
};

// ==========================================
// COMPANY REGISTRATION
// ==========================================

exports.searchUkCompany = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return sendError(res, 400, 'Validation failed', 'VALIDATION_ERROR');
    }

    try {
        const { companyNumber } = req.body;
        const chData = await lookupCompaniesHouse(companyNumber);

        return sendSuccess(res, {
            companyName: chData.company_name,
            status: chData.company_status,
            address: chData.registered_office_address ? Object.values(chData.registered_office_address).join(', ') : '',
            incorporationDate: chData.date_of_creation
        });

    } catch (error) {
        logger.error(`UK Company Search Error: ${error.message}`);
        if (error.response && error.response.status === 404) {
            return sendError(res, 404, 'Company not found', 'COMPANY_NOT_FOUND');
        }
        return sendError(res, 500, 'Company lookup failed. Please try again later.', 'API_ERROR');
    }
};

exports.getGlobalCompanies = async (req, res) => {
    try {
        const query = req.query.q || '';
        if (query.length < 2) {
            return sendSuccess(res, []);
        }

        const data = await lookupOpenCorporates(query, 'us');

        let companyList = [];
        if (data && Array.isArray(data)) {
            companyList = data.map(item => ({
                companyName: item.company.name,
                companyNumber: item.company.company_number
            }));
        }

        return sendSuccess(res, companyList);

    } catch (error) {
        logger.error(`Global Company Search Error: ${error.message}`);
        return sendError(res, 500, 'Global company lookup failed.', 'API_ERROR');
    }
};

exports.verifyCompanyDomain = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return sendError(res, 400, errors.array()[0].msg, 'VALIDATION_ERROR');
    }

    try {
        const { website, email } = req.body;
        const result = await verifyDomainAndEmail(website, email);

        if (!result.success) {
            return sendError(res, 400, result.message, result.errorCode);
        }

        return sendSuccess(res, { 
            verified: result.data ? result.data.verified : false,
            needsDomainManualVerification: result.needsDomainManualVerification || false,
            requiresManualVerification: true,
            message: result.message || 'Verification complete'
        });
    } catch (error) {
        logger.error(`Domain verification error: ${error.message}`);
        return sendError(res, 500, 'Failed to verify domain', 'SERVER_ERROR');
    }
};

exports.registerCompany = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return sendError(res, 400, errors.array()[0].msg, 'VALIDATION_ERROR');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    let generatedVerifyCode = null; // Store for mailer after transaction success

    try {
        const { organizationName, country, website, officialEmail, phone, repName, representativeName, password, numberOfEmployees, industry, fullAddress } = req.body;
        const finalRepName = repName || representativeName;

        // 1. Re-verify Domain (Never trust frontend)
        const verifyResult = await verifyDomainAndEmail(website, officialEmail);
        if (!verifyResult.success) {
            await session.abortTransaction();
            return sendError(res, 400, verifyResult.message, verifyResult.errorCode);
        }

        const needsDomainManualVerification = verifyResult.needsDomainManualVerification || false;

        // 2. Check for exact duplicates
        const normalizedEmail = officialEmail.toLowerCase().trim();
        const existingEmail = await User.findOne({ email: normalizedEmail }).session(session);
        if (existingEmail) {
            await session.abortTransaction();
            return sendError(res, 409, 'Email is already registered.', 'DUPLICATE_EMAIL');
        }

        const existingOrg = await Company.findOne({ officialName: organizationName, country }).session(session);
        if (existingOrg) {
            await session.abortTransaction();
            return sendError(res, 409, 'This organization is already registered in this country.', 'DUPLICATE_ORGANIZATION');
        }

        // 3. Generate OTP and Hash it
        generatedVerifyCode = generateCode();
        const emailVerifyHash = await bcrypt.hash(generatedVerifyCode, 10);

        // 4. Create the User (Company Admin)
        const newUser = new User({
            email: normalizedEmail,
            passwordHash: password, // Pre-save hook will hash it
            role: 'company_admin',
            status: 'pending',
            profile: { representativeName: finalRepName, phone },
            emailVerifyHash // Store the hash so auth verification works
        });

        // 5. Create the Company Entity
        const websiteDomain = getBaseDomain(website);
        const newCompany = new Company({
            officialName: organizationName,
            country,
            website,
            domains: websiteDomain ? [websiteDomain] : [],
            companyEmail: normalizedEmail,
            numberOfEmployees,
            industry,
            fullAddress,
            representative: {
                user: newUser._id,
                name: finalRepName
            },
            status: 'pending',
            verification: {
                emailVerified: !needsDomainManualVerification, 
                requiresManualVerification: true, 
                needsDomainManualVerification: needsDomainManualVerification 
            }
        });

        await newUser.save({ session });
        await newCompany.save({ session });
        await session.commitTransaction();

        // 6. Send OTP Email safely after transaction commits
        try {
            await mailer.sendEmail(
                newUser.email,
                'Verify your Company Portal Email',
                `<div style="font-family: sans-serif; text-align: center;">
                    <h2>Company Verification</h2>
                    <p>Your email verification code is:</p>
                    <h1 style="letter-spacing: 4px; color: #4F46E5;">${generatedVerifyCode}</h1>
                </div>`
            );
        } catch (e) {
            logger.error(`Registration OTP email failed to send: ${e.message}`);
        }

        return sendSuccess(res, { adminId: newUser._id, organizationName: newCompany.officialName });

    } catch (error) {
        await session.abortTransaction();
        logger.error(`Company Registration Error: ${error.message}`);
        if (error.message.includes('Public email domains') || error.message.includes('does not match')) {
            return sendError(res, 400, error.message, 'DOMAIN_CHECK_FAILED');
        }
        return sendError(res, 500, 'Registration failed securely. Please try again.', 'SERVER_ERROR');
    } finally {
        session.endSession();
    }
};

// ==========================================
// UNIVERSITY REGISTRATION
// ==========================================

exports.searchUkUniversities = async (req, res) => {
    try {
        const list = await getUniversitiesByCountry('United Kingdom');
        return sendSuccess(res, list);
    } catch (error) {
        logger.error(`UK University Search Error: ${error.message}`);
        return sendError(res, 500, 'Failed to fetch UK universities', 'API_ERROR');
    }
};

exports.getGlobalUniversities = async (req, res) => {
    try {
        const query = req.query.q || '';
        const list = await getGlobalUniversities(query);
        return sendSuccess(res, list);
    } catch (error) {
        logger.error(`Global University Search Error: ${error.message}`);
        return sendError(res, 500, 'Failed to fetch global universities', 'API_ERROR');
    }
};

exports.verifyUniversityDomain = exports.verifyCompanyDomain; 

exports.registerUniversity = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return sendError(res, 400, errors.array()[0].msg, 'VALIDATION_ERROR');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    let generatedVerifyCode = null;

    try {
        const { organizationName, country, website, officialEmail, phone, repName, representativeName, repRole, repDob, repLocation, password } = req.body;
        const finalRepName = repName || representativeName;

        // 1. Re-verify Domain
        const verifyResult = await verifyDomainAndEmail(website, officialEmail);
        if (!verifyResult.success) {
            await session.abortTransaction();
            return sendError(res, 400, verifyResult.message, verifyResult.errorCode);
        }

        const needsDomainManualVerification = verifyResult.needsDomainManualVerification || false;
        const normalizedEmail = officialEmail.toLowerCase().trim();

        // 2. Check for duplicates
        const existingEmail = await User.findOne({ email: normalizedEmail }).session(session);
        if (existingEmail) {
            await session.abortTransaction();
            return sendError(res, 409, 'Email is already registered.', 'DUPLICATE_EMAIL');
        }

        const existingOrg = await University.findOne({ name: organizationName, country }).session(session);
        if (existingOrg) {
            await session.abortTransaction();
            return sendError(res, 409, 'This university is already registered in this country.', 'DUPLICATE_ORGANIZATION');
        }

        // 3. Generate OTP and Hash it
        generatedVerifyCode = generateCode();
        const emailVerifyHash = await bcrypt.hash(generatedVerifyCode, 10);

        // 4. Create the User (University Admin)
        const newUser = new User({
            email: normalizedEmail,
            passwordHash: password, 
            role: 'university_admin',
            status: 'pending',
            profile: { representativeName: finalRepName, phone },
            emailVerifyHash // Store the hash so auth verification works
        });

        // 5. Create the University Entity
        const websiteDomain = getBaseDomain(website);
        const newUni = new University({
            name: organizationName,
            country,
            website,
            domains: websiteDomain ? [websiteDomain] : [],
            representative: {
                user: newUser._id,
                name: finalRepName,
                role: repRole,
                dob: repDob,
                location: repLocation,
                email: normalizedEmail 
            },
            status: 'pending',
            verification: {
                emailVerified: !needsDomainManualVerification, 
                requiresManualVerification: true, 
                needsDomainManualVerification: needsDomainManualVerification 
            }
        });

        await newUser.save({ session });
        await newUni.save({ session });
        await session.commitTransaction();

        // 6. Send OTP Email safely after transaction commits
        try {
            await mailer.sendEmail(
                newUser.email,
                'Verify your University Portal Email',
                `<div style="font-family: sans-serif; text-align: center;">
                    <h2>University Verification</h2>
                    <p>Your email verification code is:</p>
                    <h1 style="letter-spacing: 4px; color: #4F46E5;">${generatedVerifyCode}</h1>
                </div>`
            );
        } catch (e) {
            logger.error(`Registration OTP email failed to send: ${e.message}`);
        }

        return sendSuccess(res, { adminId: newUser._id, organizationName: newUni.name });

    } catch (error) {
        await session.abortTransaction();
        logger.error(`University Registration Error: ${error.message}`);
        if (error.message.includes('Public email domains') || error.message.includes('does not match')) {
            return sendError(res, 400, error.message, 'DOMAIN_CHECK_FAILED');
        }
        return sendError(res, 500, 'Registration failed securely. Please try again.', 'SERVER_ERROR');
    } finally {
        session.endSession();
    }
};