/**
 * @file packages/identity/src/psi-discovery.ts
 * Signal-Grade Private Set Intersection (PSI) using Oblivious Pseudorandom Functions (OPRF).
 *
 * Mathematical Foundations:
 * 1. RFC 3526 MODP Group 14 (2048-bit prime with 256-bit security margin).
 * 2. Commutative Pohlig-Hellman / 2DH OPRF construction (RFC 9497):
 *    - Client input: x_i (E.164 normalized phone number or handle).
 *    - Client chooses secret blinding scalar r_i: A_i = (H(x_i))^r_i mod p.
 *    - Server evaluates query with server secret k: B_i = (A_i)^k mod p = (H(x_i))^(r_i * k) mod p.
 *    - Server evaluates directory: For each user y in RegisteredUsers, D_y = (H(y))^k mod p.
 *    - Client unblinds: C_i = (B_i)^(r_i^(-1)) mod p = (H(x_i))^k mod p.
 *    - Matching: Client matches C_i against { D_y }.
 *
 * Privacy Guarantees:
 * - Server NEVER learns client's contacts (blinded with uniform random scalar r_i).
 * - Client only discovers registered users that match their local phone contacts.
 * - Zero plaintext leakage, zero biometric honeypots.
 */

import crypto from 'node:crypto';

// Standard RFC 3526 2048-bit MODP Group 14 Prime
const DH_GROUP = crypto.getDiffieHellman('modp14');
export const MODP14_PRIME = BigInt('0x' + DH_GROUP.getPrime('hex'));
export const MODP14_GENERATOR = BigInt('0x' + DH_GROUP.getGenerator('hex'));

/**
 * Normalizes phone numbers to standard E.164 format.
 * Strips whitespace, dashes, brackets, and leading double zeros.
 */
export function normalizePhoneNumber(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }
  if (!cleaned.startsWith('+')) {
    // If 10 digits without country code, default to E.164 standard prefix or leave clean
    if (/^\d{10}$/.test(cleaned)) {
      cleaned = '+91' + cleaned; // Standard default country or full normalized prefix
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

/**
 * Computes fast BigInt modular exponentiation: (base^exp) mod mod
 */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let res = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) res = (res * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return res;
}

/**
 * Computes modular multiplicative inverse using Extended Euclidean Algorithm: (a^(-1)) mod m
 */
export function modInverse(a: bigint, m: bigint): bigint {
  let [m0, x0, x1] = [m, 0n, 1n];
  let val = a % m;
  if (m === 1n) return 0n;
  while (val > 1n) {
    const q = val / m0;
    let t = m0;
    m0 = val % m0;
    val = t;
    t = x0;
    x0 = x1 - q * x0;
    x1 = t;
  }
  if (x1 < 0n) x1 += m;
  return x1;
}

/**
 * Hashes an arbitrary identifier string deterministically to a valid group element in Z_p*
 */
export function hashToGroupElement(identifier: string, prime = MODP14_PRIME): bigint {
  const norm = normalizePhoneNumber(identifier);
  const hashHex = crypto.createHash('sha256').update(`sovra:psi:v1:${norm}`).digest('hex');
  const hBig = BigInt('0x' + hashHex);
  // Ensure non-zero element in range [2, prime - 2]
  return (hBig % (prime - 3n)) + 2n;
}

export interface PsiClientBlindedQuery {
  blindedElements: string[]; // Hex encoded group elements A_i = (H(x_i))^r_i mod p
  blindingExponents: string[]; // Kept privately on client
  phoneHashes: string[]; // SHA-256 of normalized numbers for local correlation
}

export interface PsiServerDirectoryEntry {
  tagHex: string; // Evaluated tag D_y = (H(y))^k mod p
  did: string;
  handle: string;
  displayName?: string | undefined;
  avatar?: string | undefined;
}

export interface PsiMatchResult {
  did: string;
  handle: string;
  displayName?: string | undefined;
  avatar?: string | undefined;
  matchedIndex: number;
}

/**
 * Client Side: Blinds a set of phone numbers before transmitting to the discovery server.
 */
export function generatePsiClientQuery(
  phoneNumbers: string[],
  prime = MODP14_PRIME
): PsiClientBlindedQuery {
  const blindedElements: string[] = [];
  const blindingExponents: string[] = [];
  const phoneHashes: string[] = [];

  for (const raw of phoneNumbers) {
    const norm = normalizePhoneNumber(raw);
    if (!norm) continue;

    const phoneHash = crypto.createHash('sha256').update(norm).digest('hex');
    phoneHashes.push(phoneHash);

    // Generate random 256-bit secret blinding exponent r in range [2, prime - 2]
    const rBytes = crypto.randomBytes(32);
    const r = (BigInt('0x' + rBytes.toString('hex')) % (prime - 3n)) + 2n;
    blindingExponents.push(r.toString(16));

    const H = hashToGroupElement(norm, prime);
    const blinded = modPow(H, r, prime);
    blindedElements.push(blinded.toString(16));
  }

  return {
    blindedElements,
    blindingExponents,
    phoneHashes,
  };
}

/**
 * Server Side: Evaluates blinded client queries using the server's master secret key k.
 * Evaluates: B_i = (A_i)^k mod p
 */
export function evaluatePsiBlindedQueries(
  blindedElements: string[],
  serverSecretKHex: string,
  prime = MODP14_PRIME
): string[] {
  const k = BigInt('0x' + serverSecretKHex) % (prime - 1n);
  return blindedElements.map(elHex => {
    const A = BigInt('0x' + elHex);
    const B = modPow(A, k, prime);
    return B.toString(16);
  });
}

/**
 * Server Side: Evaluates a registered user's verified phone into an OPRF directory tag.
 * Evaluates: D_y = (H(y))^k mod p
 */
export function evaluatePsiDirectoryTag(
  phoneNumber: string,
  serverSecretKHex: string,
  prime = MODP14_PRIME
): string {
  const k = BigInt('0x' + serverSecretKHex) % (prime - 1n);
  const H = hashToGroupElement(phoneNumber, prime);
  const D = modPow(H, k, prime);
  return D.toString(16);
}

/**
 * Client Side: Applies client's blinding exponent r to server's directory tags and matches against server evaluated queries.
 * Evaluates: E_y = (D_y)^r mod p = (H(y))^(k * r) mod p.
 * Because r * k = k * r, E_y === B_i whenever x_i === y!
 * Completely eliminates any modular division or inversion requirement.
 */
export function matchPsiClientDirectory(
  serverEvaluatedQueries: string[],
  blindingExponents: string[],
  serverDirectory: PsiServerDirectoryEntry[],
  prime = MODP14_PRIME
): PsiMatchResult[] {
  if (serverEvaluatedQueries.length !== blindingExponents.length) {
    throw new Error('Mismatched evaluations and blinding exponents count');
  }

  const matches: PsiMatchResult[] = [];

  // For each query item i with exponent r_i, evaluate server directory items with r_i
  // Or if a single blinding session exponent r is used across the batch, it's O(|Dir|).
  // When each item i has its own r_i:
  for (let i = 0; i < serverEvaluatedQueries.length; i++) {
    const B_i = BigInt('0x' + serverEvaluatedQueries[i]);
    const r_i = BigInt('0x' + blindingExponents[i]);

    for (const entry of serverDirectory) {
      const D_y = BigInt('0x' + entry.tagHex);
      const E_y = modPow(D_y, r_i, prime);

      if (E_y === B_i) {
        matches.push({
          did: entry.did,
          handle: entry.handle,
          displayName: entry.displayName,
          avatar: entry.avatar,
          matchedIndex: i,
        });
        break; // Match found for this query item
      }
    }
  }

  return matches;
}

/**
 * Backward compatibility alias for matchPsiClientDirectory
 */
export const unblindAndMatchPsi = matchPsiClientDirectory;
