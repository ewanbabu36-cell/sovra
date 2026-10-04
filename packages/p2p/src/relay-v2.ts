import { Result, ok, err } from '@sovra/shared';
import { RelayUnavailableError } from './errors.js';

export interface TokenBucketConfig {
  readonly capacity: number; // Maximum burst tokens/bytes
  readonly refillRatePerSecond: number; // Tokens added per second
}

/**
 * High-precision Token Bucket rate limiter for preventing DDoS and bandwidth exhaustion.
 */
export class TokenBucketLimiter {
  private tokens: number;
  private lastRefillTimestamp: number;

  constructor(public readonly config: TokenBucketConfig) {
    this.tokens = config.capacity;
    this.lastRefillTimestamp = Date.now();
  }

  public refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTimestamp) / 1000;
    if (elapsedSeconds > 0) {
      this.tokens = Math.min(
        this.config.capacity,
        this.tokens + elapsedSeconds * this.config.refillRatePerSecond,
      );
      this.lastRefillTimestamp = now;
    }
  }

  public tryConsume(tokens: number): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  public getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

export type CircuitStatus = 'active' | 'quota_exceeded' | 'expired' | 'closed';

export interface CircuitReservationV2 {
  readonly circuitId: string;
  readonly clientPeerId: string;
  readonly targetPeerId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly maxBytes: number;
  bytesRelayed: number;
  status: CircuitStatus;
}

export interface CircuitRelayV2Config {
  readonly maxConcurrentCircuits?: number;
  readonly defaultMaxDurationSeconds?: number;
  readonly defaultMaxBytesPerCircuit?: number;
  readonly peerBandwidthCapacityBytes?: number;
  readonly peerBandwidthRefillBytesPerSec?: number;
}

export interface RelayMetricsV2 {
  readonly activeCircuits: number;
  readonly totalCircuitsRelayed: number;
  readonly totalBytesRelayed: number;
  readonly quotaExceededCount: number;
  readonly expiredCount: number;
  readonly rejectedCount: number;
}

/**
 * Circuit Relay v2 Protocol implementation.
 * Protects relay nodes against resource exhaustion attacks via:
 * - Token-bucket rate limiting per peer
 * - Strict maximum byte quotas per circuit
 * - Maximum circuit duration enforcement
 * - Global active circuit capacity boundaries
 */
export class CircuitRelayV2 {
  private readonly maxConcurrentCircuits: number;
  private readonly defaultMaxDurationSeconds: number;
  private readonly defaultMaxBytesPerCircuit: number;
  private readonly peerBandwidthCapacityBytes: number;
  private readonly peerBandwidthRefillBytesPerSec: number;

  private readonly circuits = new Map<string, CircuitReservationV2>();
  private readonly peerLimiters = new Map<string, TokenBucketLimiter>();

  private totalCircuitsRelayed = 0;
  private totalBytesRelayed = 0;
  private quotaExceededCount = 0;
  private expiredCount = 0;
  private rejectedCount = 0;

  constructor(config: CircuitRelayV2Config = {}) {
    this.maxConcurrentCircuits = config.maxConcurrentCircuits ?? 100;
    this.defaultMaxDurationSeconds = config.defaultMaxDurationSeconds ?? 900; // 15 min default
    this.defaultMaxBytesPerCircuit = config.defaultMaxBytesPerCircuit ?? 5 * 1024 * 1024; // 5 MB per circuit
    this.peerBandwidthCapacityBytes = config.peerBandwidthCapacityBytes ?? 10 * 1024 * 1024; // 10 MB burst
    this.peerBandwidthRefillBytesPerSec = config.peerBandwidthRefillBytesPerSec ?? 256 * 1024; // 256 KB/s
  }

  private getLimiter(peerId: string): TokenBucketLimiter {
    let limiter = this.peerLimiters.get(peerId);
    if (!limiter) {
      limiter = new TokenBucketLimiter({
        capacity: this.peerBandwidthCapacityBytes,
        refillRatePerSecond: this.peerBandwidthRefillBytesPerSec,
      });
      this.peerLimiters.set(peerId, limiter);
    }
    return limiter;
  }

  public cleanupExpired(): void {
    const now = Date.now();
    for (const [, circuit] of this.circuits) {
      if (circuit.status === 'active' && now >= circuit.expiresAt) {
        circuit.status = 'expired';
        this.expiredCount++;
      }
    }
  }

  public createCircuit(
    clientPeerId: string,
    targetPeerId: string,
    requestedDurationSeconds?: number,
    customMaxBytes?: number,
  ): Result<CircuitReservationV2> {
    this.cleanupExpired();

    // Check active circuits capacity
    const activeCount = Array.from(this.circuits.values()).filter(c => c.status === 'active').length;
    if (activeCount >= this.maxConcurrentCircuits) {
      this.rejectedCount++;
      return err(
        new RelayUnavailableError(
          `Circuit Relay limit reached (${this.maxConcurrentCircuits} concurrent circuits active)`,
        ),
      );
    }

    // Rate-limit check on client peer
    const limiter = this.getLimiter(clientPeerId);
    if (limiter.getAvailableTokens() <= 0) {
      this.rejectedCount++;
      return err(
        new RelayUnavailableError(
          `Rate limit exceeded for peer ${clientPeerId}. Bandwidth quota depleted.`,
        ),
      );
    }

    const now = Date.now();
    const durationSec = Math.min(
      requestedDurationSeconds ?? this.defaultMaxDurationSeconds,
      this.defaultMaxDurationSeconds,
    );
    const maxBytes = Math.min(
      customMaxBytes ?? this.defaultMaxBytesPerCircuit,
      this.defaultMaxBytesPerCircuit,
    );

    const circuitId = `cir_${now}_${Math.random().toString(36).substring(2, 9)}`;
    const circuit: CircuitReservationV2 = {
      circuitId,
      clientPeerId,
      targetPeerId,
      createdAt: now,
      expiresAt: now + durationSec * 1000,
      maxBytes,
      bytesRelayed: 0,
      status: 'active',
    };

    this.circuits.set(circuitId, circuit);
    this.totalCircuitsRelayed++;

    return ok(circuit);
  }

  public relayChunk(
    circuitId: string,
    chunkSizeBytes: number,
  ): Result<{ bytesRelayed: number; remainingBytes: number }> {
    const circuit = this.circuits.get(circuitId);
    if (!circuit) {
      return err(new RelayUnavailableError(`Circuit ${circuitId} not found`));
    }

    if (Date.now() >= circuit.expiresAt) {
      circuit.status = 'expired';
      this.expiredCount++;
      return err(new RelayUnavailableError(`Circuit ${circuitId} has expired`));
    }

    if (circuit.status !== 'active') {
      return err(new RelayUnavailableError(`Circuit ${circuitId} is not active (status: ${circuit.status})`));
    }

    // Enforce circuit max bytes quota
    if (circuit.bytesRelayed + chunkSizeBytes > circuit.maxBytes) {
      circuit.status = 'quota_exceeded';
      this.quotaExceededCount++;
      return err(
        new RelayUnavailableError(
          `Circuit ${circuitId} exceeded max transfer limit (${circuit.maxBytes} bytes)`,
        ),
      );
    }

    // Enforce peer token-bucket consumption
    const limiter = this.getLimiter(circuit.clientPeerId);
    if (!limiter.tryConsume(chunkSizeBytes)) {
      return err(
        new RelayUnavailableError(
          `Client peer ${circuit.clientPeerId} token bucket throttled for ${chunkSizeBytes} bytes`,
        ),
      );
    }

    circuit.bytesRelayed += chunkSizeBytes;
    this.totalBytesRelayed += chunkSizeBytes;

    return ok({
      bytesRelayed: circuit.bytesRelayed,
      remainingBytes: circuit.maxBytes - circuit.bytesRelayed,
    });
  }

  public closeCircuit(circuitId: string): void {
    const circuit = this.circuits.get(circuitId);
    if (circuit && circuit.status === 'active') {
      circuit.status = 'closed';
    }
  }

  public getCircuit(circuitId: string): CircuitReservationV2 | undefined {
    return this.circuits.get(circuitId);
  }

  public getActiveCircuits(): readonly CircuitReservationV2[] {
    this.cleanupExpired();
    return Array.from(this.circuits.values()).filter(c => c.status === 'active');
  }

  public getMetrics(): RelayMetricsV2 {
    this.cleanupExpired();
    const active = Array.from(this.circuits.values()).filter(c => c.status === 'active').length;
    return {
      activeCircuits: active,
      totalCircuitsRelayed: this.totalCircuitsRelayed,
      totalBytesRelayed: this.totalBytesRelayed,
      quotaExceededCount: this.quotaExceededCount,
      expiredCount: this.expiredCount,
      rejectedCount: this.rejectedCount,
    };
  }
}
