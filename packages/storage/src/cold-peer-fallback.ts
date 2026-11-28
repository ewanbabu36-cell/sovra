import {
  sha256,
  blake3Hash,
  constantTimeEquals,
} from '@sovra/crypto';
import { CID } from './cid.js';
import { IntegrityVerificationError } from './errors.js';

export interface DePINStorageMiner {
  readonly peerId: string;
  readonly did: string;
  readonly endpoint: string;
  reputationScore: number;
  totalBytesServed: number;
  rewardBalance_uSOV: number;
  lastActive: number;
  latencyMs?: number;
  failures?: number;
}

export interface DePINGateway {
  readonly name: string;
  readonly urlTemplate: string; // e.g. "https://edge.sovra.net/ipfs/{cid}"
  readonly priority: number;
  isOnline: boolean;
  failures: number;
}

export interface ColdPeerFallbackOptions {
  readonly defaultTimeoutMs?: number;
  readonly rewardRate_uSOVPer64KB?: number;
  readonly fastResponseThresholdMs?: number;
  readonly speedBonusMultiplier?: number;
  readonly hedgeConcurrency?: number;
  readonly customFetcher?: (url: string, timeoutMs: number) => Promise<Uint8Array | null>;
}

export class ColdPeerFallbackEngine {
  private readonly defaultTimeoutMs: number;
  private readonly rewardRate_uSOVPer64KB: number;
  private readonly fastResponseThresholdMs: number;
  private readonly speedBonusMultiplier: number;
  private readonly hedgeConcurrency: number;
  private readonly customFetcher?: ((url: string, timeoutMs: number) => Promise<Uint8Array | null>) | undefined;

  private readonly miners = new Map<string, DePINStorageMiner>();
  private readonly gateways: DePINGateway[] = [];
  private _totalBytesRecovered = 0;
  private _totalFallbacksServed = 0;

  constructor(options: ColdPeerFallbackOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 4000;
    this.rewardRate_uSOVPer64KB = options.rewardRate_uSOVPer64KB ?? 1.0;
    this.fastResponseThresholdMs = options.fastResponseThresholdMs ?? 150;
    this.speedBonusMultiplier = options.speedBonusMultiplier ?? 1.0;
    this.hedgeConcurrency = Math.max(1, options.hedgeConcurrency ?? 3);
    this.customFetcher = options.customFetcher;
  }

  public registerGateway(gateway: DePINGateway): void {
    this.gateways.push({ ...gateway });
    this.gateways.sort((a, b) => a.priority - b.priority);
  }

  public registerMiner(miner: DePINStorageMiner): void {
    this.miners.set(miner.peerId, { ...miner });
  }

  public getMiner(peerId: string): DePINStorageMiner | undefined {
    return this.miners.get(peerId);
  }

  public listMiners(): readonly DePINStorageMiner[] {
    return Array.from(this.miners.values());
  }

  public listGateways(): readonly DePINGateway[] {
    return [...this.gateways];
  }

  public getStats() {
    return {
      totalBytesRecovered: this._totalBytesRecovered,
      totalFallbacksServed: this._totalFallbacksServed,
      activeMinersCount: this.miners.size,
      registeredGatewaysCount: this.gateways.length,
    };
  }

  /**
   * Cryptographically verifies block data against the CID digest.
   * Throws IntegrityVerificationError if the hash does not match.
   */
  public verifyIntegrity(cidStr: string, data: Uint8Array): void {
    const cidObj = CID.parse(cidStr);
    const computedDigest =
      cidObj.multihashType === 'blake3'
        ? blake3Hash(data)
        : sha256(data);

    if (!constantTimeEquals(computedDigest, cidObj.digest)) {
      throw new IntegrityVerificationError(
        cidStr,
        cidObj.multihash,
        Buffer.from(computedDigest).toString('hex'),
      );
    }
  }

  /**
   * Ranks eligible DePIN miners by lowest EWMA latency first, then highest reputation.
   */
  public rankMinersBySpeed(): DePINStorageMiner[] {
    return Array.from(this.miners.values())
      .filter(m => m.reputationScore >= 10)
      .sort((a, b) => {
        const latA = a.latencyMs ?? 250;
        const latB = b.latencyMs ?? 250;
        if (latA !== latB) return latA - latB;
        return b.reputationScore - a.reputationScore;
      });
  }

  private async tryFetchVerifiedBlock(
    url: string,
    cidStr: string,
    timeoutMs: number,
  ): Promise<{ data: Uint8Array; elapsedMs: number } | null> {
    const startedAt = Date.now();
    const data = await this.fetchData(url, timeoutMs);
    if (!data || data.length === 0) return null;
    this.verifyIntegrity(cidStr, data);
    return { data, elapsedMs: Math.max(1, Date.now() - startedAt) };
  }

  private async raceHedgedBatch<T>(
    items: readonly T[],
    worker: (item: T) => Promise<Uint8Array | null>,
  ): Promise<Uint8Array | null> {
    for (let i = 0; i < items.length; i += this.hedgeConcurrency) {
      const batch = items.slice(i, i + this.hedgeConcurrency);
      try {
        return await Promise.any(
          batch.map(async (item) => {
            const data = await worker(item);
            if (!data) throw new Error('MISS');
            return data;
          }),
        );
      } catch (aggErr: any) {
        const errs: unknown[] = Array.isArray(aggErr?.errors) ? aggErr.errors : [aggErr];
        const integrityErr = errs.find(e => e instanceof IntegrityVerificationError);
        if (integrityErr) throw integrityErr;
      }
    }
    return null;
  }

  /**
   * Resolves a cold or unavailable block via hedged parallel racing across latency-ranked
   * DePIN miners first, then cold edge gateways, verifying cryptographic CID integrity.
   */
  public async resolveColdBlock(
    cidStr: string,
    options?: { timeoutMs?: number },
  ): Promise<Uint8Array | null> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    // 1. Race top latency-ranked DePIN storage miners in hedged parallel batches
    const rankedMiners = this.rankMinersBySpeed();
    const minerData = await this.raceHedgedBatch(rankedMiners, async (miner) => {
      const url = miner.endpoint.replace('{cid}', cidStr);
      try {
        const result = await this.tryFetchVerifiedBlock(url, cidStr, timeoutMs);
        if (!result) {
          miner.failures = (miner.failures ?? 0) + 1;
          return null;
        }
        const { data, elapsedMs } = result;
        miner.latencyMs = miner.latencyMs !== undefined
          ? Math.round(miner.latencyMs * 0.7 + elapsedMs * 0.3)
          : elapsedMs;
        miner.failures = 0;

        const blocksOf64KB = Math.max(1, Math.ceil(data.length / (64 * 1024)));
        const bonus = elapsedMs <= this.fastResponseThresholdMs ? this.speedBonusMultiplier : 1.0;
        miner.rewardBalance_uSOV += blocksOf64KB * this.rewardRate_uSOVPer64KB * bonus;
        miner.totalBytesServed += data.length;
        miner.reputationScore = Math.min(100, miner.reputationScore + 1);
        miner.lastActive = Date.now();

        this._totalBytesRecovered += data.length;
        this._totalFallbacksServed += 1;
        return data;
      } catch (err) {
        if (err instanceof IntegrityVerificationError) {
          miner.reputationScore = Math.max(0, miner.reputationScore - 20);
          throw err;
        }
        miner.failures = (miner.failures ?? 0) + 1;
        return null;
      }
    });
    if (minerData) return minerData;

    // 2. Fall back to concurrent batch racing across healthy gateways ordered by priority
    const onlineGateways = this.gateways.filter(gw => gw.isOnline);
    return this.raceHedgedBatch(onlineGateways, async (gw) => {
      const url = gw.urlTemplate.replace('{cid}', cidStr);
      try {
        const result = await this.tryFetchVerifiedBlock(url, cidStr, timeoutMs);
        if (!result) {
          gw.failures += 1;
          if (gw.failures >= 3) gw.isOnline = false;
          return null;
        }
        gw.failures = 0;
        this._totalBytesRecovered += result.data.length;
        this._totalFallbacksServed += 1;
        return result.data;
      } catch (err) {
        if (err instanceof IntegrityVerificationError) throw err;
        gw.failures += 1;
        if (gw.failures >= 3) gw.isOnline = false;
        return null;
      }
    });
  }

  private async fetchData(url: string, timeoutMs: number): Promise<Uint8Array | null> {
    if (this.customFetcher) {
      return this.customFetcher(url, timeoutMs);
    }

    if (typeof fetch === 'function') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return null;
        const arrayBuf = await res.arrayBuffer();
        return new Uint8Array(arrayBuf);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }

    return null;
  }
}
