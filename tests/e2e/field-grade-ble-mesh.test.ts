import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BitChatMeshRouter, type BitChatPacket } from '@sovra/messaging';
import { MobileMeshCoordinator } from '../../apps/sovra-mobile/src/services/mobile-mesh-coordinator.js';

describe('FIELD-GRADE BLE MESH EXPANSION', () => {
  describe('1. iOS CoreBluetooth FIFO Write Queue & Drain Lifecycle', () => {
    const bridgeHeaderPath = path.resolve('apps/sovra-mobile/ios/SovraMobile/SovraBleBridge.h');
    const bridgeSourcePath = path.resolve('apps/sovra-mobile/ios/SovraMobile/SovraBleBridge.mm');
    const nativeModulePath = path.resolve('apps/sovra-mobile/ios/SovraMobile/SovraBleNativeModule.mm');

    it('declares write queues, in-flight tracking, and setScanDutyCycle in iOS bridge', () => {
      const headerContent = fs.readFileSync(bridgeHeaderPath, 'utf-8');
      const sourceContent = fs.readFileSync(bridgeSourcePath, 'utf-8');

      expect(headerContent).toContain('setScanDutyCycle:');
      expect(sourceContent).toContain('writeQueues');
      expect(sourceContent).toContain('currentInFlightWrites');
      expect(sourceContent).toContain('SovraBlePendingWrite');
    });

    it('enqueues concurrent writes into FIFO queue instead of dropping or rejecting', () => {
      const sourceContent = fs.readFileSync(bridgeSourcePath, 'utf-8');

      // writeCharacteristic enqueues to self.writeQueues[peripheralId]
      expect(sourceContent).toContain('self.writeQueues[peripheralId]');
      expect(sourceContent).toContain('processNextWriteInQueueForPeripheralId:');
      // No more "Previous CoreBluetooth write still pending" rejection
      expect(sourceContent).not.toContain('completion(NO, @"Previous CoreBluetooth write still pending");');
    });

    it('drains next queued write in peripheral:didWriteValueForCharacteristic:error:', () => {
      const sourceContent = fs.readFileSync(bridgeSourcePath, 'utf-8');

      expect(sourceContent).toContain('didWriteValueForCharacteristic');
      expect(sourceContent).toContain('self.currentInFlightWrites[pId]');
      // Invokes next write in FIFO queue
      expect(sourceContent).toContain('[self processNextWriteInQueueForPeripheralId:pId];');
    });

    it('drains and reports errors on disconnection or bluetooth power off', () => {
      const sourceContent = fs.readFileSync(bridgeSourcePath, 'utf-8');

      expect(sourceContent).toContain('Peripheral disconnected');
      expect(sourceContent).toContain('Bluetooth state changed to poweredOff');
    });

    it('exposes setScanDutyCycle in SovraBleNativeModule.mm React Native bridge', () => {
      const nativeModuleContent = fs.readFileSync(nativeModulePath, 'utf-8');
      expect(nativeModuleContent).toContain('RCT_EXPORT_METHOD(setScanDutyCycle');
    });
  });

  describe('2. Automated 30s Anti-Entropy Epidemic Gossip Loop (MobileMeshCoordinator)', () => {
    let coordinator: MobileMeshCoordinator;

    beforeEach(() => {
      coordinator = MobileMeshCoordinator.getInstance();
      coordinator.stopAntiEntropyGossipLoop();
    });

    afterEach(() => {
      coordinator.stopAntiEntropyGossipLoop();
    });

    it('initializes bitchatRouter on MobileMeshCoordinator instance', () => {
      expect(coordinator.bitchatRouter).toBeDefined();
      expect(coordinator.bitchatRouter.localDid).toBe(coordinator.localDid);
    });

    it('starts and stops 30-second anti-entropy loop cadence', () => {
      coordinator.startAntiEntropyGossipLoop();
      // Second call is idempotent
      coordinator.startAntiEntropyGossipLoop();
      coordinator.stopAntiEntropyGossipLoop();
      // Safe to stop multiple times
      coordinator.stopAntiEntropyGossipLoop();
    });

    it('exchanges anti-entropy summaries and pushes missing packets to proximate peers (RSSI > -75 dBm)', async () => {
      // 1. Create a packet stored in bitchatRouter
      const broadcastPkt = coordinator.bitchatRouter.createPacket('*', 'Critical emergency alert payload');
      expect(broadcastPkt.packetId).toBeDefined();

      // 2. Register proximate peer with RSSI > -75 dBm
      coordinator.bitchatRouter.registerPeer({
        did: 'did:key:z6MksProximityPeer1',
        displayName: 'Proximate Node 1',
        rssi: -62,
        distanceMeters: 2.1,
        hops: 1,
        isDirect: true,
        lastSeen: Date.now(),
      });

      // 3. Register distant weak peer with RSSI <= -75 dBm (should be excluded)
      coordinator.bitchatRouter.registerPeer({
        did: 'did:key:z6MksDistantPeer2',
        displayName: 'Distant Node 2',
        rssi: -85,
        distanceMeters: 18.5,
        hops: 1,
        isDirect: true,
        lastSeen: Date.now(),
      });

      // Mock bleTransport.sendToPeer
      const sendSpy = vi.spyOn(coordinator.bleTransport, 'sendToPeer').mockResolvedValue(true);

      const result = await coordinator.runAntiEntropyGossipCycle();

      // Exactly 1 eligible proximate peer contacted
      expect(result.peersContacted).toBe(1);
      // Pushed the missing broadcast packet
      expect(result.packetsPushed).toBeGreaterThanOrEqual(1);

      sendSpy.mockRestore();
    });
  });

  describe('3. Adaptive Battery Scan Duty-Cycling (Android)', () => {
    const sovraBleModulePath = path.resolve('apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/ble/SovraBleModule.kt');
    const sovraBleReactPath = path.resolve('apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/ble/SovraBleReactModule.kt');

    it('implements setScanDutyCycle with ACTIVE and BACKGROUND_LOW_POWER modes in SovraBleModule.kt', () => {
      const moduleContent = fs.readFileSync(sovraBleModulePath, 'utf-8');

      expect(moduleContent).toContain('var scanDutyMode: String = "ACTIVE"');
      expect(moduleContent).toContain('fun setScanDutyCycle(mode: String');
      expect(moduleContent).toContain('ScanSettings.SCAN_MODE_LOW_LATENCY');
      expect(moduleContent).toContain('ScanSettings.SCAN_MODE_LOW_POWER');
      expect(moduleContent).toContain('5000L'); // 5s scan window
      expect(moduleContent).toContain('40000L'); // 40s pause window (total 45s interval)
    });

    it('wires screen off/on lifecycle receivers to adapt duty cycle automatically', () => {
      const moduleContent = fs.readFileSync(sovraBleModulePath, 'utf-8');

      expect(moduleContent).toContain('Intent.ACTION_SCREEN_OFF');
      expect(moduleContent).toContain('Intent.ACTION_SCREEN_ON');
      expect(moduleContent).toContain('setScanDutyCycle("BACKGROUND_LOW_POWER")');
      expect(moduleContent).toContain('setScanDutyCycle("ACTIVE")');
    });

    it('exposes setScanDutyCycle in SovraBleReactModule.kt for React Native runtime', () => {
      const reactModuleContent = fs.readFileSync(sovraBleReactPath, 'utf-8');

      expect(reactModuleContent).toContain('@ReactMethod');
      expect(reactModuleContent).toContain('fun setScanDutyCycle(mode: String, promise: Promise)');
      expect(reactModuleContent).toContain('bleModule.setScanDutyCycle(mode)');
    });
  });

  describe('4. Blind Multi-Hop Relay Envelope & Signature Tamper Verification', () => {
    let routerA: BitChatMeshRouter;
    let routerB: BitChatMeshRouter;
    let routerC: BitChatMeshRouter;

    beforeEach(() => {
      routerA = new BitChatMeshRouter('did:key:z6MksAliceOrigin', 'Alice');
      routerB = new BitChatMeshRouter('did:key:z6MksBobRelay', 'Bob (Relay)');
      routerC = new BitChatMeshRouter('did:key:z6MksCharlieDest', 'Charlie');
    });

    it('generates cryptographic Ed25519 signature on packet creation', () => {
      const packet = routerA.createPacket('did:key:z6MksCharlieDest', 'Confidential transmission');

      expect(packet.signature).toBeDefined();
      expect(packet.signature).toMatch(/^sig_ed25519_[0-9a-f]{32}$/);
      expect(packet.hopCount).toBe(0);
      expect(packet.route).toEqual(['did:key:z6MksAliceOrigin']);
    });

    it('blindly forwards envelope through intermediate relay preserving signature intact', () => {
      const initialPacket = routerA.createPacket('did:key:z6MksCharlieDest', 'Relayed secret message');
      const originalSig = initialPacket.signature;

      // Hop 1: Bob (Relay) receives packet
      const bobResult = routerB.receivePacket(initialPacket);
      expect(bobResult.action).toBe('forward');
      expect(bobResult.forwardedPacket).toBeDefined();

      const forwardedPkt = bobResult.forwardedPacket!;
      expect(forwardedPkt.hopCount).toBe(1);
      expect(forwardedPkt.route).toEqual(['did:key:z6MksAliceOrigin', 'did:key:z6MksBobRelay']);
      // Blind relay guarantee: signature and payload are unchanged
      expect(forwardedPkt.signature).toBe(originalSig);
      expect(forwardedPkt.payload).toBe('Relayed secret message');

      // Hop 2: Charlie receives forwarded packet
      const charlieResult = routerC.receivePacket(forwardedPkt);
      expect(charlieResult.action).toBe('deliver');
      expect(charlieResult.deliveredPacket?.signature).toBe(originalSig);
    });

    it('detects and drops packets with tampered signatures', () => {
      const packet = routerA.createPacket('did:key:z6MksCharlieDest', 'Original content');

      // Attacker tampers with signature
      const tamperedPacket: BitChatPacket = {
        ...packet,
        signature: 'invalid_tampered_signature_payload',
      };

      const result = routerB.receivePacket(tamperedPacket);
      expect(result.action).toBe('drop');
      expect(result.reason).toBe('signature_tamper_detected');
    });

    it('detects and drops packets with manipulated hopCount > maxHops', () => {
      const packet = routerA.createPacket('did:key:z6MksCharlieDest', 'Loop attack content', { maxHops: 7 });

      // Malicious node attempts hop count forgery beyond maxHops
      const manipulatedPacket: BitChatPacket = {
        ...packet,
        hopCount: 99,
      };

      const result = routerB.receivePacket(manipulatedPacket);
      expect(result.action).toBe('drop');
      expect(result.reason).toBe('signature_tamper_detected');
    });

    it('drops expired packets at exact maxHops with max_hops_exceeded', () => {
      const packet = routerA.createPacket('did:key:z6MksCharlieDest', 'TTL test', { maxHops: 5 });

      const expiredPacket: BitChatPacket = {
        ...packet,
        hopCount: 5,
      };

      const result = routerB.receivePacket(expiredPacket);
      expect(result.action).toBe('drop');
      expect(result.reason).toBe('max_hops_exceeded');
    });
  });
});
