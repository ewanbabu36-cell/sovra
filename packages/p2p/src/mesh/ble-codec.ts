/**
 * @file packages/p2p/src/mesh/ble-codec.ts
 * BLE Framing, MTU Fragmentation, CRC-32 Checksum, and Reassembly Engine.
 *
 * Designed for real BLE radio constraints (iOS CoreBluetooth 182-byte MTU,
 * Android 512-byte MTU, and minimum 23-byte ATT MTUs).
 *
 * Frame Format:
 * [0..1]   Magic 0x5356 ('SV')
 * [2]      Flags (0x01: START, 0x02: MIDDLE, 0x04: END, 0x08: SINGLE)
 * [3]      Version (1)
 * [4..19]  Transfer ID (16 bytes)
 * [20..21] Sequence / Chunk Index (uint16, big-endian)
 * [22..23] Total Chunks (uint16, big-endian)
 * [24..27] CRC-32 Checksum (uint32, big-endian)
 * [28..N]  Payload Slice
 */

import { secureRandomBytes } from '@sovra/crypto';

export const BLE_FRAME_MAGIC = 0x5356;
export const BLE_FRAME_VERSION = 1;
export const BLE_FRAME_HEADER_SIZE = 28;

export enum BleFrameFlags {
  START = 0x01,
  MIDDLE = 0x02,
  END = 0x04,
  SINGLE = 0x08,
}

// Standard IEEE 802.3 CRC-32 implementation
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]!;
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface BleChunk {
  readonly flags: BleFrameFlags;
  readonly version: number;
  readonly transferId: Uint8Array;
  readonly chunkIndex: number;
  readonly totalChunks: number;
  readonly crc32: number;
  readonly payload: Uint8Array;
}

export class BleFrameCodec {
  /**
   * Slices an arbitrary payload into MTU-sized BLE transmission chunks.
   */
  public static fragment(
    payload: Uint8Array,
    targetMtu: number = 182,
    customTransferId?: Uint8Array,
  ): Uint8Array[] {
    const effectiveMtu = Math.max(32, targetMtu);
    const maxPayloadPerChunk = effectiveMtu - BLE_FRAME_HEADER_SIZE;

    if (maxPayloadPerChunk <= 0) {
      throw new Error(`Target MTU ${targetMtu} is smaller than BLE header (${BLE_FRAME_HEADER_SIZE})`);
    }

    const totalChunks = Math.max(1, Math.ceil(payload.length / maxPayloadPerChunk));
    const transferId = customTransferId ?? secureRandomBytes(16);
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * maxPayloadPerChunk;
      const end = Math.min(payload.length, start + maxPayloadPerChunk);
      const slice = payload.subarray(start, end);

      let flags = BleFrameFlags.MIDDLE;
      if (totalChunks === 1) {
        flags = BleFrameFlags.SINGLE;
      } else if (i === 0) {
        flags = BleFrameFlags.START;
      } else if (i === totalChunks - 1) {
        flags = BleFrameFlags.END;
      }

      const chunk = new Uint8Array(BLE_FRAME_HEADER_SIZE + slice.length);
      const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

      // Header fields
      view.setUint16(0, BLE_FRAME_MAGIC, false);
      chunk[2] = flags;
      chunk[3] = BLE_FRAME_VERSION;
      chunk.set(transferId, 4);
      view.setUint16(20, i, false);
      view.setUint16(22, totalChunks, false);

      // Compute and write CRC32 over the payload slice
      const crc = computeCrc32(slice);
      view.setUint32(24, crc, false);

      // Payload
      chunk.set(slice, BLE_FRAME_HEADER_SIZE);
      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Decodes a single raw BLE chunk buffer.
   */
  public static decodeChunk(chunkBytes: Uint8Array): BleChunk {
    if (chunkBytes.length < BLE_FRAME_HEADER_SIZE) {
      throw new Error(`BLE chunk is too short: ${chunkBytes.length} bytes (minimum ${BLE_FRAME_HEADER_SIZE})`);
    }

    const view = new DataView(chunkBytes.buffer, chunkBytes.byteOffset, chunkBytes.byteLength);
    const magic = view.getUint16(0, false);
    if (magic !== BLE_FRAME_MAGIC) {
      throw new Error(`Invalid BLE frame magic: 0x${magic.toString(16)} (expected 0x${BLE_FRAME_MAGIC.toString(16)})`);
    }

    const flags = chunkBytes[2] as BleFrameFlags;
    const version = chunkBytes[3]!;
    if (version !== BLE_FRAME_VERSION) {
      throw new Error(`Unsupported BLE frame protocol version: ${version}`);
    }

    const transferId = chunkBytes.slice(4, 20);
    const chunkIndex = view.getUint16(20, false);
    const totalChunks = view.getUint16(22, false);
    const expectedCrc = view.getUint32(24, false);
    const payload = chunkBytes.slice(BLE_FRAME_HEADER_SIZE);

    const actualCrc = computeCrc32(payload);
    if (actualCrc !== expectedCrc) {
      throw new Error(`CRC-32 checksum mismatch in BLE chunk ${chunkIndex}/${totalChunks}: expected ${expectedCrc}, got ${actualCrc}`);
    }

    return {
      flags,
      version,
      transferId,
      chunkIndex,
      totalChunks,
      crc32: expectedCrc,
      payload,
    };
  }
}

interface PendingAssembly {
  transferIdHex: string;
  totalChunks: number;
  receivedChunks: Map<number, Uint8Array>;
  firstReceivedAt: number;
}

export class BleFrameReassembler {
  private pending = new Map<string, PendingAssembly>();
  private readonly timeoutMs: number;
  private readonly maxPayloadBytes: number;
  private readonly maxPendingTransfers: number;
  private readonly maxChunksPerTransfer: number;

  constructor(options?: {
    timeoutMs?: number;
    maxPayloadBytes?: number;
    maxPendingTransfers?: number;
    maxChunksPerTransfer?: number;
  }) {
    this.timeoutMs = options?.timeoutMs ?? 15000; // 15 seconds assembly window
    this.maxPayloadBytes = options?.maxPayloadBytes ?? 512 * 1024; // 512KB max
    this.maxPendingTransfers = options?.maxPendingTransfers ?? 100; // Max 100 concurrent transfers
    this.maxChunksPerTransfer = options?.maxChunksPerTransfer ?? 5000; // Max chunks per transfer
  }

  /**
   * Feeds an incoming BLE chunk buffer.
   * Returns the fully assembled payload if this was the final chunk; otherwise null.
   */
  public feed(chunkBytes: Uint8Array): Uint8Array | null {
    this.pruneExpired();

    let chunk: BleChunk;
    try {
      chunk = BleFrameCodec.decodeChunk(chunkBytes);
    } catch {
      return null;
    }

    if (chunk.totalChunks <= 0 || chunk.totalChunks > this.maxChunksPerTransfer) {
      throw new Error(`Total chunks ${chunk.totalChunks} exceeds maximum allowed chunks ${this.maxChunksPerTransfer}`);
    }

    if (chunk.chunkIndex >= chunk.totalChunks) {
      return null;
    }

    // Fast-path: single standalone chunk
    if (chunk.flags === BleFrameFlags.SINGLE || chunk.totalChunks === 1) {
      if (chunk.payload.length > this.maxPayloadBytes) {
        throw new Error(`Assembled BLE payload exceeds max quota: ${chunk.payload.length} > ${this.maxPayloadBytes}`);
      }
      return chunk.payload;
    }

    const transferIdHex = Array.from(chunk.transferId)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    let assembly = this.pending.get(transferIdHex);
    if (!assembly) {
      if (this.pending.size >= this.maxPendingTransfers) {
        throw new Error(`Maximum concurrent BLE assembly transfers (${this.maxPendingTransfers}) exceeded`);
      }
      assembly = {
        transferIdHex,
        totalChunks: chunk.totalChunks,
        receivedChunks: new Map(),
        firstReceivedAt: Date.now(),
      };
      this.pending.set(transferIdHex, assembly);
    }

    if (assembly.totalChunks !== chunk.totalChunks) {
      return null;
    }

    assembly.receivedChunks.set(chunk.chunkIndex, chunk.payload);

    // Check if all chunks received
    if (assembly.receivedChunks.size === assembly.totalChunks) {
      let totalLength = 0;
      for (let i = 0; i < assembly.totalChunks; i++) {
        const slice = assembly.receivedChunks.get(i);
        if (!slice) return null; // Missing slice
        totalLength += slice.length;
      }

      if (totalLength > this.maxPayloadBytes) {
        this.pending.delete(transferIdHex);
        throw new Error(`Assembled BLE payload exceeds max quota: ${totalLength} > ${this.maxPayloadBytes}`);
      }

      const fullPayload = new Uint8Array(totalLength);
      let offset = 0;
      for (let i = 0; i < assembly.totalChunks; i++) {
        const slice = assembly.receivedChunks.get(i)!;
        fullPayload.set(slice, offset);
        offset += slice.length;
      }

      this.pending.delete(transferIdHex);
      return fullPayload;
    }

    return null;
  }

  public pruneExpired(): void {
    const now = Date.now();
    for (const [key, item] of this.pending.entries()) {
      if (now - item.firstReceivedAt > this.timeoutMs) {
        this.pending.delete(key);
      }
    }
  }

  public getActiveTransferCount(): number {
    return this.pending.size;
  }

  public clear(): void {
    this.pending.clear();
  }
}
