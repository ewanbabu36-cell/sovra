import { bytesToHex, hexToBytes, verifyEd25519 } from '@sovra/crypto';
import { NatStatus, NatTraversalService } from './types.js';

export interface StunProbeResult {
  readonly serverAddr: string;
  readonly observedIp: string;
  readonly observedPort: number;
}

export class NatManager implements NatTraversalService {
  private _status: NatStatus = 'direct';
  private publicMultiaddrs: string[] = [];

  constructor(
    localAddresses: readonly string[] = [],
    private readonly checkReachabilityFn?: () => Promise<{
      reachable: boolean;
      observedAddr?: string;
    }>,
  ) {
    this.publicMultiaddrs = [...localAddresses];
  }

  public get status(): NatStatus {
    return this._status;
  }

  public setStatus(newStatus: NatStatus): void {
    this._status = newStatus;
  }

  public async detectNat(): Promise<NatStatus> {
    if (this.checkReachabilityFn) {
      try {
        const result = await this.checkReachabilityFn();
        if (result.reachable) {
          this._status = 'direct';
          if (result.observedAddr && !this.publicMultiaddrs.includes(result.observedAddr)) {
            this.publicMultiaddrs.push(result.observedAddr);
          }
        } else {
          this._status = 'relayed';
        }
      } catch {
        this._status = 'relayed';
      }
    }
    return this._status;
  }

  /**
   * Evaluates NAT type using multi-probe STUN observations.
   * - If observed address matches local address and reachable -> 'direct'
   * - If multiple probes return the same external port -> 'cone_nat' (hole-punchable)
   * - If external port changes across different destination probes -> 'symmetric_nat' (requires relay)
   */
  public evaluateStunProbes(probes: readonly StunProbeResult[], localPort?: number): NatStatus {
    if (probes.length === 0) {
      return this._status;
    }

    const first = probes[0];
    if (!first) return this._status;

    // Check if observed matches local
    if (
      localPort !== undefined &&
      first.observedPort === localPort &&
      this.publicMultiaddrs.some(a => a.includes(first.observedIp))
    ) {
      this._status = 'direct';
      return this._status;
    }

    if (probes.length === 1) {
      this._status = 'cone_nat';
      return this._status;
    }

    // Compare external ports across STUN servers
    const allSamePort = probes.every(
      p => p.observedPort === first.observedPort && p.observedIp === first.observedIp,
    );
    if (allSamePort) {
      this._status = 'cone_nat';
    } else {
      this._status = 'symmetric_nat';
    }
    return this._status;
  }

  public getPublicMultiaddrs(): readonly string[] {
    return this.publicMultiaddrs;
  }

  public addObservedAddress(address: string): void {
    if (!this.publicMultiaddrs.includes(address)) {
      this.publicMultiaddrs.push(address);
    }
  }
}

export type ConnectionTier =
  | 'tier1_ipv6_direct'
  | 'tier2_udp_hole_punch'
  | 'tier3_port_prediction'
  | 'tier4_relay_fallback';

export interface RelayCandidateMetrics {
  readonly relayAddress: string;
  readonly rttMs: number;
  readonly packetLossRate: number; // 0.0 to 1.0
  readonly bandwidthCapacityMbps: number;
}

/**
 * Pillar 2: Dynamic Relay Selection Latency Score Formula:
 * RelayScore = (1 / RTT_ms) * (1 - PacketLossRate) * log10(BandwidthCapacityMbps) * 1000
 */
export function calculateDynamicRelayScore(m: RelayCandidateMetrics): number {
  const safeRtt = Math.max(10, m.rttMs);
  const deliveryRatio = Math.max(0, 1 - Math.min(1, m.packetLossRate));
  const bwFactor = Math.max(0.1, Math.log10(Math.max(1, m.bandwidthCapacityMbps)));
  return Math.round((1 / safeRtt) * deliveryRatio * bwFactor * 1000 * 100) / 100;
}

export interface PortPredictionResult {
  readonly basePort: number;
  readonly predictedPorts: readonly number[];
  readonly probeCount: number;
  readonly estimatedCollisionProbability: number;
}

/**
 * Pillar 2 (Tier 3): Port Prediction Algorithm using Birthday Paradox Heuristic.
 * Overcomes Symmetric NAT port randomization:
 * When NAT allocates ports from pool N (e.g. 1024), probing k candidate ports achieves
 * collision probability P ≈ 1 - exp(-k^2 / (2N)).
 */
export class PortPredictionEngine {
  public static predictSymmetricPorts(
    lastObservedPort: number,
    probeCount = 32,
    portPoolSize = 1024,
  ): PortPredictionResult {
    const ports: number[] = [];
    for (let i = 1; i <= probeCount; i++) {
      const portCandidate = ((lastObservedPort + i * 2) % 65535) || 1024;
      ports.push(portCandidate);
    }
    const collisionProb = 1 - Math.exp(-(probeCount * probeCount) / (2 * portPoolSize));
    return {
      basePort: lastObservedPort,
      predictedPorts: ports,
      probeCount,
      estimatedCollisionProbability: Math.round(collisionProb * 1000) / 1000,
    };
  }
}

export interface RelayBandwidthReceipt {
  readonly receiptId: string;
  readonly relayPeerId: string;
  readonly clientPeerId: string;
  readonly bytesRelayed: number;
  readonly sessionToken: string;
  readonly timestamp: number;
  readonly clientSignatureHex: string;
}

/**
 * Pillar 2 (Tier 4): Community Incentivized Relay Protocol.
 * Operates as a zero-knowledge TURN-like packet forwarder funded by bandwidth receipts.
 */
export class CommunityIncentivizedRelayProtocol {
  public static createAllocation(
    relayAddress: string,
    clientPeerId: string,
  ): { allocationId: string; relayAddress: string; clientPeerId: string; expiresAt: number } {
    const allocationId = `turn_alloc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      allocationId,
      relayAddress,
      clientPeerId,
      expiresAt: Date.now() + 300000, // 5 min allocation
    };
  }

  public static createBandwidthReceipt(
    relayPeerId: string,
    clientPeerId: string,
    bytesRelayed: number,
    sessionToken: string,
    clientSignFn?: (msg: Uint8Array) => Uint8Array,
  ): RelayBandwidthReceipt {
    const timestamp = Date.now();
    const payload = `${relayPeerId}:${clientPeerId}:${bytesRelayed}:${sessionToken}:${timestamp}`;
    let sigHex = '00'.repeat(64);
    if (clientSignFn) {
      const sig = clientSignFn(new TextEncoder().encode(payload));
      sigHex = bytesToHex(sig);
    }
    return {
      receiptId: `rcpt_${timestamp}_${Math.random().toString(36).substring(2, 7)}`,
      relayPeerId,
      clientPeerId,
      bytesRelayed,
      sessionToken,
      timestamp,
      clientSignatureHex: sigHex,
    };
  }

  public static verifyBandwidthReceipt(
    receipt: RelayBandwidthReceipt,
    clientPublicKeyHex?: string,
  ): boolean {
    if (receipt.bytesRelayed <= 0) return false;
    if (Date.now() - receipt.timestamp > 86400000) return false; // 24h expiration
    if (clientPublicKeyHex && receipt.clientSignatureHex && receipt.clientSignatureHex !== '00'.repeat(64)) {
      try {
        const payload = `${receipt.relayPeerId}:${receipt.clientPeerId}:${receipt.bytesRelayed}:${receipt.sessionToken}:${receipt.timestamp}`;
        return verifyEd25519(
          hexToBytes(clientPublicKeyHex),
          new TextEncoder().encode(payload),
          hexToBytes(receipt.clientSignatureHex),
        );
      } catch {
        return false;
      }
    }
    return true;
  }
}

export interface IceNegotiationPlan {
  readonly selectedTier: ConnectionTier;
  readonly endpointAddress: string;
  readonly dynamicTimeoutMs: number;
  readonly predictedPorts?: readonly number[] | undefined;
}

/**
 * Pillar 2: ICE 4-Tiered Connectivity Fallback Engine.
 * Overcomes Symmetric-to-Symmetric NAT deadlocks and IPv6-only telecom mismatches:
 * Tier 1: Direct IPv6-to-IPv6 connect (60% cases me bypasses NAT completely).
 * Tier 2: UDP Direct Hole Punching via STUN coordinate (Cone NAT).
 * Tier 3: Port Prediction Algorithms (Birthday paradox heuristic for Symmetric NAT).
 * Tier 4: Community Incentivized Relay Protocol (Zero-knowledge TURN-like packet forwarder funded by bandwidth receipts).
 */
export class IceFallbackEngine {
  public static isIPv6Address(addr: string): boolean {
    return addr.includes(':') && !addr.includes('.');
  }

  /**
   * Adaptive Negotiation Timeout: Base RTT + 3 * sigma_rtt
   * Network RTT standard deviation ke 3x par dynamically converge karegi (120ms se 450ms).
   */
  public static calculateDynamicTimeout(baseRttMs: number, rttStdDevMs = 25): number {
    const rawTimeout = baseRttMs + 3 * rttStdDevMs;
    return Math.max(120, Math.min(450, Math.round(rawTimeout)));
  }

  /**
   * Plans the optimal connection route based on local and remote NAT profiles.
   */
  public planConnection(
    localNat: NatStatus,
    remoteNat: NatStatus,
    remoteCandidateAddrs: readonly string[],
    availableRelays: readonly RelayCandidateMetrics[] = [],
  ): IceNegotiationPlan {
    const ipv6Cand = remoteCandidateAddrs.find(a => IceFallbackEngine.isIPv6Address(a));

    // Tier 1: Direct IPv6 Bypass (if IPv6 peer is present)
    if (ipv6Cand) {
      return {
        selectedTier: 'tier1_ipv6_direct',
        endpointAddress: ipv6Cand,
        dynamicTimeoutMs: IceFallbackEngine.calculateDynamicTimeout(45),
      };
    }

    // Direct route if either side is public
    if (localNat === 'direct' || remoteNat === 'direct') {
      const directAddr = remoteCandidateAddrs[0] ?? '127.0.0.1:4001';
      return {
        selectedTier: 'tier1_ipv6_direct',
        endpointAddress: directAddr,
        dynamicTimeoutMs: IceFallbackEngine.calculateDynamicTimeout(50),
      };
    }

    // Tier 2: Cone NAT Hole Punch (STUN coordinated)
    if (localNat === 'cone_nat' && remoteNat === 'cone_nat') {
      return {
        selectedTier: 'tier2_udp_hole_punch',
        endpointAddress: remoteCandidateAddrs[0] ?? '127.0.0.1:4001',
        dynamicTimeoutMs: IceFallbackEngine.calculateDynamicTimeout(100),
      };
    }

    // Tier 3: One side symmetric, other side cone (Port prediction heuristic via Birthday paradox)
    if (
      (localNat === 'cone_nat' && remoteNat === 'symmetric_nat') ||
      (localNat === 'symmetric_nat' && remoteNat === 'cone_nat')
    ) {
      const endpoint = remoteCandidateAddrs[0] ?? '127.0.0.1:4001';
      const portMatch = endpoint.match(/:(\d+)$/);
      const basePort = portMatch ? parseInt(portMatch[1]!, 10) : 4001;
      const prediction = PortPredictionEngine.predictSymmetricPorts(basePort, 32);

      return {
        selectedTier: 'tier3_port_prediction',
        endpointAddress: endpoint,
        dynamicTimeoutMs: IceFallbackEngine.calculateDynamicTimeout(180),
        predictedPorts: prediction.predictedPorts,
      };
    }

    // Tier 4: Symmetric-to-Symmetric NAT deadlock -> Community Relay Fallback
    const sortedRelays = [...availableRelays].sort(
      (a, b) => calculateDynamicRelayScore(b) - calculateDynamicRelayScore(a),
    );
    const bestRelay = sortedRelays[0];
    const relayAddr = bestRelay ? bestRelay.relayAddress : 'p2p-relay.sovra.net:4001';
    const relayRtt = bestRelay ? bestRelay.rttMs : 80;

    return {
      selectedTier: 'tier4_relay_fallback',
      endpointAddress: relayAddr,
      dynamicTimeoutMs: IceFallbackEngine.calculateDynamicTimeout(relayRtt),
    };
  }
}


