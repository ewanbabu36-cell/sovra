/**
 * @file apps/sovra-mobile/src/services/mnemonic.ts
 * BIP-39 Cryptographic Mnemonic Seed Phrase Service for Sovra Mobile Client.
 *
 * Implements:
 * 1. Standard BIP-39 12-word / 24-word mnemonic generation with cryptographic entropy.
 * 2. Strict SHA-256 checksum verification and wordlist validation.
 * 3. Deterministic Ed25519 seed & DID derivation for self-sovereign accounts.
 * 4. Zero third-party cloud dependence — 100% offline & decentralized.
 */

import {
  sha256,
  hkdfDerive,
  secureRandomBytes,
  getEd25519PublicKey,
} from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';
import { BIP39_ENGLISH_WORDLIST } from './bip39-wordlist.js';

// Fast O(1) index lookup map
const WORD_TO_INDEX: Map<string, number> = new Map();
for (let i = 0; i < BIP39_ENGLISH_WORDLIST.length; i++) {
  WORD_TO_INDEX.set(BIP39_ENGLISH_WORDLIST[i]!, i);
}

export interface MnemonicIdentity {
  readonly mnemonic: string;
  readonly did: string;
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
}

/**
 * Generates a fresh, cryptographically secure 12-word (or 24-word) BIP-39 mnemonic phrase.
 */
export function generateMnemonic(wordCount: 12 | 24 = 12): string {
  const entropyBytes = wordCount === 24 ? 32 : 16;
  const entropy = secureRandomBytes(entropyBytes);
  return entropyToMnemonic(entropy);
}

/**
 * Converts raw entropy bytes to a standard BIP-39 mnemonic string with checksum.
 */
export function entropyToMnemonic(entropy: Uint8Array): string {
  const entBits = entropy.length * 8;
  if (entBits !== 128 && entBits !== 256) {
    throw new Error(`Entropy bits must be 128 or 256, got: ${entBits}`);
  }

  const csBits = entBits / 32; // 4 bits for 128-bit, 8 bits for 256-bit
  const hash = sha256(entropy);

  // Convert entropy to binary bit string
  let binStr = '';
  for (let i = 0; i < entropy.length; i++) {
    binStr += entropy[i]!.toString(2).padStart(8, '0');
  }

  // Append first csBits from hash
  const hashBinStr = hash[0]!.toString(2).padStart(8, '0');
  binStr += hashBinStr.slice(0, csBits);

  // Split into 11-bit chunks
  const words: string[] = [];
  for (let i = 0; i < binStr.length; i += 11) {
    const chunk = binStr.slice(i, i + 11);
    const index = parseInt(chunk, 2);
    words.push(BIP39_ENGLISH_WORDLIST[index]!);
  }

  return words.join(' ');
}

/**
 * Validates a BIP-39 mnemonic phrase (word count, dictionary validation, and checksum bits).
 */
export function validateMnemonic(mnemonic: string): boolean {
  if (!mnemonic || typeof mnemonic !== 'string') return false;

  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) return false;

  const totalBits = words.length * 11;
  const csBits = words.length === 12 ? 4 : 8;
  const entBits = totalBits - csBits;

  let binStr = '';
  for (const w of words) {
    const idx = WORD_TO_INDEX.get(w);
    if (idx === undefined) return false;
    binStr += idx.toString(2).padStart(11, '0');
  }

  const entropyBin = binStr.slice(0, entBits);
  const checksumBin = binStr.slice(entBits);

  // Convert entropy binary back to bytes
  const entropyBytes = new Uint8Array(entBits / 8);
  for (let i = 0; i < entropyBytes.length; i++) {
    entropyBytes[i] = parseInt(entropyBin.slice(i * 8, (i + 1) * 8), 2);
  }

  // Calculate actual checksum
  const hash = sha256(entropyBytes);
  const hashBinStr = hash[0]!.toString(2).padStart(8, '0');
  const actualChecksumBin = hashBinStr.slice(0, csBits);

  return checksumBin === actualChecksumBin;
}

/**
 * Deterministically derives a 32-byte Ed25519 private seed from a valid mnemonic phrase.
 */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Uint8Array {
  const normMnemonic = mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
  const ikm = new TextEncoder().encode(normMnemonic);
  const salt = new TextEncoder().encode(`sovra:bip39:v1:${passphrase}`);
  const info = new TextEncoder().encode('sovra:ed25519:identity:root');

  return hkdfDerive(ikm, salt, info, 32);
}

/**
 * Derives full cryptographic DID and Ed25519 keypair from a mnemonic phrase.
 */
export function mnemonicToIdentity(mnemonic: string, passphrase = ''): MnemonicIdentity {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid BIP-39 mnemonic seed phrase. Check word spelling and order.');
  }

  const privateKey = mnemonicToSeed(mnemonic, passphrase);
  const publicKey = getEd25519PublicKey(privateKey);
  const did = encodeEd25519DidKey(publicKey);

  return {
    mnemonic: mnemonic.trim().toLowerCase().split(/\s+/).join(' '),
    did,
    privateKey,
    publicKey,
  };
}
