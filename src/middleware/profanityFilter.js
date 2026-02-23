// Very basic list of bad words. In production, consider using 'bad-words' npm package
const BAD_WORDS = new Set(['badword1', 'badword2', 'spam']);

/**
 * Simple pluggable hook to filter profanity.
 * Can be configured to either 'block' the message or 'flag' it.
 */
const filterProfanity = (text, action = 'block') => {
    if (!text) return { sanitized: text, flagged: false, blocked: false };

    const words = text.toLowerCase().split(/\s+/);
    let hasProfanity = false;

    // Check against bad words
    for (const word of words) {
        // strip punctuation for basic checking
        const cleanWord = word.replace(/[^\w\s]/gi, '');
        if (BAD_WORDS.has(cleanWord)) {
            hasProfanity = true;
            break;
        }
    }

    if (hasProfanity && action === 'block') {
        return { sanitized: text, flagged: true, blocked: true, error: 'Message contains prohibited content.' };
    }

    // If flagging or replacing instead:
    let sanitizedText = text;
    if (hasProfanity && action === 'mask') {
        const regex = new RegExp(Array.from(BAD_WORDS).join('|'), 'gi');
        sanitizedText = sanitizedText.replace(regex, '***');
    }

    return { sanitized: sanitizedText, flagged: hasProfanity, blocked: false };
};

module.exports = { filterProfanity };
