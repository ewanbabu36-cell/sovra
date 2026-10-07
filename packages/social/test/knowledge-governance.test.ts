import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair, bytesToHex } from '@sovra/crypto';
import { SovraEvent, EventKind } from '@sovra/protocol';
import {
  KnowledgeGraphEngine,
  CommunityGovernanceEngine,
} from '../src/index.js';

describe('Phase 7: Knowledge Network & Advanced Community Governance', () => {
  function makeIdentity() {
    const kp = generateEd25519KeyPair();
    const pubkeyHex = bytesToHex(kp.publicKey);
    return {
      pubkeyHex,
      did: `did:key:${pubkeyHex}`,
      privateKey: kp.privateKey,
    };
  }

  // ==========================================
  // 1. KNOWLEDGE GRAPH ENGINE
  // ==========================================
  describe('KnowledgeGraphEngine: Semantic Graph & Epistemic Consensus', () => {
    it('ingests Question, Answers, Claims, Evidence and computes consensus', () => {
      const alice = makeIdentity();
      const bob = makeIdentity();
      const charlie = makeIdentity();

      const engine = new KnowledgeGraphEngine();

      // 1. Alice posts a Claim
      const claimEvent: SovraEvent = {
        id: 'claim-1',
        pubkey: alice.pubkeyHex,
        createdAt: 1000,
        kind: EventKind.Claim,
        tags: [],
        content: JSON.stringify({
          thesis: 'ChaCha20-Poly1305 provides authenticated encryption resistant to timing attacks on constrained mesh nodes',
          domain: 'cryptography',
          verificationMethod: 'benchmark',
        }),
        sig: 'sig-claim',
      };
      expect(engine.ingestEvent(claimEvent).ok).toBe(true);

      // Verify domain lookup
      const cryptoClaims = engine.getClaimsByDomain('cryptography');
      expect(cryptoClaims.length).toBe(1);
      expect(cryptoClaims[0]?.id).toBe('claim-1');

      // 2. Bob posts supporting Evidence
      const evidenceEvent: SovraEvent = {
        id: 'ev-1',
        pubkey: bob.pubkeyHex,
        createdAt: 1050,
        kind: EventKind.Evidence,
        tags: [],
        content: JSON.stringify({
          targetClaimId: 'claim-1',
          evidenceType: 'empirical',
          summary: 'ARM Cortex benchmark shows zero branch-dependent memory access',
          reproducibilityScore: 0.95,
        }),
        sig: 'sig-ev',
      };
      expect(engine.ingestEvent(evidenceEvent).ok).toBe(true);

      const ev2: SovraEvent = {
        id: 'ev-2',
        pubkey: charlie.pubkeyHex,
        createdAt: 1100,
        kind: EventKind.Evidence,
        tags: [],
        content: JSON.stringify({
          targetClaimId: 'claim-1',
          evidenceType: 'mathematical',
          summary: 'Formally verified constant-time implementation trace',
          reproducibilityScore: 0.9,
        }),
        sig: 'sig-ev2',
      };
      expect(engine.ingestEvent(ev2).ok).toBe(true);

      // Consensus should now be strong_consensus
      const consensus = engine.resolveConsensus('claim-1');
      expect(consensus.status).toBe('strong_consensus');
      expect(consensus.netScore).toBeGreaterThan(0.5);
      expect(consensus.evidenceCount).toBe(2);
      expect(consensus.counterargumentCount).toBe(0);

      // 3. Counterargument arrives challenging the claim
      const counterEvent: SovraEvent = {
        id: 'ca-1',
        pubkey: charlie.pubkeyHex,
        createdAt: 1200,
        kind: EventKind.Counterargument,
        tags: [],
        content: JSON.stringify({
          targetClaimOrEvidenceId: 'claim-1',
          rebuttalType: 'methodological_flaw',
          rebuttal: 'Cache line timing channel exists on certain non-standard architectures',
        }),
        sig: 'sig-ca',
      };
      expect(engine.ingestEvent(counterEvent).ok).toBe(true);

      // Status shifts to contested
      const contestedConsensus = engine.resolveConsensus('claim-1');
      expect(contestedConsensus.status).toBe('contested');
      expect(contestedConsensus.counterargumentCount).toBe(1);

      // 4. Export full semantic subgraph
      const subgraph = engine.exportSemanticSubgraph('claim-1');
      expect(subgraph.rootId).toBe('claim-1');
      expect(subgraph.claim).toBeDefined();
      expect(subgraph.evidence.length).toBe(2);
      expect(subgraph.counterarguments.length).toBe(1);
    });

    it('indexes Question and connects multiple Answers', () => {
      const alice = makeIdentity();
      const bob = makeIdentity();
      const engine = new KnowledgeGraphEngine();

      const qEvent: SovraEvent = {
        id: 'q-root',
        pubkey: alice.pubkeyHex,
        createdAt: 100,
        kind: EventKind.Question,
        tags: [],
        content: JSON.stringify({
          title: 'What is the optimal MTU for BLE mesh packet chunking?',
          topics: ['mesh', 'bluetooth', 'networking'],
        }),
        sig: 'sig-q',
      };
      engine.ingestEvent(qEvent);

      const ansEvent: SovraEvent = {
        id: 'ans-1',
        pubkey: bob.pubkeyHex,
        createdAt: 120,
        kind: EventKind.Answer,
        tags: [],
        content: JSON.stringify({
          questionEventId: 'q-root',
          summary: '247 bytes BLE 4.2+ ATT MTU provides 0 fragmentation overhead',
          body: 'Detailed calculation based on 23-byte legacy payload vs 247-byte extended MTU.',
        }),
        sig: 'sig-ans',
      };
      engine.ingestEvent(ansEvent);

      const answers = engine.getAnswersForQuestion('q-root');
      expect(answers.length).toBe(1);
      expect(answers[0]?.payload.summary).toContain('247 bytes');
    });
  });

  // ==========================================
  // 2. COMMUNITY GOVERNANCE ENGINE
  // ==========================================
  describe('CommunityGovernanceEngine: Multi-Model Democratic Governance', () => {
    it('creates community with governance model and verifies role privileges', () => {
      const creator = makeIdentity();
      const admin = makeIdentity();
      const member = makeIdentity();

      const gov = new CommunityGovernanceEngine();

      // Create moderated community
      const commRes = gov.createCommunity('c-crypto', creator.did, 'Cryptography Guild', 'moderated');
      expect(commRes.ok).toBe(true);

      // Creator assigns admin
      const roleRes = gov.assignRole('c-crypto', creator.did, admin.did, 'admin');
      expect(roleRes.ok).toBe(true);
      expect(gov.getRole('c-crypto', admin.did)).toBe('admin');

      // Admin assigns member as moderator
      const modRes = gov.assignRole('c-crypto', admin.did, member.did, 'moderator');
      expect(modRes.ok).toBe(true);
      expect(gov.getRole('c-crypto', member.did)).toBe('moderator');

      // Admin CANNOT promote to creator
      const illegalRes = gov.assignRole('c-crypto', admin.did, member.did, 'creator');
      expect(illegalRes.ok).toBe(false);
    });

    it('enforces invite-only community membership restrictions', () => {
      const creator = makeIdentity();
      const outsider = makeIdentity();

      const gov = new CommunityGovernanceEngine();
      gov.createCommunity('c-private', creator.did, 'Private Circle', 'invite_only');

      // Outsider attempts direct join -> Rejected
      const joinRes = gov.joinCommunity('c-private', outsider.did);
      expect(joinRes.ok).toBe(false);
      expect(joinRes.error.message).toContain('invite-only');
    });

    it('conducts democratic proposal voting with quorum and double-vote protection', () => {
      const creator = makeIdentity();
      const member1 = makeIdentity();
      const member2 = makeIdentity();
      const member3 = makeIdentity();

      const gov = new CommunityGovernanceEngine();
      gov.createCommunity('c-dao', creator.did, 'Decentralized Research DAO', 'open');

      // Members join
      gov.joinCommunity('c-dao', member1.did);
      gov.joinCommunity('c-dao', member2.did);
      gov.joinCommunity('c-dao', member3.did);

      // Member 1 creates a proposal
      const propRes = gov.createProposal(
        'c-dao',
        member1.did,
        'Adopt RFC-8785 Canonical Serialization',
        'Mandate RFC-8785 JSON serialization across all protocol events',
        ['yes', 'no'],
        3, // Quorum = 3 votes required
        3600, // 1 hour duration
        1000,
      );
      expect(propRes.ok).toBe(true);
      const propId = propRes.value.id;

      // Member 1 votes 'yes'
      expect(gov.castVote(propId, member1.did, 'yes', 1100).ok).toBe(true);

      // Member 1 votes again -> updates vote (no double counting)
      expect(gov.castVote(propId, member1.did, 'yes', 1150).ok).toBe(true);

      // Member 2 votes 'yes'
      expect(gov.castVote(propId, member2.did, 'yes', 1200).ok).toBe(true);

      // Member 3 votes 'no'
      expect(gov.castVote(propId, member3.did, 'no', 1250).ok).toBe(true);

      // Tally while active
      const activeTally = gov.tallyProposal(propId, 1300).value;
      expect(activeTally.status).toBe('ACTIVE');
      expect(activeTally.totalVotes).toBe(3);
      expect(activeTally.voteCounts['yes']).toBe(2);
      expect(activeTally.voteCounts['no']).toBe(1);

      // Tally after expiry (t = 1000 + 3600 * 1000 = 3601000)
      const finalTally = gov.tallyProposal(propId, 4000000).value;
      expect(finalTally.isClosed).toBe(true);
      expect(finalTally.quorumReached).toBe(true);
      expect(finalTally.status).toBe('PASSED');
      expect(finalTally.winningOption).toBe('yes');
    });

    it('processes signed CommunityGovernance protocol events', () => {
      const creator = makeIdentity();
      const targetUser = makeIdentity();

      const gov = new CommunityGovernanceEngine();

      // Create community via protocol event
      const createEv: SovraEvent = {
        id: 'gov-evt-create',
        pubkey: creator.pubkeyHex,
        createdAt: 100,
        kind: EventKind.CommunityGovernance,
        tags: [],
        content: JSON.stringify({
          communityId: 'c-protocol-dao',
          action: 'create_community',
          governanceModel: 'moderated',
        }),
        sig: 'sig-gov',
      };
      expect(gov.processGovernanceEvent(createEv).ok).toBe(true);
      expect(gov.getCommunity('c-protocol-dao')).toBeDefined();

      // Grant role via protocol event
      const grantEv: SovraEvent = {
        id: 'gov-evt-grant',
        pubkey: creator.pubkeyHex,
        createdAt: 110,
        kind: EventKind.CommunityGovernance,
        tags: [],
        content: JSON.stringify({
          communityId: 'c-protocol-dao',
          action: 'grant_role',
          targetSubjectDid: targetUser.did,
          roleName: 'moderator',
        }),
        sig: 'sig-grant',
      };
      expect(gov.processGovernanceEvent(grantEv).ok).toBe(true);
      expect(gov.getRole('c-protocol-dao', targetUser.did)).toBe('moderator');
    });
  });
});
