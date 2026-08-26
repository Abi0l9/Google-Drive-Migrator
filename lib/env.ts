import { normalizeActiveMigrationLimit } from "@/lib/migration/quota";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const env = {
  mongoUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/drive-migrator",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  googleApiKey: process.env.GOOGLE_API_KEY ?? "",
  googlePickerApiKey: process.env.GOOGLE_PICKER_API_KEY ?? "",
  googleCloudProjectNumber: process.env.GOOGLE_CLOUD_PROJECT_NUMBER ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  nextAuthSecret: process.env.NEXTAUTH_SECRET ?? "development-secret",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET ?? "development-secret",
  maxActiveMigrationsPerUser: normalizeActiveMigrationLimit(process.env.MAX_ACTIVE_MIGRATIONS_PER_USER),
  adminEmails,
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

export function isGooglePickerConfigured() {
  return (
    env.googlePickerApiKey.startsWith("AIza") &&
    !isPlaceholder(env.googlePickerApiKey, ["picker-browser-api-key", "api-key", "replace"]) &&
    /^\d+$/.test(env.googleCloudProjectNumber) &&
    !isPlaceholder(env.googleCloudProjectNumber, ["cloud-project-number", "project-number", "replace"])
  );
}

export function isAdminEmail(email: string | null | undefined) {
  return Boolean(email && env.adminEmails.includes(email.toLowerCase()));
}
