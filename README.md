# Finance Tracker — take-home task

A personal finance tracker built with TanStack Start, Drizzle (Postgres via
embedded PGlite), TanStack Query, Tailwind/shadcn UI and Paraglide i18n.

**Your task is in [TASK.md](TASK.md).**

## Getting started

Requirements: Node.js 22+ and pnpm 10 (`corepack enable` will pick up the
pinned version). Use `pnpm`, not `npm`.

```bash
pnpm install
pnpm exec playwright install chromium   # for E2E tests
pnpm run dev                            # http://127.0.0.1:3000
```

No `.env` is needed for local development: the database is an embedded
PGlite instance under `./data/pg`. See `.env.example` for optional settings
(set `AI_FAKE=1` if you don't want to configure an AI provider).

`pnpm run check` runs typecheck, lint, unit tests and E2E tests together.
The original project conventions are preserved in [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md).

## Documentation

- [Documentation index](docs/README.md): setup, testing, feature decisions and review evidence.
- [Architecture](docs/architecture/overview.md): inspected baseline and existing components.
- [Implementation plan](docs/plans/2026-10-28-monthly-category-budgets.md): sequence and AC-to-E2E coverage; tests live in `tests/e2e/`.
- [Monthly category budgets](docs/features/monthly-category-budgets.md): requirements, implemented behavior and validation coverage.

## How we'd like you to work

You're welcome — encouraged — to use AI coding agents. Treat the task as
you would a real feature in an unfamiliar codebase.

In the interview we'll ask you to:

- walk us through your workflow and your conversations with the agent(s);
- explain the design of your solution and how it fits the existing code;
- demo the feature running locally.

Please keep your agent session history and any agent configuration you
used so you can show them. Note that `.gitignore` excludes `.claude/`,
`.agents/`, `.mcp.json` etc. — remove those entries if you'd like to commit
your setup.


## Monthly category budgets

Open **Budgets** in the sidebar after creating an account and categories. Add one recurring budget per category, enter its three-letter currency code, and enter a positive monthly limit. Parent budgets include all descendants. Only negative transactions in matching-currency accounts count; income/refunds do not reduce spending, and receipt items are not counted a second time. The limit persists, while spending resets at each UTC calendar-month boundary. No carryover or FX conversion is performed.

Free permits three budgets; Pro is unlimited through the existing subscription entitlement system. A downgrade keeps existing budgets editable/removable and blocks additional creation until below the cap. Deleting a category also deletes its budgets; deleting a budget keeps transactions intact.

Verified email addresses receive alerts through the existing email provider. Alerts are evaluated after financial changes and budget edits, including CSV imports and recategorization. Each budget/month is claimed persistently before sending. Failed or ambiguous attempts retain the claim: this prevents duplicate attempts but can miss delivery after a transport failure or crash. There is no durable retry worker. Development uses the console provider, tests capture mail, and production can use the existing Resend configuration.

Budget records and alert metadata are included in data exports and account deletion. Source tests are in `tests/budgets-server.test.ts`, `tests/category-budget-ownership.test.ts`, `tests/e2e/budgets.spec.ts` `tests/e2e/budget-alerts.spec.ts`, `tests/e2e/budget-integrations.spec.ts` and `tests/email-timeout.test.ts`.

For verification, stop any development server occupying port 3000, then run `pnpm run check`. Playwright builds and owns its test server using in-memory PGlite and fake AI; it must never reuse the persistent dev server. The TEST_MODE-only `/test-budget-clock` endpoint controls only the authenticated fixture user's calendar during rollover tests and is unavailable in normal development/production. Run `AI_FAKE=1 pnpm run dev --strictPort` afterward to restore the local application.
