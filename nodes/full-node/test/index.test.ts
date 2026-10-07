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

    // Verify storage blockstore
    expect(daemon.getBlockstore()).toBeDefined();

    // Verify pubsub operation handling
    let receivedOp: any = null;
    daemon.onOperation((op) => {
      receivedOp = op;
    });

    const testOp = {
      eventId: 'evt_12345',
      issuerDid: 'did:sovra:test_issuer',
      deviceId: 'dev_1',
      operationType: 'FEED_POST_CREATE' as const,
      payload: { text: 'Test' },
      nonce: 'n_1',
      timestamp: Date.now(),
      signature: 'ed_sig_mock',
    };

    const pubRes = await daemon.publishOperation(testOp);
    expect(pubRes.ok).toBe(true);

    await daemon.stop();
    expect(daemon.isRunning).toBe(false);
  });
});
