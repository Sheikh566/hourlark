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
- CSRF rejection.

## Component tests

`vitest.web.config.ts` runs React Testing Library in jsdom. This is separate because custom jsdom
environments are not supported by the Workers Vitest integration.

## End-to-end

```bash
pnpm exec playwright install chromium
pnpm db:setup
pnpm test:e2e
```

Playwright starts the actual Cloudflare Vite development runtime, authenticates through the explicit
development adapter and navigates the Time, Calendar and Reports surfaces in Chromium. Traces and
screenshots are retained on failure.
