import { describe, it, expect } from 'vitest';
import { BitChatMeshRouter, BitChatPeer } from '../src/bitchat-mesh.js';

describe('BitChatMeshRouter Unit Suite', () => {
  const aliceDid = 'did:sovra:alice_ble';
  const bobDid = 'did:sovra:bob_ble';
  const charlieDid = 'did:sovra:charlie_ble';
  const daveDid = 'did:sovra:dave_ble';

  it('registers direct and relayed mesh peers with RSSI distance metrics', () => {
    const router = new BitChatMeshRouter(aliceDid, 'Alice');

    const bobPeer: BitChatPeer = {
      did: bobDid,
      displayName: 'Bob (BLE Direct)',
      rssi: -42,
      distanceMeters: 2.5,
      hops: 1,
      isDirect: true,
      lastSeen: Date.now(),
    };

    const charliePeer: BitChatPeer = {
      did: charlieDid,
      displayName: 'Charlie (2 Hops)',
      rssi: -78,
      distanceMeters: 18.0,
      hops: 2,
      relayVia: bobDid,
      isDirect: false,
      lastSeen: Date.now(),
    };

    router.registerPeer(bobPeer);
    router.registerPeer(charliePeer);

    expect(router.getAllPeers().length).toBe(2);
    expect(router.getDirectPeers().length).toBe(1);
    expect(router.getDirectPeers()[0]?.did).toBe(bobDid);
    expect(router.getRelayedPeers().length).toBe(1);
    expect(router.getRelayedPeers()[0]?.did).toBe(charlieDid);
  });

  it('creates packets with zero hop count and adds local node to audit route', () => {
    const router = new BitChatMeshRouter(aliceDid, 'Alice');
    const packet = router.createPacket(bobDid, 'Hello Bob via BitChat BLE');

    expect(packet.sourceDid).toBe(aliceDid);
    expect(packet.sourceName).toBe('Alice');
    expect(packet.destDid).toBe(bobDid);
    expect(packet.payload).toBe('Hello Bob via BitChat BLE');
    expect(packet.hopCount).toBe(0);
    expect(packet.maxHops).toBe(7);
    expect(packet.route).toEqual([aliceDid]);
  });

  it('delivers direct messages when destination is local DID', () => {
    const router = new BitChatMeshRouter(bobDid, 'Bob');
    const packet = {
      packetId: 'pkt_test_123',
      sourceDid: aliceDid,
      sourceName: 'Alice',
      destDid: bobDid,
      payload: 'Secret Noise_XX Encrypted BLE Message',
      hopCount: 1,
      maxHops: 7,
      route: [aliceDid],
      timestamp: Date.now(),
    };

    let deliveredPacketReceived = false;
    router.onMessage(p => {
      if (p.packetId === packet.packetId) {
        deliveredPacketReceived = true;
      }
    });

    const result = router.receivePacket(packet);
    expect(result.action).toBe('deliver');
    expect(result.deliveredPacket?.packetId).toBe('pkt_test_123');
    expect(deliveredPacketReceived).toBe(true);
    expect(router.getDeliveredPackets().length).toBe(1);
  });

  it('forwards packets destined for another peer with incremented hop count and route history', () => {
    const router = new BitChatMeshRouter(bobDid, 'Bob Relay Node');
    const packet = {
      packetId: 'pkt_fwd_456',
      sourceDid: aliceDid,
      sourceName: 'Alice',
      destDid: charlieDid,
      payload: 'Relayed Payload',
      hopCount: 1,
      maxHops: 7,
      route: [aliceDid],
      timestamp: Date.now(),
    };

    const result = router.receivePacket(packet);
    expect(result.action).toBe('forward');
    expect(result.forwardedPacket).toBeDefined();
    expect(result.forwardedPacket?.hopCount).toBe(2);
    expect(result.forwardedPacket?.route).toEqual([aliceDid, bobDid]);
  });

  it('delivers and forwards broadcast packets on hyperlocal channels like #local-mesh', () => {
    const router = new BitChatMeshRouter(bobDid, 'Bob');
    const broadcastPacket = {
      packetId: 'pkt_bcast_789',
      sourceDid: aliceDid,
      sourceName: 'Alice',
      destDid: '*',
      channel: '#local-mesh',
      payload: 'Anyone on the local mesh near Central Park?',
      hopCount: 1,
      maxHops: 5,
      route: [aliceDid],
      timestamp: Date.now(),
    };

    const result = router.receivePacket(broadcastPacket);
    expect(result.action).toBe('deliver_and_forward');
    expect(result.deliveredPacket?.channel).toBe('#local-mesh');
    expect(result.forwardedPacket?.hopCount).toBe(2);
    expect(result.forwardedPacket?.route).toEqual([aliceDid, bobDid]);
  });

  it('suppresses duplicate packets to eliminate mesh broadcast loops', () => {
    const router = new BitChatMeshRouter(bobDid, 'Bob');
    const packet = {
      packetId: 'pkt_loop_999',
      sourceDid: aliceDid,
      sourceName: 'Alice',
      destDid: charlieDid,
      payload: 'Test loop',
      hopCount: 1,
      maxHops: 7,
      route: [aliceDid],
      timestamp: Date.now(),
    };

    const firstReceive = router.receivePacket(packet);
    expect(firstReceive.action).toBe('forward');

    // Second receive with identical packetId must be dropped
    const secondReceive = router.receivePacket(packet);
    expect(secondReceive.action).toBe('drop');
    expect(secondReceive.reason).toBe('duplicate_suppressed');
  });

  it('drops packets that exceed maxHops TTL', () => {
    const router = new BitChatMeshRouter(daveDid, 'Dave');
    const expiredPacket = {
      packetId: 'pkt_expired_000',
      sourceDid: aliceDid,
      sourceName: 'Alice',
      destDid: daveDid,
      payload: 'Too many hops',
      hopCount: 7,
      maxHops: 7,
      route: ['1', '2', '3', '4', '5', '6', '7'],
      timestamp: Date.now(),
    };

    const result = router.receivePacket(expiredPacket);
    expect(result.action).toBe('drop');
    expect(result.reason).toBe('max_hops_exceeded');
  });

  it('executes emergency panic wipe to instantly zeroize all in-memory peer tables and packets', () => {
    const router = new BitChatMeshRouter(aliceDid, 'Alice');
    router.registerPeer({
      did: bobDid,
      displayName: 'Bob',
      rssi: -50,
      distanceMeters: 4,
      hops: 1,
      isDirect: true,
      lastSeen: Date.now(),
    });
    router.createPacket(bobDid, 'Confidential communication');

    expect(router.getAllPeers().length).toBe(1);

    const wipeStats = router.panicWipe();
    expect(wipeStats.wipedPeersCount).toBe(1);
    expect(wipeStats.wipedPacketsCount).toBeGreaterThanOrEqual(1);

    expect(router.getAllPeers().length).toBe(0);
    expect(router.getDeliveredPackets().length).toBe(0);
  });
});
