import { decryptToken, encryptToken } from "@/lib/crypto";
import {
  type GdmUser,
  updateUserGoogleTokens,
} from "@/lib/cloudflare/d1";

const REFRESH_SKEW_MS = 2 * 60 * 1000;

export interface GoogleOAuthEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
}

export async function getFreshGoogleAccessTokenD1(env: GoogleOAuthEnv, user: GdmUser) {
  const accessToken = decryptToken(user.accessToken, env.TOKEN_ENCRYPTION_KEY);
  const refreshToken = decryptToken(user.refreshToken, env.TOKEN_ENCRYPTION_KEY);
  const expiresAt = user.accessTokenExpiresAt ? new Date(user.accessTokenExpiresAt).getTime() : 0;

  if (accessToken && expiresAt > Date.now() + REFRESH_SKEW_MS) return accessToken;

  if (!refreshToken) {
    if (accessToken) return accessToken;
    throw new Error("Google Drive authorization expired. Sign in with Google again.");
  }

  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json() as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    const detail = payload.error_description || payload.error || `HTTP ${response.status}`;
    throw new Error(`Unable to refresh Google Drive authorization (${detail}). Sign in with Google again.`);
  }

  const encryptedAccessToken = encryptToken(payload.access_token, env.TOKEN_ENCRYPTION_KEY);
  if (!encryptedAccessToken) throw new Error("Unable to store refreshed Google Drive authorization.");

  const rotatedRefreshToken = payload.refresh_token
    ? encryptToken(payload.refresh_token, env.TOKEN_ENCRYPTION_KEY)
    : undefined;
  const expiresAtIso = new Date(Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000).toISOString();

  await updateUserGoogleTokens(
    env.DB,
    user.id,
    encryptedAccessToken,
    expiresAtIso,
    rotatedRefreshToken,
  );

  return payload.access_token;
}
