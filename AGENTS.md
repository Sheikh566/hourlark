# Repository Guidelines

## Project Structure & Module Organization

Hourlark replaces Toggl Track using React, Hono, and D1 in one Cloudflare Worker.

- `src/web/`: routes, reusable components, timer features, hooks, and styles.
- `src/worker/`: API routes, middleware, entry services, and CSV/PDF exports.
- `src/domain/`: billing, dates, reporting, and permission rules; keep these independent of UI/runtime code.
- `src/db/repositories/`: D1 queries. `migrations/` holds numbered SQL migrations; `seeds/` contains development data.
- `tests/`: unit, integration, component, and end-to-end suites.
- `public/`: static assets and security headers. `docs/`: architecture, operations, and Toggl parity requirements.

## Build, Test, and Development Commands

Use pnpm 12.9.1 and a supported Node release, such as Node 24.15.0+.

- `pnpm install --frozen-lockfile`: install locked dependencies.
- `pnpm db:setup`: migrate and seed a local development database.
- `pnpm dev`: start the Cloudflare/Vite development server.
- `pnpm build`: build production artifacts and remove bundled `.dev.vars`.
- `pnpm test`: run Worker and component tests.
- `pnpm test:e2e`: run Playwright with a disposable seeded D1 database.
- `pnpm validate`: check formatting, lint, types, tests, and build.
- `pnpm cf-typegen`: regenerate Worker types after binding changes.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, double quotes, semicolons, and
Prettier's 100-column width. `pnpm format` formats code; ESLint enforces typed rules and
React Hooks conventions. Prefer type-only imports and the `@/` source alias.
Use kebab-case filenames, PascalCase React components/types, and camelCase
functions/variables. Match existing snake_case database/API fields. Preserve
server-side authorization and integer currency calculations.

## Testing Guidelines

Vitest runs Worker tests in workerd with D1; React Testing Library uses jsdom.
Name tests `*.test.ts`/`*.test.tsx`; Playwright uses `*.spec.ts`. No percentage
coverage threshold is configured. Cover changed behavior, especially permissions,
timer retries, concurrency, report completeness, and timezone boundaries. Install
Chromium with `pnpm exec playwright install chromium`. Run validation and
relevant browser checks before submitting.

## Commit & Pull Request Guidelines

Follow history's concise prefixes: `feat:`, `fix:`, and `style:`. Keep commits
focused and preserve unrelated local edits. PRs should explain behavior changes,
validation results, related issues, and migration implications. Include screenshots
for UI changes and Toggl parity evidence where relevant.

## Security & Cloudflare Configuration

When interacting with Cloudflare, use the cf CLI unless the project has a Wrangler configuration file.

This repository has `wrangler.jsonc`; use Wrangler and project scripts. Keep secrets
in local `.dev.vars` or Wrangler secrets. Run `pnpm check:production` before
deployment; production requires configured D1 and Access settings. Back up D1
before destructive remote migrations.
