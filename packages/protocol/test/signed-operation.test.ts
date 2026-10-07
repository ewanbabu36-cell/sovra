import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair } from '@sovra/crypto';
import {
  signOperation,
  validateSignedOperation,
  type UnsignedOperation,
} from '../src/operation.js';
import { DurableReplayStore } from '../src/replay.js';

describe('Cryptographically Signed Operations Suite (@sovra/protocol)', () => {
  const kp = generateEd25519KeyPair();
  const issuerDid = 'did:sovra:alice_device_1';

  it('signs and validates legitimate mutation operation', () => {
    const unsigned: UnsignedOperation<{ caption: string }> = {
      issuerDid,
      deviceId: 'dev_primary',
      operationType: 'FEED_POST_CREATE',
      payload: { caption: 'Sovereign decentralized post!' },
      nonce: 'n_001',
      sequence: 1,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signOperation(unsigned, kp.privateKey);
    expect(signed.eventId).toBeDefined();
    expect(signed.signature).toBeDefined();

    const replayStore = new DurableReplayStore();
    const result = validateSignedOperation(signed, kp.publicKey, replayStore);
    expect(result.valid).toBe(true);
  });

  it('rejects tampered operation payload', () => {
    const unsigned: UnsignedOperation<{ amount: number }> = {
      issuerDid,
      deviceId: 'dev_primary',
      operationType: 'YOUTUBE_TIP',
      payload: { amount: 10 },
      nonce: 'n_002',
      sequence: 2,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signOperation(unsigned, kp.privateKey);

    // Attacker tampers with tip amount in transit
    const tampered = {
      ...signed,
      payload: { amount: 500 }, // changed!
    };

    const replayStore = new DurableReplayStore();
    const result = validateSignedOperation(tampered, kp.publicKey, replayStore);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Operation ID mismatch');
  });

  it('rejects forged cryptographic signature', () => {
    const attackerKp = generateEd25519KeyPair();
    const unsigned: UnsignedOperation<{ text: string }> = {
      issuerDid,
      deviceId: 'dev_primary',
      operationType: 'CHAT_MESSAGE_SEND',
      payload: { text: 'Spoofed chat message' },
      nonce: 'n_003',
      sequence: 3,
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Attacker signs Alice's DID with attacker's private key
    const forged = signOperation(unsigned, attackerKp.privateKey);

    const replayStore = new DurableReplayStore();
    const result = validateSignedOperation(forged, kp.publicKey, replayStore);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('signature verification failed');
  });

  it('rejects replayed operation through replay protection store', () => {
    const unsigned: UnsignedOperation<{ targetDid: string }> = {
      issuerDid,
      deviceId: 'dev_primary',
      operationType: 'FRIEND_REQUEST',
      payload: { targetDid: 'did:sovra:bob' },
      nonce: 'n_replay_test',
      sequence: 4,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signOperation(unsigned, kp.privateKey);
    const replayStore = new DurableReplayStore();

    // First submission
    const firstRes = validateSignedOperation(signed, kp.publicKey, replayStore);
    expect(firstRes.valid).toBe(true);

    // Replayed submission
    const replayedRes = validateSignedOperation(signed, kp.publicKey, replayStore);
    expect(replayedRes.valid).toBe(false);
    expect(replayedRes.error).toContain('Duplicate event rejected');
  });
});
