import { readFile } from "node:fs/promises";

// Checks the generated deployment configuration by default; pass a path to check another file.
const path = process.argv[2] ?? "wrangler.deploy.json";
const config = await readFile(new URL(`../${path}`, import.meta.url), "utf8").catch(() => {
  console.error(`${path} was not found. Run pnpm deploy:configure first.`);
  process.exit(1);
});

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

// Browser push is optional, so missing VAPID secrets only warn. Secrets are not in the deploy
// config; ask Wrangler when the Worker already exists.
const vapidSecrets = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
try {
  const { execFileSync } = await import("node:child_process");
  const listed = JSON.parse(
    execFileSync("wrangler", ["secret", "list", "--config", path, "--format", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ).map((secret) => secret.name);
  const missing = vapidSecrets.filter((name) => !listed.includes(name));
  if (missing.length > 0) {
    console.warn(
      `Warning: ${missing.join(", ")} not set. Browser push notifications stay off; the in-app inbox still works. See docs/deployment.md.`,
    );
  }
} catch {
  console.warn(
    "Warning: could not list Worker secrets to check VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT. Without them browser push notifications stay off.",
  );
}
