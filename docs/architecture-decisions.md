# Architecture decisions

## ADR-001 — One Worker, same-origin application

**Decision:** Use the Cloudflare Vite plugin to produce one Worker deployment containing the Hono API
and React static assets. `/api/*` runs the Worker first; unmatched application navigation uses the
SPA fallback.

**Reason:** This matches the requested platform, removes CORS and separate-session complexity, and
lets Access protect one hostname.

## ADR-002 — D1 SQL migrations and prepared repositories

**Decision:** SQL in `migrations/` is canonical. Application queries use native D1 prepared
statements, with repository/domain modules for reusable logic.

**Reason:** The data model and reports are clearer in SQL than behind a heavy ORM. Every user value
is bound, never interpolated. Dynamic SQL fragments are limited to server-owned constants.

## ADR-003 — Access identity plus D1 authorization

**Decision:** Production validates `Cf-Access-Jwt-Assertion` using jose and Access remote JWKS, then
resolves provisioned membership and permissions from D1. No application login cookie exists.

**Reason:** Passing Access is authentication, not company authorization. A verified email is bound
once to its Access subject; later subject mismatch fails closed.

## ADR-004 — Timer consistency without additional Cloudflare products

**Decision:** Enforce one timer with a partial unique D1 index. A D1 batch stops the previous timer
and creates the new timer at one server timestamp. Idempotency responses are stored in D1.

**Reason:** D1 is sufficient for version one. Durable Objects, KV, Queues and other infrastructure
were explicitly out of scope.

## ADR-005 — Financial history as snapshots

**Decision:** Billable entries snapshot resolved rate, currency and source using entry → project →
client → workspace inheritance.

**Reason:** Client-ready reports must not change when a later rate changes.

## ADR-006 — Pure JavaScript PDF generation

**Decision:** Generate PDFs with pdf-lib and embedded standard fonts in the Worker.

**Reason:** It is deterministic, Workers-compatible and requires no Browser Rendering, Chromium, R2
or external document service. The initial Latin text assumption is recorded separately.

## ADR-007 — Open-source calendar

**Decision:** Use FullCalendar’s open-source core, time-grid and interaction packages.

**Reason:** It provides accessible week/day rendering, selection, drag and resize without a paid
scheduler dependency.

## ADR-008 — Current Worker test integration syntax

**Decision:** Use Vitest 4.1 with `@cloudflare/vitest-plugin`'s `cloudflareTest()` plugin and workerd-backed D1
migrations. Run React component tests in a separate jsdom Vitest configuration.

**Reason:** Custom jsdom environments are not supported inside the Workers integration, while both
runtime-accurate server tests and React Testing Library coverage are required.

## ADR-009 — Compact dark tracking workspace

**Decision:** Use a compact dark application shell with a persistent functional timer, searchable
in-context project and tag selectors, dense time rows, and shared Time/Calendar view navigation.
Willow green provides structure, light green provides primary timer emphasis, and frosted mint
provides selected and informational states.

**Reason:** These interaction patterns reduce the distance between starting, categorizing, and
correcting time while preserving an original IOMechs identity. The implementation does not reuse
another product's branding, assets, proprietary wording, or pixel-level interface.
