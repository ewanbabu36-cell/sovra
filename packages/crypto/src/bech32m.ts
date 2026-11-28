import { CryptoError } from './errors.js';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
export const BECH32M_CONST = 0x2bc830a3;

function polymod(values: readonly number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) {
        chk ^= GENERATOR[i]!;
      }
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let p = 0; p < hrp.length; p++) {
    ret.push(hrp.charCodeAt(p) >>> 5);
  }
  ret.push(0);
  for (let p = 0; p < hrp.length; p++) {
    ret.push(hrp.charCodeAt(p) & 31);
  }
  return ret;
}

function createChecksum(hrp: string, data: readonly number[]): number[] {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ BECH32M_CONST;
  const ret: number[] = [];
  for (let p = 0; p < 6; p++) {
    ret.push((mod >>> (5 * (5 - p))) & 31);
  }
  return ret;
}

function verifyChecksum(hrp: string, data: readonly number[]): boolean {
  return polymod([...hrpExpand(hrp), ...data]) === BECH32M_CONST;
}

/**
 * Converts bit groups between widths (e.g. 8-bit bytes <-> 5-bit Bech32 words).
 */
export function convertBits(
  data: readonly number[] | Uint8Array,
  fromBits: number,
  toBits: number,
  pad: boolean,
): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;

  for (let i = 0; i < data.length; i++) {
    const value = data[i]!;
    if (value < 0 || value >> fromBits !== 0) {
      throw new CryptoError('Invalid bit-group value during Bech32m conversion', 'ERR_INVALID_BECH32M');
    }
    acc = ((acc << fromBits) | value) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >>> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new CryptoError('Invalid padding in Bech32m data', 'ERR_INVALID_BECH32M');
  }

  return ret;
}

/**
 * Encodes raw bytes with a human-readable prefix into canonical BIP-350 Bech32m.
 */
export function encodeBech32m(hrp: string, data: Uint8Array, maxLength = 90): string {
  const lowerHrp = hrp.toLowerCase();
  if (lowerHrp.length === 0) {
    throw new CryptoError('Bech32m HRP cannot be empty', 'ERR_INVALID_BECH32M');
  }
  for (let i = 0; i < lowerHrp.length; i++) {
    const c = lowerHrp.charCodeAt(i);
    if (c < 33 || c > 126) {
      throw new CryptoError('Invalid ASCII character in Bech32m HRP', 'ERR_INVALID_BECH32M');
    }
  }

  const fiveBit = convertBits(data, 8, 5, true);
  const checksum = createChecksum(lowerHrp, fiveBit);
  const combined = [...fiveBit, ...checksum];
  const encoded = `${lowerHrp}1${combined.map((v) => CHARSET[v]!).join('')}`;
  if (encoded.length > maxLength) {
    throw new CryptoError(
      `Bech32m encoded length ${encoded.length} exceeds limit ${maxLength}`,
      'ERR_INVALID_BECH32M',
    );
  }
  return encoded;
}

/**
 * Decodes and checksum-verifies a BIP-350 Bech32m string back into HRP + bytes.
 */
export function decodeBech32m(
  bechString: string,
  expectedHrp?: string,
  maxLength = 90,
): { hrp: string; data: Uint8Array } {
  if (!bechString || bechString.length < 8 || bechString.length > maxLength) {
    throw new CryptoError('Invalid Bech32m string length', 'ERR_INVALID_BECH32M');
  }
  let hasLower = false;
  let hasUpper = false;
  for (let i = 0; i < bechString.length; i++) {
    const c = bechString.charCodeAt(i);
    if (c < 33 || c > 126) {
      throw new CryptoError('Invalid character in Bech32m string', 'ERR_INVALID_BECH32M');
    }
    if (c >= 97 && c <= 122) hasLower = true;
    if (c >= 65 && c <= 90) hasUpper = true;
  }
  if (hasLower && hasUpper) {
    throw new CryptoError('Mixed case is forbidden in Bech32m', 'ERR_INVALID_BECH32M');
  }

  const normalized = bechString.toLowerCase();
  const pos = normalized.lastIndexOf('1');
  if (pos < 1 || pos + 7 > normalized.length) {
    throw new CryptoError('Invalid Bech32m separator position', 'ERR_INVALID_BECH32M');
  }

  const hrp = normalized.slice(0, pos);
  if (expectedHrp && hrp !== expectedHrp.toLowerCase()) {
    throw new CryptoError(
      `Unexpected Bech32m HRP '${hrp}', expected '${expectedHrp}'`,
      'ERR_INVALID_BECH32M',
    );
  }

  const dataWords: number[] = [];
  for (let i = pos + 1; i < normalized.length; i++) {
    const idx = CHARSET.indexOf(normalized[i]!);
    if (idx === -1) {
      throw new CryptoError('Invalid character in Bech32m data part', 'ERR_INVALID_BECH32M');
    }
    dataWords.push(idx);
  }

  if (!verifyChecksum(hrp, dataWords)) {
    throw new CryptoError('Bech32m checksum verification failed', 'ERR_INVALID_BECH32M');
  }

  const payloadWords = dataWords.slice(0, -6);
  const decodedBytes = convertBits(payloadWords, 5, 8, false);
  return {
    hrp,
    data: Uint8Array.from(decodedBytes),
  };
}
