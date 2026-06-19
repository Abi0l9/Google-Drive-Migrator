const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }
  current.count += 1;
  return { allowed: current.count <= limit, remaining: Math.max(limit - current.count, 0) };
}
