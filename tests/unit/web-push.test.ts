import { base64url, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import {
  encryptPushPayload,
  isPushServiceEndpoint,
  vapidAuthorization,
} from "@/worker/services/web-push";

describe("Web Push encryption", () => {
  it("matches the RFC 8291 section 5 example", async () => {
    const encrypted = await encryptPushPayload(
      {
        p256dh:
          "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      {
        senderPrivateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
        senderPublicKey:
          "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
        salt: base64url.decode("DGv6ra1nlYgDCS1FRnbzlw") as Uint8Array<ArrayBuffer>,
      },
    );

    expect(base64url.encode(encrypted)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("rejects malformed browser keys", async () => {
    await expect(
      encryptPushPayload({ p256dh: "AAAA", auth: "BTBZMqHH6r4Tts7J_aSIgg" }, new Uint8Array(1)),
    ).rejects.toThrow("p256dh");
  });
});

describe("VAPID", () => {
  it("signs an ES256 token for the push service origin", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    const publicKey = base64url.encode(
      new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer),
    );
    const now = Date.UTC(2026, 9, 27, 12);

    const header = await vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      { publicKey, privateKey: jwk.d ?? "", subject: "mailto:ops@example.com" },
      now,
    );

    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match?.[2]).toBe(publicKey);
    const token = match?.[1] ?? "";
    expect(decodeProtectedHeader(token)).toEqual({ typ: "JWT", alg: "ES256" });
    const verified = await jwtVerify(
      token,
      await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, "ES256"),
      {
        currentDate: new Date(now),
      },
    );
    expect(verified.payload).toMatchObject({
      aud: "https://fcm.googleapis.com",
      sub: "mailto:ops@example.com",
      exp: now / 1000 + 12 * 60 * 60,
    });
  });
});

describe("push endpoint allowlist", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/abc",
    "https://evilfcm.googleapis.com.example.com/abc",
    "https://example.com/push",
    "https://user:pass@fcm.googleapis.com/abc",
    "not a url",
  ])("rejects %s", (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });
});
