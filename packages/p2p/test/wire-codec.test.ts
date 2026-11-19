import { describe, it, expect } from 'vitest';
import {
  SOVRA_WIRE_MAGIC,
  SOVRA_WIRE_VERSION,
  SOVRA_MIN_FRAME_LENGTH,
  SovraWireMsgType,
  encodeWireFrame,
  decodeWireFrame,
  verifyWireFrameSignature,
  SovraWireFrameDecoder,
} from '../src/wire.js';
import {
  generateEd25519KeyPair,
  signEd25519,
  verifyEd25519,
} from '@sovra/crypto';

describe('SIP-001 Canonical Binary Wire Protocol Codec', () => {
  const keyPair = generateEd25519KeyPair();
  const signFn = (msg: Uint8Array) => signEd25519(keyPair.privateKey, msg);

  it('encodes a valid canonical 75-byte wire frame with empty payload', () => {
    const payload = new Uint8Array(0);
    const frame = encodeWireFrame(SovraWireMsgType.NET_PING, payload, signFn);

    expect(frame.length).toBe(SOVRA_MIN_FRAME_LENGTH); // Exactly 75 bytes
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getUint32(0, false)).toBe(SOVRA_WIRE_MAGIC); // 'SOVR'
    expect(view.getUint8(4)).toBe(SOVRA_WIRE_VERSION); // 0x01
    expect(view.getUint16(5, false)).toBe(SovraWireMsgType.NET_PING);
    expect(view.getUint32(7, false)).toBe(0); // 0 payload length

    const decodeRes = decodeWireFrame(frame, keyPair.publicKey);
    expect(decodeRes.ok).toBe(true);
    if (!decodeRes.ok) return;

    expect(decodeRes.value.magic).toBe(SOVRA_WIRE_MAGIC);
    expect(decodeRes.value.msgType).toBe(SovraWireMsgType.NET_PING);
    expect(decodeRes.value.payload.length).toBe(0);
  });

  it('encodes and decodes a payload with cryptographic Ed25519 verification', () => {
    const rawData = new TextEncoder().encode(JSON.stringify({
      authorDid: 'did:key:z6MkuV8sA732y4QzCsm6K2yC',
      content: 'Decentralized autonomous protocol event',
      timestamp: 1731999999000,
    }));

    const frame = encodeWireFrame(SovraWireMsgType.SOCIAL_EVENT_GOSSIP, rawData, signFn);
    expect(frame.length).toBe(11 + rawData.length + 64);

    const decodeRes = decodeWireFrame(frame, keyPair.publicKey);
    expect(decodeRes.ok).toBe(true);
    if (!decodeRes.ok) return;

    expect(decodeRes.value.msgType).toBe(SovraWireMsgType.SOCIAL_EVENT_GOSSIP);
    expect(decodeRes.value.payloadLength).toBe(rawData.length);
    expect(new TextDecoder().decode(decodeRes.value.payload)).toContain('Decentralized autonomous protocol event');

    // Standalone signature verification helper
    const isValid = verifyWireFrameSignature(decodeRes.value, keyPair.publicKey);
    expect(isValid).toBe(true);
  });

  it('fails closed and rejects frames with tampered payloads or forged signatures', () => {
    const rawData = new TextEncoder().encode('Original honest message');
    const frame = encodeWireFrame(SovraWireMsgType.CHAIN_CONSENSUS_TX, rawData, signFn);

    // Tamper with payload byte
    const tampered = new Uint8Array(frame);
    tampered[11] = tampered[11]! ^ 0xff; // Flip bits in payload

    const decodeRes = decodeWireFrame(tampered, keyPair.publicKey);
    expect(decodeRes.ok).toBe(false);
    if (decodeRes.ok) return;
    expect(decodeRes.error.message).toContain('cryptographic signature verification failed');

    // Reject forged key
    const attackerKey = generateEd25519KeyPair();
    const forgedRes = decodeWireFrame(frame, attackerKey.publicKey);
    expect(forgedRes.ok).toBe(false);
  });

  it('SovraWireFrameDecoder handles TCP stream chunking, fragmented packets, and resynchronization', () => {
    const decoder = new SovraWireFrameDecoder();

    const p1 = new TextEncoder().encode('Chunk 1 Payload');
    const p2 = new TextEncoder().encode('Chunk 2 Much Bigger Payload with More Bytes');

    const f1 = encodeWireFrame(SovraWireMsgType.SWARM_BITSWAP_WANT, p1, signFn);
    const f2 = encodeWireFrame(SovraWireMsgType.SWARM_BITSWAP_BLOCK, p2, signFn);

    // Concatenate both frames into single byte stream
    const combined = new Uint8Array(f1.length + f2.length);
    combined.set(f1, 0);
    combined.set(f2, f1.length);

    // Slice into arbitrary small stream chunks (e.g. 17 bytes each) simulating network fragmentation
    const extractedFrames: any[] = [];
    let offset = 0;
    const chunkSize = 17;
    while (offset < combined.length) {
      const slice = combined.subarray(offset, Math.min(combined.length, offset + chunkSize));
      const frames = decoder.pushChunk(slice);
      extractedFrames.push(...frames);
      offset += chunkSize;
    }

    expect(extractedFrames.length).toBe(2);
    expect(extractedFrames[0].msgType).toBe(SovraWireMsgType.SWARM_BITSWAP_WANT);
    expect(new TextDecoder().decode(extractedFrames[0].payload)).toBe('Chunk 1 Payload');

    expect(extractedFrames[1].msgType).toBe(SovraWireMsgType.SWARM_BITSWAP_BLOCK);
    expect(new TextDecoder().decode(extractedFrames[1].payload)).toBe('Chunk 2 Much Bigger Payload with More Bytes');
    expect(decoder.pendingBytes).toBe(0);
  });
});
