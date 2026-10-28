# Monthly category budgets: implementation plan

Status: **implemented and verified locally**. Source: [TASK.md](../../TASK.md). Requirements and scope: [monthly-category-budgets.md](../features/monthly-category-budgets.md). Baseline architecture: [architecture.md](../architecture/overview.md).

## Outcome

Deliver an authenticated Budgets page where users manage recurring monthly limits by category, see current spending and remaining amounts, and receive at most one over-budget email per budget per month. Free allows three budgets; Pro is unlimited. Integrate with existing subscriptions, financial mutations, data export and account deletion. No new payment integration is required.

## Baseline and test infrastructure

- Received commit: `275a04a81c1fee990a1b37f4769c3c2c58a9c026`.
- Node 22+, pnpm 10.33.0. Use Corepack to resolve the pinned pnpm version.
- **E2E tests live in `tests/e2e/`; configuration is `playwright.config.ts`.** These are required acceptance evidence, not optional follow-up work.
- `tests/e2e/fixtures.ts` provides `signedInUser` and `unauthUser`; it creates isolated users, default categories/rules and a Main account. Use unique entity names per user/test.
- `tests/e2e/categories.spec.ts` and `transactions-crud.spec.ts` are CRUD references; `billing.spec.ts` shows plan gating; `compliance.spec.ts` shows exports, deletion and polling captured email.
- `/test-set-plan` changes the authenticated test user's plan; `/test-emails?to=...` reads captured mail. Both require `TEST_MODE=1`. Do not use these routes in the persistent dev database.
- Playwright runs a production build through `pnpm run preview`, with an in-memory PGlite DB, fake AI and captured email. Its setup project runs before parallel Chromium tests. It owns the test server; do not manually start or stop that server.
- Baseline typecheck/lint and 199 unit tests passed. The initial baseline E2E attempt was **not verified**: its first test could not launch missing Chromium headless shell build 1217; 149 tests did not run. Install with `corepack pnpm exec playwright install chromium` before evaluating acceptance.

## Implemented domain decisions

These defaults resolve behavior unspecified by the assignment. They are implementation decisions, not additional evaluator requirements.

| Topic | Planned default |
| --- | --- |
| Budget identity | One recurring budget per user/category; parent and child budgets may coexist. |
| Money | Positive integer minor-unit limit, bounded by PostgreSQL integer range. Reuse `src/lib/money.ts`; never calculate totals with decimal floats. |
| Currency | Store an explicit ISO currency on each budget; default from the user's accounts and require a choice when ambiguous. Count only accounts in that currency; display it clearly. No FX conversion. Changing currency recalculates spending without creating a new notification identity. |
| Month | Use an explicit UTC calendar-month helper and an injectable clock. Transaction DATE values use `[monthStart, nextMonthStart)`. The interview timezone is not the product timezone. |
| Recurrence | Preserve the configured limit across months; reset the spending window, not the budget record or transaction history. No carryover. |
| Spending source | Use each transaction's own category and negative `amount_minor`. Do not add receipt-item amounts on top. Receipt-created transactions count normally. Item-level budget allocation is outside this initial interpretation. |
| Hierarchy | Include all descendants, not just immediate children; scope the tree to the user and guard against cycles. Each transaction is counted once within a budget. |
| Threshold | Equal to the limit is not exceeded. Remaining amount may be negative and the UI must show the overage explicitly. |
| Downgrade | Keep existing budgets editable/removable; block new creation while the user has three or more. Do not delete user data on downgrade. |
| Category deletion | Delete budgets attached to deleted categories, with their notification records. Reassignment of transactions does not silently transfer budget limits. |
| Retrospective changes | Re-evaluate the current month after changes; do not send historical-month alerts. Lowering a limit or creating a budget over existing spending can trigger an alert. |
| Missing/unverified email | Do not send or mark delivered. Re-evaluate after email verification. UI explains that alerts require a verified address.  |
| Repeated threshold crossing | Once claimed for the month, dropping below and exceeding again must not create a second alert. |

## Implementation sequence

### 1. Establish the baseline and acceptance tests

- [x] Install the matching Playwright Chromium browser.
- [x] Coordinate port 3000: the requested dev server currently uses it. Release that dev process before E2E, let Playwright manage its own server, then restore dev afterward. Never use `reuseExistingServer` against the persistent database.
- [x] Run the full E2E suite and document existing issues exposed by regression testing. A separate pristine-checkout E2E run was not performed.
- [x] Add `tests/e2e/budgets.spec.ts` and `tests/e2e/budget-alerts.spec.ts` alongside the feature, starting with failing scenarios from the matrix below.
- [x] Add `tests/budgets-server.test.ts` (domain and alert cases) and `tests/category-budget-ownership.test.ts` using the node environment and in-memory DB patterns in `tests/analytics-server.test.ts`.

### 2. Add persistent budgets and notification identity

- [x] Add `budgets` in `src/db/schema.ts`: id, user_id, category_id, currency, limit_minor, created_at, updated_at. Add foreign keys, positive-limit check, unique user/category and an index for user lookup.
- [x] Add `budget_notifications`: budget_id, user_id, period_start (DATE), state, attempted_at, sent_at. Enforce unique `(budget_id, period_start)` and valid month-start semantics.
- [x] Generate the next Drizzle migration with `corepack pnpm run db:generate`; inspect SQL, journal and snapshot. Do not edit an already-applied migration.
- [x] Verify migration application against fresh PGlite and migration compatibility with the existing schema.

### 3. Implement the server domain and authorization

- [x] Add `src/server/budgets.server.ts` for CRUD, category-descendant resolution, spending aggregation and monthly results; keep DB/clock dependencies testable.
- [x] Add client-safe validation/types in `src/lib/budgets.ts` as needed. Validate category ownership, currency, positive bounded integers and stable error codes.
- [x] Add `src/server/budgets.functions.ts` wrappers: list, create, update limit/settings and delete. Derive user identity from `requireUserId`; never accept client user_id as authority.
- [x] All reads/writes and category checks include user ownership in the database predicate. Foreign IDs must behave like missing IDs.
- [x] Enforce ownership directly in budget query predicates; no shared registry extension is needed.
- [x] Extend `getEntitlements` with `maxBudgets` (Free 3, Pro null), then the billing status contract/UI as needed.
- [x] Serialize budget creation per user in a DB transaction, e.g. lock the existing user row before entitlement/count/insert. Use the same lock order in every create path. Catch uniqueness conflicts as validation errors; a count-then-insert without synchronization is insufficient.

### 4. Implement the page and cache behavior

- [x] Add `src/routes/_authed/budgets.tsx`, a sidebar entry and Paraglide message keys.
- [x] Reuse existing dialogs, inputs, confirmation UI and money helpers. Include loading, empty, error and limit-reached states.
- [x] Show category, currency, monthly limit, spending, remaining/overage and clear exceeded status. Display month boundaries consistently.
- [x] Use `useServerFn`, `useQuery` and `useMutation`; UI routes import only `.functions.ts` wrappers and client-safe types.
- [x] Use stable query keys including authenticated user ID and relevant month identity. Recompute on page focus/month change and invalidate after related mutations; do not leave a tab open across midnight displaying the old month indefinitely.
- [x] Link the upgrade explanation to existing `/billing`; do not promise a working checkout when billing is unconfigured.
- [x] Verify keyboard dialogs, error associations and mobile layout manually.

### 5. Detect excess and send one alert

- [x] Add `src/server/budget-alerts.server.ts` with a current-month evaluator, using the same aggregation as the page.
- [x] Claim the unique notification identity atomically only when the budget is exceeded and a verified recipient exists. Only the successful claimant calls `sendEmail`.
- [x] Use localized text and the existing email provider abstraction. No new transport or private iCloud credentials in the application.
- [x] Record sent/failed state. **Delivery tradeoff:** the initial implementation makes at most one application send attempt per budget/month. Do not automatically release the claim after an ambiguous failure; the provider may already have accepted it. This favors no duplicates but can miss a delivery after a crash/failure. Document this limit rather than claim exactly-once delivery. Durable retries with provider idempotency require a separate, explicit design.
- [x] Notification failure must not roll back a successfully persisted financial mutation. Await/catch the evaluation so errors are recorded without leaking financial contents into logs; do not create untracked background promises.
- [x] Email generation occurs after mutations, never as a side effect of GET/list.

### 6. Cover every mutation that changes the result

Re-evaluate once per affected user after successful writes; avoid one full evaluation per imported row.

| Existing code | Implemented hook |
| --- | --- |
| `transactions.functions.ts` | After create/update/delete, including date, category, account and amount changes. |
| `imports.functions.ts` | After successfully persisted batches; use finally-style reconciliation if a partial import can commit rows before failing. |
| `categorization.functions.ts` | After applying a rule or re-categorizing existing transactions. |
| `receipts.functions.ts` | After a new linked transaction is created; avoid a duplicate evaluation when only receipt metadata changes. |
| `categories.functions.ts` | After reparenting or deletion/reassignment; remove budgets/notification references before deleting categories. |
| `accounts.functions.ts` | After account currency changes when currency-based aggregation is used. Preserve the existing block on deleting accounts with transactions. |
| New budget mutations | After create or change to limit/currency. Deletion removes alert records. |
| `auth.functions.ts` | After successful email verification, evaluate current-month budgets that previously lacked an eligible recipient. |

Invalidate budget queries in the corresponding UI mutations, or use a shared invalidation helper. Server-side correctness must not depend on that client invalidation.

### 7. Integrate export and deletion

- [x] Include budgets and notification metadata in `collectUserExport` and `buildExportZip`, with JSON and appropriate CSV output.
- [x] Extend account hard deletion in dependency order inside the existing DB transaction.
- [x] Verify deletion of a category subtree cannot leave budgets pointing to missing categories.
- [x] Keep notification metadata user-scoped; never export another user's records.

### 8. Validate against acceptance criteria

| AC | E2E evidence (new/existing files) | Additional server/unit evidence |
| --- | --- | --- |
| B1 navigation | `budgets.spec.ts`: sidebar link opens authenticated page; anonymous visitor is redirected. | Wrapper rejects unauthenticated access. |
| B2 CRUD | Create category budget, reload, edit, reload, remove, reload; reject invalid limit and duplicate category. | Ownership, input bounds and uniqueness. |
| B3 totals/excess | Add known transactions; assert exact limit/spent/remaining; equal threshold then exceed by one minor unit. | Integer arithmetic, currency filtering and empty totals. |
| B4 descendants | Parent → child → grandchild; verify parent total includes all relevant expenses once. | Deep trees, cycle protection and user-scoped reads/writes. |
| B5 expenses only | Add expense, income and refund; verify only expense increases spent. | Mixed signs and zero-boundary behavior. |
| B6 monthly reset | Create current- and previous-month expenses through UI and verify only current-month amounts; reload preserves the recurring limit. | Injected clock covers month/year/leap-day boundaries. A per-user TEST_MODE server clock also verifies monthly reset and a new email in E2E; browser clock alone cannot control server time. |
| B7 email | `budget-alerts.spec.ts`: exceed via mutation; poll `/test-emails?to=...`; verify recipient/content and one alert after repeated updates, reloads, refunds and re-crossing. | Concurrent claims, failed sends, missing/unverified recipient and next-month alert. Partial import reconciliation is guarded by finally; failure injection after a partially committed batch was not separately tested. E2E also covers import/recategorization paths, not just manual creation. |
| B8 plans | `budgets.spec.ts`: Free creates three and rejects fourth; `/test-set-plan` enables fourth on Pro; downgrade preserves records and blocks new creation. | Concurrent fourth-budget attempts and effective subscription states. |
| B9 regression | Existing `tests/e2e/` suite, plus modified transaction/import/category flows. | Full typecheck, lint and unit suite. |
| B10 user data | `budgets.spec.ts`: exported ZIP contains only the user's budgets and notification metadata; deletion removes them. | Cross-user IDs cannot read/write; cleanup has no dangling foreign keys. |

Use role/label locators and `await expect`; wait on actual UI or email state, not arbitrary sleeps. Polling the first email once is not proof of deduplication: trigger all repeated mutations, await their completion, then assert the final filtered count. Never share users or mutable fixtures between parallel tests.

### 9. Completion and evidence

- [x] `corepack pnpm run check` passes, including all E2E tests, or every remaining failure is explicitly explained with evidence.
- [x] Restore the persistent local dev server, verify database/migration readiness, and visually inspect the E2E desktop/mobile renders.
- [x] README documents proposed domain choices, the email-delivery tradeoff and reproduction steps without secrets.
- [x] Preserve agent session/configuration for the interview; exclude private preparation data and local demo credentials from publication.
- [x] Record actual changes and validation outcomes in this plan; do not mark checklist items complete merely because their design is written.

## Files expected to change

Schema/migration; new budget domain, server functions and alert service; Budgets route; sidebar and messages; billing entitlement/status surface; financial mutation integration points above; compliance export/deletion; budget unit/E2E tests and existing regression specs as needed. Implementation now includes the files above. The original checklist records the planned work; see the [submission review](../reviews/2026-10-28-submission-review.md) for evidence and deviations.


## Delivery evidence

See [submission review](../reviews/2026-10-28-submission-review.md) for the consolidated validation result, UX findings, regression fixes and remaining limits. Historical preparation logs and agent session history are retained locally for the interview.
