/**
 * @file scripts/bip39.ts
 * Standard RFC BIP-39 Cryptographic Mnemonic & Checksum Engine for Sovra Backend.
 */

import crypto from 'node:crypto';
import { BIP39_ENGLISH_WORDLIST } from '../packages/crypto/src/bip39-wordlist.ts';

export { BIP39_ENGLISH_WORDLIST };

const WORD_TO_INDEX: Map<string, number> = new Map();
for (let i = 0; i < BIP39_ENGLISH_WORDLIST.length; i++) {
  WORD_TO_INDEX.set(BIP39_ENGLISH_WORDLIST[i]!, i);
}

/**
 * Generates a fresh, cryptographically secure 12-word (128-bit) BIP-39 mnemonic with 4-bit SHA-256 checksum.
 */
export function generateBip39RecoveryPhrase(): string {
  const entropy = crypto.randomBytes(16); // 128 bits of CSPRNG entropy
  const hash = crypto.createHash('sha256').update(entropy).digest();

  let binStr = '';
  for (let i = 0; i < entropy.length; i++) {
    binStr += entropy[i]!.toString(2).padStart(8, '0');
  }

  // 128 bits / 32 = 4 bits checksum
  const hashBinStr = hash[0]!.toString(2).padStart(8, '0');
  binStr += hashBinStr.slice(0, 4);

  // 132 bits split into 12 11-bit chunks
  const words: string[] = [];
  for (let i = 0; i < binStr.length; i += 11) {
    const chunk = binStr.slice(i, i + 11);
    const index = parseInt(chunk, 2);
    words.push(BIP39_ENGLISH_WORDLIST[index]!);
  }

  return words.join(' ');
}

/**
 * Validates a BIP-39 mnemonic phrase (word count, dictionary validation, and SHA-256 checksum).
 */
export function validateBip39RecoveryPhrase(phrase: string): boolean {
  if (!phrase || typeof phrase !== 'string') return false;

  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
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

  const entropyBytes = Buffer.alloc(entBits / 8);
  for (let i = 0; i < entropyBytes.length; i++) {
    entropyBytes[i] = parseInt(entropyBin.slice(i * 8, (i + 1) * 8), 2);
  }

  const hash = crypto.createHash('sha256').update(entropyBytes).digest();
  const hashBinStr = hash[0]!.toString(2).padStart(8, '0');
  const actualChecksumBin = hashBinStr.slice(0, csBits);

  return checksumBin === actualChecksumBin;
}
