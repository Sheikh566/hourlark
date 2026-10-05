import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { normalizeEmail } from "@/domain/normalization";
import { ApiError } from "@/worker/errors";

const googleCerts = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export function assertGoogleIdentity(
  payload: JWTPayload,
  nonce: string,
): { subject: string; email: string } {
  if (payload.nonce !== nonce) {
    throw new ApiError(400, "oauth_state_invalid", "The sign-in attempt expired. Try again.");
  }
  if (payload.email_verified !== true) {
    throw new ApiError(
      400,
      "google_email_unverified",
      "Google has not verified this email address.",
    );
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new ApiError(400, "google_signin_failed", "Google did not return an account id.");
  }
  if (typeof payload.email !== "string" || !payload.email) {
    throw new ApiError(400, "google_signin_failed", "Google did not return an email address.");
  }
  return { subject: payload.sub, email: normalizeEmail(payload.email) };
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  nonce: string,
): Promise<{ subject: string; email: string }> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, googleCerts, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
      algorithms: ["RS256"],
    }));
  } catch {
    throw new ApiError(400, "google_signin_failed", "Google sign-in could not be verified.");
  }
  return assertGoogleIdentity(payload, nonce);
}

export function googleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeGoogleCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new ApiError(400, "google_signin_failed", "Google sign-in did not complete.");
  }
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string" || !body.id_token) {
    throw new ApiError(400, "google_signin_failed", "Google sign-in did not complete.");
  }
  return body.id_token;
}
