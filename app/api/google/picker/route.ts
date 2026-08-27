import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import { getUserByEmail } from "@/lib/cloudflare/d1";
import { getFreshGoogleAccessTokenD1 } from "@/lib/google/user-auth-d1";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: noStoreHeaders });
  }

  const cloudflare = getGdmCloudflareEnv();
  const pickerConfigured =
    cloudflare.GOOGLE_PICKER_API_KEY?.startsWith("AIza") &&
    /^\d+$/.test(cloudflare.GOOGLE_CLOUD_PROJECT_NUMBER ?? "");
  if (!pickerConfigured) {
    return NextResponse.json(
      { error: "Google Picker is not configured. Paste a destination folder URL or ID instead." },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const user = await getUserByEmail(cloudflare.DB, session.user.email);
  if (!user?.accessToken) {
    return NextResponse.json({ error: "Google Drive authorization required" }, { status: 403, headers: noStoreHeaders });
  }

  const quota = await cloudflare.PICKER_RATE_LIMITER.limit({ key: `picker-token:${user.id}` });
  if (!quota.success) {
    return NextResponse.json(
      { error: "Too many Picker requests. Try again in a minute." },
      { status: 429, headers: noStoreHeaders },
    );
  }

  try {
    const accessToken = await getFreshGoogleAccessTokenD1(cloudflare, user);
    return NextResponse.json(
      {
        accessToken,
        developerKey: cloudflare.GOOGLE_PICKER_API_KEY,
        appId: cloudflare.GOOGLE_CLOUD_PROJECT_NUMBER,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to authorize Google Picker" },
      { status: 403, headers: noStoreHeaders },
    );
  }
}
