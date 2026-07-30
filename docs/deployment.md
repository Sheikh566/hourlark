# Deployment runbook

## 1. Create D1

```bash
pnpm wrangler d1 create iomechs-time
```

Copy the returned database ID into `wrangler.jsonc`. Keep the binding name `DB`.

## 2. Configure Cloudflare Access

Create a self-hosted Access application covering the complete production hostname. Configure the
IOMechs identity policy before deploying the application.

From Zero Trust → Access → Applications, copy:

- the team domain into `ACCESS_TEAM_DOMAIN` (for example
  `iomechs.cloudflareaccess.com`);
- the application Audience (AUD) tag into `ACCESS_AUD`.

Set the actual Worker custom domain/route in the Cloudflare dashboard or deployment pipeline. The
hostname was not supplied in this implementation and is deliberately not invented.

## 3. Configure secrets and variables

`wrangler.jsonc` contains non-secret production variables. Create the secret:

```bash
pnpm wrangler secret put CSRF_SECRET
```

Use a cryptographically random value of at least 24 characters. Do not put it in `wrangler.jsonc`,
`.dev.vars.example`, CI logs or Git.

`BOOTSTRAP_ADMIN_EMAILS` initially contains `sheikh.abdullah@iomechs.com`. It is evaluated only when
there is no active Admin and only after that same email presents a verified Access token. After the
first successful Admin login, remove the variable or reduce it to an approved break-glass policy and
redeploy. Stored roles are not overwritten after bootstrap completion.

## 4. Validate and migrate

```bash
pnpm validate
pnpm check:production
pnpm wrangler d1 migrations list iomechs-time --remote
pnpm db:migrate:remote
```

Review the target account and database before confirming a remote migration. Development seed data
is in `seeds/development.sql` and is never discovered by the production migration command.

## 5. Deploy

```bash
pnpm deploy
```

The build removes any copied `.dev.vars` artifact before deployment. Verify:

- Access redirects an unauthenticated browser;
- `/api/v1/health` is reachable only through Access and reports `ok`;
- the bootstrap Admin can sign in;
- an unprovisioned company identity receives an application denial;
- start/stop, CSV and PDF work in the production timezone.

## Rollback

Worker rollback and D1 rollback are separate. Roll back the Worker through Cloudflare version
history. SQL migrations are forward-only; restore or rewind D1 using Time Travel after confirming
the exact database and recovery timestamp. See [operations.md](operations.md).
