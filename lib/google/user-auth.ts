import { google } from "googleapis";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { env } from "@/lib/env";

interface GoogleTokenUser {
  accessToken?: string | null;
  refreshToken?: string | null;
  accessTokenExpiresAt?: Date | string | null;
  save(): Promise<unknown>;
}

const REFRESH_SKEW_MS = 2 * 60 * 1000;

export async function getFreshGoogleAccessToken(user: GoogleTokenUser) {
  const accessToken = decryptToken(user.accessToken);
  const refreshToken = decryptToken(user.refreshToken);
  const expiresAt = user.accessTokenExpiresAt ? new Date(user.accessTokenExpiresAt).getTime() : 0;

  if (accessToken && expiresAt > Date.now() + REFRESH_SKEW_MS) {
    return accessToken;
  }

  if (!refreshToken) {
    if (accessToken) return accessToken;
    throw new Error("Google Drive authorization expired. Sign in with Google again.");
  }

  const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  const response = await oauth2.getAccessToken();
  const refreshedAccessToken = response.token ?? oauth2.credentials.access_token;
  if (!refreshedAccessToken) {
    throw new Error("Unable to refresh Google Drive authorization. Sign in with Google again.");
  }

  const encryptedAccessToken = encryptToken(refreshedAccessToken);
  if (!encryptedAccessToken) throw new Error("Unable to store refreshed Google Drive authorization.");

  user.accessToken = encryptedAccessToken;
  if (oauth2.credentials.expiry_date) {
    user.accessTokenExpiresAt = new Date(oauth2.credentials.expiry_date);
  }
  if (oauth2.credentials.refresh_token) {
    const rotatedRefreshToken = encryptToken(oauth2.credentials.refresh_token);
    if (rotatedRefreshToken) user.refreshToken = rotatedRefreshToken;
  }
  await user.save();

  return refreshedAccessToken;
}
