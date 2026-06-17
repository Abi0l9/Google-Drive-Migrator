import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function key() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET ?? "development-secret";
  return createHash("sha256").update(secret).digest();
}

export function encryptToken(token?: string | null) {
  if (!token) return undefined;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptToken(payload?: string | null) {
  if (!payload) return undefined;
  const [iv, tag, encrypted] = payload.split(".");
  if (!iv || !tag || !encrypted) return undefined;
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
