const Busboy = require('busboy');
const mongoose = require('mongoose');

let fileTypeFromBuffer;
import('file-type').then(module => {
    fileTypeFromBuffer = module.fileTypeFromBuffer;
});

const { uploads } = require('../config/security');
const MAX_FILE_SIZE = uploads.maxSizeBytes;
const ALLOWED_MIMES = uploads.allowedMimes;

const streamUpload = (req, res, next) => {
    if (req.method !== 'POST') return next();

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

    busboy.on('field', (fieldname, val) => {
        req.body[fieldname] = val;
    });

    busboy.on('file', (fieldname, file, info) => {
        if (fieldname !== 'file') {
            file.resume();
            return;
        }

        const { filename, encoding, mimeType } = info;
        const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '');

        req.streamedFile = {
            stream: file,
            filename: safeFilename,
            mimeType,
            encoding
        };

        // Important: in tests using supertest, if the stream isn't drained/piped entirely
        // before 'close' or 'finish', process hangs. Let the controller handle piping!
        next();
    });

    busboy.on('finish', () => {
        if (!req.streamedFile && !res.headersSent) {
            next();
        }
    });

    busboy.on('error', (err) => {
        next(err);
    });

    req.pipe(busboy);
};

module.exports = streamUpload;
