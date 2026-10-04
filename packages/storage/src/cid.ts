import {
  sha256,
  blake3Hash,
  encodeBase58Btc,
  decodeBase58Btc,
  constantTimeEquals,
  bytesToHex,
} from '@sovra/crypto';
import { ContentId } from './types.js';
import { InvalidCidError } from './errors.js';

export type CidCodec = 'raw' | 'dag-pb' | 'dag-cbor';
export type MultihashType = 'sha2-256' | 'blake3';

export const CODEC_TO_CODE: Record<CidCodec, number> = {
  'raw': 0x55,
  'dag-pb': 0x70,
  'dag-cbor': 0x71,
};

export const CODE_TO_CODEC: Record<number, CidCodec> = {
  0x55: 'raw',
  0x70: 'dag-pb',
  0x71: 'dag-cbor',
};

export const HASH_TO_CODE: Record<MultihashType, number> = {
  'sha2-256': 0x12,
  'blake3': 0x1e,
};

export const CODE_TO_HASH: Record<number, MultihashType> = {
  0x12: 'sha2-256',
  0x1e: 'blake3',
};

// ============================================================================
// VARINT ENCODING & DECODING
// ============================================================================

export function encodeVarint(val: number): Uint8Array {
  const bytes: number[] = [];
  let v = val;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

export function decodeVarint(
  bytes: Uint8Array,
  offset = 0,
): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < bytes.length) {
    const byte = bytes[offset + bytesRead]!;
    bytesRead++;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, bytesRead };
    }
    shift += 7;
    if (shift > 35) {
      throw new InvalidCidError('Varint overflow in CID bytes');
    }
  }
  throw new InvalidCidError('Unexpected EOF decoding varint in CID bytes');
}

// ============================================================================
// RFC 4648 BASE32 ENCODING (LOWERCASE, NO PADDING)
// ============================================================================

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const BASE32_MAP = new Map<string, number>();
for (let i = 0; i < BASE32_ALPHABET.length; i++) {
  BASE32_MAP.set(BASE32_ALPHABET[i]!, i);
}

export function encodeBase32(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < data.length; i++) {
    value = (value << 8) | data[i]!;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(str: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const result: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const char = str[i]!.toLowerCase();
    const val = BASE32_MAP.get(char);
    if (val === undefined) {
      throw new InvalidCidError(`Invalid character in base32 CID string: '${char}'`);
    }
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(result);
}

// ============================================================================
// CIDv1 IMPLEMENTATION
// ============================================================================

/**
 * Deterministic Content Identifier (CIDv1) for Sovra Decentralized Storage.
 * Complies with multiformats standard for binary layout and multibase serialization.
 */
export class CID implements ContentId {
  public readonly version = 1 as const;
  public readonly codec: CidCodec;
  public readonly codecCode: number;
  public readonly multihashType: MultihashType;
  public readonly multihashCode: number;
  public readonly digest: Uint8Array;
  public readonly multihash: string;
  public readonly bytes: Uint8Array;

  constructor(
    codec: CidCodec,
    digest: Uint8Array,
    hashType: MultihashType = 'sha2-256',
  ) {
    if (digest.length !== 32) {
      throw new InvalidCidError(
        `Invalid digest length: expected 32 bytes for ${hashType}, received ${digest.length}`,
      );
    }

    this.codec = codec;
    this.codecCode = CODEC_TO_CODE[codec];
    this.multihashType = hashType;
    this.multihashCode = HASH_TO_CODE[hashType];
    this.digest = new Uint8Array(digest);
    this.multihash = bytesToHex(this.digest);

    // Build binary CIDv1 representation:
    // [varint(1), varint(codec), varint(hash_type), varint(length), digest]
    const vBytes = encodeVarint(1);
    const cBytes = encodeVarint(this.codecCode);
    const hBytes = encodeVarint(this.multihashCode);
    const lBytes = encodeVarint(this.digest.length);

    const totalLen = vBytes.length + cBytes.length + hBytes.length + lBytes.length + this.digest.length;
    const buf = new Uint8Array(totalLen);
    let offset = 0;

    buf.set(vBytes, offset); offset += vBytes.length;
    buf.set(cBytes, offset); offset += cBytes.length;
    buf.set(hBytes, offset); offset += hBytes.length;
    buf.set(lBytes, offset); offset += lBytes.length;
    buf.set(this.digest, offset);

    this.bytes = buf;
  }

  /**
   * Generates a deterministic CID from raw payload or precomputed digest
   */
  public static create(
    codec: CidCodec,
    dataOrDigest: Uint8Array,
    isDigest = false,
    hashType: MultihashType = 'sha2-256',
  ): CID {
    const digest = isDigest
      ? dataOrDigest
      : hashType === 'blake3'
        ? blake3Hash(dataOrDigest)
        : sha256(dataOrDigest);

    return new CID(codec, digest, hashType);
  }

  /**
   * Decodes a binary CIDv1 byte buffer
   */
  public static fromBytes(bytes: Uint8Array): CID {
    if (bytes.length < 4) {
      throw new InvalidCidError('CID binary buffer too short');
    }

    let offset = 0;
    const v = decodeVarint(bytes, offset);
    offset += v.bytesRead;

    if (v.value !== 1) {
      throw new InvalidCidError(`Unsupported CID version: ${v.value}. Sovra requires CIDv1`);
    }

    const c = decodeVarint(bytes, offset);
    offset += c.bytesRead;
    const codec = CODE_TO_CODEC[c.value];
    if (!codec) {
      throw new InvalidCidError(`Unsupported CID codec code: 0x${c.value.toString(16)}`);
    }

    const h = decodeVarint(bytes, offset);
    offset += h.bytesRead;
    const hashType = CODE_TO_HASH[h.value];
    if (!hashType) {
      throw new InvalidCidError(`Unsupported multihash code: 0x${h.value.toString(16)}`);
    }

    const l = decodeVarint(bytes, offset);
    offset += l.bytesRead;

    const digest = bytes.subarray(offset, offset + l.value);
    if (digest.length !== l.value) {
      throw new InvalidCidError(`Truncated CID digest: expected ${l.value} bytes, got ${digest.length}`);
    }

    return new CID(codec, digest, hashType);
  }

  /**
   * Parses string representation of CID (base32 'b' or base58 'z')
   */
  public static parse(cidStr: string): CID {
    if (!cidStr || typeof cidStr !== 'string') {
      throw new InvalidCidError('CID string cannot be empty');
    }

    // IPFS Base32 lower prefix 'b'
    if (cidStr.startsWith('b')) {
      const rawBytes = decodeBase32(cidStr.slice(1));
      return CID.fromBytes(rawBytes);
    }

    // Base58btc prefix 'z'
    if (cidStr.startsWith('z')) {
      const rawBytes = decodeBase58Btc(cidStr.slice(1));
      return CID.fromBytes(rawBytes);
    }

    // Reject legacy CIDv0
    if (cidStr.startsWith('Qm')) {
      throw new InvalidCidError('Legacy CIDv0 (Qm...) is rejected: Sovra strictly enforces CIDv1');
    }

    throw new InvalidCidError(`Unknown multibase prefix for CID '${cidStr}'. Expected 'b' (base32) or 'z' (base58)`);
  }

  /**
   * Serializes CID to standard IPFS string (defaults to Base32 lowercase with 'b' prefix)
   */
  public toString(base: 'base32' | 'base58' = 'base32'): string {
    if (base === 'base58') {
      return 'z' + encodeBase58Btc(this.bytes);
    }
    return 'b' + encodeBase32(this.bytes);
  }

  /**
   * Equality check against another CID, ContentId, or CID string
   */
  public equals(other: CID | ContentId | string): boolean {
    if (typeof other === 'string') {
      try {
        const parsed = CID.parse(other);
        return constantTimeEquals(this.bytes, parsed.bytes);
      } catch {
        return false;
      }
    }
    if (other instanceof CID) {
      return constantTimeEquals(this.bytes, other.bytes);
    }
    return this.toString() === other.toString();
  }
}
