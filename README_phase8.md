# Phase 8: Notifications & Email Flows

This phase introduces a robust, centralized transactional email and in-app notification system designed for scalability, durability, and simplified developer testing.

## Features Implemented
- **Centralized Mailer Service:** Abstraction over Nodemailer allowing programmatic HTML template (Handlebars-style interpolation) injections.
- **Durable Email Queues:** Outbound emails are tracked in MongoDB (`EmailSendAttempt`). 
- **In-process Fail-safe Worker:** An interval-based background job (`emailJobProcessor`) reads queued items, executing sends with **Exponential Backoff & Jitter** for transient failures, capping at a maximum retry limit.
- **Ethereal Dev Mode:** When `SMTP_HOST` is absent, the system seamlessly generates a free Ethereal configuration, outputs test credentials, and prints URL preview links in stdout on every send.
- **In-App Notifications:** Full CRUD lifecycle endpoints under `/api/notifications` allowing users to retrieve and mark unread items.
- **Guaranteed Isolation Filters:** Super-admin-only routes to view holistic metrics, trace failed emails `/api/admin/email-sends`, and manually trigger a targeted retry.
- **Rate Limiting:** Safe boundary restrictions applied globally and per user/IP using in-memory rolling windows (`middleware/emailRateLimiter.js`). 
- **Pre-built Templates:** Responsive core onboarding workflows (Verifications, Sandbox approvals/denials, Student selections).

## Environment Variables
The following environment variables control production behaviors:

```env
# Optional. If missing, dev-mode Ethereal is created
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587 
SMTP_USER=apikey
SMTP_PASS=sg.token...
MAIL_FROM="Global Academy Platform <no-reply@yourdomain.com>"

# Rate Limiter Tunings
GLOBAL_EMAIL_RATE_LIMIT=1000
USER_EMAIL_RATE_LIMIT=10
```

## Running the Application Locally
All integrations run organically when `server.js` starts.

To run specific integration checks (which utilize mocked transports to ensure logic flows deterministically):
```bash
npm test tests/mailer.retry.test.js
npm test tests/notification.basic.test.js
```

## Migration & Scale Notes: Moving to BullMQ + Redis
The current **in-process durable queue** (MongoDB polling) is highly efficient for single-process deployments (Monoliths running on Heroku, single EC2, PM2 no-cluster).

However, during high-volume scale (kubernetes multi-pods), MongoDB polling can induce race conditions.

**How to Upgrade:**
1. Setup a Redis Cluster.
2. `npm install bullmq ioredis`
3. Modify `services/notificationService.js` to execute `jobQueue.add('sendEmail', { attemptId })` rather than simply saving the document.
4. Modify `jobs/emailJobProcessor.js` to utilize BullMQ's `new Worker()` pattern directly connected to Redis, listening for `sendEmail` instead of running `setInterval`. 
5. The logic encapsulated inside `mailerService._processSendAttempt()` remains entirely native and unbroken!

## Developer Sandbox Examples

### 1. View Notifications
```bash
# As authenticated user
curl -X GET "http://localhost:3000/api/notifications?unreadOnly=true" \
     -H "Authorization: Bearer <USER_JWT>"
```

### 2. Force Email Admin Send
```bash
# As super_admin
curl -X POST "http://localhost:3000/api/notifications" \
     -H "Authorization: Bearer <SUPER_ADMIN_JWT>" \
     -H "Content-Type: application/json" \
     -d '{
         "userRef": "64c9...",
         "title": "Welcome Email",
         "body": "System testing",
         "sendEmail": true,
         "templateName": "verify_email",
         "templatePayload": {
             "userName": "Jane",
             "verificationLink": "http://localhost:3000/verify?token=123"
         }
     }'
```
*Monitor your terminal (where `npm run dev` executed). You'll see a link like `Preview URL... https://ethereal.email/message/...` where you can view the rich HTML rendering output.*
