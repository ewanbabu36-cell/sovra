import { describe, it, expect, beforeEach } from 'vitest';
import {
  SemanticVectorIndex,
  embedText,
  cosineSimilarity,
} from '../../services/search/src/vector-search.js';

describe('On-Device Semantic Vector Search & HNSW Index', () => {
  let index: SemanticVectorIndex;

  beforeEach(() => {
    index = new SemanticVectorIndex({
      dimensions: 128,
      m: 16,
      efConstruction: 64,
      efSearch: 32,
    });
  });

  describe('1. Deterministic Text Embeddings & Cosine Metrics', () => {
    it('generates deterministic L2 unit-sphere embeddings', () => {
      const vec1 = embedText('Sovereign decentralized P2P social protocol', 128);
      const vec2 = embedText('Sovereign decentralized P2P social protocol', 128);

      expect(vec1.length).toBe(128);
      expect(vec2.length).toBe(128);

      // Deterministic identical output
      for (let i = 0; i < 128; i++) {
        expect(vec1[i]).toBe(vec2[i]);
      }

      // Unit sphere normalization check: ||v|| ~ 1.0
      let norm = 0;
      for (let i = 0; i < 128; i++) {
        const val = vec1[i] ?? 0;
        norm += val * val;
      }
      expect(Math.abs(Math.sqrt(norm) - 1.0)).toBeLessThan(1e-4);
    });

    it('assigns higher cosine similarity to semantically related sentences than unrelated topics', () => {
      const vTech1 = embedText('Decentralized mesh networks and GossipSub peer relay');
      const vTech2 = embedText('P2P gossip router and libp2p network nodes');
      const vCooking = embedText('Homemade strawberry ice cream and vanilla cake frosting');

      const simRelated = cosineSimilarity(vTech1, vTech2);
      const simUnrelated = cosineSimilarity(vTech1, vCooking);

      expect(simRelated).toBeGreaterThan(simUnrelated);
      expect(simRelated).toBeGreaterThan(0.1);
    });
  });

  describe('2. HNSW Semantic Search & Ranking', () => {
    it('indexes documents and returns nearest semantic neighbors in ranked order', () => {
      index.addDocument({
        id: 'doc_crypto',
        text: 'NIST Quantum-Resistant Cryptography and ML-KEM lattice key encapsulation',
        metadata: { category: 'crypto' },
      });

      index.addDocument({
        id: 'doc_social',
        text: 'Local community groups and sovereign neighborhood meetups',
        metadata: { category: 'community' },
      });

      index.addDocument({
        id: 'doc_escrow',
        text: 'P2P escrow marketplace with instant QR scan proof of delivery',
        metadata: { category: 'marketplace' },
      });

      index.addDocument({
        id: 'doc_culinary',
        text: 'Authentic Italian pizza dough with organic sourdough starter',
        metadata: { category: 'food' },
      });

      // Query for cryptographic lattice security
      const resultsCrypto = index.search('quantum safe lattice cryptography', 2);
      expect(resultsCrypto.length).toBeGreaterThanOrEqual(1);
      expect(resultsCrypto[0].id).toBe('doc_crypto');
      expect(resultsCrypto[0].score).toBeGreaterThan(0.3);

      // Query for marketplace escrow
      const resultsMarket = index.search('physical escrow delivery qr code', 2);
      expect(resultsMarket.length).toBeGreaterThanOrEqual(1);
      expect(resultsMarket[0].id).toBe('doc_escrow');
    });
  });

  describe('3. High-Concurrency & Sub-50ms Latency Benchmark', () => {
    it('executes semantic vector queries in under 50ms across large document sets', () => {
      const TOTAL_DOCS = 1000;
      const categories = ['blockchain', 'mesh', 'privacy', 'ai', 'database', 'streaming'];

      for (let i = 0; i < TOTAL_DOCS; i++) {
        const cat = categories[i % categories.length];
        index.addDocument({
          id: `bench_doc_${i}`,
          text: `Document number ${i} covering ${cat} protocols, performance metrics, and distributed nodes.`,
          metadata: { index: i, category: cat },
        });
      }

      expect(index.size()).toBe(TOTAL_DOCS);

      // Measure query latency over 10 consecutive searches
      const searchTimes: number[] = [];
      const queries = [
        'distributed blockchain protocols',
        'privacy and cryptography',
        'streaming media over mesh',
        'high performance database metrics',
        'ai models and quantization',
      ];

      for (const q of queries) {
        const t0 = performance.now();
        const results = index.search(q, 5);
        const elapsed = performance.now() - t0;
        searchTimes.push(elapsed);
        expect(results.length).toBeGreaterThan(0);
      }

      const avgTime = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
      // Latency requirement: sub-50ms (typically < 10ms for in-memory HNSW)
      expect(avgTime).toBeLessThan(50.0);
    });
  });
});
