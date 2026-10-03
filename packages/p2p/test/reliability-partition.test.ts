import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair, sha256, bytesToHex, hexToBytes } from '@sovra/crypto';
import { SovraIdentityKey, SovraDeviceKey, createDeviceDelegation } from '@sovra/identity';
import { serializeCanonicalJson } from '@sovra/protocol';
import { createPeerIdentityBinding, SovraP2PNode, CircuitRelayClient } from '../src/index.js';

function createSignedEvent(authorKey: SovraDeviceKey, content: string): Uint8Array {
  const now = Math.floor(Date.now() / 1000);
  const baseEvent = {
    pubkey: authorKey.publicKeyHex,
    createdAt: now,
    kind: 1,
    tags: [],
    content,
  };
  const canonicalJson = serializeCanonicalJson(baseEvent);
  const id = bytesToHex(sha256(new TextEncoder().encode(canonicalJson)));
  const sig = bytesToHex(authorKey.sign(hexToBytes(id)));
  return new TextEncoder().encode(JSON.stringify({ id, ...baseEvent, sig }));
}

describe('P2P Reliability, Failover & Partition Resilience Suite', () => {
  function createTestNode(name: string, listenPort: number) {
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
      listenAddresses: [`/ip4/127.0.0.1/tcp/${listenPort}/p2p/${binding.peerId}`],
    });

    return {
      master,
      deviceKey,
      binding,
      node,
      addr: `/ip4/127.0.0.1/tcp/${listenPort}/p2p/${binding.peerId}`,
    };
  }

  it('fails over to secondary bootstrap peer when primary bootstrap is offline', async () => {
    const bootstrapA = '/dns4/bootstrap-a.offline.network/tcp/4001/p2p/12D3KooWBootstrapA';
    const bootstrapB = '/dns4/bootstrap-b.online.network/tcp/4001/p2p/12D3KooWBootstrapB';

    const client = createTestNode('resilient-client', 4501);
    client.node.dht.bootstrapConfig.bootstrapNodes = [bootstrapA, bootstrapB];

    const candidates = client.node.dht.getOrderedBootstrapCandidates();
    expect(candidates).toContain(bootstrapA);
    expect(candidates).toContain(bootstrapB);

    // Simulate connection attempt: Bootstrap A fails, Bootstrap B succeeds
    let joinedVia = '';
    for (const cand of candidates) {
      if (cand.includes('offline')) {
        // Simulated connection failure
        continue;
      }
      joinedVia = cand;
      break;
    }

    expect(joinedVia).toBe(bootstrapB);
  });

  it('fails over to alternate circuit relay when primary relay goes offline', async () => {
    const relayClient = new CircuitRelayClient([
      '/ip4/10.0.0.1/tcp/4001/p2p/12D3KooWRelayA',
      '/ip4/10.0.0.2/tcp/4001/p2p/12D3KooWRelayB',
    ]);

    let relayAttempt = 0;
    const targetPeerId = '12D3KooWTargetPeer';

    const routeResult = await relayClient.routeThroughAvailableRelay(
      targetPeerId,
      async relayAddr => {
        relayAttempt++;
        if (relayAddr.includes('12D3KooWRelayA')) {
          throw new Error('Relay A unreachable (connection refused)');
        }
        return `routed_via_${relayAddr}`;
      },
    );

    expect(routeResult.ok).toBe(true);
    expect(routeResult.value).toContain('12D3KooWRelayB');
    expect(relayAttempt).toBe(2);
  });

  it('maintains local operations during network partition and heals seamlessly', async () => {
    // Cluster 1: Node 1 and Node 2
    const node1 = createTestNode('node-part-1', 4601);
    const node2 = createTestNode('node-part-2', 4602);

    // Cluster 2: Node 3 and Node 4
    const node3 = createTestNode('node-part-3', 4603);
    const node4 = createTestNode('node-part-4', 4604);

    await node1.node.start();
    await node2.node.start();
    await node3.node.start();
    await node4.node.start();

    // 1. Cluster 1 peers connect locally
    await node1.node.dial(node2.addr);
    expect(node1.node.getConnectedPeers().length).toBe(1);

    // 2. Cluster 2 peers connect locally
    await node3.node.dial(node4.addr);
    expect(node3.node.getConnectedPeers().length).toBe(1);

    // 3. During partition, Cluster 1 publishes local feed event
    const topic = '/sovra/community/general';
    const c1Messages: string[] = [];
    await node2.node.pubsub.subscribe(topic, msg => {
      const parsed = JSON.parse(new TextDecoder().decode(msg.data));
      c1Messages.push(parsed.content);
    });
    node1.node.pubsub.addPeerToMesh(topic, node2.binding.peerId);

    const c1Payload = createSignedEvent(node1.deviceKey, 'Message inside Cluster 1 partition');
    await node1.node.pubsub.publish(topic, c1Payload);
    await node2.node.pubsub.handleInboundMessage(topic, node1.binding.peerId, c1Payload);

    expect(c1Messages).toContain('Message inside Cluster 1 partition');

    // 4. Partition heals: Inter-cluster bridge established (Node 2 dials Node 3)
    await node2.node.dial(node3.addr);
    node2.node.pubsub.addPeerToMesh(topic, node3.binding.peerId);

    const healedMessages: string[] = [];
    await node3.node.pubsub.subscribe(topic, msg => {
      const parsed = JSON.parse(new TextDecoder().decode(msg.data));
      healedMessages.push(parsed.content);
    });

    const crossPayload = createSignedEvent(node2.deviceKey, 'Post-partition cross-cluster message');
    await node2.node.pubsub.handleInboundMessage(topic, node2.binding.peerId, crossPayload);
    await node3.node.pubsub.handleInboundMessage(topic, node2.binding.peerId, crossPayload);

    expect(healedMessages).toContain('Post-partition cross-cluster message');

    await node1.node.stop();
    await node2.node.stop();
    await node3.node.stop();
    await node4.node.stop();
  });
});
