/**
 * Fixed-window rate limiter keyed by client address, plus a concurrency gate. In memory, so
 * it is per process: behind several replicas use a shared store (docs/PRODUCT.md → Scalability).
 */
export function createRateLimiter({ max, windowMs, maxKeys = 10_000 }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();
  return {
    /** Consume one unit. Returns { ok, remaining, retryAfterSec }. */
    take(key, now = Date.now()) {
      let b = buckets.get(key);
      if (!b || now >= b.resetAt) {
        if (buckets.size >= maxKeys) {
          for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
          if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
        }
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(key, b);
      }
      if (b.count >= max) return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
      b.count += 1;
      return { ok: true, remaining: max - b.count, retryAfterSec: 0 };
    },
  };
}

export function createGate(limit) {
  let active = 0;
  return {
    active: () => active,
    tryEnter() {
      if (active >= limit) return false;
      active += 1;
      return true;
    },
    leave() {
      active = Math.max(0, active - 1);
    },
  };
}
