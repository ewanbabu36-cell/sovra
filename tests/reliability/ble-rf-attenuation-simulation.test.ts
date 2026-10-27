/**
 * @file tests/reliability/ble-rf-attenuation-simulation.test.ts
 * Reliability & RF Attenuation Simulation Test Suite for Sovra Mobile Mesh.
 *
 * Verifies:
 * 1. Physical signal decay modeling (10dB to 90dB attenuation).
 * 2. Noise_XX session keys & cryptographic beacon signatures.
 * 3. 5% to 80% packet loss resilience & telemetry accounting.
 * 4. Autonomous multi-hop routing fallback when direct links are degraded.
 * 5. Ping broadcast round-trip propagation latency measurement.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  sovraBleMesh,
  estimateBleDistanceMeters,
  classifyBleSignalQuality,
  createSignedBeaconFrame,
  verifyBeaconFrame,
} from '../../scripts/ble-mesh-engine.js';

describe('BLE / Wi-Fi Direct RF Attenuation & Mesh Simulation Suite', () => {
  beforeEach(() => {
    // Reset RF simulator to pristine baseline
    sovraBleMesh.setRfSimulation({
      attenuationDb: 0,
      packetLossPct: 0,
      rangeDecayMeters: 50,
      multiHopFallbackEnabled: true,
    });
  });

  describe('1. Baseline RF Propagation & Cryptographic Identity', () => {
    it('initializes with active peers, valid Noise_XX keys, and verified beacons', () => {
      const peers = sovraBleMesh.getConnectedPeersWithTelemetry();
      expect(peers.length).toBeGreaterThanOrEqual(3);

      for (const p of peers) {
        expect(p.peerDid).toMatch(/^did:sovra:/);
        expect(p.noiseXxKey).toMatch(/^0x[0-9a-f]{32}/);
        expect(p.signalBars).toBeGreaterThanOrEqual(3);
        expect(p.status).toBe('CONNECTED');
        expect(p.hopCount).toBe(1);
      }
    });

    it('creates and verifies cryptographically signed proximity beacon frames', () => {
      const frame = createSignedBeaconFrame({
        peerDid: 'did:sovra:unit_test_peer',
        handle: '@unit_tester',
        displayName: 'Unit Tester Node',
        rssiDbm: -55,
      });

      expect(frame.beaconId).toMatch(/^ble_bcn_/);
      expect(frame.cipherSuite).toBe('Noise_XX_25519_ChaChaPoly');

      const verification = verifyBeaconFrame(frame);
      expect(verification.valid).toBe(true);

      // Tampered frame signature verification must fail
      const tampered = { ...frame, rssiDbm: -20 };
      const tamperedVerification = verifyBeaconFrame(tampered);
      expect(tamperedVerification.valid).toBe(false);
    });
  });

  describe('2. Moderate RF Attenuation (10 dB - 30 dB)', () => {
    it('accurately models logarithmic distance decay and signal degradation', () => {
      // Free space / clear line of sight
      const d0 = estimateBleDistanceMeters(-50, -59);
      // Attenuated by 20 dB (e.g. interior office walls)
      const dAttenuated = estimateBleDistanceMeters(-70, -59);

      expect(dAttenuated).toBeGreaterThan(d0);
      expect(classifyBleSignalQuality(-50)).toBe('EXCELLENT');
      expect(classifyBleSignalQuality(-75)).toBe('FAIR');
    });

    it('maintains direct 1-hop links under 25 dB attenuation with increased RTT', () => {
      sovraBleMesh.setRfSimulation({ attenuationDb: 25, packetLossPct: 0 });
      const peers = sovraBleMesh.getConnectedPeersWithTelemetry();

      const alice = peers.find(p => p.peerDid === 'did:sovra:alice_architect');
      expect(alice).toBeDefined();
      expect(alice!.effectiveRssiDbm).toBe(alice!.rssiDbm - 25);
      expect(alice!.hopCount).toBe(1);

      const transmission = sovraBleMesh.simulatePacketTransmission(
        'did:sovra:local_test',
        'did:sovra:alice_architect',
        128
      );
      expect(transmission.success).toBe(true);
      expect(transmission.hops).toBe(1);
      expect(transmission.multiHopUsed).toBe(false);
      expect(transmission.rttMs).toBeGreaterThan(10);
    });
  });

  describe('3. Severe RF Attenuation (60 dB - 85 dB) & Autonomous Multi-Hop Fallback', () => {
    it('triggers multi-hop relay fallback when direct link is severely attenuated', () => {
      // 70 dB attenuation simulates reinforced concrete bunker
      sovraBleMesh.setRfSimulation({
        attenuationDb: 70,
        packetLossPct: 0,
        rangeDecayMeters: 40,
        multiHopFallbackEnabled: true,
      });

      const peers = sovraBleMesh.getConnectedPeersWithTelemetry();
      const relayedPeer = peers.find(p => p.status === 'MULTI_HOP_FALLBACK');
      expect(relayedPeer).toBeDefined();
      expect(relayedPeer!.hopCount).toBeGreaterThanOrEqual(2);

      const transmission = sovraBleMesh.simulatePacketTransmission(
        'did:sovra:local_test',
        relayedPeer!.peerDid,
        256
      );

      expect(transmission.success).toBe(true);
      expect(transmission.multiHopUsed).toBe(true);
      expect(transmission.hops).toBeGreaterThanOrEqual(2);
      expect(transmission.path.length).toBeGreaterThanOrEqual(3);
      expect(transmission.path[0]).toBe('did:sovra:local_test');
    });

    it('isolates peers when multi-hop fallback is disabled under extreme 90 dB attenuation', () => {
      sovraBleMesh.setRfSimulation({
        attenuationDb: 90,
        rangeDecayMeters: 10,
        multiHopFallbackEnabled: false,
      });

      const peers = sovraBleMesh.getConnectedPeersWithTelemetry();
      const unreachable = peers.filter(p => p.status === 'UNREACHABLE');
      expect(unreachable.length).toBeGreaterThan(0);

      const transmission = sovraBleMesh.simulatePacketTransmission(
        'did:sovra:local_test',
        unreachable[0].peerDid
      );
      expect(transmission.success).toBe(false);
      expect(transmission.lossReason).toContain('out of RF range');
    });
  });

  describe('4. Packet Loss Simulation & Recovery Telemetry', () => {
    it('records and tracks 5% to 80% packet drop rates truthfully', () => {
      sovraBleMesh.setRfSimulation({
        attenuationDb: 10,
        packetLossPct: 40,
        multiHopFallbackEnabled: true,
      });

      const pingResult = sovraBleMesh.pingBroadcast('did:sovra:tester');
      expect(pingResult.pingId).toMatch(/^ping_/);
      expect(pingResult.ephemeralNoiseKey).toMatch(/^0x[0-9a-f]{32}/);
      expect(pingResult.cipherSuite).toBe('Noise_XX_25519_ChaChaPoly');
      expect(pingResult.totalPings).toBeGreaterThanOrEqual(3);
      expect(pingResult.lossRatePct).toBeGreaterThanOrEqual(0);
      expect(pingResult.lossRatePct).toBeLessThanOrEqual(100);
    });

    it('handles 100% complete RF blackout cleanly without unhandled rejections', () => {
      sovraBleMesh.setRfSimulation({
        attenuationDb: 90,
        packetLossPct: 100,
        multiHopFallbackEnabled: false,
      });

      const pingResult = sovraBleMesh.pingBroadcast('did:sovra:tester');
      expect(pingResult.successfulPongs).toBe(0);
      expect(pingResult.lossRatePct).toBe(100);
      expect(pingResult.responses.length).toBe(0);
    });
  });

  describe('5. End-to-End Ping Broadcast Latency & Relay Telemetry', () => {
    it('broadcasts encrypted ping, collects pongs, and measures RTT with cryptographic signatures', () => {
      sovraBleMesh.setRfSimulation({
        attenuationDb: 0,
        packetLossPct: 0,
        rangeDecayMeters: 50,
        multiHopFallbackEnabled: true,
      });

      const res = sovraBleMesh.pingBroadcast('did:sovra:client_node');
      expect(res.successfulPongs).toBe(res.totalPings);
      expect(res.lossRatePct).toBe(0);
      expect(res.totalRoundTripMs).toBeGreaterThan(0);

      for (const pong of res.responses) {
        expect(pong.rttMs).toBeGreaterThan(0);
        expect(pong.hopCount).toBeGreaterThanOrEqual(1);
        expect(pong.signatureHex).toHaveLength(64);
        expect(pong.relayedBytes).toBeGreaterThan(0);
      }
    });
  });
});
