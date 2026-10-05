const encoder = new TextEncoder();

export const SESSION_COOKIE = "hourlark_session";
export const OAUTH_STATE_COOKIE = "hourlark_oauth_state";

export interface SessionClaims {
  memberId: string;
  email: string;
  subject: string;
  exp: number;
}

export interface OAuthStateClaims {
  state: string;
  nonce: string;
  redirectUri: string;
  exp: number;
}

function base64UrlEncode(value: string): string {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(`${padded}${padding}`);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signaturesMatch(actual: string, expected: string): Promise<boolean> {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function seal(
  secret: string,
  payload: Record<string, unknown>,
  ttlMs: number,
): Promise<string> {
  const body = base64UrlEncode(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  return `${body}.${await hmac(secret, body)}`;
}

export async function open<T extends { exp: number }>(
  secret: string,
  token: string,
): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  if (!(await signaturesMatch(signature, await hmac(secret, body)))) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(body)) as T;
    if (typeof parsed.exp !== "number" || parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("=")) || null;
  }
  return null;
}

function secureAttribute(requestUrl: string): string {
  return new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
}

export function writeCookie(
  name: string,
  value: string,
  requestUrl: string,
  maxAgeSeconds: number,
): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureAttribute(requestUrl)}`;
}

export function clearCookie(name: string, requestUrl: string): string {
  return `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureAttribute(requestUrl)}`;
}
