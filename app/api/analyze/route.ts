import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzePublicFolder } from "@/lib/google/drive";
import { isGoogleApiKeyConfigured } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";

const AnalyzeRequest = z.object({ folderUrl: z.string().url() });

export async function POST(request: Request) {
  if (!isGoogleApiKeyConfigured()) {
    return NextResponse.json({ error: "Google Drive API key is not configured" }, { status: 500 });
  }

  const clientIp = request.headers.get("x-forwarded-for") ?? "anonymous";
  const quota = rateLimit(`analyze:${clientIp}`);
  if (!quota.allowed) return NextResponse.json({ error: "Too many analyze requests" }, { status: 429 });
  const parsed = AnalyzeRequest.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid Google Drive Folder URL" }, { status: 400 });
  try {
    const analysis = await analyzePublicFolder(parsed.data.folderUrl);
    return NextResponse.json(analysis);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Folder is not publicly accessible" }, { status: 400 });
  }
}
