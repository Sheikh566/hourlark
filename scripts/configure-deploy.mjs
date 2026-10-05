// Writes wrangler.deploy.json from wrangler.jsonc and deployment environment variables, so a
// fork deploys to its own Cloudflare account without editing committed configuration.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import ts from "typescript";

const sourcePath = new URL("../wrangler.jsonc", import.meta.url);
const outputPath = new URL("../wrangler.deploy.json", import.meta.url);

const env = (name) => process.env[name]?.trim() || undefined;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function wrangler(args) {
  return execFileSync("wrangler", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", await readFile(sourcePath, "utf8"));
if (parsed.error) fail("wrangler.jsonc could not be parsed.");
const config = parsed.config;

const accountId = env("CLOUDFLARE_ACCOUNT_ID");
if (!accountId) fail("Set CLOUDFLARE_ACCOUNT_ID to the Cloudflare account to deploy to.");

// Identity-specific values must come from the deployer, never from the committed defaults.
const requiredVars = ["COMPANY_NAME", "COMPANY_DOMAIN", "BOOTSTRAP_ADMIN_EMAILS"];
const missing = requiredVars.filter((name) => !env(name));
if (missing.length > 0) fail(`Set ${missing.join(", ")} for this deployment.`);

const workerName = env("HOURLARK_WORKER_NAME") ?? config.name;
const databaseName = env("HOURLARK_D1_DATABASE_NAME") ?? workerName;
const domain = env("HOURLARK_DOMAIN");

const findDatabase = () =>
  JSON.parse(wrangler(["d1", "list", "--json"])).find((db) => db.name === databaseName);
let database = findDatabase();
if (!database) {
  console.log(`Creating D1 database ${databaseName}.`);
  wrangler(["d1", "create", databaseName]);
  database = findDatabase();
  if (!database) fail(`D1 database ${databaseName} was not found after creating it.`);
}

config.name = workerName;
config.account_id = accountId;
const binding = config.d1_databases.find((db) => db.binding === "DB");
binding.database_name = databaseName;
binding.database_id = database.uuid;

if (domain) {
  config.routes = [{ pattern: domain, custom_domain: true }];
  config.workers_dev = false;
} else {
  delete config.routes;
  config.workers_dev = true;
}

for (const name of Object.keys(config.vars)) {
  if (name !== "ENVIRONMENT" && env(name)) config.vars[name] = env(name);
}

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  `Wrote wrangler.deploy.json: Worker ${workerName}, D1 ${databaseName}, ` +
    (domain ? `domain ${domain}.` : "workers.dev URL."),
);
