import { describe, it, expect, vi } from 'vitest';
import { generateEd25519KeyPair, sha256, bytesToHex, hexToBytes } from '@sovra/crypto';
import { SovraIdentityKey, SovraDeviceKey, createDeviceDelegation } from '@sovra/identity';
import { serializeCanonicalJson } from '@sovra/protocol';
import { createPeerIdentityBinding, SovraP2PNode } from '../src/index.js';

function createSignedEvent(
  authorKey: SovraDeviceKey,
  content = 'Autonomous P2P broadcast without admin',
): Uint8Array {
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

describe('P2P Company Admin Panel Independence & Anti-Centralization Suite', () => {
  it('operates completely independently when Company Admin Panel and corporate APIs are offline', async () => {
    // Simulate company infrastructure failure: Any attempt to access admin API throws
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Connection refused: https://admin.sovra.internal:8080');
    });

    const masterAlice = SovraIdentityKey.generate();
    const pairAlice = generateEd25519KeyPair();
    const devAlice = new SovraDeviceKey(
      'alice-dev',
      'Laptop',
      masterAlice.did,
      pairAlice.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const delAlice = createDeviceDelegation(
      masterAlice,
      devAlice,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const bindAlice = createPeerIdentityBinding(devAlice, masterAlice.did, delAlice);

    const masterBob = SovraIdentityKey.generate();
    const pairBob = generateEd25519KeyPair();
    const devBob = new SovraDeviceKey(
      'bob-dev',
      'Phone',
      masterBob.did,
      pairBob.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const delBob = createDeviceDelegation(masterBob, devBob, Math.floor(Date.now() / 1000) + 86400);
    const bindBob = createPeerIdentityBinding(devBob, masterBob.did, delBob);

    const aliceNode = new SovraP2PNode({ deviceKey: devAlice, binding: bindAlice });
    const bobNode = new SovraP2PNode({ deviceKey: devBob, binding: bindBob });

    await aliceNode.start();
    await bobNode.start();

    // 1. Peer discovery and direct connection succeeds with admin offline
    const bobAddr = `/ip4/192.168.1.10/tcp/4001/p2p/${bindBob.peerId}`;
    const dialRes = await aliceNode.dial(bobAddr);
    expect(dialRes.ok).toBe(true);

    // 2. GossipSub broadcast succeeds with admin offline
    const topic = '/sovra/feed/global';
    let received = false;
    await bobNode.pubsub.subscribe(topic, () => {
      received = true;
    });
    aliceNode.pubsub.addPeerToMesh(topic, bindBob.peerId);

    const payload = createSignedEvent(devAlice);
    await aliceNode.pubsub.publish(topic, payload);
    const handled = await bobNode.pubsub.handleInboundMessage(topic, bindAlice.peerId, payload);
    expect(handled).toBe(true);
    expect(received).toBe(true);

    // 3. DHT storage succeeds with admin offline
    const dhtRes = await aliceNode.dht.putValue('/sovra/test/key', new Uint8Array([1, 2, 3]));
    expect(dhtRes.ok).toBe(true);

    // 4. Peer scoring functions locally
    expect(aliceNode.scoring.getScore(bindBob.peerId)).toBe(0);
    aliceNode.scoring.onValidMessageDelivery(bindBob.peerId);
    expect(aliceNode.scoring.getScore(bindBob.peerId)).toBeGreaterThan(0);

    await aliceNode.stop();
    await bobNode.stop();
    fetchSpy.mockRestore();
  });

  it('proves no single infrastructure component (Bootstrap A, Relay A, Admin) is a single point of failure', async () => {
    // Scenario: Bootstrap A is offline, Relay A is offline, Admin panel is offline
    const node = new SovraP2PNode({
      deviceKey: new SovraDeviceKey(
        'dev-survivor',
        'Device',
        'did:key:z6MktSurvivor',
        generateEd25519KeyPair().privateKey,
        Math.floor(Date.now() / 1000) + 86400,
      ),
      bootstrapConfig: {
        bootstrapNodes: ['/ip4/198.51.100.1/tcp/4001/p2p/12D3KooWBootstrapOffline'],
        communityNodes: ['/ip4/203.0.113.5/tcp/4001/p2p/12D3KooWCommunityOnline'],
      },
      relayAddresses: [
        '/ip4/198.51.100.2/tcp/4001/p2p/12D3KooWRelayOffline',
        '/ip4/203.0.113.6/tcp/4001/p2p/12D3KooWRelayOnline',
      ],
    });

    await node.start();

    // Secondary bootstrap candidate is available
    const bootstraps = node.dht.getOrderedBootstrapCandidates();
    expect(bootstraps).toContain('/ip4/203.0.113.5/tcp/4001/p2p/12D3KooWCommunityOnline');

    // Secondary relay is active and usable
    node.relay.removeRelay('/ip4/198.51.100.2/tcp/4001/p2p/12D3KooWRelayOffline');
    expect(node.relay.isRelayAvailable()).toBe(true);
    expect(node.relay.getActiveRelays()).toContain(
      '/ip4/203.0.113.6/tcp/4001/p2p/12D3KooWRelayOnline',
    );

    await node.stop();
  });
});
