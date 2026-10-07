/**
 * @file nodes/relay-node/src/index.ts
 * Standalone Circuit Relay v2 Node Daemon.
 */

import { Result, ok, err } from '@sovra/shared';
import {
  CircuitRelayV2,
  CircuitReservationV2,
  RelayMetricsV2,
} from '@sovra/p2p';

export interface RelayNodeConfig {
  readonly listenPort: number;
  readonly maxReservations: number;
  readonly maxCircuits: number;
  readonly bufferDurationSeconds: number;
  readonly peerBandwidthCapacityBytes?: number | undefined;
}

export class RelayDaemon {
  public relayEngine?: CircuitRelayV2 | undefined;
  private _isRunning = false;

  constructor(private readonly config: RelayNodeConfig) {}

  public getConfig(): RelayNodeConfig {
    return this.config;
  }

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public async start(): Promise<Result<void>> {
    if (this._isRunning) return ok(undefined);

    try {
      this.relayEngine = new CircuitRelayV2({
        maxConcurrentCircuits: this.config.maxCircuits,
        defaultMaxDurationSeconds: this.config.bufferDurationSeconds,
        peerBandwidthCapacityBytes: this.config.peerBandwidthCapacityBytes ?? 10 * 1024 * 1024,
      });

      this._isRunning = true;
      return ok(undefined);
    } catch (e: any) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  public async stop(): Promise<Result<void>> {
    if (!this._isRunning) return ok(undefined);
    this._isRunning = false;
    this.relayEngine = undefined;
    return ok(undefined);
  }

  public createCircuit(
    clientPeerId: string,
    targetPeerId: string,
    requestedDurationSeconds?: number,
    maxBytes?: number,
  ): Result<CircuitReservationV2> {
    if (!this.relayEngine || !this._isRunning) {
      return err(new Error('Relay daemon is not running'));
    }
    return this.relayEngine.createCircuit(clientPeerId, targetPeerId, requestedDurationSeconds, maxBytes);
  }

  public relayChunk(
    circuitId: string,
    chunkSizeBytes: number,
  ): Result<{ bytesRelayed: number; remainingBytes: number }> {
    if (!this.relayEngine || !this._isRunning) {
      return err(new Error('Relay daemon is not running'));
    }
    return this.relayEngine.relayChunk(circuitId, chunkSizeBytes);
  }

  public closeCircuit(circuitId: string): Result<void> {
    if (!this.relayEngine || !this._isRunning) {
      return err(new Error('Relay daemon is not running'));
    }
    this.relayEngine.closeCircuit(circuitId);
    return ok(undefined);
  }

  public getMetrics(): RelayMetricsV2 {
    if (!this.relayEngine) {
      return {
        activeCircuits: 0,
        totalCircuitsRelayed: 0,
        totalBytesRelayed: 0,
        quotaExceededCount: 0,
        expiredCount: 0,
        rejectedCount: 0,
      };
    }
    return this.relayEngine.getMetrics();
  }
}
