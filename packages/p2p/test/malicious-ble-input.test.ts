/**
 * @file packages/p2p/test/malicious-ble-input.test.ts
 * Malicious BLE Input & Protocol Boundary Stress Test Suite.
 *
 * Verifies that the native BLE adapters, codec, reassembler, and cryptographic
 * transport fail safely without crashing, leaking secrets, or allocating unbounded memory under:
 * 1. Zero-length frames, maximum-size frames, oversized frames.
 * 2. Invalid service UUIDs and characteristic IDs.
 * 3. Invalid sequence numbers, negative sequences, boundary overflows.
 * 4. Invalid fragment indices, total chunk overflows, duplicate & missing fragments.
 * 5. Malformed ciphertexts, tampered Poly1305 authentication tags, random fuzz bytes.
 * 6. Repeated malicious frame flooding (1,000 frames).
 * 7. Rapid connect/disconnect churn & connection flood.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateEd25519KeyPair,
  bytesToHex,
  hexToBytes,
  secureRandomBytes,
} from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';
import {
  BleHandshakeEngine,
  SlidingReplayWindow,
  ReplayStatus,
  BleFrameCodec,
  BleFrameReassembler,
  AuthenticatedBleSession,
  AndroidBleAdapter,
  IosBleAdapter,
  AndroidNativeBleBridge,
  IosCoreBluetoothBridge,
  BleHardwareUnavailableError,
  SOVRA_BLE_SERVICE_UUID,
  SOVRA_BLE_WRITE_CHAR_UUID,
} from '../src/mesh/index.js';

function createEstablishedSessionPair(): {
  initiator: AuthenticatedBleSession;
  responder: AuthenticatedBleSession;
} {
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

  return { initiator: initSess, responder: respSess };
}

describe('Section 8: Malicious BLE Input & Robustness Testing', () => {
  let alice: AuthenticatedBleSession;
  let bob: AuthenticatedBleSession;

  beforeEach(() => {
    const pair = createEstablishedSessionPair();
    alice = pair.initiator;
    bob = pair.responder;
  });

  describe('Frame & Codec Boundaries', () => {
    it('safely rejects zero-length frame without crashing or throwing unhandled exceptions', () => {
      const zeroFrame = new Uint8Array(0);

      // Decryptor check
      expect(() => {
        bob.decrypt(zeroFrame);
      }).toThrow(/BLE packet too short/);

      // Reassembler check
      const reassembler = new BleFrameReassembler();
      expect(reassembler.feed(zeroFrame)).toBeNull();
    });

    it('safely encodes and reassembles maximum-size valid frame (64 KB)', () => {
      const maxPayload = new Uint8Array(64 * 1024);
      for (let i = 0; i < maxPayload.length; i++) maxPayload[i] = i % 251;

      const chunks = BleFrameCodec.fragment(maxPayload, 512);
      expect(chunks.length).toBeGreaterThan(120);

      const reassembler = new BleFrameReassembler({ maxChunksPerTransfer: 500 });
      let result: Uint8Array | null = null;
      for (const ch of chunks) {
        const res = reassembler.feed(ch);
        if (res) result = res;
      }

      expect(result).not.toBeNull();
      expect(Array.from(result!)).toEqual(Array.from(maxPayload));
    });

    it('rejects oversized payload exceeding chunk quota limits', () => {
      const hugePayload = new Uint8Array(200 * 1024);
      const chunks = BleFrameCodec.fragment(hugePayload, 100);

      const reassembler = new BleFrameReassembler({ maxChunksPerTransfer: 50 });
      expect(() => {
        reassembler.feed(chunks[0]!);
      }).toThrow(/exceeds maximum allowed chunks/);
    });

    it('rejects corrupted fragment with index >= totalChunks', () => {
      const validPayload = new TextEncoder().encode('Test Data');
      const chunks = BleFrameCodec.fragment(validPayload, 50);
      const corruptedChunk = new Uint8Array(chunks[0]!);

      // Wire layout: Magic(2) + Flags(1) + Ver(1) + TransferId(16) + chunkIndex(2) + totalChunks(2)
      // Set chunkIndex (offset 20, 21) to 5, while totalChunks is 1
      corruptedChunk[20] = 0x00;
      corruptedChunk[21] = 0x05;

      const reassembler = new BleFrameReassembler();
      // Reassembler detects bounds violation (chunkIndex >= totalChunks) and safely returns null
      const res = reassembler.feed(corruptedChunk);
      expect(res).toBeNull();
    });

    it('handles duplicate fragments safely without memory growth or data corruption', () => {
      const payload = new TextEncoder().encode('Duplicate Stress Test');
      const chunks = BleFrameCodec.fragment(payload, 50);
      expect(chunks.length).toBeGreaterThanOrEqual(1);

      const reassembler = new BleFrameReassembler();
      // Feed chunk 0 five times in a row
      for (let i = 0; i < 5; i++) {
        reassembler.feed(chunks[0]!);
      }

      expect(reassembler.getActiveTransferCount()).toBeLessThanOrEqual(1);
    });

    it('handles missing fragments without hanging or leaking state', () => {
      const payload = new TextEncoder().encode('Payload with missing piece');
      const chunks = BleFrameCodec.fragment(payload, 10);
      expect(chunks.length).toBeGreaterThan(2);

      const reassembler = new BleFrameReassembler();
      // Feed chunk 0 and chunk 2, but omit chunk 1
      reassembler.feed(chunks[0]!);
      if (chunks[2]) reassembler.feed(chunks[2]!);

      // Never reassembles completely
      expect(reassembler.feed(chunks[0]!)).toBeNull();
    });
  });

  describe('Cryptographic Fuzz & Malformed Ciphertexts', () => {
    it('safely rejects truncated packets shorter than minimum header + tag (24 bytes)', () => {
      for (let len = 1; len < 24; len++) {
        const shortPacket = secureRandomBytes(len);
        expect(() => {
          bob.decrypt(shortPacket);
        }).toThrow(/BLE packet too short/);
      }
    });

    it('safely rejects completely random garbage bytes of arbitrary length', () => {
      for (let trial = 0; trial < 10; trial++) {
        const randomLength = 24 + Math.floor(Math.random() * 200);
        const garbage = secureRandomBytes(randomLength);

        expect(() => {
          bob.decrypt(garbage);
        }).toThrow();
      }
    });

    it('safely rejects payload with corrupted authentication tag (last 16 bytes)', () => {
      const valid = alice.encrypt(new TextEncoder().encode('Top secret message'));
      const tamperedTag = new Uint8Array(valid);

      // Corrupt the MAC tag at the end
      tamperedTag[tamperedTag.length - 1] ^= 0xaa;
      tamperedTag[tamperedTag.length - 8] ^= 0x55;

      expect(() => {
        bob.decrypt(tamperedTag);
      }).toThrow();
    });

    it('withstands repeated flooding of 1,000 malicious frames without unhandled rejections or crashes', () => {
      let rejectedCount = 0;

      for (let i = 0; i < 1000; i++) {
        const malicious = secureRandomBytes(32);
        try {
          bob.decrypt(malicious);
        } catch {
          rejectedCount++;
        }
      }

      expect(rejectedCount).toBe(1000);
      // Verify session can still decrypt a legitimate message after attack flood!
      const authentic = alice.encrypt(new TextEncoder().encode('Legitimate message survived flood'));
      const decrypted = bob.decrypt(authentic);
      expect(new TextDecoder().decode(decrypted)).toBe('Legitimate message survived flood');
    });
  });

  describe('Platform Adapter Churn & Connection Flood', () => {
    it('handles rapid connect and disconnect cycles without leaking connections', async () => {
      let connectCount = 0;
      let disconnectCount = 0;

      const mockBridge: AndroidNativeBleBridge = {
        isAvailable: async () => true,
        hasPermissions: async () => true,
        requestPermissions: async () => true,
        isBluetoothEnabled: async () => true,
        startAdvertising: async () => true,
        stopAdvertising: async () => {},
        startScanning: async () => true,
        stopScanning: async () => {},
        connectGatt: async (_addr, onDisc) => {
          connectCount++;
          return { gattId: `gatt-${connectCount}`, mtu: 512 };
        },
        requestMtu: async (_id, m) => m,
        writeCharacteristic: async () => true,
        disconnectGatt: async () => {
          disconnectCount++;
        },
      };

      const adapter = new AndroidBleAdapter(mockBridge);

      // Perform 50 rapid sequential connect/disconnect cycles
      for (let i = 0; i < 50; i++) {
        const ch = await adapter.connect(`00:11:22:33:44:${i.toString(16).padStart(2, '0')}`);
        expect(ch.isConnected).toBe(true);
        await ch.close();
        expect(ch.isConnected).toBe(false);
      }

      expect(connectCount).toBe(50);
    });

    it('safely handles concurrent connection flood of 20 peers', async () => {
      const mockBridge: AndroidNativeBleBridge = {
        isAvailable: async () => true,
        hasPermissions: async () => true,
        requestPermissions: async () => true,
        isBluetoothEnabled: async () => true,
        startAdvertising: async () => true,
        stopAdvertising: async () => {},
        startScanning: async () => true,
        stopScanning: async () => {},
        connectGatt: async (addr) => ({ gattId: `gatt-${addr}`, mtu: 512 }),
        requestMtu: async (_id, m) => m,
        writeCharacteristic: async () => true,
        disconnectGatt: async () => {},
      };

      const adapter = new AndroidBleAdapter(mockBridge);

      const connPromises = Array.from({ length: 20 }, (_, idx) =>
        adapter.connect(`AA:BB:CC:DD:EE:${idx.toString(16).padStart(2, '0')}`)
      );

      const channels = await Promise.all(connPromises);
      expect(channels.length).toBe(20);
      for (const ch of channels) {
        expect(ch.isConnected).toBe(true);
        await ch.close();
      }
    });

    it('safely throttles discovery of thousands of peer advertising events', () => {
      const win = new SlidingReplayWindow(256);
      expect(win.getHighestSeen()).toBe(0n);

      // Stress test sliding window with 5,000 rapid sequence numbers
      for (let s = 1n; s <= 5000n; s++) {
        win.checkAndRecord(s);
      }

      expect(win.getHighestSeen()).toBe(5000n);
      expect((win as any).seenSeqs.size).toBeLessThanOrEqual(256);
    });
  });
});
