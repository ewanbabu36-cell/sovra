import {
  sha256,
  blake3Hash,
  constantTimeEquals,
} from '@sovra/crypto';
import { CID } from './cid.js';
import { Blockstore } from './blockstore.js';
import { decodeDAGPBNode } from './unixfs.js';
import {
  ContentNotFoundError,
  IntegrityVerificationError,
  BitSwapTimeoutError,
  BitSwapProtocolError,
} from './errors.js';

// ============================================================================
// BITSWAP 1.2.0 WIRE PROTOCOL TYPES & MESSAGE STRUCTURES
// ============================================================================

export type BitSwapWantType = 'WANT_BLOCK' | 'WANT_HAVE';
export type BitSwapPresenceType = 'HAVE' | 'DONT_HAVE';

export interface BitSwapWantEntry {
  readonly cid: string;
  readonly priority: number;
  readonly cancel: boolean;
  readonly wantType: BitSwapWantType;
  readonly sendDontHave: boolean;
}

export interface BitSwapBlock {
  readonly cid: string;
  readonly data: Uint8Array;
}

export interface BitSwapBlockPresence {
  readonly cid: string;
  readonly type: BitSwapPresenceType;
}

export interface BitSwapMessage {
  readonly wantlist?: readonly BitSwapWantEntry[] | undefined;
  readonly blocks?: readonly BitSwapBlock[] | undefined;
  readonly blockPresences?: readonly BitSwapBlockPresence[] | undefined;
  readonly fullWantlist?: boolean | undefined;
}

export interface BitSwapNetworkAdapter {
  sendMessage(targetPeerId: string, message: BitSwapMessage): Promise<void>;
  findProviders?(cid: string): Promise<readonly string[]>;
  getConnectedPeers?(): readonly string[];
}

export interface BitSwapLedgerEntry {
  readonly peerId: string;
  bytesSent: number;
  bytesReceived: number;
  blocksSent: number;
  blocksReceived: number;
  lastExchange: number;
  debtRatio(): number;
}

export interface BitSwapStats {
  readonly totalBlocksSent: number;
  readonly totalBlocksReceived: number;
  readonly totalBytesSent: number;
  readonly totalBytesReceived: number;
  readonly activeWantsCount: number;
  readonly trackedPeersCount: number;
}

// ============================================================================
// WIRE ENCODING & DECODING (ZERO-DEPENDENCY COMPATIBLE)
// ============================================================================

interface SerializedBitSwapBlock {
  readonly cid: string;
  readonly data: string; // Base64
}

interface SerializedBitSwapMessage {
  readonly wantlist?: readonly BitSwapWantEntry[] | undefined;
  readonly blocks?: readonly SerializedBitSwapBlock[] | undefined;
  readonly blockPresences?: readonly BitSwapBlockPresence[] | undefined;
  readonly fullWantlist?: boolean | undefined;
}

export function encodeBitSwapMessage(msg: BitSwapMessage): Uint8Array {
  const serialized: SerializedBitSwapMessage = {
    wantlist: msg.wantlist,
    blocks: msg.blocks?.map(b => ({
      cid: b.cid,
      data: Buffer.from(b.data).toString('base64'),
    })),
    blockPresences: msg.blockPresences,
    fullWantlist: msg.fullWantlist,
  };

  return new TextEncoder().encode(JSON.stringify(serialized));
}

export function decodeBitSwapMessage(bytes: Uint8Array): BitSwapMessage {
  try {
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text) as SerializedBitSwapMessage;

    return {
      wantlist: parsed.wantlist,
      blocks: parsed.blocks?.map(b => ({
        cid: b.cid,
        data: new Uint8Array(Buffer.from(b.data, 'base64')),
      })),
      blockPresences: parsed.blockPresences,
      fullWantlist: parsed.fullWantlist,
    };
  } catch (err) {
    throw new BitSwapProtocolError(
      `Failed to decode BitSwap message frame: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ============================================================================
// BITSWAP LEDGER (PEER TIT-FOR-TAT ACCOUNTING & BOOTSTRAP CREDITS)
// ============================================================================

/**
 * Pillar 4: Dynamic BitSwap Tit-for-Tat Credit Bootstrap.
 * Allocates newly joined unprimed consumer peers a grace credit pool (up to 2MB)
 * so they can retrieve Segment 0 and initial blocks before seeding.
 */
export class DynamicCreditBootstrap {
  public static calculateGraceCreditBytes(
    peerAgeMs: number,
    initialGraceLimitBytes = 2 * 1024 * 1024,
  ): number {
    if (peerAgeMs >= 600000) return 0;
    const decay = Math.max(0, 1 - peerAgeMs / 600000); // 10 minutes grace window (600,000 ms)
    return Math.floor(initialGraceLimitBytes * decay);
  }
}

export class BitSwapLedger {
  private readonly ledger = new Map<string, BitSwapLedgerEntry>();

  public getOrCreate(peerId: string): BitSwapLedgerEntry {
    let entry = this.ledger.get(peerId);
    if (!entry) {
      entry = {
        peerId,
        bytesSent: 0,
        bytesReceived: 0,
        blocksSent: 0,
        blocksReceived: 0,
        lastExchange: Date.now(),
        debtRatio(creditBytes = 1024) {
          return (this.bytesSent + creditBytes) / (this.bytesReceived + creditBytes);
        },
      };
      this.ledger.set(peerId, entry);
    }
    return entry;
  }

  public recordSent(peerId: string, byteLength: number): void {
    const entry = this.getOrCreate(peerId);
    entry.bytesSent += byteLength;
    entry.blocksSent += 1;
    entry.lastExchange = Date.now();
  }

  public recordReceived(peerId: string, byteLength: number): void {
    const entry = this.getOrCreate(peerId);
    entry.bytesReceived += byteLength;
    entry.blocksReceived += 1;
    entry.lastExchange = Date.now();
  }

  public getTrackedPeers(): readonly string[] {
    return Array.from(this.ledger.keys());
  }
}

// ============================================================================
// BITSWAP ENGINE (EXCHANGE PROTOCOL CORE)
// ============================================================================

interface PendingRequest {
  readonly cid: string;
  readonly resolve: (data: Uint8Array) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly targetPeers: readonly string[];
}

export class BitSwapEngine {
  private readonly ledger = new BitSwapLedger();
  private readonly activeWants = new Map<string, BitSwapWantEntry>();
  private readonly pendingRequests = new Map<string, PendingRequest[]>();
  private readonly peerPresences = new Map<string, Set<string>>(); // cid -> Set<peerId>
  private network?: BitSwapNetworkAdapter | undefined;

  private _totalBlocksSent = 0;
  private _totalBlocksReceived = 0;
  private _totalBytesSent = 0;
  private _totalBytesReceived = 0;

  constructor(
    public readonly blockstore: Blockstore,
    network?: BitSwapNetworkAdapter | undefined,
    public readonly defaultTimeoutMs: number = 5000,
  ) {
    this.network = network;
  }

  public setNetwork(network: BitSwapNetworkAdapter): void {
    this.network = network;
  }

  public getStats(): BitSwapStats {
    return {
      totalBlocksSent: this._totalBlocksSent,
      totalBlocksReceived: this._totalBlocksReceived,
      totalBytesSent: this._totalBytesSent,
      totalBytesReceived: this._totalBytesReceived,
      activeWantsCount: this.activeWants.size,
      trackedPeersCount: this.ledger.getTrackedPeers().length,
    };
  }

  public getLedger(peerId: string): BitSwapLedgerEntry {
    return this.ledger.getOrCreate(peerId);
  }

  /**
   * Processes an inbound BitSwap frame from a remote peer:
   * 1. Ingests returned blocks, verifying cryptographic integrity against CID.
   * 2. Resolves any pending want promises for received blocks.
   * 3. Records block presence notices.
   * 4. Answers remote wantlists by serving matching blocks from local blockstore.
   */
  public async handleInboundMessage(
    fromPeerId: string,
    messageOrBytes: BitSwapMessage | Uint8Array,
  ): Promise<BitSwapMessage | null> {
    const msg: BitSwapMessage =
      messageOrBytes instanceof Uint8Array
        ? decodeBitSwapMessage(messageOrBytes)
        : messageOrBytes;

    // 1. Process received blocks
    if (msg.blocks && msg.blocks.length > 0) {
      for (const block of msg.blocks) {
        await this.handleInboundBlock(fromPeerId, block);
      }
    }

    // 2. Process block presences
    if (msg.blockPresences && msg.blockPresences.length > 0) {
      for (const presence of msg.blockPresences) {
        let set = this.peerPresences.get(presence.cid);
        if (!set) {
          set = new Set<string>();
          this.peerPresences.set(presence.cid, set);
        }
        if (presence.type === 'HAVE') {
          set.add(fromPeerId);
        } else {
          set.delete(fromPeerId);
        }
      }
    }

    // 3. Process remote peer wantlist requests
    if (msg.wantlist && msg.wantlist.length > 0) {
      return this.handleInboundWantlist(fromPeerId, msg.wantlist);
    }

    return null;
  }

  private async handleInboundBlock(fromPeerId: string, block: BitSwapBlock): Promise<void> {
    const cidObj = CID.parse(block.cid);

    // Cryptographic integrity verification before accepting or storing
    const computedDigest =
      cidObj.multihashType === 'blake3'
        ? blake3Hash(block.data)
        : sha256(block.data);

    if (!constantTimeEquals(computedDigest, cidObj.digest)) {
      throw new IntegrityVerificationError(
        block.cid,
        cidObj.multihash,
        Buffer.from(computedDigest).toString('hex'),
      );
    }

    // Save verified block into local blockstore
    await this.blockstore.put(cidObj, block.data);

    this.ledger.recordReceived(fromPeerId, block.data.length);
    this._totalBlocksReceived += 1;
    this._totalBytesReceived += block.data.length;

    // Resolve any pending requests waiting on this CID
    const waiters = this.pendingRequests.get(block.cid);
    if (waiters && waiters.length > 0) {
      this.pendingRequests.delete(block.cid);
      this.activeWants.delete(block.cid);

      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(block.data);
      }
    }
  }

  private async handleInboundWantlist(
    fromPeerId: string,
    wantlist: readonly BitSwapWantEntry[],
  ): Promise<BitSwapMessage | null> {
    const outBlocks: BitSwapBlock[] = [];
    const outPresences: BitSwapBlockPresence[] = [];

    for (const entry of wantlist) {
      if (entry.cancel) {
        continue;
      }

      let parsedCid: CID;
      try {
        parsedCid = CID.parse(entry.cid);
      } catch {
        continue; // Skip malformed CID
      }

      const hasBlock = await this.blockstore.has(parsedCid);

      if (hasBlock) {
        if (entry.wantType === 'WANT_BLOCK') {
          const data = await this.blockstore.get(parsedCid);
          if (data) {
            outBlocks.push({ cid: entry.cid, data });
            this.ledger.recordSent(fromPeerId, data.length);
            this._totalBlocksSent += 1;
            this._totalBytesSent += data.length;
          }
        } else {
          outPresences.push({ cid: entry.cid, type: 'HAVE' });
        }
      } else if (entry.sendDontHave) {
        outPresences.push({ cid: entry.cid, type: 'DONT_HAVE' });
      }
    }

    if (outBlocks.length === 0 && outPresences.length === 0) {
      return null;
    }

    const responseMsg: BitSwapMessage = {
      blocks: outBlocks.length > 0 ? outBlocks : undefined,
      blockPresences: outPresences.length > 0 ? outPresences : undefined,
    };

    if (this.network) {
      await this.network.sendMessage(fromPeerId, responseMsg).catch(() => {});
    }

    return responseMsg;
  }

  /**
   * Requests a specific block by CID from connected peers or DHT providers.
   * If available in local blockstore, returns immediately without network query.
   */
  public async requestBlock(
    cid: CID | string,
    peers?: readonly string[],
    options?: { timeoutMs?: number; priority?: number },
  ): Promise<Uint8Array> {
    const cidObj = typeof cid === 'string' ? CID.parse(cid) : cid;
    const cidStr = cidObj.toString();

    // 1. Local hit check
    const localBlock = await this.blockstore.get(cidObj);
    if (localBlock) {
      return localBlock;
    }

    if (!this.network) {
      throw new ContentNotFoundError(cidStr, {
        reason: 'No network adapter configured in BitSwap engine',
      });
    }

    // 2. Resolve target peers
    let targetPeers = peers ? [...peers] : [];
    if (targetPeers.length === 0 && this.network.findProviders) {
      const providers = await this.network.findProviders(cidStr);
      if (providers.length > 0) {
        targetPeers = [...providers];
      }
    }

    if (targetPeers.length === 0 && this.network.getConnectedPeers) {
      const connected = this.network.getConnectedPeers();
      if (connected.length > 0) {
        targetPeers = [...connected];
      }
    }

    if (targetPeers.length === 0) {
      throw new ContentNotFoundError(cidStr, {
        reason: 'No connected peers or DHT providers available to fetch block',
      });
    }

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const priority = options?.priority ?? 1;

    // 3. Register want and construct pending promise
    const wantEntry: BitSwapWantEntry = {
      cid: cidStr,
      priority,
      cancel: false,
      wantType: 'WANT_BLOCK',
      sendDontHave: true,
    };
    this.activeWants.set(cidStr, wantEntry);

    const message: BitSwapMessage = {
      wantlist: [wantEntry],
    };

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        const remaining = this.pendingRequests.get(cidStr) ?? [];
        const filtered = remaining.filter(r => r.timer !== timer);
        if (filtered.length > 0) {
          this.pendingRequests.set(cidStr, filtered);
        } else {
          this.pendingRequests.delete(cidStr);
          this.activeWants.delete(cidStr);
        }

        // Send cancel message
        this.cancelWants([cidStr], targetPeers).catch(() => {});

        reject(new BitSwapTimeoutError(cidStr, timeoutMs));
      }, timeoutMs);

      const request: PendingRequest = {
        cid: cidStr,
        resolve,
        reject,
        timer,
        targetPeers,
      };

      const existing = this.pendingRequests.get(cidStr) ?? [];
      this.pendingRequests.set(cidStr, [...existing, request]);

      // Dispatch request to all target peers
      const sendPromises = targetPeers.map(peerId =>
        this.network!.sendMessage(peerId, message).catch(() => {}),
      );
      Promise.all(sendPromises).catch(() => {});
    });
  }

  /**
   * Concurrently requests multiple blocks.
   */
  public async requestBlocks(
    cids: readonly (CID | string)[],
    peers?: readonly string[],
    options?: { timeoutMs?: number },
  ): Promise<Map<string, Uint8Array>> {
    const results = new Map<string, Uint8Array>();
    const promises = cids.map(async cid => {
      const cidStr = typeof cid === 'string' ? cid : cid.toString();
      const block = await this.requestBlock(cid, peers, options);
      results.set(cidStr, block);
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Traverses and fetches an entire Merkle DAG (root and all descendants) via BitSwap
   * using multi-peer swarm pipelining with configurable concurrency.
   */
  public async fetchDag(
    rootCid: CID | string,
    peers?: readonly string[],
    options?: { timeoutMs?: number; concurrency?: number },
  ): Promise<{ root: Uint8Array; allBlocks: Map<string, Uint8Array> }> {
    const rootCidObj = typeof rootCid === 'string' ? CID.parse(rootCid) : rootCid;
    const allBlocks = new Map<string, Uint8Array>();

    // 1. Fetch root block
    const rootBlock = await this.requestBlock(rootCidObj, peers, options);
    allBlocks.set(rootCidObj.toString(), rootBlock);

    if (rootCidObj.codec === 'raw') {
      return { root: rootBlock, allBlocks };
    }

    // 2. Decode DAG-PB node and fetch children recursively with swarm pipelining
    const queue: CID[] = [];
    const visited = new Set<string>([rootCidObj.toString()]);

    const inspectLinks = (nodeBytes: Uint8Array) => {
      try {
        const decoded = decodeDAGPBNode(nodeBytes);
        for (const link of decoded.links) {
          const linkStr = link.cid.toString();
          if (!visited.has(linkStr)) {
            visited.add(linkStr);
            queue.push(link.cid);
          }
        }
      } catch {
        // Not a DAG-PB node or leaf node without links
      }
    };

    inspectLinks(rootBlock);

    if (queue.length === 0) {
      return { root: rootBlock, allBlocks };
    }

    // 3. Swarm Pipelined Concurrent Fetching across available peers
    const concurrency = Math.max(1, Math.min(options?.concurrency ?? 6, 16));
    let peerIndex = 0;

    const fetchNext = async (): Promise<void> => {
      while (queue.length > 0) {
        const nextCid = queue.shift();
        if (!nextCid) break;

        // Round-robin peer prioritization across the swarm
        let candidatePeers = peers;
        if (peers && peers.length > 1) {
          const assigned = peers[peerIndex % peers.length]!;
          peerIndex++;
          const others = peers.filter(p => p !== assigned);
          candidatePeers = [assigned, ...others];
        }

        const childBlock = await this.requestBlock(nextCid, candidatePeers, options);
        allBlocks.set(nextCid.toString(), childBlock);

        if (nextCid.codec === 'dag-pb') {
          inspectLinks(childBlock);
        }
      }
    };

    // Run parallel workers up to concurrency limit
    const workerCount = Math.min(concurrency, queue.length);
    const workers = Array.from({ length: workerCount }, () => fetchNext());
    await Promise.all(workers);

    return { root: rootBlock, allBlocks };
  }

  /**
   * Broadcasts cancellation of wants to peers.
   */
  public async cancelWants(
    cids: readonly (CID | string)[],
    peers?: readonly string[],
  ): Promise<void> {
    if (!this.network) return;

    const cancelEntries: BitSwapWantEntry[] = cids.map(cid => {
      const cidStr = typeof cid === 'string' ? cid : cid.toString();
      this.activeWants.delete(cidStr);
      return {
        cid: cidStr,
        priority: 0,
        cancel: true,
        wantType: 'WANT_BLOCK',
        sendDontHave: false,
      };
    });

    const msg: BitSwapMessage = { wantlist: cancelEntries };
    const targetPeers = peers ?? this.network.getConnectedPeers?.() ?? [];

    await Promise.all(
      targetPeers.map(peerId => this.network!.sendMessage(peerId, msg).catch(() => {})),
    );
  }
}
