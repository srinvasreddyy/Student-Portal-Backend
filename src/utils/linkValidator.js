exports.validateLink = (linkUrl) => {
    try {
        const u = new URL(linkUrl);
        let type = 'website';

        const hostname = u.hostname.toLowerCase();

        if (hostname.includes('github.com')) {
            type = 'github';
        } else if (hostname.includes('youtube.com') || hostname.includes('youtu.be') || hostname.includes('vimeo.com')) {
            type = 'video';
        }

        return {
            valid: true,
            type,
            normalizedUrl: u.href
        };
    } catch (err) {
        return { valid: false };
    }
};
