import { describe, it, expect } from 'vitest';
import { SovraDeviceKey } from '@sovra/identity';
import {
  SovraLightClient,
  calculateNodeHealthScore,
  SessionMigrationToken,
} from '../src/index.js';

describe('Pillars 1 & 10: Dynamic Sync Budgeting, Session Migration & Node Health SLA', () => {
  it('computes dynamic sync budget adapting to battery and network conditions', () => {
    const key = SovraDeviceKey.generate('dev-1', 'phone', 'did:sovra:alice', Math.floor(Date.now() / 1000) + 3600);
    const client = new SovraLightClient({ deviceKey: key });

    // High battery + Wi-Fi -> Full Sync
    const fullBudget = client.computeSyncBudget({
      batteryPercent: 85,
      networkType: 'wifi',
    });
    expect(fullBudget.priorityMode).toBe('full');
    expect(fullBudget.maxEvents).toBe(100);

    // Medium battery + unmetered cellular -> Lean Sync
    const leanBudget = client.computeSyncBudget({
      batteryPercent: 40,
      networkType: 'cellular_unmetered',
    });
    expect(leanBudget.priorityMode).toBe('lean');
    expect(leanBudget.maxEvents).toBe(25);

    // Low battery or metered -> Critical Sync
    const critBudget = client.computeSyncBudget({
      batteryPercent: 12,
      networkType: 'cellular_metered',
    });
    expect(critBudget.priorityMode).toBe('critical');
    expect(critBudget.maxEvents).toBe(5);
  });

  it('implements Dynamic Sync Budget Scaling Equation: Sync Budget (MB) = Base Quota * (Battery / 100) * M_network * M_thermal and 3% cap', async () => {
    const { DynamicSyncBudgetCalculator } = await import('../src/index.js');

    // 1. Wi-Fi (M_network = 1.0), Battery = 80%, Thermal = Normal (M_thermal = 1.0)
    // Budget = 10 * (80/100) * 1.0 * 1.0 = 8.0 MB
    const wifiBudget = DynamicSyncBudgetCalculator.calculateBudgetMB({
      baseQuotaMB: 10,
      batteryLevel: 80,
      networkType: 'wifi',
      thermalState: 'normal',
    });
    expect(wifiBudget).toBe(8.0);

    // 2. Unmetered 5G (M_network = 0.40), Battery = 80%, Thermal = Normal (M_thermal = 1.0)
    // Budget = 10 * 0.8 * 0.40 * 1.0 = 3.2 MB
    const fiveGBudget = DynamicSyncBudgetCalculator.calculateBudgetMB({
      baseQuotaMB: 10,
      batteryLevel: 80,
      networkType: 'cellular_unmetered',
      thermalState: 'normal',
    });
    expect(fiveGBudget).toBe(3.2);

    // 3. Metered Cellular (M_network = 0.15), Battery = 80%, Thermal = Normal
    // Budget = 10 * 0.8 * 0.15 * 1.0 = 1.2 MB
    const meteredBudget = DynamicSyncBudgetCalculator.calculateBudgetMB({
      baseQuotaMB: 10,
      batteryLevel: 80,
      networkType: 'cellular_metered',
      thermalState: 'normal',
    });
    expect(meteredBudget).toBe(1.2);

    // 4. Metered Cellular (M_network = 0.15), Battery = 80%, Thermal = Throttled (M_thermal = 0.10)
    // Budget = 10 * 0.8 * 0.15 * 0.10 = 0.12 MB
    const throttledBudget = DynamicSyncBudgetCalculator.calculateBudgetMB({
      baseQuotaMB: 10,
      batteryLevel: 80,
      networkType: 'cellular_metered',
      thermalState: 'throttled',
    });
    expect(throttledBudget).toBe(0.12);

    // 5. Cellular Data Allowance Cap: Max 3% of daily cellular allowance for background sync
    // 100 MB daily allowance -> 3 MB daily background quota
    // If 2.5 MB already used today -> only 0.5 MB remaining
    const cappedBudget = DynamicSyncBudgetCalculator.calculateBudgetMB({
      baseQuotaMB: 10,
      batteryLevel: 80,
      networkType: 'cellular_unmetered', // would normally be 3.2 MB
      thermalState: 'normal',
      dailyCellularAllowanceBytes: 100 * 1024 * 1024,
      dailyBackgroundBytesUsed: 2.5 * 1024 * 1024,
    });
    expect(cappedBudget).toBe(0.5); // Capped to 0.5 MB
  });

  it('migrates UDP QUIC sessions across cellular/Wi-Fi handoffs in <= 30ms without re-handshaking', () => {
    const key = SovraDeviceKey.generate('dev-1', 'phone', 'did:sovra:alice', Math.floor(Date.now() / 1000) + 3600);
    const client = new SovraLightClient({ deviceKey: key });

    const token: SessionMigrationToken = {
      sessionId: 'quic-sess-999',
      peerId: client.identity.peerId,
      connectionTokenHex: 'abcd1234ef567890',
      connectionIdHex: 'quic_cid_0011223344',
      transport: 'quic',
      issuedAt: Date.now() - 5000,
      sourceAddress: '/ip4/192.168.1.10/udp/4001/quic-v1',
    };

    const res = client.migrateConnection(token, '/ip4/198.51.100.5/udp/4001/quic-v1', 30);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.migrated).toBe(true);
      expect(res.value.migrationLatencyMs).toBeLessThanOrEqual(30);
    }

    // Expired token must be rejected
    const expiredToken: SessionMigrationToken = {
      ...token,
      issuedAt: Date.now() - 600000, // 10 minutes ago
    };
    const expiredRes = client.migrateConnection(expiredToken, '/ip4/1.2.3.4/udp/4001/quic-v1');
    expect(expiredRes.ok).toBe(false);
  });

  it('evaluates node health SLA score on a 0-100 scale', () => {
    // Excellent node (99% uptime, reliable delivery, low latency)
    const highScore = calculateNodeHealthScore({
      uptimeRatio: 0.99,
      successfulBytesRelayed: 1024 * 100,
      totalRequestsCount: 100,
      avgLatencyMs: 25,
    });
    expect(highScore).toBeGreaterThanOrEqual(80);

    // Poor node (low uptime, high latency)
    const lowScore = calculateNodeHealthScore({
      uptimeRatio: 0.30,
      successfulBytesRelayed: 1024,
      totalRequestsCount: 50,
      avgLatencyMs: 300,
    });
    expect(lowScore).toBeLessThan(50);
  });

  it('evaluates ICE connection tiers and calculates dynamic relay scores', async () => {
    const { IceFallbackEngine, calculateDynamicRelayScore } = await import('../src/index.js');
    const engine = new IceFallbackEngine();

    // Direct IPv6 candidate bypasses NAT traversal completely
    const planIPv6 = engine.planConnection('cone_nat', 'symmetric_nat', [
      '2001:db8::1:4001',
      '192.168.1.50:4001',
    ]);
    expect(planIPv6.selectedTier).toBe('tier1_ipv6_direct');
    expect(planIPv6.endpointAddress).toBe('2001:db8::1:4001');

    // Cone-to-Cone -> Tier 2 UDP hole punch
    const planCone = engine.planConnection('cone_nat', 'cone_nat', ['198.51.100.2:4001']);
    expect(planCone.selectedTier).toBe('tier2_udp_hole_punch');

    // Symmetric-to-Symmetric deadlock -> Tier 4 Relay fallback with highest score
    const relay1 = {
      relayAddress: 'relay-fast.sovra.net:4001',
      rttMs: 30,
      packetLossRate: 0.01,
      bandwidthCapacityMbps: 1000,
    };
    const relay2 = {
      relayAddress: 'relay-slow.sovra.net:4001',
      rttMs: 150,
      packetLossRate: 0.1,
      bandwidthCapacityMbps: 100,
    };

    const score1 = calculateDynamicRelayScore(relay1);
    const score2 = calculateDynamicRelayScore(relay2);
    expect(score1).toBeGreaterThan(score2);

    const planDeadlock = engine.planConnection(
      'symmetric_nat',
      'symmetric_nat',
      ['10.0.0.1:4001'],
      [relay2, relay1],
    );
    expect(planDeadlock.selectedTier).toBe('tier4_relay_fallback');
    expect(planDeadlock.endpointAddress).toBe('relay-fast.sovra.net:4001');

    // Cone-to-Symmetric -> Tier 3 Port Prediction with Birthday paradox heuristic
    const planTier3 = engine.planConnection('cone_nat', 'symmetric_nat', ['198.51.100.2:4001']);
    expect(planTier3.selectedTier).toBe('tier3_port_prediction');
    expect(planTier3.predictedPorts).toBeDefined();
    expect(planTier3.predictedPorts?.length).toBe(32);
  });

  it('predicts ports using Birthday paradox heuristic and manages incentivized bandwidth receipts', async () => {
    const { PortPredictionEngine, CommunityIncentivizedRelayProtocol, IceFallbackEngine } =
      await import('../src/index.js');
    const { generateEd25519KeyPair, signEd25519, bytesToHex } = await import('@sovra/crypto');

    // 1. Birthday Paradox Port Prediction Heuristic
    // Pool = 1024, probes = 32 -> P ≈ 1 - exp(-32^2 / (2 * 1024)) = 1 - exp(-0.5) ≈ 0.393 (39.3%)
    const prediction = PortPredictionEngine.predictSymmetricPorts(50000, 32, 1024);
    expect(prediction.basePort).toBe(50000);
    expect(prediction.predictedPorts.length).toBe(32);
    expect(prediction.estimatedCollisionProbability).toBeCloseTo(0.393, 2);

    // 2. Community Incentivized Relay Bandwidth Receipts
    const clientKey = generateEd25519KeyPair();
    const clientPubHex = bytesToHex(clientKey.publicKey);

    const alloc = CommunityIncentivizedRelayProtocol.createAllocation(
      'turn-relay.sovra.net:3478',
      'peer-client-123',
    );
    expect(alloc.allocationId).toBeDefined();
    expect(alloc.expiresAt).toBeGreaterThan(Date.now());

    const receipt = CommunityIncentivizedRelayProtocol.createBandwidthReceipt(
      'peer-relay-999',
      'peer-client-123',
      1024 * 1024 * 50, // 50 MB
      'zk_turn_token_abc',
      msg => signEd25519(clientKey.privateKey, msg),
    );
    expect(receipt.bytesRelayed).toBe(1024 * 1024 * 50);

    const isValid = CommunityIncentivizedRelayProtocol.verifyBandwidthReceipt(receipt, clientPubHex);
    expect(isValid).toBe(true);

    // Tampered receipt must be rejected
    const tamperedReceipt = { ...receipt, bytesRelayed: 1024 * 1024 * 500 };
    expect(
      CommunityIncentivizedRelayProtocol.verifyBandwidthReceipt(tamperedReceipt, clientPubHex),
    ).toBe(false);

    // 3. Adaptive Negotiation Timeout: Base RTT + 3 * sigma_rtt (converges between 120ms and 450ms)
    // Low RTT (30ms + 3 * 10ms = 60ms -> clamped to 120ms minimum)
    expect(IceFallbackEngine.calculateDynamicTimeout(30, 10)).toBe(120);

    // Moderate RTT (80ms + 3 * 30ms = 170ms)
    expect(IceFallbackEngine.calculateDynamicTimeout(80, 30)).toBe(170);

    // High RTT / Jitter (300ms + 3 * 60ms = 480ms -> clamped to 450ms maximum)
    expect(IceFallbackEngine.calculateDynamicTimeout(300, 60)).toBe(450);
  });

  it('processes blind ephemeral push signaling with sub-1.5s lifecycle', async () => {
    const { EphemeralPushSignalingProtocol } = await import('../src/index.js');
    const key = SovraDeviceKey.generate('dev-1', 'phone', 'did:sovra:alice', Math.floor(Date.now() / 1000) + 3600);
    const client = new SovraLightClient({
      deviceKey: key,
      preferredRelayMultiaddrs: ['/ip4/127.0.0.1/tcp/4001'],
      syncTransportFn: async () => ({
        events: [],
        bytesTransferred: 64,
      }),
    });

    const budget = client.computeSyncBudget({ batteryPercent: 90, networkType: 'wifi' });
    const pushMsg = {
      channelId: 'chan-alpha',
      ciphertextHex: 'deadbeef',
      ephemeralPubkeyHex: '1234',
      nonceHex: '5678',
      timestamp: Date.now(),
    };

    const res = await EphemeralPushSignalingProtocol.processPushSignal(client, pushMsg, budget);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.elapsedMs).toBeLessThan(1500);
      expect(res.value.wakeLockReleased).toBe(true);
    }
    // Automatically returns to sleep with zero lingering sockets
    expect(client.state).toBe('sleeping');
  });

  it('calculates peak-weighted SLA score and enforces swarm eviction thresholds', async () => {
    const { calculatePeakWeightedNodeSla, shouldEvictNodeFromSwarm } = await import('../src/index.js');

    // High peak uptime + 0 audit failures = High SLA
    const highSla = calculatePeakWeightedNodeSla({
      peakHoursUptimeRatio: 0.98,
      offPeakHoursUptimeRatio: 0.95,
      auditFailureRate: 0.0,
    });
    expect(highSla).toBeGreaterThanOrEqual(95);
    expect(shouldEvictNodeFromSwarm(highSla, 0)).toBe(false);

    // Flapping node during peak hours with 20% audit failure rate
    const degradedSla = calculatePeakWeightedNodeSla({
      peakHoursUptimeRatio: 0.50,
      offPeakHoursUptimeRatio: 0.90,
      auditFailureRate: 0.20,
    });
    // Degradation drops score significantly below 65
    expect(degradedSla).toBeLessThan(65);

    // After 3 consecutive cycles below threshold, node must be evicted
    expect(shouldEvictNodeFromSwarm(degradedSla, 3)).toBe(true);
    // After only 1 cycle, grace period applies
    expect(shouldEvictNodeFromSwarm(degradedSla, 1)).toBe(false);
  });
});

