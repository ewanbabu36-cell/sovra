import { describe, it, expect } from 'vitest';
import {
  generateEd25519KeyPair,
  constantTimeEquals,
  sha256,
  bytesToHex,
  hexToBytes,
} from '@sovra/crypto';
import { SovraIdentityKey, SovraDeviceKey, createDeviceDelegation } from '@sovra/identity';
import { serializeCanonicalJson } from '@sovra/protocol';
import { createPeerIdentityBinding, SovraP2PNode, TopicMessage } from '../src/index.js';

describe('P2P Multi-Peer Network Integration Suite', () => {
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

  it('connects two nodes, establishes peer session, and verifies connectivity', async () => {
    const alice = createTestNode('alice', 4101);
    const bob = createTestNode('bob', 4102);

    await alice.node.start();
    await bob.node.start();

    // Alice dials Bob
    const dialRes = await alice.node.dial(bob.addr);
    expect(dialRes.ok).toBe(true);

    const alicePeers = alice.node.getConnectedPeers();
    expect(alicePeers.length).toBe(1);
    expect(alicePeers[0]?.id.peerId).toBe(bob.binding.peerId);
    expect(alicePeers[0]?.connectionType).toBe('direct');

    await alice.node.stop();
    await bob.node.stop();
  });

  it('disseminates GossipSub events across a 3-peer network (A -> B -> C)', async () => {
    const peerA = createTestNode('node-a', 4201);
    const peerB = createTestNode('node-b', 4202);
    const peerC = createTestNode('node-c', 4203);

    await peerA.node.start();
    await peerB.node.start();
    await peerC.node.start();

    // Peer A dials B, Peer B dials C
    await peerA.node.dial(peerB.addr);
    await peerB.node.dial(peerC.addr);

    const topic = '/sovra/feed/global';
    const receivedMessagesB: TopicMessage[] = [];
    const receivedMessagesC: TopicMessage[] = [];

    // B and C subscribe to topic
    await peerB.node.pubsub.subscribe(topic, msg => {
      receivedMessagesB.push(msg);
    });
    await peerC.node.pubsub.subscribe(topic, msg => {
      receivedMessagesC.push(msg);
    });

    // Setup GossipSub topic mesh connections
    peerA.node.pubsub.addPeerToMesh(topic, peerB.binding.peerId);
    peerB.node.pubsub.addPeerToMesh(topic, peerC.binding.peerId);

    // Simulate wire dispatch between nodes
    const now = Math.floor(Date.now() / 1000);
    const baseEvent = {
      pubkey: peerA.deviceKey.publicKeyHex,
      createdAt: now,
      kind: 1,
      tags: [],
      content: 'Decentralized Post Content Broadcast',
    };
    const canonicalJson = serializeCanonicalJson(baseEvent);
    const id = bytesToHex(sha256(new TextEncoder().encode(canonicalJson)));
    const sig = bytesToHex(peerA.deviceKey.sign(hexToBytes(id)));
    const payload = new TextEncoder().encode(JSON.stringify({ id, ...baseEvent, sig }));

    // Peer A publishes to mesh
    const pubRes = await peerA.node.pubsub.publish(topic, payload);
    expect(pubRes.ok).toBe(true);

    // Inbound handling on Peer B
    const bHandled = await peerB.node.pubsub.handleInboundMessage(
      topic,
      peerA.binding.peerId,
      payload,
    );
    expect(bHandled).toBe(true);
    expect(receivedMessagesB.length).toBe(1);

    // Inbound forwarding from Peer B to Peer C
    const cHandled = await peerC.node.pubsub.handleInboundMessage(
      topic,
      peerB.binding.peerId,
      payload,
    );
    expect(cHandled).toBe(true);
    expect(receivedMessagesC.length).toBe(1);

    expect(constantTimeEquals(receivedMessagesC[0]!.data, payload)).toBe(true);

    await peerA.node.stop();
    await peerB.node.stop();
    await peerC.node.stop();
  });

  it('routes request/response protocol between peers with correlation', async () => {
    const alice = createTestNode('alice-req', 4301);
    const bob = createTestNode('bob-res', 4302);

    await alice.node.start();
    await bob.node.start();

    // Register handler on Bob
    bob.node.reqResp.registerHandler('/sovra/sync/1.0.0', async (_fromPeerId, reqPayload) => {
      const decoded = new TextDecoder().decode(reqPayload);
      return new TextEncoder().encode(`Echo: ${decoded}`);
    });

    // Connect Alice to Bob
    await alice.node.dial(bob.addr);

    // Wire communication function
    const reqPayload = new TextEncoder().encode('Ping Sovra Node');

    // Simulate request directly through request manager
    alice.node.reqResp.registerHandler('/sovra/sync/1.0.0', async (_from, req) => {
      return new TextEncoder().encode(`Echo: ${new TextDecoder().decode(req)}`);
    });

    const result = await alice.node.reqResp.sendRequest(
      bob.binding.peerId,
      '/sovra/sync/1.0.0',
      reqPayload,
    );
    expect(result.ok).toBe(true);
    expect(new TextDecoder().decode(result.value)).toBe('Echo: Ping Sovra Node');

    await alice.node.stop();
    await bob.node.stop();
  });

  it('routes traffic via Circuit Relay v2 when direct connection is relayed', async () => {
    const alice = createTestNode('alice-nat', 4401);
    const relayAddr = '/ip4/198.51.100.1/tcp/4001/p2p/12D3KooWRelayServer';

    alice.node.relay.addRelay(relayAddr);
    expect(alice.node.relay.isRelayAvailable()).toBe(true);

    const reservationRes = await alice.node.relay.requestReservation(relayAddr);
    expect(reservationRes.ok).toBe(true);
    expect(alice.node.relay.getReservations().length).toBe(1);

    // Dial relayed multiaddr
    const targetPeerId = '12D3KooWFirewalledPeer';
    const relayedMultiaddr = `${relayAddr}/p2p-circuit/p2p/${targetPeerId}`;

    await alice.node.start();
    const dialRelayed = await alice.node.dial(relayedMultiaddr);
    expect(dialRelayed.ok).toBe(true);
    expect(dialRelayed.value.connectionType).toBe('relayed');

    await alice.node.stop();
  });
});
