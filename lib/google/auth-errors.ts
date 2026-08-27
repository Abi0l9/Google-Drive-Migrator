export const GOOGLE_REAUTH_REQUIRED = "GOOGLE_REAUTH_REQUIRED" as const;

export class GoogleReauthorizationRequiredError extends Error {
  code = GOOGLE_REAUTH_REQUIRED;

  constructor(message = "Google Drive access needs to be reconnected. Sign in with Google again, then retry the migration.") {
    super(message);
    this.name = "GoogleReauthorizationRequiredError";
  }
}

export function isGoogleReauthorizationRequiredError(error: unknown): error is GoogleReauthorizationRequiredError {
  if (!isRecord(error)) return false;
  return error.code === GOOGLE_REAUTH_REQUIRED || error.name === "GoogleReauthorizationRequiredError";
}

export function isGoogleReauthorizationFailure(error: unknown) {
  if (!isRecord(error)) return false;

  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  const code = typeof error.code === "string" ? error.code.toLowerCase() : "";
  const status = numeric(error.status) ?? (isRecord(error.response) ? numeric(error.response.status) : undefined);
  const payload = isRecord(error.response) ? error.response.data : undefined;
  const payloadText = safeStringify(payload).toLowerCase();

  return (
    status === 401 ||
    code === "invalid_grant" ||
    code === "invalid_token" ||
    message.includes("invalid_grant") ||
    message.includes("invalid token") ||
    message.includes("token has been expired or revoked") ||
    payloadText.includes("invalid_grant") ||
    payloadText.includes("invalid_token") ||
    payloadText.includes("token has been expired or revoked")
  );
}

export function messageNeedsGoogleReauthorization(message?: string | null) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("google drive access needs to be reconnected") || normalized.includes("sign in with google again");
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeStringify(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
