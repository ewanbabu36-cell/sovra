import { describe, it, expect } from 'vitest';
import { SovraDeviceKey } from '@sovra/identity';
import {
  SovraLightClient,
  CircuitRelayV2,
  NatManager,
  StunProbeResult,
} from '../src/index.js';

describe('Milestone 2: Mobile Light Client & NAT Traversal Engine', () => {
  describe('NatManager & STUN NAT Detection', () => {
    it('detects direct connection when observed address matches local listening address', () => {
      const nat = new NatManager(['/ip4/203.0.113.5/tcp/4001']);
      const probes: StunProbeResult[] = [
        { serverAddr: 'stun1.sovra.net', observedIp: '203.0.113.5', observedPort: 4001 },
      ];
      const status = nat.evaluateStunProbes(probes, 4001);
      expect(status).toBe('direct');
      expect(nat.status).toBe('direct');
    });

    it('detects Cone NAT (hole-punchable) when external port is preserved across probes', () => {
      const nat = new NatManager(['/ip4/192.168.1.50/tcp/4001']);
      const probes: StunProbeResult[] = [
        { serverAddr: 'stun1.sovra.net', observedIp: '198.51.100.22', observedPort: 54321 },
        { serverAddr: 'stun2.sovra.net', observedIp: '198.51.100.22', observedPort: 54321 },
      ];
      const status = nat.evaluateStunProbes(probes, 4001);
      expect(status).toBe('cone_nat');
      expect(nat.status).toBe('cone_nat');
    });

    it('detects Symmetric NAT (requires relay) when external port changes across destinations', () => {
      const nat = new NatManager(['/ip4/10.0.0.4/tcp/4001']);
      const probes: StunProbeResult[] = [
        { serverAddr: 'stun1.sovra.net', observedIp: '198.51.100.22', observedPort: 54321 },
        { serverAddr: 'stun2.sovra.net', observedIp: '198.51.100.22', observedPort: 58999 },
      ];
      const status = nat.evaluateStunProbes(probes, 4001);
      expect(status).toBe('symmetric_nat');
      expect(nat.status).toBe('symmetric_nat');
    });
  });

  describe('CircuitRelayV2 with Quotas & Token Bucket', () => {
    it('creates reservations, tracks relayed chunks, and enforces byte quotas', () => {
      const relay = new CircuitRelayV2({
        maxConcurrentCircuits: 10,
        defaultMaxBytesPerCircuit: 1024, // 1KB limit for test
        defaultMaxDurationSeconds: 60,
      });

      const res = relay.createCircuit('peer-client-1', 'peer-target-1');
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const circuit = res.value;
      expect(circuit.status).toBe('active');
      expect(circuit.maxBytes).toBe(1024);

      // Relay 500 bytes
      const chunk1 = relay.relayChunk(circuit.circuitId, 500);
      expect(chunk1.ok).toBe(true);
      if (!chunk1.ok) return;
      expect(chunk1.value.bytesRelayed).toBe(500);
      expect(chunk1.value.remainingBytes).toBe(524);

      // Attempting to relay another 600 bytes should exceed the 1024 limit
      const chunk2 = relay.relayChunk(circuit.circuitId, 600);
      expect(chunk2.ok).toBe(false);
      expect(relay.getCircuit(circuit.circuitId)?.status).toBe('quota_exceeded');

      const metrics = relay.getMetrics();
      expect(metrics.totalBytesRelayed).toBe(500);
      expect(metrics.quotaExceededCount).toBe(1);
    });

    it('enforces concurrent circuit limits to prevent DDoS attacks', () => {
      const relay = new CircuitRelayV2({
        maxConcurrentCircuits: 2,
      });

      const c1 = relay.createCircuit('peer-1', 'target-1');
      const c2 = relay.createCircuit('peer-2', 'target-2');
      const c3 = relay.createCircuit('peer-3', 'target-3');

      expect(c1.ok).toBe(true);
      expect(c2.ok).toBe(true);
      expect(c3.ok).toBe(false);
      if (!c3.ok) {
        expect(c3.error.message).toContain('Circuit Relay limit reached');
      }
      expect(relay.getMetrics().rejectedCount).toBe(1);
    });
  });

  describe('SovraLightClient Lifecycle & Transient Sync', () => {
    const createTestDeviceKey = () =>
      SovraDeviceKey.generate('dev-1', 'mobile-phone', 'did:sovra:tester123', Math.floor(Date.now() / 1000) + 3600);

    it('initializes in sleeping mode with zero routing overhead', () => {
      const deviceKey = createTestDeviceKey();
      const client = new SovraLightClient({
        deviceKey,
        preferredRelayMultiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay1'],
      });

      expect(client.isLightClient).toBe(true);
      expect(client.state).toBe('sleeping');
      expect(client.identity.peerId).toBeDefined();

      const metrics = client.getMetrics();
      expect(metrics.totalSyncs).toBe(0);
      expect(metrics.totalBytesTransferred).toBe(0);
      expect(metrics.activeState).toBe('sleeping');
    });

    it('runs ephemeral sync session and immediately returns to deep sleep', async () => {
      const deviceKey = createTestDeviceKey();
      let syncCalled = false;

      const client = new SovraLightClient({
        deviceKey,
        preferredRelayMultiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay1'],
        syncTransportFn: async (_addr, _options) => {
          syncCalled = true;
          return {
            events: [],
            bytesTransferred: 512,
          };
        },
      });

      const res = await client.syncSession();
      expect(res.ok).toBe(true);
      expect(syncCalled).toBe(true);
      if (!res.ok) return;
      expect(res.value.bytesReceived).toBe(512);

      // Must have automatically returned to deep sleep
      expect(client.state).toBe('sleeping');

      const metrics = client.getMetrics();
      expect(metrics.totalSyncs).toBe(1);
      expect(metrics.totalBytesTransferred).toBe(512);
      expect(metrics.activeState).toBe('sleeping');
    });

    it('handles blind push wake-up notification and returns to deep sleep', async () => {
      const deviceKey = createTestDeviceKey();
      const client = new SovraLightClient({
        deviceKey,
        preferredRelayMultiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay1'],
      });

      const wakeupRes = await client.handleWakeup({
        channelId: 'chan-123',
        eventHint: 'new_signed_post',
        timestamp: Date.now() - 5000,
      });

      expect(wakeupRes.ok).toBe(true);
      expect(client.state).toBe('sleeping');
      expect(client.getMetrics().totalSyncs).toBe(1);
    });
  });
});
