export const env = {
  mongoUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/drive-migrator",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  googleApiKey: process.env.GOOGLE_API_KEY ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  nextAuthSecret: process.env.NEXTAUTH_SECRET ?? "development-secret",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET ?? "development-secret",
};

function isPlaceholder(value: string, fragments: string[]) {
  return !value || fragments.some((fragment) => value.includes(fragment));
}

export function isGoogleOAuthConfigured() {
  return (
    env.googleClientId.endsWith(".apps.googleusercontent.com") &&
    !isPlaceholder(env.googleClientId, ["google-oauth-client-id", "client-id", "replace"]) &&
    !isPlaceholder(env.googleClientSecret, ["google-oauth-client-secret", "client-secret", "replace"])
  );
}

export function isGoogleApiKeyConfigured() {
  return env.googleApiKey.startsWith("AIza") && !isPlaceholder(env.googleApiKey, ["public-folder-api-key", "api-key", "replace"]);
}
