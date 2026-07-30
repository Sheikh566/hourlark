import { z } from "zod";

import { ApiError } from "@/worker/errors";

const environmentSchema = z.object({
  ENVIRONMENT: z.enum(["development", "test", "production"]),
  AUTH_MODE: z.enum(["dev", "access"]),
  APP_NAME: z.string().min(1),
  COMPANY_NAME: z.string().min(1),
  COMPANY_DOMAIN: z.string().min(1),
  DEFAULT_TIMEZONE: z.string().min(1),
  DEFAULT_CURRENCY: z.string().regex(/^[A-Z]{3}$/),
  DEFAULT_WEEK_START: z.enum(["monday", "sunday"]),
  ACCESS_TEAM_DOMAIN: z.string(),
  ACCESS_AUD: z.string(),
  BOOTSTRAP_ADMIN_EMAILS: z.string(),
  DEV_DEFAULT_USER_EMAIL: z.string().optional(),
  CSRF_SECRET: z.string().min(24),
});

export type RuntimeConfig = z.infer<typeof environmentSchema>;

export function parseRuntimeConfig(env: Env): RuntimeConfig {
  const result = environmentSchema.safeParse(env);
  if (!result.success) {
    throw new ApiError(503, "configuration_invalid", "Application configuration is incomplete.");
  }

  const config = result.data;
  if (config.ENVIRONMENT === "production") {
    if (config.AUTH_MODE !== "access") {
      throw new ApiError(
        503,
        "development_auth_forbidden",
        "Development authentication cannot run in production.",
      );
    }
    if (
      config.ACCESS_TEAM_DOMAIN === "None" ||
      config.ACCESS_TEAM_DOMAIN.includes("[") ||
      config.ACCESS_AUD.includes("[")
    ) {
      throw new ApiError(503, "access_not_configured", "Cloudflare Access is not configured.");
    }
  }
  if (
    config.AUTH_MODE === "dev" &&
    config.ENVIRONMENT !== "development" &&
    config.ENVIRONMENT !== "test"
  ) {
    throw new ApiError(
      503,
      "development_auth_forbidden",
      "Development authentication is only available in development.",
    );
  }
  return config;
}
