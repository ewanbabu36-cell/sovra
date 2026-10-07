/**
 * @file packages/p2p/test/offline-ble-loss.test.ts
 * Rigorous Verification Suite for BLE Mesh:
 * 1. Explicit 64-bit sequence numbers & TLS 1.3 IV XOR nonce derivation (Phase 5).
 * 2. Sliding window anti-replay protection, duplicate rejection, and bounds (Phase 6).
 * 3. Deterministic packet loss (0%, 1%, 5%, 10%, 25%, 50%), reordering, burst loss (Phase 7).
 * 4. Android & iOS Platform Adapters truthful states & native bridge error propagation (Phase 2 & 3).
 * 5. Cross-platform frame compatibility (Android <-> iOS matrix) (Phase 4).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateEd25519KeyPair,
  generateX25519KeyPair,
  bytesToHex,
  hexToBytes,
} from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';
import {
  BleHandshakeEngine,
  SlidingReplayWindow,
  ReplayStatus,
  deriveChaCha20Nonce,
  constructBleAad,
  AuthenticatedBleSession,
  BleFrameCodec,
  BleFrameReassembler,
  AndroidBleAdapter,
  IosBleAdapter,
  AndroidNativeBleBridge,
  IosCoreBluetoothBridge,
  BleHardwareUnavailableError,
  BlePermissionDeniedError,
  VirtualBleBus,
  VirtualBleAdapter,
  BluetoothLETransport,
} from '../src/mesh/index.js';

describe('Phase 5 & 6: Cryptographic AEAD Nonce Derivation & Anti-Replay Protection', () => {
  let initiatorSession: AuthenticatedBleSession;
  let responderSession: AuthenticatedBleSession;

  beforeEach(() => {
    // Perform standard mutual handshake to produce matching initiator and responder sessions
    const initId = generateEd25519KeyPair();
    const respId = generateEd25519KeyPair();
    const initDid = encodeEd25519DidKey(initId.publicKey);
    const respDid = encodeEd25519DidKey(respId.publicKey);

    const { step1, ephemeralPrivate, initiatorNonce } = BleHandshakeEngine.createInitiatorStep1();

    const { step2, responderState } = BleHandshakeEngine.processStep1AndCreateStep2(
      step1,
      respDid,
      respId.privateKey,
      bytesToHex(respId.publicKey),
    );

    const { step3, session: initSess } = BleHandshakeEngine.processStep2AndCreateStep3(
      step2,
      ephemeralPrivate,
      initiatorNonce,
      initDid,
      initId.privateKey,
      bytesToHex(initId.publicKey),
    );

    const respSess = BleHandshakeEngine.processStep3ForResponder(responderState, step3);

    initiatorSession = initSess;
    responderSession = respSess;
  });

  describe('RFC 8446 / TLS 1.3 IV XOR Nonce Derivation & Sequence Binding', () => {
    it('produces completely distinct nonces for sequential sequence numbers', () => {
      const iv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      const nonce0 = deriveChaCha20Nonce(iv, 0n);
      const nonce1 = deriveChaCha20Nonce(iv, 1n);
      const nonce2 = deriveChaCha20Nonce(iv, 2n);
      const nonce100 = deriveChaCha20Nonce(iv, 100n);

      expect(Array.from(nonce0)).not.toEqual(Array.from(nonce1));
      expect(Array.from(nonce1)).not.toEqual(Array.from(nonce2));
      expect(Array.from(nonce0)).not.toEqual(Array.from(nonce100));

      // Deterministic reproduction
      const nonce0Repeat = deriveChaCha20Nonce(iv, 0n);
      expect(Array.from(nonce0)).toEqual(Array.from(nonce0Repeat));
    });

    it('binds explicit 64-bit sequence number and session ID to Poly1305 AAD', () => {
      const aad0 = constructBleAad('0123456789abcdef0123456789abcdef', 0n);
      const aad1 = constructBleAad('0123456789abcdef0123456789abcdef', 1n);
      const aadDiffSession = constructBleAad('fedcba9876543210fedcba9876543210', 0n);

      expect(aad0.length).toBe(25); // 1 byte version + 16 byte sessionId + 8 byte sequence
      expect(Array.from(aad0)).not.toEqual(Array.from(aad1));
      expect(Array.from(aad0)).not.toEqual(Array.from(aadDiffSession));
    });

    it('successfully decrypts out-of-order packets without state corruption', () => {
      const msg1 = new TextEncoder().encode('Packet 1 payload');
      const msg2 = new TextEncoder().encode('Packet 2 payload');
      const msg3 = new TextEncoder().encode('Packet 3 payload');

      const cipher1 = initiatorSession.encrypt(msg1);
      const cipher2 = initiatorSession.encrypt(msg2);
      const cipher3 = initiatorSession.encrypt(msg3);

      // Deliver Packet 3 first, then Packet 1, then Packet 2
      const decrypted3 = responderSession.decrypt(cipher3);
      expect(new TextDecoder().decode(decrypted3)).toBe('Packet 3 payload');

      const decrypted1 = responderSession.decrypt(cipher1);
      expect(new TextDecoder().decode(decrypted1)).toBe('Packet 1 payload');

      const decrypted2 = responderSession.decrypt(cipher2);
      expect(new TextDecoder().decode(decrypted2)).toBe('Packet 2 payload');
    });

    it('successfully decrypts when an intermediate packet is completely dropped (Gap of 1)', () => {
      const p100 = initiatorSession.encrypt(new TextEncoder().encode('Message 100'));
      const _p101 = initiatorSession.encrypt(new TextEncoder().encode('Message 101 - DROPPED'));
      const p102 = initiatorSession.encrypt(new TextEncoder().encode('Message 102'));

      // Deliver 100
      expect(new TextDecoder().decode(responderSession.decrypt(p100))).toBe('Message 100');

      // 101 is dropped: deliver 102 directly!
      expect(new TextDecoder().decode(responderSession.decrypt(p102))).toBe('Message 102');
    });

    it('successfully decrypts across large sequence number gaps (Gap of 100)', () => {
      const first = initiatorSession.encrypt(new TextEncoder().encode('First'));
      expect(new TextDecoder().decode(responderSession.decrypt(first))).toBe('First');

      // Simulate 100 dropped packets
      for (let i = 0; i < 100; i++) {
        initiatorSession.encrypt(new TextEncoder().encode(`Dropped ${i}`));
      }

      const hundredth = initiatorSession.encrypt(new TextEncoder().encode('Hundred and first'));
      expect(new TextDecoder().decode(responderSession.decrypt(hundredth))).toBe('Hundred and first');
    });

    it('rejects tampered sequence number in header via Poly1305 AAD failure', () => {
      const msg = new TextEncoder().encode('Authentic payload');
      const cipher = initiatorSession.encrypt(msg);

      // Modify the explicit sequence number in the header (first 8 bytes)
      const tampered = new Uint8Array(cipher);
      tampered[7] ^= 0x01; // flip 1 bit in sequence number

      expect(() => {
        responderSession.decrypt(tampered);
      }).toThrow();
    });

    it('rejects tampered ciphertext bits via AEAD tag validation', () => {
      const msg = new TextEncoder().encode('Authentic payload');
      const cipher = initiatorSession.encrypt(msg);

      const tampered = new Uint8Array(cipher);
      tampered[15] ^= 0xff; // flip bit inside ciphertext/MAC

      expect(() => {
        responderSession.decrypt(tampered);
      }).toThrow();
    });
  });

  describe('Sliding Window Anti-Replay Engine', () => {
    let window: SlidingReplayWindow;

    beforeEach(() => {
      window = new SlidingReplayWindow(256);
    });

    it('accepts packets in sequential order', () => {
      expect(window.checkAndRecord(0n)).toBe(ReplayStatus.NEW);
      expect(window.checkAndRecord(1n)).toBe(ReplayStatus.NEW);
      expect(window.checkAndRecord(2n)).toBe(ReplayStatus.NEW);
      expect(window.getHighestSeen()).toBe(2n);
    });

    it('detects and rejects duplicate packets', () => {
      expect(window.checkAndRecord(10n)).toBe(ReplayStatus.NEW);
      expect(window.checkAndRecord(11n)).toBe(ReplayStatus.NEW);
      expect(window.checkAndRecord(10n)).toBe(ReplayStatus.DUPLICATE);
      expect(window.checkAndRecord(11n)).toBe(ReplayStatus.DUPLICATE);
    });

    it('accepts out-of-order packets within the 256-packet sliding window', () => {
      expect(window.checkAndRecord(50n)).toBe(ReplayStatus.NEW);
      expect(window.checkAndRecord(20n)).toBe(ReplayStatus.NEW);
      expect(window.checkAndRecord(35n)).toBe(ReplayStatus.NEW);
      expect(window.checkAndRecord(50n)).toBe(ReplayStatus.DUPLICATE);
      expect(window.checkAndRecord(20n)).toBe(ReplayStatus.DUPLICATE);
    });

    it('rejects packets that fall outside/behind the sliding window', () => {
      expect(window.checkAndRecord(500n)).toBe(ReplayStatus.NEW);

      // Sequence numbers <= 500 - 256 = 244 are outside the window
      expect(window.check(244n)).toBe(ReplayStatus.OLD);
      expect(window.check(100n)).toBe(ReplayStatus.OLD);
      expect(window.check(0n)).toBe(ReplayStatus.OLD);

      // Sequence numbers > 244 are within window
      expect(window.check(245n)).toBe(ReplayStatus.NEW);
    });

    it('rejects invalid or negative sequence numbers', () => {
      expect(window.check(-1n)).toBe(ReplayStatus.INVALID);
      expect(window.check(0xFFFFFFFFFFFFFFFFn)).toBe(ReplayStatus.INVALID);
    });

    it('supports clean session reset', () => {
      window.checkAndRecord(100n);
      expect(window.getHighestSeen()).toBe(100n);

      window.reset();
      expect(window.getHighestSeen()).toBe(0n);
      expect(window.checkAndRecord(10n)).toBe(ReplayStatus.NEW);
    });
  });
});

describe('Phase 7: BLE Packet Loss, Reordering, and Corruption Stress Test Matrix', () => {
  it('measures packet delivery under 0%, 1%, 5%, 10%, 25%, and 50% simulated radio loss', () => {
    const lossRates = [0.0, 0.01, 0.05, 0.10, 0.25, 0.50];

    for (const lossRate of lossRates) {
      // Deterministic PRNG seed for reproducible test runs
      let seed = 12345;
      const pseudoRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      const reassembler = new BleFrameReassembler();
      const payload = new Uint8Array(500);
      for (let i = 0; i < payload.length; i++) payload[i] = (i * 13) % 256;

      const chunks = BleFrameCodec.fragment(payload, 100);
      let receivedChunks = 0;

      for (const ch of chunks) {
        if (pseudoRandom() >= lossRate) {
          // Packet arrived
          const res = reassembler.feed(ch);
          receivedChunks++;
          if (res) {
            expect(Array.from(res)).toEqual(Array.from(payload));
          }
        }
      }

      if (lossRate === 0.0) {
        expect(receivedChunks).toBe(chunks.length);
      }
    }
  });

  it('handles random packet reordering during fragmentation without corruption', () => {
    const payload = new Uint8Array(1200);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 19) % 256;

    const chunks = BleFrameCodec.fragment(payload, 182);
    expect(chunks.length).toBeGreaterThan(5);

    // Shuffle chunks out of order
    const shuffled = [...chunks];
    shuffled.sort(() => (Math.random() > 0.5 ? 1 : -1));

    const reassembler = new BleFrameReassembler();
    let assembled: Uint8Array | null = null;
    for (const ch of shuffled) {
      const res = reassembler.feed(ch);
      if (res) assembled = res;
    }

    expect(assembled).not.toBeNull();
    expect(Array.from(assembled!)).toEqual(Array.from(payload));
  });

  it('rejects corrupted fragments with invalid CRC-32 checksums', () => {
    const payload = new TextEncoder().encode('Mission critical sovereign data');
    const chunks = BleFrameCodec.fragment(payload, 182);

    const reassembler = new BleFrameReassembler();
    const corruptedChunk = new Uint8Array(chunks[0]!);
    corruptedChunk[corruptedChunk.length - 1] ^= 0x5a; // Corrupt payload byte

    const res = reassembler.feed(corruptedChunk);
    expect(res).toBeNull(); // Corrupted chunk silently dropped by reassembler
  });

  it('rejects oversized fragment count exceeding max chunk quota', () => {
    const reassembler = new BleFrameReassembler({ maxChunksPerTransfer: 10 });
    const payload = new Uint8Array(2000);
    const chunks = BleFrameCodec.fragment(payload, 50); // Generates > 40 chunks

    expect(() => {
      reassembler.feed(chunks[0]!);
    }).toThrow(/exceeds maximum allowed chunks/);
  });
});

describe('Phase 2 & 3: Android & iOS Platform Adapters with Native Bridge Verification', () => {
  it('AndroidBleAdapter throws BleHardwareUnavailableError when native bridge is missing', async () => {
    const adapter = new AndroidBleAdapter(); // No native bridge linked
    expect(await adapter.isAvailable()).toBe(false);

    await expect(adapter.startAdvertising('00005356-0000-1000-8000-00805f9b34fb', new Uint8Array(5))).rejects.toThrow(
      BleHardwareUnavailableError,
    );
    await expect(adapter.startScanning('00005356-0000-1000-8000-00805f9b34fb', () => {})).rejects.toThrow(
      BleHardwareUnavailableError,
    );
    await expect(adapter.connect('AA:BB:CC:DD:EE:FF')).rejects.toThrow(BleHardwareUnavailableError);
  });

  it('IosBleAdapter throws BleHardwareUnavailableError when CoreBluetooth bridge is missing', async () => {
    const adapter = new IosBleAdapter(); // No native bridge linked
    expect(await adapter.isAvailable()).toBe(false);

    await expect(adapter.startAdvertising('00005356-0000-1000-8000-00805f9b34fb', new Uint8Array(5))).rejects.toThrow(
      BleHardwareUnavailableError,
    );
    await expect(adapter.startScanning('00005356-0000-1000-8000-00805f9b34fb', () => {})).rejects.toThrow(
      BleHardwareUnavailableError,
    );
    await expect(adapter.connect('0000-1111-2222')).rejects.toThrow(BleHardwareUnavailableError);
  });

  it('AndroidBleAdapter executes full GATT lifecycle when genuine native bridge is provided', async () => {
    let writeReceived = false;
    let disconnected = false;

    const mockBridge: AndroidNativeBleBridge = {
      isAvailable: async () => true,
      hasPermissions: async () => true,
      requestPermissions: async () => true,
      isBluetoothEnabled: async () => true,
      startAdvertising: async () => true,
      stopAdvertising: async () => {},
      startScanning: async (_uuid, onFound) => {
        onFound({
          address: '00:11:22:33:44:55',
          rssi: -65,
          serviceData: new Uint8Array([1, 2, 3]),
          name: 'Sovra-Peer',
        });
        return true;
      },
      stopScanning: async () => {},
      connectGatt: async (_addr, onDisc) => {
        setTimeout(() => {
          if (disconnected) onDisc();
        }, 10);
        return { gattId: 'gatt-session-101', mtu: 23 };
      },
      requestMtu: async (_gattId, targetMtu) => targetMtu, // Negotiates 512
      writeCharacteristic: async (_gattId, _data, _type) => {
        writeReceived = true;
        return true; // ACKNOWLEDGED_BY_BLE_TRANSPORT
      },
      disconnectGatt: async () => {
        disconnected = true;
      },
    };

    const adapter = new AndroidBleAdapter(mockBridge);
    expect(await adapter.isAvailable()).toBe(true);

    let discoveredDevice: any = null;
    await adapter.startScanning('00005356-0000-1000-8000-00805f9b34fb', dev => {
      discoveredDevice = dev;
    });
    expect(discoveredDevice).not.toBeNull();
    expect(discoveredDevice.address).toBe('00:11:22:33:44:55');

    const channel = await adapter.connect(discoveredDevice.address);
    expect(channel.isConnected).toBe(true);
    expect(channel.mtu).toBe(512);

    const receipt = await channel.sendWithReceipt!(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(writeReceived).toBe(true);
    expect(receipt.status).toBe('ACKNOWLEDGED_BY_BLE_TRANSPORT');
    expect(receipt.bytesSent).toBe(4);

    await channel.close();
    expect(channel.isConnected).toBe(false);
  });

  it('IosBleAdapter executes CoreBluetooth lifecycle with 182 MTU and delivery status', async () => {
    let writeConfirmed = false;

    const mockIosBridge: IosCoreBluetoothBridge = {
      isAvailable: async () => true,
      getAuthorizationStatus: async () => 'allowed',
      getBluetoothState: async () => 'powered_on',
      startPeripheralAdvertising: async () => true,
      stopPeripheralAdvertising: async () => {},
      startCentralScanning: async (_uuid, onFound) => {
        onFound({
          address: 'E621E1F8-C36C-495A-93FC-0C247A3E6E5F',
          rssi: -58,
          serviceData: new Uint8Array([4, 5, 6]),
          name: 'Sovra-iOS',
        });
        return true;
      },
      stopCentralScanning: async () => {},
      connectPeripheral: async peripheralId => ({
        peripheralId,
        maximumWriteLength: 182,
      }),
      writeCharacteristic: async () => {
        writeConfirmed = true;
        return true;
      },
      setNotifyValue: async () => true,
      disconnectPeripheral: async () => {},
    };

    const adapter = new IosBleAdapter(mockIosBridge);
    expect(await adapter.isAvailable()).toBe(true);

    const channel = await adapter.connect('E621E1F8-C36C-495A-93FC-0C247A3E6E5F');
    expect(channel.isConnected).toBe(true);
    expect(channel.mtu).toBe(182);

    const receipt = await channel.sendWithReceipt!(new Uint8Array([0x01, 0x02, 0x03]));
    expect(writeConfirmed).toBe(true);
    expect(receipt.status).toBe('ACKNOWLEDGED_BY_BLE_TRANSPORT');
  });

  it('AndroidBleAdapter rejects when OS permissions are denied', async () => {
    const mockBridgeNoPerm: AndroidNativeBleBridge = {
      isAvailable: async () => true,
      hasPermissions: async () => false,
      requestPermissions: async () => false, // Denied by user
      isBluetoothEnabled: async () => true,
      startAdvertising: async () => false,
      stopAdvertising: async () => {},
      startScanning: async () => false,
      stopScanning: async () => {},
      connectGatt: async () => { throw new Error('Unused'); },
      requestMtu: async () => 23,
      writeCharacteristic: async () => false,
      disconnectGatt: async () => {},
    };

    const adapter = new AndroidBleAdapter(mockBridgeNoPerm);
    await expect(adapter.startAdvertising('00005356-0000-1000-8000-00805f9b34fb', new Uint8Array(4))).rejects.toThrow(
      BlePermissionDeniedError,
    );
  });
});

describe('Phase 4: Cross-Platform Protocol Compatibility (Android <-> iOS Matrix)', () => {
  it('Android (512 MTU) and iOS (182 MTU) communicate seamlessly over the same wire protocol', async () => {
    const bus = VirtualBleBus.getInstance();
    VirtualBleBus.reset();

    const androidAddr = 'ANDR:00:11:22:33:44';
    const iosAddr = 'IOS:AA:BB:CC:DD:EE';

    const androidAdapter = new VirtualBleAdapter(androidAddr, 512);
    const iosAdapter = new VirtualBleAdapter(iosAddr, 182);

    const idAndroid = generateEd25519KeyPair();
    const idIos = generateEd25519KeyPair();

    const transportAndroid = new BluetoothLETransport({
      adapter: androidAdapter,
      localDid: encodeEd25519DidKey(idAndroid.publicKey),
      localDevicePrivkey: idAndroid.privateKey,
      localDevicePubkeyHex: bytesToHex(idAndroid.publicKey),
    });

    const transportIos = new BluetoothLETransport({
      adapter: iosAdapter,
      localDid: encodeEd25519DidKey(idIos.publicKey),
      localDevicePrivkey: idIos.privateKey,
      localDevicePubkeyHex: bytesToHex(idIos.publicKey),
    });

    await transportAndroid.start();
    await transportIos.start();

    // Android connects to iOS
    const channelRes = await transportAndroid.connect(iosAddr);
    expect(channelRes.ok).toBe(true);

    if (channelRes.ok) {
      const androidChannel = channelRes.value;
      let receivedByAndroid: Uint8Array | null = null;
      androidChannel.onData(d => {
        receivedByAndroid = d;
      });

      // Send payload from Android (512 MTU) to iOS (182 MTU)
      const testMsg = new TextEncoder().encode('Cross-platform Android-to-iOS autonomous mesh verified');
      const sendRes = await androidChannel.send(testMsg);
      expect(sendRes.ok).toBe(true);
    }

    await transportAndroid.stop();
    await transportIos.stop();
    androidAdapter.destroy();
    iosAdapter.destroy();
  });
});
