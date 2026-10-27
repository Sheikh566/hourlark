// Prints a new VAPID key pair for Web Push in .dev.vars / Wrangler secrets format.
// Usage: pnpm push:keys [mailto:ops@example.com]
const subject = process.argv[2] ?? "mailto:admin@example.com";
if (!/^(mailto:|https:)/.test(subject)) {
  console.error("The VAPID subject must start with mailto: or https:.");
  process.exit(1);
}

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString(
  "base64url",
);
const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
console.log(`VAPID_SUBJECT=${subject}`);
