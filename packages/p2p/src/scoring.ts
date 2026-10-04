import { PeerScoringParameters } from './types.js';

export interface ScoreEvent {
  readonly delta: number;
  readonly reason: string;
  readonly timestamp: number;
}

export const DEFAULT_PEER_SCORING_PARAMS: PeerScoringParameters = {
  topicWeight: 1.0,
  timeInMeshWeight: 0.1,
  firstMessageDeliveriesWeight: 1.0,
  invalidMessageDeliveriesWeight: -50.0,
  decayIntervalMs: 60000,
  graylistThreshold: -20.0,
  blacklistThreshold: -50.0,
};

export class PeerScoringEngine {
  private scores = new Map<string, number>();
  private history = new Map<string, ScoreEvent[]>();
  private params: PeerScoringParameters;

  constructor(customParams?: Partial<PeerScoringParameters>) {
    this.params = { ...DEFAULT_PEER_SCORING_PARAMS, ...customParams };
  }

  public getScore(peerId: string): number {
    return this.scores.get(peerId) ?? 0;
  }

  public recordScoreDelta(peerId: string, delta: number, reason: string): number {
    const current = this.getScore(peerId);
    const updated = current + delta;
    this.scores.set(peerId, updated);

    const events = this.history.get(peerId) ?? [];
    events.push({ delta, reason, timestamp: Date.now() });
    if (events.length > 50) events.shift();
    this.history.set(peerId, events);

    return updated;
  }

  public onValidMessageDelivery(peerId: string): void {
    this.recordScoreDelta(
      peerId,
      this.params.firstMessageDeliveriesWeight,
      'valid_message_delivery',
    );
  }

  public onInvalidSignature(peerId: string): void {
    this.recordScoreDelta(peerId, this.params.invalidMessageDeliveriesWeight, 'invalid_signature');
  }

  public onMalformedMessage(peerId: string): void {
    this.recordScoreDelta(peerId, -25.0, 'malformed_message');
  }

  public onRateLimitExceeded(peerId: string): void {
    this.recordScoreDelta(peerId, -10.0, 'rate_limit_exceeded');
  }

  public onProtocolViolation(peerId: string, details?: string): void {
    this.recordScoreDelta(peerId, -30.0, details ?? 'protocol_violation');
  }

  public onRequestTimeout(peerId: string): void {
    this.recordScoreDelta(peerId, -2.0, 'request_timeout');
  }

  public isGraylisted(peerId: string): boolean {
    return this.getScore(peerId) <= this.params.graylistThreshold;
  }

  public isBlacklisted(peerId: string): boolean {
    return this.getScore(peerId) <= this.params.blacklistThreshold;
  }

  /**
   * Decays all tracked peer scores towards 0 over time
   */
  public decayScores(decayFactor = 0.9): void {
    for (const [peerId, score] of this.scores.entries()) {
      const decayed = score * decayFactor;
      if (Math.abs(decayed) < 0.05) {
        this.scores.delete(peerId);
      } else {
        this.scores.set(peerId, decayed);
      }
    }
  }

  public resetScore(peerId: string): void {
    this.scores.delete(peerId);
    this.history.delete(peerId);
  }
}

export interface NodeSlaMetrics {
  readonly uptimeRatio: number; // 0.0 to 1.0
  readonly successfulBytesRelayed: number;
  readonly totalRequestsCount: number;
  readonly avgLatencyMs: number;
}

/**
 * Pillar 10: Data-Driven Node Health & Infrastructure SLA Scoring Formula.
 * Evaluates node performance on 0-100 scale based on:
 * - 40% Uptime consistency
 * - 40% Bandwidth relay delivery success
 * - 20% Latency responsiveness
 */
export function calculateNodeHealthScore(metrics: NodeSlaMetrics): number {
  const uptimeWeight = Math.min(1.0, Math.max(0, metrics.uptimeRatio)) * 40;
  const relaySuccessRatio =
    metrics.totalRequestsCount > 0
      ? Math.min(1.0, metrics.successfulBytesRelayed / (metrics.totalRequestsCount * 1024))
      : 0.5;
  const deliveryWeight = relaySuccessRatio * 40;
  const latencyClamped = Math.max(10, metrics.avgLatencyMs);
  const latencyWeight = Math.min(20, (100 / latencyClamped) * 20);

  return Math.round(uptimeWeight + deliveryWeight + latencyWeight);
}

export interface PeakWeightedSlaInputs {
  readonly peakHoursUptimeRatio: number; // 0.0 to 1.0 (peak demand hours)
  readonly offPeakHoursUptimeRatio: number; // 0.0 to 1.0
  readonly auditFailureRate: number; // 0.0 to 1.0 (Proof of Retrievability failure rate)
}

/**
 * Pillar 10: Dynamic Peak-Weighted SLA Scoring Equation:
 * SLA = 100 * ((Uptime_peak * 2 + Uptime_offpeak) / 3) * (1 - AuditFailureRate)^3
 */
export function calculatePeakWeightedNodeSla(inputs: PeakWeightedSlaInputs): number {
  const peak = Math.max(0, Math.min(1.0, inputs.peakHoursUptimeRatio));
  const offPeak = Math.max(0, Math.min(1.0, inputs.offPeakHoursUptimeRatio));
  const failure = Math.max(0, Math.min(1.0, inputs.auditFailureRate));

  const weightedUptime = (peak * 2 + offPeak) / 3;
  const auditIntegrity = Math.pow(1 - failure, 3);

  const rawScore = 100 * weightedUptime * auditIntegrity;
  return Math.max(0, Math.min(100, Math.round(rawScore)));
}

/**
 * Pillar 10: Automatic Eviction Rule.
 * If node SLA falls below 65 for 3 or more consecutive audit cycles,
 * the swarm marks it for immediate eviction and triggers replica migration.
 */
export function shouldEvictNodeFromSwarm(
  currentSlaScore: number,
  consecutiveLowScoreCycles: number,
  slaThreshold = 65,
  minFailCycles = 3,
): boolean {
  return currentSlaScore < slaThreshold && consecutiveLowScoreCycles >= minFailCycles;
}


