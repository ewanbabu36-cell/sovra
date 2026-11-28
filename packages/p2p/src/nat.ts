import { bytesToHex, hexToBytes, verifyEd25519 } from '@sovra/crypto';
import { NatStatus, NatTraversalService } from './types.js';

/**
 * RFC 6598 Carrier Grade NAT (CGNAT) is the IPv4 block 100.64.0.0/10.
 * Ranges from 100.64.0.0 to 100.127.255.255.
 * Used exclusively by mobile cellular carriers (Jio, Airtel, Vi, AT&T, Verizon, T-Mobile)
 * where mobile handsets do not receive publicly routable IP addresses.
 */
export function isCgnatAddress(ip: string): boolean {
  if (!ip) return false;
  const clean = ip.replace(/\/.*$/, '').trim();
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const first = parseInt(match[1]!, 10);
  const second = parseInt(match[2]!, 10);
  return first === 100 && second >= 64 && second <= 127;
}

/**
 * Checks whether an IP is RFC 1918 private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * or RFC 6598 CGNAT (100.64.0.0/10) or loopback.
 */
export function isPrivateAddress(ip: string): boolean {
  if (!ip) return false;
  const clean = ip.replace(/\/.*$/, '').trim();
  if (clean === '127.0.0.1' || clean === 'localhost' || clean === '::1') return true;
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const a = parseInt(match[1]!, 10);
  const b = parseInt(match[2]!, 10);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function isPrivateOrCgnatAddress(ip: string): boolean {
  return isPrivateAddress(ip) || isCgnatAddress(ip);
}

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
    for (const addr of this.publicMultiaddrs) {
      const match = addr.match(/\/ip4\/([^/]+)/);
      if (match && match[1] && isCgnatAddress(match[1])) {
        this._status = 'symmetric_nat';
        return this._status;
      }
    }

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
    seenReceiptIds?: Set<string>,
  ): boolean {
    if (!receipt || !receipt.receiptId || receipt.bytesRelayed <= 0) return false;
    if (Date.now() - receipt.timestamp > 86400000) return false; // 24h expiration
    if (receipt.timestamp > Date.now() + 300000) return false; // max 5m future skew
    if (seenReceiptIds && seenReceiptIds.has(receipt.receiptId)) return false;
    if (!clientPublicKeyHex || !receipt.clientSignatureHex || receipt.clientSignatureHex === '00'.repeat(64)) {
      return false;
    }
    try {
      const payload = `${receipt.relayPeerId}:${receipt.clientPeerId}:${receipt.bytesRelayed}:${receipt.sessionToken}:${receipt.timestamp}`;
      const okSig = verifyEd25519(
        hexToBytes(clientPublicKeyHex),
        new TextEncoder().encode(payload),
        hexToBytes(receipt.clientSignatureHex),
      );
      if (okSig && seenReceiptIds) {
        seenReceiptIds.add(receipt.receiptId);
      }
      return okSig;
    } catch {
      return false;
    }
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
    if (!addr) return false;
    if (addr.includes('/ip6/')) return true;
    const clean = addr.trim();
    if (/^\[[0-9a-f:]+\](:\d+)?$/i.test(clean)) return true;
    const colonCount = (clean.match(/:/g) || []).length;
    return colonCount >= 2 && !clean.includes('.');
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

    // Tier 4: Symmetric-to-Symmetric NAT deadlock -> Volunteer / Local Relay Fallback (zero hardcoded central domain)
    const sortedRelays = [...availableRelays].sort(
      (a, b) => calculateDynamicRelayScore(b) - calculateDynamicRelayScore(a),
    );
    const bestRelay = sortedRelays[0];
    const envFallback =
      typeof process !== 'undefined' && process.env?.SOVRA_FALLBACK_RELAY
        ? process.env.SOVRA_FALLBACK_RELAY
        : '127.0.0.1:4001';
    const relayAddr = bestRelay ? bestRelay.relayAddress : envFallback;
    const relayRtt = bestRelay ? bestRelay.rttMs : 80;

    return {
      selectedTier: 'tier4_relay_fallback',
      endpointAddress: relayAddr,
      dynamicTimeoutMs: IceFallbackEngine.calculateDynamicTimeout(relayRtt),
    };
  }
}

export const AUTONAT_PROTOCOL = '/libp2p/autonat/1.0.0';

export interface AutoNatDialRequest {
  readonly peerId: string;
  readonly addrs: readonly string[];
}

export type AutoNatStatus =
  | 'OK'
  | 'E_DIAL_ERROR'
  | 'E_DIAL_REFUSED'
  | 'E_BAD_REQUEST'
  | 'E_INTERNAL_ERROR';

export interface AutoNatDialResponse {
  readonly status: AutoNatStatus;
  readonly observedAddr?: string;
  readonly isCgnat?: boolean;
  readonly message?: string;
}

/**
 * AutoNAT Service implementation for detecting reachability across Cellular CGNAT and NAT firewalls.
 */
export class AutoNatService {
  constructor(
    private readonly dialBackTester?: (addr: string) => Promise<boolean>,
  ) {}

  public async handleDialRequest(
    remotePeerId: string,
    remoteObservedIp: string,
    remoteObservedPort: number,
    req: AutoNatDialRequest,
  ): Promise<AutoNatDialResponse> {
    const isCgnat = isCgnatAddress(remoteObservedIp);
    const observedAddr = `/ip4/${remoteObservedIp}/tcp/${remoteObservedPort}/p2p/${remotePeerId}`;

    if (isCgnat) {
      return {
        status: 'E_DIAL_ERROR',
        observedAddr,
        isCgnat: true,
        message: 'Observed peer IP is behind Cellular Carrier-Grade NAT (RFC 6598 100.64.0.0/10). Inbound dial rejected.',
      };
    }

    if (this.dialBackTester && req.addrs && req.addrs.length > 0) {
      try {
        const canReach = await this.dialBackTester(req.addrs[0]!);
        if (canReach) {
          return { status: 'OK', observedAddr, isCgnat: false };
        }
      } catch {}
      return { status: 'E_DIAL_ERROR', observedAddr, isCgnat: false, message: 'Dialback failed' };
    }

    // If not private and not CGNAT, direct connection is viable
    if (!isPrivateOrCgnatAddress(remoteObservedIp)) {
      return { status: 'OK', observedAddr, isCgnat: false };
    }

    return {
      status: 'E_DIAL_ERROR',
      observedAddr,
      isCgnat: false,
      message: 'Observed peer address is on RFC 1918 private network and cannot receive inbound WAN connections',
    };
  }

  public createDialRequest(myPeerId: string, myAddrs: readonly string[]): AutoNatDialRequest {
    return {
      peerId: myPeerId,
      addrs: myAddrs,
    };
  }
}

export const DCUTR_PROTOCOL = '/libp2p/dcutr';

export type DcutrMessageType = 'CONNECT' | 'SYNC';

export interface DcutrMessage {
  readonly type: DcutrMessageType;
  readonly addrs?: readonly string[];
  readonly delayMs?: number;
}

/**
 * DCUtR (Direct Connection Upgrade through Relay) Coordinator.
 * Coordinates synchronized simultaneous hole-punching dials between two peers connected via Circuit Relay v2.
 */
export class DcutrCoordinator {
  public static createConnectMessage(myObservedAddrs: readonly string[]): DcutrMessage {
    return {
      type: 'CONNECT',
      addrs: myObservedAddrs,
    };
  }

  public static createSyncMessage(delayMs = 150): DcutrMessage {
    return {
      type: 'SYNC',
      delayMs,
    };
  }

  public static calculateSyncDelay(rttMs: number): number {
    return Math.max(50, Math.min(500, Math.round(rttMs / 2)));
  }
}

export const STUN_MAGIC_COOKIE = 0x2112a442;
export const STUN_BINDING_REQUEST = 0x0001;
export const STUN_BINDING_SUCCESS_RESPONSE = 0x0101;
export const STUN_ATTR_MAPPED_ADDRESS = 0x0001;
export const STUN_ATTR_XOR_MAPPED_ADDRESS = 0x0020;

/**
 * Encodes an RFC 5389 binary STUN Binding Request (20 bytes header).
 */
export function buildStunBindingRequest(transactionId?: Uint8Array): {
  packet: Uint8Array;
  transactionId: Uint8Array;
} {
  const txId = new Uint8Array(12);
  if (transactionId && transactionId.length === 12) {
    txId.set(transactionId);
  } else if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(txId);
  } else {
    for (let i = 0; i < 12; i++) txId[i] = Math.floor(Math.random() * 256);
  }
  const packet = new Uint8Array(20);
  const view = new DataView(packet.buffer);
  view.setUint16(0, STUN_BINDING_REQUEST, false);
  view.setUint16(2, 0, false);
  view.setUint32(4, STUN_MAGIC_COOKIE, false);
  packet.set(txId, 8);
  return { packet, transactionId: txId };
}

/**
 * Encodes an RFC 5389 STUN Binding Success Response with XOR-MAPPED-ADDRESS (IPv4).
 */
export function buildStunBindingSuccessResponse(
  transactionId: Uint8Array,
  observedIp: string,
  observedPort: number,
): Uint8Array {
  const ipParts = observedIp.split('.').map(n => parseInt(n, 10) & 0xff);
  if (ipParts.length !== 4 || ipParts.some(n => Number.isNaN(n))) {
    throw new Error(`Invalid IPv4 address for STUN response: ${observedIp}`);
  }
  const packet = new Uint8Array(32);
  const view = new DataView(packet.buffer);
  view.setUint16(0, STUN_BINDING_SUCCESS_RESPONSE, false);
  view.setUint16(2, 12, false);
  view.setUint32(4, STUN_MAGIC_COOKIE, false);
  packet.set(transactionId.slice(0, 12), 8);

  view.setUint16(20, STUN_ATTR_XOR_MAPPED_ADDRESS, false);
  view.setUint16(22, 8, false);
  packet[24] = 0x00;
  packet[25] = 0x01;
  view.setUint16(26, (observedPort & 0xffff) ^ (STUN_MAGIC_COOKIE >>> 16), false);
  const ipUint32 =
    ((ipParts[0]! << 24) | (ipParts[1]! << 16) | (ipParts[2]! << 8) | ipParts[3]!) >>> 0;
  view.setUint32(28, (ipUint32 ^ STUN_MAGIC_COOKIE) >>> 0, false);
  return packet;
}

/**
 * Decodes an RFC 5389 STUN Binding Success Response (supports XOR-MAPPED-ADDRESS and MAPPED-ADDRESS).
 */
export function parseStunBindingResponse(
  packet: Uint8Array,
  expectedTxId?: Uint8Array,
): { observedIp: string; observedPort: number; transactionIdHex: string } | null {
  if (!packet || packet.length < 20) return null;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const msgType = view.getUint16(0, false);
  const msgLen = view.getUint16(2, false);
  const magic = view.getUint32(4, false);
  if (msgType !== STUN_BINDING_SUCCESS_RESPONSE || magic !== STUN_MAGIC_COOKIE) {
    return null;
  }
  const txId = packet.slice(8, 20);
  if (expectedTxId && expectedTxId.length === 12) {
    for (let i = 0; i < 12; i++) {
      if (txId[i] !== expectedTxId[i]) return null;
    }
  }
  const endOffset = Math.min(packet.length, 20 + msgLen);
  let offset = 20;
  while (offset + 4 <= endOffset) {
    const attrType = view.getUint16(offset, false);
    const attrLen = view.getUint16(offset + 2, false);
    const valStart = offset + 4;
    if (valStart + attrLen > endOffset) break;

    if (attrType === STUN_ATTR_XOR_MAPPED_ADDRESS && attrLen >= 8 && packet[valStart + 1] === 0x01) {
      const xorPort = view.getUint16(valStart + 2, false);
      const xorIp = view.getUint32(valStart + 4, false);
      const port = xorPort ^ (STUN_MAGIC_COOKIE >>> 16);
      const ipNum = (xorIp ^ STUN_MAGIC_COOKIE) >>> 0;
      const observedIp = `${(ipNum >>> 24) & 0xff}.${(ipNum >>> 16) & 0xff}.${(ipNum >>> 8) & 0xff}.${ipNum & 0xff}`;
      return { observedIp, observedPort: port, transactionIdHex: bytesToHex(txId) };
    }
    if (attrType === STUN_ATTR_MAPPED_ADDRESS && attrLen >= 8 && packet[valStart + 1] === 0x01) {
      const port = view.getUint16(valStart + 2, false);
      const observedIp = `${packet[valStart + 4]}.${packet[valStart + 5]}.${packet[valStart + 6]}.${packet[valStart + 7]}`;
      return { observedIp, observedPort: port, transactionIdHex: bytesToHex(txId) };
    }

    const paddedLen = (attrLen + 3) & ~3;
    offset = valStart + paddedLen;
  }
  return null;
}

/**
 * Executes a real RFC 5389 UDP STUN Binding Request against host:port and returns observed reflexive mapping.
 * STUN alone cannot guarantee connectivity behind Symmetric NAT or restrictive CGNAT; Circuit Relay v2 fallback is required.
 */
export async function probeStunUdp(
  serverHost: string,
  serverPort = 3478,
  timeoutMs = 1500,
): Promise<StunProbeResult | null> {
  if (typeof process === 'undefined' || !process.versions?.node) return null;
  try {
    const dgram = await import('node:dgram');
    const socket = dgram.createSocket('udp4');
    const { packet, transactionId } = buildStunBindingRequest();

    return await new Promise<StunProbeResult | null>(resolve => {
      let finished = false;
      const done = (res: StunProbeResult | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {}
        resolve(res);
      };

      const timer = setTimeout(() => done(null), timeoutMs);
      socket.on('error', () => done(null));
      socket.on('message', (msg: Buffer) => {
        const parsed = parseStunBindingResponse(new Uint8Array(msg), transactionId);
        if (parsed) {
          done({
            serverAddr: `${serverHost}:${serverPort}`,
            observedIp: parsed.observedIp,
            observedPort: parsed.observedPort,
          });
        }
      });

      socket.send(Buffer.from(packet), serverPort, serverHost, err => {
        if (err) done(null);
      });
    });
  } catch {
    return null;
  }
}

/**
 * Starts a real RFC 5389 UDP STUN server for deterministic NAT reflection probing & testing.
 */
export async function startLocalStunServer(
  port = 0,
  host = '127.0.0.1',
): Promise<{ host: string; port: number; close: () => Promise<void> }> {
  const dgram = await import('node:dgram');
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg: Buffer, rinfo: { address: string; port: number }) => {
    if (msg.length < 20) return;
    const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
    if (view.getUint16(0, false) !== STUN_BINDING_REQUEST) return;
    if (view.getUint32(4, false) !== STUN_MAGIC_COOKIE) return;
    const txId = new Uint8Array(msg.subarray(8, 20));
    const cleanAddr = rinfo.address.replace(/^::ffff:/, '');
    const observedIp = cleanAddr === '::1' ? '127.0.0.1' : cleanAddr;
    try {
      const resp = buildStunBindingSuccessResponse(txId, observedIp, rinfo.port);
      sock.send(Buffer.from(resp), rinfo.port, rinfo.address);
    } catch {}
  });
  await new Promise<void>(resolve => sock.bind(port, host, resolve));
  const addr = sock.address();
  return {
    host,
    port: typeof addr === 'object' && addr ? addr.port : port,
    close: () => new Promise<void>(resolve => sock.close(() => resolve())),
  };
}



