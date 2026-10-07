import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair, bytesToHex } from '@sovra/crypto';
import { SovraEvent, EventKind } from '@sovra/protocol';
import { DefaultSocialGraphEngine } from '@sovra/social';
import {
  PersonalFeedRanker,
  LocalSummarizer,
  PrivateKnowledgeTwin,
  FeedItem,
} from '../src/index.js';

describe('Phase 6: Personal AI & Private Knowledge Twin', () => {
  function makeEvent(authorPubkey: string, id: string, content: string, createdAt = 1000): SovraEvent {
    return {
      id,
      pubkey: authorPubkey,
      createdAt,
      kind: EventKind.ShortPost,
      tags: [],
      content,
      sig: 'test_sig',
    };
  }

  describe('Personal Feed Ranker (Zero Central Algorithmic Manipulation)', () => {
    it('ranks feed according to user-defined topic affinity and evidence quality', () => {
      const user = bytesToHex(generateEd25519KeyPair().publicKey);
      const authorA = bytesToHex(generateEd25519KeyPair().publicKey);
      const authorB = bytesToHex(generateEd25519KeyPair().publicKey);

      const ranker = new PersonalFeedRanker({
        topicWeights: {
          cryptography: 0.9,
          gossip: -0.8,
        },
        epistemicEvidenceWeight: 0.5,
      });

      const items: FeedItem[] = [
        {
          event: makeEvent(authorA, 'item-crypto', 'Zero-knowledge proofs in peer-to-peer protocols', 1000),
          topicTags: ['cryptography', 'p2p'],
          epistemicStatus: 'SUPPORTED',
          evidenceCount: 3,
          authorReputationScore: 85,
        },
        {
          event: makeEvent(authorB, 'item-gossip', 'Celebrity gossip news update', 1000),
          topicTags: ['gossip', 'entertainment'],
          epistemicStatus: 'UNVERIFIED',
          evidenceCount: 0,
          authorReputationScore: 40,
        },
      ];

      const scored = ranker.rankFeed(items);
      expect(scored.length).toBe(2);

      // Cryptography post must be ranked #1
      expect(scored[0]!.item.event.id).toBe('item-crypto');
      expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score);

      // Verify explainability breakdown
      expect(scored[0]!.explanation.topicMatch).toBeGreaterThan(0.7);
      expect(scored[0]!.explanation.epistemicBonus).toBeGreaterThan(0.2);
      expect(scored[0]!.explanation.summaryText).toContain('High affinity with your subscribed topics');

      // Gossip post must have depressed topic score
      expect(scored[1]!.explanation.topicMatch).toBeLessThan(0.3);
    });

    it('suppresses muted topics and blocked authors without server-side censorship', async () => {
      const observer = bytesToHex(generateEd25519KeyPair().publicKey);
      const badAuthor = bytesToHex(generateEd25519KeyPair().publicKey);
      const goodAuthor = bytesToHex(generateEd25519KeyPair().publicKey);

      const graphEngine = new DefaultSocialGraphEngine({ strictSignatureVerification: false });
      // Observer blocks badAuthor locally
      await graphEngine.processEvent({
        id: 'block-bad',
        pubkey: observer,
        createdAt: 500,
        kind: EventKind.Block,
        tags: [['p', badAuthor]],
        content: JSON.stringify({ isUnblock: false }),
        sig: 'sig',
      } as any);

      const ranker = new PersonalFeedRanker({
        mutedTopics: ['spam_topic'],
      });

      const items: FeedItem[] = [
        {
          event: makeEvent(badAuthor, 'item-blocked', 'Post by blocked author'),
          topicTags: ['tech'],
        },
        {
          event: makeEvent(goodAuthor, 'item-muted-tag', 'Post with muted tag'),
          topicTags: ['spam_topic'],
        },
        {
          event: makeEvent(goodAuthor, 'item-clean', 'Legitimate clean post'),
          topicTags: ['distributed_systems'],
        },
      ];

      const scored = ranker.rankFeed(items, {
        observerPubkeyHex: observer,
        graphEngine,
      });

      expect(scored.length).toBe(1);
      expect(scored[0]!.item.event.id).toBe('item-clean');
    });

    it('dynamically adapts scoring when user updates preferences in real time', () => {
      const author = bytesToHex(generateEd25519KeyPair().publicKey);
      const ranker = new PersonalFeedRanker();

      const items: FeedItem[] = [
        {
          event: makeEvent(author, 'post-1', 'AI research updates'),
          topicTags: ['ai'],
        },
        {
          event: makeEvent(author, 'post-2', 'Cooking recipes'),
          topicTags: ['cooking'],
        },
      ];

      // Initially both neutral
      const initial = ranker.rankFeed(items);
      expect(Math.abs(initial[0]!.score - initial[1]!.score)).toBeLessThan(0.1);

      // User boosts cooking and de-prioritizes ai
      ranker.updatePreferences({
        topicWeights: {
          cooking: 1.0,
          ai: -0.5,
        },
      });

      const updated = ranker.rankFeed(items);
      expect(updated[0]!.item.event.id).toBe('post-2');
      expect(updated[0]!.score).toBeGreaterThan(updated[1]!.score);
    });
  });

  describe('Local Summarizer & Epistemic Synthesizer', () => {
    it('synthesizes a claim with supporting citations and disputes', () => {
      const summarizer = new LocalSummarizer();

      const claimText = 'Bluetooth Low Energy mesh networks achieve sub-second multi-hop relay latency under 10 nodes';
      const evidence = [
        { id: 'ev-1', urlOrCid: 'bafyev1', summary: 'Empirical benchmark logs', reliability: 0.9 },
        { id: 'ev-2', urlOrCid: 'bafyev2', summary: 'Lab packet trace', reliability: 0.8 },
      ];
      const counterarguments = [
        { id: 'ca-1', argument: 'High interference in 2.4GHz band causes jitter', authorPubkey: 'author-x', severity: 0.3 },
      ];

      const synthesis = summarizer.synthesizeClaim('claim-ble', claimText, evidence, counterarguments);

      expect(synthesis.consensusStatus).toBe('SUPPORTED');
      expect(synthesis.netEpistemicScore).toBeGreaterThan(0.35);
      expect(synthesis.synthesisSummary).toContain('SUPPORTED');
      expect(synthesis.synthesisSummary).toContain('2 evidence citation(s)');
    });

    it('classifies ungrounded or refuted claims correctly', () => {
      const summarizer = new LocalSummarizer();

      const refutedSynthesis = summarizer.synthesizeClaim(
        'claim-refuted',
        'Centralized servers are strictly required for offline BLE messaging',
        [],
        [
          { id: 'ca-1', argument: 'Sovra offline mesh runs peer-to-peer without server', authorPubkey: 'p1', severity: 0.9 },
          { id: 'ca-2', argument: 'Store-and-forward outbox converges locally', authorPubkey: 'p2', severity: 0.9 },
        ],
      );

      expect(refutedSynthesis.consensusStatus).toBe('REFUTED');
      expect(refutedSynthesis.netEpistemicScore).toBeLessThan(-0.35);
    });

    it('synthesizes question responses and surfaces top evidence-backed answer', () => {
      const summarizer = new LocalSummarizer();

      const synthesis = summarizer.synthesizeQuestion(
        'q-1',
        'How does Sovra protect offline mesh against replay attacks?',
        [
          {
            answerId: 'ans-weak',
            authorPubkey: 'author1',
            text: 'I think it checks timestamps maybe',
            evidenceScore: 0.2,
          },
          {
            answerId: 'ans-rigorous',
            authorPubkey: 'author2',
            text: 'It maintains a local Bloom filter and sliding timestamp window [t - 3600, t + 300] with signed nonce tracking',
            evidenceScore: 0.95,
          },
        ],
      );

      expect(synthesis.topAnswerId).toBe('ans-rigorous');
      expect(synthesis.netSynthesis).toContain('It maintains a local Bloom filter');
    });
  });

  describe('Private Knowledge Twin (Strict Privacy Boundary)', () => {
    it('records local learning, read history, and topic proficiency without leakage', () => {
      const twin = new PrivateKnowledgeTwin();

      twin.markAsRead('post-crypto-1', ['cryptography', 'math']);
      twin.markAsRead('post-crypto-2', ['cryptography']);
      twin.recordKnowledge('fact-curve25519', ['cryptography'], 0.95);
      twin.recordTrustAssertion('did:key:trusted-researcher', ['cryptography', 'security'], 0.9);
      twin.recordRejection('claim-bad-prng', ['cryptography', 'security'], 'Weak pseudo-random number generator');

      expect(twin.isRead('post-crypto-1')).toBe(true);
      expect(twin.isRead('post-unrelated')).toBe(false);

      const proficiency = twin.getTopicProficiency('cryptography');
      expect(proficiency.itemsRead).toBe(2);
      expect(proficiency.trustedClaims).toBe(2); // 1 fact + 1 trusted researcher
      expect(proficiency.rejectedClaims).toBe(1);

      expect(twin.getEntryCount()).toBe(5);
    });

    it('strictly enforces privacy boundary and prohibits export to public gossip', () => {
      const twin = new PrivateKnowledgeTwin();
      const readEntry = twin.markAsRead('post-private', ['confidential']);

      // 1. Calling exportForPublicSync() throws an explicit privacy violation error
      expect(() => twin.exportForPublicSync()).toThrow(/Privacy boundary violation/);

      // 2. Mesh export guard verifies that private twin entries are NOT exportable
      expect(PrivateKnowledgeTwin.canExportToPublicMesh(readEntry)).toBe(false);

      // Public item is permitted
      expect(PrivateKnowledgeTwin.canExportToPublicMesh({ isPrivate: false })).toBe(true);
    });
  });
});
