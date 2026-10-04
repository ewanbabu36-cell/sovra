/**
 * @file packages/p2p/src/chameleon.ts
 * Pillar 1: Dynamic Transport Chameleon Architecture (DPI & Carrier Censorship Defense).
 *
 * Real-world problem:
 * Telecom carriers, universities, and enterprise firewalls throttle or drop UDP/QUIC traffic
 * and inspect Noise_XX handshakes via Deep Packet Inspection (DPI).
 *
 * Solution:
 * 1. Measures UDP path degradation index H_path dynamically.
 * 2. Instant 0-RTT fallback from UDP to Encapsulated TLS 1.3 WebSocket.
 * 3. Mimicry framing: uses ALPN 'h2'/'http/1.1', innocuous HTTP GET upgrade headers, and domain fronting SNI masking.
 */

export interface UdpPathMetrics {
  readonly packetsSent: number;
  readonly packetsReceived: number;
  readonly rttMeanMs: number;
  readonly rttStdDevMs: number;
  readonly dpiSignatureThrottled?: boolean | undefined;
}

export interface PathHealthEvaluation {
  readonly hPath: number; // 0.0 to 1.0
  readonly shouldFallbackToWebSocket: boolean;
  readonly recommendedTransport: 'udp_quic' | 'tls_websocket_mimic';
  readonly explanation: string;
}

export interface MimicryHttpUpgradeHeaders {
  readonly host: string;
  readonly upgrade: string;
  readonly connection: string;
  readonly secWebSocketKey: string;
  readonly secWebSocketVersion: string;
  readonly userAgent: string;
  readonly alpnProtocol: 'h2' | 'http/1.1';
}

/**
 * Calculates UDP Path Degradation Index:
 * H_path = (PacketsReceived / PacketsSent) * (1 - (RTT_stddev / RTT_mean)) * M_firewall
 * where M_firewall = 0.2 if DPI signature detected, else 1.0.
 */
export function calculateUdpPathHealth(metrics: UdpPathMetrics): PathHealthEvaluation {
  if (metrics.packetsSent <= 0) {
    return {
      hPath: 1.0,
      shouldFallbackToWebSocket: false,
      recommendedTransport: 'udp_quic',
      explanation: 'No packets sent yet; defaulting to UDP QUIC.',
    };
  }

  const deliveryRatio = Math.max(0, Math.min(1, metrics.packetsReceived / metrics.packetsSent));
  const safeMean = Math.max(1, metrics.rttMeanMs);
  const jitterRatio = Math.min(0.9, Math.max(0, metrics.rttStdDevMs / safeMean));
  const firewallMultiplier = metrics.dpiSignatureThrottled ? 0.2 : 1.0;

  const rawH = deliveryRatio * (1 - jitterRatio) * firewallMultiplier;
  const hPath = Math.round(Math.max(0, Math.min(1, rawH)) * 1000) / 1000;

  const fallback = hPath < 0.7;
  return {
    hPath,
    shouldFallbackToWebSocket: fallback,
    recommendedTransport: fallback ? 'tls_websocket_mimic' : 'udp_quic',
    explanation: fallback
      ? `H_path ${hPath} < 0.70 threshold. Triggering 0-RTT fallback to TLS WebSocket mimicry.`
      : `H_path ${hPath} >= 0.70 threshold. Maintaining UDP QUIC transport.`,
  };
}

/**
 * Generates innocuous standard browser HTTP/2 or HTTP/1.1 headers to mask
 * P2P traffic from deep packet inspection firewalls.
 */
export class TransportChameleonEngine {
  private static readonly INNOCUOUS_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.64 Mobile Safari/537.36',
  ];

  public static generateMimicryHeaders(targetDomain: string, alpn: 'h2' | 'http/1.1' = 'h2'): MimicryHttpUpgradeHeaders {
    const randomKey = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
    const ua = this.INNOCUOUS_USER_AGENTS[0]!;

    return {
      host: targetDomain,
      upgrade: 'websocket',
      connection: 'Upgrade',
      secWebSocketKey: randomKey,
      secWebSocketVersion: '13',
      userAgent: ua,
      alpnProtocol: alpn,
    };
  }

  /**
   * Evaluates a sequence of sliding observation windows to prevent flappy failovers.
   * If consecutive degraded windows exceed the threshold, triggers persistent failover.
   */
  public static evaluateConsecutiveDegradation(
    consecutiveDegradedCount: number,
    threshold = 3,
  ): boolean {
    return consecutiveDegradedCount >= threshold;
  }
}
