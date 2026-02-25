const Busboy = require('busboy');
const mongoose = require('mongoose');

// Initialize file-type. Since v16 it is pure ESM, we must dynamically import it.
let fileTypeFromBuffer;
import('file-type').then(module => {
    fileTypeFromBuffer = module.fileTypeFromBuffer;
});

const { uploads } = require('../config/security');
const MAX_FILE_SIZE = uploads.maxSizeBytes;
const ALLOWED_MIMES = uploads.allowedMimes;

const streamUpload = (req, res, next) => {
    if (req.method !== 'POST') return next();

    // Skip non-multipart requests (e.g., JSON link-only submissions)
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) return next();

    let busboy;
    try {
        busboy = Busboy({
            headers: req.headers,
            limits: { fileSize: Number(MAX_FILE_SIZE) }
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: 'Invalid Multipart payload' });
    }

    req.body = {};
    req.streamedFile = null;
    let fileFound = false;
    let fileRejected = false;

    busboy.on('field', (fieldname, val) => {
        req.body[fieldname] = val;
    });

    busboy.on('file', (fieldname, file, info) => {
        if (fieldname !== 'file') {
            file.resume();
            return;
        }

        fileFound = true;
        const { filename, encoding, mimeType } = info;

        // Peak at the first few KB using 'data' event listener to verify magical bytes
        // This validates the actual MIME rather than trusting the browser header
        let chunkPreview = Buffer.alloc(0);
        let sniffing = true;

        file.on('data', async (data) => {
            if (sniffing) {
                chunkPreview = Buffer.concat([chunkPreview, data]);

                // Usually 4100 bytes is enough for magic bytes verification
                if (chunkPreview.length >= 4100 && fileTypeFromBuffer) {
                    sniffing = false;
                    try {
                        const detectedType = await fileTypeFromBuffer(chunkPreview);
                        if (!detectedType || !ALLOWED_MIMES.includes(detectedType.mime)) {
                            fileRejected = true;
                            file.resume(); // drain file to end quickly
                            return;
                        }
                    } catch (err) {
                        fileRejected = true;
                        file.resume();
                    }
                }
            }
        });

        // Strip dangerous metadata attributes functionally (via pipeline, typically managed later if needed)
        // Here we just sanitize the filename replacing any non-alphanumeric chars
        const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '');

        req.streamedFile = {
            stream: file,
            filename: safeFilename,
            mimeType,
            encoding
        };

        file.pause();
        next();
    });

    busboy.on('finish', () => {
        if (fileRejected) {
            return res.status(400).json({ success: false, error: 'INVALID_FILE_TYPE', message: 'The uploaded file type is not permitted or is spoofed.' });
        }
        if (!fileFound && !res.headersSent) {
            next();
        }
    });

    busboy.on('finish', () => {
        if (!fileFound) {
            next(); // Proceed if no file block was sent (like for links)
        }
    });

    busboy.on('error', (err) => {
        logger.error(`Busboy error: \${err.message}`);
        next(err);
    });

    req.pipe(busboy);
};

module.exports = streamUpload;
