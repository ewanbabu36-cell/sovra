import {
  CID,
  TieredBlockstore,
  QuotaExceededError,
  AuthorQuotaExceededError,
} from '@sovra/storage';
import { ContinuousPinningManager } from './pinning.js';
import {
  StorageQuotaConfig,
  StorageQuotaUsage,
  GarbageCollectionResult,
} from './types.js';

export class StorageQuotaManager {
  public readonly maxCapacityBytes: bigint;
  public readonly highWatermarkPercent: number;
  public readonly lowWatermarkPercent: number;
  public readonly maxAuthorQuotaBytes?: bigint | undefined;

  constructor(
    private readonly blockstore: TieredBlockstore,
    private readonly pinningManager: ContinuousPinningManager,
    config?: Partial<StorageQuotaConfig>,
  ) {
    this.maxCapacityBytes = config?.maxCapacityBytes ?? 107374182400n; // 100 GB default
    this.highWatermarkPercent = config?.highWatermarkPercent ?? 85;
    this.lowWatermarkPercent = config?.lowWatermarkPercent ?? 70;
    this.maxAuthorQuotaBytes = config?.maxAuthorQuotaBytes;
  }

  /**
   * Calculates comprehensive storage quota usage, including pinned vs cached and author quotas.
   */
  public getUsage(): StorageQuotaUsage {
    const stats = this.blockstore.getStats();
    const usedBytes = BigInt(stats.totalSizeBytes);

    // Calculate total pinned bytes and author allocations from active pins
    const authorUsageRecord: Record<string, bigint> = {};
    let pinnedBytes = 0n;

    for (const pin of this.pinningManager.listPins()) {
      if (pin.status !== 'expired') {
        const pBytes = BigInt(pin.byteSize);
        pinnedBytes += pBytes;

        if (pin.creatorDid) {
          const current = authorUsageRecord[pin.creatorDid] ?? 0n;
          authorUsageRecord[pin.creatorDid] = current + pBytes;
        }
      }
    }

    const cachedBytes = usedBytes > pinnedBytes ? usedBytes - pinnedBytes : 0n;
    const usagePercent =
      this.maxCapacityBytes > 0n
        ? Number((usedBytes * 10000n) / this.maxCapacityBytes) / 100
        : 0;

    const highWatermarkBytes = (this.maxCapacityBytes * BigInt(this.highWatermarkPercent)) / 100n;
    const isHighWatermarkExceeded = usedBytes >= highWatermarkBytes;

    return {
      totalCapacityBytes: this.maxCapacityBytes,
      usedBytes,
      pinnedBytes,
      cachedBytes,
      usagePercent,
      isHighWatermarkExceeded,
      authorUsage: authorUsageRecord,
    };
  }

  /**
   * Verifies if a new pin can be accommodated within global and author quotas.
   * If space is constrained but unpinned cache exists, triggers automatic Garbage Collection.
   */
  public async ensureCapacityForPin(newBytes: number, creatorDid?: string): Promise<void> {
    const needed = BigInt(newBytes);
    const usage = this.getUsage();

    // 1. Enforce Per-Author Quota
    if (creatorDid && this.maxAuthorQuotaBytes) {
      const currentAuthorUsage = usage.authorUsage[creatorDid] ?? 0n;
      if (currentAuthorUsage + needed > this.maxAuthorQuotaBytes) {
        throw new AuthorQuotaExceededError(creatorDid, this.maxAuthorQuotaBytes, {
          currentAuthorUsage: currentAuthorUsage.toString(),
          requestedBytes: needed.toString(),
        });
      }
    }

    // 2. Enforce Global Storage Capacity
    if (usage.usedBytes + needed > this.maxCapacityBytes) {
      // Check if evicting all unpinned cache would be sufficient
      if (usage.pinnedBytes + needed > this.maxCapacityBytes) {
        throw new QuotaExceededError(
          `Cannot pin: storage capacity of ${this.maxCapacityBytes.toString()} bytes exceeded. Pinned bytes (${usage.pinnedBytes.toString()}) + requested (${needed.toString()}) exceeds capacity.`,
          {
            maxCapacityBytes: this.maxCapacityBytes.toString(),
            pinnedBytes: usage.pinnedBytes.toString(),
            requestedBytes: needed.toString(),
          },
        );
      }

      // Automatically run Garbage Collection to free unpinned cache
      const bytesToFree = usage.usedBytes + needed - this.maxCapacityBytes;
      await this.runGarbageCollection(bytesToFree);
    }
  }

  /**
   * Executes garbage collection by identifying and evicting unpinned candidate blocks.
   * Pinned blocks (roots and all child links) are strictly protected.
   */
  public async runGarbageCollection(targetFreeBytes?: bigint): Promise<GarbageCollectionResult> {
    const startTime = Date.now();
    const statsBefore = this.blockstore.getStats();
    const startingUsedBytes = BigInt(statsBefore.totalSizeBytes);

    const lowWatermarkBytes = (this.maxCapacityBytes * BigInt(this.lowWatermarkPercent)) / 100n;
    let targetUsedBytes = lowWatermarkBytes;

    if (targetFreeBytes && targetFreeBytes > 0n) {
      const neededDrop = startingUsedBytes - targetFreeBytes;
      if (neededDrop < targetUsedBytes) {
        targetUsedBytes = neededDrop;
      }
    }

    if (startingUsedBytes <= targetUsedBytes && (!targetFreeBytes || targetFreeBytes <= 0n)) {
      return {
        blocksEvicted: 0,
        bytesFreed: 0n,
        startingUsedBytes,
        endingUsedBytes: startingUsedBytes,
        durationMs: Date.now() - startTime,
      };
    }

    // 1. Gather all CIDs currently stored in blockstore
    const allCids = await this.blockstore.getAllCids();

    // 2. Gather all protected (pinned) CIDs
    const protectedCids = this.pinningManager.getProtectedCidStrings();

    // 3. Filter for unpinned candidate CIDs eligible for eviction
    const candidateCids = allCids.filter(cidStr => !protectedCids.has(cidStr));

    let blocksEvicted = 0;
    let bytesFreed = 0n;
    let currentUsedBytes = startingUsedBytes;

    for (const cidStr of candidateCids) {
      if (currentUsedBytes <= targetUsedBytes) {
        break; // Reached target threshold
      }

      try {
        const cid = CID.parse(cidStr);
        const block = await this.blockstore.get(cid);
        const blockSize = block ? BigInt(block.length) : 0n;

        const deleted = await this.blockstore.delete(cid);
        if (deleted) {
          blocksEvicted++;
          bytesFreed += blockSize;
          currentUsedBytes = currentUsedBytes > blockSize ? currentUsedBytes - blockSize : 0n;
        }
      } catch {
        // Continue evicting other candidates
      }
    }

    return {
      blocksEvicted,
      bytesFreed,
      startingUsedBytes,
      endingUsedBytes: currentUsedBytes,
      durationMs: Date.now() - startTime,
    };
  }
}
