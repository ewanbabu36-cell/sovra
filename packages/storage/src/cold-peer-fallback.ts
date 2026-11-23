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
  readonly customFetcher?: (url: string, timeoutMs: number) => Promise<Uint8Array | null>;
}

export class ColdPeerFallbackEngine {
  private readonly defaultTimeoutMs: number;
  private readonly rewardRate_uSOVPer64KB: number;
  private readonly customFetcher?: ((url: string, timeoutMs: number) => Promise<Uint8Array | null>) | undefined;

  private readonly miners = new Map<string, DePINStorageMiner>();
  private readonly gateways: DePINGateway[] = [];
  private _totalBytesRecovered = 0;
  private _totalFallbacksServed = 0;

  constructor(options: ColdPeerFallbackOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 4000;
    this.rewardRate_uSOVPer64KB = options.rewardRate_uSOVPer64KB ?? 1.0;
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
   * Resolves a cold or unavailable block from decentralized gateways or DePIN storage miners,
   * verifying cryptographic authenticity before returning.
   */
  public async resolveColdBlock(
    cidStr: string,
    options?: { timeoutMs?: number },
  ): Promise<Uint8Array | null> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    // 1. First probe registered DePIN storage miners
    for (const miner of this.miners.values()) {
      if (miner.reputationScore < 10) continue;
      const url = miner.endpoint.replace('{cid}', cidStr);
      try {
        const data = await this.fetchData(url, timeoutMs);
        if (data && data.length > 0) {
          // Verify cryptographic authenticity
          this.verifyIntegrity(cidStr, data);

          // Credit DePIN miner with micro-rewards
          const blocksOf64KB = Math.max(1, Math.ceil(data.length / (64 * 1024)));
          miner.rewardBalance_uSOV += blocksOf64KB * this.rewardRate_uSOVPer64KB;
          miner.totalBytesServed += data.length;
          miner.reputationScore = Math.min(100, miner.reputationScore + 1);
          miner.lastActive = Date.now();

          this._totalBytesRecovered += data.length;
          this._totalFallbacksServed += 1;
          return data;
        }
      } catch (err) {
        if (err instanceof IntegrityVerificationError) {
          miner.reputationScore = Math.max(0, miner.reputationScore - 20);
          throw err;
        }
        // Network failure; try next miner
      }
    }

    // 2. Fall back to registered cold edge gateways
    for (const gw of this.gateways) {
      if (!gw.isOnline) continue;
      const url = gw.urlTemplate.replace('{cid}', cidStr);
      try {
        const data = await this.fetchData(url, timeoutMs);
        if (data && data.length > 0) {
          this.verifyIntegrity(cidStr, data);
          gw.failures = 0;
          this._totalBytesRecovered += data.length;
          this._totalFallbacksServed += 1;
          return data;
        }
      } catch (err) {
        if (err instanceof IntegrityVerificationError) {
          throw err;
        }
        gw.failures += 1;
        if (gw.failures >= 3) {
          gw.isOnline = false;
        }
      }
    }

    return null;
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
