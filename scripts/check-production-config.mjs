import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");

if (config.includes('"database_id": "00000000-0000-0000-0000-000000000000"')) {
  console.error(
    "Production configuration is incomplete. Replace the D1 database ID before deployment.",
  );
  process.exit(1);
}

if (!config.includes('"ENVIRONMENT": "production"')) {
  console.error("Production must use ENVIRONMENT=production.");
  process.exit(1);
}

const google = config.includes('"AUTH_MODE": "google"');
const access = config.includes('"AUTH_MODE": "access"');
if (!google && !access) {
  console.error("Production must use AUTH_MODE=access or AUTH_MODE=google.");
  process.exit(1);
}

if (
  access &&
  (config.includes('"ACCESS_TEAM_DOMAIN": "None"') ||
    config.includes('"ACCESS_AUD": "[Access application audience]"'))
) {
  console.error(
    "Production configuration is incomplete. Replace the Access team domain and Access audience before an Access deployment.",
  );
  process.exit(1);
}
