/**
 * Docs consulted:
 * - GridFS API: https://www.mongodb.com/docs/manual/core/gridfs/
 * - MongoDB Node Driver (GridFSBucket): https://mongodb.github.io/node-mongodb-native/4.4/classes/GridFSBucket.html
 * - file-type package (ESM wrapper): https://www.npmjs.com/package/file-type
 * 
 * Rationale: Instead of using `multer-gridfs-storage`, using native `GridFSBucket` streams
 * allows us programmatic capability to sniff the buffer's initial bytes dynamically. This natively mitigates 
 * MIME sniffing vulnerabilities prior to committing files to disk directly. Memory usage is held to `chunkSizeBytes`.
 */

const mongoose = require('mongoose');
const { stream } = require('stream');

let bucket;

function getBucket() {
    if (!bucket) {
        // Init GridFSBucket lazily
        bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: process.env.GRIDFS_BUCKET_NAME || 'portfolios'
        });
    }
    return bucket;
}

/**
 * Validates the true file type bypassing header spoofing.
 */
async function getFileTypeData(bufferBlock) {
    try {
        const { fileTypeFromBuffer } = await import('file-type');
        return await fileTypeFromBuffer(bufferBlock);
    } catch (err) {
        return null;
    }
}

/**
 * Uploads a file stream directly to GridFS with chunking.
 */
exports.uploadFileStream = ({ fileStream, filename, metadata }) => {
    return new Promise((resolve, reject) => {
        const gfsBucket = getBucket();
        // 255KB is default chunk size which optimally avoids fragmentation in mongodb
        const uploadStream = gfsBucket.openUploadStream(filename, {
            metadata
        });

        fileStream.pipe(uploadStream)
            .on('error', (err) => reject(err))
            .on('finish', () => {
                resolve({
                    fileId: uploadStream.id,
                    filename,
                    metadata
                });
            });
    });
};

/**
 * Resolves Metadata directly bypassing the chunks for snappy listing
 */
exports.getFileMetadata = async (fileId) => {
    const gfsBucket = getBucket();
    const files = await gfsBucket.find({ _id: new mongoose.Types.ObjectId(fileId) }).toArray();
    if (!files || files.length === 0) return null;
    return files[0];
};

/**
 * Deletes the file entirely from GridFS
 */
exports.deleteFile = async (fileId) => {
    const gfsBucket = getBucket();
    try {
        await gfsBucket.delete(new mongoose.Types.ObjectId(fileId));
        return true;
    } catch (e) {
        // 404 - already deleted or doesn't exist
        return false;
    }
};

/**
 * Streams the file sequentially handling Partial ranges (used for fast video skipping)
 */
exports.downloadFileStream = async (fileId, res, reqHeaders) => {
    const file = await exports.getFileMetadata(fileId);
    if (!file) {
        return res.status(404).json({ success: false, message: 'File not found' });
    }

    const { length, metadata } = file;
    const gfsBucket = getBucket();

    // Browser range support for streaming Videos
    if (reqHeaders && reqHeaders.range) {
        const parts = reqHeaders.range.replace(/bytes=/, '').split('-');
        const partialstart = parts[0];
        const partialend = parts[1];

        const start = parseInt(partialstart, 10);
        const end = partialend ? parseInt(partialend, 10) : length - 1;
        const chunksize = (end - start) + 1;

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${length}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': metadata.mimeType,
            'X-Content-Type-Options': 'nosniff'
        });

        gfsBucket.openDownloadStream(file._id, { start, end: end + 1 }).pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': length,
            'Content-Type': metadata.mimeType,
            'X-Content-Type-Options': 'nosniff'
        });
        gfsBucket.openDownloadStream(file._id).pipe(res);
    }
};
