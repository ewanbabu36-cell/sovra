import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateBip39Mnemonic,
  validateBip39Mnemonic,
  entropyToBip39Mnemonic,
  bip39MnemonicToEntropy,
  BIP39_ENGLISH_WORDLIST,
} from '../src/index.js';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

const officialVectorsPath = path.resolve(__dirname, './bip39-official-vectors.json');
const officialVectors: Array<[string, string, string, string]> = JSON.parse(
  fs.readFileSync(officialVectorsPath, 'utf8')
);

describe('BIP-39 Cryptographic Mnemonic & Checksum Verification', () => {
  it('has exactly 2048 words in the standard English dictionary', () => {
    expect(BIP39_ENGLISH_WORDLIST.length).toBe(2048);
    expect(BIP39_ENGLISH_WORDLIST[0]).toBe('abandon');
    expect(BIP39_ENGLISH_WORDLIST[2047]).toBe('zoo');
  });

  it('generates a fresh 12-word mnemonic with 128 bits of entropy and valid checksum', () => {
    const mnemonic = generateBip39Mnemonic(12);
    const words = mnemonic.split(' ');
    expect(words.length).toBe(12);
    expect(validateBip39Mnemonic(mnemonic)).toBe(true);

    const entropy = bip39MnemonicToEntropy(mnemonic);
    expect(entropy.length).toBe(16); // 128 bits = 16 bytes
    expect(entropyToBip39Mnemonic(entropy)).toBe(mnemonic);
  });

  it('generates a fresh 24-word mnemonic with 256 bits of entropy and valid checksum', () => {
    const mnemonic = generateBip39Mnemonic(24);
    const words = mnemonic.split(' ');
    expect(words.length).toBe(24);
    expect(validateBip39Mnemonic(mnemonic)).toBe(true);

    const entropy = bip39MnemonicToEntropy(mnemonic);
    expect(entropy.length).toBe(32); // 256 bits = 32 bytes
    expect(entropyToBip39Mnemonic(entropy)).toBe(mnemonic);
  });

  it('validates all 24 official SatoshiLabs BIP-39 test vectors (128, 192, and 256 bits)', () => {
    expect(officialVectors.length).toBe(24);

    for (let i = 0; i < officialVectors.length; i++) {
      const [entropyHex, expectedMnemonic] = officialVectors[i]!;
      const entropyBytes = hexToBytes(entropyHex);

      // 1. Forward entropy-to-mnemonic conversion
      const derivedMnemonic = entropyToBip39Mnemonic(entropyBytes);
      expect(derivedMnemonic).toBe(expectedMnemonic);

      // 2. Strict BIP-39 validation
      expect(validateBip39Mnemonic(derivedMnemonic)).toBe(true);

      // 3. Reverse mnemonic-to-entropy round-trip conversion
      const roundtripBytes = bip39MnemonicToEntropy(expectedMnemonic);
      const roundtripHex = bytesToHex(roundtripBytes);
      expect(roundtripHex).toBe(entropyHex);
    }
  });

  it('verifies case and whitespace normalization on official vectors', () => {
    const [_, mnemonic] = officialVectors[0]!;
    // Mixed case and extra whitespace
    const messyMnemonic = '  ' + mnemonic.toUpperCase().replace(/\s+/g, '   ') + '  ';
    expect(validateBip39Mnemonic(messyMnemonic)).toBe(true);

    const entropyMessy = bip39MnemonicToEntropy(messyMnemonic);
    const entropyClean = bip39MnemonicToEntropy(mnemonic);
    expect(bytesToHex(entropyMessy)).toBe(bytesToHex(entropyClean));
  });

  it('rejects invalid checksum (word 12 changed from "about" to "abandon")', () => {
    const badChecksumMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    expect(validateBip39Mnemonic(badChecksumMnemonic)).toBe(false);
  });

  it('rejects invalid checksum on 24-word vector', () => {
    const [_, valid24] = officialVectors[23]!;
    // Change last word
    const words = valid24.split(' ');
    words[23] = words[23] === 'zoo' ? 'abandon' : 'zoo';
    expect(validateBip39Mnemonic(words.join(' '))).toBe(false);
  });

  it('rejects word substitutions that invalidate checksum', () => {
    const valid = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const sub = 'zoo abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    expect(validateBip39Mnemonic(sub)).toBe(false);
  });

  it('rejects word permutations / reorderings', () => {
    const valid = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const reordered = 'about abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    expect(validateBip39Mnemonic(reordered)).toBe(false);
  });

  it('rejects phrases with non-dictionary words', () => {
    const invalidWord = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notabipword';
    expect(validateBip39Mnemonic(invalidWord)).toBe(false);
  });

  it('rejects phrases with wrong word count', () => {
    expect(validateBip39Mnemonic('abandon abandon abandon')).toBe(false);
    expect(validateBip39Mnemonic('')).toBe(false);
    expect(validateBip39Mnemonic('abandon '.repeat(13).trim())).toBe(false);
  });

  it('strictly rejects legacy 196-word phrases from BIP-39 checksum to prevent silent reinterpretation', () => {
    // Legacy phrase from Phase 1/2 vocabulary
    const legacyPhrase = 'matrix nexus pulse orbit enclave cipher abandon ability able about above absent';
    // Must NOT pass BIP-39 checksum validation
    expect(validateBip39Mnemonic(legacyPhrase)).toBe(false);
    expect(() => bip39MnemonicToEntropy(legacyPhrase)).toThrow();
  });
});
