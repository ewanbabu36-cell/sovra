import { describe, it, expect } from 'vitest';
import {
  rankMultiaddrsZeroDomainFirst,
  getZeroDomainBootstrapMultiaddrs,
  PeerDiscoveryManager,
} from '../../packages/p2p/src/index.js';
import { multiRelayManager } from '../../apps/sovra-mobile/src/services/multi-relay-manager.js';
import { getIceServers } from '../../scripts/dev-server.ts';

describe('Zero-Domain & Zero-Hosting Speed Routing Optimizations', () => {
  it('ranks direct IPv6/IPv4/QUIC multiaddrs ahead of DNS relays', () => {
    const samplePeer = '12D3KooWFttriL8bpBR4xjjG6wHZDvM49zVmcJgneyCZaanXSyAX';
    const ranked = rankMultiaddrsZeroDomainFirst([
      `/dns4/relay.sovra.network/tcp/4001/p2p/${samplePeer}`,
      `/ip4/203.0.113.5/tcp/4001/p2p/${samplePeer}`,
      `/ip6/2001:db8::1/udp/4001/quic-v1/p2p/${samplePeer}`,
      `/ip4/127.0.0.1/tcp/4001/p2p/${samplePeer}`,
    ]);

    expect(ranked[0]).toContain('/ip4/127.0.0.1/');
    expect(ranked[1]).toContain('/ip6/2001:db8::1/udp/4001/quic-v1/');
    expect(ranked[2]).toContain('/ip4/203.0.113.5/');
    expect(ranked[3]).toContain('/dns4/relay.sovra.network/');

    const zeroDomainOnly = getZeroDomainBootstrapMultiaddrs(
      [`/ip6/2001:db8::9/udp/4001/quic-v1/p2p/${samplePeer}`],
      false,
    );
    expect(zeroDomainOnly.every(m => !m.startsWith('/dns'))).toBe(true);
  });

  it('maintains a hot peer latency cache in PeerDiscoveryManager and orders addresses direct-first', async () => {
    const manager = new PeerDiscoveryManager([
      '/dns4/seed1.sovra.network/tcp/4001/p2p/12D3KooWK7mLT13wivti3cvacLhhjtubMeZqU44T4ePW8Qj4Ng4E',
      '/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWFttriL8bpBR4xjjG6wHZDvM49zVmcJgneyCZaanXSyAX',
    ]);
    await manager.startDiscovery();

    manager.recordPeerLatency('12D3KooWK7mLT13wivti3cvacLhhjtubMeZqU44T4ePW8Qj4Ng4E', 240);
    manager.recordPeerLatency('12D3KooWFttriL8bpBR4xjjG6wHZDvM49zVmcJgneyCZaanXSyAX', 12);

    const fastest = manager.getFastestPeers(2);
    expect(fastest).toHaveLength(2);
    expect(fastest[0]!.id.peerId).toBe('12D3KooWFttriL8bpBR4xjjG6wHZDvM49zVmcJgneyCZaanXSyAX');

    await manager.stopDiscovery();
  });

  it('detects zero-domain direct relays and includes Cloudflare Anycast dual-stack STUN', () => {
    expect(multiRelayManager.isZeroDomainRelay('http://127.0.0.1:3001')).toBe(true);
    expect(multiRelayManager.isZeroDomainRelay('http://localhost:3001')).toBe(true);
    expect(multiRelayManager.isZeroDomainRelay('http://sovraabcd.onion')).toBe(true);
    expect(multiRelayManager.isZeroDomainRelay('https://seed1.sovra.network')).toBe(false);

    const iceServers = getIceServers();
    expect(
      iceServers.some(s => typeof s.urls === 'string' && s.urls.includes('stun.cloudflare.com')),
    ).toBe(true);
  });
});
