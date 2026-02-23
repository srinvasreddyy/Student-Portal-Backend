# Phase 6: Student Profile & Portfolio Management

This completes Phase 6 by implementing the robust Student Profile management suite accompanied by dynamic GridFS-backed Portfolio Item streaming.

## Core Features Delivered
1. **Model `StudentProfile.js`**:
    - Centralized location for user bios, multi-array education & experience blocks, techStack tags.
    - Added Privacy controls (`publicProfile`, `portfolioPublic`) gating non-Admin viewership.
2. **Model `PortfolioItem.js`**:
    - Supports two primary types of submissions: **URL Links** (GitHub, websites, YouTube) and **Streamed Files** (Documents, Images, Videos).
    - `fileId` refers directly to native `fs.files` buckets under GridFS.
3. **Storage Services & Security**:
    - `services/storageService.js` actively streams `Busboy` parsing blocks straight into Mongoose's `GridFSBucket.openUploadStream()`.
    - Memory footprint remains sub-1MB regardless of uploading a 20KB PDF or a 2GB Video clip.
    - Implemented streaming file-type Sniffing via `file-type` to detect disguised Executables hiding under legitimate `.png` or `.pdf` extensions before fully committing it to the DB.
    - Download endpoints support fast-forwarding (`Accept-Ranges`) to allow `<video>` tags to perform HTTP 206 Partial Content skips natively.
4. **Integration Hooks (Phase 5)**:
    - Updated `completeProject` inside `projectService.js` to automatically stamp and `insertMany()` the Student(s) who finished the project into their Portfolio Item list dynamically.

## Environment Flags Requirements
Be sure you install the new dependencies locally first before testing:
\`\`\`bash
npm install busboy file-type
\`\`\`

If `GRIDFS_BUCKET_NAME` is missing from your `.env`, it will dynamically create the bucket `portfolios` on your MongoDB automatically. Recommended limits:
\`\`\`env
MAX_FILE_SIZE_BYTES=20971520
\`\`\`

## Testing Phase 6
Mongoose tests hook directly into `GridFSBucket` internally utilizing the same mock instances.
\`\`\`bash
npx jest tests/student.profile.test.js
npx jest tests/portfolio.upload.test.js
\`\`\`

## Migration Notes
If scaling extremely high, replace `services/storageService.js` exports directly with AWS S3 stream proxies. The `PortfolioItem.storage` flag ('gridfs' vs 's3') was added specifically to ease feature-flag rollouts during the cutover script process.
