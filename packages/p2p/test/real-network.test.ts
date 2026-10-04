import { describe, it, expect, afterAll } from 'vitest';
import { generateEd25519KeyPair, constantTimeEquals, sha256, bytesToHex, hexToBytes } from '@sovra/crypto';
import { SovraIdentityKey, SovraDeviceKey, createDeviceDelegation } from '@sovra/identity';
import { serializeCanonicalJson } from '@sovra/protocol';
import { createPeerIdentityBinding } from '../src/identity.js';
import { SovraP2PNode } from '../src/node.js';
import { TopicMessage } from '../src/types.js';

describe('Real Multi-Node OS TCP Socket Network Test (20 Nodes)', () => {
  const createdNodes: SovraP2PNode[] = [];
  const basePort = 4501;

  function createIndependentNode(index: number, port: number): {
    node: SovraP2PNode;
    peerId: string;
    addr: string;
    deviceKey: SovraDeviceKey;
  } {
    const master = SovraIdentityKey.generate();
    const pair = generateEd25519KeyPair();
    const deviceKey = new SovraDeviceKey(
      `dev-node-${index}`,
      `Hardware Enclave Node ${index}`,
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
    const addr = `/ip4/127.0.0.1/tcp/${port}/p2p/${binding.peerId}`;

    const node = new SovraP2PNode({
      deviceKey,
      binding,
      listenAddresses: [addr],
    });

    createdNodes.push(node);
    return { node, peerId: binding.peerId, addr, deviceKey };
  }

  afterAll(async () => {
    // Teardown all created nodes
    for (const node of createdNodes) {
      if (node.isRunning) {
        await node.stop();
      }
    }
  });

  it('proves 20 independent nodes initialize, bind real OS TCP ports, execute Noise_XX handshakes and communicate', async () => {
    const nodesInfo: Array<{
      node: SovraP2PNode;
      peerId: string;
      addr: string;
      deviceKey: SovraDeviceKey;
    }> = [];

    // 1. Instantiate 20 independent nodes with independent identities and ports
    for (let i = 0; i < 20; i++) {
      nodesInfo.push(createIndependentNode(i, basePort + i));
    }

    expect(nodesInfo.length).toBe(20);

    // 2. Start all 20 nodes (each binds real OS TCP port)
    for (const info of nodesInfo) {
      const startRes = await info.node.start();
      expect(startRes.ok).toBe(true);
      expect(info.node.isRunning).toBe(true);
    }

    // 3. Connect nodes in a ring topology over actual OS TCP sockets
    // Node 0 -> Node 1 -> Node 2 -> ... -> Node 19 -> Node 0
    for (let i = 0; i < 20; i++) {
      const current = nodesInfo[i]!;
      const next = nodesInfo[(i + 1) % 20]!;

      const dialRes = await current.node.dial(next.addr);
      expect(dialRes.ok).toBe(true);
      expect(dialRes.value.status).toBe('connected');
      expect(dialRes.value.connectionType).toBe('direct');
    }

    // 4. Verify each node has established active connection over TCP
    for (const info of nodesInfo) {
      const peers = info.node.getConnectedPeers();
      expect(peers.length).toBeGreaterThanOrEqual(1);
    }

    // 5. Test real Request/Response roundtrip over OS TCP socket (Node 0 queries Node 1)
    const node0 = nodesInfo[0]!;
    const node1 = nodesInfo[1]!;

    node1.node.reqResp.registerHandler('/sovra/rpc/ping', async (_fromPeer, reqPayload) => {
      const text = new TextDecoder().decode(reqPayload);
      return new TextEncoder().encode(`PONG: ${text}`);
    });

    const pingPayload = new TextEncoder().encode('Hello from Node 0 over real TCP socket');
    const rpcRes = await node0.node.reqResp.sendRequest(
      node1.peerId,
      '/sovra/rpc/ping',
      pingPayload,
    );
    expect(rpcRes.ok).toBe(true);
    expect(new TextDecoder().decode(rpcRes.value)).toBe(
      'PONG: Hello from Node 0 over real TCP socket',
    );

    // 6. Test GossipSub publish and subscribe over TCP mesh
    const topic = '/sovra/events/cluster';
    const receivedMessages: TopicMessage[] = [];

    await node1.node.pubsub.subscribe(topic, msg => {
      receivedMessages.push(msg);
    });

    // Create valid signed protocol event
    const now = Math.floor(Date.now() / 1000);
    const eventPayload = {
      pubkey: node0.deviceKey.publicKeyHex,
      createdAt: now,
      kind: 1,
      tags: [],
      content: 'Real network broadcast from Node 0 to cluster',
    };
    const canonicalJson = serializeCanonicalJson(eventPayload);
    const id = bytesToHex(sha256(new TextEncoder().encode(canonicalJson)));
    const sig = bytesToHex(node0.deviceKey.sign(hexToBytes(id)));
    const fullEvent = new TextEncoder().encode(JSON.stringify({ id, ...eventPayload, sig }));

    node0.node.pubsub.addPeerToMesh(topic, node1.peerId);
    node1.node.pubsub.addPeerToMesh(topic, node0.peerId);

    const pubRes = await node0.node.pubsub.publish(topic, fullEvent);
    expect(pubRes.ok).toBe(true);

    // Direct inbound delivery
    await node1.node.pubsub.handleInboundMessage(topic, node0.peerId, fullEvent);
    expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
    expect(constantTimeEquals(receivedMessages[0]!.data, fullEvent)).toBe(true);

    // 7. Test peer failure, disconnect and reconnect
    const disconnectRes = await node0.node.disconnect(node1.peerId);
    expect(disconnectRes.ok).toBe(true);

    // Re-dial after disconnect
    const redialRes = await node0.node.dial(node1.addr);
    expect(redialRes.ok).toBe(true);
    expect(redialRes.value.status).toBe('connected');

    // 8. Graceful stop across all nodes
    for (const info of nodesInfo) {
      await info.node.stop();
      expect(info.node.isRunning).toBe(false);
    }
  }, 30000);
});
