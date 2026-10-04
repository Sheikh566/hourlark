# API and export contracts

## API conventions

- Base path: `/api/v1`
- Same-origin JSON requests and responses
- Timestamps: ISO 8601 with offsets on input; UTC ISO on output
- Date ranges: half-open `[start, end)`
- IDs: UUID
- Mutations: CSRF headers required
- Timer start/stop/continue: `Idempotency-Key` required (8–200 characters)
- Stale writes: HTTP 409 with a stable error code

Errors have the shape:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request is invalid.",
    "request_id": "uuid",
    "fields": [{ "path": "started_at", "message": "..." }]
  }
}
```

Principal route groups are `/me`, `/timer`, `/time-entries`, `/calendar`, `/reports`, `/exports`,
`/clients`, `/projects`, `/tags`, `/members`, `/settings`, and `/audit-log`.

## Report completeness and member changes

Summary, detailed, CSV, and PDF reports reject filters matching more than 5,000
visible, non-deleted entries with HTTP 422, `report_too_large`, and `max_entries: 5000`.
Use a shorter date range or narrower filters. Exactly 5,000 entries are supported;
the separate PDF limit below still applies. Detailed-report page size does not
change this limit on its full matching dataset.

Member updates commit the profile, project assignments, timer stop, and audit event
as one batch. A stale version aborts the batch with HTTP 409 `member_conflict`.
Demoting or deactivating the final active administrator aborts with HTTP 422
`last_admin_protected`, including when another administrator changes concurrently.
Migration `0003_member_update_guards.sql` must be applied before serving the updated API.

## CSV

Detailed column order is stable:

1. Entry ID
2. Date
3. Member
4. Client
5. Project
6. Description
7. Tags
8. Start ISO
9. Stop ISO
10. Local Start
11. Local Stop
12. Raw Duration Seconds
13. Rounded Duration Seconds
14. Billable
15. Rate Minor Units
16. Currency
17. Amount Minor Units
18. Running

Summary order is Group, Tracked Seconds, Rounded Seconds, Billable Seconds, Non-Billable Seconds,
Percent of Total, Amounts by Currency.

CSV is UTF-8 with CRLF records. Every cell is quoted, embedded quotes are doubled, and formula-like
values are prefixed with an apostrophe.

## PDF

The “Time Report” PDF is an invoice attachment, not an invoice. It includes company/client identity,
period and timezone, optional reference/notes, project or date grouping, row duration, optional
member/description/tag/rate detail, totals, page numbers, and a non-invoice disclaimer. A request is
limited to 2,000 detail lines.

Financial export routes are available only to Manager and Admin roles. Member report API responses
omit rate and amount fields rather than sending hidden values.
