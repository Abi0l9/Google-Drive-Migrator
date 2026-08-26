import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function encryptionSecret(explicitSecret?: string) {
  if (explicitSecret) return explicitSecret;
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("TOKEN_ENCRYPTION_KEY or NEXTAUTH_SECRET must be configured in production");
  }
  return "development-secret";
}

function key(secret?: string) {
  return createHash("sha256").update(encryptionSecret(secret)).digest();
}

export function encryptToken(token?: string | null, secret?: string) {
  if (!token) return undefined;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptToken(payload?: string | null, secret?: string) {
  if (!payload) return undefined;
  const [iv, tag, encrypted] = payload.split(".");
  if (!iv || !tag || !encrypted) return undefined;
  const decipher = createDecipheriv(ALGORITHM, key(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
