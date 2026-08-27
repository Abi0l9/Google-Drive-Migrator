export const DEFAULT_MAX_ACTIVE_MIGRATIONS_PER_USER = 3;
export const DEFAULT_MAX_MONTHLY_TRANSFER_BYTES_PER_USER = 100 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_MONTHLY_TRANSFER_FILES_PER_USER = 100_000;

export interface MonthlyUsage {
  bytes: number;
  files: number;
}

export interface MonthlyUsageLimits {
  bytes: number;
  files: number;
}

export function normalizeActiveMigrationLimit(
  value: string | number | undefined,
  fallback = DEFAULT_MAX_ACTIVE_MIGRATIONS_PER_USER,
) {
  return normalizePositiveInteger(value, fallback);
}

export function normalizeMonthlyTransferBytesLimit(
  value: string | number | undefined,
  fallback = DEFAULT_MAX_MONTHLY_TRANSFER_BYTES_PER_USER,
) {
  return normalizePositiveInteger(value, fallback);
}

export function normalizeMonthlyTransferFilesLimit(
  value: string | number | undefined,
  fallback = DEFAULT_MAX_MONTHLY_TRANSFER_FILES_PER_USER,
) {
  return normalizePositiveInteger(value, fallback);
}

export function canCreateActiveMigration(activeCount: number, maxActive: number) {
  return Math.max(0, activeCount) < Math.max(1, maxActive);
}

export function usagePeriodFor(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function canReserveMonthlyUsage(
  current: MonthlyUsage,
  requested: MonthlyUsage,
  limits: MonthlyUsageLimits,
) {
  const currentBytes = Math.max(0, current.bytes);
  const currentFiles = Math.max(0, current.files);
  const requestedBytes = Math.max(0, requested.bytes);
  const requestedFiles = Math.max(0, requested.files);

  return (
    currentBytes + requestedBytes <= Math.max(1, limits.bytes) &&
    currentFiles + requestedFiles <= Math.max(1, limits.files)
  );
}

function normalizePositiveInteger(value: string | number | undefined, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.max(1, Math.floor(parsed));
}
