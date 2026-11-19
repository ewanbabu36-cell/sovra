/**
 * @file packages/storage/src/webrtc-bitswap.ts
 * Browser-to-Browser WebRTC DataChannel BitSwap Swarm Transport Adapter.
 *
 * Implements direct peer-to-peer 256 KiB chunk streaming over WebRTC RTCDataChannel
 * (labeled 'bitswap-1.2.0'), allowing mobile and browser nodes to exchange 4K video,
 * photos, and reels directly without passing through centralized HTTP servers.
 */

import {
  BitSwapMessage,
  BitSwapNetworkAdapter,
  encodeBitSwapMessage,
  decodeBitSwapMessage,
} from './bitswap.js';

export interface MinimalDataChannel {
  readonly readyState: 'connecting' | 'open' | 'closing' | 'closed';
  send(data: string | ArrayBuffer | Uint8Array): void;
  onmessage?: ((ev: { data: any }) => void) | null;
  onclose?: ((ev: any) => void) | null;
  onerror?: ((ev: any) => void) | null;
}

export type IncomingMessageHandler = (peerId: string, message: BitSwapMessage) => void;

/**
 * Peer-to-Peer WebRTC DataChannel Swarm Transport Adapter for BitSwap.
 */
export class WebRtcDataChannelBitSwapAdapter implements BitSwapNetworkAdapter {
  private readonly channels = new Map<string, MinimalDataChannel>();
  private readonly messageHandlers = new Set<IncomingMessageHandler>();
  private readonly cidProviders = new Map<string, Set<string>>(); // cid -> Set of peerIds

  /**
   * Registers an open WebRTC RTCDataChannel associated with a peer.
   */
  public attachDataChannel(peerId: string, channel: MinimalDataChannel): void {
    this.channels.set(peerId, channel);

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

        const message = decodeBitSwapMessage(rawBytes);

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

        for (const handler of this.messageHandlers) {
          handler(peerId, message);
        }
      } catch (err) {
        console.warn(`[WebRtcBitSwap] Failed to process message from peer ${peerId}:`, err);
      }
    };

    channel.onclose = () => {
      this.channels.delete(peerId);
      this.removePeerFromProviders(peerId);
    };
  }

  /**
   * Detaches a peer and closes data channel reference.
   */
  public detachDataChannel(peerId: string): void {
    this.channels.delete(peerId);
    this.removePeerFromProviders(peerId);
  }

  /**
   * Sends a BitSwap wire message directly across the WebRTC DataChannel.
   */
  public async sendMessage(targetPeerId: string, message: BitSwapMessage): Promise<void> {
    const channel = this.channels.get(targetPeerId);
    if (!channel) {
      throw new Error(`Cannot send BitSwap message: No active WebRTC DataChannel for peer ${targetPeerId}`);
    }

    if (channel.readyState !== 'open') {
      throw new Error(`Cannot send BitSwap message: DataChannel for peer ${targetPeerId} is in '${channel.readyState}' state`);
    }

    const wireBytes = encodeBitSwapMessage(message);
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
      // Fallback: return all currently active peers if specific provider unknown
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
}
