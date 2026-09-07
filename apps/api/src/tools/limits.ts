import { TOOL_API_LIMITS } from '@harth/shared'

interface Bucket {
  tokens: number
  updatedAt: number
}

// 令牌桶，单进程内存；进程重启即清零
export class RateLimiter {
  private buckets = new Map<string, Bucket>()

  constructor(
    private perMinute: number,
    private burst: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, updatedAt: now }
    const refill = ((now - bucket.updatedAt) / 60_000) * this.perMinute
    bucket.tokens = Math.min(this.burst, bucket.tokens + refill)
    bucket.updatedAt = now
    const allowed = bucket.tokens >= 1
    if (allowed) bucket.tokens -= 1
    this.buckets.set(key, bucket)
    if (this.buckets.size > 10_000) this.prune(now)
    return allowed
  }

  reset(): void {
    this.buckets.clear()
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > 3_600_000) this.buckets.delete(key)
    }
  }
}

export const toolReadLimiter = new RateLimiter(TOOL_API_LIMITS.readsPerMinute, TOOL_API_LIMITS.readBurst)
export const toolWriteLimiter = new RateLimiter(TOOL_API_LIMITS.writesPerMinute, TOOL_API_LIMITS.writesPerMinute)
export const toolPostLimiter = new RateLimiter(TOOL_API_LIMITS.postsPerMinute, TOOL_API_LIMITS.postsPerMinute)

// 兑换每小时 20 次，申请每天 3 次
export const redeemLimiter = new RateLimiter(20 / 60, 20)
export const applyLimiter = new RateLimiter(3 / (24 * 60), 3)
