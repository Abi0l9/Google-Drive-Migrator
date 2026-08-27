import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { encryptToken } from "@/lib/crypto";
import { upsertUser } from "@/lib/cloudflare/d1";
import { getGdmCloudflareEnvAsync } from "@/lib/cloudflare/context";

export const { handlers: { GET, POST }, auth, signIn, signOut } = NextAuth(async () => {
  const cloudflare = await getGdmCloudflareEnvAsync();

  return {
    secret: cloudflare.NEXTAUTH_SECRET,
    trustHost: true,
    basePath: "/api/auth",
    providers: [
      Google({
        clientId: cloudflare.GOOGLE_CLIENT_ID,
        clientSecret: cloudflare.GOOGLE_CLIENT_SECRET,
        authorization: {
          params: {
            scope: "openid email profile https://www.googleapis.com/auth/drive.file",
            access_type: "offline",
            prompt: "consent",
          },
        },
      }),
    ],
    callbacks: {
      async jwt({ token, account }) {
        if (account && token.email && account.access_token) {
          const encryptedAccessToken = encryptToken(account.access_token, cloudflare.TOKEN_ENCRYPTION_KEY);
          const encryptedRefreshToken = encryptToken(account.refresh_token, cloudflare.TOKEN_ENCRYPTION_KEY);
          if (!encryptedAccessToken) throw new Error("Unable to store Google authorization");

          await upsertUser(cloudflare.DB, {
            name: token.name ?? token.email,
            email: token.email,
            image: typeof token.picture === "string" ? token.picture : null,
            googleId: account.providerAccountId,
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            accessTokenExpiresAt: account.expires_at
              ? new Date(account.expires_at * 1000).toISOString()
              : null,
          });
        }
        return token;
      },
    },
  };
});
