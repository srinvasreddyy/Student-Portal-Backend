# Phase 2: Company Verification Subsystem

This phase implements a robust Company application & verification subsystem.

## Features
- **Company Model**: Complete Mongoose model capturing audit logs, verification status, domains, and GridFS documents.
- **UK Official Lookup**: Uses Companies House API to accurately lookup UK companies and automatically fetch their canonical data.
- **Global Lookup**: Uses OpenCorporates API for non-UK registrations.
- **Fallback OCR**: Supports document uploading for unrecognized registrations (with Tesseract.js integration pointers).
- **Domain Verification**: Utilizes the Public Suffix List (`psl`) to ensure website domains strictly match the company email domain.
- **DNS MX Checks**: Validates domain email capability by querying MX and A records securely via Node's `dns` promises.
- **Email Verification**: Dispatches hashed short-lived tokens via Nodemailer (`SMTP_HOST`, `SMTP_PORT`, etc.) allowing immediate company verification if the token is valid.

## Setup Instructions
1. Run `npm install` (using `--legacy-peer-deps` if `erresolve` errors happen).
2. Set `.env` values (especially `COMPANIES_HOUSE_API_KEY` and `OPENCORPORATES_TOKEN`).
3. Set `SMTP_*` values in `.env` to a valid Mailtrap or Ethereal account to view verification token delivery.
4. Mount `require('./routes/companies')` inside `app.js` using `app.use('/companies', companyRoutes)` (Note: The test file automatically mounts this to verify functionality).

## Testing
Run the 7 detailed automated integration edge cases using:
\`\`\`bash
npm test tests/company.apply.test.js
\`\`\`

## Expected Request Format
**POST /companies/apply**
\`\`\`json
{
  "country": "UK",
  "companyNumber": "12345678",
  "name": "Acme Ltd",
  "website": "https://acme.com",
  "companyEmail": "rep@acme.com",
  "representative": {
    "name": "Jane Doe",
    "role": "HR Head",
    "dob": "1990-01-01",
    "location": "London, UK"
  }
}
\`\`\`

**POST /companies/:id/verify-email**
\`\`\`json
{
  "code": "123456"
}
\`\`\`

## Note on Dependencies
Installed specific to phase 2: `axios`, `psl`, `tesseract.js`, `multer-gridfs-storage`. All are robust and free tier-friendly.
