# Phase 5: Project & Student Application Lifecycle

This completes Phase 5, introducing the heavily concurrent **Project Posting and Student Application Workflow**.

## Core Features Delivered
1. **Model `Project.js`**:
    - Defines author relation (`authorRef` + `authorType` enum).
    - Hard caps `durationWeeks` (max 4) and `maxStudents`.
    - Virtual fields for `isFilled` and `availableSlots`.
2. **Atomic Student Accpetance (Concurrency Safe)**:
    - Utilizes MongoDB Sessions & Transactions `session.withTransaction()`.
    - Handles "double-book" race conditions gracefully via optimistic concurrency handling.
    - Resolves network flakiness automatically via `TransientTransactionError` exponential backoff retries.
3. **Application State Machine constraints**:
    - Enforced rule: **One Active Project Per Student**.
    - If accepted into Project A, pending applications to Projects B & C are atomically wiped from the database.
4. **Owner Mark Complete**:
    - Moves Project to student's "portfolio".
    - Wipes their `activeProjectRef` allowing them to participate in the next project cleanly.

## Database & Indexing Decisions
- `authorModel` exists explicitly alongside `authorRef` ensuring Mongoose `refPath` capability between University vs Company polymorphism.
- Extracted heavy write operations out of the Controller into generic `projectService.js` to ensure the raw mongoose `Connection.startSession()` behaves deterministically without HTTP layer side-effects.

## Environment Flags Required (No changes)
Ensure your Mongo setup supports Transactions (Must be Replica Set or Atlas. Transactions **DO NOT WORK** natively on standalone local-only mongod default installations out of the box).
To test concurrency natively locally, configure `mongod --replSet rs0` and run `rs.initiate()`.

## Testing the Concurrency
Use `jest` to trigger concurrent dual-accept payloads against the service simultaneously.
\`\`\`bash
npm run test tests/project.create.test.js
npm run test tests/project.apply.test.js
npm run test tests/project.accept.concurrency.test.js
\`\`\`
