# LostLink — Antigravity Project Rulebook

## 1. Project identity and mission

- **Project name:** LostLink — Intelligent Campus Lost & Found.
- **Problem:** Campus lost/found information is scattered across messages, conversations and notices.
- **Goal:** Build a responsive, secure web application where students can report lost/found items, browse reports, discover possible matches, submit ownership claims and help return belongings.
- **Competition differentiators:** Explainable lost/found matching, trustworthy claim verification, verified contribution rewards, badges, leaderboard and useful campus analytics.
- **Primary audience:** Students, campus moderators/admins and eventually campus security staff.
- **Development context:** Student project; explain technical choices clearly and prefer maintainable solutions over unnecessary complexity.

## 2. Current stack and repository shape

The project currently uses:
- Frontend: React + Vite + JavaScript.
- Backend: Node.js + Express.
- Database: MongoDB Atlas + Mongoose.
- Authentication: bcryptjs password hashing and JSON Web Tokens.
- Styling: existing CSS files; preserve the current design language unless asked to redesign.

The repository folder is named `smart-campus`; the product name shown in the UI and documentation should be **LostLink** unless the user requests otherwise.

Expected structure (inspect the real repository before assuming every file exists):

```text
smart-campus/
├── AGENTS.md
├── client/
│   ├── src/
│   │   ├── components/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── index.css
│   │   └── main.jsx
│   ├── .env.local                 # local only; never commit
│   └── package.json
├── server/
│   ├── src/
│   │   ├── models/                # Item model and User model
│   │   ├── middleware/             # requireAuth and future role middleware
│   │   ├── routes/                # itemRoutes and authRoutes
│   │   └── server.js
│   ├── .env                       # local only; never commit
│   └── package.json
└── .gitignore
```

Actual filenames and import paths may differ. Check the file tree and the content before editing. Import path capitalization must match the real filename exactly (for example, `User.js` versus `user.js`) to remain portable across operating systems.

## 3. How to work in this codebase

1. **Inspect before editing.** Read the relevant files and package scripts first. Do not assume this rulebook reflects every current code change.
2. **Make focused changes.** Prefer a small, incremental diff over replacing an entire file. Never overwrite working components or APIs just to simplify your implementation.
3. **Preserve existing behavior.** Reports currently load from MongoDB and can be submitted through the website when authenticated. Keep these paths working while adding features.
4. **Avoid duplicate code.** Check for existing state, functions, imports, routes, schemas and CSS before adding new ones. Do not add duplicate `export default`, route handlers, imports or React state declarations.
5. **Follow dependency direction.** React calls Express APIs; only the server talks to MongoDB. Never connect to MongoDB from the browser.
6. **No surprise scope changes.** Do not redesign the application, change the stack, add a new library, rename many files, change API response shapes or introduce an architectural rewrite unless necessary and explained.
7. **For multi-file work:** state a brief plan, make the changes, run available checks, and report files changed, commands/tests run, results and remaining risks.
8. **Do not claim a test passed unless you ran it** or clearly say it was not run. If a test cannot run, explain why and give the exact manual test.
9. **User skill level:** provide beginner-friendly explanations and Windows PowerShell commands when the user needs to run steps manually. Do not ask the user to paste secrets into chat.
10. **When errors occur:** use the exact error output to diagnose; do not make speculative changes to unrelated files.

## 4. Non-negotiable security rules

- Never put MongoDB URIs, database passwords, JWT secrets, email/API keys or other credentials in frontend code, source control, logs, screenshots, sample responses or documentation.
- Keep secrets in local environment files. Maintain `.gitignore` coverage for `.env`, `.env.*`, `node_modules/` and build output. A safe `.env.example` may contain placeholders only.
- If a real secret is exposed, advise the user to rotate/revoke it. Removing it from the current file alone does not make a leaked secret safe again.
- Never store plain-text passwords. Hash passwords with the existing `bcryptjs` implementation and compare hashes during login. Never return password hashes in API responses.
- Never trust the client for identity, role, owner ID, points, claim outcome or item status. Derive the authenticated user from verified server-side authentication and enforce authorization on every protected API.
- Public registration must create a `student` account only. Never allow a request body to grant `admin` privileges. Admin creation/promotion must be a separately authorized process.
- Validate all IDs, fields, types, lengths and enums on the server. Treat all browser input as untrusted. Return useful status codes without leaking stack traces or secrets.
- Protected item updates/deletes must query by both the item ID and `reportedBy: req.user._id`; never authorize an operation based only on a client-provided ID.
- Only allow explicit editable fields. Do not allow public users to set `reportedBy`, `role`, moderation fields, reward totals, audit information or restricted statuses.
- `OPEN`-only edit/delete restrictions must be enforced server-side, not just by hiding buttons.
- Use least privilege for MongoDB application users. Do not use Atlas administrator credentials in the app. Keep network access restricted to needed sources.
- Never run destructive database operations, drop collections, mass-update old records, force dependency upgrades, or reset user data without explicit approval and a backup/rollback plan.
- Do not run `npm audit fix --force` automatically. Review findings and compatibility first.
- Do not log passwords, JWTs, authorization headers, full connection strings or private claim answers.
- Do not expose personal contact data or private ownership verification answers on public item cards, search results, leaderboard pages or logs.
- Similarity/matching scores are suggestions, not proof of ownership. Sensitive items require a private verification process and/or authorized staff review.
- Reward points must be awarded only by trusted server-side logic after a verified event. Prevent duplicate awards with unique event references or an equivalent idempotency check.
- Keep leaderboard fields minimal; use display names and provide an opt-out where practical.
- If moving from JSON-returned JWTs to cookies, changing token persistence, or making another material security design change, explain the trade-offs and avoid breaking existing clients without a migration plan.

## 5. Backend conventions

- Use the existing JavaScript module format (`import` / `export`) when configured in `server/package.json`.
- Keep route handlers small. Put shared validation, authentication and reusable business logic into appropriate middleware/services when it reduces duplication.
- Keep API paths under `/api`; current known routes include `/api/health`, `/api/items` and `/api/auth`.
- Preserve consistent JSON response patterns such as `{ success: true, ... }` and `{ success: false, message: "..." }` unless a documented change is needed.
- Use appropriate HTTP responses: `400` for invalid input, `401` for missing/invalid authentication, `403` for authenticated but forbidden actions (where appropriate), `404` for unavailable/unauthorized-to-disclose resources, `409` for conflicts, and `500` for unexpected server errors.
- Handle Mongoose validation errors and duplicate-key errors deliberately. Do not send raw stack traces to clients.
- Use Mongoose schemas for required fields, lengths, enums and timestamps; also validate request input in route/service logic.
- Avoid leaking whether a private resource exists if doing so creates an authorization risk. Keep response wording consistent where appropriate.
- Keep CORS limited to configured development/production origins. Do not use unrestricted origins with credentials.
- Configure JSON body size limits and request rate limiting when needed; do not accept arbitrarily large payloads.

## 6. Frontend conventions

- Use React function components and hooks, matching the current JSX style.
- Keep the UI responsive for mobile, tablet and desktop. Test the actual pages at multiple widths before calling responsive work complete.
- Preserve the existing LostLink visual system: consistent spacing, readable contrast, clear labels, understandable status badges and simple forms.
- Use controlled form inputs where the existing app does so. Provide loading, success, empty and error states for asynchronous operations.
- Disable submit buttons during pending requests and prevent accidental duplicate submissions.
- Render user-provided text as normal React text; do not use `dangerouslySetInnerHTML` for item descriptions.
- Include labels, keyboard-operable controls, visible focus styles and appropriate `role="status"` / `role="alert"` messages.
- Do not show Edit/Delete actions for other people's items. This is usability only: the backend must remain the actual security boundary.
- Do not store JWTs or other secrets in `localStorage` by default. The current implementation may hold a token in React state; document its refresh behavior. Do not silently change persistence/auth transport without assessing security and updating both client and server.
- Avoid unnecessary UI libraries. Prefer the current CSS unless a dependency is justified and approved.

## 7. Current domain model and workflow

### Item report

The current Item model includes fields along these lines: `title`, `description`, `category`, `type` (`LOST`/`FOUND`), `location`, `itemDate`, `status` (`OPEN`, `MATCHED`, `CLAIM_PENDING`, `RETURNED`, `CLOSED`), timestamps and `reportedBy` referencing a User. Inspect the real schema before changing it.

Known category values include `Electronics`, `Documents`, `Bags`, `Clothing`, `Accessories`, `Books`, `Keys` and `Other`. Keep frontend options and server-side enums aligned.

### User

The User model is intended to contain `name`, normalized unique `email`, `passwordHash`, `role` (`student` or `admin`) and timestamps. Never expose `passwordHash` in responses.

### Claims, matching and rewards (planned)

- Claims must have their own status and reviewer information; only authorized staff/admin may approve or reject them.
- A match connects a LOST item to a FOUND item. Avoid duplicate/reversed copies of the same match. Store score and human-readable reasons, and do not claim a match proves ownership.
- Reward transactions should be append-only or otherwise auditable. A verified event should not award points twice. Never accept an award amount from the client.
- Status transitions must be explicit and validated, not arbitrary status changes from clients.

### Legacy records

Some sample items were created before `reportedBy` was introduced. They may not appear in My Reports and may not be editable under ownership checks. Do not delete or mass-modify these records automatically. If a migration is useful, propose a safe migration and ask for approval first.

## 8. Product scope and planned phases

Use this roadmap as guidance, but verify actual repository state before claiming a phase is complete.

1. **Phase 1 — Foundation:** React/Vite, Express, Atlas connection, Item model, create/list APIs and item listing form. Reported working in local testing.
2. **Phase 2A — Authentication APIs:** User model, bcryptjs, JWT, registration, login, `/api/auth/me` and `requireAuth`. Implemented and manually tested during development; re-run tests after changes.
3. **Phase 2B — Login/Register UI:** AuthPanel and basic frontend integration. Implemented; verify it still works after every related edit.
4. **Phase 2C — Ownership and My Reports:** POST protected, `reportedBy` set from `req.user`, `/api/items/mine`, owner-scoped PATCH/DELETE. Backend routes were added/checked. **Latest known active task: finish wiring `myItems`, `showMyReports`, `fetchMyItems`/`loadMyReports`, `handleEdit`/`handleDelete`, list switching, and Edit/Delete controls in `client/src/App.jsx`, then test the whole flow.** Inspect current code to see which parts have already been completed.
5. **Phase 2D — Admin permissions:** admin authorization middleware, server-protected admin routes and safe admin provisioning.
6. **Phase 2E — Security validation:** unauthenticated/invalid-token/role/ownership/validation tests and dependency review.
7. **Phase 3 — Report management:** search, filters, pagination, status rules, report details and polish.
8. **Phase 4 — Claims and handover:** claim submission, private verification answers, review and confirmed return workflow.
9. **Phase 5 — Matching engine:** first explainable rule-based score using category, text, location and date; add better NLP/semantic methods only after reliable tests.
10. **Phase 6 — Rewards:** server-verified points, transaction history, badges and weekly/monthly/all-time leaderboard.
11. **Phase 7 — Admin/notifications/analytics:** report moderation, in-app notifications, audit log and database-backed analytics.
12. **Phase 8 — Hardening/testing:** input and upload validation, rate limiting, OWASP-oriented checks, accessibility and regression testing.
13. **Phase 9 — Delivery:** deployment, production environment variables, README, architecture diagram, screenshots, tests and presentation.

Do not start later-phase features while a current core flow is broken, unless the user explicitly reprioritizes it.

## 9. Required workflow for every coding task

1. Restate the task in one sentence and identify the files likely involved.
2. Inspect existing files and scripts; determine how the feature fits the architecture.
3. Identify security/data compatibility implications, especially for routes and schemas.
4. Implement the smallest complete change. Avoid unrelated refactors.
5. Run applicable checks: frontend build/lint and backend syntax/runtime or API tests when available. Use the commands defined in the actual `package.json`; do not invent script names.
6. Test both success and failure paths. For authorization, test missing token, invalid token and another user's resource.
7. Check browser console and backend terminal when UI/API integration changes.
8. Summarize: files changed, behavior added, tests run with their real outcomes, remaining limitations and next recommended step.
9. If blocked, report the exact error and one concrete next action. Do not claim completion when only code was written but not tested.

## 10. Acceptance criteria for important flows

### Registration/login
- Valid registration creates a student account; duplicate emails are rejected.
- Password is hashed; plaintext password and hash are never returned.
- Wrong credentials return a generic login failure.
- Valid token accesses `/api/auth/me`; missing, malformed or expired token is rejected.

### Reports
- Public listing returns only fields appropriate for public viewing.
- Creating a report requires authentication and derives `reportedBy` from the verified user.
- `/api/items/mine` returns only the current user's reports.
- User A cannot update or delete User B's report, even by manually crafting an API request.
- Only explicitly allowed report fields may be updated; owner and status fields are not client-editable.
- Old records without `reportedBy` are handled safely and are not silently assigned to a random user.

### Claims/matching/rewards
- A match never auto-approves a claim.
- Claims and handovers require the defined reviewer/verification process.
- Rewards are issued server-side once per verified event and can be audited.
- Public endpoints do not reveal private claim answers or contact data.

### Release readiness
- Frontend and backend both start using the repository's documented commands.
- Database connection and essential endpoints are confirmed working.
- No secrets are committed; environment setup is documented with placeholders.
- A new feature does not regress create/list/login/report ownership flows.

## 11. Git and change management

- Prefer small, descriptive commits after tests pass (for example, `feat(auth): protect item creation`).
- Do not commit secrets, build outputs or `node_modules`.
- Do not push, deploy, delete branches, rewrite Git history or create commits unless the user or task explicitly authorizes that action.
- Before schema or API breaking changes, explain the impact and provide a migration/rollback approach.
- Keep README and project status notes aligned with actual implementation.

## 12. Final rule

**Reliability and security come before feature count.** Keep working code working, implement authorization on the server, verify every important path, and be honest about what has and has not been tested. When uncertain about existing behavior, inspect the repository and ask before making destructive or wide-ranging changes.
