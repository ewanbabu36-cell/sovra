import { CryptoError } from './errors.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function encodeMajorAndUint(majorType: number, n: bigint): Uint8Array {
  const prefix = (majorType & 0x07) << 5;
  if (n < 0n) {
    throw new CryptoError('Negative integer passed to unsigned CBOR header', 'ERR_INVALID_CBOR');
  }
  if (n < 24n) {
    return Uint8Array.of(prefix | Number(n));
  }
  if (n <= 0xffn) {
    return Uint8Array.of(prefix | 24, Number(n));
  }
  if (n <= 0xffffn) {
    const out = new Uint8Array(3);
    const dv = new DataView(out.buffer);
    out[0] = prefix | 25;
    dv.setUint16(1, Number(n), false);
    return out;
  }
  if (n <= 0xffffffffn) {
    const out = new Uint8Array(5);
    const dv = new DataView(out.buffer);
    out[0] = prefix | 26;
    dv.setUint32(1, Number(n), false);
    return out;
  }
  if (n <= 0xffffffffffffffffn) {
    const out = new Uint8Array(9);
    const dv = new DataView(out.buffer);
    out[0] = prefix | 27;
    dv.setBigUint64(1, n, false);
    return out;
  }
  throw new CryptoError('Integer exceeds CBOR 64-bit canonical bounds', 'ERR_INVALID_CBOR');
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function compareEncodedBytes(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Encodes an arbitrary JSON-compatible/binary value into RFC 8949 Section 4.2
 * Core Deterministic CBOR bytes. Maps omit undefined values and sort keys strictly by
 * encoded key length ascending, then unsigned bytewise lexical order.
 */
export function canonicalCborEncode(value: unknown): Uint8Array {
  if (value === null) {
    return Uint8Array.of(0xf6);
  }
  if (value === false) {
    return Uint8Array.of(0xf4);
  }
  if (value === true) {
    return Uint8Array.of(0xf5);
  }
  if (typeof value === 'bigint') {
    if (value >= 0n) {
      return encodeMajorAndUint(0, value);
    }
    return encodeMajorAndUint(1, -1n - value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CryptoError('Non-finite numbers are disallowed in deterministic CBOR', 'ERR_INVALID_CBOR');
    }
    if (Number.isInteger(value) && Number.isSafeInteger(value)) {
      const bi = BigInt(Object.is(value, -0) ? 0 : value);
      return bi >= 0n ? encodeMajorAndUint(0, bi) : encodeMajorAndUint(1, -1n - bi);
    }
    const out = new Uint8Array(9);
    out[0] = 0xfb;
    new DataView(out.buffer).setFloat64(1, value, false);
    return out;
  }
  if (typeof value === 'string') {
    const utf8 = textEncoder.encode(value);
    return concatChunks([encodeMajorAndUint(3, BigInt(utf8.length)), utf8]);
  }
  if (value instanceof Uint8Array) {
    return concatChunks([encodeMajorAndUint(2, BigInt(value.length)), value]);
  }
  if (Array.isArray(value)) {
    const header = encodeMajorAndUint(4, BigInt(value.length));
    const items = value.map((item) => canonicalCborEncode(item));
    return concatChunks([header, ...items]);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries: Array<{ key: string; keyBytes: Uint8Array; valBytes: Uint8Array }> = [];
    for (const key of Object.keys(record)) {
      const v = record[key];
      if (v === undefined) continue;
      const keyBytes = canonicalCborEncode(key);
      const valBytes = canonicalCborEncode(v);
      entries.push({ key, keyBytes, valBytes });
    }
    entries.sort((a, b) => compareEncodedBytes(a.keyBytes, b.keyBytes));
    const header = encodeMajorAndUint(5, BigInt(entries.length));
    const chunks: Uint8Array[] = [header];
    for (const e of entries) {
      chunks.push(e.keyBytes, e.valBytes);
    }
    return concatChunks(chunks);
  }
  throw new CryptoError(`Unsupported type '${typeof value}' in deterministic CBOR`, 'ERR_INVALID_CBOR');
}

export interface CborDecodeOptions {
  readonly strictDeterministic?: boolean;
}

/**
 * Decodes RFC 8949 Core Deterministic CBOR bytes, validating canonical integers,
 * strict map key ordering, no duplicate keys, no indefinite items, and no trailing bytes.
 */
export function canonicalCborDecode<T = unknown>(
  bytes: Uint8Array,
  options: CborDecodeOptions = {},
): T {
  const strict = options.strictDeterministic ?? true;
  let offset = 0;

  function readUint(addInfo: number): { value: bigint; minimal: boolean } {
    if (addInfo < 24) {
      return { value: BigInt(addInfo), minimal: true };
    }
    if (addInfo === 24) {
      if (offset + 1 > bytes.length) throw new CryptoError('Truncated CBOR uint8', 'ERR_INVALID_CBOR');
      const v = BigInt(bytes[offset++]!);
      return { value: v, minimal: v >= 24n };
    }
    if (addInfo === 25) {
      if (offset + 2 > bytes.length) throw new CryptoError('Truncated CBOR uint16', 'ERR_INVALID_CBOR');
      const v = BigInt(new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, false));
      offset += 2;
      return { value: v, minimal: v > 0xffn };
    }
    if (addInfo === 26) {
      if (offset + 4 > bytes.length) throw new CryptoError('Truncated CBOR uint32', 'ERR_INVALID_CBOR');
      const v = BigInt(new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false));
      offset += 4;
      return { value: v, minimal: v > 0xffffn };
    }
    if (addInfo === 27) {
      if (offset + 8 > bytes.length) throw new CryptoError('Truncated CBOR uint64', 'ERR_INVALID_CBOR');
      const v = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, false);
      offset += 8;
      return { value: v, minimal: v > 0xffffffffn };
    }
    throw new CryptoError(`Non-deterministic CBOR additional info ${addInfo}`, 'ERR_INVALID_CBOR');
  }

  function decodeItem(): unknown {
    if (offset >= bytes.length) {
      throw new CryptoError('Unexpected end of CBOR input', 'ERR_INVALID_CBOR');
    }
    const initial = bytes[offset++]!;
    const major = initial >>> 5;
    const addInfo = initial & 0x1f;

    if (major === 7) {
      if (addInfo === 20) return false;
      if (addInfo === 21) return true;
      if (addInfo === 22) return null;
      if (addInfo === 27) {
        if (offset + 8 > bytes.length) throw new CryptoError('Truncated CBOR float64', 'ERR_INVALID_CBOR');
        const f = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, false);
        offset += 8;
        if (strict && Number.isInteger(f) && Number.isSafeInteger(f)) {
          throw new CryptoError('Non-canonical integer encoded as float64', 'ERR_INVALID_CBOR');
        }
        return f;
      }
      throw new CryptoError(`Unsupported CBOR simple/float info ${addInfo}`, 'ERR_INVALID_CBOR');
    }

    const { value: arg, minimal } = readUint(addInfo);
    if (strict && !minimal) {
      throw new CryptoError('Non-minimal CBOR integer encoding', 'ERR_INVALID_CBOR');
    }

    if (major === 0) {
      return arg <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(arg) : arg;
    }
    if (major === 1) {
      const signed = -1n - arg;
      return signed >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(signed) : signed;
    }
    if (major === 2) {
      const len = Number(arg);
      if (offset + len > bytes.length) throw new CryptoError('Truncated CBOR byte string', 'ERR_INVALID_CBOR');
      const slice = bytes.slice(offset, offset + len);
      offset += len;
      return slice;
    }
    if (major === 3) {
      const len = Number(arg);
      if (offset + len > bytes.length) throw new CryptoError('Truncated CBOR text string', 'ERR_INVALID_CBOR');
      const slice = bytes.subarray(offset, offset + len);
      offset += len;
      return textDecoder.decode(slice);
    }
    if (major === 4) {
      const len = Number(arg);
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) {
        arr.push(decodeItem());
      }
      return arr;
    }
    if (major === 5) {
      const len = Number(arg);
      const obj: Record<string, unknown> = {};
      const seenKeys = new Set<string>();
      let prevKeyRaw: Uint8Array | null = null;

      for (let i = 0; i < len; i++) {
        const keyStart = offset;
        const key = decodeItem();
        const keyEnd = offset;
        if (typeof key !== 'string') {
          throw new CryptoError('Sovra deterministic CBOR map keys must be strings', 'ERR_INVALID_CBOR');
        }
        if (seenKeys.has(key)) {
          throw new CryptoError(`Duplicate CBOR map key '${key}'`, 'ERR_INVALID_CBOR');
        }
        seenKeys.add(key);

        if (strict) {
          const keyRaw = bytes.subarray(keyStart, keyEnd);
          if (prevKeyRaw && compareEncodedBytes(prevKeyRaw, keyRaw) >= 0) {
            throw new CryptoError(`Non-canonical CBOR map key order at '${key}'`, 'ERR_INVALID_CBOR');
          }
          prevKeyRaw = keyRaw;
        }
        obj[key] = decodeItem();
      }
      return obj;
    }

    throw new CryptoError(`Unsupported CBOR major type ${major}`, 'ERR_INVALID_CBOR');
  }

  const decoded = decodeItem();
  if (offset !== bytes.length) {
    throw new CryptoError('Trailing garbage bytes after CBOR item', 'ERR_INVALID_CBOR');
  }
  return decoded as T;
}
