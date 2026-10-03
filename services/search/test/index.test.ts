import { describe, it, expect } from 'vitest';
import { SearchWorker, SearchQuery } from '../src/index.js';

describe('@sovra/search', () => {
  it('instantiates search query worker', async () => {
    const worker = new SearchWorker();
    const query: SearchQuery = {
      query: 'decentralized identity',
      tags: ['identity'],
      limit: 10,
    };

    const res = await worker.search(query);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.totalMatches).toBe(0);
    }
  });
});
