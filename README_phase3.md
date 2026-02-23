# Phase 3: University Onboarding & Verification Subsystem

This concludes Phase 3 development for the MERN core backend. The system now supports automated, intelligent discovery and onboarding of Universities using caching and external datasets.

## Features Added

### 1. Data Source Integration (Hipo Labs)
Integrated the free API provided by [Hipo Labs (universities.hipolabs.com)](http://universities.hipolabs.com/search) to allow the frontend to gracefully autocomplete University names and fetch officially recognized web domains worldwide.

- Data is retrieved natively through `services/universityLookupService.js`.
- Implemented an LRU-style in-memory cache to aggressively prevent upstream rate bans from Hipo Labs (~5req/sec throttle globally applied).

### 2. Verified University Model
- Normalizes root-domains utilizing `psl` immediately upon search/apply.
- Tracks `representative` status explicitly to tie User profiles onto pending or verified structures.
- Strict Audit Logs array mapping. 

### 3. Application Flow
- `POST /universities/apply`: Takes candidate information and runs immediate background DNS checks (`MX` & `A` Record fallbacks) for domain and email verifications.
- **Fail-safes**: If Hipo Labs fails, the system safely falls back to GridFS Document Uploads (`POST /universities/:id/upload-doc`), queueing SuperAdmin OCR review.
- Sends out templated OTP codes utilizing Nodemailer.

---

## Setup Requirements

Create/verify your `.env` contains the following. *(Omit HIPO_LABS_KEY as it requires none, keeping integration 100% free.)*

```env
MONGO_URI=mongodb://localhost:27017/mern_db
JWT_SECRET=supersecret1
REFRESH_TOKEN_SECRET=supersecret2
# Development specific Ethereal for testing Email OTPs
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=YOUR_ETHEREAL_USER
SMTP_PASS=YOUR_ETHEREAL_PASS
ALLOWED_ORIGINS=http://localhost:3000
```

## Migration Notes

> [!NOTE] 
> Future-proofing: If Hipo Labs dramatically alters their JSON response schema, the raw upstream payload is captured verbatim under `externalLookup.rawResponse` in the database. This allows running a DB migration script later to pluck alternative fields without data loss.

If expanding beyond single-instance deployment, swap the local LRU Cache Map in `universityLookupService.js` with **Redis**. 
1. `npm install redis`
2. Configure `redis.createClient({ url: process.env.REDIS_URL })`.

## Running & Testing

**Install Dependencies:**
\`\`\`bash
npm install # note you may need --legacy-peer-deps
\`\`\`

**Run Server:**
\`\`\`bash
npm run dev
\`\`\`

**Run Tests (Phase 3 specifically):**
The tests utilize `nock` / `jest.mock` concepts to prevent flooding upstream Hipo Labs pipelines. Total coverage of 8 distinct application permutations.
\`\`\`bash
npm test tests/university.search.test.js
npm test tests/university.apply.test.js
\`\`\`

---

## Endpoint Examples

**1. Search Universities:**
`GET /universities/search?q=Harvard&country=United States`
```json
// Auto-cached standard response
[
  {
    "name": "Harvard University",
    "country": "United States",
    "domains": ["harvard.edu"],
    "web_pages": ["http://www.harvard.edu/"]
  }
]
```

**2. Apply:**
`POST /universities/apply`
```json
{
  "country": "United States",
  "universityName": "Harvard University",
  "officialDomain": "harvard.edu",
  "representative": {
    "name": "Dr Jane",
    "role": "Admissions",
    "email": "jane@harvard.edu"
  }
}
```
*Response (`201 Created`):*
```json
{
  "applicationId": "65b...",
  "status": "pending",
  "domains": ["harvard.edu"],
  "message": "verification_code_sent"
}
```
