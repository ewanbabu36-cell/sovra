/**
 * @file packages/shared/src/hardening.ts
 * API Hardening: Request Size Limits, Rate Limiting, and Origin Policy.
 */

export interface RateLimiterOptions {
  readonly capacity: number;
  readonly refillRatePerSecond: number;
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private readonly capacity = 60,
    private readonly refillRatePerSecond = 10,
  ) {}

  /**
   * Consumes tokens for a key (IP address or DID). Returns true if allowed, false if rate limited.
   */
  public consume(key: string, tokensToConsume = 1): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      const refilled = elapsedSeconds * this.refillRatePerSecond;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + refilled);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= tokensToConsume) {
      bucket.tokens -= tokensToConsume;
      return true;
    }

    return false;
  }

  public reset(key: string): void {
    this.buckets.delete(key);
  }

  public clear(): void {
    this.buckets.clear();
  }
}

export interface SecurityPolicyConfig {
  readonly maxJsonBytes: number;
  readonly maxUploadBytes: number;
  readonly trustedOrigins: readonly string[];
  readonly isProduction: boolean;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicyConfig = {
  maxJsonBytes: 1024 * 1024, // 1 MB
  maxUploadBytes: 10 * 1024 * 1024, // 10 MB
  trustedOrigins: ['http://localhost:3001', 'http://127.0.0.1:3001'],
  isProduction: process.env.NODE_ENV === 'production',
};

/**
 * Validates request Origin against configured trusted origins.
 * In development, allows localhost / loopback.
 * In production, rejects wildcards and untrusted origins.
 */
export function resolveAllowedOrigin(
  requestOrigin: string | undefined,
  config: SecurityPolicyConfig = DEFAULT_SECURITY_POLICY,
): string | null {
  if (!config.isProduction) {
    return requestOrigin || '*';
  }

  if (!requestOrigin) {
    return null; // Reject browser requests without origin in production
  }

  if (config.trustedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}
