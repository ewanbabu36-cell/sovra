import { describe, it, expect } from 'vitest';
import {
  generateBip39Mnemonic,
  validateBip39Mnemonic,
  entropyToBip39Mnemonic,
  bip39MnemonicToEntropy,
  BIP39_ENGLISH_WORDLIST,
} from '../src/index.js';

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

  it('validates official BIP-39 test vector (all zeros 128-bit entropy)', () => {
    const zeroEntropy = new Uint8Array(16); // 16 zero bytes
    const mnemonic = entropyToBip39Mnemonic(zeroEntropy);
    // Official BIP-39 test vector:
    expect(mnemonic).toBe('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    expect(validateBip39Mnemonic(mnemonic)).toBe(true);

    const roundtrip = bip39MnemonicToEntropy(mnemonic);
    expect(roundtrip).toEqual(zeroEntropy);
  });

  it('rejects invalid checksum (word 12 changed from "about" to "abandon")', () => {
    const badChecksumMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    expect(validateBip39Mnemonic(badChecksumMnemonic)).toBe(false);
  });

  it('rejects word substitutions that invalidate checksum', () => {
    // Valid phrase:
    const valid = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    // Substitute word 1
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
  });
});
