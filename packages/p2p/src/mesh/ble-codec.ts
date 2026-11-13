/**
 * @file packages/p2p/src/mesh/ble-codec.ts
 * BLE Framing, MTU Fragmentation, CRC Checksums, and Reassembly Engine.
 *
 * Implements:
 * 1. Compact 8-Byte Frame Header (BLE ATT MTU 23 compatible):
 *    [0]     Magic 0x53 ('S')
 *    [1]     Flags + Version nibble (Flags in high nibble, Version in low nibble)
 *    [2..3]  Transfer ID (uint16 big-endian)
 *    [4]     Chunk Index (uint8, 0..255)
 *    [5]     Total Chunks (uint8, 1..255)
 *    [6..7]  CRC-16 Checksum (uint16 big-endian)
 *    [8..N]  Payload Slice
 *
 * 2. Legacy 28-Byte Frame Header (Backward Compatibility):
 *    [0..1]   Magic 0x5356 ('SV')
 *    [2]      Flags
 *    [3]      Version 1
 *    [4..19]  Transfer ID (16 bytes)
 *    [20..21] Chunk Index (uint16)
 *    [22..23] Total Chunks (uint16)
 *    [24..27] CRC-32 Checksum (uint32)
 *    [28..N]  Payload Slice
 */

import { secureRandomBytes } from '@sovra/crypto';

export const BLE_FRAME_MAGIC = 0x5356;
export const BLE_FRAME_MAGIC_COMPACT = 0x53;
export const BLE_FRAME_VERSION = 1;
export const BLE_COMPACT_FRAME_VERSION = 2;

export const BLE_COMPACT_FRAME_HEADER_SIZE = 8;
export const BLE_LEGACY_FRAME_HEADER_SIZE = 28;
// Default standard header size: 8 compact bytes
export const BLE_FRAME_HEADER_SIZE = 8;

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

/**
 * Standard CRC-16-CCITT implementation for compact 8-byte framing.
 * Polynomial: 0x1021, Initial: 0xFFFF
 */
export function computeCrc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]! << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
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
   * Supports minimum BLE ATT MTU = 23 bytes without header overflow.
   */
  public static fragment(
    payload: Uint8Array,
    targetMtu: number = 182,
    customTransferId?: Uint8Array | number,
    options?: { compact?: boolean },
  ): Uint8Array[] {
    // If target MTU is small (< 32, e.g. minimum ATT MTU 23) or compact explicitly requested,
    // use the compact 8-byte frame header
    const isCompact = options?.compact === true || targetMtu < 32 || (options?.compact === undefined && targetMtu <= 30);

    if (isCompact) {
      return this.fragmentCompact(payload, targetMtu, customTransferId);
    }

    // Legacy 28-byte framing for backward compatibility with 512/182 byte MTU tests
    const effectiveMtu = Math.max(32, targetMtu);
    const maxPayloadPerChunk = effectiveMtu - BLE_LEGACY_FRAME_HEADER_SIZE;

    if (maxPayloadPerChunk <= 0) {
      throw new Error(`Target MTU ${targetMtu} is smaller than BLE header (${BLE_LEGACY_FRAME_HEADER_SIZE})`);
    }

    const totalChunks = Math.max(1, Math.ceil(payload.length / maxPayloadPerChunk));
    const transferId =
      customTransferId instanceof Uint8Array && customTransferId.length >= 16
        ? customTransferId
        : secureRandomBytes(16);

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

      const chunk = new Uint8Array(BLE_LEGACY_FRAME_HEADER_SIZE + slice.length);
      const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

      // Header fields (28 bytes)
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
      chunk.set(slice, BLE_LEGACY_FRAME_HEADER_SIZE);
      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Compact 8-Byte BLE Framing for minimum BLE ATT MTU = 23 bytes:
   * [0]    Magic (0x53)
   * [1]    Flags+Ver nibble
   * [2..3] TransferId (uint16)
   * [4]    ChunkIdx
   * [5]    TotalChunks
   * [6..7] CRC-16
   * [8..N] Payload Slice
   */
  public static fragmentCompact(
    payload: Uint8Array,
    targetMtu: number = 23,
    customTransferId?: Uint8Array | number,
  ): Uint8Array[] {
    const headerSize = BLE_COMPACT_FRAME_HEADER_SIZE;
    // For minimum ATT MTU 23: effective payload = 23 - 8 = 15 bytes
    const effectiveMtu = Math.max(10, targetMtu);
    const maxPayloadPerChunk = effectiveMtu - headerSize;

    if (maxPayloadPerChunk <= 0) {
      throw new Error(`Target MTU ${targetMtu} is smaller than BLE compact header (${headerSize})`);
    }

    const totalChunks = Math.max(1, Math.ceil(payload.length / maxPayloadPerChunk));
    if (totalChunks > 255) {
      throw new Error(`Total chunks ${totalChunks} exceeds compact 8-bit limit (255)`);
    }

    let transferIdU16: number;
    if (typeof customTransferId === 'number') {
      transferIdU16 = customTransferId & 0xffff;
    } else if (customTransferId instanceof Uint8Array && customTransferId.length >= 2) {
      transferIdU16 = (customTransferId[0]! << 8) | customTransferId[1]!;
    } else {
      const rand = secureRandomBytes(2);
      transferIdU16 = (rand[0]! << 8) | rand[1]!;
    }

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

      const chunk = new Uint8Array(headerSize + slice.length);
      const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

      // Byte 0: Magic 0x53 ('S')
      chunk[0] = BLE_FRAME_MAGIC_COMPACT;
      // Byte 1: Flags + Ver nibble (Version 2 in low nibble, flags in high nibble)
      chunk[1] = ((flags & 0x0f) << 4) | (BLE_COMPACT_FRAME_VERSION & 0x0f);
      // Bytes 2..3: Transfer ID (uint16)
      view.setUint16(2, transferIdU16, false);
      // Byte 4: ChunkIdx
      chunk[4] = i & 0xff;
      // Byte 5: TotalChunks
      chunk[5] = totalChunks & 0xff;

      // Bytes 6..7: CRC-16 Checksum
      const crc16 = computeCrc16(slice);
      view.setUint16(6, crc16, false);

      // Bytes 8..N: Payload slice
      chunk.set(slice, headerSize);
      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Decodes a single raw BLE chunk buffer.
   * Auto-detects whether the frame is legacy 28-byte format or compact 8-byte format.
   */
  public static decodeChunk(chunkBytes: Uint8Array): BleChunk {
    if (chunkBytes.length < BLE_COMPACT_FRAME_HEADER_SIZE) {
      throw new Error(`BLE chunk is too short: ${chunkBytes.length} bytes (minimum ${BLE_COMPACT_FRAME_HEADER_SIZE})`);
    }

    const view = new DataView(chunkBytes.buffer, chunkBytes.byteOffset, chunkBytes.byteLength);

    // 1. Detect Legacy 28-Byte Frame (Magic 0x5356, Version 1)
    if (
      chunkBytes.length >= BLE_LEGACY_FRAME_HEADER_SIZE &&
      view.getUint16(0, false) === BLE_FRAME_MAGIC &&
      chunkBytes[3] === BLE_FRAME_VERSION
    ) {
      const flags = chunkBytes[2] as BleFrameFlags;
      const version = chunkBytes[3]!;
      const transferId = chunkBytes.slice(4, 20);
      const chunkIndex = view.getUint16(20, false);
      const totalChunks = view.getUint16(22, false);
      const expectedCrc = view.getUint32(24, false);
      const payload = chunkBytes.slice(BLE_LEGACY_FRAME_HEADER_SIZE);

      const actualCrc = computeCrc32(payload);
      if (actualCrc !== expectedCrc) {
        throw new Error(
          `CRC-32 checksum mismatch in BLE chunk ${chunkIndex}/${totalChunks}: expected ${expectedCrc}, got ${actualCrc}`,
        );
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

    // 2. Compact 8-Byte Frame (Magic 0x53)
    if (chunkBytes[0] !== BLE_FRAME_MAGIC_COMPACT) {
      throw new Error(
        `Invalid BLE frame magic: 0x${chunkBytes[0]?.toString(16)} (expected 0x${BLE_FRAME_MAGIC_COMPACT.toString(16)} or 0x${BLE_FRAME_MAGIC.toString(16)})`,
      );
    }

    const flags = ((chunkBytes[1]! >>> 4) & 0x0f) as BleFrameFlags;
    const version = chunkBytes[1]! & 0x0f;
    const transferIdU16 = view.getUint16(2, false);

    // Provide 16-byte fixed buffer containing the 2-byte transferId for unified interface
    const transferId = new Uint8Array(16);
    transferId[0] = (transferIdU16 >>> 8) & 0xff;
    transferId[1] = transferIdU16 & 0xff;

    const chunkIndex = chunkBytes[4]!;
    const totalChunks = chunkBytes[5]!;
    const expectedCrc16 = view.getUint16(6, false);
    const payload = chunkBytes.slice(BLE_COMPACT_FRAME_HEADER_SIZE);

    const actualCrc16 = computeCrc16(payload);
    if (actualCrc16 !== expectedCrc16) {
      throw new Error(
        `CRC-16 checksum mismatch in BLE chunk ${chunkIndex}/${totalChunks}: expected ${expectedCrc16}, got ${actualCrc16}`,
      );
    }

    return {
      flags,
      version,
      transferId,
      chunkIndex,
      totalChunks,
      crc32: expectedCrc16,
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
