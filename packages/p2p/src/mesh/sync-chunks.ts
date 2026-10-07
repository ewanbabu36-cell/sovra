/**
 * @file packages/p2p/src/mesh/sync-chunks.ts
 * Resumable Chunked Synchronization Protocol for Constrained & Intermittent Links.
 *
 * Implements:
 * 1. Resumable Chunking for multi-event synchronization payloads.
 * 2. Per-chunk CRC-32 and payload-level SHA-256 integrity verification.
 * 3. Bitmask / index missing-chunk computation for interrupted sync sessions.
 * 4. Reconnection resumption: only missing chunks are retransmitted.
 */

import { sha256, bytesToHex } from '@sovra/crypto';
import { computeCrc32 } from './ble-codec.js';

export interface ResumableSyncChunk {
  readonly transferId: string;
  readonly chunkIndex: number;
  readonly totalChunks: number;
  readonly chunkData: Uint8Array;
  readonly chunkCrc32: number;
  readonly payloadHash: string;
}

export interface ResumeChunkRequest {
  readonly transferId: string;
  readonly missingIndices: readonly number[];
}

export interface InboundTransferProgress {
  readonly transferId: string;
  readonly totalChunks: number;
  readonly receivedCount: number;
  readonly isComplete: boolean;
  readonly missingIndices: readonly number[];
}

export type ChunkReceiveResult =
  | { readonly status: 'IN_PROGRESS'; readonly receivedCount: number; readonly totalChunks: number }
  | { readonly status: 'COMPLETED'; readonly payload: Uint8Array; readonly payloadHash: string }
  | { readonly status: 'CORRUPTED'; readonly reason: string };

export class ResumableSyncSender {
  public readonly transferId: string;
  public readonly payloadHash: string;
  public readonly totalChunks: number;
  private readonly chunks: ResumableSyncChunk[] = [];

  constructor(transferId: string, payload: Uint8Array, chunkSize = 256) {
    this.transferId = transferId;
    this.payloadHash = bytesToHex(sha256(payload));

    const effectiveChunkSize = Math.max(16, chunkSize);
    const total = Math.ceil(payload.length / effectiveChunkSize) || 1;
    this.totalChunks = total;

    for (let i = 0; i < total; i++) {
      const start = i * effectiveChunkSize;
      const end = Math.min(start + effectiveChunkSize, payload.length);
      const chunkData = payload.slice(start, end);
      const chunkCrc32 = computeCrc32(chunkData);

      this.chunks.push({
        transferId,
        chunkIndex: i,
        totalChunks: total,
        chunkData,
        chunkCrc32,
        payloadHash: this.payloadHash,
      });
    }
  }

  public getAllChunks(): readonly ResumableSyncChunk[] {
    return this.chunks;
  }

  public getChunk(index: number): ResumableSyncChunk | undefined {
    return this.chunks[index];
  }

  public getChunks(indices: readonly number[]): ResumableSyncChunk[] {
    const result: ResumableSyncChunk[] = [];
    for (const idx of indices) {
      const c = this.chunks[idx];
      if (c) {
        result.push(c);
      }
    }
    return result;
  }
}

interface InboundTransferState {
  readonly transferId: string;
  readonly totalChunks: number;
  readonly payloadHash: string;
  readonly receivedChunks: Map<number, Uint8Array>;
  readonly createdAt: number;
}

export class ResumableSyncReceiver {
  private readonly transfers = new Map<string, InboundTransferState>();
  private readonly ttlMs: number;

  constructor(options?: { ttlMs?: number }) {
    this.ttlMs = options?.ttlMs ?? 300_000; // 5 minutes
  }

  /**
   * Receives a single chunk, validates CRC-32 integrity, and reassembles payload if complete.
   */
  public receiveChunk(chunk: ResumableSyncChunk): ChunkReceiveResult {
    // 1. Verify CRC-32 checksum of the chunk
    const calculatedCrc = computeCrc32(chunk.chunkData);
    if (calculatedCrc !== chunk.chunkCrc32) {
      return {
        status: 'CORRUPTED',
        reason: `CRC-32 mismatch on chunk ${chunk.chunkIndex}: expected ${chunk.chunkCrc32}, got ${calculatedCrc}`,
      };
    }

    // 2. Retrieve or initialize transfer session
    let state = this.transfers.get(chunk.transferId);
    if (!state) {
      state = {
        transferId: chunk.transferId,
        totalChunks: chunk.totalChunks,
        payloadHash: chunk.payloadHash,
        receivedChunks: new Map(),
        createdAt: Date.now(),
      };
      this.transfers.set(chunk.transferId, state);
    } else {
      // Validate transfer parameters match
      if (state.totalChunks !== chunk.totalChunks || state.payloadHash !== chunk.payloadHash) {
        return {
          status: 'CORRUPTED',
          reason: `Transfer metadata collision or tampering on transfer ${chunk.transferId}`,
        };
      }
    }

    // 3. Store chunk
    state.receivedChunks.set(chunk.chunkIndex, chunk.chunkData);

    // 4. Check completion
    if (state.receivedChunks.size === state.totalChunks) {
      // Reassemble in sequence
      let totalLength = 0;
      for (let i = 0; i < state.totalChunks; i++) {
        const piece = state.receivedChunks.get(i);
        if (!piece) {
          // Incomplete, should not happen here
          return {
            status: 'IN_PROGRESS',
            receivedCount: state.receivedChunks.size,
            totalChunks: state.totalChunks,
          };
        }
        totalLength += piece.length;
      }

      const reassembled = new Uint8Array(totalLength);
      let offset = 0;
      for (let i = 0; i < state.totalChunks; i++) {
        const piece = state.receivedChunks.get(i)!;
        reassembled.set(piece, offset);
        offset += piece.length;
      }

      // Verify overall payload SHA-256 hash
      const actualHash = bytesToHex(sha256(reassembled));
      if (actualHash !== state.payloadHash) {
        this.transfers.delete(chunk.transferId);
        return {
          status: 'CORRUPTED',
          reason: `Overall payload hash mismatch: expected ${state.payloadHash}, calculated ${actualHash}`,
        };
      }

      // Successfully reassembled!
      this.transfers.delete(chunk.transferId);
      return {
        status: 'COMPLETED',
        payload: reassembled,
        payloadHash: actualHash,
      };
    }

    return {
      status: 'IN_PROGRESS',
      receivedCount: state.receivedChunks.size,
      totalChunks: state.totalChunks,
    };
  }

  /**
   * Generates a ResumeChunkRequest specifying which chunk indices are missing.
   */
  public getResumeRequest(transferId: string): ResumeChunkRequest | undefined {
    const state = this.transfers.get(transferId);
    if (!state) return undefined;

    const missingIndices: number[] = [];
    for (let i = 0; i < state.totalChunks; i++) {
      if (!state.receivedChunks.has(i)) {
        missingIndices.push(i);
      }
    }

    return {
      transferId,
      missingIndices,
    };
  }

  public getProgress(transferId: string): InboundTransferProgress | undefined {
    const state = this.transfers.get(transferId);
    if (!state) return undefined;

    const missingIndices: number[] = [];
    for (let i = 0; i < state.totalChunks; i++) {
      if (!state.receivedChunks.has(i)) {
        missingIndices.push(i);
      }
    }

    return {
      transferId,
      totalChunks: state.totalChunks,
      receivedCount: state.receivedChunks.size,
      isComplete: state.receivedChunks.size === state.totalChunks,
      missingIndices,
    };
  }

  public clearTransfer(transferId: string): void {
    this.transfers.delete(transferId);
  }

  public purgeExpired(now = Date.now()): void {
    for (const [id, state] of this.transfers.entries()) {
      if (now - state.createdAt > this.ttlMs) {
        this.transfers.delete(id);
      }
    }
  }
}
