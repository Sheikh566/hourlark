# Workers Budget

Hourlark runs on the Cloudflare **Workers Paid** plan ($5/month). This doc is the
**budget check** every feature passes before it ships, so a change never silently
pushes usage past what the plan includes and into overage billing.

## Plan allowances

Verified 2026-10-27 against <https://developers.cloudflare.com/workers/platform/pricing/>.
Re-verify when a number here drives a decision; Cloudflare changes pricing.

| Resource            | Included per month | Overage                |
| ------------------- | ------------------ | ---------------------- |
| Worker requests     | 10 million         | $0.30 / million        |
| Worker CPU time     | 30 million CPU-ms  | $0.02 / million CPU-ms |
| D1 rows read        | 25 billion         | $0.001 / million       |
| D1 rows written     | 50 million         | $1.00 / million        |
| D1 storage          | 5 GB               | $0.75 / GB-month       |
| Workers Logs events | 20 million         | $0.60 / million        |

Per-invocation limits: 30 s CPU by default (5 min max via `limits.cpu_ms`), 128 MB
memory, 10,000 subrequests, 1 s startup time. Workers Logs moves to Cloudflare
Observability pricing on 2026-12-01; re-check that row after that date.

Free: static asset requests. Only `/api/*` invokes the Worker
(`assets.run_worker_first` in `wrangler.jsonc`); pages, JS, CSS, and images cost nothing.

### Access seats

Production uses `AUTH_MODE=google`, so Cloudflare Access consumes no seats today
(2026-10-27: zero Access applications and zero seats in the account). Seats apply only
under `AUTH_MODE=access`:

- The Zero Trust Free plan is commonly cited as 50 seats; confirm on the account's
  Zero Trust billing page before relying on it. Extra seats are billed per user/month.
- A user takes one seat on their first Access login and keeps it until removed or
  expired by inactivity (configurable, 1 month to 1 year).
- When every seat is taken, new users are **blocked from signing in**, not billed.

The 50-user load model fills every free seat, so switching to Access mode is **Red**
until seat expiration is enabled or paid seats are purchased.

## Baseline

Load model: **50 users, 22 workdays/month = 1,100 user-days.**

Measured on `hourlark-preview` (the deployed Worker), October 2026:

- Warm API request: 1–2 ms CPU. Heaviest routes: `/api/v1/auth/google/callback`
  and `/api/v1/me` at ~5 ms.
- Cold start: 7–14 ms CPU.

Per user-day request mix:

| Source                                    | Requests | Basis                                                      |
| ----------------------------------------- | -------- | ---------------------------------------------------------- |
| `["timer"]` poll, 30 s `refetchInterval`  | 120      | 1 visible hour/day; TanStack pauses polling in hidden tabs |
| Navigation, timer actions, edits, refocus | 150      | Estimate                                                   |

Monthly estimate:

| Item            | Formula                                     | CPU-ms          |
| --------------- | ------------------------------------------- | --------------- |
| API requests    | 1,100 × 270 = 297,000 × 3 ms                | 891,000         |
| Cold starts     | 2% × 297,000 × 15 ms                        | 89,100          |
| PDF/CSV exports | 250 × 200 ms (5 per user; unmeasured guess) | 50,000          |
| **Total**       |                                             | **≈ 1,030,000** |

That is **3.4% of included CPU** and **3.0% of included requests**. Worst case (tab
visible all 8 hours, 960 polls/day) is ≈ 4.1M CPU-ms and 1.2M requests, still under 14%.

## Budget check

Run this for every change that touches `src/worker/`, adds or changes a TanStack
Query `refetchInterval`/polling, adds a scheduled or queue handler, adds a binding, or
changes `AUTH_MODE`.

1. **Classify** the change against each lever:
   - **Request volume**: new polling, shorter intervals, `refetchIntervalInBackground`,
     per-keystroke requests, fan-out (one screen firing N requests), WebSockets, crons.
   - **CPU per request**: PDF/CSV generation, crypto, large JSON parsing or
     serialisation, report aggregation in JS, heavy new imports (raise cold-start cost).
   - **D1 rows**: queries without an index on their `WHERE`/`ORDER BY` (full scans
     multiply rows read by table size), unbounded report ranges, writes inside loops.
   - **Log volume**: `console.log` per request (logs sample at `head_sampling_rate: 1`).
   - **Access seats**: switching to `AUTH_MODE=access` or growing the user count; see
     [Access seats](#access-seats).
2. **Quantify** each lever the change moves: requests per user-day × 1,100, multiplied by
   CPU-ms per request. Measure CPU with the query in [Measuring](#measuring) when the
   code is deployable; otherwise state the assumed number.
3. **Compare** the new monthly total against the allowances. Every change ends in one
   of three verdicts:
   - **Green**: projected usage stays under 25% of every allowance. Note the delta in
     the PR.
   - **Amber**: 25–75% of any allowance. Report the numbers to the user and propose a
     cheaper design (longer interval, pause when hidden, cache, index, move work to
     the client) before implementing.
   - **Red**: over 75% of any allowance, or any per-invocation limit at risk. Stop and
     get the user's explicit approval with an estimated monthly overage in dollars.
4. **Update** the Baseline section in this doc when a change shifts the request mix,
   a measured CPU number, or the load model, so the next check starts from truth.

The check is done when every lever is either marked untouched or has a number, and the
verdict is written in the PR description.

## Measuring

The Workers analytics GraphQL API reports CPU and wall time in **microseconds**:
`cpuTimeP99: 15284` is 15 ms, not 15 s. Dashboard summaries have misread this.

Per-day CPU quantiles (through the Cloudflare API, `POST /graphql`):

```graphql
query ($a: String!, $s: Time!, $e: Time!) {
  viewer {
    accounts(filter: { accountTag: $a }) {
      workersInvocationsAdaptive(
        limit: 100
        filter: { datetime_geq: $s, datetime_leq: $e, scriptName: "hourlark-preview" }
        orderBy: [date_ASC]
      ) {
        sum {
          requests
          errors
        }
        quantiles {
          cpuTimeP50
          cpuTimeP99
        }
        dimensions {
          date
        }
      }
    }
  }
}
```

Per-route CPU (milliseconds, 7-day log retention): Workers Observability query on
service `hourlark-preview`, grouped by `$workers.event.path`, calculating `count`,
`median`, `p99`, and `sum` of `$workers.cpuTimeMs`.

D1 rows read/written: Cloudflare dashboard, D1 > database > Metrics > Row Metrics.
