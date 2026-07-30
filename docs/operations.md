# Operations and recovery

## Daily checks

- `/api/v1/health` returns `status: ok` after Access authentication.
- Worker error rate and D1 latency remain within the company’s alert thresholds.
- No unexpected Admin role, Access binding reset or lock-override audit event exists.
- The running-timer list in Members is plausible before account deactivation or role maintenance.

## Member incidents

- **Changed Access identity subject:** verify the person and exact company email, then use Members →
  Reset binding. The action requires explicit email confirmation and is audited.
- **Deactivate a member:** the API atomically stops their timer, blocks future writes, and preserves
  history.
- **Final Admin:** the application prevents deactivation or demotion of the last active Admin.

## Timer conflicts

The client refreshes authoritative timer/list state after failed mutations. A repeated request with
the same `Idempotency-Key` and payload receives its original result; reusing the key for different
content is rejected.

## D1 backup and restore

Before material cleanup or recovery:

1. Confirm the Cloudflare account, Worker name and D1 database ID.
2. Export the D1 database or identify a Time Travel bookmark.
3. Inspect dependencies and affected row counts with read-only queries.
4. Prefer an additive corrective migration.
5. If restoring, stop writes, restore the exact production database, validate migration state, then
   resume traffic and reconcile timers created around the recovery boundary.

Audit records are intentionally immutable. Historical clients/projects/tags and time entries are
archived or soft-deleted, never casually erased.

## Local reset

Local D1 data is disposable. Remove the project-specific `.wrangler/state` only when an explicit
local reset is intended, then rerun:

```bash
pnpm db:setup
```

Never use the development seed against a remote database.
