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
  });
});
