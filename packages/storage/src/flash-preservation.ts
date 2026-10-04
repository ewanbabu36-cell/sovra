/**
 * @file packages/storage/src/flash-preservation.ts
 * Pillar 2: Mobile Flash Wear-Out Protection & Tiered Memory Ring Buffer.
 *
 * Real-world problem:
 * Budget Android devices (eMMC 5.1 / UFS 2.1) suffer severe NAND flash cell wear-out
 * and OS OOM kills if P2P nodes continuously write ephemeral gossip and video chunks to disk.
 *
 * Solution:
 * 1. Volatile In-Memory Ring Buffer (48MB default) for transit & speculative blocks (0 disk writes).
 * 2. Daily Flash Write Budget: min(250, FreeStorageMb * 0.02 * (Battery / 100)).
 * 3. Storage-Aware Mode State Machine (normal, restricted, diskless_forwarder).
 * 4. Write Coalescing to reduce Write Amplification Factor (WAF).
 */

export type StorageAwareMode = 'normal' | 'restricted' | 'diskless_forwarder';

export interface StorageHealthMetrics {
  readonly totalStorageMb: number;
  readonly availableStorageMb: number;
  readonly batteryLevel: number; // 0 to 100
  readonly isCharging?: boolean | undefined;
}

export interface StorageModeEvaluation {
  readonly mode: StorageAwareMode;
  readonly freeStoragePercent: number;
  readonly dailyWriteBudgetMb: number;
  readonly diskWritesAllowed: boolean;
  readonly nonEssentialCachingAllowed: boolean;
  readonly coalescingWindowMs: number;
}

/**
 * Calculates Daily Flash Write Budget (MB):
 * Max Daily Disk Write = min(250, AvailableStorageMb * 0.02 * (BatteryLevel / 100))
 */
export function calculateDailyFlashWriteBudget(availableStorageMb: number, batteryLevel: number): number {
  const safeStorage = Math.max(0, availableStorageMb);
  const safeBattery = Math.max(0, Math.min(100, batteryLevel));
  const rawBudget = safeStorage * 0.02 * (safeBattery / 100);
  return Math.round(Math.min(250, rawBudget) * 100) / 100;
}

/**
 * Evaluates storage-aware node operational mode based on free disk percentage and battery.
 */
export function evaluateStorageAwareMode(metrics: StorageHealthMetrics): StorageModeEvaluation {
  const freePercent =
    metrics.totalStorageMb > 0
      ? (metrics.availableStorageMb / metrics.totalStorageMb) * 100
      : 0;

  const dailyBudget = calculateDailyFlashWriteBudget(metrics.availableStorageMb, metrics.batteryLevel);

  if (freePercent < 10) {
    return {
      mode: 'diskless_forwarder',
      freeStoragePercent: Math.round(freePercent * 10) / 10,
      dailyWriteBudgetMb: 0,
      diskWritesAllowed: false,
      nonEssentialCachingAllowed: false,
      coalescingWindowMs: 0,
    };
  }

  if (freePercent < 20) {
    return {
      mode: 'restricted',
      freeStoragePercent: Math.round(freePercent * 10) / 10,
      dailyWriteBudgetMb: dailyBudget,
      diskWritesAllowed: true,
      nonEssentialCachingAllowed: false,
      coalescingWindowMs: 60000, // 60s batching
    };
  }

  return {
    mode: 'normal',
    freeStoragePercent: Math.round(freePercent * 10) / 10,
    dailyWriteBudgetMb: dailyBudget,
    diskWritesAllowed: true,
    nonEssentialCachingAllowed: true,
    coalescingWindowMs: 30000,
  };
}

export interface RingBufferBlock {
  readonly cid: string;
  readonly data: Uint8Array;
  readonly size: number;
  readonly insertedAt: number;
}

/**
 * Flash-Preserving Volatile RAM Ring Buffer:
 * Stores transient blocks purely in memory with an eviction cap (default 48MB).
 * Absolutely zero disk writes occur for blocks stored here.
 */
export class FlashPreservingRingBuffer {
  private readonly blocks = new Map<string, RingBufferBlock>();
  private readonly insertionOrder: string[] = [];
  private currentSizeBytes = 0;

  constructor(public readonly maxCapacityBytes = 48 * 1024 * 1024) {}

  public put(cid: string, data: Uint8Array): void {
    if (this.blocks.has(cid)) return;

    // Evict oldest until fits
    while (
      this.currentSizeBytes + data.byteLength > this.maxCapacityBytes &&
      this.insertionOrder.length > 0
    ) {
      const oldestCid = this.insertionOrder.shift();
      if (oldestCid) {
        const removed = this.blocks.get(oldestCid);
        if (removed) {
          this.currentSizeBytes -= removed.size;
          this.blocks.delete(oldestCid);
        }
      }
    }

    if (data.byteLength > this.maxCapacityBytes) {
      return; // Single block exceeds full buffer capacity
    }

    const block: RingBufferBlock = {
      cid,
      data,
      size: data.byteLength,
      insertedAt: Date.now(),
    };
    this.blocks.set(cid, block);
    this.insertionOrder.push(cid);
    this.currentSizeBytes += data.byteLength;
  }

  public get(cid: string): Uint8Array | null {
    const block = this.blocks.get(cid);
    return block ? block.data : null;
  }

  public has(cid: string): boolean {
    return this.blocks.has(cid);
  }

  public get currentUsageBytes(): number {
    return this.currentSizeBytes;
  }

  public get count(): number {
    return this.blocks.size;
  }

  public clear(): void {
    this.blocks.clear();
    this.insertionOrder.length = 0;
    this.currentSizeBytes = 0;
  }
}
