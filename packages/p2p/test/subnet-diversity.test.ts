import { describe, it, expect } from 'vitest';
import { KademliaBucket, extractSubnetPrefix, MAX_PEERS_PER_SUBNET } from '../src/dht.js';
import { PeerInfo } from '../src/types.js';

describe('Anti-Eclipse IP Subnet Diversity Suite', () => {
  it('extracts subnet prefix correctly from multiaddrs', () => {
    expect(extractSubnetPrefix('/ip4/198.51.100.1/tcp/4001')).toBe('ip4:198.51.100');
    expect(extractSubnetPrefix('/ip4/198.51.100.42/tcp/4001')).toBe('ip4:198.51.100');
    expect(extractSubnetPrefix('/ip4/203.0.113.5/tcp/4001')).toBe('ip4:203.0.113');
    // Localhost loopback is excluded from quotas
    expect(extractSubnetPrefix('/ip4/127.0.0.1/tcp/4001')).toBeNull();
  });

  it('enforces maximum 2 peers per /24 subnet in a Kademlia bucket', () => {
    const bucket = new KademliaBucket();

    function createDummyPeer(id: string, ip: string): PeerInfo {
      return {
        id: { peerId: id, publicKeyHex: 'aabbcc' },
        addresses: [`/ip4/${ip}/tcp/4001/p2p/${id}`],
        status: 'connected',
        score: 100,
      };
    }

    // 1. First peer from subnet 198.51.100.0/24 -> accepted
    const peer1 = createDummyPeer('peer-1', '198.51.100.10');
    expect(bucket.addPeer(peer1)).toBe(true);
    expect(bucket.peers.length).toBe(1);

    // 2. Second peer from same subnet 198.51.100.0/24 -> accepted (quota = 2)
    const peer2 = createDummyPeer('peer-2', '198.51.100.25');
    expect(bucket.addPeer(peer2)).toBe(true);
    expect(bucket.peers.length).toBe(2);

    // 3. Third peer from same subnet 198.51.100.0/24 -> REJECTED (anti-eclipse)
    const peer3 = createDummyPeer('peer-3', '198.51.100.99');
    expect(bucket.addPeer(peer3)).toBe(false);
    expect(bucket.peers.length).toBe(2);

    // 4. Peer from a DIFFERENT subnet 203.0.113.0/24 -> accepted
    const peer4 = createDummyPeer('peer-4', '203.0.113.50');
    expect(bucket.addPeer(peer4)).toBe(true);
    expect(bucket.peers.length).toBe(3);
  });
});
