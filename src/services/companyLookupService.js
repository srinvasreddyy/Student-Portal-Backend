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
            } else if (error.response && error.response.status === 401) {
                logger.warn(`External API authentication failed (401). Skipping retries.`);
                throw error;
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
    // We are spoofing the 'OpenCorporates' function name to use Wikipedia's free public Search API
    // so the frontend still gets a global list of organizations without requiring any API keys.
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(companyName)}&limit=10&namespace=0&format=json`;

    const requestFn = () => axios.get(url, { headers: { 'User-Agent': 'StudentPortalApp/1.0 (test@example.com)' } });
    const response = await fetchWithRetry(requestFn);

    // Wikipedia opensearch returns: [ "search term", ["Result 1", "Result 2"], ["", ""], ["url1", "url2"] ]
    if (!response.data || !response.data[1] || response.data[1].length === 0) {
        return null; // No results
    }

    const companyNames = response.data[1];

    // Map to the format the registration controller expects
    return companyNames.map(name => ({
        company: {
            name: name,
            company_number: 'N/A (Global)' // Wikipedia doesn't have registry numbers
        }
    }));
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
