import { describe, it, expect } from 'vitest';
import { FullNodeDaemon, FullNodeConfig } from '../src/index.js';

describe('@sovra/full-node', () => {
  it('instantiates full node daemon with multiaddr config', async () => {
    const config: FullNodeConfig = {
      listenAddresses: ['/ip4/0.0.0.0/tcp/4001'],
      bootstrapNodes: ['/ip4/198.51.100.1/tcp/4001/p2p/QmTestBootstrap'],
      enableDht: true,
      enableRelayClient: true,
    };
    const daemon = new FullNodeDaemon(config);
    expect(daemon.getConfig().enableDht).toBe(true);

    const startResult = await daemon.start();
    expect(startResult.ok).toBe(true);
  });
});
