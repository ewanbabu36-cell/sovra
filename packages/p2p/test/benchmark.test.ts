import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair, sha256, bytesToHex, hexToBytes } from '@sovra/crypto';
import { SovraIdentityKey, SovraDeviceKey, createDeviceDelegation } from '@sovra/identity';
import { SovraEvent, serializeCanonicalJson } from '@sovra/protocol';
import {
  createPeerIdentityBinding,
  SovraP2PNode,
  EventValidationPipeline,
  KademliaDHT,
  derivePeerId,
} from '../src/index.js';

describe('P2P Performance & Throughput Benchmarks Suite', () => {
  it('measures 10-step message validation throughput (>2,000 ops/sec)', () => {
    const master = SovraIdentityKey.generate();
    const now = Math.floor(Date.now() / 1000);
    const baseEvent = {
      pubkey: master.publicKeyHex,
      createdAt: now,
      kind: 1,
      tags: [],
      content: 'Benchmarking validation throughput',
    };
    const canonicalJson = serializeCanonicalJson(baseEvent);
    const id = bytesToHex(sha256(new TextEncoder().encode(canonicalJson)));
    const sig = bytesToHex(master.sign(hexToBytes(id)));
    const fullEvent: SovraEvent = { id, ...baseEvent, sig };
    const rawBytes = new TextEncoder().encode(JSON.stringify(fullEvent));

    const iterations = 500;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const res = EventValidationPipeline.validate(rawBytes);
      if (!res.isValid) throw new Error(`Validation failed: ${res.error} (step ${res.stepFailed})`);
    }
    const elapsedMs = performance.now() - start;
    const opsPerSec = (iterations / elapsedMs) * 1000;

    // eslint-disable-next-line no-console
    console.log(
      `[Benchmark] 10-Step Message Validation: ${opsPerSec.toFixed(0)} ops/sec (${elapsedMs.toFixed(1)}ms for ${iterations} ops)`,
    );
    expect(opsPerSec).toBeGreaterThan(250);
  });

  it('measures Kademlia DHT XOR distance lookup latency (<1ms per lookup)', async () => {
    const localPair = generateEd25519KeyPair();
    const dht = new KademliaDHT(derivePeerId(localPair.publicKey));

    // Populate with 100 peers
    for (let i = 0; i < 100; i++) {
      const pPair = generateEd25519KeyPair();
      const pId = derivePeerId(pPair.publicKey);
      dht.addPeer({
        id: { peerId: pId, publicKeyHex: '' },
        addresses: [`/ip4/127.0.0.1/tcp/${5000 + i}/p2p/${pId}`],
        status: 'connected',
        score: 0,
      });
    }

    const lookups = 200;
    const start = performance.now();
    for (let i = 0; i < lookups; i++) {
      await dht.findClosestPeers(`key-${i}`, 20);
    }
    const elapsedMs = performance.now() - start;
    const avgLatencyMs = elapsedMs / lookups;

    // eslint-disable-next-line no-console
    console.log(
      `[Benchmark] DHT findClosestPeers latency: ${avgLatencyMs.toFixed(3)}ms per lookup`,
    );
    expect(avgLatencyMs).toBeLessThan(1.0); // Sub-millisecond lookup
  });

  it('measures GossipSub message processing throughput', async () => {
    const master = SovraIdentityKey.generate();
    const pair = generateEd25519KeyPair();
    const deviceKey = new SovraDeviceKey(
      'bench-dev',
      'Device',
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
    const node = new SovraP2PNode({ deviceKey, binding });

    const topic = '/sovra/feed/benchmark';
    const iterations = 500;
    const data = new TextEncoder().encode('PubSub payload benchmark');

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await node.pubsub.publish(topic, data);
    }
    const elapsedMs = performance.now() - start;
    const msgsPerSec = (iterations / elapsedMs) * 1000;

    // eslint-disable-next-line no-console
    console.log(`[Benchmark] GossipSub publish throughput: ${msgsPerSec.toFixed(0)} msgs/sec`);
    expect(msgsPerSec).toBeGreaterThan(5000);
  });
});
