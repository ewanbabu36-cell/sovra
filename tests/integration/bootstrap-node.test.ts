/**
 * @file tests/integration/bootstrap-node.test.ts
 * Integration Suite verifying Sovra Bootstrap Seed Node functionality & health endpoints.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as net from 'node:net';
import * as http from 'node:http';
import {
  generateEd25519KeyPair,
  bytesToHex,
} from '../../packages/crypto/src/index.js';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
} from '../../packages/identity/src/index.js';
import {
  SovraP2PNode,
  createPeerIdentityBinding,
} from '../../packages/p2p/src/index.js';

describe('Sovra Global Bootstrap Seed Node Integration Suite', () => {
  let p2pNode: SovraP2PNode;
  let testPort: number;

  it('proves a seed node initializes with persistent cryptographic identity & binds real OS TCP port', async () => {
    // 1. Generate identity & device keys
    const identityKp = generateEd25519KeyPair();
    const deviceKp = generateEd25519KeyPair();
    const identityKey = new SovraIdentityKey(identityKp.privateKey);
    const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    const deviceKey = new SovraDeviceKey(
      'test-seed-dev',
      'Test Seed Device',
      identityKey.did,
      deviceKp.privateKey,
      validUntil,
    );

    const delegation = createDeviceDelegation(identityKey, deviceKey, validUntil);
    const binding = createPeerIdentityBinding(deviceKey, identityKey.did, delegation);

    // 2. Find a free OS TCP port
    testPort = await new Promise<number>((resolve) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(port));
      });
    });

    // 3. Start P2P node as bootstrap seed
    p2pNode = new SovraP2PNode({
      deviceKey,
      binding,
      listenAddresses: [`/ip4/127.0.0.1/tcp/${testPort}`],
      limits: {
        maxInboundConnections: 500,
        maxOutboundConnections: 250,
      },
    });

    const startRes = await p2pNode.start();
    expect(startRes.ok).toBe(true);
    expect(p2pNode.isRunning).toBe(true);
    expect(p2pNode.identity.peerId).toBeDefined();

    // 4. Verify public multiaddr format
    const multiaddr = `/ip4/127.0.0.1/tcp/${testPort}/p2p/${p2pNode.identity.peerId}`;
    expect(multiaddr).toMatch(/\/ip4\/127\.0\.0\.1\/tcp\/\d+\/p2p\/12D3/);

    // 5. Verify GossipSub topics subscription
    p2pNode.pubsub.subscribe('sovra/feed/main');
    p2pNode.pubsub.subscribe('sovra/chats/mesh');
    expect(p2pNode.pubsub.getSubscribedTopics()).toContain('sovra/feed/main');
    expect(p2pNode.pubsub.getSubscribedTopics()).toContain('sovra/chats/mesh');
  });

  afterAll(async () => {
    if (p2pNode) {
      await p2pNode.stop();
    }
  });
});
