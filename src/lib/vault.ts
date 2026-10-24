import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Connector tokens and API keys at rest: AES-256-GCM under CONNECTOR_SECRET_KEY.
// ponytail: one master key from the environment; move to KMS-wrapped per-agency
// data keys (envelope encryption) before production, as the integration plan says.

function key() {
  const k = Buffer.from(process.env.CONNECTOR_SECRET_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("CONNECTOR_SECRET_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32).");
  return k;
}

export function seal(value: unknown): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function unseal<T>(blob: Buffer): T {
  const d = createDecipheriv("aes-256-gcm", key(), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8")) as T;
}

/** Tamper-proof, expiring token (OAuth state): base64url(payload).hmac */
export function sign(payload: object, ttlSeconds = 600) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  return `${body}.${createHmac("sha256", key()).update(body).digest("base64url")}`;
}

export function verify<T>(token: string): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
  return data.exp >= Date.now() / 1000 ? data : null;
}

/** Constant-time compare for webhook signatures. */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
