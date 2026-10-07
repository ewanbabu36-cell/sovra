import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair } from '@sovra/crypto';
import {
  createAuthenticatedPrincipal,
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
} from '@sovra/identity';
import {
  signOperation,
  validateSignedOperation,
  type UnsignedOperation,
  type TargetObjectDescriptor,
} from '../src/operation.js';
import { DurableReplayStore } from '../src/replay.js';

describe('Signed Operation Semantic Authorization Pipeline (@sovra/protocol)', () => {
  const kpAlice = generateEd25519KeyPair();
  const aliceDid = 'did:sovra:alice_123';
  const kpBob = generateEd25519KeyPair();
  const bobDid = 'did:sovra:bob_456';

  const alicePrincipal = createAuthenticatedPrincipal({
    did: aliceDid,
    sessionId: 'stk_alice',
    role: 'USER',
  });

  it('accepts legitimate signed operation with valid authorization', () => {
    const unsigned: UnsignedOperation<{ caption: string }> = {
      issuerDid: aliceDid,
      deviceId: 'dev_alice_mobile',
      operationType: 'FEED_POST_CREATE',
      payload: { caption: 'Hello Web3' },
      nonce: 'nonce_auth_1',
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signOperation(unsigned, kpAlice.privateKey);
    const replay = new DurableReplayStore();

    const result = validateSignedOperation(signed, kpAlice.publicKey, replay, {
      principal: alicePrincipal,
    });

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects valid signature when principal lacks required capability', () => {
    // Analyst role has 'admin:metrics', but lacks 'social:write'
    const analystPrincipal = createAuthenticatedPrincipal({
      did: aliceDid,
      sessionId: 'stk_analyst',
      role: 'ANALYST',
    });

    const unsigned: UnsignedOperation<{ caption: string }> = {
      issuerDid: aliceDid,
      deviceId: 'dev_alice_mobile',
      operationType: 'FEED_POST_CREATE',
      payload: { caption: 'Unauthorized creation attempt' },
      nonce: 'nonce_auth_2',
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signOperation(unsigned, kpAlice.privateKey);
    const replay = new DurableReplayStore();

    const result = validateSignedOperation(signed, kpAlice.publicKey, replay, {
      principal: analystPrincipal,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Principal capability violation');
    expect(result.error).toContain('social:write');
  });

  it('rejects valid signature when signer attempts to delete an object owned by someone else', () => {
    const unsigned: UnsignedOperation<{ postId: string }> = {
      issuerDid: aliceDid, // Alice is caller
      deviceId: 'dev_alice_mobile',
      operationType: 'FEED_POST_DELETE',
      payload: { postId: 'post_bob_999' },
      nonce: 'nonce_auth_3',
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signOperation(unsigned, kpAlice.privateKey);
    const replay = new DurableReplayStore();

    const targetObject: TargetObjectDescriptor = {
      id: 'post_bob_999',
      ownerDid: bobDid, // Bob is owner!
      isDeleted: false,
    };

    const result = validateSignedOperation(signed, kpAlice.publicKey, replay, {
      principal: alicePrincipal,
      targetObject,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Object ownership violation');
    expect(result.error).toContain(aliceDid);
    expect(result.error).toContain(bobDid);
  });

  it('allows moderator to delete object owned by another user', () => {
    const modPrincipal = createAuthenticatedPrincipal({
      did: 'did:sovra:moderator_1',
      sessionId: 'adm_mod_1',
      role: 'MODERATOR',
    });

    const kpMod = generateEd25519KeyPair();
    const unsigned: UnsignedOperation<{ postId: string }> = {
      issuerDid: 'did:sovra:moderator_1',
      deviceId: 'dev_mod_console',
      operationType: 'FEED_POST_DELETE',
      payload: { postId: 'post_bob_999' },
      nonce: 'nonce_auth_4',
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signOperation(unsigned, kpMod.privateKey);
    const replay = new DurableReplayStore();

    const targetObject: TargetObjectDescriptor = {
      id: 'post_bob_999',
      ownerDid: bobDid,
      isDeleted: false,
    };

    const result = validateSignedOperation(signed, kpMod.publicKey, replay, {
      principal: modPrincipal,
      targetObject,
    });

    expect(result.valid).toBe(true);
  });

  it('rejects operation targeting non-existent target object', () => {
    const unsigned: UnsignedOperation<{ postId: string }> = {
      issuerDid: aliceDid,
      deviceId: 'dev_alice_mobile',
      operationType: 'FEED_POST_DELETE',
      payload: { postId: 'non_existent_post' },
      nonce: 'nonce_auth_5',
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signOperation(unsigned, kpAlice.privateKey);
    const replay = new DurableReplayStore();

    const result = validateSignedOperation(signed, kpAlice.publicKey, replay, {
      principal: alicePrincipal,
      targetObject: null, // does not exist
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Target object existence violation');
  });

  it('rejects valid signature when target object is already deleted or tombstoned', () => {
    const unsigned: UnsignedOperation<{ postId: string }> = {
      issuerDid: aliceDid,
      deviceId: 'dev_alice_mobile',
      operationType: 'FEED_POST_DELETE',
      payload: { postId: 'post_alice_10' },
      nonce: 'nonce_auth_6',
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signOperation(unsigned, kpAlice.privateKey);
    const replay = new DurableReplayStore();

    const targetObject: TargetObjectDescriptor = {
      id: 'post_alice_10',
      ownerDid: aliceDid,
      tombstone: true, // tombstoned
    };

    const result = validateSignedOperation(signed, kpAlice.publicKey, replay, {
      principal: alicePrincipal,
      targetObject,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Target object state violation');
    expect(result.error).toContain('tombstoned');
  });

  it('rejects expired operation', () => {
    const now = Math.floor(Date.now() / 1000);
    const unsigned: UnsignedOperation<{ caption: string }> = {
      issuerDid: aliceDid,
      deviceId: 'dev_alice_mobile',
      operationType: 'FEED_POST_CREATE',
      payload: { caption: 'Old operation' },
      nonce: 'nonce_auth_7',
      timestamp: now - 5000, // 5000 seconds ago (> 3600 max age)
    };

    const signed = signOperation(unsigned, kpAlice.privateKey);
    const replay = new DurableReplayStore();

    const result = validateSignedOperation(signed, kpAlice.publicKey, replay, {
      principal: alicePrincipal,
      nowSeconds: now,
      maxAgeSeconds: 3600,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Operation expired');
  });

  it('validates device delegation chain correctly', () => {
    const rootKey = SovraIdentityKey.generate();
    const now = Math.floor(Date.now() / 1000);
    const devPair = generateEd25519KeyPair();
    const devKey = new SovraDeviceKey('dev_laptop', 'Laptop', rootKey.did, devPair.privateKey, now + 3600);
    const delegation = createDeviceDelegation(rootKey, devKey, now + 3600);

    const unsigned: UnsignedOperation<{ text: string }> = {
      issuerDid: rootKey.did,
      deviceId: devKey.deviceId,
      operationType: 'CHAT_MESSAGE_SEND',
      payload: { text: 'Encrypted message' },
      nonce: 'nonce_auth_8',
      timestamp: now,
    };

    const signed = signOperation(unsigned, devPair.privateKey);
    const replay = new DurableReplayStore();

    const result = validateSignedOperation(signed, devKey.publicKeyBytes, replay, {
      delegation,
      nowSeconds: now,
    });

    expect(result.valid).toBe(true);

    // If delegation issuer does not match op issuer
    const mismatchedResult = validateSignedOperation(
      signed,
      devKey.publicKeyBytes,
      new DurableReplayStore(),
      {
        delegation: {
          ...delegation,
          parentDid: 'did:sovra:someone_else',
        },
        nowSeconds: now,
      },
    );
    expect(mismatchedResult.valid).toBe(false);
    expect(mismatchedResult.error).toMatch(/delegation/i);
  });

  it('rejects illegal state transition (e.g. self friend request)', () => {
    const unsigned: UnsignedOperation<{ targetDid: string }> = {
      issuerDid: aliceDid,
      deviceId: 'dev_alice_mobile',
      operationType: 'FRIEND_REQUEST',
      payload: { targetDid: aliceDid }, // Self!
      nonce: 'nonce_auth_9',
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signed = signOperation(unsigned, kpAlice.privateKey);
    const replay = new DurableReplayStore();

    const result = validateSignedOperation(signed, kpAlice.publicKey, replay, {
      principal: alicePrincipal,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Cannot send friend request to oneself');
  });
});
