import { describe, it, expect } from 'vitest';
import {
  calculateUdpPathHealth,
  TransportChameleonEngine,
  PeerDelayAnomalyDetector,
  GossipAckVerifier,
} from '../src/index.js';

describe('Pillar 1: Dynamic Transport Chameleon Architecture (DPI Defense)', () => {
  it('maintains UDP QUIC on healthy network with low loss and jitter', () => {
    const evaluation = calculateUdpPathHealth({
      packetsSent: 100,
      packetsReceived: 98,
      rttMeanMs: 40,
      rttStdDevMs: 4, // 10% jitter
    });

    expect(evaluation.shouldFallbackToWebSocket).toBe(false);
    expect(evaluation.recommendedTransport).toBe('udp_quic');
    expect(evaluation.hPath).toBeGreaterThanOrEqual(0.7);
  });

  it('triggers 0-RTT fallback to TLS WebSocket mimicry when DPI throttling is detected', () => {
    const evaluation = calculateUdpPathHealth({
      packetsSent: 100,
      packetsReceived: 95,
      rttMeanMs: 50,
      rttStdDevMs: 5,
      dpiSignatureThrottled: true, // M_firewall drops to 0.2
    });

    expect(evaluation.shouldFallbackToWebSocket).toBe(true);
    expect(evaluation.recommendedTransport).toBe('tls_websocket_mimic');
    expect(evaluation.hPath).toBeLessThan(0.7);
    expect(evaluation.explanation).toContain('Triggering 0-RTT fallback');
  });

  it('triggers fallback on severe UDP packet loss and high jitter', () => {
    const evaluation = calculateUdpPathHealth({
      packetsSent: 100,
      packetsReceived: 60, // 40% loss
      rttMeanMs: 120,
      rttStdDevMs: 60, // 50% jitter
    });

    expect(evaluation.shouldFallbackToWebSocket).toBe(true);
    expect(evaluation.recommendedTransport).toBe('tls_websocket_mimic');
  });

  it('generates innocuous browser-mimicking HTTP/2 upgrade headers', () => {
    const headers = TransportChameleonEngine.generateMimicryHeaders('relay.sovra.net', 'h2');
    expect(headers.host).toBe('relay.sovra.net');
    expect(headers.upgrade).toBe('websocket');
    expect(headers.connection).toBe('Upgrade');
    expect(headers.alpnProtocol).toBe('h2');
    expect(headers.userAgent).toContain('Mozilla/5.0');
    expect(headers.secWebSocketKey.length).toBeGreaterThan(10);
  });

  it('evaluates consecutive degradation windows before persistent failover', () => {
    expect(TransportChameleonEngine.evaluateConsecutiveDegradation(2, 3)).toBe(false);
    expect(TransportChameleonEngine.evaluateConsecutiveDegradation(3, 3)).toBe(true);
    expect(TransportChameleonEngine.evaluateConsecutiveDegradation(5, 3)).toBe(true);
  });
});

describe('Pillar 3: Byzantine Slow-Loris Delay Skew Defense', () => {
  it('does not penalize peers adhering to normal swarm transit distribution', () => {
    const detector = new PeerDelayAnomalyDetector(50, 1.5, 3);
    for (let i = 0; i < 30; i++) {
      detector.recordSample({
        peerId: `peer_${i}`,
        messageId: `msg_${i}`,
        transitDelayMs: 40 + (i % 10), // ~40-50ms
        timestamp: Date.now(),
      });
    }

    const evaluation = detector.evaluatePeer('peer_good', 45);
    expect(evaluation.isAnomalous).toBe(false);
    expect(evaluation.shouldPrune).toBe(false);
    expect(evaluation.peerScoreMultiplier).toBe(1.0);
  });

  it('penalizes slow-loris delayed forwarding with exponential decay', () => {
    const detector = new PeerDelayAnomalyDetector(50, 1.5, 3);
    for (let i = 0; i < 30; i++) {
      detector.recordSample({
        peerId: `peer_${i}`,
        messageId: `msg_${i}`,
        transitDelayMs: 50,
        timestamp: Date.now(),
      });
    }

    // Malicious peer intentionally delays message by 3.5s (3500ms)
    const evaluation = detector.evaluatePeer('peer_slow_loris', 3500);
    expect(evaluation.isAnomalous).toBe(true);
    expect(evaluation.zDelay).toBeGreaterThan(5.0);
    expect(evaluation.peerScoreMultiplier).toBeLessThan(0.01);
  });

  it('triggers automatic mesh link PRUNE after consecutive delay violations', () => {
    const detector = new PeerDelayAnomalyDetector(20, 1.5, 3);
    for (let i = 0; i < 20; i++) {
      detector.recordSample({
        peerId: `peer_${i}`,
        messageId: `msg_${i}`,
        transitDelayMs: 50,
        timestamp: Date.now(),
      });
    }

    // Moderate anomaly (65ms, z=3.0 > 1.5, <= 4.0)
    // Violation 1
    const res1 = detector.evaluatePeer('bot_peer', 65);
    expect(res1.isAnomalous).toBe(true);
    expect(res1.shouldPrune).toBe(false);

    // Violation 2
    const res2 = detector.evaluatePeer('bot_peer', 68);
    expect(res2.isAnomalous).toBe(true);
    expect(res2.shouldPrune).toBe(false);

    // Violation 3: Reaches pruneViolationThreshold (3)
    const res3 = detector.evaluatePeer('bot_peer', 66);
    expect(res3.shouldPrune).toBe(true);

    // Extreme single violation (200ms, z=30 > 4.0) instantly prunes
    const resExtreme = detector.evaluatePeer('bot_extreme', 200);
    expect(resExtreme.shouldPrune).toBe(true);
  });

  it('creates and verifies lightweight 16-byte gossip ACKs', () => {
    const ack = GossipAckVerifier.createAck('abcdef0123456789', 'peer_origin');
    expect(GossipAckVerifier.verifyAck(ack, 5000)).toBe(true);

    const expiredAck = {
      ...ack,
      ackTimestamp: Date.now() - 10000, // 10s old
    };
    expect(GossipAckVerifier.verifyAck(expiredAck, 5000)).toBe(false);
  });
});
