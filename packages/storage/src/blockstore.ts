import fs from 'node:fs/promises';
import path from 'node:path';
import {
  sha256,
  blake3Hash,
  constantTimeEquals,
} from '@sovra/crypto';
import { CID } from './cid.js';
import {
  BlockstoreCapacityError,
  IntegrityVerificationError,
  StorageError,
} from './errors.js';

export interface BlockstoreStats {
  readonly totalBlocks: number;
  readonly totalSizeBytes: number;
  readonly maxSizeBytes: number;
  readonly hitCount: number;
  readonly missCount: number;
  readonly evictionCount: number;
  readonly pinnedCount: number;
}

export interface Blockstore {
  put(cid: CID, block: Uint8Array): Promise<void>;
  putMany(blocks: Array<{ cid: CID; data: Uint8Array }>): Promise<void>;
  get(cid: CID): Promise<Uint8Array | undefined>;
  has(cid: CID): Promise<boolean>;
  delete(cid: CID): Promise<boolean>;
  pin(cid: CID): Promise<void>;
  unpin(cid: CID): Promise<void>;
  isPinned(cid: CID): Promise<boolean>;
  getAllCids(): Promise<string[]>;
  getStats(): BlockstoreStats;
  clear(): Promise<void>;
}

// ============================================================================
// 1. MEMORY LRU BLOCKSTORE
// ============================================================================

export class MemoryBlockstore implements Blockstore {
  private readonly blocks = new Map<string, Uint8Array>();
  private readonly pinnedCids = new Set<string>();
  private _totalSizeBytes = 0;
  private _hitCount = 0;
  private _missCount = 0;
  private _evictionCount = 0;

  constructor(
    public readonly maxSizeBytes: number = 64 * 1024 * 1024, // 64 MB default
  ) {}

  public async put(cid: CID, block: Uint8Array): Promise<void> {
    const key = cid.toString();

    // Verify integrity before storing
    const computed =
      cid.multihashType === 'blake3' ? blake3Hash(block) : sha256(block);
    if (!constantTimeEquals(computed, cid.digest)) {
      throw new IntegrityVerificationError(
        key,
        cid.multihash,
        Buffer.from(computed).toString('hex'),
      );
    }

    if (this.blocks.has(key)) {
      const existing = this.blocks.get(key)!;
      this._totalSizeBytes -= existing.length;
      this.blocks.delete(key);
    }

    // Ensure capacity
    this.evictToFit(block.length);

    this.blocks.set(key, new Uint8Array(block));
    this._totalSizeBytes += block.length;
  }

  public async putMany(blocks: Array<{ cid: CID; data: Uint8Array }>): Promise<void> {
    for (const b of blocks) {
      await this.put(b.cid, b.data);
    }
  }

  public async get(cid: CID): Promise<Uint8Array | undefined> {
    const key = cid.toString();
    const block = this.blocks.get(key);

    if (block) {
      this._hitCount++;
      // Move to MRU position (delete + re-set)
      this.blocks.delete(key);
      this.blocks.set(key, block);
      return new Uint8Array(block);
    }

    this._missCount++;
    return undefined;
  }

  public async has(cid: CID): Promise<boolean> {
    return this.blocks.has(cid.toString());
  }

  public async delete(cid: CID): Promise<boolean> {
    const key = cid.toString();
    const existing = this.blocks.get(key);
    if (existing) {
      this._totalSizeBytes -= existing.length;
      this.blocks.delete(key);
      this.pinnedCids.delete(key);
      return true;
    }
    return false;
  }

  public async pin(cid: CID): Promise<void> {
    const key = cid.toString();
    if (!this.blocks.has(key)) {
      throw new StorageError(`Cannot pin CID '${key}': block does not exist in store`);
    }
    this.pinnedCids.add(key);
  }

  public async unpin(cid: CID): Promise<void> {
    this.pinnedCids.delete(cid.toString());
  }

  public async isPinned(cid: CID): Promise<boolean> {
    return this.pinnedCids.has(cid.toString());
  }

  public async getAllCids(): Promise<string[]> {
    return Array.from(this.blocks.keys());
  }

  public getStats(): BlockstoreStats {
    return {
      totalBlocks: this.blocks.size,
      totalSizeBytes: this._totalSizeBytes,
      maxSizeBytes: this.maxSizeBytes,
      hitCount: this._hitCount,
      missCount: this._missCount,
      evictionCount: this._evictionCount,
      pinnedCount: this.pinnedCids.size,
    };
  }

  public async clear(): Promise<void> {
    this.blocks.clear();
    this.pinnedCids.clear();
    this._totalSizeBytes = 0;
  }

  private evictToFit(incomingBytes: number): void {
    if (this._totalSizeBytes + incomingBytes <= this.maxSizeBytes) {
      return;
    }

    // Evict unpinned blocks from the oldest (head of Map)
    for (const [key, block] of this.blocks.entries()) {
      if (this.pinnedCids.has(key)) {
        continue; // Protect pinned content
      }

      this.blocks.delete(key);
      this._totalSizeBytes -= block.length;
      this._evictionCount++;

      if (this._totalSizeBytes + incomingBytes <= this.maxSizeBytes) {
        return;
      }
    }

    // If still insufficient, all remaining content is pinned
    if (this._totalSizeBytes + incomingBytes > this.maxSizeBytes) {
      throw new BlockstoreCapacityError(
        `Memory blockstore capacity exceeded (${this.maxSizeBytes} bytes). Cannot evict pinned blocks.`,
      );
    }
  }
}

// ============================================================================
// 2. DISK PERSISTED BLOCKSTORE
// ============================================================================

export class DiskBlockstore implements Blockstore {
  private readonly pinnedCids = new Set<string>();
  private _hitCount = 0;
  private _missCount = 0;
  private _totalBlocks = 0;
  private _totalSizeBytes = 0;
  private _evictionCount = 0;
  private initialized = false;

  constructor(
    public readonly rootDir: string,
    public readonly maxSizeBytes: number = 1024 * 1024 * 1024, // 1 GB default
  ) {}

  public async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.rootDir, { recursive: true });

    // Load persisted pins
    const pinsFile = path.join(this.rootDir, '.sovra-pins.json');
    try {
      const data = await fs.readFile(pinsFile, 'utf-8');
      const pins: string[] = JSON.parse(data);
      for (const p of pins) this.pinnedCids.add(p);
    } catch {
      // Pins file does not exist yet
    }

    this.initialized = true;
  }

  private getBlockPath(cidStr: string): string {
    const p1 = cidStr.slice(0, 2);
    const p2 = cidStr.slice(2, 4);
    return path.join(this.rootDir, p1, p2, `${cidStr}.block`);
  }

  public async put(cid: CID, block: Uint8Array): Promise<void> {
    await this.init();
    const key = cid.toString();
    const filePath = this.getBlockPath(key);

    // Verify integrity before disk write
    const computed =
      cid.multihashType === 'blake3' ? blake3Hash(block) : sha256(block);
    if (!constantTimeEquals(computed, cid.digest)) {
      throw new IntegrityVerificationError(
        key,
        cid.multihash,
        Buffer.from(computed).toString('hex'),
      );
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Atomic write via temp file
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, block);
    await fs.rename(tmpPath, filePath);

    this._totalBlocks++;
    this._totalSizeBytes += block.length;
  }

  public async putMany(blocks: Array<{ cid: CID; data: Uint8Array }>): Promise<void> {
    for (const b of blocks) {
      await this.put(b.cid, b.data);
    }
  }

  public async get(cid: CID): Promise<Uint8Array | undefined> {
    await this.init();
    const key = cid.toString();
    const filePath = this.getBlockPath(key);

    try {
      const buffer = await fs.readFile(filePath);
      const block = new Uint8Array(buffer);

      // Verify integrity on read to detect bit rot or disk tampering
      const computed =
        cid.multihashType === 'blake3' ? blake3Hash(block) : sha256(block);
      if (!constantTimeEquals(computed, cid.digest)) {
        await fs.unlink(filePath).catch(() => {});
        throw new IntegrityVerificationError(
          key,
          cid.multihash,
          Buffer.from(computed).toString('hex'),
        );
      }

      this._hitCount++;
      return block;
    } catch (err) {
      if (err instanceof IntegrityVerificationError) throw err;
      this._missCount++;
      return undefined;
    }
  }

  public async has(cid: CID): Promise<boolean> {
    await this.init();
    const filePath = this.getBlockPath(cid.toString());
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public async delete(cid: CID): Promise<boolean> {
    await this.init();
    const key = cid.toString();
    const filePath = this.getBlockPath(key);
    try {
      const stat = await fs.stat(filePath);
      await fs.unlink(filePath);
      this._totalBlocks = Math.max(0, this._totalBlocks - 1);
      this._totalSizeBytes = Math.max(0, this._totalSizeBytes - stat.size);
      this.pinnedCids.delete(key);
      await this.persistPins();
      return true;
    } catch {
      return false;
    }
  }

  public async pin(cid: CID): Promise<void> {
    await this.init();
    const key = cid.toString();
    if (!(await this.has(cid))) {
      throw new StorageError(`Cannot pin CID '${key}': block not found on disk`);
    }
    this.pinnedCids.add(key);
    await this.persistPins();
  }

  public async unpin(cid: CID): Promise<void> {
    await this.init();
    this.pinnedCids.delete(cid.toString());
    await this.persistPins();
  }

  public async isPinned(cid: CID): Promise<boolean> {
    await this.init();
    return this.pinnedCids.has(cid.toString());
  }

  public async getAllCids(): Promise<string[]> {
    await this.init();
    const cids: string[] = [];
    const scanDir = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.block')) {
            cids.push(entry.name.slice(0, -6));
          }
        }
      } catch {}
    };
    await scanDir(this.rootDir);
    return cids;
  }

  private async persistPins(): Promise<void> {
    const pinsFile = path.join(this.rootDir, '.sovra-pins.json');
    await fs.writeFile(pinsFile, JSON.stringify([...this.pinnedCids]), 'utf-8');
  }

  public getStats(): BlockstoreStats {
    return {
      totalBlocks: this._totalBlocks,
      totalSizeBytes: this._totalSizeBytes,
      maxSizeBytes: this.maxSizeBytes,
      hitCount: this._hitCount,
      missCount: this._missCount,
      evictionCount: this._evictionCount,
      pinnedCount: this.pinnedCids.size,
    };
  }

  public async clear(): Promise<void> {
    await this.init();
    await fs.rm(this.rootDir, { recursive: true, force: true });
    await fs.mkdir(this.rootDir, { recursive: true });
    this.pinnedCids.clear();
    this._totalBlocks = 0;
    this._totalSizeBytes = 0;
  }
}

// ============================================================================
// 3. TIERED BLOCKSTORE (L1 MEMORY LRU + L2 PERSISTENT DISK)
// ============================================================================

export class TieredBlockstore implements Blockstore {
  constructor(
    public readonly l1: MemoryBlockstore,
    public readonly l2: DiskBlockstore,
  ) {}

  public async put(cid: CID, block: Uint8Array): Promise<void> {
    await this.l2.put(cid, block);
    await this.l1.put(cid, block);
  }

  public async putMany(blocks: Array<{ cid: CID; data: Uint8Array }>): Promise<void> {
    await this.l2.putMany(blocks);
    await this.l1.putMany(blocks);
  }

  public async get(cid: CID): Promise<Uint8Array | undefined> {
    // Check fast L1 Memory Cache
    const inMem = await this.l1.get(cid);
    if (inMem) return inMem;

    // Check persistent L2 Disk Store
    const onDisk = await this.l2.get(cid);
    if (onDisk) {
      // Promote into L1 Memory LRU
      await this.l1.put(cid, onDisk).catch(() => {});
      return onDisk;
    }

    return undefined;
  }

  public async has(cid: CID): Promise<boolean> {
    if (await this.l1.has(cid)) return true;
    return this.l2.has(cid);
  }

  public async delete(cid: CID): Promise<boolean> {
    const d1 = await this.l1.delete(cid);
    const d2 = await this.l2.delete(cid);
    return d1 || d2;
  }

  public async pin(cid: CID): Promise<void> {
    await this.l2.pin(cid);
    if (await this.l1.has(cid)) {
      await this.l1.pin(cid);
    }
  }

  public async unpin(cid: CID): Promise<void> {
    await this.l1.unpin(cid);
    await this.l2.unpin(cid);
  }

  public async isPinned(cid: CID): Promise<boolean> {
    return this.l2.isPinned(cid);
  }

  public async getAllCids(): Promise<string[]> {
    const fromL1 = await this.l1.getAllCids();
    const fromL2 = await this.l2.getAllCids();
    return Array.from(new Set([...fromL1, ...fromL2]));
  }

  public getStats(): BlockstoreStats {
    const s1 = this.l1.getStats();
    const s2 = this.l2.getStats();
    return {
      totalBlocks: s2.totalBlocks,
      totalSizeBytes: s2.totalSizeBytes,
      maxSizeBytes: s2.maxSizeBytes,
      hitCount: s1.hitCount + s2.hitCount,
      missCount: s2.missCount,
      evictionCount: s1.evictionCount + s2.evictionCount,
      pinnedCount: s2.pinnedCount,
    };
  }

  public async clear(): Promise<void> {
    await this.l1.clear();
    await this.l2.clear();
  }
}
