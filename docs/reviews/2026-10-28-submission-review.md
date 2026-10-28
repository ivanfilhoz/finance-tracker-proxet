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

A separate Grok CLI 1.0.62 read-only review was launched against a source snapshot excluding secrets, local databases and recruiting context. Its result is pending and is not represented as approval.
