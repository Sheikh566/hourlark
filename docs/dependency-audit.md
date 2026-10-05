# Hourlark dependency audit

Checked 2026-10-04 against npm `latest` metadata for all 51 original direct
packages, with published peer dependencies checked for compatibility. Direct
dependencies stay exact-pinned. The manifest now has 45 direct packages after retaining the remote Inter font addition. This records the refresh after the
earlier Cloudflare/tooling upgrade; it does not replace that review's historical
validation numbers.

## Registry-checked upgrades

| Package               | From   | To     | Notes                                                                   |
| --------------------- | ------ | ------ | ----------------------------------------------------------------------- |
| `@fullcalendar/react` | 6.1.21 | 7.1.0  | Latest stable. Supplies types, interaction, and time-grid entry points. |
| `jsdom`               | 30.1.1 | 30.1.2 | Latest stable test-environment patch; same supported Node versions.     |
| `temporal-polyfill`   | (new)  | 1.0.5  | Required peer `^1.0.1`. Latest stable.                                  |

All other already-declared direct packages were already at their latest
compatible stable releases.

## Removals (unused after import, config, script, and types checks)

| Package                         | Evidence                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@fullcalendar/core`            | No remaining app imports. v7 React package is no longer a core peer.                                              |
| `@fullcalendar/interaction`     | Migrated to `@fullcalendar/react/interaction`.                                                                    |
| `@fullcalendar/timegrid`        | Migrated to `@fullcalendar/react/timegrid`.                                                                       |
| `@radix-ui/react-dropdown-menu` | No imports, config, or type references.                                                                           |
| `@radix-ui/react-select`        | No imports, config, or type references.                                                                           |
| `@radix-ui/react-tabs`          | No imports, config, or type references.                                                                           |
| `clsx`                          | No imports. Radix dialog and `tailwind-merge` remain in use.                                                      |
| `@cloudflare/workers-types`     | `tsconfig.json` types `./worker-configuration.d.ts` from `wrangler types`. No other type/config/script reference. |

## Retained compatibility constraints

- **TypeScript 6.0.3**, not 7.0.2: `typescript-eslint` 8.71.0 peers
  `>=4.8.4 <6.1.0`.
- **Vitest 4.1.11**, not 5.0.3: `@cloudflare/vitest-plugin` 1.3.6 peers
  `^4.1.0`.
- **pnpm 12.9.1**, Node `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`, exact pins,
  `strictPeerDependencies`, build allowlist limited to `esbuild` and
  `workerd`. Remaining `minimumReleaseAgeExclude` entries are reviewed
  lockfile versions (`@cloudflare/workers-types@5.20261004.1` still present
  transitively, `hono@4.13.13`, `lucide-react@1.52.0`, `tr46@7.0.0`,
  `whatwg-url@17.2.0`). The requested latest jsdom patch was published on
  2026-10-04; `jsdom@30.1.2` and its required `data-urls@8.0.0` dependency are added
  as exact-version exceptions.
  Other versions retain pnpm's default 24-hour release-age gate.

Used tooling kept: `@axe-core/playwright`, Cloudflare Vite/Vitest plugins,
Playwright, Tailwind, ESLint/Prettier, Wrangler, and the listed type
packages.

## Calendar migration

FullCalendar 7 uses React entry points for plugins and types, explicit classic
theme CSS, and the required Temporal peer. Named timezones are built in, so the
custom v6 timezone provider and its implementation-specific tests are removed.
Public callbacks still expose `Date` instants; the app keeps native ISO conversion
and its existing `date-fns-tz` formatting and midnight-boundary utilities.

Stable event/render callbacks avoid unnecessary calendar updates. Existing browser
coverage still checks selection, editing, drag/resize persistence, rollback, and
member timezone rendering when the browser uses a different timezone. Running
entries retain their non-editable calendar setting and mutation guard. Existing
domain/component tests retain DST coverage.

Registry evidence: [FullCalendar React](https://registry.npmjs.org/@fullcalendar%2Freact/latest),
[jsdom](https://registry.npmjs.org/jsdom/latest),
[typescript-eslint peers](https://registry.npmjs.org/typescript-eslint/latest),
[Cloudflare Vitest plugin peers](https://registry.npmjs.org/@cloudflare%2Fvitest-plugin/latest).
See the [FullCalendar JavaScript migration](https://fullcalendar.io/docs/upgrading-from-v6-js)
and [CSS migration](https://fullcalendar.io/docs/upgrading-from-v6-css).

## Independent validation

- `pnpm install --frozen-lockfile` succeeds with the refreshed lockfile.
- `pnpm validate` passes formatting, lint, types, 41 Worker tests, 85 component
  tests, and the production build. The existing large-client-chunk warning remains.
- All 17 Playwright workflows pass with retries disabled against fresh disposable
  D1 state; a standalone repeat also exits successfully.
- Manual UI checks confirm week/day layouts, project colors, selection/create/edit,
  and an editor without horizontal overflow at phone width.
- `pnpm peers check` reports no peer conflicts; `pnpm audit --json` reports no
  known vulnerabilities. `pnpm outdated --format json` lists only the documented
  TypeScript and Vitest compatibility holds.
- No production resources, remote database changes, commits, or pushes. Unrelated
  local files remain untouched.
