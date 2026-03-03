/**
 * Docs consulted:
 * - Cloudinary Node SDK: https://cloudinary.com/documentation/node_integration
 * - GridFS API: https://www.mongodb.com/docs/manual/core/gridfs/
 */

const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

let bucket;

function getBucket() {
    if (!bucket) {
        // Init GridFSBucket lazily for backward compatibility
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
 * Uploads a file stream directly to Cloudinary
 */
exports.uploadFileStream = ({ fileStream, filename, metadata }) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: 'auto',
                folder: 'gap_portfolios' // Organize files in Cloudinary
            },
            (error, result) => {
                if (error) return reject(error);
                resolve({
                    fileId: result.public_id,
                    url: result.secure_url,
                    filename,
                    metadata
                });
            }
        );

        fileStream.pipe(uploadStream).on('error', (err) => reject(err));
    });
};

/**
 * Resolves Metadata directly bypassing the chunks for snappy listing (GridFS only)
 */
exports.getFileMetadata = async (fileId) => {
    if (!mongoose.Types.ObjectId.isValid(fileId)) return null;
    const gfsBucket = getBucket();
    const files = await gfsBucket.find({ _id: new mongoose.Types.ObjectId(fileId) }).toArray();
    if (!files || files.length === 0) return null;
    return files[0];
};

/**
 * Deletes the file (handles both Cloudinary and GridFS)
 */
exports.deleteFile = async (fileId) => {
    // If it's a legacy GridFS Hex ID
    if (mongoose.Types.ObjectId.isValid(fileId)) {
        const gfsBucket = getBucket();
        try {
            await gfsBucket.delete(new mongoose.Types.ObjectId(fileId));
            return true;
        } catch (e) {
            return false;
        }
    } else {
        // Cloudinary Public ID
        try {
            await cloudinary.uploader.destroy(fileId);
            return true;
        } catch (e) {
            return false;
        }
    }
};

/**
 * Download / Stream Handler (Handles both legacy GridFS and dynamic Cloudinary routing)
 */
exports.downloadFileStream = async (fileId, res, reqHeaders) => {
    // 1. Cloudinary File
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
        // Fast redirect to the secure CDN url
        const url = cloudinary.url(fileId, { secure: true });
        return res.redirect(url);
    }

    // 2. Legacy GridFS File streaming
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
