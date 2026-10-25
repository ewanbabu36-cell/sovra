import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  BitChatMeshRouter,
  computeBloomFilter256,
  computeBloomFilter64,
  type BitChatPacket,
} from '@sovra/messaging';

describe('MILITARY-GRADE BLE MESH HARDENING (6 Field-Testing Gaps)', () => {
  describe('1. iOS CoreBluetooth Background State Restoration & Native MTU Slicing', () => {
    const bridgeHeaderPath = path.resolve('apps/sovra-mobile/ios/SovraMobile/SovraBleBridge.h');
    const bridgeSourcePath = path.resolve('apps/sovra-mobile/ios/SovraMobile/SovraBleBridge.mm');

    it('configures CBCentralManager and CBPeripheralManager background state restoration identifiers', () => {
      const sourceContent = fs.readFileSync(bridgeSourcePath, 'utf-8');

      expect(sourceContent).toContain('CBCentralManagerOptionRestoreIdentifierKey: @"SovraBleCentralRestore"');
      expect(sourceContent).toContain('CBPeripheralManagerOptionRestoreIdentifierKey: @"SovraBlePeripheralRestore"');
    });

    it('implements willRestoreState delegates for central and peripheral managers', () => {
      const headerContent = fs.readFileSync(bridgeHeaderPath, 'utf-8');
      const sourceContent = fs.readFileSync(bridgeSourcePath, 'utf-8');

      expect(headerContent).toContain('willRestoreState:');
      expect(sourceContent).toContain('- (void)centralManager:(CBCentralManager *)central willRestoreState:(NSDictionary<NSString *, id> *)dict');
      expect(sourceContent).toContain('- (void)peripheralManager:(CBPeripheralManager *)peripheral willRestoreState:(NSDictionary<NSString *, id> *)dict');
      expect(sourceContent).toContain('CBCentralManagerRestoredStatePeripheralsKey');
      expect(sourceContent).toContain('CBPeripheralManagerRestoredStateServicesKey');
    });

    it('implements native ATT MTU boundary chunking guard matching Android Kotlin parity', () => {
      const sourceContent = fs.readFileSync(bridgeSourcePath, 'utf-8');

      expect(sourceContent).toContain('maxWrite - 3');
      expect(sourceContent).toContain('totalChunks = (NSInteger)ceil((double)data.length / (double)chunkPayloadSize)');
      expect(sourceContent).toContain('uint8_t header[2] = { (uint8_t)seq, (uint8_t)totalChunks }');
    });
  });

  describe('2. Advertised TX-Power Calibration & Exponential Moving Average (EMA) RSSI', () => {
    const androidModulePath = path.resolve('apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/ble/SovraBleModule.kt');
    const iosBridgePath = path.resolve('apps/sovra-mobile/ios/SovraMobile/SovraBleBridge.mm');
    const p2pTransportPath = path.resolve('packages/p2p/src/mesh/ble-transport.ts');

    it('extracts hardware txPowerLevel and computes EMA smoothed RSSI in Android SovraBleModule.kt', () => {
      const androidContent = fs.readFileSync(androidModulePath, 'utf-8');

      expect(androidContent).toContain('scanRecord.txPowerLevel');
      expect(androidContent).toContain('smoothedRssiMap');
      expect(androidContent).toContain('(0.25 * rssi.toDouble()) + (0.75 * prevSmoothed)');
      expect(androidContent).toContain('onDeviceDiscoveredWithTxPower');
    });

    it('extracts CBAdvertisementDataTxPowerLevelKey and computes EMA smoothed RSSI in iOS SovraBleBridge.mm', () => {
      const iosContent = fs.readFileSync(iosBridgePath, 'utf-8');

      expect(iosContent).toContain('CBAdvertisementDataTxPowerLevelKey');
      expect(iosContent).toContain('smoothedRssiMap');
      expect(iosContent).toContain('0.25 * [RSSI doubleValue]');
      expect(iosContent).toContain('onDeviceDiscoveredWithTxPower');
    });

    it('utilizes calibrated txPower in ble-transport.ts for jitter-free distance estimation', () => {
      const transportContent = fs.readFileSync(p2pTransportPath, 'utf-8');

      expect(transportContent).toContain('const measuredPower = dev.txPower ?? -59;');
    });
  });

  describe('3. 256-Bit Scaled Bloom Filter & Monotonic Lamport Sequence Counters', () => {
    it('generates a 64-character (256-bit) hex string for Bloom filter scaling to 100+ packets', () => {
      const packetIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        packetIds.push(`pkt_alpha_mesh_test_seq_${i}_${Date.now()}`);
      }

      const bloom256 = computeBloomFilter256(packetIds);
      expect(bloom256).toBeDefined();
      expect(bloom256).toHaveLength(64); // 64 hex chars = 256 bits

      // Legacy 64-bit produces 16 hex characters
      const bloom64 = computeBloomFilter64(packetIds);
      expect(bloom64).toHaveLength(16);
    });

    it('creates 256-bit Bloom filter summary inside BitChatMeshRouter.createSyncSummary()', () => {
      const router = new BitChatMeshRouter('did:key:z6MksAliceOrigin', 'Alice');
      for (let i = 0; i < 20; i++) {
        router.createPacket('*', `Broadcast test message ${i}`);
      }

      const summary = router.createSyncSummary(100);
      expect(summary.bloomFilterHex).toHaveLength(64);
      expect(summary.recentPacketIds.length).toBe(20);
    });

    it('maintains monotonic Lamport sequence clock across packet creation and reception', () => {
      const routerA = new BitChatMeshRouter('did:key:z6MksAlice', 'Alice');
      const routerB = new BitChatMeshRouter('did:key:z6MksBob', 'Bob');

      expect(routerA.getLamportClock()).toBe(0);
      expect(routerB.getLamportClock()).toBe(0);

      // Alice creates packet 1 -> clock advances to 1
      const pkt1 = routerA.createPacket('did:key:z6MksBob', 'Message 1');
      expect(pkt1.lamportClock).toBe(1);
      expect(routerA.getLamportClock()).toBe(1);

      // Alice creates packet 2 -> clock advances to 2
      const pkt2 = routerA.createPacket('did:key:z6MksBob', 'Message 2');
      expect(pkt2.lamportClock).toBe(2);
      expect(routerA.getLamportClock()).toBe(2);

      // Bob receives packet 2 from Alice -> Bob clock becomes max(0, 2) + 1 = 3
      routerB.receivePacket(pkt2);
      expect(routerB.getLamportClock()).toBe(3);

      // Bob creates packet 3 -> clock advances to 4
      const pkt3 = routerB.createPacket('did:key:z6MksAlice', 'Message 3 reply');
      expect(pkt3.lamportClock).toBe(4);
      expect(routerB.getLamportClock()).toBe(4);
    });
  });

  describe('4. Delay-Tolerant Networking (DTN) Store-and-Forward "Data Mule" Carrier', () => {
    let routerMule: BitChatMeshRouter;

    beforeEach(() => {
      routerMule = new BitChatMeshRouter('did:key:z6MksMuleCarrier', 'Data Mule Node');
    });

    it('queues undelivered unicast packets into DTN carrier queue when target peer is offline', () => {
      const offlineTargetDid = 'did:key:z6MksCharlieOffline';
      const unicastPkt: BitChatPacket = {
        packetId: `pkt_dtn_carrier_test_${Date.now()}`,
        sourceDid: 'did:key:z6MksAliceOrigin',
        sourceName: 'Alice',
        destDid: offlineTargetDid,
        payload: 'Top secret carried envelope',
        hopCount: 1,
        maxHops: 7,
        route: ['did:key:z6MksAliceOrigin'],
        timestamp: Date.now(),
        signature: 'sig_ed25519_valid_signature_1234567890abcdef',
        lamportClock: 5,
      };

      // Mule receives packet to forward, but Charlie is not in peers list
      const result = routerMule.receivePacket(unicastPkt);
      expect(result.action).toBe('forward');

      // Packet is stored in DTN carrier queue for Charlie
      const queuedPackets = routerMule.getDtnCarrierQueue().get(offlineTargetDid);
      expect(queuedPackets).toBeDefined();
      expect(queuedPackets!.length).toBe(1);
      expect(queuedPackets![0]!.payload).toBe('Top secret carried envelope');
    });

    it('automatically flushes DTN carrier packets upon peer rendezvous in registerPeer()', () => {
      const rendezvousDid = 'did:key:z6MksCharlieRendezvous';
      const carriedPacket: BitChatPacket = {
        packetId: `pkt_dtn_flush_test_${Date.now()}`,
        sourceDid: 'did:key:z6MksAliceOrigin',
        sourceName: 'Alice',
        destDid: rendezvousDid,
        payload: 'Rendezvous payload delivered via Mule',
        hopCount: 2,
        maxHops: 7,
        route: ['did:key:z6MksAliceOrigin', 'did:key:z6MksMuleCarrier'],
        timestamp: Date.now(),
        signature: 'sig_ed25519_valid_signature_9876543210fedcba',
        lamportClock: 8,
      };

      // Enqueue into Data Mule carrier
      routerMule.enqueueDtnPacket(carriedPacket);
      expect(routerMule.getDtnCarrierQueue().get(rendezvousDid)!.length).toBe(1);

      // Charlie comes into direct proximity (rendezvous)
      const regResult = routerMule.registerPeer({
        did: rendezvousDid,
        displayName: 'Charlie (Met at Basecamp)',
        rssi: -65,
        distanceMeters: 3.2,
        hops: 1,
        isDirect: true,
        lastSeen: Date.now(),
      });

      // Data Mule automatically flushes carried packets for Charlie
      expect(regResult.dtnPacketsToFlush).toBeDefined();
      expect(regResult.dtnPacketsToFlush.length).toBe(1);
      expect(regResult.dtnPacketsToFlush[0]!.packetId).toBe(carriedPacket.packetId);

      // DTN queue for Charlie is now empty
      expect(routerMule.getDtnCarrierQueue().get(rendezvousDid)).toBeUndefined();
    });

    it('zeroizes DTN carrier queue on emergency panic wipe', () => {
      routerMule.enqueueDtnPacket({
        packetId: 'pkt_wipe_1',
        sourceDid: 'did:key:z6MksA',
        sourceName: 'A',
        destDid: 'did:key:z6MksB',
        payload: 'Classified',
        hopCount: 0,
        maxHops: 7,
        route: ['did:key:z6MksA'],
        timestamp: Date.now(),
      });

      expect(routerMule.getDtnCarrierQueue().size).toBe(1);
      routerMule.panicWipe();
      expect(routerMule.getDtnCarrierQueue().size).toBe(0);
    });
  });

  describe('5. Web Bluetooth API Radar Engine in Dev Server & PWA', () => {
    const devServerPath = path.resolve('scripts/dev-server.ts');

    it('contains Web Bluetooth GATT Client pairing implementation with Sovra service UUID', () => {
      const devServerContent = fs.readFileSync(devServerPath, 'utf-8');

      expect(devServerContent).toContain('00005356-0000-1000-8000-00805f9b34fb');
      expect(devServerContent).toContain('navigator.bluetooth.requestDevice');
      expect(devServerContent).toContain('connectWebBluetoothRadar');
      expect(devServerContent).toContain('sendWebBluetoothMeshPacket');
      expect(devServerContent).toContain('webBluetoothPairBtn');
    });
  });
});
