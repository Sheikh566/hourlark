# Assumptions

## Product and company

- The application is named **Hourlark**; its workspace name remains configurable.
- The primary goal is to replace the company's paid Toggl Track subscription for
  fewer than 30 people. Close Toggl UI and feature parity is a product requirement;
  the confirmed plan is Starter at $12/user/month. Calendar and Members are
  additional used features, not assigned priorities. See [replacement scope](toggl-parity.md).
- The application contains one visible workspace. The fixed workspace ID remains in the relational
  model to preserve a clean future boundary, but no workspace switcher or public tenant lifecycle is
  exposed.
- Company emails are normalized by trimming and lowercasing. The initial allowed domain is
  `iomechs.com`.
- No email invitation is sent. An administrator provisions an email and Cloudflare Access performs
  authentication.

## Time and money

- Stored timestamps are integer Unix milliseconds in UTC. Display, grouping and local form input use
  the member/report IANA timezone.
- Date-range APIs use half-open `[start, end)` intervals. Entries are included on overlap and report
  duration is clipped to the requested interval.
- Duration is derived from start and stop timestamps; no independent duration column exists.
- Rates and amounts use integer currency minor units. ISO currency fraction digits are obtained from
  `Intl.NumberFormat` (including zero-decimal and three-decimal currencies).
- Report rounding changes billable report duration and amount only. Raw time-entry timestamps remain
  untouched.
- A billable entry snapshots its effective rate, currency and rate source. Rate edits do not rewrite
  history unless an authorized user explicitly edits/recalculates an entry.

## Runtime

- The Cloudflare production hostname, D1 database ID, Access team domain and Access audience were not
  supplied. Checked placeholders remain in configuration and `pnpm check:production` blocks deploy.
- The compatibility date is `2026-10-01`, matching the workerd runtime shipped with the
  pinned Wrangler and Cloudflare Vitest plugin in the 2026-10-04 dependency refresh.
- Production secrets are configured through Wrangler, not source-controlled variables.
- English application copy and Latin PDF text cover the initial IOMechs operation. PDF text is
  normalized to the built-in font’s supported range; adding a bundled Unicode font is an isolated
  export-layer enhancement if non-Latin client data becomes a requirement.

## Policy

- Overlaps are valid and therefore warned about, not rejected.
- Entry locks are evaluated against the stop timestamp. Admin overrides require a reason recorded in
  the audit event.
- Deactivation stops a running timer at the same authoritative server timestamp and preserves all
  historical records.
- Historical clients, projects and tags are archived rather than permanently deleted.
