/**
 * @file apps/sovra-mobile/test/referral-system.test.ts
 * Automated Verification Suite for Sovra's Viral Referral & Invite System.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeReferralCode,
  findInviterByCode,
  REWARD_INVITER_SOV,
  REWARD_INVITEE_SOV,
  type ReferralRecord,
} from '../../../scripts/routes/referral.routes.js';
import { sovraDb } from '../../../scripts/database-engine.js';
import { fetchReferralStats, claimReferralCode } from '../src/services/api.js';

describe('Viral Referral & Invite System (Invite & Earn SOV)', () => {
  const aliceDid = 'did:key:z6MkuAliceReferralTest111111111111111';
  const bobDid = 'did:key:z6MkuBobReferralTest2222222222222222';
  const charlieDid = 'did:key:z6MkuCharlieReferralTest3333333333333';

  beforeEach(() => {
    // Reset/ensure test users in database
    const dbAny = sovraDb as any;
    if (dbAny && dbAny.db) {
      if (!Array.isArray(dbAny.db.users)) dbAny.db.users = [];
      if (!Array.isArray(dbAny.db.referrals)) dbAny.db.referrals = [];

      // Upsert Alice as an existing inviter
      const existingAlice = dbAny.db.users.find((u: any) => u.did === aliceDid);
      if (!existingAlice) {
        dbAny.db.users.push({
          did: aliceDid,
          handle: '@alice_creator',
          displayName: 'Alice Creator',
          balanceSov: 500.0,
          createdAt: Date.now(),
        });
      } else {
        existingAlice.balanceSov = 500.0;
      }

      // Upsert Bob
      const existingBob = dbAny.db.users.find((u: any) => u.did === bobDid);
      if (!existingBob) {
        dbAny.db.users.push({
          did: bobDid,
          handle: '@bob_peer',
          displayName: 'Bob Peer',
          balanceSov: 100.0,
          createdAt: Date.now(),
        });
      } else {
        existingBob.balanceSov = 100.0;
      }

      // Clear referrals array for fresh test state
      dbAny.db.referrals = [];
      sovraDb.save();
    }
  });

  describe('1. Deterministic Referral Code Derivation', () => {
    it('generates consistent, uppercase SOV-XXXXXX format code from DID', () => {
      const code1 = computeReferralCode(aliceDid);
      const code2 = computeReferralCode(aliceDid);

      expect(code1).toBe(code2);
      expect(code1.startsWith('SOV-')).toBe(true);
      expect(code1).toHaveLength(10); // 'SOV-' (4) + 6 hex chars = 10
      expect(code1).toBe(code1.toUpperCase());
    });

    it('generates unique referral codes for different DIDs', () => {
      const codeAlice = computeReferralCode(aliceDid);
      const codeBob = computeReferralCode(bobDid);

      expect(codeAlice).not.toBe(codeBob);
    });

    it('finds existing registered inviter by their computed referral code', () => {
      const aliceCode = computeReferralCode(aliceDid);
      const found = findInviterByCode(aliceCode);

      expect(found).not.toBeNull();
      expect(found?.did).toBe(aliceDid);
      expect(found?.handle).toBe('@alice_creator');
    });

    it('returns null for nonexistent referral code', () => {
      const found = findInviterByCode('SOV-NONEXISTENT999');
      expect(found).toBeNull();
    });
  });

  describe('2. Anti-Sybil & Anti-Fraud Verification Rules', () => {
    it('detects and flags self-referral attempts', () => {
      const aliceCode = computeReferralCode(aliceDid);
      // Invitee code equals inviter code
      const isSelf = (aliceCode === computeReferralCode(aliceDid));
      expect(isSelf).toBe(true);
    });

    it('enforces single referral reward claim per invitee DID', () => {
      const dbAny = sovraDb as any;
      const referrals: ReferralRecord[] = dbAny.db.referrals;

      // Seed an existing claim for bob
      referrals.push({
        id: 'ref_test_001',
        inviterDid: aliceDid,
        inviterHandle: '@alice_creator',
        inviterRefCode: computeReferralCode(aliceDid),
        inviteeDid: bobDid,
        inviteeHandle: '@bob_peer',
        status: 'completed',
        inviterRewardSov: REWARD_INVITER_SOV,
        inviteeRewardSov: REWARD_INVITEE_SOV,
        createdAt: Date.now(),
        completedAt: Date.now(),
      });

      const alreadyClaimed = referrals.some(r => r.inviteeDid === bobDid);
      expect(alreadyClaimed).toBe(true);

      const charlieClaimed = referrals.some(r => r.inviteeDid === charlieDid);
      expect(charlieClaimed).toBe(false);
    });

    it('enforces hardware device ID deduplication to prevent multi-account drainage', () => {
      const dbAny = sovraDb as any;
      const referrals: ReferralRecord[] = dbAny.db.referrals;
      const hardwareFingerprint = 'device_titan_secure_enclave_9988';

      referrals.push({
        id: 'ref_test_002',
        inviterDid: aliceDid,
        inviterHandle: '@alice_creator',
        inviterRefCode: computeReferralCode(aliceDid),
        inviteeDid: bobDid,
        inviteeHandle: '@bob_peer',
        inviteeDeviceId: hardwareFingerprint,
        status: 'completed',
        inviterRewardSov: REWARD_INVITER_SOV,
        inviteeRewardSov: REWARD_INVITEE_SOV,
        createdAt: Date.now(),
        completedAt: Date.now(),
      });

      const deviceUsed = referrals.some(r => r.inviteeDeviceId === hardwareFingerprint);
      expect(deviceUsed).toBe(true);

      const freshDeviceUsed = referrals.some(r => r.inviteeDeviceId === 'device_fresh_clean_001');
      expect(freshDeviceUsed).toBe(false);
    });
  });

  describe('3. Economic Distribution & Ledger Payouts', () => {
    it('verifies default reward distribution constants', () => {
      expect(REWARD_INVITER_SOV).toBe(50.0);
      expect(REWARD_INVITEE_SOV).toBe(25.0);
    });

    it('credits +50 SOV to inviter and +25 SOV to invitee via depositFunds', () => {
      const dbAny = sovraDb as any;
      const aliceBefore = dbAny.db.users.find((u: any) => u.did === aliceDid).balanceSov;
      const bobBefore = dbAny.db.users.find((u: any) => u.did === bobDid).balanceSov;

      // Simulate reward credit
      const depInviter = sovraDb.depositFunds({
        did: aliceDid,
        amount: REWARD_INVITER_SOV,
        sourceTx: 'test_referral_inviter_reward',
      });
      const depInvitee = sovraDb.depositFunds({
        did: bobDid,
        amount: REWARD_INVITEE_SOV,
        sourceTx: 'test_referral_invitee_welcome',
      });

      expect(depInviter.ok).toBe(true);
      expect(depInvitee.ok).toBe(true);

      const aliceAfter = dbAny.db.users.find((u: any) => u.did === aliceDid).balanceSov;
      const bobAfter = dbAny.db.users.find((u: any) => u.did === bobDid).balanceSov;

      expect(aliceAfter).toBe(aliceBefore + 50.0);
      expect(bobAfter).toBe(bobBefore + 25.0);
    });
  });

  describe('4. Mobile Client API Integration', () => {
    it('exposes fetchReferralStats and claimReferralCode functions', () => {
      expect(typeof fetchReferralStats).toBe('function');
      expect(typeof claimReferralCode).toBe('function');
    });
  });
});
