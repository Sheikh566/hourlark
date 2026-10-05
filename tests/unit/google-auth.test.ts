import { assertGoogleIdentity } from "@/worker/auth/google";
import { open, seal, type SessionClaims } from "@/worker/auth/session";
import { describe, expect, it } from "vitest";

const secret = "test-only-csrf-secret-at-least-24-characters";

describe("Google identity claims", () => {
  it("accepts a verified email and matching nonce", () => {
    expect(
      assertGoogleIdentity(
        {
          sub: "google-subject",
          email: " SheikH.Abdullah@IOMechs.com ",
          email_verified: true,
          nonce: "nonce",
        },
        "nonce",
      ),
    ).toEqual({ subject: "google-subject", email: "sheikh.abdullah@iomechs.com" });
  });

  it("rejects an unverified email and a mismatched nonce", () => {
    expect(() =>
      assertGoogleIdentity(
        {
          sub: "google-subject",
          email: "member@iomechs.com",
          email_verified: false,
          nonce: "nonce",
        },
        "nonce",
      ),
    ).toThrowError(expect.objectContaining({ code: "google_email_unverified" }));
    expect(() =>
      assertGoogleIdentity(
        {
          sub: "google-subject",
          email: "member@iomechs.com",
          email_verified: true,
          nonce: "other",
        },
        "nonce",
      ),
    ).toThrowError(expect.objectContaining({ code: "oauth_state_invalid" }));
  });
});

describe("sign-in session", () => {
  it("round-trips a sealed session and rejects tampering", async () => {
    const token = await seal(
      secret,
      { memberId: "member", email: "member@iomechs.com", subject: "google-subject" },
      60_000,
    );
    const opened = await open<SessionClaims>(secret, token);
    expect(opened).toMatchObject({
      memberId: "member",
      email: "member@iomechs.com",
      subject: "google-subject",
    });
    expect(await open<SessionClaims>(secret, `${token}x`)).toBeNull();
    expect(await open<SessionClaims>("another-secret-at-least-24-characters", token)).toBeNull();
  });
});
