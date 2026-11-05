/**
 * @file packages/crypto/src/bip39.ts
 * Official BIP-39 (Bitcoin Improvement Proposal 39) Standard Mnemonic Implementation.
 * 
 * Provides:
 * 1. 128-bit to 256-bit (12, 15, 18, 21, 24 words) mnemonic generation from cryptographic entropy.
 * 2. Strict SHA-256 checksum calculation and verification.
 * 3. Validation against the canonical 2048-word English dictionary.
 * 4. Conversion between entropy bytes and mnemonic phrases.
 */

import { sha256, secureRandomBytes } from './primitives.js';
import { CryptoError } from './errors.js';
import { BIP39_ENGLISH_WORDLIST } from './bip39-wordlist.js';

// Fast O(1) index lookup map
const WORD_TO_INDEX: Map<string, number> = new Map();
for (let i = 0; i < BIP39_ENGLISH_WORDLIST.length; i++) {
  WORD_TO_INDEX.set(BIP39_ENGLISH_WORDLIST[i]!, i);
}

/**
 * Generates a fresh, cryptographically secure BIP-39 mnemonic (12, 15, 18, 21, or 24 words).
 */
export function generateBip39Mnemonic(wordCount: 12 | 15 | 18 | 21 | 24 = 12): string {
  const entropyBytes = (wordCount * 11 - (wordCount / 3)) / 8;
  const entropy = secureRandomBytes(entropyBytes);
  return entropyToBip39Mnemonic(entropy);
}

/**
 * Converts raw entropy bytes to a standard BIP-39 mnemonic string with SHA-256 checksum.
 */
export function entropyToBip39Mnemonic(entropy: Uint8Array): string {
  const entBits = entropy.length * 8;
  if (![128, 160, 192, 224, 256].includes(entBits)) {
    throw new CryptoError(`Entropy bits must be 128, 160, 192, 224, or 256, got: ${entBits}`);
  }

  const csBits = entBits / 32; // 4 to 8 bits
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
export function validateBip39Mnemonic(mnemonic: string): boolean {
  if (!mnemonic || typeof mnemonic !== 'string') return false;

  const words = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;

  const csBits = words.length / 3;
  const entBits = words.length * 11 - csBits;

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
 * Converts a valid BIP-39 mnemonic phrase back into raw entropy bytes.
 */
export function bip39MnemonicToEntropy(mnemonic: string): Uint8Array {
  if (!validateBip39Mnemonic(mnemonic)) {
    throw new CryptoError('Invalid BIP-39 mnemonic checksum or dictionary word');
  }

  const words = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const csBits = words.length / 3;
  const entBits = words.length * 11 - csBits;

  let binStr = '';
  for (const w of words) {
    const idx = WORD_TO_INDEX.get(w)!;
    binStr += idx.toString(2).padStart(11, '0');
  }

  const entropyBin = binStr.slice(0, entBits);
  const entropyBytes = new Uint8Array(entBits / 8);
  for (let i = 0; i < entropyBytes.length; i++) {
    entropyBytes[i] = parseInt(entropyBin.slice(i * 8, (i + 1) * 8), 2);
  }

  return entropyBytes;
}
