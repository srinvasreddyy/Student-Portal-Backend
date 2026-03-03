require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const { Readable } = require('stream');
const storageService = require('./src/services/storageService');

async function testUpload() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    const fileBuffer = Buffer.from('Hello world Cloudinary test', 'utf-8');
    const fileStream = new Readable();
    fileStream.push(fileBuffer);
    fileStream.push(null);

    try {
        const result = await storageService.uploadFileStream({
            fileStream,
            filename: 'test.txt',
            metadata: { type: 'test' }
        });
        console.log('Upload success:', result);

        // Test delete
        process.env.GRIDFS_BUCKET_NAME = 'portfolios';
        const delResult = await storageService.deleteFile(result.fileId);
        console.log('Delete success:', delResult);

    } catch (err) {
        console.error('Upload failed:', err);
    }

    process.exit(0);
}

testUpload();
