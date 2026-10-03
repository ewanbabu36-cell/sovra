/**
 * Time and Monotonic Clock Utilities
 */

export class MonotonicClock {
  private baseTimestamp: number;
  private readonly startPerf: number;

  constructor() {
    this.baseTimestamp = Date.now();
    this.startPerf = performance.now();
  }

  /**
   * Returns current unix timestamp in seconds, derived monotonically
   * to resist system clock rollbacks and tampering.
   */
  public nowSeconds(): number {
    const elapsedMs = performance.now() - this.startPerf;
    return Math.floor((this.baseTimestamp + elapsedMs) / 1000);
  }

  /**
   * Returns current unix timestamp in milliseconds monotonically.
   */
  public nowMillis(): number {
    const elapsedMs = performance.now() - this.startPerf;
    return Math.floor(this.baseTimestamp + elapsedMs);
  }
}
