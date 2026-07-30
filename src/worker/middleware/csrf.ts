import { createMiddleware } from "hono/factory";

import type { AppContext } from "@/domain/types";
import { ApiError } from "@/worker/errors";
import { parseRuntimeConfig } from "@/worker/env";

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export async function createCsrfToken(env: Env, memberId: string): Promise<string> {
  const config = parseRuntimeConfig(env);
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const payload = `${memberId}.${expiresAt}`;
  return `${payload}.${await hmac(config.CSRF_SECRET, payload)}`;
}

async function verifyCsrfToken(env: Env, memberId: string, token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokenMemberId, expiresAtText, signature] = parts;
  if (!tokenMemberId || !expiresAtText || !signature || tokenMemberId !== memberId) return false;
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = await hmac(
    parseRuntimeConfig(env).CSRF_SECRET,
    `${tokenMemberId}.${expiresAtText}`,
  );
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(signature)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actual = new Uint8Array(actualDigest);
  const wanted = new Uint8Array(expectedDigest);
  let difference = actual.length ^ wanted.length;
  for (let index = 0; index < Math.max(actual.length, wanted.length); index += 1) {
    difference |= (actual[index] ?? 0) ^ (wanted[index] ?? 0);
  }
  return difference === 0;
}

export const csrfMiddleware = createMiddleware<AppContext>(async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    await next();
    return;
  }

  const origin = c.req.header("Origin");
  const requestOrigin = new URL(c.req.url).origin;
  if (origin !== requestOrigin) {
    throw new ApiError(403, "csrf_origin_invalid", "The request origin is not allowed.");
  }
  const fetchSite = c.req.header("Sec-Fetch-Site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    throw new ApiError(403, "csrf_site_invalid", "Cross-site requests are not allowed.");
  }
  const token = c.req.header("X-CSRF-Token");
  if (!token || !(await verifyCsrfToken(c.env, c.get("member").id, token))) {
    throw new ApiError(403, "csrf_token_invalid", "The security token is missing or invalid.");
  }
  await next();
});
