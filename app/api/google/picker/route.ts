import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import { env, isGooglePickerConfigured } from "@/lib/env";
import { getFreshGoogleAccessToken } from "@/lib/google/user-auth";
import { rateLimit } from "@/lib/rate-limit";
import { User } from "@/models/user";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: noStoreHeaders });
  }

  if (!isGooglePickerConfigured()) {
    return NextResponse.json(
      { error: "Google Drive destination selection is temporarily unavailable." },
      { status: 503, headers: noStoreHeaders },
    );
  }

  await connectDb();
  const user = await User.findOne({ email: session.user.email });
  if (!user?.accessToken) {
    return NextResponse.json({ error: "Google Drive authorization required" }, { status: 403, headers: noStoreHeaders });
  }

  const quota = await rateLimit(`picker-token:${user._id.toString()}`, 20, 60_000);
  if (!quota.allowed) {
    return NextResponse.json({ error: "Too many Picker requests. Try again in a minute." }, { status: 429, headers: noStoreHeaders });
  }

  try {
    const accessToken = await getFreshGoogleAccessToken(user);
    return NextResponse.json(
      {
        accessToken,
        developerKey: env.googlePickerApiKey,
        appId: env.googleCloudProjectNumber,
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
