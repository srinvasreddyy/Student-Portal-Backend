const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const CompanyAdmin = require('../models/CompanyAdmin');
const UniversityAdmin = require('../models/UniversityAdmin');
const { lookupCompaniesHouse, lookupOpenCorporates } = require('../services/companyLookupService');
// We need a university lookup service, which we will stub/implement using HipoLabs as per requirements
const { getUniversitiesByCountry, getGlobalUniversities } = require('../services/universityLookupService');
const { verifyDomainAndEmail, getBaseDomain } = require('../middleware/domainVerifier');
const logger = require('../utils/logger');

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

        // Match exact response structure requirement
        return sendSuccess(res, {
            companyName: chData.company_name,
            status: chData.company_status,
            address: chData.registered_office_address ? Object.values(chData.registered_office_address).join(', ') : '',
            incorporationDate: chData.date_of_creation
        });

    } catch (error) {
        logger.error(`UK Company Search Error: ${error.message}`);
        // Handle 404 (Not Found) distinctly from API failures
        if (error.response && error.response.status === 404) {
            return sendError(res, 404, 'Company not found', 'COMPANY_NOT_FOUND');
        }
        return sendError(res, 500, 'Company lookup failed. Please try again later.', 'API_ERROR');
    }
};

exports.getGlobalCompanies = async (req, res) => {
    try {
        // OpenCorporates API requires a search query usually. If we want a generic list, we might need a general query or a cached list.
        // Assuming the frontend will pass a 'q' query parameter to search as user types for the dropdown list
        const query = req.query.q || '';
        if (query.length < 2) {
            return sendSuccess(res, []);
        }

        const data = await lookupOpenCorporates(query, 'us'); // Fallback jurisdiction mapping can be enhanced

        // We ensure we only send a structured list back
        let companyList = [];
        if (data && Array.isArray(data)) {
            companyList = data.map(item => ({
                companyName: item.company.name,
                companyNumber: item.company.company_number
            }));
        } else if (data && data.name) {
            companyList = [{
                companyName: data.name,
                companyNumber: data.company_number
            }];
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

        return sendSuccess(res, { verified: true });
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

    try {
        const { organizationName, country, website, officialEmail, phone, representativeName, password } = req.body;

        // 1. Re-verify Domain (Never trust frontend)
        const verifyResult = await verifyDomainAndEmail(website, officialEmail);
        if (!verifyResult.success) {
            throw new Error(verifyResult.message);
        }

        // 2. Check for exact duplicates
        const normalizedEmail = officialEmail.toLowerCase().trim();
        const existingEmail = await CompanyAdmin.findOne({ officialEmail: normalizedEmail }).session(session);
        if (existingEmail) {
            await session.abortTransaction();
            return sendError(res, 409, 'Email is already registered.', 'DUPLICATE_EMAIL');
        }

        const existingOrg = await CompanyAdmin.findOne({ organizationName, country }).session(session);
        if (existingOrg) {
            await session.abortTransaction();
            return sendError(res, 409, 'This organization is already registered in this country.', 'DUPLICATE_ORGANIZATION');
        }

        // 3. Hash pass and Create
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newCompany = new CompanyAdmin({
            organizationName,
            country,
            website,
            officialEmail: normalizedEmail,
            phone,
            representativeName,
            password: hashedPassword,
            isVerified: true, // We trust our internal domain match
            verificationMethod: 'internal_domain_match',
            role: 'company'
        });

        await newCompany.save({ session });
        await session.commitTransaction();

        return sendSuccess(res, { adminId: newCompany._id, organizationName: newCompany.organizationName });

    } catch (error) {
        await session.abortTransaction();
        logger.error(`Company Registration Error: ${error.message}`);
        // Send safe errors, prevent NoSQL injection trace leaks
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
        // HipoLabs API lets us query by name
        const query = req.query.q || '';
        const list = await getGlobalUniversities(query);
        return sendSuccess(res, list);
    } catch (error) {
        logger.error(`Global University Search Error: ${error.message}`);
        return sendError(res, 500, 'Failed to fetch global universities', 'API_ERROR');
    }
};

exports.verifyUniversityDomain = exports.verifyCompanyDomain; // Same logic exactly

exports.registerUniversity = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return sendError(res, 400, errors.array()[0].msg, 'VALIDATION_ERROR');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { organizationName, country, website, officialEmail, phone, representativeName, password } = req.body;

        // 1. Re-verify Domain
        const verifyResult = await verifyDomainAndEmail(website, officialEmail);
        if (!verifyResult.success) {
            throw new Error(verifyResult.message);
        }

        // 2. Check for duplicates
        const normalizedEmail = officialEmail.toLowerCase().trim();
        const existingEmail = await UniversityAdmin.findOne({ officialEmail: normalizedEmail }).session(session);
        if (existingEmail) {
            await session.abortTransaction();
            return sendError(res, 409, 'Email is already registered.', 'DUPLICATE_EMAIL');
        }

        const existingOrg = await UniversityAdmin.findOne({ organizationName, country }).session(session);
        if (existingOrg) {
            await session.abortTransaction();
            return sendError(res, 409, 'This university is already registered in this country.', 'DUPLICATE_ORGANIZATION');
        }

        // 3. Create
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUni = new UniversityAdmin({
            organizationName,
            country,
            website,
            officialEmail: normalizedEmail,
            phone,
            representativeName,
            password: hashedPassword,
            isVerified: true,
            verificationMethod: 'internal_domain_match',
            role: 'university'
        });

        await newUni.save({ session });
        await session.commitTransaction();

        return sendSuccess(res, { adminId: newUni._id, organizationName: newUni.organizationName });

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
