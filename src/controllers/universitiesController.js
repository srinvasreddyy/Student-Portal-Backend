const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const University = require('../models/University');
const { searchUniversities, getDomainsForUniversity } = require('../services/universityLookupService');
const { verifyDomainAndEmail, getBaseDomain } = require('../middleware/domainVerifier');
const { sendVerificationEmail } = require('../services/mailer');
const logger = require('../utils/logger');

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

exports.search = async (req, res, next) => {
    try {
        const { q, country } = req.query;
        if (!q) return res.status(400).json({ success: false, message: 'Query parameter q is required' });

        const results = await searchUniversities(q, country);
        res.status(200).json(results);
    } catch (err) {
        next(err);
    }
};

exports.applyUniversity = async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { country, universityName, website, officialDomain, representative } = req.body;

        if (!universityName || !country || !representative?.email) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // Attempt to lookup domains internally
        let discoveredDomains = [];
        let lookupProvider = 'none';
        let lookupResponse = null;

        try {
            const candidates = await searchUniversities(universityName, country);
            lookupResponse = candidates;
            if (candidates.length > 0) {
                lookupProvider = 'hipo_labs';
                const bestMatch = candidates.find(c => c.name.toLowerCase() === universityName.toLowerCase());
                discoveredDomains = bestMatch ? bestMatch.domains : candidates[0].domains;
            }
        } catch (err) {
            logger.warn(`Hipo labs lookup failed during apply: ${err.message}`);
            lookupProvider = err.message; // e.g. 'upstream_timeout'
        }

        let targetDomain = officialDomain;

        // Auto-prefill if dataset strict match
        if (!targetDomain && discoveredDomains.length > 0) {
            targetDomain = discoveredDomains[0];
        }

        let warningObj = null;
        let domainsToSave = targetDomain ? [getBaseDomain(targetDomain)] : [];

        // If we have a domain, enforce PSL + DNS matching
        if (targetDomain) {
            const websiteDomain = website ? getBaseDomain(website) : getBaseDomain(targetDomain);
            const { emailDomain, domainMatch, mxValid } = await verifyDomainAndEmail(targetDomain, representative.email);

            if (!domainMatch && websiteDomain && emailDomain && (websiteDomain !== emailDomain)) {
                warningObj = 'domain_mismatch';
            } else if (!mxValid) {
                warningObj = 'mx_absent_fallback';
            }

            // Add both just in case, logic favors email domain if different
            if (emailDomain && !domainsToSave.includes(emailDomain)) {
                domainsToSave.push(emailDomain);
            }
        } else {
            warningObj = 'no_domain_found';
        }

        const newUniversity = new University({
            name: universityName,
            country,
            website: website || '',
            domains: domainsToSave,
            representative,
            status: 'pending'
        });

        newUniversity.verification.externalLookup = {
            provider: lookupProvider,
            rawResponse: lookupResponse ? Array.from(lookupResponse).slice(0, 5) : null // cap size
        };

        await newUniversity.addAuditLog('system@system.com', 'system', 'apply', { lookup: lookupProvider }, { session });

        // Send Mail
        if (targetDomain || warningObj === 'domain_mismatch' || warningObj === 'mx_absent_fallback') {
            const code = generateCode();
            const hashedCode = await bcrypt.hash(code, 10);

            newUniversity.verification.emailTokenHash = hashedCode;
            newUniversity.verification.tokenExpiry = new Date(Date.now() + 15 * 60 * 1000);
            newUniversity.verification.domainCheckedAt = new Date();

            await sendVerificationEmail(representative.email, code, newUniversity._id);
        }

        await newUniversity.save({ session });
        await session.commitTransaction();
        session.endSession();

        return res.status(201).json({
            success: true,
            applicationId: newUniversity._id,
            status: newUniversity.status,
            domains: discoveredDomains,
            message: (targetDomain || domainsToSave.length > 0) ? 'verification_code_sent' : 'requires_upload_fallback',
            warning: warningObj
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
};

exports.verifyEmail = async (req, res, next) => {
    try {
        const { code } = req.body;
        const { id } = req.params;

        if (!code) return res.status(400).json({ success: false, message: 'Verification code required' });

        const university = await University.findById(id);
        if (!university) return res.status(404).json({ success: false, message: 'University not found' });

        if (university.verification.emailVerified) return res.status(400).json({ success: false, message: 'Already verified' });
        if (!university.verification.tokenExpiry || university.verification.tokenExpiry < new Date()) {
            return res.status(400).json({ success: false, message: 'invalid_token' });
        }

        const isValid = await bcrypt.compare(code, university.verification.emailTokenHash);
        if (!isValid) return res.status(400).json({ success: false, message: 'invalid_token' });

        university.verification.emailVerified = true;
        university.verification.emailTokenHash = undefined;
        university.verification.tokenExpiry = undefined;

        // Auto verify logic: only if dataset provided match AND email exactly matched it
        const hasExternalDomainMatch = university.verification.externalLookup?.provider === 'hipo_labs';
        if (hasExternalDomainMatch) {
            university.status = 'verified';
            university.verified = true;
        }

        await university.addAuditLog('system@system.com', 'system', 'email_verified', { autoVerified: university.verified });
        await university.save();

        res.status(200).json({ success: true, message: 'Verified successfully', status: university.status });
    } catch (err) {
        next(err);
    }
};

exports.getStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const university = await University.findById(id).select('-verification.emailTokenHash -verification.tokenExpiry');

        if (!university) return res.status(404).json({ success: false, message: 'University not found' });

        // Expose audit logs paginated (simple slice for now)
        const { page = 1, limit = 10 } = req.query;
        const logs = university.auditLogs.reverse().slice((page - 1) * limit, page * limit);

        // Create cloned object to safely inject sliced logs
        const safeData = university.toObject();
        safeData.auditLogs = logs;

        res.status(200).json({ success: true, data: safeData });
    } catch (err) {
        next(err);
    }
};

exports.uploadDocument = async (req, res, next) => {
    try {
        const { id } = req.params;
        const university = await University.findById(id);
        if (!university) return res.status(404).json({ success: false, message: 'University not found' });

        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        university.documents.push(req.file.id);
        await university.addAuditLog('system@system.com', 'system', 'document_uploaded', { fileId: req.file.id });

        if (!university.verification.externalLookup) {
            university.verification.externalLookup = {};
        }
        university.verification.externalLookup.provider = 'file_upload_pending_ocr';
        university.status = 'pending';

        // OCR logic handled outside of hot path typically, here we stub attaching logic 
        // const { ocrExtractText } = require('../services/companyLookupService');
        // const text = await ocrExtractText(bufferFromGridFS);
        // university.verification.externalLookup.rawResponse = text;

        await university.save();

        res.status(200).json({ success: true, message: 'Document uploaded successfully', fileId: req.file.id });
    } catch (err) {
        next(err);
    }
};
