# IOMechs Time

IOMechs Time is a single-company time tracker deployed as one Cloudflare Worker. The Worker serves
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

Requirements: Node.js 22 or newer and pnpm 10.33.2.

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:setup
pnpm dev
```

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
Follow [docs/deployment.md](docs/deployment.md), then run:

```bash
pnpm check:production
pnpm db:migrate:remote
pnpm deploy
```

Never commit `.dev.vars`. Set `CSRF_SECRET` with `wrangler secret put CSRF_SECRET`. Cloudflare Access
must cover the entire production hostname, not only `/api`.

## Documentation

- [Assumptions](docs/assumptions.md)
- [Architecture decisions](docs/architecture-decisions.md)
- [Security model](docs/security.md)
- [Deployment runbook](docs/deployment.md)
- [Operations and recovery](docs/operations.md)
- [API conventions and export contracts](docs/api-and-exports.md)
- [Testing](docs/testing.md)
- [Generated design reference](docs/design/iomechs-time-ui-reference.png)
