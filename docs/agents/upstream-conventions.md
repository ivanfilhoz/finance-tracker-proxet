# Original project conventions

Preserved from commit `275a04a81c1fee990a1b37f4769c3c2c58a9c026`. Paths below are relative to the repository root. The original `todo.md` reference is absent from this checkout; inspect `project.inlang/settings.json`, `messages/en.json` and the actual package scripts for i18n configuration.

## PNPM

This repo is using `pnpm` for dependency control. Do not use `npm` for any commands. Use `pnpm install`, `pnpm run`, etc.

## Self-verification steps

After every piece of work, make sure to do a round of self-verification and fixing to keep the codebase in a good shape. **Running `pnpm run check` is required** — it runs all available checks together (typecheck, lint, unit tests, and E2E tests).

Individual commands are still available if you need them:

- For Typescript type-checks, use `pnpm run typecheck` which uses Typescript Native Preview.
- For Linting, use `pnpm run lint`
- For unit tests, run `pnpm run test`
- For E2E tests, run `pnpm run test:e2e`

## Documentation reference

### Tanstack Start

- Tanstack Start documentation can be found here: https://github.com/TanStack/router/tree/main/docs/start/framework/react
- Use this command to get the list of documentation files: `curl -s "https://api.github.com/repos/TanStack/router/contents/docs/start/framework/react/guide" | jq -r '.[].name'`
- Use links like `https://raw.githubusercontent.com/TanStack/router/main/docs/start/framework/react/overview.md` to get the raw markdown contents of the documentation.
- ALWAYS consult documentation when working with Tanstack Start.
- When need to access server data from the routes components, ALWAYS use correct Tanstack Start conventions of server functions - `https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/server-functions.md`. You need to avoid leaking server-side bundle files into the client bundle, otherwise hydration will fail.

**Server function rule (CRITICAL):** Route components in `src/routes/` may ONLY import server functions — they must NEVER directly import from `#/db`, `#/server/session`, or any server-only modules. This prevents server bundle leakage into the client bundle, which breaks hydration.

**Server function organization (TanStack Start recommended pattern):**

Per [TanStack Start docs](https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/server-functions.md#file-organization), split server logic into two file types:

- **`*.functions.ts`** — Export `createServerFn` wrappers. Safe to import from anywhere, including client components. The build process replaces handler bodies with RPC stubs in the client bundle.
- **`*.server.ts`** — Server-only helpers (DB queries, business logic, aggregation). Only imported inside `.functions.ts` handlers. Never imported from route components or client code.

This split keeps the server boundary intact (routes only import `.functions.ts`) while making the server logic directly testable in unit tests — import from `*.server.ts`, use the in-memory DB, and test the full SQL → response pipeline.

### Using TanStack Query with server functions

Always use **TanStack Query** (`@tanstack/react-query`) in route components to call server functions. This provides caching, background refetching, mutation handling, and automatic invalidation. See `src/routes/_authed/categories.tsx` and `src/server/categories.functions.ts` for a complete reference pattern.

**Pattern:**

1. **Define server functions** in `src/server/*.functions.ts` using `createServerFn` with `inputValidator` for schema validation.
2. **In route components**, wrap each server function with `useServerFn` to get a callable version:
   ```ts
   const getCategoriesFn = useServerFn(getCategories);
   ```
3. **For data fetching**, use `useQuery` with the wrapped server function as the query function:
   ```ts
   const CATEGORIES_QUERY_KEY = ["categories"] as const;

   const { data: categories = [], isLoading } = useQuery({
     queryKey: CATEGORIES_QUERY_KEY,
     queryFn: () => getCategoriesFn(),
   });
   ```
4. **For mutations** (create/update/delete), use `useMutation` with `inputValidator`-validated server functions:
   ```ts
   const createMutation = useMutation({
     mutationFn: (data: { name: string; parentId: string | null; color: string }) =>
       createCategoryFn({ data }),
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
     },
   });
   ```
5. **Always invalidate** the relevant query keys after successful mutations to keep the cache fresh.
6. **Define query keys** as `const` tuples at the module level (e.g., `const CATEGORIES_QUERY_KEY = ["categories"] as const`) so they can be shared between `useQuery` and `invalidateQueries`.
7. **Handle errors** from mutations by checking for `{ error }` in the result, since server functions return `{ success, data }` or `{ error }`.

### Writing E2E tests

**Every user-facing feature MUST have end-to-end Playwright tests.** Do not skip E2E tests for any feature that involves user interaction, data mutations, or UI state changes.
Use your e2e writing skill.

- Write E2E tests under `tests/e2e/` using the Playwright test framework.
- Cover the **happy path** for all CRUD operations and key user flows.
- Cover **error paths**: validation errors, empty states, permission denials, and server-side error handling.
- Cover **edge cases**: empty lists, loading states, concurrent mutations, and stale data scenarios.
- Use `await expect()` assertions to verify UI elements, form inputs, buttons, and page state changes.
- Use `page.getByRole()` and `page.getByLabel()` for accessible selectors — avoid CSS selectors or text-based locators unless necessary.
- Tests run in parallel, so each test must use unique entities (unique names, emails, IDs) to avoid interference. Never share state between tests.
- Playwright automatically manages the dev server lifecycle — do not start or stop the server manually.
- When adding a new feature, write E2E tests **before** or **alongside** the implementation, not after. This ensures test coverage is not an afterthought.
- Reference existing E2E tests in `tests/e2e/` for patterns and conventions.

### Playwright Test

- Playwright test documentation can be found here: `curl -s "https://api.github.com/repos/microsoft/playwright/contents/docs/src" | jq -r '.[].name' | grep 'test-'`

### Drizzle (orm)

- https://orm.drizzle.team/

### Playwright CLI

Use playwright-cli to open the browser at localhost:3000 after starting the dev server for manual testing of the features or working dev server.
`playwright-cli --help` to learn how to use it.

### Internationalization (i18n) with Paraglide JS

This project uses [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs), a build-time i18n library for Vite. **All user-facing text in the UI MUST use Paraglide messages — never hardcode English strings.**

**Import:**
```ts
import { m } from "#/paraglide/messages";
```

**Usage:**
```ts
m.nav_dashboard();                          // simple message
m.current_locale({ locale: "en" });         // message with parameters
```

**Adding new messages:** Add keys to `messages/en.json`, then run `pnpm run i18n:compile` to regenerate `src/paraglide/`.

**Reference:** See `todo.md` for the full migration guide and Paraglide usage examples.

---
