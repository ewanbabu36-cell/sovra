/**
 * @file packages/p2p/src/delay-skew.ts
 * Pillar 3: Byzantine Slow-Loris Delay Skew & Gossip Eclipse Defense.
 *
 * Real-world problem:
 * Malicious bot nodes do not drop packets (which would trigger standard GossipSub penalties);
 * instead, they intentionally introduce subtle forwarding delays (e.g. 3.5 seconds),
 * desynchronizing CRDT state and forking feeds across network partitions.
 *
 * Solution:
 * 1. Tracks swarm transit delay distribution (mean, standard deviation).
 * 2. Computes peer latency anomaly Z-score: Z_delay = (T_transit - mu_swarm) / sigma_swarm.
 * 3. Applies quadratic exponential penalty: exp(-0.8 * (Z_delay - 1.5)^2).
 * 4. Triggers automatic mesh link PRUNE when consecutive violations >= 3.
 * 5. Provides lightweight Gossip Multi-Ack verification.
 */

export interface PeerTransitSample {
  readonly peerId: string;
  readonly messageId: string;
  readonly transitDelayMs: number;
  readonly timestamp: number;
}

export interface DelayAnomalyResult {
  readonly peerId: string;
  readonly transitDelayMs: number;
  readonly swarmMeanDelayMs: number;
  readonly swarmStdDevDelayMs: number;
  readonly zDelay: number;
  readonly peerScoreMultiplier: number;
  readonly isAnomalous: boolean;
  readonly shouldPrune: boolean;
}

export class PeerDelayAnomalyDetector {
  private readonly samples: PeerTransitSample[] = [];
  private readonly peerViolationCounters = new Map<string, number>();

  constructor(
    private readonly windowSize = 100,
    private readonly zThreshold = 1.5,
    private readonly pruneViolationThreshold = 3,
  ) {}

  public recordSample(sample: PeerTransitSample): void {
    this.samples.push(sample);
    if (this.samples.length > this.windowSize) {
      this.samples.shift();
    }
  }

  public getSwarmMetrics(): { mean: number; stdDev: number } {
    if (this.samples.length === 0) {
      return { mean: 50, stdDev: 15 }; // Default safe baseline
    }

    const total = this.samples.reduce((acc, s) => acc + s.transitDelayMs, 0);
    const mean = total / this.samples.length;

    const variance =
      this.samples.reduce((acc, s) => acc + Math.pow(s.transitDelayMs - mean, 2), 0) /
      this.samples.length;
    const stdDev = Math.max(5, Math.sqrt(variance)); // Avoid divide-by-zero

    return { mean: Math.round(mean * 100) / 100, stdDev: Math.round(stdDev * 100) / 100 };
  }

  /**
   * Computes Z_delay = (T_transit - mu) / sigma.
   * Calculates dynamic penalty multiplier:
   * Multiplier = 1.0 if Z_delay <= 1.5,
   * else exp(-0.8 * (Z_delay - 1.5)^2).
   */
  public evaluatePeer(peerId: string, transitDelayMs: number): DelayAnomalyResult {
    const { mean, stdDev } = this.getSwarmMetrics();
    const rawZ = (transitDelayMs - mean) / stdDev;
    const zDelay = Math.round(rawZ * 100) / 100;

    let multiplier = 1.0;
    const isAnomalous = zDelay > this.zThreshold;

    if (isAnomalous) {
      const delta = zDelay - this.zThreshold;
      multiplier = Math.exp(-0.8 * Math.pow(delta, 2));
      multiplier = Math.max(0.001, Math.round(multiplier * 1000) / 1000);

      const currentCount = (this.peerViolationCounters.get(peerId) ?? 0) + 1;
      this.peerViolationCounters.set(peerId, currentCount);
    } else {
      // Decay violation counter upon good behavior
      const currentCount = this.peerViolationCounters.get(peerId) ?? 0;
      if (currentCount > 0) {
        this.peerViolationCounters.set(peerId, currentCount - 1);
      }
    }

    const consecutiveViolations = this.peerViolationCounters.get(peerId) ?? 0;
    const shouldPrune = consecutiveViolations >= this.pruneViolationThreshold || zDelay > 4.0;

    return {
      peerId,
      transitDelayMs,
      swarmMeanDelayMs: mean,
      swarmStdDevDelayMs: stdDev,
      zDelay,
      peerScoreMultiplier: multiplier,
      isAnomalous,
      shouldPrune,
    };
  }

  public resetPeerViolations(peerId: string): void {
    this.peerViolationCounters.delete(peerId);
  }
}

export interface GossipAckPayload {
  readonly messageHashHex: string;
  readonly originPeerId: string;
  readonly ackTimestamp: number;
}

export class GossipAckVerifier {
  public static createAck(messageHashHex: string, originPeerId: string): GossipAckPayload {
    return {
      messageHashHex,
      originPeerId,
      ackTimestamp: Date.now(),
    };
  }

  public static verifyAck(ack: GossipAckPayload, maxAllowedAgeMs = 5000): boolean {
    if (!ack.messageHashHex || !ack.originPeerId) return false;
    const age = Date.now() - ack.ackTimestamp;
    return age >= 0 && age <= maxAllowedAgeMs;
  }
}
