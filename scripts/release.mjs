import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const usage = `Usage: pnpm release [patch|minor|major|<x.y.z>] [--dry-run]

Bumps package.json, prepends CHANGELOG.md from commits since the last tag,
then creates a release commit and an annotated vX.Y.Z tag. Without a bump,
the level is inferred from Conventional Commit prefixes. The first release
uses the current package.json version.`;

const packageUrl = new URL("../package.json", import.meta.url);
const changelogUrl = new URL("../CHANGELOG.md", import.meta.url);
const changelogHeader = "# Changelog\n\nAll notable changes to Hourlark are documented here.\n";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((arg) => !arg.startsWith("--"));
if (args.includes("--help") || positional.length > 1) {
  console.log(usage);
  process.exit(args.includes("--help") ? 0 : 1);
}
const requested = positional[0];

function git(...gitArgs) {
  return execFileSync("git", gitArgs, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) : undefined;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function bump([major, minor, patch], level) {
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const conventional = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<subject>.+)$/;

function readCommits(range) {
  const log = git("log", ...range, "--no-merges", "--format=%h%x1f%s%x1f%b%x1e");
  return log
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, summary, body = ""] = record.split("\x1f");
      const parsed = conventional.exec(summary)?.groups;
      return {
        hash,
        type: parsed?.type ?? "other",
        scope: parsed?.scope,
        subject: parsed?.subject ?? summary,
        breaking: Boolean(parsed?.breaking) || /^BREAKING[ -]CHANGE:/m.test(body),
      };
    })
    .filter((commit) => !(commit.type === "chore" && commit.scope === "release"));
}

function inferLevel(commits, [major]) {
  if (commits.some((commit) => commit.breaking)) return major === 0 ? "minor" : "major";
  if (commits.some((commit) => commit.type === "feat")) return "minor";
  return "patch";
}

function githubCommitUrl() {
  try {
    const remote = git("remote", "get-url", "origin");
    const match = /github\.com[:/](?<repo>[^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
    return match ? `https://github.com/${match.groups.repo}/commit/` : undefined;
  } catch {
    return undefined;
  }
}

function renderSection(version, date, commits) {
  const commitUrl = githubCommitUrl();
  const groups = [
    ["Breaking changes", commits.filter((commit) => commit.breaking)],
    ["Features", commits.filter((commit) => !commit.breaking && commit.type === "feat")],
    ["Fixes", commits.filter((commit) => !commit.breaking && commit.type === "fix")],
    [
      "Other changes",
      commits.filter((commit) => !commit.breaking && !["feat", "fix"].includes(commit.type)),
    ],
  ];
  const lines = [`## v${version} (${date})`, ""];
  for (const [title, entries] of groups) {
    if (entries.length === 0) continue;
    lines.push(`### ${title}`, "");
    for (const commit of entries) {
      const scope = commit.scope ? `**${commit.scope}:** ` : "";
      const reference = commitUrl ? `[${commit.hash}](${commitUrl}${commit.hash})` : commit.hash;
      lines.push(`- ${scope}${commit.subject} (${reference})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

if (!dryRun && git("status", "--porcelain", "--untracked-files=no") !== "") {
  fail("The working tree has uncommitted changes. Commit or stash them before releasing.");
}

const packageText = await readFile(packageUrl, "utf8");
const currentVersion = JSON.parse(packageText).version;
const current = parseVersion(currentVersion);
if (!current) fail(`package.json version "${currentVersion}" is not a plain x.y.z version.`);

const tags = git("tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--merged", "HEAD", "--sort=-v:refname");
const lastTag = tags.split("\n").find(Boolean);
const commits = readCommits(lastTag ? [`${lastTag}..HEAD`] : ["HEAD"]);
if (lastTag && commits.length === 0) fail(`No changes since ${lastTag}.`);

let nextVersion;
if (requested && parseVersion(requested)) {
  nextVersion = requested;
} else if (requested && !["patch", "minor", "major"].includes(requested)) {
  fail(usage);
} else if (!lastTag && !requested) {
  nextVersion = currentVersion;
} else {
  nextVersion = bump(current, requested ?? inferLevel(commits, current));
}

if (lastTag && compareVersions(parseVersion(nextVersion), parseVersion(lastTag.slice(1))) <= 0) {
  fail(`v${nextVersion} must be newer than ${lastTag}.`);
}
const tag = `v${nextVersion}`;
if (git("tag", "--list", tag) !== "") fail(`Tag ${tag} already exists.`);

const date = new Date().toISOString().slice(0, 10);
const section = renderSection(nextVersion, date, commits);

console.log(
  `Releasing ${tag} (${lastTag ? `${commits.length} commits since ${lastTag}` : "first release"})\n`,
);
console.log(section);

if (dryRun) {
  console.log("Dry run: nothing was written.");
  process.exit(0);
}

let changelog = changelogHeader;
try {
  changelog = await readFile(changelogUrl, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const insertAt = changelog.indexOf("\n## ");
changelog =
  insertAt === -1
    ? `${changelog.trimEnd()}\n\n${section}`
    : `${changelog.slice(0, insertAt + 1)}${section}\n${changelog.slice(insertAt + 1)}`;

await writeFile(changelogUrl, `${changelog.trimEnd()}\n`);
await writeFile(packageUrl, packageText.replace(/("version":\s*)"[^"]+"/, `$1"${nextVersion}"`));

git("add", "package.json", "CHANGELOG.md");
git("commit", "-m", `chore(release): ${tag}`);
git("tag", "-a", tag, "-m", tag);

console.log(`Created ${tag}. Publish it with:\n\n  git push --follow-tags`);
