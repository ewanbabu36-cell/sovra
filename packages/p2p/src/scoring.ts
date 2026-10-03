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
