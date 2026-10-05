# Releasing Hourlark

Hourlark uses [Semantic Versioning](https://semver.org/). The version lives in `package.json`,
each release is an annotated `vX.Y.Z` Git tag, and `CHANGELOG.md` records what changed.

While the version is `0.x`, breaking changes and new features bump the minor version and fixes
bump the patch version. Release `1.0.0` once Hourlark has fully replaced Toggl Track in production.

## Commit messages

Release notes and version bumps come from commit prefixes, so keep using them:

| Prefix                                            | Changelog section | Bump in 0.x | Bump from 1.0 |
| ------------------------------------------------- | ----------------- | ----------- | ------------- |
| `feat:`                                           | Features          | minor       | minor         |
| `fix:`                                            | Fixes             | patch       | patch         |
| `style:`, `docs:`, `chore:`, others               | Other changes     | patch       | patch         |
| `feat!:` or a `BREAKING CHANGE:` line in the body | Breaking changes  | minor       | major         |

Merge commits and `chore(release):` commits are left out of the changelog.

## Cutting a release

Start from a clean, up-to-date `main` that passes `pnpm validate`, then preview the release:

```bash
pnpm release --dry-run
```

If the version and notes look right, create the release commit and tag, then push both:

```bash
pnpm release
git push --follow-tags
```

To override the inferred bump, pass `patch`, `minor`, `major`, or an exact version, for example
`pnpm release minor` or `pnpm release 1.0.0`. The first release uses the current `package.json`
version unchanged. Edit `CHANGELOG.md` wording before pushing if needed by amending the release
commit and moving the tag with `git tag -fa vX.Y.Z -m vX.Y.Z`.

## Deploying a release

Check out the release tag and deploy it with the normal procedure in the
[deployment guide](deployment.md#updating-an-existing-installation):

```bash
git checkout vX.Y.Z
pnpm run deploy
```

`pnpm run deploy` passes the version to Wrangler as the Worker Version tag and message, so the
Cloudflare dashboard (Workers & Pages → hourlark → Deployments) shows which release is live.
Deploying a commit that is not exactly a clean release tag still works, but it is tagged as
`vX.Y.Z+<commit>` (with `.dirty` for uncommitted changes) so it cannot be mistaken for a release.
Extra arguments are forwarded to `wrangler deploy`, for example
`pnpm run deploy --secrets-file "$HOURLARK_SECRETS_FILE"`.

To roll back, deploy the previous tag the same way, or choose its Worker Version in the dashboard.
Database migrations are not rolled back automatically; see [operations](operations.md).
