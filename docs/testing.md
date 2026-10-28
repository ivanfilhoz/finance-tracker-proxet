# Local setup and testing

Use Node.js 22+ and pnpm 10.33.0 (pinned in `package.json`).

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
AI_FAKE=1 corepack pnpm run dev --strictPort
```

Open http://127.0.0.1:3000 and create your own local account at `/setup` on a fresh database. PGlite persists under `data/pg`; no external database or AI credentials are needed. See `.env.example` for optional integrations.

## Required check

Stop the development server on port 3000 before running:

```sh
CI=1 PLAYWRIGHT_HTML_OPEN=never corepack pnpm run check
```

This runs typecheck, lint, Vitest and Playwright. Playwright builds and starts its own production server on port 3000 using TEST_MODE, in-memory PGlite, fake AI and captured email. It must not reuse the development server or persistent database. Tests create isolated users; setup tests run first, then Chromium tests run in parallel. Restart development with the earlier command afterward.

## Coverage

- Domain and concurrency: `tests/budgets-server.test.ts`.
- Category ownership: `tests/category-budget-ownership.test.ts`.
- Provider deadlines: `tests/email-timeout.test.ts`.
- UI, plans, compliance and accessibility: `tests/e2e/budgets.spec.ts`.
- Alerts, imports, recategorization and rollover: `tests/e2e/budget-alerts.spec.ts`.
- Existing-operation regressions and cross-user cache isolation: `tests/e2e/budget-integrations.spec.ts`.

The authenticated POST handlers `/test-budget-clock` and `/test-budget-sweep` work only in TEST_MODE and affect only the current fixture user. They return 404 in normal development/production. Test fixtures are not development demo accounts.

Latest full verification: **212 unit tests across 26 files and 165 E2E tests passed**, with typecheck and lint passing. See the [submission review](reviews/2026-10-28-submission-review.md) for scope and limitations.
