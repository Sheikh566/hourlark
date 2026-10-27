import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ENVIRONMENT: "test",
          AUTH_MODE: "dev",
          APP_NAME: "Hourlark Test",
          COMPANY_NAME: "Example Company",
          COMPANY_DOMAIN: "example.com",
          DEFAULT_TIMEZONE: "Asia/Karachi",
          DEFAULT_CURRENCY: "USD",
          DEFAULT_WEEK_START: "monday",
          ACCESS_TEAM_DOMAIN: "None",
          ACCESS_AUD: "test",
          BOOTSTRAP_ADMIN_EMAILS: "",
          DEV_DEFAULT_USER_EMAIL: "admin@example.com",
          CSRF_SECRET: "test-only-csrf-secret-at-least-24-characters",
          // Push stays off unless a test opts in, whatever a local .dev.vars contains.
          VAPID_PUBLIC_KEY: "",
          VAPID_PRIVATE_KEY: "",
          VAPID_SUBJECT: "",
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
        },
      },
    })),
  ],
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
  },
});
