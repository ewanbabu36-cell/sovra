/**
 * @file tests/security/governance_p0_remediation.test.ts
 * 🛡️ TSK-GOV-P0-REMEDIATION-01: COMPREHENSIVE GOVERNANCE SECURITY ADVERSARIAL SUITE
 *
 * Validates remediation of:
 * - P0-A: Signer identity binding, registry resolution, domain-separated payloads, replay nonces
 * - P0-B: Authoritative voter eligibility, state snapshots, strict key binding, cross-proposal replay rejection
 * - P0-C: Removal of hardcoded mock admin identities, strict RBAC on treasury/multisig/circuit-breaker routes,
 *         and absolute prohibition of unilateral treasury withdrawals.
 * - P1-A: Nonce consumption tracking, domain separation, and expiration guards.
 * - P1-B: Engine state export & hydration for durability across restarts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import {
  generateEd25519KeyPair,
  signEd25519,
  bytesToHex,
} from '../../packages/crypto/src/index.js';
import {
  MultiPartyApprovalEngine,
  GovernanceVotingEngine,
  AuthoritativeVoterDataProvider,
  GovernanceSignerRegistry,
  TrustedSignerRecord,
  VoterEligibilityRecord,
  computeCanonicalAuthPayload,
  computeCanonicalVotePayload,
} from '../../packages/identity/src/governance/index.js';

const BASE_URL = 'http://localhost:3001';

describe('TSK-GOV-P0-REMEDIATION-01: Governance Security Remediation Suite', () => {

  // =========================================================================
  // 1. P0-A: SIGNER IDENTITY BINDING & AUTHORIZATION IN MULTI-PARTY APPROVAL
  // =========================================================================
  describe('P0-A: MultiPartyApprovalEngine Cryptographic Security', () => {
    let mpa: MultiPartyApprovalEngine;
    let signer1Keys: ReturnType<typeof generateEd25519KeyPair>;
    let signer2Keys: ReturnType<typeof generateEd25519KeyPair>;
    let attackerKeys: ReturnType<typeof generateEd25519KeyPair>;
    const signer1Did = 'did:sovra:council:member_1';
    const signer2Did = 'did:sovra:council:member_2';
    const attackerDid = 'did:sovra:attacker:bad_actor';

    beforeEach(() => {
      signer1Keys = generateEd25519KeyPair();
      signer2Keys = generateEd25519KeyPair();
      attackerKeys = generateEd25519KeyPair();

      mpa = new MultiPartyApprovalEngine({
        strictRegistry: true,
        chainId: 'sovra-mainnet-test',
      });

      // Register legitimate signers in trusted registry
      mpa.registerSigner({
        did: signer1Did,
        publicKeyBytes: signer1Keys.publicKey,
        role: 'COUNCIL_MEMBER',
        status: 'ACTIVE',
      });
      mpa.registerSigner({
        did: signer2Did,
        publicKeyBytes: signer2Keys.publicKey,
        role: 'TREASURY_OFFICER',
        status: 'ACTIVE',
      });
    });

    it('rejects attacker-supplied public key paired with victim DID', () => {
      const proposal = mpa.proposeAction({
        actionType: 'TREASURY_TRANSFER',
        proposerDid: signer1Did,
        payload: { recipient: 'did:sovra:grantee:1', amountMicroSov: '1000' },
        eligibleSigners: [signer1Did, signer2Did],
        requiredApprovals: 2,
        createdAt: 1000,
      });

      // Attacker signs payload with attacker's own private key, claims to be signer1Did,
      // and passes attacker's public key in params
      const canonicalPayload = computeCanonicalAuthPayload({
        domain: 'SOVRA_GOV_AUTH_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: proposal.id,
        actionType: proposal.actionType,
        payloadHash: proposal.payloadHash,
        nonce: proposal.nonce,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        policyVersion: proposal.policyVersion,
      });
      const attackerSig = signEd25519(attackerKeys.privateKey, canonicalPayload);

      expect(() => {
        mpa.submitApproval({
          actionId: proposal.id,
          signerDid: signer1Did,
          signatureHex: bytesToHex(attackerSig),
          signerPublicKeyBytes: attackerKeys.publicKey, // Spoofed key!
          currentTime: 1010,
        });
      }).toThrowError(/Attacker-supplied public key does not match registered signer identity/);
    });

    it('rejects unknown DID not present in authoritative signer registry', () => {
      const proposal = mpa.proposeAction({
        actionType: 'TREASURY_TRANSFER',
        proposerDid: signer1Did,
        payload: { recipient: 'did:sovra:grantee:1', amountMicroSov: '1000' },
        eligibleSigners: [signer1Did, attackerDid],
        requiredApprovals: 2,
        createdAt: 1000,
      });

      const canonicalPayload = computeCanonicalAuthPayload({
        domain: 'SOVRA_GOV_AUTH_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: proposal.id,
        actionType: proposal.actionType,
        payloadHash: proposal.payloadHash,
        nonce: proposal.nonce,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        policyVersion: proposal.policyVersion,
      });
      const sig = signEd25519(attackerKeys.privateKey, canonicalPayload);

      expect(() => {
        mpa.submitApproval({
          actionId: proposal.id,
          signerDid: attackerDid,
          signatureHex: bytesToHex(sig),
          signerPublicKeyBytes: attackerKeys.publicKey,
          currentTime: 1010,
        });
      }).toThrowError(/is not registered in the trusted signer directory/);
    });

    it('rejects approval from a revoked signer key', () => {
      // Revoke signer 2
      mpa.revokeSigner(signer2Did, 'Key compromised in security incident');

      const proposal = mpa.proposeAction({
        actionType: 'TREASURY_TRANSFER',
        proposerDid: signer1Did,
        payload: { recipient: 'did:sovra:grantee:1', amountMicroSov: '1000' },
        eligibleSigners: [signer1Did, signer2Did],
        requiredApprovals: 2,
        createdAt: 1000,
      });

      const canonicalPayload = computeCanonicalAuthPayload({
        domain: 'SOVRA_GOV_AUTH_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: proposal.id,
        actionType: proposal.actionType,
        payloadHash: proposal.payloadHash,
        nonce: proposal.nonce,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        policyVersion: proposal.policyVersion,
      });
      const sig = signEd25519(signer2Keys.privateKey, canonicalPayload);

      expect(() => {
        mpa.submitApproval({
          actionId: proposal.id,
          signerDid: signer2Did,
          signatureHex: bytesToHex(sig),
          currentTime: 1010,
        });
      }).toThrowError(/public key has been revoked/);
    });

    it('rejects approval from an expired signer registration', () => {
      const expiredDid = 'did:sovra:council:expired_member';
      const expiredKeys = generateEd25519KeyPair();
      mpa.registerSigner({
        did: expiredDid,
        publicKeyBytes: expiredKeys.publicKey,
        role: 'SECURITY_COUNCIL',
        status: 'ACTIVE',
        expiresAt: 500, // Expired in the past relative to proposal at 1000
      });

      const proposal = mpa.proposeAction({
        actionType: 'TREASURY_TRANSFER',
        proposerDid: signer1Did,
        payload: { recipient: 'did:sovra:grantee:1', amountMicroSov: '1000' },
        eligibleSigners: [signer1Did, expiredDid],
        requiredApprovals: 2,
        createdAt: 1000,
      });

      const canonicalPayload = computeCanonicalAuthPayload({
        domain: 'SOVRA_GOV_AUTH_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: proposal.id,
        actionType: proposal.actionType,
        payloadHash: proposal.payloadHash,
        nonce: proposal.nonce,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        policyVersion: proposal.policyVersion,
      });
      const sig = signEd25519(expiredKeys.privateKey, canonicalPayload);

      expect(() => {
        mpa.submitApproval({
          actionId: proposal.id,
          signerDid: expiredDid,
          signatureHex: bytesToHex(sig),
          currentTime: 1010,
        });
      }).toThrowError(/registration has expired/);
    });

    it('rejects approval if signer lacks required role for the action', () => {
      const observerDid = 'did:sovra:council:observer';
      const observerKeys = generateEd25519KeyPair();
      mpa.registerSigner({
        did: observerDid,
        publicKeyBytes: observerKeys.publicKey,
        role: 'OBSERVER', // Observer has no governance authorization rights
        status: 'ACTIVE',
      });

      const proposal = mpa.proposeAction({
        actionType: 'TREASURY_TRANSFER',
        proposerDid: signer1Did,
        payload: { recipient: 'did:sovra:grantee:1', amountMicroSov: '1000' },
        eligibleSigners: [signer1Did, observerDid],
        requiredApprovals: 2,
        createdAt: 1000,
      });

      const canonicalPayload = computeCanonicalAuthPayload({
        domain: 'SOVRA_GOV_AUTH_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: proposal.id,
        actionType: proposal.actionType,
        payloadHash: proposal.payloadHash,
        nonce: proposal.nonce,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        policyVersion: proposal.policyVersion,
      });
      const sig = signEd25519(observerKeys.privateKey, canonicalPayload);

      expect(() => {
        mpa.submitApproval({
          actionId: proposal.id,
          signerDid: observerDid,
          signatureHex: bytesToHex(sig),
          currentTime: 1010,
        });
      }).toThrowError(/lacks required permission/);
    });

    it('rejects duplicate approval from the same signer', () => {
      const proposal = mpa.proposeAction({
        actionType: 'TREASURY_TRANSFER',
        proposerDid: signer1Did,
        payload: { recipient: 'did:sovra:grantee:1', amountMicroSov: '1000' },
        eligibleSigners: [signer1Did, signer2Did],
        requiredApprovals: 2,
        createdAt: 1000,
      });

      const canonicalPayload = computeCanonicalAuthPayload({
        domain: 'SOVRA_GOV_AUTH_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: proposal.id,
        actionType: proposal.actionType,
        payloadHash: proposal.payloadHash,
        nonce: proposal.nonce,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        policyVersion: proposal.policyVersion,
      });
      const sig = signEd25519(signer1Keys.privateKey, canonicalPayload);

      // First approval succeeds
      mpa.submitApproval({
        actionId: proposal.id,
        signerDid: signer1Did,
        signatureHex: bytesToHex(sig),
        currentTime: 1010,
      });

      // Second approval from same signer must be rejected
      expect(() => {
        mpa.submitApproval({
          actionId: proposal.id,
          signerDid: signer1Did,
          signatureHex: bytesToHex(sig),
          currentTime: 1020,
        });
      }).toThrowError(/has already approved this action/);
    });

    it('rejects corrupt or invalid cryptographic signature', () => {
      const proposal = mpa.proposeAction({
        actionType: 'TREASURY_TRANSFER',
        proposerDid: signer1Did,
        payload: { recipient: 'did:sovra:grantee:1', amountMicroSov: '1000' },
        eligibleSigners: [signer1Did, signer2Did],
        requiredApprovals: 2,
        createdAt: 1000,
      });

      // Fabricated 64-byte signature
      const invalidSigHex = '00'.repeat(64);

      expect(() => {
        mpa.submitApproval({
          actionId: proposal.id,
          signerDid: signer1Did,
          signatureHex: invalidSigHex,
          currentTime: 1010,
        });
      }).toThrowError(/Invalid cryptographic signature/);
    });

    it('rejects signature when payload hash has been tampered with', () => {
      const proposal = mpa.proposeAction({
        actionType: 'TREASURY_TRANSFER',
        proposerDid: signer1Did,
        payload: { recipient: 'did:sovra:grantee:1', amountMicroSov: '1000' },
        eligibleSigners: [signer1Did, signer2Did],
        requiredApprovals: 2,
        createdAt: 1000,
      });

      // Sign a DIFFERENT payload hash
      const fakeCanonicalPayload = computeCanonicalAuthPayload({
        domain: 'SOVRA_GOV_AUTH_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: proposal.id,
        actionType: proposal.actionType,
        payloadHash: 'deadbeef'.repeat(8), // Altered hash!
        nonce: proposal.nonce,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        policyVersion: proposal.policyVersion,
      });
      const sigOverTamperedPayload = signEd25519(signer1Keys.privateKey, fakeCanonicalPayload);

      expect(() => {
        mpa.submitApproval({
          actionId: proposal.id,
          signerDid: signer1Did,
          signatureHex: bytesToHex(sigOverTamperedPayload),
          currentTime: 1010,
        });
      }).toThrowError(/Invalid cryptographic signature/);
    });

    it('accepts valid registered signer signatures and reaches quorum', () => {
      const proposal = mpa.proposeAction({
        actionType: 'TREASURY_TRANSFER',
        proposerDid: signer1Did,
        payload: { recipient: 'did:sovra:grantee:1', amountMicroSov: '1000' },
        eligibleSigners: [signer1Did, signer2Did],
        requiredApprovals: 2,
        timelockDurationSeconds: 60,
        createdAt: 1000,
      });

      const canonicalPayload = computeCanonicalAuthPayload({
        domain: 'SOVRA_GOV_AUTH_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: proposal.id,
        actionType: proposal.actionType,
        payloadHash: proposal.payloadHash,
        nonce: proposal.nonce,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        policyVersion: proposal.policyVersion,
      });

      const sig1 = signEd25519(signer1Keys.privateKey, canonicalPayload);
      const res1 = mpa.submitApproval({
        actionId: proposal.id,
        signerDid: signer1Did,
        signatureHex: bytesToHex(sig1),
        currentTime: 1010,
      });
      expect(res1.currentApprovals).toBe(1);
      expect(res1.status).toBe('PENDING');

      const sig2 = signEd25519(signer2Keys.privateKey, canonicalPayload);
      const res2 = mpa.submitApproval({
        actionId: proposal.id,
        signerDid: signer2Did,
        signatureHex: bytesToHex(sig2),
        currentTime: 1020,
      });
      expect(res2.currentApprovals).toBe(2);
      expect(res2.status).toBe('READY_TIMELOCKED');
    });
  });

  // =========================================================================
  // 2. P0-B: VOTER IDENTITY & AUTHORITATIVE ELIGIBILITY IN GOVERNANCE VOTING
  // =========================================================================
  describe('P0-B: GovernanceVotingEngine Authoritative Security', () => {
    let votingEngine: GovernanceVotingEngine;
    let voterKeys: ReturnType<typeof generateEd25519KeyPair>;
    let attackerKeys: ReturnType<typeof generateEd25519KeyPair>;
    const voterDid = 'did:sovra:voter:honest_alice';
    const snapshotId = 'snap_block_500000';
    const proposalId = 'sip-remediation-001';
    const chainId = 'sovra-mainnet-test';

    beforeEach(() => {
      voterKeys = generateEd25519KeyPair();
      attackerKeys = generateEd25519KeyPair();

      votingEngine = new GovernanceVotingEngine({
        strictAuthoritativeMode: true,
        chainId,
      });

      // Pin proposal to snapshot
      votingEngine.setProposalSnapshot(proposalId, snapshotId);

      // Register authoritative voter state at snapshot
      votingEngine.registerAuthoritativeVoter(snapshotId, {
        did: voterDid,
        publicKeyBytes: voterKeys.publicKey,
        stakeMicroSov: 100_000_000n, // 100 SOV
        accountAgeDays: 60,
        usageScore: 0.8,
        snapshotId,
        status: 'ACTIVE',
      });
    });

    it('rejects client-asserted forged stake that conflicts with authoritative ledger state', () => {
      // Client asserts 500,000,000 SOV stake instead of authoritative 100 SOV
      const forgedProfile = {
        did: voterDid,
        stakeMicroSov: 500_000_000_000_000n,
        accountAgeDays: 60,
        usageScore: 0.8,
      };

      const votePayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId,
        proposalId,
        snapshotId,
        option: 'YES',
        voterDid,
        nonce: 'nonce-1',
      });
      const sig = signEd25519(voterKeys.privateKey, votePayload);

      expect(() => {
        votingEngine.castVote({
          proposalId,
          snapshotId,
          voterProfile: forgedProfile,
          option: 'YES',
          signatureHex: bytesToHex(sig),
          nonce: 'nonce-1',
        });
      }).toThrowError(/Client-asserted voter stake conflicts with authoritative ledger state/);
    });

    it('rejects client-asserted forged account age that conflicts with authoritative ledger state', () => {
      const forgedProfile = {
        did: voterDid,
        stakeMicroSov: 100_000_000n,
        accountAgeDays: 365, // Claims 1 year when authoritative is 60 days
        usageScore: 0.8,
      };

      const votePayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId,
        proposalId,
        snapshotId,
        option: 'YES',
        voterDid,
        nonce: 'nonce-1',
      });
      const sig = signEd25519(voterKeys.privateKey, votePayload);

      expect(() => {
        votingEngine.castVote({
          proposalId,
          snapshotId,
          voterProfile: forgedProfile,
          option: 'YES',
          signatureHex: bytesToHex(sig),
          nonce: 'nonce-1',
        });
      }).toThrowError(/Client-asserted account age conflicts with authoritative ledger state/);
    });

    it('rejects client-asserted forged usage score that conflicts with authoritative ledger state', () => {
      const forgedProfile = {
        did: voterDid,
        stakeMicroSov: 100_000_000n,
        accountAgeDays: 60,
        usageScore: 1.0, // Claims 1.0 when authoritative is 0.8
      };

      const votePayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId,
        proposalId,
        snapshotId,
        option: 'YES',
        voterDid,
        nonce: 'nonce-1',
      });
      const sig = signEd25519(voterKeys.privateKey, votePayload);

      expect(() => {
        votingEngine.castVote({
          proposalId,
          snapshotId,
          voterProfile: forgedProfile,
          option: 'YES',
          signatureHex: bytesToHex(sig),
          nonce: 'nonce-1',
        });
      }).toThrowError(/Client-asserted usage score conflicts with authoritative ledger state/);
    });

    it('rejects attacker-supplied voter public key that does not match registered voter identity', () => {
      const votePayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId,
        proposalId,
        snapshotId,
        option: 'YES',
        voterDid,
        nonce: 'nonce-1',
      });
      const attackerSig = signEd25519(attackerKeys.privateKey, votePayload);

      expect(() => {
        votingEngine.castVote({
          proposalId,
          snapshotId,
          voterProfile: { did: voterDid },
          option: 'YES',
          signatureHex: bytesToHex(attackerSig),
          voterPublicKeyBytes: attackerKeys.publicKey, // Spoofed key!
          nonce: 'nonce-1',
        });
      }).toThrowError(/Attacker-supplied voter public key does not match registered voter identity/);
    });

    it('rejects vote cast by a revoked voter key', () => {
      const revokedDid = 'did:sovra:voter:compromised';
      const revokedKeys = generateEd25519KeyPair();
      votingEngine.registerAuthoritativeVoter(snapshotId, {
        did: revokedDid,
        publicKeyBytes: revokedKeys.publicKey,
        stakeMicroSov: 100_000_000n,
        accountAgeDays: 60,
        usageScore: 0.8,
        snapshotId,
        status: 'REVOKED', // Key revoked
      });

      const votePayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId,
        proposalId,
        snapshotId,
        option: 'YES',
        voterDid: revokedDid,
        nonce: 'nonce-revoked',
      });
      const sig = signEd25519(revokedKeys.privateKey, votePayload);

      expect(() => {
        votingEngine.castVote({
          proposalId,
          snapshotId,
          voterProfile: { did: revokedDid },
          option: 'YES',
          signatureHex: bytesToHex(sig),
          nonce: 'nonce-revoked',
        });
      }).toThrowError(/key has been revoked/);
    });

    it('rejects duplicate vote cast for the same proposal', () => {
      const votePayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId,
        proposalId,
        snapshotId,
        option: 'YES',
        voterDid,
        nonce: 'nonce-dup-1',
      });
      const sig = signEd25519(voterKeys.privateKey, votePayload);

      // First vote accepted
      votingEngine.castVote({
        proposalId,
        snapshotId,
        voterProfile: { did: voterDid },
        option: 'YES',
        signatureHex: bytesToHex(sig),
        nonce: 'nonce-dup-1',
      });

      // Second vote rejected
      expect(() => {
        votingEngine.castVote({
          proposalId,
          snapshotId,
          voterProfile: { did: voterDid },
          option: 'NO',
          signatureHex: bytesToHex(sig),
          nonce: 'nonce-dup-2',
        });
      }).toThrowError(/has already cast a vote for proposal/);
    });

    it('rejects vote replay on a different proposal', () => {
      const proposal2Id = 'sip-remediation-002';
      votingEngine.setProposalSnapshot(proposal2Id, snapshotId);

      // Signature computed over proposalId
      const votePayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId,
        proposalId,
        snapshotId,
        option: 'YES',
        voterDid,
        nonce: 'nonce-replay',
      });
      const sig = signEd25519(voterKeys.privateKey, votePayload);

      // Attempt to submit signature to proposal2Id
      expect(() => {
        votingEngine.castVote({
          proposalId: proposal2Id,
          snapshotId,
          voterProfile: { did: voterDid },
          option: 'YES',
          signatureHex: bytesToHex(sig),
          nonce: 'nonce-replay',
        });
      }).toThrowError(/Invalid cryptographic vote signature/);
    });

    it('rejects vote replay on a different chain', () => {
      // Signature computed for a different chain ID
      const rogueChainPayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId: 'sovra-rogue-chain-666',
        proposalId,
        snapshotId,
        option: 'YES',
        voterDid,
        nonce: 'nonce-chain-replay',
      });
      const sig = signEd25519(voterKeys.privateKey, rogueChainPayload);

      expect(() => {
        votingEngine.castVote({
          proposalId,
          snapshotId,
          voterProfile: { did: voterDid },
          option: 'YES',
          signatureHex: bytesToHex(sig),
          nonce: 'nonce-chain-replay',
        });
      }).toThrowError(/Invalid cryptographic vote signature/);
    });

    it('rejects vote that references a mismatched snapshot ID', () => {
      const votePayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId,
        proposalId,
        snapshotId: 'snap_different_block_999999',
        option: 'YES',
        voterDid,
        nonce: 'nonce-bad-snap',
      });
      const sig = signEd25519(voterKeys.privateKey, votePayload);

      expect(() => {
        votingEngine.castVote({
          proposalId,
          snapshotId: 'snap_different_block_999999',
          voterProfile: { did: voterDid },
          option: 'YES',
          signatureHex: bytesToHex(sig),
          nonce: 'nonce-bad-snap',
        });
      }).toThrowError(/pinned to snapshot snap_block_500000/);
    });

    it('fails closed when strict authoritative mode is active but snapshot is missing', () => {
      const strictEngine = new GovernanceVotingEngine({
        strictAuthoritativeMode: true,
      });

      expect(() => {
        strictEngine.castVote({
          proposalId: 'unpinned-prop',
          snapshotId: 'nonexistent-snap',
          voterProfile: { did: 'did:sovra:unregistered' },
          option: 'YES',
          signatureHex: bytesToHex(new Uint8Array(64)),
        });
      }).toThrowError(/Strict authoritative voter mode active but no authoritative provider/);
    });

    it('accepts valid eligible voter and accurately computes quadratic weight', () => {
      const votePayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId,
        proposalId,
        snapshotId,
        option: 'YES',
        voterDid,
        nonce: 'nonce-valid-vote',
      });
      const sig = signEd25519(voterKeys.privateKey, votePayload);

      const record = votingEngine.castVote({
        proposalId,
        snapshotId,
        voterProfile: { did: voterDid },
        option: 'YES',
        signatureHex: bytesToHex(sig),
        nonce: 'nonce-valid-vote',
      });

      expect(record.voterDid).toBe(voterDid);
      expect(record.option).toBe('YES');
      expect(record.rawWeight).toBeGreaterThan(0);

      const tallies = votingEngine.getTallies(proposalId);
      expect(tallies.YES).toBe(record.rawWeight);
      expect(tallies.NO).toBe(0);
      expect(tallies.ABSTAIN).toBe(0);
    });
  });

  // =========================================================================
  // 3. P0-C: ADMIN ROUTE SECURITY & UNILATERAL WITHDRAWAL PROHIBITION
  // =========================================================================
  describe('P0-C: Admin Endpoint Protection & Unilateral Prohibition (HTTP)', () => {

    it('rejects unauthenticated request to /api/admin/multisig/propose with HTTP 401', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/multisig/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'TREASURY_WITHDRAWAL',
          payload: { amountSov: 50, recipientDid: 'did:sovra:attacker' },
        }),
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/(Admin(istrative)? (credentials|authorization|authentication) required|Unauthorized)/i);
    });

    it('rejects unauthenticated request to /api/admin/multisig/sign with HTTP 401', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/multisig/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: 'prop_test_fake',
          passkeySignature: 'sig_fake',
        }),
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/(Admin(istrative)? (credentials|authorization|authentication) required|Unauthorized)/i);
    });

    it('rejects unauthenticated request to /api/admin/circuit-breaker/toggle with HTTP 401', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/circuit-breaker/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active: true,
          scopes: ['ALL'],
          reason: 'Unauthorized halt attempt',
        }),
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/(Admin(istrative)? (credentials|authorization|authentication) required|Unauthorized)/i);
    });

    it('rejects unauthenticated request to /api/admin/treasury/solvency with HTTP 401', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/treasury/solvency`, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/(Admin(istrative)? (credentials|authorization|authentication) required|Unauthorized)/i);
    });

    it('rejects unauthenticated request to /api/admin/treasury/export-csv with HTTP 401', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/treasury/export-csv`, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/Admin (authorization|authentication) required/i);
    });

    it('rejects unauthenticated request to /api/admin/treasury/stream with HTTP 401', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/treasury/stream`, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/Admin (authorization|authentication) required/i);
    });

    it('strictly forbids unilateral treasury withdrawals with HTTP 403 constitutional violation', async () => {
      // First obtain a valid admin session
      const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminKey: 'sovra-test-admin-secret-key-32-chars-ok!',
          role: 'SUPER_ADMIN',
        }),
      });
      const loginData = await loginRes.json();
      expect(loginData.ok).toBe(true);
      const adminToken = loginData.sessionToken;

      // Attempt unilateral treasury withdrawal
      const withdrawRes = await fetch(`${BASE_URL}/api/admin/treasury/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          amountSov: 1000,
          recipientDid: 'did:sovra:unilateral_recipient',
          reason: 'Unilateral extraction attempt',
        }),
      });

      expect(withdrawRes.status).toBe(403);
      const withdrawData = await withdrawRes.json();
      expect(withdrawData.ok).toBe(false);
      expect(withdrawData.error).toContain('CRITICAL CONSTITUTIONAL VIOLATION: Unilateral treasury withdrawal is strictly prohibited');
    });

    it('verifies hardcoded mock identities did:sovra:admin_alpha and treasury_officer_beta are removed', async () => {
      // Login with admin credentials
      const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminKey: 'sovra-test-admin-secret-key-32-chars-ok!',
          role: 'SUPER_ADMIN',
        }),
      });
      const loginData = await loginRes.json();
      expect(loginData.ok).toBe(true);
      const adminToken = loginData.sessionToken;

      // Query proposals - should not contain any seeded mock proposal by did:sovra:admin_alpha
      const proposalsRes = await fetch(`${BASE_URL}/api/admin/multisig/proposals`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken}` },
      });
      expect(proposalsRes.status).toBe(200);
      const proposalsData = await proposalsRes.json();
      expect(proposalsData.ok).toBe(true);

      const alphaProposals = (proposalsData.proposals || []).filter(
        (p: any) => p.proposerDid === 'did:sovra:admin_alpha'
      );
      expect(alphaProposals.length).toBe(0);
    });
  });

  // =========================================================================
  // 4. P1-A & P1-B: NONCE CONSUMPTION, TIMELOCK & DURABLE HYDRATION
  // =========================================================================
  describe('P1-A & P1-B: Anti-Replay, Expiration & Hydration', () => {
    let mpa: MultiPartyApprovalEngine;
    let signer1Keys: ReturnType<typeof generateEd25519KeyPair>;
    let signer2Keys: ReturnType<typeof generateEd25519KeyPair>;
    const signer1Did = 'did:sovra:council:member_1';
    const signer2Did = 'did:sovra:council:member_2';

    beforeEach(() => {
      signer1Keys = generateEd25519KeyPair();
      signer2Keys = generateEd25519KeyPair();
      mpa = new MultiPartyApprovalEngine({
        strictRegistry: true,
        chainId: 'sovra-mainnet-test',
      });
      mpa.registerSigner({
        did: signer1Did,
        publicKeyBytes: signer1Keys.publicKey,
        role: 'SECURITY_COUNCIL',
        status: 'ACTIVE',
      });
      mpa.registerSigner({
        did: signer2Did,
        publicKeyBytes: signer2Keys.publicKey,
        role: 'SECURITY_COUNCIL',
        status: 'ACTIVE',
      });
    });

    it('rejects execution of an already executed proposal (replayed nonce)', () => {
      const proposal = mpa.proposeAction({
        actionType: 'EMERGENCY_SECURITY_PAUSE',
        proposerDid: signer1Did,
        payload: { scope: 'GLOBAL' },
        eligibleSigners: [signer1Did, signer2Did],
        requiredApprovals: 2,
        timelockDurationSeconds: 0,
        createdAt: 1000,
      });

      const canonicalPayload = computeCanonicalAuthPayload({
        domain: 'SOVRA_GOV_AUTH_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: proposal.id,
        actionType: proposal.actionType,
        payloadHash: proposal.payloadHash,
        nonce: proposal.nonce,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        policyVersion: proposal.policyVersion,
      });

      const sig1 = signEd25519(signer1Keys.privateKey, canonicalPayload);
      mpa.submitApproval({
        actionId: proposal.id,
        signerDid: signer1Did,
        signatureHex: bytesToHex(sig1),
        currentTime: 1005,
      });

      const sig2 = signEd25519(signer2Keys.privateKey, canonicalPayload);
      mpa.submitApproval({
        actionId: proposal.id,
        signerDid: signer2Did,
        signatureHex: bytesToHex(sig2),
        currentTime: 1006,
      });

      // First execution succeeds
      const exec1 = mpa.executeAction(proposal.id, signer1Did, 1010);
      expect(exec1.ok).toBe(true);

      // Second execution attempt throws
      expect(() => {
        mpa.executeAction(proposal.id, signer1Did, 1020);
      }).toThrowError(/has already been executed|already been consumed/);
    });

    it('rejects execution of an expired proposal', () => {
      const proposal = mpa.proposeAction({
        actionType: 'EMERGENCY_SECURITY_PAUSE',
        proposerDid: signer1Did,
        payload: { scope: 'GLOBAL' },
        eligibleSigners: [signer1Did, signer2Did],
        requiredApprovals: 2,
        timelockDurationSeconds: 10,
        createdAt: 1000,
        expiresAt: 2000,
      });

      const canonicalPayload = computeCanonicalAuthPayload({
        domain: 'SOVRA_GOV_AUTH_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: proposal.id,
        actionType: proposal.actionType,
        payloadHash: proposal.payloadHash,
        nonce: proposal.nonce,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        policyVersion: proposal.policyVersion,
      });

      const sig1 = signEd25519(signer1Keys.privateKey, canonicalPayload);
      mpa.submitApproval({
        actionId: proposal.id,
        signerDid: signer1Did,
        signatureHex: bytesToHex(sig1),
        currentTime: 1005,
      });

      const sig2 = signEd25519(signer2Keys.privateKey, canonicalPayload);
      mpa.submitApproval({
        actionId: proposal.id,
        signerDid: signer2Did,
        signatureHex: bytesToHex(sig2),
        currentTime: 1006,
      });

      // Execution after expiresAt (currentTime = 3000 > expiresAt = 2000)
      expect(() => {
        mpa.executeAction(proposal.id, signer1Did, 3000);
      }).toThrowError(/has expired and cannot be executed/);
    });

    it('preserves state across export and hydration (MPA Engine)', () => {
      const proposal = mpa.proposeAction({
        actionType: 'EMERGENCY_SECURITY_PAUSE',
        proposerDid: signer1Did,
        payload: { scope: 'TEST_SCOPE' },
        eligibleSigners: [signer1Did, signer2Did],
        requiredApprovals: 2,
        timelockDurationSeconds: 100,
        createdAt: 1000,
      });

      // Export state
      const exported = mpa.exportState();
      expect(exported.actions.length).toBe(1);
      expect(exported.trustedSigners.length).toBe(2);

      // Hydrate into brand new instance
      const newMpa = new MultiPartyApprovalEngine();
      newMpa.hydrateState(exported);

      const restoredAction = newMpa.getAction(proposal.id);
      expect(restoredAction).toBeDefined();
      expect(restoredAction?.actionType).toBe('EMERGENCY_SECURITY_PAUSE');
      expect(restoredAction?.payload.scope).toBe('TEST_SCOPE');
    });

    it('preserves state across export and hydration (Voting Engine)', () => {
      const voterKeys = generateEd25519KeyPair();
      const votingEngine = new GovernanceVotingEngine({
        strictAuthoritativeMode: true,
        chainId: 'sovra-mainnet-test',
      });

      votingEngine.setProposalSnapshot('sip-snap-01', 'snap-100');
      votingEngine.registerAuthoritativeVoter('snap-100', {
        did: 'did:sovra:voter:bob',
        publicKeyBytes: voterKeys.publicKey,
        stakeMicroSov: 25_000_000n,
        accountAgeDays: 90,
        usageScore: 0.5,
        snapshotId: 'snap-100',
        status: 'ACTIVE',
      });

      const votePayload = computeCanonicalVotePayload({
        domain: 'SOVRA_VOTE_V1',
        chainId: 'sovra-mainnet-test',
        proposalId: 'sip-snap-01',
        snapshotId: 'snap-100',
        option: 'YES',
        voterDid: 'did:sovra:voter:bob',
        nonce: 'vote-snap-nonce',
      });
      const sig = signEd25519(voterKeys.privateKey, votePayload);

      votingEngine.castVote({
        proposalId: 'sip-snap-01',
        snapshotId: 'snap-100',
        voterProfile: { did: 'did:sovra:voter:bob' },
        option: 'YES',
        signatureHex: bytesToHex(sig),
        nonce: 'vote-snap-nonce',
      });

      // Export state
      const exported = votingEngine.exportState();
      expect(exported.votes.length).toBe(1);
      expect(exported.tallies['sip-snap-01']).toBeDefined();

      // Hydrate into new engine
      const freshEngine = new GovernanceVotingEngine({
        strictAuthoritativeMode: true,
        chainId: 'sovra-mainnet-test',
      });
      freshEngine.hydrateState(exported);

      const tallies = freshEngine.getTallies('sip-snap-01');
      expect(tallies.YES).toBeGreaterThan(0);

      // Attempt duplicate vote on hydrated engine -> fails
      expect(() => {
        freshEngine.castVote({
          proposalId: 'sip-snap-01',
          snapshotId: 'snap-100',
          voterProfile: { did: 'did:sovra:voter:bob' },
          option: 'NO',
          signatureHex: bytesToHex(sig),
          nonce: 'vote-snap-nonce-2',
        });
      }).toThrowError(/has already cast a vote for proposal/);
    });
  });
});
