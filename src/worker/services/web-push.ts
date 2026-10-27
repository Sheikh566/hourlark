import { base64url, importJWK, SignJWT } from "jose";

/**
 * Minimal Web Push sender for Workers: RFC 8291 message encryption (aes128gcm) with WebCrypto and
 * RFC 8292 VAPID authentication with `jose`. The `web-push` npm package depends on Node crypto.
 */

export interface PushTarget {
  endpoint: string;
  /** Browser's P-256 public key, base64url uncompressed point. */
  p256dh: string;
  /** Browser's 16-byte authentication secret, base64url. */
  auth: string;
}

export interface VapidKeys {
  /** Base64url uncompressed P-256 point (65 bytes); also the browser's `applicationServerKey`. */
  publicKey: string;
  /** Base64url 32-byte private scalar. */
  privateKey: string;
  /** `mailto:` or `https:` contact for push services. */
  subject: string;
}

const RECORD_SIZE = 4096;
const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

function decodePoint(value: string, label: string): Uint8Array<ArrayBuffer> {
  const bytes = base64url.decode(value) as Uint8Array<ArrayBuffer>;
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error(`${label} must be an uncompressed P-256 point.`);
  }
  return bytes;
}

function pointToJwk(point: Uint8Array, d?: string): JsonWebKey {
  return {
    kty: "EC",
    crv: "P-256",
    x: base64url.encode(point.slice(1, 33)),
    y: base64url.encode(point.slice(33, 65)),
    ...(d ? { d } : {}),
  };
}

export interface EncryptionInputs {
  /** Fixed sender key pair and salt for RFC 8291 test vectors; random otherwise. */
  senderPrivateKey?: string;
  senderPublicKey?: string;
  salt?: Uint8Array<ArrayBuffer>;
}

/** Encrypts one push message as a single aes128gcm record (RFC 8291 section 3.4). */
export async function encryptPushPayload(
  target: Pick<PushTarget, "p256dh" | "auth">,
  plaintext: Uint8Array<ArrayBuffer>,
  inputs: EncryptionInputs = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const receiverPublic = decodePoint(target.p256dh, "p256dh");
  const authSecret = base64url.decode(target.auth) as Uint8Array<ArrayBuffer>;
  if (authSecret.length !== 16) throw new Error("auth must be 16 bytes.");

  let senderPrivate: CryptoKey;
  let senderPublic: Uint8Array<ArrayBuffer>;
  if (inputs.senderPrivateKey && inputs.senderPublicKey) {
    senderPublic = decodePoint(inputs.senderPublicKey, "sender public key");
    senderPrivate = await crypto.subtle.importKey(
      "jwk",
      pointToJwk(senderPublic, inputs.senderPrivateKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    senderPrivate = pair.privateKey;
    senderPublic = new Uint8Array(
      (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
    );
  }

  const receiverKey = await crypto.subtle.importKey(
    "raw",
    receiverPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, senderPrivate, 256),
  );

  const keyInfo = concat(encoder.encode("WebPush: info\0"), receiverPublic, senderPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const salt = inputs.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  // A single record ends with the 0x02 delimiter and carries no padding.
  const record = concat(plaintext, new Uint8Array([2]));
  if (record.length + 16 > RECORD_SIZE) throw new Error("Push payload is too large.");
  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record),
  );

  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, ciphertext);
}

/** RFC 8292 `Authorization` header value for one push service origin. */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now = Date.now(),
): Promise<string> {
  const publicPoint = decodePoint(keys.publicKey, "VAPID public key");
  const privateKey = await importJWK(pointToJwk(publicPoint, keys.privateKey), "ES256");
  const token = await new SignJWT({ sub: keys.subject })
    .setProtectedHeader({ typ: "JWT", alg: "ES256" })
    .setAudience(new URL(endpoint).origin)
    .setExpirationTime(Math.floor(now / 1000) + 12 * 60 * 60)
    .sign(privateKey);
  return `vapid t=${token}, k=${keys.publicKey}`;
}

/**
 * Hosts of the browser push services. Subscriptions are only accepted for these, so the Worker
 * never posts to an arbitrary client-supplied URL.
 */
const pushServiceHosts = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "notify.windows.com",
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  return pushServiceHosts.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
}

export interface PushMessage {
  title: string;
  body: string;
  /** Replaces an earlier notification with the same tag on the device. */
  tag: string;
}

/** Sends one push; returns the push service status (201 on success, 404/410 when expired). */
export async function sendPush(
  target: PushTarget,
  message: PushMessage,
  keys: VapidKeys,
): Promise<number> {
  const body = await encryptPushPayload(target, encoder.encode(JSON.stringify(message)));
  const response = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(12 * 60 * 60),
      Urgency: "normal",
    },
    body,
    // Push services answer directly; following a redirect would forward the VAPID header.
    redirect: "manual",
  });
  // The body is unused; cancel it so the connection is released.
  await response.body?.cancel();
  return response.status;
}
