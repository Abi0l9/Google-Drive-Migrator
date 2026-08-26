export const DEFAULT_DAILY_QUEUE_MESSAGE_BUDGET = 2200;
export const MAX_DAILY_QUEUE_MESSAGE_BUDGET = 2500;

export class FreeTierCapacityError extends Error {
  code = "GDM_FREE_TIER_CAPACITY";

  constructor(message = "GDM has reached today's free Cloudflare migration capacity. Resume after the next 00:00 UTC reset.") {
    super(message);
    this.name = "FreeTierCapacityError";
  }
}

export function normalizeDailyQueueMessageBudget(value?: string | number | null) {
  const parsed = typeof value === "number" ? value : Number(value ?? DEFAULT_DAILY_QUEUE_MESSAGE_BUDGET);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DAILY_QUEUE_MESSAGE_BUDGET;
  return Math.min(MAX_DAILY_QUEUE_MESSAGE_BUDGET, Math.floor(parsed));
}

export function utcUsageDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function nextUtcReset(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

export function estimatedQueueOperations(messageCount: number, retryReads = 0) {
  return Math.max(0, Math.floor(messageCount)) * 3 + Math.max(0, Math.floor(retryReads));
}
