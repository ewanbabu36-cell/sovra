import { describe, it, expect } from 'vitest';
import { StorageNodeDaemon, StorageNodeConfig } from '../src/index.js';

describe('@sovra/storage-node', () => {
  it('instantiates storage pinning provider daemon', async () => {
    const config: StorageNodeConfig = {
      storagePath: '/data/ipfs',
      maxCapacityBytes: 107374182400n, // 100 GB
      enableBitswap: true,
    };
    const daemon = new StorageNodeDaemon(config);
    expect(daemon.getConfig().enableBitswap).toBe(true);

    const res = await daemon.start();
    expect(res.ok).toBe(true);
  });
});
