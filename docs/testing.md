# Testing

## Fast validation

```bash
pnpm validate
```

This runs:

1. Prettier check
2. ESLint
3. strict TypeScript
4. Worker/runtime Vitest suite
5. React Testing Library suite
6. Cloudflare/Vite production build

## Worker tests

`vitest.config.ts` uses Cloudflare’s current `cloudflareTest()` plugin. Tests execute in workerd and
receive a real isolated D1 binding. `tests/integration/setup.ts` applies the SQL migrations through
`applyD1Migrations`.

Coverage includes:

- the complete role/action matrix;
- half-open clipping, rounding, DST conversion and currency minor units;
- production rejection of development auth and incomplete Access configuration;
- CSV escaping and formula protection;
- D1 timer start/stop, server timestamps, one-running-timer invariant and idempotent retries;
- report overflow across summary/detail/CSV/PDF, exact 5,000-entry totals, and filter/role scoping;
- deterministic member-update interleavings, atomic timer/assignment/audit behavior, and final-admin protection;
- CSRF rejection.

Storage isolation is per test file. The report/member regression fixtures use
`cloudflare:test`'s `reset()` and reapply migrations before each test to prevent
earlier mutations from influencing later cases.

## Component tests

`vitest.web.config.ts` runs React Testing Library in jsdom. This is separate because custom jsdom
environments are not supported by the Workers Vitest integration.

## End-to-end

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Playwright creates a fresh temporary D1 state directory, applies every migration, seeds the development
identities and project, then starts the actual Cloudflare Vite runtime on `127.0.0.1:5186`. The test
runtime uses the same Cloudflare, React and Tailwind plugins as development, with an explicit isolated
`persistState.path`. It never reuses a server; an occupied test port fails instead of connecting to
another application. The developer's port `5173` server and `.wrangler/state` database are untouched.
The temporary test database is removed when the server shuts down. No `pnpm db:setup` is needed.

The suite authenticates through the development adapter configured in `.dev.vars` and navigates the
Time, Calendar and Reports surfaces in Chromium. Traces and screenshots are retained on failure.
