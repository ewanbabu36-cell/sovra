/**
 * SOVRA MPC (MULTI-PARTY COMPUTATION) & THRESHOLD SECRET SHARING (TSS)
 * 2-of-3 Verifiable Shamir Secret Sharing over Galois Field GF(2^8).
 * Enables Seedless Social Key Recovery across Enclave, Cloud Backup & Guardian Peers.
 */
import crypto from 'node:crypto';

// GF(2^8) with irreducible polynomial x^8 + x^4 + x^3 + x + 1 (0x11b)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initGfTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
  }
  LOG[0] = 0;
})();

export function gfAdd(a: number, b: number): number {
  return a ^ b;
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF(2^8)');
  if (a === 0) return 0;
  return EXP[(LOG[a] - LOG[b] + 255) % 255];
}

export interface MpcShare {
  id: number;
  shareHex: string;
  commitment?: string;
  holderType?: 'ENCLAVE' | 'CLOUD_BACKUP' | 'GUARDIAN';
}

export interface MpcSplitResult {
  shares: MpcShare[];
  threshold: number;
  totalShares: number;
  secretHash: string;
}

/**
 * Splits a secret (hex or string) into 3 shares with a 2-of-3 reconstruction threshold.
 */
export function splitSecretMpc(secret: string | Buffer, threshold = 2, totalShares = 3): MpcSplitResult {
  if (threshold !== 2 || totalShares !== 3) {
    throw new Error('Sovra MPC currently enforces strict (2, 3) threshold configuration');
  }

  const secretBuf = Buffer.isBuffer(secret) ? secret : (
    /^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0
      ? Buffer.from(secret, 'hex')
      : Buffer.from(secret, 'utf-8')
  );

  const len = secretBuf.length;
  if (len === 0) throw new Error('Cannot split empty secret');

  // Random degree-1 coefficients for each byte
  const a1 = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    // Ensure non-zero slope
    if (a1[i] === 0) a1[i] = 1;
  }

  const holderTypes: Array<'ENCLAVE' | 'CLOUD_BACKUP' | 'GUARDIAN'> = ['ENCLAVE', 'CLOUD_BACKUP', 'GUARDIAN'];
  const shares: MpcShare[] = [];

  for (let x = 1; x <= totalShares; x++) {
    const shareBuf = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      const s = secretBuf[i];
      const slope = a1[i];
      // f(x) = s ^ (slope * x) in GF(2^8)
      shareBuf[i] = gfAdd(s, gfMul(slope, x));
    }

    const shareHex = shareBuf.toString('hex');
    const commitment = crypto.createHash('sha256').update(shareHex).digest('hex');

    shares.push({
      id: x,
      shareHex,
      commitment,
      holderType: holderTypes[x - 1],
    });
  }

  const secretHash = crypto.createHash('sha256').update(secretBuf).digest('hex');

  return {
    shares,
    threshold,
    totalShares,
    secretHash,
  };
}

/**
 * Reconstructs the secret from any 2 distinct shares out of 3.
 */
export function reconstructSecretMpc(shares: MpcShare[]): string {
  if (!Array.isArray(shares) || shares.length < 2) {
    throw new Error('At least 2 shares are required to reconstruct secret in 2-of-3 MPC');
  }

  const unique = new Map<number, MpcShare>();
  for (const s of shares) {
    if (s && typeof s.id === 'number' && s.shareHex) {
      unique.set(s.id, s);
    }
  }

  if (unique.size < 2) {
    throw new Error('Distinct share IDs are required for MPC polynomial reconstruction');
  }

  const selected = Array.from(unique.values()).slice(0, 2);
  const s0 = selected[0];
  const s1 = selected[1];

  const b0 = Buffer.from(s0.shareHex, 'hex');
  const b1 = Buffer.from(s1.shareHex, 'hex');

  if (b0.length !== b1.length || b0.length === 0) {
    throw new Error('Share byte length mismatch in MPC reconstruction');
  }

  const len = b0.length;
  const secretBuf = Buffer.alloc(len);

  const x0 = s0.id;
  const x1 = s1.id;

  // Lagrange basis polynomials evaluated at x = 0:
  // L0(0) = x1 / (x0 ^ x1)
  // L1(0) = x0 / (x0 ^ x1)
  const denom = gfAdd(x0, x1);
  const l0 = gfDiv(x1, denom);
  const l1 = gfDiv(x0, denom);

  for (let i = 0; i < len; i++) {
    const y0 = b0[i];
    const y1 = b1[i];
    const term0 = gfMul(y0, l0);
    const term1 = gfMul(y1, l1);
    secretBuf[i] = gfAdd(term0, term1);
  }

  return secretBuf.toString('hex');
}
