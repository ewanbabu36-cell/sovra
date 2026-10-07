import { describe, it, expect } from 'vitest';
import { SearchWorker, SearchQuery } from '../src/index.js';

describe('@sovra/search', () => {
  it('indexes and searches profiles, posts, and hashtags', async () => {
    const worker = new SearchWorker();

    worker.indexProfile({
      did: 'did:sovra:alice_mesh',
      handle: 'alice_creator',
      displayName: 'Alice Decentralized',
      bio: 'P2P mesh routing expert building on Sovra #p2p #identity',
    });

    worker.indexPost({
      id: 'post-101',
      authorDid: 'did:sovra:alice_mesh',
      caption: 'Testing Merkle DAG ingestion with spatial audio! #sovra #audio',
      tags: ['#sovra', '#audio'],
    });

    worker.indexChannel({
      id: 'chan-1',
      handle: '@sovra_tech',
      name: 'Sovra Tech Mesh',
      category: 'technology',
      desc: 'Official decentralized tech announcements',
    });

    // 1. Text search for 'decentralized'
    const res1 = await worker.search({ query: 'decentralized' });
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.value.totalMatches).toBeGreaterThanOrEqual(2);
      expect(res1.value.documents?.some(d => d.title.includes('Alice'))).toBe(true);
    }

    // 2. Hashtag search for '#audio'
    const res2 = await worker.search({ query: '', tags: ['#audio'] });
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.value.totalMatches).toBe(1);
      expect(res2.value.documents?.[0]?.id).toBe('post-101');
    }

    // 3. Prefix matching: 'rout' matches 'routing'
    const res3 = await worker.search({ query: 'rout' });
    expect(res3.ok).toBe(true);
    if (res3.ok) {
      expect(res3.value.totalMatches).toBeGreaterThanOrEqual(1);
    }

    // 4. Filter by document type
    const res4 = await worker.search({ query: 'sovra', type: 'CHANNEL' });
    expect(res4.ok).toBe(true);
    if (res4.ok) {
      expect(res4.value.documents?.every(d => d.type === 'CHANNEL')).toBe(true);
      expect(res4.value.documents?.[0]?.id).toBe('chan-1');
    }
  });

  it('returns SERVICE_UNAVAILABLE error when index is explicitly unavailable', async () => {
    const worker = new SearchWorker();
    worker.setAvailable(false);

    const res = await worker.search({ query: 'identity' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('SERVICE_UNAVAILABLE');
    }
  });
});
