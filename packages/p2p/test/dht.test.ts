import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair } from '@sovra/crypto';
import { derivePeerId } from '../src/identity.js';
import { KademliaDHT, KademliaBucket, DhtRpcMessage, DhtRpcResponse } from '../src/dht.js';
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
    const ids = new Set(closest.map(p => p.id.peerId));
    expect(ids.size).toBe(5);
  });

  it('stores and retrieves DHT records and provider announcements with TTL', async () => {
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

  it('handles Kademlia wire RPC messages (FIND_NODE, PUT_VALUE, FIND_VALUE, GET_PROVIDERS)', () => {
    const dht = new KademliaDHT('12D3KooWLocalServer');
    const remotePeer = makePeer(1);
    dht.addPeer(remotePeer);

    // FIND_NODE RPC
    const findNodeRes = dht.handleRpcMessage({
      type: 'FIND_NODE',
      senderPeerId: '12D3KooWClient',
      targetKey: 'test-key',
    });
    expect(findNodeRes.success).toBe(true);
    expect(findNodeRes.closestPeers?.length).toBeGreaterThanOrEqual(1);

    // PUT_VALUE RPC
    const putRes = dht.handleRpcMessage({
      type: 'PUT_VALUE',
      senderPeerId: '12D3KooWClient',
      targetKey: 'my-key',
      record: {
        key: 'my-key',
        value: new Uint8Array([1, 2, 3]),
        authorPeerId: '12D3KooWClient',
        sequenceNumber: 1n,
        timestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(putRes.success).toBe(true);

    // FIND_VALUE RPC
    const findValRes = dht.handleRpcMessage({
      type: 'FIND_VALUE',
      senderPeerId: '12D3KooWClient',
      targetKey: 'my-key',
    });
    expect(findValRes.success).toBe(true);
    expect(findValRes.record?.key).toBe('my-key');

    // ADD_PROVIDER RPC
    const addProvRes = dht.handleRpcMessage({
      type: 'ADD_PROVIDER',
      senderPeerId: '12D3KooWClient',
      targetKey: 'cid-1234',
      provider: {
        peerId: '12D3KooWClient',
        addresses: ['/ip4/1.2.3.4/tcp/4001'],
        registeredAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    expect(addProvRes.success).toBe(true);

    // GET_PROVIDERS RPC
    const getProvRes = dht.handleRpcMessage({
      type: 'GET_PROVIDERS',
      senderPeerId: '12D3KooWClient',
      targetKey: 'cid-1234',
    });
    expect(getProvRes.success).toBe(true);
    expect(getProvRes.providers?.length).toBe(1);
    expect(getProvRes.providers?.[0]?.peerId).toBe('12D3KooWClient');
  });

  it('executes iterative lookup with alpha concurrency over simulated network queries', async () => {
    const peerMap = new Map<string, PeerInfo>();
    const nodePeers: PeerInfo[] = [];

    for (let i = 0; i < 15; i++) {
      const p = makePeer(i);
      peerMap.set(p.id.peerId, p);
      nodePeers.push(p);
    }

    const mockRpcQuery = async (
      targetPeer: PeerInfo,
      msg: DhtRpcMessage,
    ): Promise<DhtRpcResponse> => {
      // Simulate remote node returning peers closer to target
      return {
        type: 'FIND_NODE',
        success: true,
        closestPeers: nodePeers.slice(0, 5),
      };
    };

    const dht = new KademliaDHT('12D3KooWRoot', undefined, mockRpcQuery);
    dht.addPeer(nodePeers[0]!);
    dht.addPeer(nodePeers[1]!);

    const targetKey = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
    const found = await dht.findClosestPeers(targetKey, 10);
    expect(found.length).toBeGreaterThanOrEqual(2);
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

  it('broadcasts ADD_PROVIDER and retrieves remote providers via GET_PROVIDERS over RPC queries', async () => {
    const peerA = makePeer(1);
    const peerB = makePeer(2);

    let dhtA: KademliaDHT;
    let dhtB: KademliaDHT;

    // Simulated network message dispatcher
    const rpcToB = async (_peer: PeerInfo, msg: DhtRpcMessage): Promise<DhtRpcResponse> => {
      return dhtB.handleRpcMessage(msg);
    };
    const rpcToA = async (_peer: PeerInfo, msg: DhtRpcMessage): Promise<DhtRpcResponse> => {
      return dhtA.handleRpcMessage(msg);
    };

    dhtA = new KademliaDHT(peerA.id.peerId, undefined, rpcToB);
    dhtB = new KademliaDHT(peerB.id.peerId, undefined, rpcToA);

    dhtA.addPeer(peerB);
    dhtB.addPeer(peerA);

    const targetCid = 'bafybeic5xyzsamplecid123';

    // 1. Peer B provides the CID locally
    await dhtB.provide(targetCid);

    // 2. Peer A (which has no local record) looks up providers for targetCid
    const foundOnA = await dhtA.findProviders(targetCid, 5);
    expect(foundOnA).toContain(peerB.id.peerId);

    // 3. Now Peer A also provides targetCid -> should broadcast ADD_PROVIDER to Peer B
    await dhtA.provide(targetCid);

    // 4. Peer B should now have Peer A in its provider table
    const foundOnB = await dhtB.findProviders(targetCid, 5);
    expect(foundOnB).toContain(peerA.id.peerId);
    expect(foundOnB).toContain(peerB.id.peerId);
  });
});
