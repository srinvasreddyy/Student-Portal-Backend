# Phase 4: SuperAdmin Review Workflows

This concludes Phase 4 for the MERN core backend. The system introduces full auditing, immutable action records, and reliable Ethereal-backed Email Queuing for managing the Company and University Review lifecycles safely.

## Features Added

### 1. Centralized Immutable `AuditLog`
Instead of arbitrarily embedding Audit Logs into the Company or University arrays natively (which bloats Mongoose documents to their 16MB cap over time), the logs have successfully been extracted to their own collection (`AuditLog`).
- Mongoose populate/refs are used to loosely couple it backward. 
- Fast `actorEmail` querying powers SuperAdmin compliance auditing.

### 2. Idempotent Retry Mailer 
Native Nodemailer lacks background processing out of the gate. 
- **`EmailSendAttempt` Model**: Creates a locking queue utilizing `sendKey` sparse unique indexing to instantly catch race conditions and dual-send errors from impatient Admins. 
- **Backoff Algorithm**: The mailer auto-backs off exponentially on transient SMTP 4xx/5xx network hangs, and gracefully stores failures if they exceed 5 retries. 
- Automatically creates Ethereal SMTP accounts for seamless local dev testing.

### 3. SuperAdmin Endpoints
- Filtered Lists: `GET /admin/applications?type=company&status=pending`
- Decisions: `POST /admin/applications/:id/approve` (or `/hold`, `/reject`) 
    - Auto-sends Email directly to `companyEmail` or `representative.email`. 
- Overrides: `POST /admin/applications/:id/resend-decision`
- Memos: `POST /admin/applications/:id/notes` (creates an Admin note attached to the log) 

## Setup Requirements

Create/verify your `.env` contains the usual parameters, but note:
**If `SMTP_USER` is empty and `NODE_ENV=development`**, the system will dynamically reach out to Ethereal and dump a URL into the console logs where you can visually inspect the Approve/Reject Emails without using a real inbox.

## Migration Notes

> [!NOTE] 
> We swapped embedded `auditLogs: [auditLogSchema]` natively defined in Phases 2 and 3 out for centralized references `auditLogs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AuditLog' }]` across both Entity models. 

If adding Redis/Bull MQ later to unblock the Express Event Loop on mass actions, you simply intercept `services/mailer.js -> sendWithRetry(job)` and pipe it to a `bull.add()` call, letting the worker consume the exact same logic.

## Running & Testing

**Run Tests (Phase 4 specifically):**
Mongoose models seamlessly hook up with JWT mocking to authenticate SuperAdmin logic and queue up 10 complex endpoint workflows. 

\`\`\`bash
npm test tests/admin.approve.test.js
npm test tests/admin.audit.test.js
\`\`\`
