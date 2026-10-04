import { sha256, bytesToHex } from './primitives.js';

export interface PoWResult {
  readonly nonce: bigint;
  readonly hashHex: string;
  readonly iterations: number;
}

/**
 * Counts leading zero bits in a 32-byte cryptographic hash digest.
 */
export function countLeadingZeroBits(hash: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < hash.length; i++) {
    const byte = hash[i]!;
    if (byte === 0) {
      count += 8;
    } else {
      count += Math.clz32(byte) - 24;
      break;
    }
  }
  return count;
}

/**
 * Computes Hashcash Proof-of-Work for a given payload until difficultyBits leading zero bits are reached.
 */
export function computeProofOfWork(
  payload: Uint8Array,
  difficultyBits: number,
  maxIterations = 5_000_000,
): PoWResult {
  if (difficultyBits <= 0) {
    return { nonce: 0n, hashHex: bytesToHex(sha256(payload)), iterations: 0 };
  }

  const buffer = new Uint8Array(payload.length + 8);
  buffer.set(payload, 0);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let nonce = 0n;
  let iterations = 0;

  while (iterations < maxIterations) {
    view.setBigUint64(payload.length, nonce, false);
    const hash = sha256(buffer);
    if (countLeadingZeroBits(hash) >= difficultyBits) {
      return {
        nonce,
        hashHex: bytesToHex(hash),
        iterations: iterations + 1,
      };
    }
    nonce++;
    iterations++;
  }

  throw new Error(`PoW failed: exceeded max iterations (${maxIterations}) for difficulty ${difficultyBits}`);
}

/**
 * Verifies Proof-of-Work in O(1) time with a single SHA-256 computation.
 */
export function verifyProofOfWork(
  payload: Uint8Array,
  nonce: bigint,
  difficultyBits: number,
): boolean {
  if (difficultyBits <= 0) return true;

  const buffer = new Uint8Array(payload.length + 8);
  buffer.set(payload, 0);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setBigUint64(payload.length, nonce, false);

  const hash = sha256(buffer);
  return countLeadingZeroBits(hash) >= difficultyBits;
}

/**
 * Dynamic congestion & reputation-based PoW difficulty scaling formula:
 * RequiredDifficulty = BaseDifficulty + floor(log2(max(1, networkTps))) * (1 / max(0.1, authorReputationScore))
 *
 * - Normal user with high reputation (e.g. 1.0): solves low difficulty (e.g. 4-8 bits, ~1-5ms)
 * - Bot with zero reputation (0.1): under 50 TPS attack faces steep difficulty (e.g. 16-20 bits)
 */
export function calculateDynamicDifficulty(
  baseDifficulty = 4,
  networkTps = 1,
  authorReputationScore = 1.0,
  maxDifficulty = 24,
): number {
  const safeReputation = Math.max(0.1, Math.min(1.0, authorReputationScore));
  const congestionFactor = Math.max(0, Math.floor(Math.log2(Math.max(1, networkTps))));
  const scaledDifficulty = Math.round(baseDifficulty + congestionFactor / safeReputation);
  return Math.max(0, Math.min(maxDifficulty, scaledDifficulty));
}

export interface MemoryHardPoWResult {
  readonly nonce: bigint;
  readonly hashHex: string;
  readonly iterations: number;
  readonly memoryKiB: number;
}

export interface TrustContext {
  readonly isPasskeyVerified?: boolean | undefined;
  readonly followGraphDepth?: number | undefined; // 1 = direct follow by high-rep node, 2 = 2nd degree, etc.
  readonly accountAgeDays?: number | undefined;
  readonly reputationScore?: number | undefined; // 0.0 to 1.0
}

/**
 * Memory-hard scratchpad hash function that forces RAM access latency,
 * neutralizing ASIC and high-parallelism GPU advantage over mobile CPUs.
 */
export function hashWithMemoryScratchpad(
  payload: Uint8Array,
  nonce: bigint,
  memoryKiB = 64,
): Uint8Array {
  const buffer = new Uint8Array(payload.length + 8);
  buffer.set(payload, 0);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setBigUint64(payload.length, nonce, false);

  let currentHash = sha256(buffer);
  const wordsCount = Math.max(16, Math.floor((memoryKiB * 1024) / 32));
  const scratchpad: Uint8Array[] = new Array(wordsCount);

  // Phase 1: Initialize RAM scratchpad deterministically
  for (let i = 0; i < wordsCount; i++) {
    const idxBuf = new Uint8Array(36);
    idxBuf.set(currentHash, 0);
    new DataView(idxBuf.buffer, idxBuf.byteOffset, idxBuf.byteLength).setUint32(32, i, false);
    currentHash = sha256(idxBuf);
    scratchpad[i] = currentHash;
  }

  // Phase 2: Pseudorandom memory latency walks
  const walkRounds = 32;
  for (let r = 0; r < walkRounds; r++) {
    const b0 = currentHash[0] ?? 0;
    const b1 = currentHash[1] ?? 0;
    const lookupIdx = ((b0 << 8) | b1) % wordsCount;
    const targetWord = scratchpad[lookupIdx]!;

    const combined = new Uint8Array(64);
    for (let k = 0; k < 32; k++) {
      combined[k] = (currentHash[k] ?? 0) ^ (targetWord[k] ?? 0);
    }
    combined.set(targetWord, 32);
    currentHash = sha256(combined);
  }

  return currentHash;
}

/**
 * Computes memory-hard Proof-of-Work to thwart botfarm ASIC/GPU clusters.
 */
export function computeMemoryHardPoW(
  payload: Uint8Array,
  difficultyBits: number,
  memoryKiB = 64,
  maxIterations = 500_000,
): MemoryHardPoWResult {
  if (difficultyBits <= 0) {
    const h = hashWithMemoryScratchpad(payload, 0n, memoryKiB);
    return { nonce: 0n, hashHex: bytesToHex(h), iterations: 0, memoryKiB };
  }

  let nonce = 0n;
  let iterations = 0;

  while (iterations < maxIterations) {
    const hash = hashWithMemoryScratchpad(payload, nonce, memoryKiB);
    if (countLeadingZeroBits(hash) >= difficultyBits) {
      return {
        nonce,
        hashHex: bytesToHex(hash),
        iterations: iterations + 1,
        memoryKiB,
      };
    }
    nonce++;
    iterations++;
  }

  throw new Error(
    `MemoryHardPoW failed: exceeded max iterations (${maxIterations}) for difficulty ${difficultyBits}`,
  );
}

/**
 * Verifies memory-hard Proof-of-Work in deterministic time.
 */
export function verifyMemoryHardPoW(
  payload: Uint8Array,
  nonce: bigint,
  difficultyBits: number,
  memoryKiB = 64,
): boolean {
  if (difficultyBits <= 0) return true;
  const hash = hashWithMemoryScratchpad(payload, nonce, memoryKiB);
  return countLeadingZeroBits(hash) >= difficultyBits;
}

/**
 * Pillar 3: Web-of-Trust Sybil Immunity Discount Formula.
 * D_target = max(0, Base + Congestion - TrustDiscounts)
 */
export function calculateWebOfTrustDifficulty(
  baseDifficulty = 8,
  networkTps = 1,
  trust?: TrustContext,
  maxDifficulty = 24,
): number {
  const congestionFactor = Math.max(0, Math.floor(Math.log2(Math.max(1, networkTps))));
  let rawDifficulty = baseDifficulty + congestionFactor;

  if (trust) {
    // 1. Hardware passkey attestation discount (-3 bits)
    if (trust.isPasskeyVerified) {
      rawDifficulty -= 3;
    }

    // 2. Direct follow graph depth discount (-4 bits for 1st degree, -2 bits for 2nd degree)
    if (trust.followGraphDepth === 1) {
      rawDifficulty -= 4;
    } else if (trust.followGraphDepth === 2) {
      rawDifficulty -= 2;
    }

    // 3. Account age seniority discount (-2 bits if > 90 days)
    if (trust.accountAgeDays !== undefined && trust.accountAgeDays >= 90) {
      rawDifficulty -= 2;
    }

    // 4. Reputation score discount
    const rep = trust.reputationScore ?? 0.5;
    if (rep >= 0.8) {
      rawDifficulty -= 2;
    }
  }

  return Math.max(0, Math.min(maxDifficulty, Math.round(rawDifficulty)));
}


