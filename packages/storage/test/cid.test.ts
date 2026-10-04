import { describe, it, expect } from 'vitest';
import { CID, InvalidCidError, encodeBase32, decodeBase32, encodeVarint, decodeVarint } from '../src/index.js';

describe('CIDv1 Engine Suite (@sovra/storage)', () => {
  const sampleData = new TextEncoder().encode('Sovra Decentralized Content Storage Test Block');

  it('generates deterministic CIDv1 with sha2-256 and base32 encoding', () => {
    const cid1 = CID.create('raw', sampleData, false, 'sha2-256');
    const cid2 = CID.create('raw', sampleData, false, 'sha2-256');

    expect(cid1.version).toBe(1);
    expect(cid1.codec).toBe('raw');
    expect(cid1.codecCode).toBe(0x55);
    expect(cid1.multihashType).toBe('sha2-256');
    expect(cid1.multihashCode).toBe(0x12);
    expect(cid1.digest.length).toBe(32);

    const str1 = cid1.toString();
    const str2 = cid2.toString();

    expect(str1).toBe(str2);
    // IPFS base32 lowercase prefix 'b' + 'afkrei...' for raw sha256
    expect(str1.startsWith('bafkrei')).toBe(true);
  });

  it('generates deterministic CIDv1 with dag-pb starting with bafybei', () => {
    const cid = CID.create('dag-pb', sampleData, false, 'sha2-256');
    expect(cid.codec).toBe('dag-pb');
    expect(cid.codecCode).toBe(0x70);

    const str = cid.toString();
    expect(str.startsWith('bafybei')).toBe(true);
  });

  it('supports blake3 multihash CID generation', () => {
    const cid = CID.create('raw', sampleData, false, 'blake3');
    expect(cid.multihashType).toBe('blake3');
    expect(cid.multihashCode).toBe(0x1e);

    const str = cid.toString();
    expect(str.startsWith('b')).toBe(true);

    const parsed = CID.parse(str);
    expect(parsed.multihashType).toBe('blake3');
    expect(parsed.equals(cid)).toBe(true);
  });

  it('roundtrips CID through string serialization and parsing (Base32 & Base58btc)', () => {
    const original = CID.create('dag-pb', sampleData, false, 'sha2-256');

    // Base32 roundtrip
    const b32Str = original.toString('base32');
    const fromB32 = CID.parse(b32Str);
    expect(fromB32.equals(original)).toBe(true);
    expect(fromB32.version).toBe(1);
    expect(fromB32.codec).toBe('dag-pb');

    // Base58btc roundtrip
    const b58Str = original.toString('base58');
    expect(b58Str.startsWith('z')).toBe(true);
    const fromB58 = CID.parse(b58Str);
    expect(fromB58.equals(original)).toBe(true);
  });

  it('roundtrips binary bytes serialization and deserialization', () => {
    const cid = CID.create('raw', sampleData, false, 'sha2-256');
    const bytes = cid.bytes;

    const restored = CID.fromBytes(bytes);
    expect(restored.equals(cid)).toBe(true);
    expect(restored.toString()).toBe(cid.toString());
  });

  it('rejects legacy CIDv0 (Qm...) and enforces strict CIDv1', () => {
    expect(() => {
      CID.parse('QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco');
    }).toThrow(InvalidCidError);
  });

  it('rejects malformed CID strings and invalid multibase prefixes', () => {
    expect(() => CID.parse('')).toThrow(InvalidCidError);
    expect(() => CID.parse('xInvalidPrefix123')).toThrow(InvalidCidError);
    expect(() => CID.parse('bInvalidBase32!@#')).toThrow(InvalidCidError);
  });

  it('encodes and decodes unsigned varints without overflow', () => {
    const values = [0, 1, 127, 128, 255, 300, 16384, 1048576];
    for (const val of values) {
      const encoded = encodeVarint(val);
      const decoded = decodeVarint(encoded);
      expect(decoded.value).toBe(val);
      expect(decoded.bytesRead).toBe(encoded.length);
    }
  });

  it('encodes and decodes base32 without loss', () => {
    const raw = new Uint8Array([0x00, 0xff, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde]);
    const b32 = encodeBase32(raw);
    const decoded = decodeBase32(b32);
    expect(decoded).toEqual(raw);
  });
});
