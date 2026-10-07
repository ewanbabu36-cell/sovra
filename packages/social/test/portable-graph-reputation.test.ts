/**
 * @file packages/social/test/portable-graph-reputation.test.ts
 * Tests for Portable Social Graph Export/Import and Multidimensional Reputation.
 */

import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair, bytesToHex } from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';
import {
  DefaultSocialGraphEngine,
  PortableSocialGraphManager,
  MultidimensionalReputationEngine,
} from '../src/index.js';

describe('Phase 4: User-Owned Social Graph & Multidimensional Reputation', () => {
  function createIdentity(label: string) {
    const kp = generateEd25519KeyPair();
    const did = encodeEd25519DidKey(kp.publicKey);
    return {
      label,
      did,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
      publicKeyHex: bytesToHex(kp.publicKey),
    };
  }

  // ==========================================
  // 1. PORTABLE SOCIAL GRAPH EXPORT & IMPORT
  // ==========================================
  describe('Portable Social Graph Export & Verification', () => {
    it('exports signed social graph and restores into fresh engine', async () => {
      const alice = createIdentity('Alice');
      const bob = createIdentity('Bob');
      const charlie = createIdentity('Charlie');

      const sourceEngine = new DefaultSocialGraphEngine({ strictSignatureVerification: false });

      // Alice follows Bob and friends Charlie
      await sourceEngine.processEvent({
        id: 'evt-follow-1',
        pubkey: alice.publicKeyHex,
        createdAt: 1000,
        kind: 2,
        tags: [['p', bob.publicKeyHex]],
        content: JSON.stringify({ active: true }),
        sig: 'sig1',
      } as any);

      await sourceEngine.processEvent({
        id: 'evt-friend-1',
        pubkey: alice.publicKeyHex,
        createdAt: 1050,
        kind: 7,
        tags: [['p', charlie.publicKeyHex]],
        content: JSON.stringify({ action: 'accept' }),
        sig: 'sig2',
      } as any);

      expect(sourceEngine.isFollowing(alice.publicKeyHex, bob.publicKeyHex)).toBe(true);

      // Export Alice's social graph
      const envelope = PortableSocialGraphManager.exportGraph(
        sourceEngine,
        alice.did,
        alice.privateKey,
      );

      expect(envelope.data.did).toBe(alice.did);
      expect(envelope.data.follows.length).toBe(2);
      expect(envelope.data.friends.length).toBe(1);
      expect(envelope.signatureHex).toBeDefined();

      // Restore into brand new target engine
      const targetEngine = new DefaultSocialGraphEngine({ strictSignatureVerification: false });
      expect(targetEngine.isFollowing(alice.publicKeyHex, bob.publicKeyHex)).toBe(false);

      const importRes = PortableSocialGraphManager.verifyAndImportGraph(envelope, targetEngine);
      expect(importRes.ok).toBe(true);
      expect(importRes.value.followsImported).toBe(2);
      expect(importRes.value.friendsImported).toBe(1);

      // Verified: target engine now has Alice following Bob and Charlie!
      expect(targetEngine.isFollowing(alice.publicKeyHex, bob.publicKeyHex)).toBe(true);
      expect(targetEngine.isFollowing(alice.publicKeyHex, charlie.publicKeyHex)).toBe(true);
    });

    it('rejects tampered social graph envelope where follower data was modified', () => {
      const alice = createIdentity('Alice');
      const bob = createIdentity('Bob');
      const eve = createIdentity('Eve');

      const engine = new DefaultSocialGraphEngine({ strictSignatureVerification: false });
      const envelope = PortableSocialGraphManager.exportGraph(engine, alice.did, alice.privateKey);

      // Malicious actor modifies the export data without Alice's private key
      const tamperedEnvelope = {
        ...envelope,
        data: {
          ...envelope.data,
          follows: [{ targetPubkey: eve.publicKeyHex, createdAt: Date.now() }],
        },
      };

      const freshEngine = new DefaultSocialGraphEngine({ strictSignatureVerification: false });
      const result = PortableSocialGraphManager.verifyAndImportGraph(tamperedEnvelope, freshEngine);

      expect(result.ok).toBe(false);
      expect(result.error.message).toMatch(/signature verification failed/);
    });
  });

  // ==========================================
  // 2. MULTIDIMENSIONAL REPUTATION ENGINE
  // ==========================================
  describe('Multidimensional Reputation & Web-of-Trust Sybil Resistance', () => {
    it('computes 5-dimensional reputation score and damps untrusted assertions', () => {
      const alice = createIdentity('Alice');
      const bob = createIdentity('Bob'); // High-trust direct peer
      const charlie = createIdentity('Charlie'); // Target being evaluated
      const eve = createIdentity('Eve'); // Isolated Sybil actor

      const repEngine = new MultidimensionalReputationEngine({ dampingFactor: 0.5 });
      const graphEngine = new DefaultSocialGraphEngine({ strictSignatureVerification: false });

      // Alice follows Bob (Bob is 1 hop away from Alice)
      graphEngine.processEvent({
        id: 'f-1',
        pubkey: alice.publicKeyHex,
        createdAt: 100,
        kind: 2,
        tags: [['p', bob.publicKeyHex]],
        content: JSON.stringify({ active: true }),
        sig: 's',
      } as any);

      // Bob asserts high knowledge and reliability for Charlie
      repEngine.recordAssertion(bob.did, {
        subjectDid: charlie.did,
        dimension: 'knowledge',
        scoreDelta: 0.8,
        reason: 'Authored rigorous proof for offline protocol',
      });

      repEngine.recordAssertion(bob.did, {
        subjectDid: charlie.did,
        dimension: 'reliability',
        scoreDelta: 0.9,
        reason: 'Consistently seeded HLS chunks during mesh partition',
      });

      // Sybil actor Eve attempts to tank Charlie's trust with negative assertion
      repEngine.recordAssertion(eve.did, {
        subjectDid: charlie.did,
        dimension: 'trust',
        scoreDelta: -1.0,
        reason: 'Fabricated accusation',
      });

      // Calculate score from Alice's perspective
      const score = repEngine.computeScore(charlie.did, alice.did, graphEngine);

      // Bob's positive knowledge score carries high weight (1-hop = 0.5 weight)
      expect(score.knowledge).toBeGreaterThan(60);
      expect(score.reliability).toBeGreaterThan(60);

      // Eve is beyond maxGraphHops from Alice, so her Sybil attack is dropped or heavily damped!
      expect(score.compositeScore).toBeGreaterThan(50);
      expect(score.wotConfidence).toBeGreaterThan(0);
    });

    it('strictly rejects self-assertions from inflating reputation', () => {
      const alice = createIdentity('Alice');
      const repEngine = new MultidimensionalReputationEngine();

      // Alice attempts to assert +1.0 for herself
      const accepted = repEngine.recordAssertion(alice.did, {
        subjectDid: alice.did,
        dimension: 'knowledge',
        scoreDelta: 1.0,
        reason: 'I am the best',
      });

      expect(accepted).toBe(false);
    });
  });
});
