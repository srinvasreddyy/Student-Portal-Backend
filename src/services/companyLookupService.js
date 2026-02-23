/**
 * Docs read:
 * - Companies House API:
 *   - Endpoint: https://api.company-information.service.gov.uk/company/{companyNumber}
 *   - Auth: Basic auth using API key (username)
 *   - Rate limit: 600 req / 5 mins per IP/Key
 *   - Sample Response: { "company_name": "ACME LTD", "company_number": "12345678", "registered_office_address": {...} }
 * 
 * - OpenCorporates API:
 *   - Endpoint: https://api.opencorporates.com/v0.4.8/companies/search?q={name}&jurisdiction_code={jurisdiction}
 *   - Auth: api_token query param
 *   - Rate limit: 500 req / month (free tier)
 *   - Sample Response: { "results": { "companies": [ { "company": { "name": "ACME CORP", "company_number": "...", "confidence": "high" } } ] } }
 *
 * - Tesseract.js:
 *   - Used for local OCR fallback when free APIs fail/unavailable.
 */

const axios = require('axios');
const Tesseract = require('tesseract.js');
const config = require('../config');
const logger = require('../utils/logger');

const RETRY_DELAY = 1000;
const MAX_RETRIES = 3;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(requestFn, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            return await requestFn();
        } catch (error) {
            if (error.response && error.response.status === 429) {
                const retryAfter = error.response.headers['retry-after'] || 5;
                logger.warn(`Rate limit hit. Retrying after ${retryAfter} seconds...`);
                await sleep(retryAfter * 1000);
            } else if (i < retries - 1) {
                logger.warn(`External API request failed. Retrying... (${i + 1}/${retries})`);
                await sleep(RETRY_DELAY * Math.pow(2, i)); // Exponential backoff
            } else {
                throw error;
            }
        }
    }
}

async function lookupCompaniesHouse(companyNumber) {
    if (!config.vendors.companiesHouseKey) {
        throw new Error('Companies House API key missing');
    }

    const authHeader = `Basic ${Buffer.from(config.vendors.companiesHouseKey + ':').toString('base64')}`;

    const requestFn = () => axios.get(`https://api.company-information.service.gov.uk/company/${companyNumber}`, {
        headers: { Authorization: authHeader }
    });

    const response = await fetchWithRetry(requestFn);
    return response.data;
}

// Map standard country codes/names to open corporates jurisdiction codes as needed
function mapCountryToJurisdiction(country) {
    const map = {
        'US': 'us',
        'FR': 'fr',
        // add more mappings
    };
    return map[country] || country.toLowerCase();
}

async function lookupOpenCorporates(companyName, country) {
    const jurisdiction = mapCountryToJurisdiction(country);
    const tokenParams = config.vendors.openCorporatesToken ? `&api_token=${config.vendors.openCorporatesToken}` : '';
    const url = `https://api.opencorporates.com/v0.4.8/companies/search?q=${encodeURIComponent(companyName)}&jurisdiction_code=${jurisdiction}${tokenParams}`;

    const requestFn = () => axios.get(url);

    const response = await fetchWithRetry(requestFn);

    const companies = response.data?.results?.companies || [];
    if (companies.length === 0) return null;

    // Define confidence heuristic (e.g. name exactly matches or API score is high)
    const bestMatch = companies[0].company;
    if (!bestMatch) return null;

    // Simple heuristic: if name matches case-insensitively
    if (bestMatch.name.toLowerCase() === companyName.toLowerCase()) {
        return bestMatch;
    }

    return null; // Low confidence
}

async function ocrExtractText(buffer) {
    try {
        const { data: { text } } = await Tesseract.recognize(buffer, 'eng', {
            logger: m => logger.debug(JSON.stringify(m))
        });
        return text;
    } catch (err) {
        logger.error(`OCR failed: ${err.message}`);
        throw err;
    }
}

module.exports = {
    lookupCompaniesHouse,
    lookupOpenCorporates,
    ocrExtractText
};
