import { describe, it, expect } from 'vitest';
import {
  encodeEd25519DidKey,
  decodeEd25519DidKey,
  isValidEd25519DidKey,
  hexToEd25519DidKey,
  ed25519DidKeyToHex,
} from '../src/index.js';
import { hexToBytes, bytesToHex } from '@sovra/crypto';

describe('W3C did:key Specification Compliance', () => {
  // Official W3C DID Key Test Vector for Ed25519
  const W3C_PUBKEY_HEX = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
  const W3C_EXPECTED_DID = 'did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw';

  it('matches official W3C did:key test vector for Ed25519', () => {
    const rawKey = hexToBytes(W3C_PUBKEY_HEX);
    const did = encodeEd25519DidKey(rawKey);
    expect(did).toBe(W3C_EXPECTED_DID);

    const decoded = decodeEd25519DidKey(W3C_EXPECTED_DID);
    expect(bytesToHex(decoded)).toBe(W3C_PUBKEY_HEX);
  });

  it('converts between hex and did:key representations symmetrically', () => {
    const did = hexToEd25519DidKey(W3C_PUBKEY_HEX);
    expect(did).toBe(W3C_EXPECTED_DID);

    const hex = ed25519DidKeyToHex(did);
    expect(hex).toBe(W3C_PUBKEY_HEX);
  });

  it('validates correct did:key strings and rejects malformed inputs', () => {
    expect(isValidEd25519DidKey(W3C_EXPECTED_DID)).toBe(true);

    // Invalid prefix
    expect(isValidEd25519DidKey('did:example:123')).toBe(false);
    expect(isValidEd25519DidKey('did:key:x123')).toBe(false);

    // Truncated key
    expect(isValidEd25519DidKey('did:key:z6MkShort')).toBe(false);

    // Wrong multicodec
    expect(isValidEd25519DidKey('not_a_did')).toBe(false);
  });

  it('throws ValidationError when encoding key with wrong byte length', () => {
    const invalidKey = new Uint8Array(31); // 31 bytes instead of 32
    expect(() => encodeEd25519DidKey(invalidKey)).toThrow(/must be exactly 32 bytes/);
  });
});
