/**
 * @file packages/protocol/src/peer.ts
 * Generic Decentralized Peer Model & Abstraction.
 *
 * Decouples peer identity from transient physical addresses
 * (IP addresses, MAC addresses, hostnames, socket handles).
 */

import { TransportType } from './envelope.js';

export type PeerTrustState = 'UNTRUSTED' | 'VERIFIED' | 'SUSPICIOUS' | 'REVOKED';
export type PeerConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export interface PeerDescriptor {
  readonly peerId: string; // Cryptographic Node/Peer ID (e.g. 12D3KooW...)
  readonly deviceDid?: string | undefined; // W3C did:key of physical device
  readonly userDid?: string | undefined; // W3C did:key of user controller
  readonly supportedProtocolVersions: readonly string[]; // e.g. ["1.0"]
  readonly supportedTransports: readonly TransportType[];
  readonly capabilities: readonly string[];
  readonly lastSeen: number; // Unix timestamp
  readonly trustState: PeerTrustState;
  readonly connectionState: PeerConnectionState;
  readonly activeTransports: readonly TransportType[];
}

export class PeerRegistry {
  private readonly peers = new Map<string, PeerDescriptor>();

  public registerPeer(descriptor: PeerDescriptor): void {
    this.peers.set(descriptor.peerId, descriptor);
  }

  public getPeer(peerId: string): PeerDescriptor | undefined {
    return this.peers.get(peerId);
  }

  public updateLastSeen(peerId: string, timestamp = Date.now()): void {
    const existing = this.peers.get(peerId);
    if (existing) {
      this.peers.set(peerId, {
        ...existing,
        lastSeen: timestamp,
      });
    }
  }

  public updateTrustState(peerId: string, trustState: PeerTrustState): void {
    const existing = this.peers.get(peerId);
    if (existing) {
      this.peers.set(peerId, {
        ...existing,
        trustState,
      });
    }
  }

  public updateConnectionState(peerId: string, connectionState: PeerConnectionState, activeTransports: TransportType[] = []): void {
    const existing = this.peers.get(peerId);
    if (existing) {
      this.peers.set(peerId, {
        ...existing,
        connectionState,
        activeTransports,
      });
    }
  }

  public listPeers(filter?: { trustState?: PeerTrustState; transport?: TransportType }): readonly PeerDescriptor[] {
    let list = Array.from(this.peers.values());
    if (filter?.trustState) {
      list = list.filter(p => p.trustState === filter.trustState);
    }
    if (filter?.transport) {
      list = list.filter(p => p.supportedTransports.includes(filter.transport!));
    }
    return list;
  }
}
