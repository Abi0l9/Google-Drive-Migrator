import { NextResponse } from "next/server";
import { z } from "zod";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import { analyzePublicFolder } from "@/lib/google/drive-rest";

const AnalyzeRequest = z.object({ folderUrl: z.string().url() });

export async function POST(request: Request) {
  const cloudflare = getGdmCloudflareEnv();
  if (!cloudflare.GOOGLE_API_KEY?.startsWith("AIza")) {
    return NextResponse.json({ error: "Google Drive API key is not configured" }, { status: 500 });
  }

  const clientIp =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anonymous";
  const quota = await cloudflare.API_RATE_LIMITER.limit({ key: `analyze:${clientIp}` });
  if (!quota.success) {
    return NextResponse.json({ error: "Too many analyze requests" }, { status: 429 });
  }

  const parsed = AnalyzeRequest.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Google Drive Folder URL" }, { status: 400 });
  }

  try {
    const analysis = await analyzePublicFolder(cloudflare.GOOGLE_API_KEY, parsed.data.folderUrl);
    return NextResponse.json(analysis);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Folder is not publicly accessible" },
      { status: 400 },
    );
  }
}
