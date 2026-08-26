export function normalizeActiveMigrationLimit(value: string | number | undefined, fallback = 3) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.max(1, Math.floor(parsed));
}

export function canCreateActiveMigration(activeCount: number, maxActive: number) {
  return Math.max(0, activeCount) < Math.max(1, maxActive);
}
