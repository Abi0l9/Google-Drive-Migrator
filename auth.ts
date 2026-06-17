import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { env } from "@/lib/env";
import { encryptToken } from "@/lib/crypto";
import { connectDb } from "@/lib/db";
import { User } from "@/models/user";

export const { handlers: { GET, POST }, auth, signIn, signOut } = NextAuth({
  secret: env.nextAuthSecret,
  providers: [
    Google({
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        if (token.email && account.access_token) {
          await connectDb();
          const encryptedRefreshToken = encryptToken(account.refresh_token);
          await User.findOneAndUpdate(
            { email: token.email },
            {
              $set: {
                name: token.name ?? token.email,
                email: token.email,
                image: token.picture,
                googleId: account.providerAccountId,
                accessToken: encryptToken(account.access_token),
                ...(encryptedRefreshToken ? { refreshToken: encryptedRefreshToken } : {}),
              },
              $setOnInsert: {
                refreshToken: encryptedRefreshToken ?? "",
              },
            },
            { upsert: true, new: true },
          );
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      return session;
    },
  },
});
