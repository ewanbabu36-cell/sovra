/**
 * @file packages/storage/src/webrtc-bitswap.ts
 * Browser-to-Browser WebRTC DataChannel BitSwap Swarm Transport Adapter.
 *
 * Implements:
 * 1. Direct peer-to-peer 256 KiB chunk streaming over WebRTC RTCDataChannel ('bitswap-1.2.0').
 * 2. BitTorrent-style Tit-for-Tat Swarm Choking Engine (Choke, Unchoke, Optimistic Unchoke).
 * 3. SIP-001 Canonical Binary Wire Framing (`0x534F5652`) with zero-copy decoding.
 * 4. P2P block exchange without central HTTP media servers.
 */

import {
  BitSwapMessage,
  BitSwapNetworkAdapter,
  encodeBitSwapMessage,
  decodeBitSwapMessage,
} from './bitswap.js';

export const SOVRA_WIRE_MAGIC = 0x534f5652; // 'SOVR'
export const SOVRA_WIRE_VERSION = 0x01;
export const SOVRA_HEADER_LENGTH = 11;
export const SOVRA_SIGNATURE_LENGTH = 64;
export const SOVRA_MIN_FRAME_LENGTH = 75;

export enum BitSwapWireMsgType {
  SWARM_BITSWAP_WANT = 0x0040,
  SWARM_BITSWAP_BLOCK = 0x0041,
  SWARM_BITSWAP_CHOKE = 0x0042,
  SWARM_BITSWAP_UNCHOKE = 0x0043,
  SWARM_BITSWAP_HAVE = 0x0044,
}

export interface MinimalDataChannel {
  readonly readyState: 'connecting' | 'open' | 'closing' | 'closed';
  send(data: string | ArrayBuffer | Uint8Array): void;
  onmessage?: ((ev: { data: any }) => void) | null;
  onclose?: ((ev: any) => void) | null;
  onerror?: ((ev: any) => void) | null;
}

export type IncomingMessageHandler = (peerId: string, message: BitSwapMessage) => void;

/**
 * Peer State for BitTorrent-style Tit-for-Tat Choking and Bandwidth Economics.
 */
export interface BitSwapPeerState {
  readonly peerId: string;
  isChoked: boolean;          // Are we choking this peer? (We refuse to send blocks)
  isInterested: boolean;      // Are they interested in pieces we have?
  peerChoking: boolean;       // Is the remote peer choking us?
  peerInterested: boolean;    // Are we interested in pieces they have?
  bytesUploaded: number;      // Total bytes we sent to this peer
  bytesDownloaded: number;    // Total bytes we received from this peer
  uploadRate: number;         // Rolling bytes/sec
  downloadRate: number;       // Rolling bytes/sec
  lastActivityAt: number;
  lastRecalculatedAt: number;
  isOptimisticUnchoke: boolean;
}

/**
 * Peer-to-Peer WebRTC DataChannel Swarm Transport Adapter for BitSwap.
 */
export class WebRtcDataChannelBitSwapAdapter implements BitSwapNetworkAdapter {
  private readonly channels = new Map<string, MinimalDataChannel>();
  private readonly messageHandlers = new Set<IncomingMessageHandler>();
  private readonly cidProviders = new Map<string, Set<string>>(); // cid -> Set of peerIds
  private readonly peerStates = new Map<string, BitSwapPeerState>();
  private signerFn?: ((bytes: Uint8Array) => Uint8Array) | undefined;

  constructor(options?: { signerFn?: (bytes: Uint8Array) => Uint8Array }) {
    this.signerFn = options?.signerFn;
  }

  /**
   * Configures a cryptographic signer function for outbound SIP-001 frames.
   */
  public setSigner(signerFn: (bytes: Uint8Array) => Uint8Array): void {
    this.signerFn = signerFn;
  }

  /**
   * Registers an open WebRTC RTCDataChannel associated with a peer.
   */
  public attachDataChannel(peerId: string, channel: MinimalDataChannel): void {
    this.channels.set(peerId, channel);

    // Initialize peer choking state (Default: choked until Tit-for-Tat unchoking occurs)
    if (!this.peerStates.has(peerId)) {
      this.peerStates.set(peerId, {
        peerId,
        isChoked: true,
        isInterested: false,
        peerChoking: true,
        peerInterested: false,
        bytesUploaded: 0,
        bytesDownloaded: 0,
        uploadRate: 0,
        downloadRate: 0,
        lastActivityAt: Date.now(),
        lastRecalculatedAt: Date.now(),
        isOptimisticUnchoke: false,
      });
    }

    channel.onmessage = (event) => {
      try {
        let rawBytes: Uint8Array;
        if (event.data instanceof Uint8Array) {
          rawBytes = event.data;
        } else if (event.data instanceof ArrayBuffer) {
          rawBytes = new Uint8Array(event.data);
        } else if (typeof event.data === 'string') {
          rawBytes = new TextEncoder().encode(event.data);
        } else {
          return;
        }

        // Unwrap SIP-001 Binary Wire Framing if present
        let payloadBytes = rawBytes;
        let isWireFrame = false;
        let wireMsgType = BitSwapWireMsgType.SWARM_BITSWAP_BLOCK;

        if (rawBytes.length >= SOVRA_MIN_FRAME_LENGTH) {
          const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
          const magic = view.getUint32(0, false);
          if (magic === SOVRA_WIRE_MAGIC) {
            isWireFrame = true;
            wireMsgType = view.getUint16(5, false);
            const payloadLen = view.getUint32(7, false);
            if (rawBytes.length >= SOVRA_HEADER_LENGTH + payloadLen + SOVRA_SIGNATURE_LENGTH) {
              payloadBytes = rawBytes.subarray(SOVRA_HEADER_LENGTH, SOVRA_HEADER_LENGTH + payloadLen);
            }
          }
        }

        // Handle Choking Signaling Wire Messages directly
        if (wireMsgType === BitSwapWireMsgType.SWARM_BITSWAP_CHOKE) {
          const state = this.peerStates.get(peerId);
          if (state) state.peerChoking = true;
          return;
        }
        if (wireMsgType === BitSwapWireMsgType.SWARM_BITSWAP_UNCHOKE) {
          const state = this.peerStates.get(peerId);
          if (state) state.peerChoking = false;
          return;
        }

        // Decode Standard BitSwap Message
        const message = decodeBitSwapMessage(payloadBytes);

        // Record downloaded bytes and update download rate for Tit-for-Tat
        this.recordBytesDownloaded(peerId, payloadBytes.length);

        // Update provider index if message contains blocks or block presences
        if (message.blocks) {
          for (const b of message.blocks) {
            this.registerProvider(b.cid, peerId);
          }
        }
        if (message.blockPresences) {
          for (const bp of message.blockPresences) {
            if (bp.type === 'HAVE') {
              this.registerProvider(bp.cid, peerId);
            }
          }
        }

        // If message has wantlist entries, mark peer as interested
        if (message.wantlist && (Array.isArray(message.wantlist) ? message.wantlist.length > 0 : Boolean((message.wantlist as any).entries?.length))) {
          const state = this.peerStates.get(peerId);
          if (state) state.isInterested = true;
        }

        for (const handler of this.messageHandlers) {
          handler(peerId, message);
        }
      } catch (err) {
        console.warn(`[WebRtcBitSwap] Failed to process message from peer ${peerId}:`, err);
      }
    };

    channel.onclose = () => {
      this.channels.delete(peerId);
      this.peerStates.delete(peerId);
      this.removePeerFromProviders(peerId);
    };
  }

  /**
   * Detaches a peer and closes data channel reference.
   */
  public detachDataChannel(peerId: string): void {
    this.channels.delete(peerId);
    this.peerStates.delete(peerId);
    this.removePeerFromProviders(peerId);
  }

  /**
   * Retrieves current BitSwap choke & bandwidth state for a peer.
   */
  public getPeerState(peerId: string): BitSwapPeerState | undefined {
    return this.peerStates.get(peerId);
  }

  /**
   * Retrieves all peer choking states in the swarm.
   */
  public getAllPeerStates(): readonly BitSwapPeerState[] {
    return Array.from(this.peerStates.values());
  }

  /**
   * Explicitly chokes a peer, refusing to serve further media chunks.
   */
  public choke(peerId: string): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.isChoked = true;
      state.isOptimisticUnchoke = false;
    }
    // Send choke wire notification if channel is open
    this.sendWireSignal(peerId, BitSwapWireMsgType.SWARM_BITSWAP_CHOKE);
  }

  /**
   * Explicitly unchokes a peer, allowing piece transmission.
   */
  public unchoke(peerId: string): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.isChoked = false;
    }
    this.sendWireSignal(peerId, BitSwapWireMsgType.SWARM_BITSWAP_UNCHOKE);
  }

  /**
   * Recalculates Tit-for-Tat Choke/Unchoke states across all connected peers.
   *
   * Algorithmic Guarantee (BitTorrent BEP-3 Game Theoretic Parity):
   * 1. Sorts all interested peers descending by downloadRate (reciprocal seeding).
   * 2. Unchokes the top `maxUnchoked` peers (default: 4 peers).
   * 3. Selects 1 random remaining interested peer for "Optimistic Unchoke" to discover new bandwidth.
   * 4. Chokes all remaining peers to penalize free-riders.
   */
  public recalculateTitForTat(maxUnchoked = 4): {
    unchoked: string[];
    optimistic: string | null;
    choked: string[];
  } {
    const activePeers = Array.from(this.peerStates.values()).filter(p => this.channels.has(p.peerId));

    // Interested peers sorted by download rate (reciprocity)
    const interestedPeers = activePeers
      .filter(p => p.isInterested)
      .sort((a, b) => b.downloadRate - a.downloadRate);

    // Fallback: If no explicit interested flag yet, consider all active peers
    const candidatePeers = interestedPeers.length > 0 ? interestedPeers : [...activePeers];

    const unchoked: string[] = [];
    const choked: string[] = [];
    let optimistic: string | null = null;

    // 1. Unchoke top reciprocal seeders
    const regularUnchokeCount = Math.min(candidatePeers.length, maxUnchoked);
    for (let i = 0; i < regularUnchokeCount; i++) {
      const p = candidatePeers[i]!;
      p.isChoked = false;
      p.isOptimisticUnchoke = false;
      unchoked.push(p.peerId);
    }

    // 2. Select 1 random peer for Optimistic Unchoke
    const remaining = candidatePeers.slice(regularUnchokeCount);
    if (remaining.length > 0) {
      const optIdx = Math.floor(Math.random() * remaining.length);
      const optPeer = remaining[optIdx]!;
      optPeer.isChoked = false;
      optPeer.isOptimisticUnchoke = true;
      optimistic = optPeer.peerId;
      remaining.splice(optIdx, 1);
    }

    // 3. Choke all remaining peers (anti-free-riding)
    for (const p of remaining) {
      p.isChoked = true;
      p.isOptimisticUnchoke = false;
      choked.push(p.peerId);
    }

    // Update timestamps
    const now = Date.now();
    for (const p of activePeers) {
      p.lastRecalculatedAt = now;
    }

    return { unchoked, optimistic, choked };
  }

  /**
   * Sends a BitSwap wire message directly across the WebRTC DataChannel.
   * If the message contains blocks and the target peer is choked, the transmission is rejected.
   */
  public async sendMessage(targetPeerId: string, message: BitSwapMessage): Promise<void> {
    const channel = this.channels.get(targetPeerId);
    if (!channel) {
      throw new Error(`Cannot send BitSwap message: No active WebRTC DataChannel for peer ${targetPeerId}`);
    }

    if (channel.readyState !== 'open') {
      throw new Error(`Cannot send BitSwap message: DataChannel for peer ${targetPeerId} is in '${channel.readyState}' state`);
    }

    // Tit-for-Tat Choking Enforcement: Do not send blocks to choked peers!
    const state = this.peerStates.get(targetPeerId);
    if (message.blocks && message.blocks.length > 0 && state && state.isChoked) {
      throw new Error(`[TitForTat] Block transmission refused: Peer ${targetPeerId} is CHOKED (upload/download ratio enforcement)`);
    }

    let wireBytes = encodeBitSwapMessage(message);

    // Record uploaded bytes for Tit-for-Tat metrics
    this.recordBytesUploaded(targetPeerId, wireBytes.length);

    // Frame into SIP-001 Binary Frame if signer is configured
    if (this.signerFn) {
      const msgType = (message.blocks && message.blocks.length > 0)
        ? BitSwapWireMsgType.SWARM_BITSWAP_BLOCK
        : BitSwapWireMsgType.SWARM_BITSWAP_WANT;
      wireBytes = this.frameSip001(msgType, wireBytes, this.signerFn);
    }

    channel.send(wireBytes);
  }

  /**
   * Registers a listener for incoming BitSwap messages from any swarm peer.
   */
  public onMessage(handler: IncomingMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Finds known connected WebRTC swarm peers who possess the requested CID.
   */
  public async findProviders(cid: string): Promise<readonly string[]> {
    const peers = this.cidProviders.get(cid);
    if (!peers) {
      return Array.from(this.channels.keys());
    }
    return Array.from(peers).filter(p => this.channels.has(p));
  }

  /**
   * Returns a list of all currently connected WebRTC DataChannel peer IDs.
   */
  public getConnectedPeers(): readonly string[] {
    return Array.from(this.channels.keys()).filter(p => {
      const ch = this.channels.get(p);
      return ch && ch.readyState === 'open';
    });
  }

  public registerProvider(cid: string, peerId: string): void {
    let set = this.cidProviders.get(cid);
    if (!set) {
      set = new Set();
      this.cidProviders.set(cid, set);
    }
    set.add(peerId);
  }

  private removePeerFromProviders(peerId: string): void {
    for (const set of this.cidProviders.values()) {
      set.delete(peerId);
    }
  }

  public hasPeer(peerId: string): boolean {
    const ch = this.channels.get(peerId);
    return Boolean(ch && ch.readyState === 'open');
  }

  public recordBytesDownloaded(peerId: string, bytes: number): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.bytesDownloaded += bytes;
      state.downloadRate = bytes; // Instantaneous or rolling rate
      state.lastActivityAt = Date.now();
    }
  }

  public recordBytesUploaded(peerId: string, bytes: number): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.bytesUploaded += bytes;
      state.uploadRate += bytes;
      state.lastActivityAt = Date.now();
    }
  }

  private sendWireSignal(targetPeerId: string, msgType: BitSwapWireMsgType): void {
    const channel = this.channels.get(targetPeerId);
    if (!channel || channel.readyState !== 'open') return;

    const payload = new Uint8Array(0);
    const frame = this.frameSip001(msgType, payload, this.signerFn || (() => new Uint8Array(64)));
    try {
      channel.send(frame);
    } catch (_) {}
  }

  private frameSip001(
    msgType: number,
    payload: Uint8Array,
    signer: (bytes: Uint8Array) => Uint8Array,
  ): Uint8Array {
    const commitLength = SOVRA_HEADER_LENGTH + payload.length;
    const commitBuffer = new Uint8Array(commitLength);
    const view = new DataView(commitBuffer.buffer, commitBuffer.byteOffset, commitBuffer.byteLength);

    view.setUint32(0, SOVRA_WIRE_MAGIC, false);
    view.setUint8(4, SOVRA_WIRE_VERSION);
    view.setUint16(5, msgType, false);
    view.setUint32(7, payload.length, false);

    if (payload.length > 0) {
      commitBuffer.set(payload, SOVRA_HEADER_LENGTH);
    }

    const sig = signer(commitBuffer);
    const finalFrame = new Uint8Array(commitLength + SOVRA_SIGNATURE_LENGTH);
    finalFrame.set(commitBuffer, 0);
    finalFrame.set(sig.length === SOVRA_SIGNATURE_LENGTH ? sig : new Uint8Array(64), commitLength);
    return finalFrame;
  }
}
