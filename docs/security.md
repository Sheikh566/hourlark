# Security model

## Identity boundary

Cloudflare Access must protect the complete production hostname. The Worker independently validates
the `Cf-Access-Jwt-Assertion` header:

1. Load signing keys from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.
2. Verify RS256 signature, issuer, audience and expiration with `jose`.
3. Require non-empty subject and email claims.
4. Normalize email and resolve a provisioned D1 member.
5. Bind the Access subject once. A different later subject is rejected until an Admin explicitly
   resets the binding.

An unprovisioned verified identity is denied. A bootstrap address is admitted only after that exact
address presents a valid Access JWT and only while no active Admin exists. Bootstrap completion is
persisted and does not continually rewrite roles.

After initial setup, remove `BOOTSTRAP_ADMIN_EMAILS` or restrict it to an intentionally retained
break-glass identity.

## Authorization

`src/domain/permissions/policy.ts` is the central role/action matrix. API routes and entry services
enforce it; React visibility is convenience only. Members are forced to their own time at the query
layer and never receive monetary fields. Managers receive team and financial report access but
cannot modify Admin/security settings. Admins can reset identity bindings and override entry locks
with a mandatory audit reason.

## Browser request protection

- Same-origin deployment avoids CORS.
- All state-changing routes require an exact `Origin`, acceptable `Sec-Fetch-Site`, and an
  identity-bound HMAC CSRF token.
- Content Security Policy and defensive headers are defined in `public/_headers`.
- API errors use structured JSON and do not expose SQL or token internals.
- CSV cells are always quoted and values starting with `=`, `+`, `-` or `@` are prefixed to prevent
  formula execution.

## Data integrity

- D1 foreign keys, check constraints and a partial unique index protect the schema.
- User data is passed through D1 bindings. LIKE input is escaped.
- IDs use `crypto.randomUUID()`.
- Optimistic versions reject stale edits.
- Audit rows are protected by database triggers against update and deletion.
- Timers and idempotency records are committed in D1 batches.
- No password, Access JWT, authentication cookie or production secret is stored in the application
  database.

## Required production controls

- Create a random `CSRF_SECRET` of at least 24 characters with Wrangler secrets.
- Restrict the Access application to the intended IOMechs identity policy.
- Set short, appropriate Access session duration and require the company identity provider’s MFA.
- Review audit events and Worker logs; avoid logging request bodies or Access assertions.
- Back up D1 before destructive operational changes and keep Cloudflare D1 Time Travel available.
