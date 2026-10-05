# Hourlark

Hourlark is a single-company time tracker deployed as one Cloudflare Worker. The Worker serves
the React application and the same-origin `/api/v1` API, with Cloudflare D1 as the authoritative
database and Cloudflare Access as the production identity boundary.

The product includes:

- authoritative, idempotent start/stop timers with one running timer per member;
- day/week list editing, calendar creation/drag/resize, overlap warnings, duplicate, continue,
  soft-delete and undo;
- clients, projects, project assignments, tags, members, roles, lock policies and immutable audit
  history;
- summary and detailed reports with timezone-aware clipping, grouping, rounding, financial
  redaction and project budget progress;
- formula-safe UTF-8 CSV and a Workers-native, client-ready PDF time report;
- Member, Manager and Admin authorization enforced by a centralized server policy.

## Stack

TypeScript (strict), React, Vite, Cloudflare Vite plugin, Hono, Tailwind CSS, TanStack Query, React
Hook Form, Zod, FullCalendar, Recharts, pdf-lib, jose, date-fns/date-fns-tz, D1 prepared statements,
Vitest in workerd, React Testing Library and Playwright.

## Local development

Requirements: Node.js 22.22.2+, 24.15.0+, or 26+ and pnpm 12.9.1 (matching the
`packageManager` field). pnpm 12 is a native executable. If an existing pnpm 10
install cannot activate that pin, bootstrap the exact version from the npm
registry into a temporary prefix and use that binary:

```bash
npm install pnpm@12.9.1 --prefix /tmp/pnpm-12.9.1
export PATH="/tmp/pnpm-12.9.1/node_modules/.bin:$PATH"
pnpm --version
```

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm db:setup
pnpm dev
```

For an existing local installation, run `pnpm db:migrate:local` to apply the Hourlark workspace
rename. The migration preserves time entries, company settings, and customized workspace names.

Open `http://127.0.0.1:5173`. Development authentication is enabled only when both
`AUTH_MODE=dev` and `ENVIRONMENT=development`. The seed provides:

- `sheikh.abdullah@iomechs.com` — Admin
- `manager@iomechs.com` — Manager
- `member@iomechs.com` — Member

Use the user menu to switch between seeded roles. The `X-Dev-User-Email` header is ignored unless
development authentication is explicitly active. If the selected development member is
deactivated or otherwise cannot authenticate, the error screen provides a development-only account
recovery panel. Choose **Use default development account** to clear the browser override and return
to `DEV_DEFAULT_USER_EMAIL`, or select another seeded identity. This recovery UI is excluded from
production builds; production identity recovery remains the responsibility of Cloudflare Access
and an active application administrator.

## Validation

```bash
pnpm validate
pnpm test:e2e
```

`pnpm validate` checks formatting, ESLint, strict TypeScript, Worker/runtime tests, React component
tests, and the production build. Worker tests apply the canonical D1 migration in isolated workerd
storage.

## Production deployment

Production deployment is intentionally blocked while the D1 ID and Access values are placeholders.
Follow the [step-by-step Cloudflare deployment guide](docs/deployment.md) for a new account,
including Access, the first production secret, administrator setup, and verification.
For subsequent deployments with a configured account and an existing secret, run:

```bash
pnpm check:production
pnpm db:migrate:remote
pnpm deploy
```

Never commit `.dev.vars`. The deployment guide covers the initial `CSRF_SECRET` upload; rotate it
on an existing Worker with `pnpm exec wrangler secret put CSRF_SECRET`. Cloudflare Access must cover
the entire production hostname, not only `/api`.

## Documentation

- [Assumptions](docs/assumptions.md)
- [Architecture decisions](docs/architecture-decisions.md)
- [Security model](docs/security.md)
- [Deploy to your Cloudflare account](docs/deployment.md)
- [Operations and recovery](docs/operations.md)
- [API conventions and export contracts](docs/api-and-exports.md)
- [Testing](docs/testing.md)
- [Dependency and Cloudflare review](docs/cloudflare-review.md)
- [Toggl Track replacement scope](docs/toggl-parity.md)
- [UI reference](docs/design/hourlark-ui-reference.png)
