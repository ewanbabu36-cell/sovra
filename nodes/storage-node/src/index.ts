import { Result, ok, err } from '@sovra/shared';
import type { MuxedStream } from '@sovra/p2p';
import { LengthPrefixedFrameCodec } from '@sovra/p2p';
import {
  CID,
  MemoryBlockstore,
  DiskBlockstore,
  TieredBlockstore,
  SovraStorageService,
  BitSwapEngine,
  BitSwapNetworkAdapter,
  BitSwapMessage,
  encodeBitSwapMessage,
  UnixFSReader,
  StorageError,
} from '@sovra/storage';
import {
  StorageNodeConfig,
  StorageNodeStats,
  PinRecord,
  PinOptions,
  StorageQuotaUsage,
  GarbageCollectionResult,
  ReplicaVerificationReport,
} from './types.js';
import { ContinuousPinningManager } from './pinning.js';
import { StorageQuotaManager } from './quota.js';
import { ReplicaVerificationEngine, ProofOfRetrievabilityEngine, PoRProof } from './verifier.js';
import { ContentComplianceManager, JurisdictionRulebookPolicy } from './compliance.js';

export * from './types.js';
export * from './pinning.js';
export * from './quota.js';
export * from './verifier.js';
export * from './db.js';
export * from './compliance.js';

export const BITSWAP_PROTOCOL_ID = '/sovra/bitswap/1.2.0';

export class StorageNodeDaemon {
  public blockstore!: TieredBlockstore;
  public storageService!: SovraStorageService;
  public pinningManager!: ContinuousPinningManager;
  public complianceManager!: ContentComplianceManager;
  public jurisdictionPolicy!: JurisdictionRulebookPolicy;
  public quotaManager!: StorageQuotaManager;
  public verifierEngine!: ReplicaVerificationEngine;
  public bitswapEngine?: BitSwapEngine | undefined;

  private readonly activeStreams = new Map<string, MuxedStream>();
  private readonly streamCodecs = new Map<string, LengthPrefixedFrameCodec>();
  private sweeperTimer: NodeJS.Timeout | null = null;
  private _isRunning = false;

  constructor(private readonly config: StorageNodeConfig) {}

  public getConfig(): StorageNodeConfig {
    return this.config;
  }

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public async start(): Promise<Result<void>> {
    if (this._isRunning) return ok(undefined);

    try {
      // 1. Initialize Dual-Tier Local Blockstore (L1 In-Memory LRU + L2 Persistent Sharded Disk)
      const memoryCapacity = this.config.memoryCacheBytes ?? 64 * 1024 * 1024; // 64 MB L1
      const l1Memory = new MemoryBlockstore(memoryCapacity);
      const l2Disk = new DiskBlockstore(
        this.config.storagePath,
        Number(this.config.maxCapacityBytes),
      );

      this.blockstore = new TieredBlockstore(l1Memory, l2Disk);

      // 2. Initialize Sovra Public & Authenticated Private Storage Boundary Service
      this.storageService = new SovraStorageService(this.blockstore);

      // 3. Initialize Continuous Pinning Manager
      this.pinningManager = new ContinuousPinningManager(
        this.blockstore,
        this.config.storagePath,
      );
      await this.pinningManager.init();

      // 3b. Initialize Legal Compliance & Safe-Harbor Manager
      this.complianceManager = new ContentComplianceManager(
        this.pinningManager.getSqliteStore(),
      );
      this.jurisdictionPolicy = new JurisdictionRulebookPolicy(
        this.config.jurisdictionProfile ?? 'GLOBAL_CSAM_ONLY',
      );

      // 4. Initialize Storage Quota & Watermark Manager
      this.quotaManager = new StorageQuotaManager(
        this.blockstore,
        this.pinningManager,
        {
          maxCapacityBytes: this.config.maxCapacityBytes,
          ...this.config.quotas,
        },
      );

      // 5. Initialize BitSwap Protocol Engine & P2P Stream Transport
      if (this.config.enableBitswap) {
        this.bitswapEngine = new BitSwapEngine(this.blockstore);

        if (this.config.p2pNode) {
          const p2p = this.config.p2pNode;

          // Wire BitSwap Network Adapter with real P2P Node
          const networkAdapter: BitSwapNetworkAdapter = {
            sendMessage: async (targetPeerId: string, message: BitSwapMessage) => {
              const stream = await this.getOrOpenBitSwapStream(targetPeerId);
              const encodedMessage = encodeBitSwapMessage(message);
              const framed = LengthPrefixedFrameCodec.encode(encodedMessage);
              await stream.send(framed);
            },
            findProviders: async (cid: string) => {
              return p2p.dht.findProviders(cid);
            },
            getConnectedPeers: () => {
              return p2p.getConnectedPeers().map(p => p.id.peerId);
            },
          };

          this.bitswapEngine.setNetwork(networkAdapter);

          // Register protocol handler for incoming BitSwap streams
          p2p.registerProtocolHandler(BITSWAP_PROTOCOL_ID, (peerId: string, stream: MuxedStream) => {
            this.setupStreamHandler(peerId, stream);
          });
        }
      }

      // 6. Initialize Background Replica Verification Engine
      const verificationInterval = this.config.replicaVerificationIntervalMs ?? 30000;
      this.verifierEngine = new ReplicaVerificationEngine(
        this.pinningManager,
        this.config.p2pNode,
        this.bitswapEngine,
        verificationInterval,
      );
      this.verifierEngine.start();

      // 7. Initialize Pin Lease Sweeper Timer
      const sweeperInterval = this.config.pinLeaseSweeperIntervalMs ?? 60000;
      if (sweeperInterval > 0) {
        this.sweeperTimer = setInterval(() => {
          this.pinningManager.sweepExpiredPins().catch(() => {});
        }, sweeperInterval);
      }

      this._isRunning = true;
      return ok(undefined);
    } catch (e) {
      return err(
        new StorageError(
          `Failed to start StorageNodeDaemon: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  public async stop(): Promise<Result<void>> {
    if (!this._isRunning) return ok(undefined);
    this._isRunning = false;

    // Stop background timers
    if (this.verifierEngine) {
      this.verifierEngine.stop();
    }
    if (this.sweeperTimer) {
      clearInterval(this.sweeperTimer);
      this.sweeperTimer = null;
    }

    if (this.pinningManager) {
      this.pinningManager.close();
    }

    // Close all open protocol streams
    for (const stream of this.activeStreams.values()) {
      try {
        await stream.close();
      } catch {}
    }

    this.activeStreams.clear();
    this.streamCodecs.clear();

    return ok(undefined);
  }

  /**
   * Pins a CID continuously with quota enforcement, recursive DAG resolution, and DHT provider announcement.
   */
  public async pin(cid: CID, options?: PinOptions): Promise<Result<PinRecord>> {
    try {
      // 0. Enforce operator legal compliance deny-list
      if (this.complianceManager.isCidDenied(cid.toString())) {
        return err(
          new StorageError(
            `Content CID '${cid.toString()}' is blocked by operator legal compliance deny-list`,
            'ERR_COMPLIANCE_BLOCKED',
          ),
        );
      }

      // 1. Check local existence and estimate byte size
      const rootBlock = await this.blockstore.get(cid);
      const estSize = rootBlock ? rootBlock.length : 256 * 1024;

      // 2. Enforce storage capacity & author quotas (auto-runs GC if needed)
      await this.quotaManager.ensureCapacityForPin(estSize, options?.creatorDid);

      // 3. Pin continuously through pinning manager (recursive traversal & lease tracking)
      const record = await this.pinningManager.pin(cid, options);

      // 4. Announce provider record to Kademlia DHT
      if (this.config.p2pNode) {
        await this.config.p2pNode.dht.provide(cid.toString());
      }

      return ok(record);
    } catch (e) {
      return err(
        e instanceof StorageError
          ? e
          : new StorageError(
              `Failed to pin CID '${cid.toString()}': ${e instanceof Error ? e.message : String(e)}`,
            ),
      );
    }
  }

  /**
   * Unpins a CID and safely unpins unreferenced child blocks.
   */
  public async unpin(cid: CID): Promise<Result<void>> {
    try {
      await this.pinningManager.unpin(cid);
      return ok(undefined);
    } catch (e) {
      return err(
        e instanceof StorageError
          ? e
          : new StorageError(
              `Failed to unpin CID '${cid.toString()}': ${e instanceof Error ? e.message : String(e)}`,
            ),
      );
    }
  }

  public getPin(cid: CID | string): Result<PinRecord | undefined> {
    try {
      const pin = this.pinningManager.getPin(cid);
      return ok(pin);
    } catch (e) {
      return err(new StorageError(String(e)));
    }
  }

  public listPins(filter?: Parameters<ContinuousPinningManager['listPins']>[0]): readonly PinRecord[] {
    return this.pinningManager ? this.pinningManager.listPins(filter) : [];
  }

  public async renewPin(
    cid: CID | string,
    newExpiresAt?: number,
    ttlMs?: number,
  ): Promise<Result<PinRecord>> {
    try {
      const pin = await this.pinningManager.renewPin(cid, newExpiresAt, ttlMs);
      return ok(pin);
    } catch (e) {
      return err(
        e instanceof StorageError
          ? e
          : new StorageError(`Failed to renew pin: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  public async runGarbageCollection(targetFreeBytes?: bigint): Promise<Result<GarbageCollectionResult>> {
    try {
      const result = await this.quotaManager.runGarbageCollection(targetFreeBytes);
      return ok(result);
    } catch (e) {
      return err(
        new StorageError(
          `Garbage collection failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  public async verifyReplicas(): Promise<Result<ReplicaVerificationReport>> {
    try {
      const report = await this.verifierEngine.verifyReplicas();
      return ok(report);
    } catch (e) {
      return err(
        new StorageError(
          `Replica verification failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  public async verifyRetrievability(
    cid: CID,
    maxResponseTimeMs = 150,
  ): Promise<Result<PoRProof>> {
    try {
      const block = await this.blockstore.get(cid);
      if (!block) {
        return err(new StorageError(`Block not found for PoR: ${cid.toString()}`));
      }
      const challenge = ProofOfRetrievabilityEngine.generateChallenge(cid.toString());
      const proof = ProofOfRetrievabilityEngine.verifyProof(challenge, block, maxResponseTimeMs);
      return ok(proof);
    } catch (e) {
      return err(
        new StorageError(
          `PoR challenge failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  public getQuotaUsage(): StorageQuotaUsage {
    return this.quotaManager.getUsage();
  }

  /**
   * Retrieves content by CID: checks local blockstore first; falls back to BitSwap network fetch.
   */
  public async retrieveContent(cid: CID): Promise<Result<Uint8Array>> {
    try {
      // Check local blockstore
      const hasLocal = await this.blockstore.has(cid);
      if (hasLocal) {
        if (cid.codec === 'raw') {
          const raw = await this.blockstore.get(cid);
          return ok(raw!);
        }
        const reconstructed = await UnixFSReader.reconstructFile(cid, c =>
          this.blockstore.get(c),
        );
        return ok(reconstructed);
      }

      // Fetch via BitSwap if enabled
      if (this.bitswapEngine) {
        const { root } = await this.bitswapEngine.fetchDag(cid);
        if (cid.codec === 'raw') {
          return ok(root);
        }
        const reconstructed = await UnixFSReader.reconstructFile(cid, c =>
          this.blockstore.get(c),
        );
        return ok(reconstructed);
      }

      return err(new StorageError(`Content with CID '${cid.toString()}' not found locally or via BitSwap`));
    } catch (e) {
      return err(
        new StorageError(
          `Failed to retrieve CID '${cid.toString()}': ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  public getStats(): StorageNodeStats {
    const bStats = this.blockstore ? this.blockstore.getStats() : {
      totalBlocks: 0,
      totalSizeBytes: 0,
      pinnedCount: 0,
    };
    const bsStats = this.bitswapEngine ? this.bitswapEngine.getStats() : {
      totalBlocksSent: 0,
      totalBlocksReceived: 0,
      totalBytesSent: 0,
      totalBytesReceived: 0,
    };
    const quotaUsage = this.quotaManager ? this.quotaManager.getUsage() : {
      totalCapacityBytes: this.config.maxCapacityBytes,
      usedBytes: 0n,
      pinnedBytes: 0n,
      cachedBytes: 0n,
      usagePercent: 0,
      isHighWatermarkExceeded: false,
      authorUsage: {},
    };
    const allPins = this.pinningManager ? this.pinningManager.listPins() : [];
    const activePins = allPins.filter(p => p.status !== 'expired');
    const underReplicated = allPins.filter(p => p.status === 'under_replicated');

    return {
      totalBlocks: bStats.totalBlocks,
      totalSizeBytes: bStats.totalSizeBytes,
      maxCapacityBytes: this.config.maxCapacityBytes,
      pinnedCount: bStats.pinnedCount,
      activePinsCount: activePins.length,
      underReplicatedPinsCount: underReplicated.length,
      isBitswapActive: Boolean(this.bitswapEngine),
      activeStreamsCount: this.activeStreams.size,
      totalBlocksSent: bsStats.totalBlocksSent,
      totalBlocksReceived: bsStats.totalBlocksReceived,
      totalBytesSent: bsStats.totalBytesSent,
      totalBytesReceived: bsStats.totalBytesReceived,
      quotaUsage,
    };
  }

  /**
   * Sets up incoming frame parsing and processing on a Yamux stream.
   */
  private setupStreamHandler(peerId: string, stream: MuxedStream): void {
    this.activeStreams.set(peerId, stream);
    const codec = new LengthPrefixedFrameCodec();
    this.streamCodecs.set(peerId, codec);

    stream.onClose(() => {
      this.activeStreams.delete(peerId);
      this.streamCodecs.delete(peerId);
    });

    stream.onData(async chunk => {
      if (!this.bitswapEngine) return;

      codec.appendData(chunk);
      while (codec.hasFrame()) {
        const frame = codec.nextFrame();
        if (!frame) break;

        try {
          await this.bitswapEngine.handleInboundMessage(peerId, frame);
        } catch {}
      }
    });
  }

  /**
   * Retrieves an existing BitSwap stream or opens a new logical stream over the peer's Yamux session.
   */
  private async getOrOpenBitSwapStream(peerId: string): Promise<MuxedStream> {
    const existing = this.activeStreams.get(peerId);
    if (existing && existing.isOpen) {
      return existing;
    }

    if (!this.config.p2pNode) {
      throw new StorageError('Cannot open BitSwap stream: P2PNode is not configured on daemon');
    }

    const stream = await this.config.p2pNode.openProtocolStream(peerId, BITSWAP_PROTOCOL_ID);
    if (!stream) {
      throw new StorageError(`Failed to open protocol stream '${BITSWAP_PROTOCOL_ID}' to peer '${peerId}'`);
    }

    this.setupStreamHandler(peerId, stream);
    return stream;
  }
}
