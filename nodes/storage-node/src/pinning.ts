import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CID,
  TieredBlockstore,
  decodeDAGPBNode,
  PinNotFoundError,
  StorageError,
} from '@sovra/storage';
import { PinRecord, PinOptions, PinStatus } from './types.js';
import { SqlitePinStore } from './db.js';

export class ContinuousPinningManager {
  private readonly pins = new Map<string, PinRecord>();
  private readonly registryFilePath: string;
  private readonly storagePath: string;
  private sqliteStore?: SqlitePinStore | undefined;
  private isInitialized = false;

  constructor(
    private readonly blockstore: TieredBlockstore,
    storagePath: string,
  ) {
    this.storagePath = storagePath;
    this.registryFilePath = path.join(storagePath, '.sovra-pin-registry.json');
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;

    // 1. Initialize SQLite WAL Engine
    try {
      this.sqliteStore = new SqlitePinStore(this.storagePath);
      const rows = this.sqliteStore.listPins();
      for (const rec of rows) {
        this.pins.set(rec.cid, rec);
      }
    } catch {
      // Fallback: If SQLite unavailable, load from JSON file
      try {
        const data = await fs.readFile(this.registryFilePath, 'utf-8');
        const parsed: PinRecord[] = JSON.parse(data);
        for (const rec of parsed) {
          this.pins.set(rec.cid, rec);
        }
      } catch {}
    }

    this.isInitialized = true;
  }

  public async persist(): Promise<void> {
    // Write atomic JSON backup snapshot
    try {
      const list = Array.from(this.pins.values());
      const tmp = `${this.registryFilePath}.tmp.${Date.now()}`;
      await fs.mkdir(path.dirname(this.registryFilePath), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf-8');
      await fs.rename(tmp, this.registryFilePath);
    } catch {}
  }

  public close(): void {
    if (this.sqliteStore) {
      this.sqliteStore.close();
      this.sqliteStore = undefined;
    }
  }

  public getSqliteStore(): SqlitePinStore | undefined {
    return this.sqliteStore;
  }

  /**
   * Pins a CID continuously with recursive DAG link resolution and lease support.
   */
  public async pin(cid: CID, options?: PinOptions): Promise<PinRecord> {
    await this.init();
    const cidStr = cid.toString();

    // Compliance Legal Deny-List Check: Reject blacklisted content immediately
    if (this.sqliteStore) {
      if (this.sqliteStore.isCidDenied(cidStr) || this.sqliteStore.isHashDenied(cid.multihash)) {
        throw new StorageError(
          `Cannot pin CID '${cidStr}': content blocked by legal compliance deny-list`,
          'ERR_COMPLIANCE_BLOCKED',
        );
      }
    }

    // Verify block exists locally
    const hasBlock = await this.blockstore.has(cid);
    if (!hasBlock) {
      throw new StorageError(`Cannot pin CID '${cidStr}': root block does not exist in blockstore`);
    }

    const recursive = options?.recursive ?? true;
    const childCids: string[] = [];
    let totalBytes = 0;

    // Pin root block in blockstore
    await this.blockstore.pin(cid);
    const rootBytes = await this.blockstore.get(cid);
    if (rootBytes) {
      totalBytes += rootBytes.length;
    }

    // Traverse DAG recursively if dag-pb
    if (recursive && cid.codec === 'dag-pb') {
      const visited = new Set<string>([cidStr]);
      const queue: CID[] = [cid];

      while (queue.length > 0) {
        const currentCid = queue.shift()!;
        if (currentCid.codec === 'dag-pb') {
          const rawDag = await this.blockstore.get(currentCid);
          if (rawDag) {
            try {
              const { links } = decodeDAGPBNode(rawDag);
              for (const link of links) {
                const childStr = link.cid.toString();
                if (!visited.has(childStr)) {
                  visited.add(childStr);
                  childCids.push(childStr);
                  // Ensure child block is pinned in blockstore
                  if (await this.blockstore.has(link.cid)) {
                    await this.blockstore.pin(link.cid);
                    const childBlock = await this.blockstore.get(link.cid);
                    if (childBlock) {
                      totalBytes += childBlock.length;
                    }
                  }
                  queue.push(link.cid);
                }
              }
            } catch {
              // Non-fatal if a non-essential sub-link fails parsing
            }
          }
        }
      }
    }

    const now = Date.now();
    let expiresAt: number | undefined;
    if (options?.ttlMs) {
      expiresAt = now + options.ttlMs;
    } else if (options?.expiresAt) {
      expiresAt = options.expiresAt;
    }

    const record: PinRecord = {
      cid: cidStr,
      pinnedAt: now,
      expiresAt,
      creatorDid: options?.creatorDid,
      targetReplicationFactor: options?.targetReplicationFactor ?? 3,
      byteSize: totalBytes,
      status: 'active',
      replicaCount: 1,
      lastVerifiedAt: now,
      childCids,
    };

    this.pins.set(cidStr, record);
    if (this.sqliteStore) {
      this.sqliteStore.upsertPin(record);
    }

    await this.persist();
    return { ...record };
  }

  /**
   * Unpins a CID and safely unpins child blocks that are not referenced by other active pins.
   */
  public async unpin(cid: CID): Promise<void> {
    await this.init();
    const cidStr = cid.toString();
    const existing = this.pins.get(cidStr);
    if (!existing) {
      throw new PinNotFoundError(cidStr);
    }

    // Unpin root block
    await this.blockstore.unpin(cid);

    // Delete record from pin registry
    this.pins.delete(cidStr);
    if (this.sqliteStore) {
      this.sqliteStore.deletePin(cidStr);
    }

    // Collect all child CIDs still referenced by any remaining active pin
    const otherReferencedCids = new Set<string>();
    for (const [pCid, pRec] of this.pins.entries()) {
      if (pRec.status === 'active' || pRec.status === 'healthy' || pRec.status === 'under_replicated') {
        otherReferencedCids.add(pCid);
        for (const c of pRec.childCids) {
          otherReferencedCids.add(c);
        }
      }
    }

    // Unpin orphaned child blocks
    for (const childCidStr of existing.childCids) {
      if (!otherReferencedCids.has(childCidStr)) {
        try {
          const childCid = CID.parse(childCidStr);
          await this.blockstore.unpin(childCid);
        } catch {}
      }
    }

    await this.persist();
  }

  public getPin(cid: CID | string): PinRecord | undefined {
    const key = typeof cid === 'string' ? cid : cid.toString();
    const pin = this.pins.get(key);
    return pin ? { ...pin } : undefined;
  }

  public listPins(filter?: { status?: PinStatus; creatorDid?: string }): readonly PinRecord[] {
    let result = Array.from(this.pins.values()).map(p => ({ ...p }));
    if (filter?.status) {
      result = result.filter(p => p.status === filter.status);
    }
    if (filter?.creatorDid) {
      result = result.filter(p => p.creatorDid === filter.creatorDid);
    }
    return result;
  }

  public async renewPin(
    cid: CID | string,
    newExpiresAt?: number,
    ttlMs?: number,
  ): Promise<PinRecord> {
    await this.init();
    const key = typeof cid === 'string' ? cid : cid.toString();
    const pin = this.pins.get(key);
    if (!pin) {
      throw new PinNotFoundError(key);
    }

    if (ttlMs) {
      pin.expiresAt = Date.now() + ttlMs;
    } else if (newExpiresAt !== undefined) {
      pin.expiresAt = newExpiresAt;
    } else {
      pin.expiresAt = undefined; // Permanent
    }

    if (pin.status === 'expired') {
      pin.status = 'active';
      // Re-pin in blockstore if it was unpinned upon expiration
      try {
        await this.blockstore.pin(CID.parse(key));
      } catch {}
    }

    if (this.sqliteStore) {
      this.sqliteStore.upsertPin(pin);
    }

    await this.persist();
    return { ...pin };
  }

  /**
   * Sweeps and transitions expired pin leases to 'expired', freeing them for garbage collection.
   */
  public async sweepExpiredPins(): Promise<readonly PinRecord[]> {
    await this.init();
    const now = Date.now();
    const expiredPins: PinRecord[] = [];

    for (const pin of this.pins.values()) {
      if (pin.expiresAt && pin.expiresAt <= now && pin.status !== 'expired') {
        pin.status = 'expired';
        expiredPins.push(pin);
        // Unpin root block from blockstore so GC can reclaim it
        try {
          await this.blockstore.unpin(CID.parse(pin.cid));
        } catch {}
      }
    }

    if (this.sqliteStore && expiredPins.length > 0) {
      this.sqliteStore.sweepExpiredPins(now);
    }

    if (expiredPins.length > 0) {
      await this.persist();
    }

    return expiredPins;
  }

  /**
   * Gathers all CIDs (both roots and children) that are part of active, healthy, or under-replicated pins.
   * This set is strictly protected from garbage collection eviction.
   */
  public getProtectedCidStrings(): Set<string> {
    if (this.sqliteStore) {
      return this.sqliteStore.getAllProtectedCids();
    }

    const protectedCids = new Set<string>();
    for (const [cidStr, pin] of this.pins.entries()) {
      if (pin.status !== 'expired') {
        protectedCids.add(cidStr);
        for (const child of pin.childCids) {
          protectedCids.add(child);
        }
      }
    }
    return protectedCids;
  }

  public updatePinVerification(
    cidStr: string,
    replicaCount: number,
    status: PinStatus,
  ): void {
    const pin = this.pins.get(cidStr);
    if (pin) {
      pin.replicaCount = replicaCount;
      pin.status = status;
      pin.lastVerifiedAt = Date.now();
      if (this.sqliteStore) {
        this.sqliteStore.updateVerification(cidStr, replicaCount, status, pin.lastVerifiedAt);
      }
    }
  }
}
