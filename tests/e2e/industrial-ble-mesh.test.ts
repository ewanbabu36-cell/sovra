import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BitChatMeshRouter } from '../../packages/messaging/src/bitchat-mesh.js';
import { BleFrameCodec, BleFrameReassembler } from '../../packages/p2p/src/mesh/ble-codec.js';
import { ConcreteBleChannel } from '../../packages/p2p/src/mesh/ble-transport.js';

describe('Industrial BLE Mesh Hardening: Zero-Internet Offline Parity', () => {
  const SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:3001';

  it('1. BitChat Anti-Entropy Epidemic Gossip Sync (Bloom Filter & Reconciliation)', () => {
    const nodeA = new BitChatMeshRouter('did:sovra:alice_mesh', 'Alice Node');
    const nodeB = new BitChatMeshRouter('did:sovra:bob_mesh', 'Bob Node');

    // Node A creates 3 broadcast packets
    const p1 = nodeA.createPacket('*', 'Emergency alert: Local mesh online', { channel: '#emergency-sos', isEmergency: true });
    const p2 = nodeA.createPacket('*', 'Hyperlocal weather report', { channel: '#local-mesh' });
    const p3 = nodeA.createPacket('did:sovra:bob_mesh', 'Direct P2P offline voucher');

    // Node A creates a 64-bit Bloom filter anti-entropy summary
    const summaryA = nodeA.createSyncSummary(10);
    expect(summaryA.nodeDid).toBe('did:sovra:alice_mesh');
    expect(summaryA.recentPacketIds).toHaveLength(3);
    expect(summaryA.bloomFilterHex).toMatch(/^[0-9a-f]{16}$/i);
    expect(summaryA.bloomFilterHex).not.toBe('0000000000000000');

    // Node B reconciles Node A's summary (Node B has seen 0 packets)
    const reconB = nodeB.reconcileSyncSummary(summaryA);
    expect(reconB.missingFromLocal).toEqual([p1.packetId, p2.packetId, p3.packetId]);
    expect(reconB.availableToOffer).toHaveLength(0);

    // Node A reconciles Node B's empty summary -> identifies packets to push
    const summaryB = nodeB.createSyncSummary(10);
    const reconA = nodeA.reconcileSyncSummary(summaryB);
    expect(reconA.missingFromLocal).toHaveLength(0);
    expect(reconA.packetsToPush).toHaveLength(3);

    // Node B receives the pushed packets
    const res1 = nodeB.receivePacket(reconA.packetsToPush[0]!);
    expect(res1.action).toBe('deliver_and_forward');
    expect(nodeB.getDeliveredPackets()).toHaveLength(1);
  });

  it('2. Proximity-triggered Anti-Entropy Sync on Peer Registration', () => {
    const router = new BitChatMeshRouter('did:sovra:gateway', 'Gateway');

    // Close direct peer (RSSI = -58 dBm, > -75 dBm threshold)
    const closePeer = {
      did: 'did:sovra:nearby_peer',
      displayName: 'Nearby Peer',
      rssi: -58,
      distanceMeters: 4.2,
      hops: 1,
      isDirect: true,
      lastSeen: Date.now() - 35000,
    };
    const regResult1 = router.registerPeer(closePeer);
    expect(regResult1.isCloseProximity).toBe(true);
    expect(regResult1.syncNeeded).toBe(true);

    // Weak / distant peer (RSSI = -88 dBm, < -75 dBm threshold)
    const distantPeer = {
      did: 'did:sovra:distant_peer',
      displayName: 'Distant Peer',
      rssi: -88,
      distanceMeters: 45,
      hops: 1,
      isDirect: true,
      lastSeen: Date.now(),
    };
    const regResult2 = router.registerPeer(distantPeer);
    expect(regResult2.isCloseProximity).toBe(false);
    expect(regResult2.syncNeeded).toBe(false);

    // Multi-hop relayed peer (isDirect = false)
    const relayPeer = {
      did: 'did:sovra:relay_peer',
      displayName: 'Relayed Peer',
      rssi: -50,
      distanceMeters: 2,
      hops: 2,
      isDirect: false,
      lastSeen: Date.now(),
    };
    const regResult3 = router.registerPeer(relayPeer);
    expect(regResult3.isCloseProximity).toBe(false);
    expect(regResult3.syncNeeded).toBe(false);
  });

  it('3. Android Native GATT Write Queue, Error 133 Backoff & MTU Chunking Guard', () => {
    const modulePath = path.resolve(__dirname, '../../apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/ble/SovraBleModule.kt');
    const content = fs.readFileSync(modulePath, 'utf8');

    // FIFO Queue & Single In-Flight Concurrency
    expect(content).toContain('ConcurrentLinkedQueue<PendingWrite>');
    expect(content).toContain('val writeQueue: java.util.concurrent.ConcurrentLinkedQueue<PendingWrite>');
    expect(content).toContain('@Volatile var isWriteInFlight: Boolean = false');
    expect(content).toContain('fun processWriteQueue(conn: ActiveConnection)');

    // Error 133 / 143 Backoff Retry
    expect(content).toContain('status == 133 || status == 143 || status == 257');
    expect(content).toContain('current.retryCount < 3');
    expect(content).toContain('when (current.retryCount)');
    expect(content).toContain('1 -> 50L');
    expect(content).toContain('2 -> 150L');
    expect(content).toContain('else -> 350L');

    // Native MTU Chunking Guard
    expect(content).toContain('val maxPayload = Math.max(20, conn.mtu - 3)');
    expect(content).toContain('val chunkPayloadSize = Math.max(18, maxPayload - 2)');
    expect(content).toContain('totalChunks = Math.ceil(data.size.toDouble()');
  });

  it('4. BLE Frame Codec MTU Fragmentation, CRC-32 Integrity & Adaptive MTU Re-negotiation', () => {
    const payload = new Uint8Array(200);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) % 256;

    // Fragment payload with 60-byte MTU
    const chunks = BleFrameCodec.fragment(payload, 60);
    expect(chunks.length).toBeGreaterThan(3);

    // Reassemble chunks
    const reassembler = new BleFrameReassembler();
    let reassembled: Uint8Array | null = null;
    for (const chunk of chunks) {
      reassembled = reassembler.feed(chunk);
    }

    expect(reassembled).not.toBeNull();
    expect(reassembled?.length).toBe(payload.length);
    expect(reassembled).toEqual(payload);

    // ConcreteBleChannel adaptive MTU update
    const dummyRawChannel = {
      address: 'AA:BB:CC:DD:EE:FF',
      mtu: 23,
      send: async () => true,
      onData: () => {},
      onClose: () => {},
    };
    const channel = new ConcreteBleChannel('chan_test_1', dummyRawChannel as any);
    expect(channel.mtu).toBe(23);
    channel.updateMtu(512);
    expect(channel.mtu).toBe(512);
    channel.updateMtu(10); // Clamped to minimum ATT MTU 23
    expect(channel.mtu).toBe(23);
  });

  it('5. Ultra-Low Bitrate 6kbps Voice Mode in Dev Server and Mobile Screen', async () => {
    // Check scripts/dev-server.ts
    const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
    const devServerContent = fs.readFileSync(devServerPath, 'utf8');

    expect(devServerContent).toContain('recOpts.audioBitsPerSecond = 6000');
    expect(devServerContent).toContain("timerEl.setAttribute('data-mesh-bitrate', '6kbps')");

    // Check apps/sovra-mobile/src/screens/ChatsScreen.tsx
    const chatScreenPath = path.resolve(__dirname, '../../apps/sovra-mobile/src/screens/ChatsScreen.tsx');
    const chatScreenContent = fs.readFileSync(chatScreenPath, 'utf8');

    expect(chatScreenContent).toContain('audioBitsPerSecond: isMeshMode ? 6000 : 32000');
    expect(chatScreenContent).toContain('audioBitrateKbps: isMeshMode ? 6 : 32');
  });
});
