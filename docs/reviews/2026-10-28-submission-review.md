# Submission review — October 28, 2026

## Verified result

`CI=1 PLAYWRIGHT_HTML_OPEN=never corepack pnpm run check` exited 0 using Node 24.21.0 and pnpm 10.33.0: typecheck and lint passed, **212 unit tests in 26 files** and **165 Playwright E2E tests** passed without retries. The production E2E build applied migrations to fresh PGlite. A separate external PostgreSQL service was not exercised.

The received baseline had 199 passing unit tests. Its first E2E attempt could not start because the matching Chromium binary was missing; it was installed before evaluating the implementation. No separate pristine-checkout E2E run was performed. Vite/Vitest emitted non-fatal module-evaluation/shutdown diagnostics; the aggregate check still exited successfully.

## Regression findings and fixes

1. **Cross-user cached budgets.** QueryClient survives SPA logout/login. The original budget key included only the month, allowing the previous user's cards to appear while the next user's request was pending. The new E2E case failed before the fix (expected zero previous-user cards, received one). Keys now include authenticated user ID; the test deliberately holds the new response and verifies that no document reload occurred. It passes after the fix.
2. **Unbounded email-provider wait.** Budget reconciliation is awaited after financial changes. The existing Resend fetch had no timeout, so a stalled provider could leave a committed edit pending indefinitely. A ten-second abort deadline now covers each request and error-body read. Unit tests cover a stalled fetch and deadline cleanup after success. Existing failure tests verify that transactions persist and claims prevent duplicate attempts. Multiple newly exceeded budgets are still processed sequentially; this is not a global mutation deadline.
3. **Category ownership before deletion.** The extracted deletion helper checks ownership before traversing/cascading. Dedicated regression tests protect foreign IDs and linked budget records.
4. **Existing transaction date display.** SQL DATE values could shift back a day west of UTC. UTC date rendering fixes this; the transaction-list suite explicitly uses America/Bahia.
5. **Existing test synchronization.** The import-rule deletion test previously checked the list before its refetch completed. It now waits for the row count change.

Additional E2E coverage verifies transaction date/sign edits and deletion, account/budget currency changes, category deletion with reassignment, transaction preservation, notification deduplication and exported budget/alert records.

## UI and accessibility review

Connected Chrome verified local Free and Pro fixtures, with five Pro budgets persisted across reloads. PLN and USD walkthroughs verified currency isolation, decimal amounts and refunds not reducing spending. No Stripe purchase or external email was used.

- Dashboard remains first; Budgets follows Categories. Its icon matches the existing 24×24 custom SVG grid, 1.8px strokes and muted color.
- Shared Input/Select controls preserve application conventions. Currency uses the Accounts form's compact 80px monospace input. Malformed/over-precision amounts are rejected before parsing.
- Empty, partial, near, exact-limit and exceeded states use text and percentages alongside empty/teal/amber/red meters. Exactly 100% is not exceeded; overage remains visibly negative.
- Add is the page's primary action; Edit is secondary and Delete is quiet with a separate confirmation. Card actions have minimum 44px height; Cancel receives initial deletion focus.
- Automated light/dark axe scans cover budget content/header and dialogs with WCAG 2 A/AA and 2.1 AA tags. Keyboard focus/trapping/restoration, error associations and 390px mobile overflow checks passed. This is scoped evidence, not whole-application accessibility certification.

## Operational limits

- Live email transport was not exercised. Unique budget/month claims intentionally retain failed or ambiguous attempts, preventing duplicate attempts at the cost of possible missed delivery. There is no durable retry queue.
- The minute background sweep requires a running server and is armed by its first request. It catches future-dated spending at rollover without another user edit.
- External PostgreSQL, live billing and deployment were not tested.
- Raw review logs, screenshots, recruiting correspondence, local data and credentials are excluded from this repository. Agent configuration is committed; session history is retained locally for the interview.

## Independent review

A separate Grok CLI 1.0.62 read-only review was launched against a source snapshot excluding secrets, local databases and recruiting context. It reported no confirmed actionable defects in that snapshot. The reviewer did not run tests, and its reading stopped at a tool-turn limit; a continuation produced the final report. The snapshot preceded the separately reproduced user-cache fix and email deadline, so this is not an independent verification of those final changes. It noted existing receipt-sign semantics, category-deletion atomicity/cycle limitations and account-creation concurrency as baseline behavior, and confirmed the documented notification/sweep tradeoffs. Raw output remains local for the interview.

## GitHub CI environment

The first published CI run stopped before tests: `ubuntu-latest` selected Ubuntu 26.04, which pinned Playwright 1.59.1 does not support. CI now pins Ubuntu 24.04, supported by that installed Playwright version. The next remote run passed typecheck/lint/unit tests and 164 E2E tests, but exposed a category-edit test selector matching both the updated row and a closing-dialog option. That assertion now scopes to the category row; application code is unchanged. The corrected full local check passed again: typecheck, lint, 212 unit tests and 165 E2E tests, without retries. A follow-up push reruns GitHub CI; its result is not claimed here.

## Database-test timeout investigation

GitHub run 40749997623 failed two existing tests at Vitest's five-second per-test limit: migration/idempotency (5.758 s) and migrated-database readiness (5.207 s). No SQL assertion failed. Both files had passed on the preceding GitHub run, and the unchanged tests passed locally. The first database construction in each file included cold PGlite WASM initialization inside the timed test, under the default jsdom environment, with no client cleanup. This supports a setup-timing failure on the shared runner rather than evidence of incorrect migrations.

A local phase measurement found 604 ms for cold startup and 33 ms for migrations; the second fresh database took 450 ms and 35 ms respectively. These measurements describe the local machine, not GitHub's hardware.

The two test files now use Node, await a fresh database's `waitReady` in a bounded 30-second setup hook, and close each client afterward. Readiness tests also apply fixture migrations during setup; migration tests still execute `runMigrations` in their test bodies. All original assertions and the default five-second test deadline remain intact; no retries, skipped tests or global timeout increases were added. The pure connection-failure test does not initialize a database. See [Vitest hooks](https://vitest.dev/api/hooks.html) and [PGlite lifecycle](https://pglite.dev/docs/api).

The five focused tests passed. The existing Vite shutdown warning remained after explicit database cleanup, so this change does not claim to resolve that separate diagnostic. The full local `pnpm run check` passed afterward: typecheck, lint, 212 unit tests and 165 E2E tests, without retries. The exact committed change is being verified by GitHub CI.

Remote run 40751804681 confirmed the database fix: all 212 unit tests passed, including both previously timed-out files. E2E then exposed the same category-row/closing-dialog ambiguity at the creation assertion (`Edit Me`), before the already-corrected post-edit assertion. The category CRUD spec now scopes every remaining category-name list assertion to category rows and waits for the creation dialog to close before continuing. No application behavior changed. The complete local check passed again with 212 unit tests and 165 E2E tests, without retries; the follow-up commit reruns GitHub CI.
