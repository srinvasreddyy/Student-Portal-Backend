const dns = require('dns').promises;
const psl = require('psl');

// Normalize domain using Public Suffix List
function getBaseDomain(hostname) {
    if (!hostname) return null;

    // Extract hostname from URL if necessary
    try {
        const url = new URL(hostname.startsWith('http') ? hostname : `https://${hostname}`);
        hostname = url.hostname;
    } catch (e) { /* ignore */ }

    const parsed = psl.parse(hostname);
    if (parsed && parsed.domain) return parsed.domain.toLowerCase();
    return hostname.toLowerCase();
}

/**
 * Checks if domain has valid MX records, fallback to A records.
 */
async function hasMx(domain, timeout = 5000) {
    try {
        const mxPromise = dns.resolveMx(domain);
        const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('dns timeout')), timeout));

        const mx = await Promise.race([mxPromise, timeoutPromise]);
        return Array.isArray(mx) && mx.length > 0;
    } catch (err) {
        // fallback to A record check as per RFC if MX is absent
        try {
            const aPromise = dns.resolve(domain);
            const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('dns timeout')), timeout));

            const a = await Promise.race([aPromise, timeoutPromise]);
            return Array.isArray(a) && a.length > 0;
        } catch (e) {
            return false;
        }
    }
}

/**
 * Validates domain and email match
 */
async function verifyDomainAndEmail(websiteUrl, email) {
    const websiteDomain = getBaseDomain(websiteUrl);

    const emailParts = email.split('@');
    const emailDomain = emailParts.length === 2 ? getBaseDomain(emailParts[1]) : null;

    const domainMatch = websiteDomain === emailDomain;
    let mxValid = false;

    if (emailDomain) {
        mxValid = await hasMx(emailDomain);
    }

    return {
        websiteDomain,
        emailDomain,
        domainMatch,
        mxValid
    };
}

module.exports = {
    getBaseDomain,
    hasMx,
    verifyDomainAndEmail
};
