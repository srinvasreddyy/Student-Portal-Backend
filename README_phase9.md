# Phase 9: Security Hardening & Production Readiness

## Overview
This phase hardens the Node.js Express backend according to OWASP Top 10 recommendations and modern security practices. It transitions the application state from standard development to production readiness.

## Core Features Implemented

### 1. HTTP Hardening (Helmet)
Included `middleware/securityHeaders.js` to inject standard protections:
- **HSTS** enforces HTTPS.
- **Content-Security-Policy** blocks inline scripts and unexpected external domains.
- Removes `X-Powered-By` signatures.
- **X-Frame-Options** guards against Clickjacking.

### 2. Rate Limiting & DoS Protection
Defined in `middleware/globalRateLimiter.js`:
- **Global Limiter**: 100 requests / 15 mins (Standard APIs).
- **Strict Limiter**: 5 requests / 15 mins (Authentication endpoints).

### 3. Account Protection (Brute Force)
`middleware/bruteForceProtector.js` works in tandem with the strict limiter. It maintains a dictionary locking accounts outright out if there are 5 successive failed login attempts. Locks last for 15 minutes. Note: for multitenant horizontal scaling, this module should be wired to a Redis backend.

### 4. Input Validation & NoSQL Mitigations
- **`middleware/mongoSanitizer.js`**: Replaces `$` and `.` in requests to neutrally defang NoSQL injections.
- **`middleware/requestSanitizer.js`**: Enforces strict payload schemas automatically stripping undocumented fields utilizing `Zod`.

### 5. Secure File Uploads
Enhanced `fileUpload.js` middleware dynamically imports `file-type` to read the magic bytes of incoming file streams to ensure the MIME types exactly match our configuration, bypassing headers which can be spoofed by attackers.

### 6. Authentication Lifecycle (JWT)
Transitioned from infinite length access tokens to:
- 15 minute Stateless Access JWTs.
- Opaque (Hashed) 7-day Refresh Tokens stored durably in the database.
- Refresh Token **Reuse Detection**: Reusing rotated refresh tokens triggers a warning and aggressively revokes *all* active sessions for the user to safeguard their account.

### 7. Structured Logging
Introduced `utils/logger.js`. Outputs JSON formatted logs suitable for APMs (Datadog/Elastic). Includes deep PII masking ensuring sensitive flags (passwords, emails, tokens) are heavily asterisked. 
Additionally, `utils/auditTrailEnhancer.js` guarantees standardized context is captured for `AuditLog` entries.

### 8. Liveness & Readiness Probes
Added standard K8s-styled checks:
- `GET /healthz` (200 OK)
- `GET /ready` (Dynamically checks MongoDB Driver connection state)

## Required Environment Setup

For this phase to start successfully, `utils/envValidator.js` guarantees these variables exist. Failure causes the Node process to exit gracefully preventing boot logic bypass.

```env
PORT=5000
NODE_ENV=production
MONGO_URI=mongodb://localhost:27017/student_platform
JWT_SECRET=super_secret_minimum_32_chars_length_hash!
```

## Running Tests
Security testing suites have been modularized in the `/tests` folder. Ensure you let Supertest emulate IP requests dynamically. 

```bash
npm run test tests/security.auth.test.js
npm run test tests/security.rateLimit.test.js
npm run test tests/security.rbac.test.js
```
