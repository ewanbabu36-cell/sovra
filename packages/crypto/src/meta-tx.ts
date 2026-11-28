/**
 * @file packages/crypto/src/meta-tx.ts
 * EIP-2771 / Account Abstraction Gasless Meta-Transaction Relayer Engine.
 *
 * Allows 0-balance users to execute on-chain state transitions (tips, transfers, posts)
 * with cryptographic non-repudiation while the Sovra Node or sponsor pays the gas fee.
 */

import { sha256 } from '@noble/hashes/sha256';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export interface MetaTransactionRequest {
  from: string; // Caller DID or sovereign address
  to: string; // Target recipient DID or contract
  action: 'TRANSFER' | 'TIP' | 'POST' | 'DELEGATE' | 'SUBSCRIBE' | 'REGISTER_HANDLE' | 'STORAGE_RENT' | 'BOOST';
  amount?: string;
  data?: Record<string, any>;
  nonce: number;
  deadline: number; // Unix timestamp in seconds
  signatureHex: string;
}

export const SOVRA_META_TX_DOMAIN = 'SOVRA_EIP2771_META_TX_V1';

/**
 * Computes canonical cryptographic digest for an unsigned meta-transaction.
 */
export function computeMetaTxDigest(req: Omit<MetaTransactionRequest, 'signatureHex'>): Uint8Array {
  const canonicalString = [
    SOVRA_META_TX_DOMAIN,
    req.from,
    req.to,
    req.action,
    req.amount || '0',
    String(req.nonce),
    String(req.deadline),
    JSON.stringify(req.data || {}),
  ].join('|');

  return sha256(new TextEncoder().encode(canonicalString));
}

/**
 * Signs a meta-transaction using user's private key.
 */
export function signMetaTransaction(
  req: Omit<MetaTransactionRequest, 'signatureHex'>,
  privateKey: Uint8Array
): MetaTransactionRequest {
  const digest = computeMetaTxDigest(req);
  const sig = ed25519.sign(digest, privateKey.slice(0, 32));
  return {
    ...req,
    signatureHex: bytesToHex(sig),
  };
}

/**
 * Cryptographically verifies a gasless meta-transaction request.
 */
export function verifyMetaTransaction(
  req: MetaTransactionRequest,
  publicKey: Uint8Array
): { valid: boolean; error?: string } {
  if (req.deadline < Math.floor(Date.now() / 1000)) {
    return { valid: false, error: 'Meta-transaction expired' };
  }

  try {
    const digest = computeMetaTxDigest(req);
    const sigBytes = hexToBytes(req.signatureHex);
    const valid = ed25519.verify(sigBytes, digest, publicKey);
    if (!valid) {
      return { valid: false, error: 'Invalid cryptographic signature' };
    }
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Verification exception' };
  }
}
