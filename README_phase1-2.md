# Phase 1 & 2: Auth and Company Subsystems

This completes the MERN backend core features for Auth (Phase 1) and Company Onboarding (Phase 2), ready for frontend consumption.

## Features Added

### Phase 1: Auth & User
- **User Model**: Complete handling of roles (`student`, `company_admin`, `university_admin`, `super_admin`) and statuses (`pending`, `active`).
- **Registration Flow**: Students start as `active`, Admins start as `pending` (locked out of login).
- **Authentication**: JWT access tokens and secure, hashed Refresh Tokens with family rotation + reuse detection.
- **Security**: Rate Limiters (max 10 req / 15min) attached explicitly to `routes/auth.js`. Passwords hashed with `bcrypt`.

### Phase 2: Company Verification
- **Company Model & Lookup**: Country-aware lookups (UK via Companies House, Global via OpenCorporates).
- **Strict Verification**: Domain/Email matching via `psl` (Public Suffix List), DNS MX record checks, and email OTPs.
- **Fallback**: Secure Document Upload endpoints acting as an OCR fallback target.

## Setup Requirements

Create a `.env` based on `.env.example` adding/confirming the following parameters:
- `MONGO_URI`
- `JWT_SECRET`
- `REFRESH_TOKEN_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- `COMPANIES_HOUSE_API_KEY`
- `OPENCORPORATES_TOKEN`
- `ALLOWED_ORIGINS`

## Installation
\`\`\`bash
npm install # note you may need --legacy-peer-deps
\`\`\`

## Tests
\`\`\`bash
npm test tests/auth.test.js
npm test tests/company.apply.test.js
\`\`\`

The 12 combined backend tests cover rate limit hooks, rotation logic, domain checks, and external API mappings logic securely mocked.
