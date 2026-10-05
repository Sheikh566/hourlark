import { Hono } from "hono";

import { AuthMode } from "@/domain/auth";
import type { AppContext } from "@/domain/types";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  open,
  readCookie,
  seal,
  writeCookie,
  type OAuthStateClaims,
} from "@/worker/auth/session";
import {
  exchangeGoogleCode,
  googleAuthorizationUrl,
  verifyGoogleIdToken,
} from "@/worker/auth/google";
import { ApiError } from "@/worker/errors";
import { authenticateExternalIdentity } from "@/worker/middleware/authentication";
import { parseRuntimeConfig, type RuntimeConfig } from "@/worker/env";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function googleCredentials(
  config: RuntimeConfig,
): { clientId: string; clientSecret: string } | null {
  const clientId = config.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = config.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function loginRedirect(code: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/login?error=${encodeURIComponent(code)}` },
  });
}

function redirectWithCookies(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export const googleAuth = new Hono<AppContext>();

googleAuth.get("/google", async (c) => {
  const config = parseRuntimeConfig(c.env);
  if (config.AUTH_MODE !== AuthMode.Google) {
    return loginRedirect("google_signin_disabled");
  }
  const credentials = googleCredentials(config);
  if (!credentials) return loginRedirect("google_not_configured");

  const redirectUri = new URL("/api/v1/auth/google/callback", c.req.url).href;
  const state = randomToken();
  const nonce = randomToken();
  const sealed = await seal(config.CSRF_SECRET, { state, nonce, redirectUri }, OAUTH_STATE_TTL_MS);
  return redirectWithCookies(
    googleAuthorizationUrl({ ...credentials, redirectUri, state, nonce }),
    [writeCookie(OAUTH_STATE_COOKIE, sealed, c.req.url, OAUTH_STATE_TTL_MS / 1000)],
  );
});

googleAuth.get("/google/callback", async (c) => {
  const config = parseRuntimeConfig(c.env);
  const clearState = clearCookie(OAUTH_STATE_COOKIE, c.req.url);
  if (config.AUTH_MODE !== AuthMode.Google) {
    return redirectWithCookies("/login?error=google_signin_disabled", [clearState]);
  }
  if (c.req.query("error")) {
    return redirectWithCookies("/login?error=oauth_cancelled", [clearState]);
  }

  const credentials = googleCredentials(config);
  if (!credentials) return redirectWithCookies("/login?error=google_not_configured", [clearState]);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const sealed = readCookie(c.req.header("Cookie"), OAUTH_STATE_COOKIE);
  const saved = sealed ? await open<OAuthStateClaims>(config.CSRF_SECRET, sealed) : null;
  if (!code || !state || !saved || saved.state !== state) {
    return redirectWithCookies("/login?error=oauth_state_invalid", [clearState]);
  }

  try {
    const idToken = await exchangeGoogleCode({
      code,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      redirectUri: saved.redirectUri,
    });
    const identity = await verifyGoogleIdToken(idToken, credentials.clientId, saved.nonce);
    const member = await authenticateExternalIdentity(c.env.DB, config, identity);
    const session = await seal(
      config.CSRF_SECRET,
      { memberId: member.id, email: member.email_normalized, subject: identity.subject },
      SESSION_TTL_MS,
    );
    return redirectWithCookies("/", [
      writeCookie(SESSION_COOKIE, session, c.req.url, SESSION_TTL_MS / 1000),
      clearState,
    ]);
  } catch (error) {
    const codeName = error instanceof ApiError ? error.code : "google_signin_failed";
    return redirectWithCookies(`/login?error=${encodeURIComponent(codeName)}`, [clearState]);
  }
});

googleAuth.post("/logout", (c) => {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearCookie(SESSION_COOKIE, c.req.url) },
  });
});
