/**
 * BitChat Zero-Internet Offline Mesh Protocol Engine for Sovra
 *
 * Implements ad-hoc peer-to-peer mesh routing over Bluetooth Low Energy (BLE)
 * and local ad-hoc links. Enables multi-hop message relaying, hyperlocal public channels,
 * RSSI distance approximation, duplicate packet suppression, and instant emergency panic wiping.
 */

import { secureRandomBytes, bytesToHex } from '@sovra/crypto';

export interface BitChatPeer {
  readonly did: string;
  readonly displayName: string;
  readonly rssi: number; // Signal strength in dBm (e.g. -45 dBm)
  readonly distanceMeters: number; // Approximated distance from RSSI
  readonly hops: number; // 1 = direct link, >1 = relayed multi-hop
  readonly relayVia?: string | undefined; // DID of the intermediate relay peer
  readonly isDirect: boolean;
  readonly lastSeen: number;
}

export interface BitChatPacket {
  readonly packetId: string;
  readonly sourceDid: string;
  readonly sourceName: string;
  readonly destDid: string; // Specific recipient DID or '*' for broadcast
  readonly channel?: string | undefined; // Hyperlocal channel (e.g. '#local-mesh', '#emergency-sos')
  readonly payload: string; // Encrypted payload or broadcast message
  readonly hopCount: number; // Current hop count (increments at each relay)
  readonly maxHops: number; // TTL limit to prevent infinite loops (standard = 7)
  readonly route: readonly string[]; // Audit path of node DIDs traversed
  readonly timestamp: number;
  readonly isEmergency?: boolean | undefined;
}

export interface BitChatChannel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isEmergency: boolean;
  readonly memberCount: number;
}

export interface AntiEntropySyncSummary {
  readonly nodeDid: string;
  readonly timestamp: number;
  readonly bloomFilterHex: string; // 64-bit Bloom filter as 16-character hex
  readonly recentPacketIds: string[]; // Up to 100 most recent seen packet IDs
}

export interface AntiEntropyReconciliation {
  readonly missingFromLocal: string[]; // Packet IDs peer has that local node needs
  readonly availableToOffer: string[]; // Packet IDs local node has that peer needs
  readonly packetsToPush: BitChatPacket[]; // Stored packets local node can immediately push to peer
}

export interface PeerRegistrationResult {
  readonly peer: BitChatPeer;
  readonly isCloseProximity: boolean; // Direct link with RSSI > -75 dBm
  readonly syncNeeded: boolean; // First discovery or stale (> 30s) close peer requiring anti-entropy exchange
}

function computeBloomFilter64(packetIds: string[]): string {
  let bloom = 0n;
  for (const id of packetIds) {
    let h1 = 0x811c9dc5n;
    let h2 = 0x5bd1e995n;
    for (let i = 0; i < id.length; i++) {
      const code = BigInt(id.charCodeAt(i));
      h1 = ((h1 ^ code) * 0x01000193n) & 0xffffffffffffffffn;
      h2 = ((h2 ^ (code << 3n)) * 0x00000100000001b3n) & 0xffffffffffffffffn;
    }
    const bit1 = Number(h1 % 64n);
    const bit2 = Number(h2 % 64n);
    bloom |= (1n << BigInt(bit1)) | (1n << BigInt(bit2));
  }
  return bloom.toString(16).padStart(16, '0');
}

export interface PacketRoutingResult {
  readonly action: 'deliver' | 'forward' | 'deliver_and_forward' | 'drop';
  readonly reason?: string;
  readonly deliveredPacket?: BitChatPacket;
  readonly forwardedPacket?: BitChatPacket;
}

export class BitChatMeshRouter {
  public readonly localDid: string;
  public readonly localName: string;
  public readonly defaultMaxHops: number;

  private peers: Map<string, BitChatPeer> = new Map();
  private seenPackets: Set<string> = new Set();
  private seenPacketsOrder: string[] = [];
  private storedPackets: Map<string, BitChatPacket> = new Map();
  private readonly maxSeenCacheSize = 2000;

  private deliveredPackets: BitChatPacket[] = [];
  private onMessageCallbacks: Array<(packet: BitChatPacket) => void> = [];

  constructor(localDid: string, localName: string, defaultMaxHops: number = 7) {
    this.localDid = localDid;
    this.localName = localName;
    this.defaultMaxHops = defaultMaxHops;
  }

  /**
   * Registers or updates a discovered BLE / ad-hoc mesh peer.
   * Returns proximity and sync recommendations.
   */
  public registerPeer(peer: BitChatPeer): PeerRegistrationResult {
    const previous = this.peers.get(peer.did);
    this.peers.set(peer.did, peer);
    const isCloseProximity = Boolean(peer.isDirect && peer.rssi > -75);
    const syncNeeded = isCloseProximity && (!previous || Date.now() - previous.lastSeen > 30000);
    return {
      peer,
      isCloseProximity,
      syncNeeded,
    };
  }

  /**
   * Generates a compact anti-entropy sync summary (64-bit Bloom filter + recent packet IDs)
   * to exchange with in-range peers for store-and-forward reconciliation.
   */
  public createSyncSummary(limit: number = 100): AntiEntropySyncSummary {
    const recentPacketIds = this.seenPacketsOrder.slice(-limit);
    const bloomFilterHex = computeBloomFilter64(recentPacketIds);
    return {
      nodeDid: this.localDid,
      timestamp: Date.now(),
      bloomFilterHex,
      recentPacketIds,
    };
  }

  /**
   * Reconciles a peer's anti-entropy sync summary against local mesh cache.
   * Identifies packets to request and packets to immediately push.
   */
  public reconcileSyncSummary(peerSummary: AntiEntropySyncSummary): AntiEntropyReconciliation {
    const peerIds = new Set(peerSummary.recentPacketIds);
    const myIds = new Set(this.seenPacketsOrder);

    const missingFromLocal = peerSummary.recentPacketIds.filter(id => !myIds.has(id));
    const availableToOffer = this.seenPacketsOrder.filter(id => !peerIds.has(id));

    // Stored broadcast packets or direct packets targeted to peer that peer has not seen
    const packetsToPush = Array.from(this.storedPackets.values()).filter(
      p => !peerIds.has(p.packetId) && (p.destDid === '*' || p.destDid === peerSummary.nodeDid)
    );

    return {
      missingFromLocal,
      availableToOffer,
      packetsToPush,
    };
  }

  public getPeer(did: string): BitChatPeer | undefined {
    return this.peers.get(did);
  }

  public getAllPeers(): BitChatPeer[] {
    return Array.from(this.peers.values());
  }

  public getDirectPeers(): BitChatPeer[] {
    return this.getAllPeers().filter(p => p.isDirect);
  }

  public getRelayedPeers(): BitChatPeer[] {
    return this.getAllPeers().filter(p => !p.isDirect);
  }

  /**
   * Generates a new BitChat mesh packet for broadcast or direct transmission
   */
  public createPacket(
    destDid: string,
    payload: string,
    options?: {
      channel?: string;
      maxHops?: number;
      isEmergency?: boolean;
    },
  ): BitChatPacket {
    const packetId = `pkt_${bytesToHex(secureRandomBytes(8))}_${Date.now()}`;
    const packet: BitChatPacket = {
      packetId,
      sourceDid: this.localDid,
      sourceName: this.localName,
      destDid,
      channel: options?.channel,
      payload,
      hopCount: 0,
      maxHops: options?.maxHops ?? this.defaultMaxHops,
      route: [this.localDid],
      timestamp: Date.now(),
      isEmergency: options?.isEmergency ?? false,
    };

    // Mark our own packet as seen so we don't bounce it back
    this.markPacketSeen(packetId);
    this.storedPackets.set(packetId, packet);
    return packet;
  }

  /**
   * Core BitChat Mesh Routing Engine:
   * Inspects incoming packet, detects loops/duplicates, decrements TTL, delivers, or forwards
   */
  public receivePacket(packet: BitChatPacket): PacketRoutingResult {
    // 1. Loop & Duplicate Suppression (LRU cache)
    if (this.seenPackets.has(packet.packetId)) {
      return {
        action: 'drop',
        reason: 'duplicate_suppressed',
      };
    }
    this.markPacketSeen(packet.packetId);

    // 2. TTL Hop Check
    if (packet.hopCount >= packet.maxHops) {
      return {
        action: 'drop',
        reason: 'max_hops_exceeded',
      };
    }

    const isForMe = packet.destDid === this.localDid;
    const isBroadcast = packet.destDid === '*';

    // 3. Packet Delivery for Local Node
    if (isForMe) {
      this.deliveredPackets.push(packet);
      this.storedPackets.set(packet.packetId, packet);
      this.notifyListeners(packet);
      return {
        action: 'deliver',
        deliveredPacket: packet,
      };
    }

    // 4. Hyperlocal Channel Broadcast: Deliver locally AND forward to neighboring peers
    if (isBroadcast) {
      this.deliveredPackets.push(packet);
      this.storedPackets.set(packet.packetId, packet);
      this.notifyListeners(packet);

      if (packet.hopCount + 1 < packet.maxHops) {
        const forwardedPacket: BitChatPacket = {
          ...packet,
          hopCount: packet.hopCount + 1,
          route: [...packet.route, this.localDid],
        };
        return {
          action: 'deliver_and_forward',
          deliveredPacket: packet,
          forwardedPacket,
        };
      }

      return {
        action: 'deliver',
        deliveredPacket: packet,
      };
    }

    // 5. Multi-Hop Forwarding to Target Peer
    const forwardedPacket: BitChatPacket = {
      ...packet,
      hopCount: packet.hopCount + 1,
      route: [...packet.route, this.localDid],
    };

    return {
      action: 'forward',
      forwardedPacket,
    };
  }

  /**
   * Subscribe to incoming packets delivered to local node
   */
  public onMessage(callback: (packet: BitChatPacket) => void): () => void {
    this.onMessageCallbacks.push(callback);
    return () => {
      this.onMessageCallbacks = this.onMessageCallbacks.filter(cb => cb !== callback);
    };
  }

  public getDeliveredPackets(): BitChatPacket[] {
    return [...this.deliveredPackets];
  }

  /**
   * 🚨 Emergency Panic Wipe (BitChat Stealth Security)
   * Instantly zeroizes all in-memory peer routing tables, cached packets, and delivered history.
   */
  public panicWipe(): {
    wipedPacketsCount: number;
    wipedPeersCount: number;
    timestamp: number;
  } {
    const wipedPacketsCount = this.deliveredPackets.length + this.seenPackets.size;
    const wipedPeersCount = this.peers.size;

    this.peers.clear();
    this.seenPackets.clear();
    this.seenPacketsOrder = [];
    this.storedPackets.clear();
    this.deliveredPackets = [];
    this.onMessageCallbacks = [];

    return {
      wipedPacketsCount,
      wipedPeersCount,
      timestamp: Date.now(),
    };
  }

  private markPacketSeen(packetId: string): void {
    this.seenPackets.add(packetId);
    this.seenPacketsOrder.push(packetId);
    if (this.seenPacketsOrder.length > this.maxSeenCacheSize) {
      const oldest = this.seenPacketsOrder.shift();
      if (oldest) {
        this.seenPackets.delete(oldest);
      }
    }
  }

  private notifyListeners(packet: BitChatPacket): void {
    for (const callback of this.onMessageCallbacks) {
      try {
        callback(packet);
      } catch {
        // Suppress callback failure
      }
    }
  }
}
