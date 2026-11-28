import { Result, ok, err } from '@sovra/shared';
import { RelayUnavailableError } from './errors.js';

export const CIRCUIT_RELAY_V2_HOP_PROTOCOL = '/libp2p/circuit/relay/0.2.0/hop';
export const CIRCUIT_RELAY_V2_STOP_PROTOCOL = '/libp2p/circuit/relay/0.2.0/stop';

export type RelayHopType = 'RESERVE' | 'CONNECT' | 'STATUS';
export type RelayStopType = 'CONNECT' | 'STATUS';

export type RelayResponseStatus =
  | 'OK'
  | 'RESERVATION_REFUSED'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'PERMISSION_DENIED'
  | 'CONNECTION_FAILED'
  | 'NO_RESERVATION'
  | 'MALFORMED_MESSAGE';

export interface RelayLimit {
  readonly durationSeconds: number;
  readonly maxDataBytes: number;
}

export interface RelayReservationInfo {
  readonly clientPeerId: string;
  readonly expiresAt: number;
  readonly relayAddrs: readonly string[];
  readonly limit: RelayLimit;
  readonly voucherHex?: string;
}

export interface RelayHopMessage {
  readonly type: RelayHopType;
  readonly peerId?: string;
  readonly targetPeerId?: string;
  readonly circuitId?: string;
  readonly status?: RelayResponseStatus;
  readonly reservation?: RelayReservationInfo;
  readonly limit?: RelayLimit;
  readonly errorMessage?: string;
}

export interface RelayStopMessage {
  readonly type: RelayStopType;
  readonly peerId?: string;
  readonly status?: RelayResponseStatus;
  readonly limit?: RelayLimit;
  readonly errorMessage?: string;
}

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
  readonly maxReservations?: number;
  readonly reservationDurationSeconds?: number;
}

export interface RelayMetricsV2 {
  readonly activeCircuits: number;
  readonly totalCircuitsRelayed: number;
  readonly totalBytesRelayed: number;
  readonly activeReservations: number;
  readonly quotaExceededCount: number;
  readonly expiredCount: number;
  readonly rejectedCount: number;
}

/**
 * Circuit Relay v2 Protocol Server implementation.
 * Protects relay nodes against resource exhaustion attacks via:
 * - Token-bucket rate limiting per peer
 * - Strict maximum byte quotas per circuit
 * - Maximum circuit duration enforcement
 * - Global active circuit capacity boundaries
 * - Long-lived client reservations with automatic TTL expiration
 */
export class CircuitRelayV2 {
  private readonly maxConcurrentCircuits: number;
  private readonly defaultMaxDurationSeconds: number;
  private readonly defaultMaxBytesPerCircuit: number;
  private readonly peerBandwidthCapacityBytes: number;
  private readonly peerBandwidthRefillBytesPerSec: number;
  private readonly maxReservations: number;
  private readonly reservationDurationSeconds: number;

  private readonly circuits = new Map<string, CircuitReservationV2>();
  private readonly reservations = new Map<string, RelayReservationInfo>();
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
    this.maxReservations = config.maxReservations ?? 500;
    this.reservationDurationSeconds = config.reservationDurationSeconds ?? 7200; // 2 hours
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
    for (const [peerId, res] of this.reservations) {
      if (now >= res.expiresAt) {
        this.reservations.delete(peerId);
      }
    }
  }

  public addReservation(
    clientPeerId: string,
    relayAddrs: readonly string[] = [],
    customDurationSec?: number,
  ): Result<RelayReservationInfo> {
    this.cleanupExpired();

    if (this.reservations.size >= this.maxReservations) {
      this.rejectedCount++;
      return err(new RelayUnavailableError(`Relay reached max reservations (${this.maxReservations})`));
    }

    const durationSec = customDurationSec ?? this.reservationDurationSeconds;
    const expiresAt = Date.now() + durationSec * 1000;
    const limit: RelayLimit = {
      durationSeconds: this.defaultMaxDurationSeconds,
      maxDataBytes: this.defaultMaxBytesPerCircuit,
    };

    const voucherHex = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
    ).join('');

    const info: RelayReservationInfo = {
      clientPeerId,
      expiresAt,
      relayAddrs,
      limit,
      voucherHex,
    };

    this.reservations.set(clientPeerId, info);
    return ok(info);
  }

  public getReservation(clientPeerId: string): RelayReservationInfo | undefined {
    this.cleanupExpired();
    return this.reservations.get(clientPeerId);
  }

  public hasReservation(clientPeerId: string): boolean {
    this.cleanupExpired();
    return this.reservations.has(clientPeerId);
  }

  public removeReservation(clientPeerId: string): void {
    this.reservations.delete(clientPeerId);
  }

  public getAllReservations(): readonly RelayReservationInfo[] {
    this.cleanupExpired();
    return Array.from(this.reservations.values());
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

  public handleHopMessage(
    fromPeerId: string,
    msg: RelayHopMessage,
    relayAddrs: readonly string[] = [],
  ): RelayHopMessage {
    this.cleanupExpired();

    if (msg.type === 'RESERVE') {
      const resResult = this.addReservation(fromPeerId, relayAddrs);
      if (!resResult.ok) {
        return {
          type: 'STATUS',
          status: 'RESERVATION_REFUSED',
          errorMessage: resResult.error.message,
        };
      }
      return {
        type: 'STATUS',
        status: 'OK',
        reservation: resResult.value,
        limit: resResult.value.limit,
      };
    }

    if (msg.type === 'CONNECT') {
      const targetId = msg.targetPeerId;
      if (!targetId) {
        return {
          type: 'STATUS',
          status: 'MALFORMED_MESSAGE',
          errorMessage: 'targetPeerId missing from CONNECT request',
        };
      }

      if (!this.hasReservation(targetId)) {
        return {
          type: 'STATUS',
          status: 'NO_RESERVATION',
          errorMessage: `Target peer ${targetId} has no active reservation on this relay`,
        };
      }

      const circuitResult = this.createCircuit(fromPeerId, targetId);
      if (!circuitResult.ok) {
        return {
          type: 'STATUS',
          status: 'RESOURCE_LIMIT_EXCEEDED',
          errorMessage: circuitResult.error.message,
        };
      }

      return {
        type: 'STATUS',
        status: 'OK',
        circuitId: circuitResult.value.circuitId,
        limit: {
          durationSeconds: this.defaultMaxDurationSeconds,
          maxDataBytes: circuitResult.value.maxBytes,
        },
      };
    }

    return {
      type: 'STATUS',
      status: 'OK',
    };
  }

  public getMetrics(): RelayMetricsV2 {
    this.cleanupExpired();
    const active = Array.from(this.circuits.values()).filter(c => c.status === 'active').length;
    return {
      activeCircuits: active,
      totalCircuitsRelayed: this.totalCircuitsRelayed,
      totalBytesRelayed: this.totalBytesRelayed,
      activeReservations: this.reservations.size,
      quotaExceededCount: this.quotaExceededCount,
      expiredCount: this.expiredCount,
      rejectedCount: this.rejectedCount,
    };
  }
}

/**
 * Circuit Relay v2 Client for mobile handsets and CGNAT peers.
 */
export class CircuitRelayV2Client {
  private readonly relayAddrs = new Set<string>();
  private readonly activeReservations = new Map<string, RelayReservationInfo>();

  constructor(initialRelays: readonly string[] = []) {
    for (const r of initialRelays) {
      this.relayAddrs.add(r);
    }
  }

  public addRelayAddress(multiaddr: string): void {
    this.relayAddrs.add(multiaddr);
  }

  public removeRelayAddress(multiaddr: string): void {
    this.relayAddrs.delete(multiaddr);
    this.activeReservations.delete(multiaddr);
  }

  public getRelayAddresses(): readonly string[] {
    return Array.from(this.relayAddrs);
  }

  public setReservation(relayKey: string, res: RelayReservationInfo): void {
    this.activeReservations.set(relayKey, res);
  }

  public getReservation(relayKey: string): RelayReservationInfo | undefined {
    const res = this.activeReservations.get(relayKey);
    if (res && Date.now() >= res.expiresAt) {
      this.activeReservations.delete(relayKey);
      return undefined;
    }
    return res;
  }

  public hasActiveReservation(relayKey?: string): boolean {
    if (relayKey) {
      return Boolean(this.getReservation(relayKey));
    }
    const now = Date.now();
    for (const [k, v] of this.activeReservations) {
      if (now < v.expiresAt) return true;
      this.activeReservations.delete(k);
    }
    return false;
  }

  public getActiveReservations(): readonly RelayReservationInfo[] {
    const now = Date.now();
    const active: RelayReservationInfo[] = [];
    for (const [k, v] of this.activeReservations) {
      if (now < v.expiresAt) {
        active.push(v);
      } else {
        this.activeReservations.delete(k);
      }
    }
    return active;
  }

  public createReserveRequest(myPeerId: string): RelayHopMessage {
    return {
      type: 'RESERVE',
      peerId: myPeerId,
    };
  }

  public createConnectRequest(targetPeerId: string): RelayHopMessage {
    return {
      type: 'CONNECT',
      targetPeerId,
    };
  }

  public createStopResponse(status: RelayResponseStatus = 'OK'): RelayStopMessage {
    return {
      type: 'STATUS',
      status,
    };
  }

  /**
   * Generates advertised multiaddrs with /p2p-circuit encapsulation.
   * e.g. /dns4/relay1.sovra.network/tcp/4001/p2p/<RelayPeerId>/p2p-circuit/p2p/<MyPeerId>
   */
  public getAdvertisedRelayedAddrs(myPeerId: string): string[] {
    const addrs: string[] = [];
    for (const [relayAddr, res] of this.activeReservations) {
      if (Date.now() >= res.expiresAt) continue;
      const baseClean = relayAddr.replace(/\/p2p-circuit.*$/, '');
      addrs.push(`${baseClean}/p2p-circuit/p2p/${myPeerId}`);
    }
    return addrs;
  }
}
