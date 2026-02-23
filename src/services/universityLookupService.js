/**
 * Docs read & endpoints cited (DeepSearch):
 * - Hipo Labs / University Domains and Names Data List API
 *   - Repo: https://github.com/Hipo/university-domains-list
 *   - Base URL: http://universities.hipolabs.com
 *   - Endpoint: /search
 *   - Query Params: name={name}, country={country}, limit={number}
 *   - Auth: None (Free public API)
 *   - Rate limit: Not strictly documented by Hipo, but standard courtesy applies (e.g. 5 req/sec). 
 *     If no rate limits exist, we internally throttle & cache to prevent being IP banned.
 *   - Sample Request: GET http://universities.hipolabs.com/search?name=middle&country=turkey
 *   - Sample Response:
 *     [
 *       {
 *         "state-province": null,
 *         "country": "Turkey",
 *         "domains": ["metu.edu.tr"],
 *         "web_pages": ["http://www.metu.edu.tr/"],
 *         "alpha_two_code": "TR",
 *         "name": "Middle East Technical University"
 *       }
 *     ]
 */

const axios = require('axios');
const logger = require('../utils/logger');

// Simple in-memory LRU Cache replacement (TTL structure)
// NOTE: For scale, replace the `cache` object with a Redis client implementation:
// const redis = require('redis');
// const client = redis.createClient({ url: process.env.REDIS_URL });
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const cache = new Map();

function getCached(key) {
    const item = cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
        cache.delete(key);
        return null;
    }
    return item.data;
}

function setCached(key, data) {
    cache.set(key, {
        data,
        expiry: Date.now() + CACHE_TTL_MS,
    });
}

// Upstream throttle tracking (simple)
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 200; // Limit to ~5 req/sec globally for this node

async function throttleUpstream() {
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < MIN_INTERVAL_MS) {
        const delay = MIN_INTERVAL_MS - timeSinceLast;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    lastRequestTime = Date.now();
}

/**
 * Search universities from Hipo Labs with caching
 * @param {string} query Search term for university name
 * @param {string} country Optional country filter
 * @returns {Array} List of candidate matches { name, country, domains[], web_pages[] }
 */
async function searchUniversities(query, country = '') {
    const cacheKey = `uni_search:${query}:${country}`.toLowerCase();
    const cachedData = getCached(cacheKey);
    if (cachedData) {
        return cachedData;
    }

    await throttleUpstream();

    try {
        const qStr = new URLSearchParams();
        if (query) qStr.append('name', query);
        if (country) qStr.append('country', country);

        const url = `http://universities.hipolabs.com/search?${qStr.toString()}`;
        const response = await axios.get(url, { timeout: 5000 });

        // Map just needed fields
        const results = (response.data || []).map(uni => ({
            name: uni.name,
            country: uni.country,
            domains: uni.domains || [],
            web_pages: uni.web_pages || [],
        }));

        setCached(cacheKey, results);
        return results;
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            logger.error('Hipo Labs upstream timeout');
            throw new Error('upstream_timeout');
        }
        logger.error(`Lookup failed: ${error.message}`);
        throw new Error('university_lookup_failed');
    }
}

/**
 * Exact or near-exact match fetcher to get domains for a named university
 */
async function getDomainsForUniversity(name, country) {
    const candidates = await searchUniversities(name, country);

    // Find best exact match
    const bestMatch = candidates.find(
        c => c.name.toLowerCase() === name.toLowerCase() &&
            c.country.toLowerCase() === country.toLowerCase()
    );

    if (bestMatch && bestMatch.domains) {
        return bestMatch.domains;
    }

    // Fallback to first if only one returns
    if (candidates.length === 1 && candidates[0].domains) {
        return candidates[0].domains;
    }

    return [];
}

module.exports = {
    searchUniversities,
    getDomainsForUniversity,
};
