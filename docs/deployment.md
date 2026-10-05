# Deploy Hourlark to your Cloudflare account

This guide takes a new installation from an empty Cloudflare account to a working
company workspace. You deploy one Worker containing the website and API, one D1
database, and Google or Cloudflare Access sign-in. No server, Docker,
Cloudflare Tunnel, or separate frontend hosting is required.

Reviewed against the repository and Cloudflare documentation on 2026-10-04.
Commands below use Bash/Zsh; on Windows, use WSL or adapt the shell commands.
Run project commands from the repository root. The examples use `example.com`;
replace every example hostname, account ID, database ID, and administrator email
with your own values.

## Before you start

You need:

- A Cloudflare account with permission to manage Workers, D1, Access, and your DNS zone.
- A domain with an active DNS zone in that same account, and an unused subdomain
  such as `time.example.com`. Keep that hostname available for Hourlark.
- A Cloudflare Zero Trust organization with an identity provider your team can use.
- Git, Node.js 24.15.0 or a newer supported Node 24 release, and pnpm 12.9.1.
  The exact supported Node ranges are in `package.json`.
- The email address of the person who will become the first Hourlark administrator.

Workers, D1, and Access have separate allowances and billing. Check the current
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and
[Zero Trust plans](https://www.cloudflare.com/plans/zero-trust-services/) before
choosing plans. Account-wide usage and Access seats affect cost; this guide does
not require additional storage or compute products.

## 1. Get the project and install dependencies

Fork the repository if you want to maintain your own deployment configuration.
Clone your fork, or start with the public repository:

```bash
git clone https://github.com/Sheikh566/hourlark.git
cd hourlark
node --version
pnpm --version
pnpm install --frozen-lockfile
```

If your existing pnpm cannot activate version 12.9.1, the [README](../README.md#local-development)
includes an installation fallback. Keep the checked-in dependency versions and
lockfile for a reproducible deployment.

## 2. Choose your deployment settings

You never edit `wrangler.jsonc` to deploy. It holds shared defaults: Worker
`hourlark`, D1 database `hourlark`, and placeholder IDs. `pnpm deploy:configure`
(`scripts/configure-deploy.mjs`) reads the settings below from environment
variables and writes a gitignored `wrangler.deploy.json`. Builds, migrations, and
deploys use that file. If no D1 database with the chosen name exists, the script
creates it.

| Variable                                                                 | Required | What to enter                                                                                                             |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`                                                  | Yes      | The account to deploy to, from `pnpm exec wrangler whoami` or the dashboard.                                              |
| `COMPANY_NAME`, `COMPANY_DOMAIN`                                         | Yes      | Your company name and email domain, without `@`.                                                                          |
| `BOOTSTRAP_ADMIN_EMAILS`                                                 | Yes      | Your first administrator's exact sign-in email.                                                                           |
| `HOURLARK_WORKER_NAME`                                                   | No       | Worker name. Defaults to `hourlark`. Keep it stable after the first deploy.                                               |
| `HOURLARK_D1_DATABASE_NAME`                                              | No       | D1 database name. Defaults to the Worker name.                                                                            |
| `HOURLARK_DOMAIN`                                                        | No       | A hostname such as `time.example.com`. Without it, the Worker uses `workers.dev`.                                         |
| `AUTH_MODE`                                                              | No       | `google` (default) or `access`.                                                                                           |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`                                       | Access   | Your Zero Trust team domain and this application's AUD tag; see step 4.                                                   |
| `APP_NAME`, `DEFAULT_TIMEZONE`, `DEFAULT_CURRENCY`, `DEFAULT_WEEK_START` | No       | Override the defaults in `wrangler.jsonc`: an IANA timezone, a three-letter uppercase currency, and `monday` or `sunday`. |

`ENVIRONMENT` is always `production` and cannot be overridden. A Custom Domain
uses the hostname without `https://`, a path, or `/*`; the zone must be active in
the same account. Cloudflare creates the DNS record and certificate during
deployment. See [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

The Worker also needs these secrets:

| Secret                                     | Required       | Notes                                                                                               |
| ------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------- |
| `CSRF_SECRET`                              | Yes            | A random value of at least 24 characters. Generate one as shown below.                              |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in | From a Google OAuth client whose redirect URI is `https://<your host>/api/v1/auth/google/callback`. |

```bash
node --input-type=module -e 'import { randomBytes } from "node:crypto"; console.log(randomBytes(32).toString("hex"));'
```

Do not leave the original `sheikh.abdullah@iomechs.com` bootstrap address in your
installation. One deployment supports one company workspace. The migration
initializes the workspace with IOMechs defaults; these runtime variables do not
overwrite stored workspace settings. Step 9 explains how to change them.

## 3. Deploy with GitHub Actions (recommended)

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) deploys every
push to `main` in any repository that sets the `CLOUDFLARE_ACCOUNT_ID` variable.
Repositories without it, including unconfigured forks, skip the job.

1. Fork the repository. In your fork's **Actions** tab, enable workflows; GitHub
   disables them in new forks.
2. Create a Cloudflare API token from the **Edit Cloudflare Workers** template, and
   add **Account → D1 → Edit**. Limit it to your account and, if you use a custom
   domain, its zone.
3. In the fork, open **Settings → Secrets and variables → Actions**:
   - Under **Secrets**, add `CLOUDFLARE_API_TOKEN` and the Worker secrets from step 2.
   - Under **Variables**, add `CLOUDFLARE_ACCOUNT_ID` and the other variables
     from step 2 that you need.
4. Run **Deploy to Cloudflare** from the Actions tab, or push to `main`.

Each run validates the code (format, lint, types, tests, build), generates the
deployment configuration, records a D1 Time Travel bookmark in the job summary,
applies remote migrations, and deploys. Worker secrets set in the repository are
uploaded with the deploy and added to the Worker's existing secrets. Secrets you
delete from the repository stay on the Worker. If a migration or deploy goes
wrong, run the `wrangler d1 time-travel restore` command printed in the job
summary.

This repository's own deployment uses these settings: Worker and D1 database
`hourlark-preview`, published at `https://hourlark.sabdullah.com`.

To deploy from your own machine instead, follow steps 4 to 8. With Google
sign-in, skip step 4.

## 4. Protect the hostname with Cloudflare Access

Only for `AUTH_MODE=access`. Configure Access before publishing Hourlark on the hostname.

1. Open the Cloudflare dashboard and enter **Zero Trust**. Complete organization
   setup if this is your first application.
2. Under **Integrations → Identity providers**, configure your company sign-in
   provider. An email one-time PIN is another supported option. Enable a method
   employees can actually use; Cloudflare account membership is not required for
   Hourlark users when you use their company identity provider or email PIN.
3. Go to **Access controls → Applications → Create new application** and choose
   **Self-hosted and private**.
4. Add a **public hostname** for `time.example.com`. Leave the path empty so the
   application covers the entire hostname, including static pages and `/api/*`.
5. Create an **Allow** policy restricted to your intended company users or group.
   Make sure the bootstrap administrator's email is included. For an email PIN,
   restrict allowed email addresses/domains; choosing a login method alone is
   not a restriction on who may enter.
6. Enable the intended login method for this application and save it.
7. Copy the application's **Audience (AUD) tag** from its details/configuration
   into `ACCESS_AUD`. Copy the Zero Trust **team domain**, such as
   `your-team.cloudflareaccess.com`, from the organization settings into
   `ACCESS_TEAM_DOMAIN`. The team domain is different from the app's
   `time.example.com` hostname; the AUD is different from the application ID.

Dashboard labels can change. Use Cloudflare's
[Access application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/),
[identity provider guide](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/),
and [team-domain explanation](https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/)
as the reference if your dashboard differs.

## 5. Sign in to the correct Cloudflare account

Wrangler is already installed as a project dependency:

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
```

The first command opens a browser to authorize Wrangler. Confirm the account
listed by `whoami` is the one that owns your domain, and use its ID as
`CLOUDFLARE_ACCOUNT_ID`.

## 6. Generate and validate the deployment configuration

Export the variables from step 2 in your terminal, then:

```bash
pnpm validate
pnpm deploy:configure
pnpm check:production
```

`validate` checks formatting, lint, types, tests, and the production build.
`deploy:configure` finds or creates the D1 database and writes
`wrangler.deploy.json`. `check:production` checks that file for placeholder IDs, the
production environment, and the auth mode. It does not verify that your domain,
policy, secret, or IDs are correct in your Cloudflare account; perform the checks below.

For browser validation before deployment, use the local setup in the README and
run `pnpm test:e2e`. That suite creates a disposable local D1 database. Local
`.dev.vars` is for development; never copy its `AUTH_MODE=dev` settings into
production configuration.

## 7. Apply the production database migrations

Confirm the account and target database before making changes:

```bash
pnpm exec wrangler whoami
pnpm exec wrangler d1 migrations list DB --remote --config wrangler.deploy.json
```

On a new, empty database, apply the checked-in migrations:

```bash
pnpm db:migrate:remote
pnpm exec wrangler d1 migrations list DB --remote --config wrangler.deploy.json
```

Confirm no migrations remain unapplied. This includes `0003_member_update_guards.sql`,
which protects concurrent member updates and the last active administrator.

Do not run `pnpm db:setup` as a production setup step, and never apply
`seeds/development.sql` with `--remote`. Production starts with the workspace row
and no demo members; the first administrator is provisioned through verified
sign-in. See the [migration reference](https://developers.cloudflare.com/d1/reference/migrations/).

If this database already contains company data, export a backup before applying
new migrations; use the update procedure below instead of treating it as empty.

## 8. Create the production secrets and deploy

For the first deployment, put the Worker secrets from step 2 in a temporary file
outside the repository and upload them alongside the Worker. `mktemp` creates a
file accessible only to your user.

```bash
HOURLARK_SECRETS_FILE="$(mktemp)"
node --input-type=module -e 'import { randomBytes } from "node:crypto"; console.log("CSRF_SECRET=" + randomBytes(32).toString("hex"));' > "$HOURLARK_SECRETS_FILE"
# With Google sign-in, also append GOOGLE_CLIENT_ID=... and GOOGLE_CLIENT_SECRET=... lines.

HOURLARK_WRANGLER_CONFIG=wrangler.deploy.json pnpm build
pnpm exec wrangler deploy --secrets-file "$HOURLARK_SECRETS_FILE"
```

Run these in the same terminal so the variables remain available. Do not display
the file in logs, commit it, or use the development example secret. `pnpm build`
also removes the copied `.dev.vars` artifact.

After deployment succeeds, delete the temporary file:

```bash
rm -- "$HOURLARK_SECRETS_FILE"
unset HOURLARK_SECRETS_FILE
```

Wrangler should report your Worker and its Custom Domain or `workers.dev` URL.
Wait for DNS/certificate activation if necessary. The saved secrets are retained
for future deployments; recreating them every deploy is unnecessary. Cloudflare
documents this initial upload in
[secrets alongside code](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code).

## 9. Sign in, configure the company, and add members

1. Open `https://time.example.com` and sign in with the email configured in
   `BOOTSTRAP_ADMIN_EMAILS`. The verified first login creates an active Admin and
   marks bootstrap complete.
2. Open **Administration**. Replace the initial company name/domain, workspace
   timezone, currency, week start, and **Allowed email domains** with your own.
   Save the settings before provisioning colleagues. Review rate, rounding,
   report, and lock defaults there as well.
3. Check your own timezone in the user preferences and set it appropriately.
4. Open **Members** and provision each colleague with their exact sign-in email,
   name, timezone, and role. A provisioned pending member becomes active on their
   first verified sign-in. Hourlark does not send invitation emails; share the
   app URL through your normal company channel.
5. Confirm each colleague is also admitted by the Cloudflare Access policy.
   Access admission and Hourlark membership are separate requirements.

Bootstrap completes on the first administrator's sign-in, so leaving
`BOOTSTRAP_ADMIN_EMAILS` set afterwards grants nothing further. The deployment
configuration requires it to be non-empty.

Bootstrap completion is persisted in D1. This variable is not an ongoing login
allowlist or an automatic administrator recovery mechanism. See
[security.md](security.md) for the identity and permission model.

## 10. Verify the deployed app

Use a private browser window and actual provisioned test accounts:

- Opening the app without a session shows Access sign-in; a disallowed identity
  cannot enter. Repeat for a direct `/api/v1/health` request.
- After permitted sign-in, `https://time.example.com/api/v1/health` returns JSON
  containing `"status": "ok"`. It requires Hourlark membership too.
- Your first administrator can open Administration and Members. After disabling
  bootstrap, sign out and sign in again to confirm their normal membership works.
- A Member sees their permitted time and cannot administer the workspace.
- Start a short timer, stop it, refresh, and confirm the entry persists. Verify
  the selected project, timezone, editing, calendar, and timesheet behavior.
- Download CSV and PDF reports and check the company details, currency, totals,
  and timezone against the entry you created.
- Visit `/reports` directly and refresh to check SPA routing.

For logs, use **Workers & Pages → your Worker → Observability**, or run:

```bash
pnpm exec wrangler tail --config wrangler.deploy.json
```

Deployment is complete only after these checks pass on the real hostname. Local
checks and a successful upload alone do not establish that Access and DNS work.

## Updating an existing installation

With GitHub Actions, merge or push the release to `main`; the workflow records a
restore point before it migrates. For a manual update, check out your intended
release, export the variables from step 2, and validate before changing production:

```bash
pnpm install --frozen-lockfile
pnpm validate
pnpm deploy:configure
pnpm check:production
pnpm exec wrangler whoami
pnpm exec wrangler d1 migrations list DB --remote --config wrangler.deploy.json
```

If migrations are pending, export the exact production database first. Choose a
private backup destination outside Git; this example uses your home directory:

```bash
(umask 077; pnpm exec wrangler d1 export DB --remote --config wrangler.deploy.json --output "$HOME/hourlark-backup-$(date -u +%Y%m%dT%H%M%SZ).sql")
pnpm db:migrate:remote
```

Then deploy and repeat the production verification:

```bash
pnpm deploy
```

For later secret rotation, use the interactive prompt:

```bash
pnpm exec wrangler secret put CSRF_SECRET
```

Use another cryptographically random value. Rotation invalidates outstanding
CSRF tokens; reload active browser sessions. For a staged deployment or another
company, use a separate database and Access application rather than reusing
production bindings.

## Troubleshooting

| Symptom                                             | Check                                                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Production configuration is incomplete              | Run `pnpm deploy:configure` first, and set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` for Access mode.                                            |
| Wrangler chooses the wrong account                  | Check `CLOUDFLARE_ACCOUNT_ID` and `whoami`; the domain and D1 must belong to the intended account.                                           |
| The deploy workflow is skipped                      | Set the `CLOUDFLARE_ACCOUNT_ID` repository variable, enable Actions in the fork, and run it from `main`.                                     |
| Hostname does not resolve or has no certificate     | Check the zone is active, the Custom Domain is attached to the Worker, and the hostname is not owned by another service.                     |
| Access denies the first administrator               | Check the email/group policy and enabled login provider; the bootstrap variable does not grant Access admission.                             |
| `access_token_invalid`                              | Check the team domain and this application's AUD; make sure Access protects this exact hostname.                                             |
| `configuration_invalid`                             | Check all required variables and the deployed `CSRF_SECRET`; confirm it is at least 24 characters and `BOOTSTRAP_ADMIN_EMAILS` still exists. |
| First administrator is not provisioned              | Check the verified sign-in email matches the bootstrap address, all migrations ran, and the database has not already completed bootstrap.    |
| A colleague passes Access but is denied by Hourlark | Provision their exact email under Members and check their account is not inactive.                                                           |
| `email_domain_forbidden` when adding a member       | Change Administration's stored Allowed email domains; changing only the Worker variable does not update them.                                |
| Writes fail with a CSRF error                       | Reload after login or secret rotation and use the same protected hostname for the app and API.                                               |
| SQL reports a missing table                         | Check the deployed `DB` binding's UUID and remote migration state, rather than the local database.                                           |
| Deploy succeeds but there is no app URL             | Check `HOURLARK_DOMAIN`, or use the `workers.dev` URL Wrangler printed when no domain is set.                                                |

## Recovery

Worker code rollback and database recovery are separate. A Worker rollback does
not undo migrations or time-entry writes. Use Cloudflare's Worker deployment
history for code rollback; plan D1 export/Time Travel recovery around the exact
database and desired point in time. Confirm schema compatibility before restoring
an older Worker version. Follow [operations.md](operations.md) for recovery and
member-identity incidents.

This guide has been checked against source code, installed CLI commands, and
linked official documentation. A deployment into a new Cloudflare account has
not been performed as part of writing it.
