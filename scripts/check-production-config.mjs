import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const invalid = [
  '"database_id": "00000000-0000-0000-0000-000000000000"',
  '"ACCESS_TEAM_DOMAIN": "None"',
  '"ACCESS_AUD": "[Access application audience]"',
];

const found = invalid.filter((value) => config.includes(value));
if (found.length > 0) {
  console.error(
    "Production configuration is incomplete. Replace the D1 database ID, Access team domain, and Access audience before deployment.",
  );
  process.exit(1);
}

if (!config.includes('"AUTH_MODE": "access"') || !config.includes('"ENVIRONMENT": "production"')) {
  console.error("Production must use AUTH_MODE=access and ENVIRONMENT=production.");
  process.exit(1);
}
