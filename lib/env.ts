export const env = {
  mongoUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/drive-migrator",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  nextAuthSecret: process.env.NEXTAUTH_SECRET ?? "development-secret",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET ?? "development-secret",
};
