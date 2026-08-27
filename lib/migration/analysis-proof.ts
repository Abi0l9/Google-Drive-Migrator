import { z } from "zod";
import { decryptToken, encryptToken } from "@/lib/crypto";

const ANALYSIS_PROOF_MAX_AGE_MS = 30 * 60 * 1000;
const ANALYSIS_PROOF_CLOCK_SKEW_MS = 60 * 1000;

const AnalysisProofPayload = z.object({
  folderId: z.string().min(1),
  folderName: z.string().min(1),
  files: z.number().int().min(0),
  folders: z.number().int().min(0),
  size: z.number().int().min(0),
  issuedAt: z.number().int().positive(),
});

export interface AnalysisProofInput {
  folderId: string;
  folderName: string;
  files: number;
  folders: number;
  size: number;
}

export interface VerifiedAnalysisProof extends AnalysisProofInput {
  issuedAt: number;
}

export function issueAnalysisProof(analysis: AnalysisProofInput, now = Date.now()) {
  const payload = AnalysisProofPayload.parse({ ...analysis, issuedAt: now });
  const token = encryptToken(JSON.stringify(payload));
  if (!token) throw new Error("Unable to create folder analysis proof");
  return token;
}

export function verifyAnalysisProof(
  token: string,
  expectedFolderId: string,
  now = Date.now(),
): VerifiedAnalysisProof | null {
  try {
    const decrypted = decryptToken(token);
    if (!decrypted) return null;

    const parsedJson = JSON.parse(decrypted) as unknown;
    const parsed = AnalysisProofPayload.safeParse(parsedJson);
    if (!parsed.success) return null;

    if (parsed.data.folderId !== expectedFolderId) return null;
    if (parsed.data.issuedAt > now + ANALYSIS_PROOF_CLOCK_SKEW_MS) return null;
    if (now - parsed.data.issuedAt > ANALYSIS_PROOF_MAX_AGE_MS) return null;

    return parsed.data;
  } catch {
    return null;
  }
}
