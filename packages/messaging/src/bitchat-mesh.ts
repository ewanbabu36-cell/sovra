/**
 * BitChat Zero-Internet Offline Mesh Protocol Engine for Sovra
 *
 * Implements ad-hoc peer-to-peer mesh routing over Bluetooth Low Energy (BLE)
 * and local ad-hoc links. Enables multi-hop message relaying, hyperlocal public channels,
 * RSSI distance approximation, duplicate packet suppression, and instant emergency panic wiping.
 */

export interface BitChatPeer {
  readonly did: string;
  readonly displayName: string;
  readonly rssi: number; // Signal strength in dBm (e.g. -45 dBm)
  readonly distanceMeters: number; // Approximated distance from RSSI
  readonly hops: number; // 1 = direct link, >1 = relayed multi-hop
  readonly relayVia?: string; // DID of the intermediate relay peer
  readonly isDirect: boolean;
  readonly lastSeen: number;
}

export interface BitChatPacket {
  readonly packetId: string;
  readonly sourceDid: string;
  readonly sourceName: string;
  readonly destDid: string; // Specific recipient DID or '*' for broadcast
  readonly channel?: string; // Hyperlocal channel (e.g. '#local-mesh', '#emergency-sos')
  readonly payload: string; // Encrypted payload or broadcast message
  readonly hopCount: number; // Current hop count (increments at each relay)
  readonly maxHops: number; // TTL limit to prevent infinite loops (standard = 7)
  readonly route: readonly string[]; // Audit path of node DIDs traversed
  readonly timestamp: number;
  readonly isEmergency?: boolean;
}

export interface BitChatChannel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isEmergency: boolean;
  readonly memberCount: number;
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
  private readonly maxSeenCacheSize = 2000;

  private deliveredPackets: BitChatPacket[] = [];
  private onMessageCallbacks: Array<(packet: BitChatPacket) => void> = [];

  constructor(localDid: string, localName: string, defaultMaxHops: number = 7) {
    this.localDid = localDid;
    this.localName = localName;
    this.defaultMaxHops = defaultMaxHops;
  }

  /**
   * Registers or updates a discovered BLE / ad-hoc mesh peer
   */
  public registerPeer(peer: BitChatPeer): void {
    this.peers.set(peer.did, peer);
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
    const packetId = 'pkt_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
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
      this.notifyListeners(packet);
      return {
        action: 'deliver',
        deliveredPacket: packet,
      };
    }

    // 4. Hyperlocal Channel Broadcast: Deliver locally AND forward to neighboring peers
    if (isBroadcast) {
      this.deliveredPackets.push(packet);
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
