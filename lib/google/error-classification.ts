export type GoogleErrorClassification = "retryable" | "permanent" | "unknown";

const RETRYABLE_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "sharingRateLimitExceeded",
  "backendError",
  "internalError",
]);

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

interface ErrorLike {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  response?: {
    status?: unknown;
    data?: unknown;
  };
}

export function classifyGoogleDriveError(error: unknown): GoogleErrorClassification {
  const details = googleDriveErrorDetails(error);

  if (details.networkCode && RETRYABLE_NETWORK_CODES.has(details.networkCode)) {
    return "retryable";
  }

  if (details.reason && RETRYABLE_REASONS.has(details.reason)) {
    return "retryable";
  }

  if (details.status === 408 || details.status === 429 || (details.status !== undefined && details.status >= 500)) {
    return "retryable";
  }

  if (details.status === 400 || details.status === 401 || details.status === 404) {
    return "permanent";
  }

  if (details.status === 403) {
    return "permanent";
  }

  return "unknown";
}

export function googleDriveErrorDetails(error: unknown) {
  const candidate = isRecord(error) ? error as ErrorLike : undefined;
  const response = candidate?.response;
  const status = numberValue(response?.status) ?? numberValue(candidate?.status) ?? statusFromMessage(candidate?.message);
  const reason = reasonFromPayload(response?.data);
  const networkCode = typeof candidate?.code === "string" ? candidate.code : undefined;
  const message = typeof candidate?.message === "string" ? candidate.message : "Google Drive request failed";

  return { status, reason, networkCode, message };
}

function reasonFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  const nestedError = isRecord(payload.error) ? payload.error : undefined;
  const nestedErrors = Array.isArray(nestedError?.errors) ? nestedError.errors : undefined;
  const firstNested = nestedErrors?.find(isRecord);
  if (typeof firstNested?.reason === "string") return firstNested.reason;

  const directErrors = Array.isArray(payload.errors) ? payload.errors : undefined;
  const firstDirect = directErrors?.find(isRecord);
  if (typeof firstDirect?.reason === "string") return firstDirect.reason;

  if (typeof payload.reason === "string") return payload.reason;
  return undefined;
}

function statusFromMessage(message: unknown) {
  if (typeof message !== "string") return undefined;
  const match = message.match(/\((\d{3})\)/);
  return match ? Number(match[1]) : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
