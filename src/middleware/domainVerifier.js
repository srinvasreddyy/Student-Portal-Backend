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

const PUBLIC_EMAIL_DOMAINS = new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
    'icloud.com', 'protonmail.com', 'mail.com', 'zoho.com', 'yandex.com'
]);

/**
 * Validates domain and email match
 */
async function verifyDomainAndEmail(websiteUrl, email) {
    if (!websiteUrl || !email) {
        return { success: false, message: 'Website and email are required', errorCode: 'MISSING_FIELDS' };
    }

    const websiteDomain = getBaseDomain(websiteUrl);

    // Normalize email and extract domain
    const normalizedEmail = email.trim().toLowerCase();
    const emailParts = normalizedEmail.split('@');
    if (emailParts.length !== 2) {
        return { success: false, message: 'Invalid email format', errorCode: 'INVALID_EMAIL' };
    }

    const rawEmailDomain = emailParts[1];
    const emailBaseDomain = getBaseDomain(rawEmailDomain);

    if (!websiteDomain || !emailBaseDomain) {
        return { success: false, message: 'Invalid domain format', errorCode: 'INVALID_DOMAIN' };
    }

    // 1. Check against public email providers
    if (PUBLIC_EMAIL_DOMAINS.has(emailBaseDomain)) {
        return { success: false, message: 'Public email domains are not allowed. Please use an official organizational email.', errorCode: 'PUBLIC_EMAIL_REJECTED' };
    }

    // 2. Validate Domain Match (Email must be same base domain as website)
    const domainMatch = websiteDomain === emailBaseDomain;

    // Prevent subdomain spoofing checks (e.g. user@admin.harvard.edu vs harvard.edu is okay since base domain matches)
    // If they don't match base domains, we reject.
    if (!domainMatch) {
        return { success: false, message: 'Email domain does not match the official website domain.', errorCode: 'DOMAIN_MISMATCH' };
    }

    // 3. MX Record Check
    const mxValid = await hasMx(rawEmailDomain);
    if (!mxValid) {
        return { success: false, message: 'Email domain does not have valid mail records.', errorCode: 'MX_RECORD_INVALID' };
    }

    return {
        success: true,
        data: {
            websiteDomain,
            emailDomain: rawEmailDomain,
            verified: true
        }
    };
}

module.exports = {
    getBaseDomain,
    hasMx,
    verifyDomainAndEmail
};
