import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair, sha256, bytesToHex } from '@sovra/crypto';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
  RevocationRegistry,
  createRevocationAssertion,
} from '@sovra/identity';
import { SovraEvent, serializeCanonicalJson } from '@sovra/protocol';
import { EventValidationPipeline } from '../src/validation.js';

describe('10-Step Protocol Event Validation Pipeline Suite', () => {
  function createSignedEvent(
    authorKey: SovraDeviceKey | SovraIdentityKey,
    customFields?: Partial<SovraEvent>,
  ): Uint8Array {
    const now = Math.floor(Date.now() / 1000);
    const pubkey =
      authorKey instanceof SovraDeviceKey ? authorKey.publicKeyHex : authorKey.publicKeyHex;

    const baseEvent = {
      pubkey,
      createdAt: now,
      kind: 1, // Short post
      tags: [],
      content: 'Standard valid event payload',
      ...customFields,
    };

    const canonicalJson = serializeCanonicalJson(baseEvent);
    const id = bytesToHex(sha256(new TextEncoder().encode(canonicalJson)));
    const sigBytes = authorKey.sign(hexToBytes(id));
    const sig = bytesToHex(sigBytes);

    const fullEvent: SovraEvent = {
      id,
      ...baseEvent,
      sig,
    };

    return new TextEncoder().encode(JSON.stringify(fullEvent));
  }

  function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  it('validates a compliant, signed protocol event successfully across all 10 steps', () => {
    const master = SovraIdentityKey.generate();
    const rawBytes = createSignedEvent(master);

    const result = EventValidationPipeline.validate(rawBytes);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('Step 1: rejects non-JSON or malformed bytes', () => {
    const malformed = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const result = EventValidationPipeline.validate(malformed);

    expect(result.isValid).toBe(false);
    expect(result.stepFailed).toBe(1);
    expect(result.errorCode).toBe('ERR_MALFORMED_JSON');
  });

  it('Step 2: rejects schema missing required attributes', () => {
    const invalidSchema = new TextEncoder().encode(
      JSON.stringify({ content: 'missing id, pubkey, sig' }),
    );
    const result = EventValidationPipeline.validate(invalidSchema);

    expect(result.isValid).toBe(false);
    expect(result.stepFailed).toBe(2);
    expect(result.errorCode).toBe('ERR_INVALID_SCHEMA');
  });

  it('Step 3: rejects unsupported protocol event kind', () => {
    const master = SovraIdentityKey.generate();
    const rawBytes = createSignedEvent(master, { kind: 9999 });
    const result = EventValidationPipeline.validate(rawBytes);

    expect(result.isValid).toBe(false);
    expect(result.stepFailed).toBe(3);
    expect(result.errorCode).toBe('ERR_UNSUPPORTED_EVENT_KIND');
  });

  it('Step 4: rejects oversized payload (>1MB limit)', () => {
    const master = SovraIdentityKey.generate();
    const rawBytes = createSignedEvent(master);

    const result = EventValidationPipeline.validate(rawBytes, { maxPayloadBytes: 100 });
    expect(result.isValid).toBe(false);
    expect(result.stepFailed).toBe(4);
    expect(result.errorCode).toBe('ERR_SIZE_LIMIT_EXCEEDED');
  });

  it('Step 5: rejects invalid author public key format', () => {
    const master = SovraIdentityKey.generate();
    const rawBytes = createSignedEvent(master, { pubkey: 'not-a-hex-pubkey' });
    const result = EventValidationPipeline.validate(rawBytes);

    expect(result.isValid).toBe(false);
    expect(result.stepFailed).toBe(5);
    expect(result.errorCode).toBe('ERR_INVALID_AUTHOR_KEY');
  });

  it('Step 6: rejects invalid or mismatched device delegation attached in tags', () => {
    const master = SovraIdentityKey.generate();
    const evilMaster = SovraIdentityKey.generate();
    const devicePair = generateEd25519KeyPair();
    const deviceKey = new SovraDeviceKey(
      'dev-1',
      'Phone',
      master.did,
      devicePair.privateKey,
      Math.floor(Date.now() / 1000) + 3600,
    );
    const evilDelegation = createDeviceDelegation(
      evilMaster,
      new SovraDeviceKey(
        'dev-1',
        'Phone',
        evilMaster.did,
        devicePair.privateKey,
        Math.floor(Date.now() / 1000) + 3600,
      ),
      Math.floor(Date.now() / 1000) + 3600,
    );
    const tamperedDelegation = {
      ...evilDelegation,
      delegationSignature: evilDelegation.delegationSignature.slice(0, -2) + 'ff',
    };

    const rawBytes = createSignedEvent(deviceKey, {
      tags: [['delegation', JSON.stringify(tamperedDelegation)]],
    });

    const result = EventValidationPipeline.validate(rawBytes);
    expect(result.isValid).toBe(false);
    expect(result.stepFailed).toBe(6);
  });

  it('Step 7: rejects tampered event payload or forged signature', () => {
    const master = SovraIdentityKey.generate();
    const rawBytes = createSignedEvent(master);
    const parsed = JSON.parse(new TextDecoder().decode(rawBytes));

    // Tamper with content after signature was generated
    parsed.content = 'Tampered content payload';
    const tamperedBytes = new TextEncoder().encode(JSON.stringify(parsed));

    const result = EventValidationPipeline.validate(tamperedBytes);
    expect(result.isValid).toBe(false);
    expect(result.stepFailed).toBe(7);
  });

  it('Step 8: rejects event from revoked author public key', () => {
    const master = SovraIdentityKey.generate();
    const rawBytes = createSignedEvent(master);

    const registry = new RevocationRegistry();
    const revocation = createRevocationAssertion(
      master,
      master.publicKeyHex,
      'master',
      'compromise',
      1,
    );
    registry.registerRevocation(revocation);

    const result = EventValidationPipeline.validate(rawBytes, { revocationRegistry: registry });
    expect(result.isValid).toBe(false);
    expect(result.stepFailed).toBe(8);
    expect(result.errorCode).toBe('ERR_AUTHOR_REVOKED');
  });

  it('Step 9: rejects event with timestamp too far in future and detects replays', () => {
    const master = SovraIdentityKey.generate();
    const futureTimestamp = Math.floor(Date.now() / 1000) + 10000;
    const futureBytes = createSignedEvent(master, { createdAt: futureTimestamp });

    const futureResult = EventValidationPipeline.validate(futureBytes);
    expect(futureResult.isValid).toBe(false);
    expect(futureResult.stepFailed).toBe(9);
    expect(futureResult.errorCode).toBe('ERR_TIMESTAMP_FUTURE');

    // Replay check
    const validBytes = createSignedEvent(master);
    const parsed = JSON.parse(new TextDecoder().decode(validBytes));
    const seenSet = new Set<string>([parsed.id]);

    const replayResult = EventValidationPipeline.validate(validBytes, { seenEventIds: seenSet });
    expect(replayResult.isValid).toBe(false);
    expect(replayResult.stepFailed).toBe(9);
    expect(replayResult.errorCode).toBe('ERR_REPLAY_DETECTED');
  });

  it('Step 10: enforces topic-specific policy check', () => {
    const master = SovraIdentityKey.generate();
    const otherMaster = SovraIdentityKey.generate();
    const rawBytes = createSignedEvent(master);

    // Topic is dedicated to otherMaster, but event is authored by master
    const result = EventValidationPipeline.validate(rawBytes, {
      topic: `/sovra/user/${otherMaster.publicKeyHex}`,
    });

    expect(result.isValid).toBe(false);
    expect(result.stepFailed).toBe(10);
    expect(result.errorCode).toBe('ERR_TOPIC_POLICY_VIOLATION');
  });
});
