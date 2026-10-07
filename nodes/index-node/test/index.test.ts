import { describe, it, expect } from 'vitest';
import { IndexNodeDaemon, IndexNodeConfig } from '../src/index.js';

describe('@sovra/index-node', () => {
  it('instantiates read-optimized query indexer daemon', async () => {
    const config: IndexNodeConfig = {
      queryListenPort: 8080,
      maxIndexedEvents: 1_000_000,
    };
    const daemon = new IndexNodeDaemon(config);
    expect(daemon.getConfig().queryListenPort).toBe(8080);

    const res = await daemon.start();
    expect(res.ok).toBe(true);
    expect(daemon.isRunning).toBe(true);

    // Index test events
    const evt1 = {
      id: 'evt_1',
      issuerDid: 'did:sovra:alice',
      type: 'POST',
      tags: ['#sovra', '#p2p'],
      timestamp: 1000,
      payload: { text: 'P2P Post' },
    };
    const evt2 = {
      id: 'evt_2',
      issuerDid: 'did:sovra:bob',
      type: 'POST',
      tags: ['#crypto'],
      timestamp: 2000,
      payload: { text: 'Crypto Post' },
    };

    daemon.indexEvent(evt1);
    daemon.indexEvent(evt2);

    expect(daemon.getIndexedCount()).toBe(2);

    // Query by tag
    const tagResults = daemon.queryEvents({ tag: 'sovra' });
    expect(tagResults.length).toBe(1);
    expect(tagResults[0]?.id).toBe('evt_1');

    // Query by issuer
    const issuerResults = daemon.queryEvents({ issuerDid: 'did:sovra:bob' });
    expect(issuerResults.length).toBe(1);
    expect(issuerResults[0]?.id).toBe('evt_2');

    await daemon.stop();
    expect(daemon.isRunning).toBe(false);
  });
});
