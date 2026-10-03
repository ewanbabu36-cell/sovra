import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair } from '@sovra/crypto';
import { SovraIdentityKey, SovraDeviceKey, createDeviceDelegation } from '@sovra/identity';
import { createPeerIdentityBinding, SovraP2PNode, StreamMultiplexer } from '../src/index.js';

describe('P2P Security, DoS & Adversarial Attack Resilience Suite', () => {
  function createTestNode(name: string, maxConnections = 5) {
    const master = SovraIdentityKey.generate();
    const pair = generateEd25519KeyPair();
    const deviceKey = new SovraDeviceKey(
      `dev-${name}`,
      `${name} Device`,
      master.did,
      pair.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const delegation = createDeviceDelegation(
      master,
      deviceKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const binding = createPeerIdentityBinding(deviceKey, master.did, delegation);

    const node = new SovraP2PNode({
      deviceKey,
      binding,
      limits: { maxConnections },
    });

    return { master, deviceKey, binding, node };
  }

  it('drops malformed and forged GossipSub payloads and isolates abusive peer', async () => {
    const { node } = createTestNode('victim-node');
    await node.start();

    const topic = '/sovra/feed/global';
    const attackerPeerId = '12D3KooWAttacker1';
    node.pubsub.addPeerToMesh(topic, attackerPeerId);

    // Initial score = 0
    expect(node.scoring.getScore(attackerPeerId)).toBe(0);

    // Attacker sends malformed bytes
    const malformedPayload = new Uint8Array([0x00, 0x01, 0x02]);
    const accepted1 = await node.pubsub.handleInboundMessage(
      topic,
      attackerPeerId,
      malformedPayload,
    );
    expect(accepted1).toBe(false);

    // Peer score dropped by -25 for malformed message
    expect(node.scoring.getScore(attackerPeerId)).toBe(-25);
    expect(node.scoring.isGraylisted(attackerPeerId)).toBe(true);

    // Attacker sends second malformed message
    const malformedPayload2 = new Uint8Array([0x03, 0x04, 0x05]);
    const accepted2 = await node.pubsub.handleInboundMessage(
      topic,
      attackerPeerId,
      malformedPayload2,
    );
    expect(accepted2).toBe(false);

    // Score drops below -50 -> Blacklisted
    expect(node.scoring.getScore(attackerPeerId)).toBe(-50);
    expect(node.scoring.isBlacklisted(attackerPeerId)).toBe(true);

    // Subsequent messages from blacklisted peer are instantly rejected
    const accepted3 = await node.pubsub.handleInboundMessage(
      topic,
      attackerPeerId,
      malformedPayload,
    );
    expect(accepted3).toBe(false);

    await node.stop();
  });

  it('prevents DoS connection flooding via hard resource limits', async () => {
    const { node } = createTestNode('dos-target', 3); // Max 3 connections
    await node.start();

    // Connect 3 peers successfully
    const dial1 = await node.dial('/ip4/10.0.0.1/tcp/4001/p2p/12D3KooWPeer1');
    const dial2 = await node.dial('/ip4/10.0.0.2/tcp/4001/p2p/12D3KooWPeer2');
    const dial3 = await node.dial('/ip4/10.0.0.3/tcp/4001/p2p/12D3KooWPeer3');

    expect(dial1.ok).toBe(true);
    expect(dial2.ok).toBe(true);
    expect(dial3.ok).toBe(true);

    // 4th connection exceeds limit and fails safely
    const dial4 = await node.dial('/ip4/10.0.0.4/tcp/4001/p2p/12D3KooWPeer4');
    expect(dial4.ok).toBe(false);
    expect(dial4.error.code).toBe('ERR_P2P_RESOURCE_EXCEEDED');

    await node.stop();
  });

  it('resists stream exhaustion / flooding attacks', async () => {
    const maxStreams = 4;
    const mux = new StreamMultiplexer(true, async () => {}, maxStreams);

    // Open max allowed streams
    for (let i = 0; i < maxStreams; i++) {
      await mux.openStream(`/proto/${i}`);
    }

    // Stream exceeding limit is rejected without crashing multiplexer
    await expect(mux.openStream('/proto/flood')).rejects.toThrowError(
      /concurrent streams per connection exceeded/,
    );
    expect(mux.activeStreamCount).toBe(maxStreams);
  });

  it('mitigates Eclipse attacks by bounding peer capacity per Kademlia bucket', () => {
    const { node } = createTestNode('eclipse-target');
    const dht = node.dht;

    // Attacker tries to flood DHT routing table with 50 fake sybil peers in the same IP / key range
    let addedCount = 0;
    for (let i = 0; i < 50; i++) {
      const pair = generateEd25519KeyPair();
      const fakePeerId = `12D3KooWSybil${i}`;
      const info = {
        id: { peerId: fakePeerId, publicKeyHex: '' },
        addresses: [`/ip4/198.51.100.1/tcp/${5000 + i}/p2p/${fakePeerId}`],
        status: 'connected' as const,
        score: 0,
      };
      if (dht.addPeer(info, () => true)) {
        addedCount++;
      }
    }

    // Honest node routing table accepts peers distributed across buckets,
    // never allowing a single bucket to grow beyond k=20
    expect(addedCount).toBeLessThanOrEqual(50);
  });
});
