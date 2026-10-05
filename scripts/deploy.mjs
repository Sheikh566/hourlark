import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const releaseTag = `v${version}`;
const commit = git("rev-parse", "--short", "HEAD");
const dirty = git("status", "--porcelain") !== "";
const released = git("tag", "--points-at", "HEAD").split("\n").includes(releaseTag);

// Wrangler records the tag and message on the Worker Version shown in the Cloudflare dashboard.
const tag = released && !dirty ? releaseTag : `${releaseTag}+${commit}${dirty ? ".dirty" : ""}`;
if (tag !== releaseTag) {
  console.warn(`Warning: HEAD is not a clean ${releaseTag} release; deploying as ${tag}.`);
}

// wrangler.deploy.json is generated from the deployment environment; see scripts/configure-deploy.mjs.
run("pnpm", ["run", "deploy:configure"]);
run("pnpm", ["run", "check:production"]);
run("pnpm", ["run", "build"], { ...process.env, HOURLARK_WRANGLER_CONFIG: "wrangler.deploy.json" });
run("pnpm", ["run", "db:migrate:remote"]);
run("pnpm", [
  "exec",
  "wrangler",
  "deploy",
  "--tag",
  tag,
  "--message",
  `Hourlark ${tag} (${commit})`,
  ...process.argv.slice(2),
]);
