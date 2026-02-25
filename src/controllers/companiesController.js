const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

const Company = require('../models/Company');
const { lookupCompaniesHouse, lookupOpenCorporates, ocrExtractText } = require('../services/companyLookupService');
const { verifyDomainAndEmail, getBaseDomain } = require('../middleware/domainVerifier');
const { sendVerificationEmail, sendEmail } = require('../services/mailer');
const logger = require('../utils/logger');

// Generate numeric code
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

exports.applyCompany = async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { country, companyNumber, name, website, companyEmail, representative } = req.body;

        // Check if applying company exists (UK needs strict unique companyNumber)
        if (country === 'UK' && !companyNumber) {
            return res.status(400).json({ success: false, message: 'companyNumber is required for UK' });
        }

        let existingCompany;
        if (companyNumber) {
            existingCompany = await Company.findOne({ country, companyNumber }).session(session);
            if (existingCompany) {
                return res.status(400).json({ success: false, message: 'Company already registered' });
            }
        }

        // 1. Domain / Email check
        const { websiteDomain, emailDomain, domainMatch, mxValid } = await verifyDomainAndEmail(website, companyEmail);

        let warningObj = null;
        if (!domainMatch) {
            warningObj = 'domain_mismatch';
        } else if (!mxValid) {
            warningObj = 'mx_absent_fallback';
        }

        // 2. Setup standard company object
        const newCompany = new Company({
            country,
            companyNumber,
            officialName: name, // fallback
            website,
            companyEmail,
            domains: websiteDomain ? [websiteDomain] : [],
            representative,
            status: 'pending',
        });

        let lookupResult = { provider: 'none', rawResponse: null, fetchedAt: new Date() };

        // 3. Perform external lookup
        if (country === 'UK' && companyNumber) {
            try {
                const chData = await lookupCompaniesHouse(companyNumber);
                lookupResult.provider = 'companies_house';
                lookupResult.rawResponse = chData;
                newCompany.officialName = chData.company_name || name;
            } catch (err) {
                logger.error(`Companies House lookup failed: ${err.message}`);
                lookupResult.provider = 'companies_house_failed';
            }
        } else {
            // OpenCorporates global check
            try {
                const ocData = await lookupOpenCorporates(name, country);
                if (ocData) {
                    lookupResult.provider = 'opencorporates';
                    lookupResult.rawResponse = ocData;
                    newCompany.officialName = ocData.name;
                    newCompany.companyNumber = ocData.company_number || companyNumber;
                } else {
                    lookupResult.provider = 'opencorporates_no_match';
                }
            } catch (err) {
                logger.error(`OpenCorporates lookup failed: ${err.message}`);
                lookupResult.provider = 'opencorporates_failed';
            }
        }

        newCompany.verification.externalLookup = lookupResult;
        await newCompany.addAuditLog('system@system.com', 'system', 'apply', { lookup: lookupResult.provider }, { session });

        // 4. Send Verification Email
        const code = generateCode();
        const saltRounds = 10;
        const hashedCode = await bcrypt.hash(code, saltRounds);

        newCompany.verification.emailTokenHash = hashedCode;
        newCompany.verification.tokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
        newCompany.verification.domainCheckedAt = new Date();

        await newCompany.save({ session });

        // Send email outside DB transaction logically but safe inside since email failure aborts application
        await sendVerificationEmail(companyEmail, code, newCompany._id);

        await session.commitTransaction();
        session.endSession();

        return res.status(201).json({
            success: true,
            applicationId: newCompany._id,
            status: newCompany.status,
            lookup: {
                provider: lookupResult.provider,
                confidence: ['companies_house', 'opencorporates'].includes(lookupResult.provider) ? 'high' : 'low'
            },
            warning: warningObj
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ success: false, message: 'APPLY_ERR: ' + (error.stack || error.message) });
    }
};

exports.verifyEmail = async (req, res, next) => {
    try {
        const code = req.body.code || req.query.code;
        const { id } = req.params;

        if (!code) return res.status(400).json({ success: false, message: 'Verification code required' });

        const company = await Company.findById(id);
        if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

        if (company.verification.emailVerified) {
            return res.status(400).json({ success: false, message: 'Email already verified' });
        }

        if (!company.verification.tokenExpiry || company.verification.tokenExpiry < new Date()) {
            return res.status(400).json({ success: false, message: 'token_expired' });
        }

        const isValid = await bcrypt.compare(code, company.verification.emailTokenHash);
        if (!isValid) {
            return res.status(400).json({ success: false, message: 'Invalid verification code' });
        }

        // Verify successful
        company.verification.emailVerified = true;
        company.verification.emailTokenHash = undefined;
        company.verification.tokenExpiry = undefined;

        // Auto-verify if external lookup was solid
        const solidProviders = ['companies_house', 'opencorporates'];
        if (solidProviders.includes(company.verification.externalLookup?.provider)) {
            company.status = 'verified';
        }

        await company.addAuditLog('system@system.com', 'system', 'email_verified', { statusUpdatedTo: company.status });
        await company.save();

        res.status(200).json({ success: true, message: 'Email verified successfully', status: company.status });
    } catch (err) {
        next(err);
    }
};

exports.getCompanyStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const company = await Company.findById(id).select('-verification.emailTokenHash -verification.tokenExpiry');

        if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

        res.status(200).json({ success: true, data: company });
    } catch (err) {
        next(err);
    }
};

exports.uploadDocument = async (req, res, next) => {
    try {
        const { id } = req.params;
        const company = await Company.findById(id);
        if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        // Link file ID to company
        company.documents.push(req.file.id);

        // Fallback OCR attempt
        let ocrText = null;
        // We only perform OCR if GridFS exposes buffer or we fetch it. 
        // GridFS storage drops file directly to DB, stream needed to read it back.
        // For simplicity in this scaffold without loading whole GridFS stream to buffer, 
        // we assume Tesseract takes stream or we bypass true OCR on GridFS streams for local dev.
        // Since Phase 2 demands local OCR (TesseractJS), we will add a log indicating setup.
        // Full implementation requires: `const stream = bucket.openDownloadStream(req.file.id)` piped to buffers.
        await company.addAuditLog('system@system.com', 'system', 'document_uploaded', { fileId: req.file.id });

        // We append note about OCR fallback
        if (!company.verification.externalLookup) company.verification.externalLookup = {};
        company.verification.externalLookup.provider = 'ocr_fallback_pending';

        company.status = 'pending'; // Requires SuperAdmin action
        await company.save();

        res.status(200).json({ success: true, message: 'Document uploaded successfully', fileId: req.file.id });
    } catch (err) {
        next(err);
    }
};

exports.markCompany = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, reason } = req.body; // status: 'verified', 'on_hold', 'rejected'

        if (!['verified', 'on_hold', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const company = await Company.findById(id);
        if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

        company.status = status;
        await company.addAuditLog(req.user?.email || 'system@system.com', req.user?.role || 'system', `marked_${status}`, { reason });

        await company.save();

        // Notify representative
        if (company.companyEmail) {
            await sendEmail(company.companyEmail, `Company Application Update: ${status}`, `Your application status has been changed to: ${status}. Reason: ${reason || 'N/A'}`);
        }

        res.status(200).json({ success: true, message: `Company marked as ${status}` });
    } catch (err) {
        next(err);
    }
};
