# Hourlark dependency and Cloudflare review

Reviewed on 2026-10-04 against the local working tree, npm registry metadata, and
official platform documentation. This is a code/configuration review, not a
production-account audit or measured load test. Existing local product changes
were preserved. Recommendations below are proposals unless marked implemented.

## Recommendation

Keep one Cloudflare Worker serving the React application and Hono API, one D1
database, and Cloudflare Access for this internal company app while the seat
economics fit. Keep the existing prepared SQL, timer uniqueness constraint,
same-origin requests, and in-process PDF generation. These choices avoid servers,
database connection pools, containers, and separate frontend/backend deployments.

Cloudflare-specific hosting is a sensible trade for lower operational effort.
Keep the data exportable and the domain logic portable; a multi-cloud abstraction
layer would add maintenance before it provides a benefit.

## Dependency upgrade

Direct dependencies are pinned to exact versions. The upgrade updates available
compatible releases, including React/React DOM 19.3.0, Hono 4.13.13, Zod 4.6.5,
Vite 8.3.2, the Cloudflare Vite plugin 1.62.5, and Wrangler 4.147.0.
In total, 31 direct dependency entries are updated or replaced. Vitest moves to
4.1.11. The lockfile also updates transitive `brace-expansion` to 5.0.12 to resolve
three reported development-tool advisories without an override.

The Worker compatibility date moves to 2026-10-01, matching the runtime shipped
with the pinned Cloudflare tools, and Wrangler regenerates the binding/runtime
types. Node support now matches the new jsdom release: 22.22.2+, 24.15.0+, or 26+
on those supported release lines. Set a supported Node release in Workers Builds.

Cloudflare's test integration moves from `@cloudflare/vitest-pool-workers` to
`@cloudflare/vitest-plugin` 1.3.6, updating the config import, migration type
import, and TypeScript test types. Cloudflare documents this as a package rename
with the same configuration API. See the [official migration
guide](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-to-vitest-plugin/).

Deliberate compatibility holds:

- **Vitest 4:** the current Cloudflare plugin's published peer dependencies require
  `^4.1.0`; the latest Vitest 5 is outside that range.
- **TypeScript 6:** the upgraded `typescript-eslint` requires TypeScript
  `>=4.8.4 <6.1.0`. TypeScript 7 is outside the supported range. See
  [typescript-eslint support](https://typescript-eslint.io/users/dependency-versions/).

Subsequent dependency refreshes:

- FullCalendar migrated to React 7.1.0 with the Temporal 1.0.5 peer and explicit
  classic theme CSS. The custom v6 timezone provider and eight unnecessary direct
  dependency declarations were removed. jsdom moved to 30.1.2. See
  [dependency-audit.md](dependency-audit.md) for the current audit.
- pnpm is 12.9.1. Non-auth settings live in `pnpm-workspace.yaml`, with builds
  allowed only for esbuild and workerd. Five previously reviewed exact-version
  release-age exceptions remain, including transitive Workers types. The requested
  jsdom 30.1.2 patch and its required data-urls 8.0.0 dependency add two
  exact-version exceptions because they were published on the audit date. Other
  versions keep the default 24-hour age gate.

The deployment script now invokes `pnpm run build`, including the existing
`.dev.vars` artifact sanitization. Previously it invoked `vite build` directly
and bypassed that step.

## Historical validation of the initial upgrade

- `pnpm validate` passes formatting, lint, strict TypeScript, 27 Worker tests,
  six component tests, and the production build.
- All three Playwright browser tests pass against a fresh dev server and a
  disposable, migrated and seeded D1 database. The developer's existing database
  and running timer were preserved. The permanent test configuration now provides
  the isolation described below and removes its temporary state after shutdown.
- `pnpm audit --json` reports zero known vulnerabilities after the lockfile
  refresh, and `git diff --check` passes.
- The sanitized build leaves no `dist/hourlark/.dev.vars` artifact.

At that initial validation, FullCalendar 6 emitted React `flushSync` lifecycle
warnings during passing development browser checks. The current calendar refresh
no longer emits that warning; the large frontend chunk remains a limitation;
the tests establish the covered flows, not full visual or production acceptance.
Restart any dev server that was already running before replacing dependencies.
No production resources, remote migrations, commits, or deployments were made.

## Architecture priorities

### 1. Prevent incomplete financial reports

**Implemented locally.** The shared report loader fetches a 5,001st sentinel entry
and returns HTTP 422 `report_too_large` if the matching dataset exceeds 5,000 rows.
Summary, detail, CSV, and PDF all use this guard. Filters and permission scoping
apply before the sentinel; exactly 5,000 entries remain supported. Regression
tests check each route, boundary totals/CSV, deleted entries, and narrower filters.
The separate 2,000-line PDF limit remains in force.

SQL pagination or chunked processing is still a proposal for broader periods;
it must preserve clipping, per-entry rounding, currency separation, permissions,
and running-entry semantics.

### 2. Make member changes safe under concurrent requests

**Implemented locally.** Migration `0003_member_update_guards.sql` adds a checked
assertion table. The member batch checks `changes()` immediately after its
conditional update, aborting the transaction before any dependent writes if the
version no longer matches or the target disappeared. Successful batches remove
the assertion row. A trigger protects the final active admin during the database
mutation, replacing the count-before-write check.

Regression tests force stale reads and competing admin changes, including two
requests with identical timestamps. They verify the winner's member fields,
assignments, running timer, and audit are preserved; unrelated SQL failures roll
back and retain their normal error classification. Apply the migration before
serving the updated API. The migration was applied to the local development
database, with all ten business tables unchanged and the running timer preserved.
No remote migration or deployment was performed.

### 3. Reduce report read amplification

The detailed-report endpoint reloads and transforms the entire capped dataset,
sorts in JavaScript, and slices a page on every request. The reports UI also loads
the summary in detailed mode. Implement SQL pagination with a stable ID tie-breaker
and avoid fetching a summary the current view does not need.

Measure D1 `rows_read`, CPU, and query plans with realistic history before adding
indexes. D1 bills scanned rows rather than just returned rows; indexes also add
write/storage work. Existing indexes cover several member/project/client filters,
so indiscriminately adding indexes is not the first step. See [D1 pricing and
metrics](https://developers.cloudflare.com/d1/platform/pricing/).
**Proposed, not implemented.**

### 4. Tune polling without adding another service

`src/web/features/timer/global-timer.tsx` polls every 30 seconds while the app is
visible, including when no timer is running. That is about 960 timer requests per
eight-hour visible session. For 25 people over 22 workdays, that alone is about
528,000 requests/month; multiple visible tabs multiply it. TanStack Query's normal
background-tab behavior and immediate mutation/focus refreshes should be retained.

Use a longer idle interval and refresh immediately after mutations/focus. If
cross-device realtime becomes a requirement, evaluate WebSockets then. Stored
timestamps plus a local elapsed-time display already make the timer persistent.
**Proposed, not implemented.**

### 5. Establish retention and recovery

Idempotency response bodies currently have no cleanup policy. Define a documented
retry window before deleting any records, then add an indexed, bounded cleanup
job to the same Worker's scheduled handler if growth warrants it. Keep immutable
audit history under a separate retention decision.

Exercise full SQL export and restore in a separate database. Report CSV is not a
complete backup: it omits membership, assignments, settings, and audit history.
D1 Time Travel retains seven days on Free and 30 days on Paid; the maximum size of
one paid database is 10 GB. See [D1 limits and
recovery](https://developers.cloudflare.com/d1/platform/limits/).
**Proposed, not implemented.**

### 6. Separate browser-test state from everyday development

**Implemented locally.** Playwright starts a fresh migrated/seeded temporary D1
database and a strict server on port 5186 through the normal Cloudflare/React/
Tailwind plugins. It never reuses another server or the developer's database on
port 5173. Graceful shutdown removes the test state. Generated browser artifacts
are excluded from lint. See [testing instructions](testing.md).

The main frontend chunk still exceeds Vite's 500 kB warning threshold (about
720 kB uncompressed). The calendar is imported eagerly through the Time route;
lazy loading it is a separate frontend improvement. Direct asset serving remains
free, so this primarily improves load experience rather than the Cloudflare bill.

## Current Cloudflare features worth considering

| Feature                                   | Decision for Hourlark                                   | Reason and source                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Workers Vitest plugin             | Adopted in dependency upgrade                           | Maintained test integration with workerd/D1; [migration guide](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-to-vitest-plugin/).                                                                                                                                                                                          |
| Workers Builds                            | Adopt when connecting the repository for deployment     | Native Git-connected builds avoid maintaining a separate deployment service. Free includes 3,000 build minutes/month; Paid 6,000, then $0.005/minute. Keep explicit migration sequencing and validation scripts; [Builds pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).                                                            |
| Native Workers Logs and traces            | Keep, with deliberate volume and retention              | Already enabled. Use request IDs and structured error logs; avoid duplicating every row/request into extra log records. Sampling can also omit errors, so choose it intentionally; [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).                                                                                            |
| D1 Sessions and read replication          | Defer until geographically distributed reads justify it | Existing `DB.prepare()` calls use the primary. Sessions/bookmarks are necessary to use replicas with sequential consistency; sensitive role/timer reads need deliberate freshness. Replicas have no separate replica charge, but row usage remains billable. Still labeled beta; [D1 replication](https://developers.cloudflare.com/d1/best-practices/read-replication/). |
| Smart Placement                           | Benchmark before enabling                               | Potentially useful if database round trips dominate. Avoid inventing an external-cloud region hint for a D1-only app. Still labeled beta; [placement](https://developers.cloudflare.com/workers/configuration/placement/).                                                                                                                                                |
| Automatic resource provisioning           | Optional for initial setup                              | Wrangler can provision missing resources, but an explicit production D1 ID makes migration targeting clearer. It does not configure Access policy, a custom domain, secrets, or a safe migration rollout for you; [automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning).                                     |
| Queues / Workflows / Durable Objects / R2 | Add only for a concrete feature                         | Reliable large asynchronous exports, multi-step approvals, realtime coordination, or retained files could justify them later. They do not improve the current basic timer merely by existing.                                                                                                                                                                             |

Static assets are already routed directly while `/api/*` runs the Worker first.
Retain this: direct asset requests/storage are free, while Worker invocations are
metered. Access must cover the entire app hostname. See [asset
billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

## Cost expectations

Prices below were checked on 2026-10-04. They are public list pricing, not a quote
for the user's account. Domains, taxes, existing account usage, and optional
services are excluded.

Workers Paid starts at **$5/month**, including 10 million dynamic requests and
30 million CPU milliseconds/month. Excess is $0.30/million requests and
$0.02/million CPU milliseconds. Free has a 10 ms CPU limit per request, so measure
PDF generation rather than assuming every export fits Free. See [Workers
pricing](https://developers.cloudflare.com/workers/platform/pricing/).

D1 on that paid account includes 25 billion rows read/month, 50 million rows
written/month, and 5 GB of storage. Excess is $0.001/million reads,
$1/million writes, and $0.75/GB-month. No separate always-running database charge
or D1 egress charge applies. See [D1
pricing](https://developers.cloudflare.com/d1/platform/pricing/).

**Access is the seat-cost cliff.** The free plan has a 50-user limit. Public paid
pricing is $7/user/month, advertised with annual payment. Budget purchased paid
seats rather than treating the first 50 as a permanent free allowance. For
example, 51 paid seats at that list rate are $357/month equivalent. Check the
account's existing Zero Trust subscription and checkout billing terms before
purchasing. See [Access
pricing](https://www.cloudflare.com/sase/products/access/) and the [seat/billing
FAQ](https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/).

An illustrative small-company budget:

| Assumed monthly usage                                                                                                                                           | Expected incremental platform cost                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 25 users within Access Free; 1M API requests averaging 10 ms CPU; 10M D1 rows read; 100k rows written; 0.5 GB storage; 400 build minutes; 2M compact log events | About $5/month on Workers Paid, assuming no other account usage consumes allowances. |
| Same infrastructure with 51 purchased Access seats at $7/user                                                                                                   | About $362/month equivalent, subject to billing terms.                               |

These are scenarios, not measured Hourlark usage. Index write amplification,
authenticated request queries, exports, extra tabs, and other applications sharing
the account can change usage. The first scenario remains below the published
compute/database/build/current-log allowances.

Workers Logs currently includes 20M events/month on Paid with seven-day retention.
Cloudflare has announced a change effective **2026-12-01** to shared Observability
pricing: 50 GB ingestion and 12 GB-month storage included on Paid, then
$0.25/GB ingestion and $0.10/GB-month storage. Review retention/volume at that
transition rather than treating today's event-based allowance as permanent. See
[current Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
and [announced Observability pricing](https://developers.cloudflare.com/observability/pricing/).

## Vendor dependence

For this product, lower operational effort is likely worth the deployment
dependence: there is no VM patching, container cluster, database connection pool,
or independently hosted frontend to maintain. Cloudflare-only deployment does not
eliminate application maintenance, SQL migration/recovery work, or access-policy
administration.

React, Hono, pdf-lib, standard HTTP APIs, pure billing/date/report functions, and
most SQLite SQL provide an exit path. Cloudflare-specific pieces are D1 bindings
and session behavior, Access JWT/policies, workerd tests, and deployment/recovery
commands. Keep authentication localized to its existing middleware, consolidate
database queries into existing repositories when editing those areas, and retain
tested full SQL exports. Do not introduce a generic cloud-provider framework now.

If the team grows beyond the Access free limit and does not already buy Zero
Trust seats, reassess authentication separately from hosting. A Worker can use
the company's existing identity provider through standard OIDC while remaining
deployed on Cloudflare; that requires its own secure login/session design and
validation. It is a proposed alternative, not an implemented auth switch.

## Next implementation order

1. Report overflow, member-update concurrency, and browser-state isolation are
   implemented locally; apply the guard migration before serving the updated API.
2. Configure the actual D1 ID, hostname, Access policy/audience, and secret.
3. Run validation and browser checks; connect Workers Builds with explicit
   migration sequencing and an isolated staging database.
4. Exercise backup/restore, then measure CPU/D1 rows/log volume under realistic use.
5. Tune idle polling and report pagination from measurements.
6. Adopt replicas, placement, or background services only when a measured need
   justifies them.

The checked-in production configuration still contains D1/Access placeholders.
This review does not deploy, create resources, run remote migrations, or establish
production readiness.
