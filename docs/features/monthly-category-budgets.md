# Requested change: monthly category budgets

Status: **implemented; see the implementation plan for validation evidence**. The unchanged [TASK.md](../../TASK.md) is the source of requirements. See the [received architecture](../architecture/overview.md) and [implementation plan](../plans/2026-10-28-monthly-category-budgets.md).

## Outcome and scope

Users set recurring monthly spending limits by category, track consumption and receive an email when spending exceeds the limit. The existing Free and Pro plans determine the number of budgets available.

Reuse existing billing and email infrastructure. A new checkout, payment integration, AI provider, FX conversion or production deployment is not requested.

## Acceptance criteria

The B1–B10 identifiers below are local traceability labels for the assignment.

| ID | Requirement | Expected evidence |
| --- | --- | --- |
| B1 | Budgets page in main navigation | Authenticated page accessible from the sidebar. |
| B2 | Create a category budget, edit its limit and delete it | Persistent CRUD, server validation and refreshed UI. |
| B3 | Display limit, current-month spending, remaining amount and exceeded state | Consistent money values; text as well as color communicates excess. |
| B4 | Parent categories include subcategory spending | Descendant aggregation, including multiple levels. |
| B5 | Only expenses count | Negative amounts contribute their absolute value; income/refunds do not reduce spending. |
| B6 | Budgets reset monthly | Separate monthly spending windows without prior-month carryover. |
| B7 | Email on exceeding, at most once per budget/month | Persistent deduplication across repetition and concurrency. |
| B8 | Free allows three budgets; Pro is unlimited | Server-enforced limits using existing entitlements. |
| B9 | Preserve existing functionality | Full regression suite and checks of affected integrations. |
| B10 | Treat budgets like other personal data | User isolation, export and deletion of new records. |

## Implementation

Add budgets and persistent notification identities to the Drizzle schema, with a generated migration. Store positive bounded integer minor-unit limits. Preserve each recurring budget across months and calculate spending within `[monthStart, nextMonthStart)`, rather than clearing counters with a cron job. Remaining equals limit minus spending; exceeded means spending strictly greater than the limit.

Aggregate negative transactions for the user's category and descendants with cycle protection. Each transaction contributes once within a budget. Parent and child budgets may independently include the same transaction. Do not add receipt-item amounts on top of transaction totals.

Use `src/server/budgets.functions.ts` for authenticated RPC wrappers and Zod validation, `budgets.server.ts` for testable domain logic, and `src/routes/_authed/budgets.tsx` for the Query/useServerFn UI. Add sidebar navigation and Paraglide messages. Generate routes/translations using project tooling. Enforce ownership of both category and budget on the server; never trust a client-supplied user ID.

Extend shared billing entitlements with maxBudgets (Free 3, Pro unlimited). Serialize count-and-create operations per user; an unlocked count followed by insertion can exceed the cap under concurrency. Preserve existing budgets on downgrade while blocking creation at or above the Free limit. Link upgrade guidance to existing billing.

Reconcile alerts after committed changes, including manual transactions, imports (including partially committed batches), recategorization, receipt-created transactions, category hierarchy changes, account currency changes, and budget creation/limit changes. Account deletion currently blocks accounts with transactions; preserve that behavior. GET handlers do not send alerts. A background sweep runs at startup and every minute while the server is running, catching future-dated expenses when they enter the current month without requiring a new edit. It follows the existing in-process maintenance lifecycle: the first application request arms it; it is not an external durable scheduler.

A unique budget/month notification claim prevents competing application attempts, but the database and email provider are not atomic. The plan adopts at most one application send attempt per budget/month and does not automatically release ambiguous failed claims. This favors avoiding duplicate messages and can miss delivery after a crash. Do not claim exactly-once delivery or reuse the compliance timer as an assumed durable queue.

Include budgets and notification metadata in user export and dependency-ordered deletion. Category subtree deletion must remove linked budgets without dangling references. Avoid financial details and email bodies in logs. This integrates with existing data treatment; it is not a new legal compliance claim.

## Product choices not specified by the assignment

These implemented defaults resolve unspecified behavior; they are not additional evaluator requirements:

- One budget per user/category. Store explicit currency and count only matching account currencies; no silent mixing or FX conversion.
- Use UTC calendar months with an injectable clock. Interview timezone is not a product requirement.
- Use the transaction's own category; item-level receipt allocation is outside the initial interpretation.
- Delete budgets attached to deleted categories instead of silently moving limits with reassigned transactions.
- Send only to verified email addresses; do not mark missing-recipient alerts delivered. Reconcile after verification.
- Recalculate current-month spending after retrospective changes, without sending past-month alerts. Re-crossing a threshold does not create a second notification identity in the same month.

## Validation

E2E tests live in `tests/e2e/` and are configured by `playwright.config.ts`. The [plan's acceptance matrix](../plans/2026-10-28-monthly-category-budgets.md#8-validate-against-acceptance-criteria) maps every criterion to browser and server evidence. Browser specs are `budgets.spec.ts`, `budget-alerts.spec.ts` and `budget-integrations.spec.ts`, with additions to existing compliance and financial-flow tests.

Use in-memory DB tests for ownership, deep hierarchy, expense signs, exact thresholds, currency filtering, month/year boundaries, concurrent plan limits, notification claims and failure behavior. Browser tests cover persistent CRUD, navigation, errors, totals, parent categories, monthly filtering, Free/Pro gating, captured email and data export/deletion. Use isolated fixtures and accessible selectors; do not share mutable users between parallel specs.

Run `corepack pnpm run check`, then inspect rendered behavior including keyboard use and mobile width. Record baseline failures separately. Actual results are recorded in the implementation plan; requirement descriptions alone are not functional evidence.

Final implementation and UX review validation: typecheck, lint, 212 unit tests and 165 E2E tests passed. Connected Chrome also verified persistent Free/Pro accounts, PLN/USD isolation, all five usage states and responsive controls. See the plan for exact scope, accessibility checks and remaining operational limitations.
