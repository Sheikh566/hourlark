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
