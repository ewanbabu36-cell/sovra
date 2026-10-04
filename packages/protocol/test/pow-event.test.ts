import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair, bytesToHex } from '@sovra/crypto';
import {
  createSignedSovraEvent,
  verifySignedSovraEvent,
  EventKind,
  UnsignedSovraEvent,
} from '../src/index.js';

describe('Anti-Sybil PoW Event Generation & Verification', () => {
  it('signs event with Hashcash PoW and verifies difficulty threshold', () => {
    const pair = generateEd25519KeyPair();
    const pubkey = bytesToHex(pair.publicKey);

    const unsigned: UnsignedSovraEvent = {
      pubkey,
      createdAt: Math.floor(Date.now() / 1000),
      kind: EventKind.ShortPost,
      tags: [['topic', 'security']],
      content: 'Sybil resistant post payload',
    };

    // Generate event requiring 10 bits difficulty
    const signedEvent = createSignedSovraEvent(unsigned, pair.privateKey, 10);
    expect(signedEvent.powNonce).toBeDefined();
    expect(signedEvent.powDifficulty).toBe(10);

    // Verifying with 0 or 10 bits should succeed
    expect(verifySignedSovraEvent(signedEvent, 0)).toBe(true);
    expect(verifySignedSovraEvent(signedEvent, 10)).toBe(true);

    // Verifying with 25 bits must reject (difficulty too low)
    expect(verifySignedSovraEvent(signedEvent, 25)).toBe(false);

    // Verifying with 12 bits base difficulty, but user has Web-of-Trust reputation >= 80 (difficulty drops by 4 to 8 bits <= 10)
    expect(
      verifySignedSovraEvent(signedEvent, 12, {
        webOfTrustReputation: 85,
      }),
    ).toBe(true);

    // Verifying with hardware passkey (difficulty drops by 3 bits: 13 -> 10)
    expect(
      verifySignedSovraEvent(signedEvent, 13, {
        hasHardwarePasskey: true,
      }),
    ).toBe(true);
  });
});
