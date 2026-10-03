import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair } from '@sovra/crypto';
import { derivePeerId } from '../src/identity.js';
import { KademliaDHT, KademliaBucket } from '../src/dht.js';
import { PeerInfo } from '../src/types.js';

describe('P2P Kademlia DHT & Routing Suite', () => {
  function makePeer(seed: number): PeerInfo {
    const pair = generateEd25519KeyPair();
    const peerId = derivePeerId(pair.publicKey);
    return {
      id: { peerId, publicKeyHex: '' },
      addresses: [`/ip4/127.0.0.1/tcp/${4000 + seed}/p2p/${peerId}`],
      status: 'connected',
      score: 10,
    };
  }

  it('manages k-buckets with 20-peer capacity and handles stale peer replacement', () => {
    const bucket = new KademliaBucket();
    const peers: PeerInfo[] = [];

    // Fill bucket with 20 peers
    for (let i = 0; i < 20; i++) {
      const p = makePeer(i);
      peers.push(p);
      const added = bucket.addPeer(p);
      expect(added).toBe(true);
    }
    expect(bucket.peers.length).toBe(20);

    // 21st peer arrives:
    // Case A: Oldest peer (head) is STILL responsive -> new peer is rejected
    const newPeerA = makePeer(99);
    const responsiveCheck = (_peer: PeerInfo) => true;
    const addedWhenResponsive = bucket.addPeer(newPeerA, responsiveCheck);
    expect(addedWhenResponsive).toBe(false);
    expect(bucket.peers.length).toBe(20);

    // Case B: Oldest peer is DEAD / UNRESPONSIVE -> oldest peer is evicted, new peer added
    const deadCheck = (peer: PeerInfo) => peer.id.peerId !== peers[0]?.id.peerId;
    const addedWhenDead = bucket.addPeer(newPeerA, deadCheck);
    expect(addedWhenDead).toBe(true);
    expect(bucket.peers.length).toBe(20);
    // Verified that oldest peer was evicted
    expect(bucket.peers.some(p => p.id.peerId === peers[0]?.id.peerId)).toBe(false);
    expect(bucket.peers.some(p => p.id.peerId === newPeerA.id.peerId)).toBe(true);
  });

  it('sorts closest peers by 256-bit XOR metric', async () => {
    const localPair = generateEd25519KeyPair();
    const localPeerId = derivePeerId(localPair.publicKey);
    const dht = new KademliaDHT(localPeerId);

    for (let i = 0; i < 30; i++) {
      dht.addPeer(makePeer(i));
    }

    const targetKey = 'sovra:content:QmSampleContentHash123';
    const closest = await dht.findClosestPeers(targetKey, 5);

    expect(closest.length).toBe(5);
    // Verify results are distinct
    const ids = new Set(closest.map(p => p.id.peerId));
    expect(ids.size).toBe(5);
  });

  it('stores and retrieves DHT records and provider announcements', async () => {
    const pair = generateEd25519KeyPair();
    const localPeerId = derivePeerId(pair.publicKey);
    const dht = new KademliaDHT(localPeerId);

    const recordKey = '/sovra/providers/bafybeic5xyz';
    const recordVal = new TextEncoder().encode('Provider record payload');

    const putRes = await dht.putValue(recordKey, recordVal);
    expect(putRes.ok).toBe(true);

    const getRes = await dht.getValue(recordKey);
    expect(getRes.ok).toBe(true);
    expect(getRes.value?.value).toEqual(recordVal);
    expect(getRes.value?.authorPeerId).toBe(localPeerId);

    // Provider announcement
    await dht.provide(recordKey);
    const providers = await dht.findProviders(recordKey);
    expect(providers).toContain(localPeerId);
  });

  it('evaluates multi-bootstrap candidate sequence with failover semantics', () => {
    const dht = new KademliaDHT('12D3KooWLocal', {
      bootstrapNodes: ['/dns4/bootstrap-a.sovra.network/tcp/4001/p2p/12D3KooWA'],
      communityNodes: ['/dns4/community.node.org/tcp/4001/p2p/12D3KooWComm'],
      userConfiguredNodes: ['/ip4/192.168.1.50/tcp/4001/p2p/12D3KooWUser'],
      cachedKnownPeers: ['/ip4/10.0.0.2/tcp/4001/p2p/12D3KooWCached'],
    });

    const candidates = dht.getOrderedBootstrapCandidates();
    expect(candidates.length).toBe(4);
    expect(candidates[0]).toContain('12D3KooWA');
    expect(candidates[1]).toContain('12D3KooWComm');
    expect(candidates[2]).toContain('12D3KooWUser');
    expect(candidates[3]).toContain('12D3KooWCached');
  });
});
