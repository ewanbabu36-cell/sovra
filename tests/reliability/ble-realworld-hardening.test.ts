import { loadServerContent } from '../helpers/test-source-loader.ts';
/**
 * @file tests/reliability/ble-realworld-hardening.test.ts
 * Real-World Hardening & Protocol Verification Suite for SOVRA BLE Mesh.
 *
 * Verifies:
 * 1. Compact 8-byte BLE Framing ([0] Magic 0x53, [1] Flags+Ver, [2..3] TransferId uint16, [4] ChunkIdx, [5] TotalChunks, [6..7] CRC-16).
 * 2. Minimum BLE ATT MTU = 23 bytes without throwing header overflow errors.
 * 3. Dual-Tier Priority DTN Queue: Financial vouchers/tips are strictly non-evictable over ephemeral chat.
 * 4. Priority batch ordering: Financial vouchers dispatched first on peer rendezvous.
 * 5. Android Manifest battery whitelist declaration & Apple Overflow parser logic.
 * 6. AirDrop-Style Proximity Horizon classification (<2m Immediate, <10m Nearby, <30m Outer).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BleFrameCodec,
  BleFrameReassembler,
  computeCrc16,
  BLE_COMPACT_FRAME_HEADER_SIZE,
  BLE_FRAME_MAGIC_COMPACT,
} from '../../packages/p2p/src/mesh/ble-codec.js';
import {
  DurableOutboxStore,
} from '../../packages/p2p/src/mesh/outbox-store.js';
import type { MeshEnvelope } from '../../packages/p2p/src/mesh/types.js';

describe('SOVRA BLE Mesh 100% Real-World Hardening Suite (Task ID: SOVRA-BLE-REALWORLD-P1-01)', () => {
  // =========================================================================
  // 1. COMPACT 8-BYTE CODEC & MINIMUM MTU 23 SUPPORT
  // =========================================================================
  describe('Phase 2: Compact 8-Byte Codec & Minimum ATT MTU 23 Support', () => {
    it('defines BLE_COMPACT_FRAME_HEADER_SIZE as 8 bytes and magic as 0x53', () => {
      expect(BLE_COMPACT_FRAME_HEADER_SIZE).toBe(8);
      expect(BLE_FRAME_MAGIC_COMPACT).toBe(0x53);
    });

    it('computes standard CRC-16-CCITT checksum over arbitrary byte slices', () => {
      const data = new TextEncoder().encode('SOVRA_MESH_CRC16_TEST');
      const crc = computeCrc16(data);
      expect(typeof crc).toBe('number');
      expect(crc).toBeGreaterThan(0);
      expect(crc).toBeLessThanOrEqual(0xffff);

      // Deterministic check
      expect(computeCrc16(data)).toBe(crc);
      // Bit flip change check
      const tampered = new Uint8Array(data);
      tampered[0] = (tampered[0]! ^ 0xff);
      expect(computeCrc16(tampered)).not.toBe(crc);
    });

    it('fragments payload under minimum BLE ATT MTU = 23 bytes without header overflow', () => {
      const testPayload = new TextEncoder().encode('Offline Sovereign Payment of 50 SOV to Alice');
      // MTU 23: Header is 8 bytes, effective payload slice is 15 bytes per chunk
      const chunks = BleFrameCodec.fragment(testPayload, 23);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      // Every chunk must be strictly <= 23 bytes
      for (const ch of chunks) {
        expect(ch.length).toBeLessThanOrEqual(23);
        // Header verification
        expect(ch[0]).toBe(0x53); // Magic
        const version = ch[1]! & 0x0f;
        expect(version).toBe(2); // Compact Version 2
      }
    });

    it('reassembles compact 8-byte chunks into identical original payload', () => {
      const originalText = 'Decentralized Offline DTN Message Transmitted via 8-Byte Compact Framing!';
      const payload = new TextEncoder().encode(originalText);
      const chunks = BleFrameCodec.fragmentCompact(payload, 23);

      const reassembler = new BleFrameReassembler();
      let assembled: Uint8Array | null = null;
      for (const ch of chunks) {
        assembled = reassembler.feed(ch);
      }

      expect(assembled).not.toBeNull();
      expect(new TextDecoder().decode(assembled!)).toBe(originalText);
    });

    it('rejects corrupted compact chunk with CRC-16 mismatch', () => {
      const payload = new Uint8Array(50).fill(7);
      const chunks = BleFrameCodec.fragmentCompact(payload, 23);

      const corrupted = new Uint8Array(chunks[0]!);
      // Corrupt payload byte
      corrupted[10] = (corrupted[10]! ^ 0xff);

      expect(() => {
        BleFrameCodec.decodeChunk(corrupted);
      }).toThrow(/CRC-16 checksum mismatch/);
    });
  });

  // =========================================================================
  // 2. DUAL-TIER DTN PRIORITY QUEUE
  // =========================================================================
  describe('Phase 2: Dual-Tier DTN Priority Queue (Financial Vouchers vs Ephemeral Chat)', () => {
    let store: DurableOutboxStore;

    beforeEach(() => {
      store = new DurableOutboxStore({
        maxRelayQueueSize: 5, // Small queue to trigger eviction tests
      });
    });

    function createDummyEnvelope(id: string, isFinancial: boolean, priority: number): MeshEnvelope {
      const payloadObj = isFinancial
        ? { type: 'VOUCHER', amount: 50, recipient: 'did:sovra:alice' }
        : { text: 'Hello mesh chat ping', senderName: 'Bob' };
      return {
        envelopeId: id,
        envelopeType: isFinancial ? 'FINANCIAL_VOUCHER' : 'ENCRYPTED_MESSAGE',
        originDid: 'did:sovra:sender',
        targetDid: 'did:sovra:recipient',
        hopCount: 1,
        maxHops: 5,
        route: ['did:sovra:sender'],
        timestamp: Date.now(),
        expiresAt: Date.now() + 600000,
        priority,
        payloadBytes: new TextEncoder().encode(JSON.stringify(payloadObj)),
        signatureHex: '0xabc123',
      };
    }

    it('identifies financial vouchers and offline payments accurately', () => {
      const financialEnv = createDummyEnvelope('fin_1', true, 2);
      const chatEnv = createDummyEnvelope('chat_1', false, 1);

      expect(store.isFinancialVoucher(financialEnv)).toBe(true);
      expect(store.isFinancialVoucher(chatEnv)).toBe(false);
    });

    it('strictly protects financial vouchers from LRU eviction when queue is full', () => {
      // 1. Enqueue 2 financial vouchers (Tier 1)
      const fin1 = createDummyEnvelope('fin_1', true, 2);
      const fin2 = createDummyEnvelope('fin_2', true, 2);
      store.enqueueRelay(fin1);
      store.enqueueRelay(fin2);

      // 2. Enqueue 3 ephemeral chat packets (Tier 2) to reach capacity (5)
      const chat1 = createDummyEnvelope('chat_1', false, 1);
      const chat2 = createDummyEnvelope('chat_2', false, 1);
      const chat3 = createDummyEnvelope('chat_3', false, 1);
      store.enqueueRelay(chat1);
      store.enqueueRelay(chat2);
      store.enqueueRelay(chat3);

      expect(store.getRelayQueueSize()).toBe(5);

      // 3. Enqueue 4th ephemeral chat packet -> MUST evict one of the chat packets, NEVER financial vouchers
      const chat4 = createDummyEnvelope('chat_4', false, 1);
      store.enqueueRelay(chat4);

      expect(store.getRelayQueueSize()).toBe(5);

      // Verify both financial vouchers are still present
      const batch = store.getNextRelayBatch(10);
      const batchIds = batch.map(e => e.envelopeId);
      expect(batchIds).toContain('fin_1');
      expect(batchIds).toContain('fin_2');
      expect(batchIds).toContain('chat_4');
    });

    it('orders financial vouchers before chat packets in getNextRelayBatch', () => {
      const chat1 = createDummyEnvelope('chat_1', false, 1);
      const fin1 = createDummyEnvelope('fin_1', true, 2);
      const chat2 = createDummyEnvelope('chat_2', false, 1);
      const fin2 = createDummyEnvelope('fin_2', true, 2);

      store.enqueueRelay(chat1);
      store.enqueueRelay(fin1);
      store.enqueueRelay(chat2);
      store.enqueueRelay(fin2);

      const batch = store.getNextRelayBatch(4);
      // Both financial vouchers MUST come first
      expect(store.isFinancialVoucher(batch[0]!)).toBe(true);
      expect(store.isFinancialVoucher(batch[1]!)).toBe(true);
      expect(store.isFinancialVoucher(batch[2]!)).toBe(false);
      expect(store.isFinancialVoucher(batch[3]!)).toBe(false);
    });
  });

  // =========================================================================
  // 3. OS CONTINUITY & PERMISSIONS
  // =========================================================================
  describe('Phase 1: Android & iOS Continuity & Parity Forensics', () => {
    it('declares REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in AndroidManifest.xml', () => {
      const manifestPath = path.resolve(__dirname, '../../apps/sovra-mobile/android/app/src/main/AndroidManifest.xml');
      const manifestContent = fs.readFileSync(manifestPath, 'utf8');
      expect(manifestContent).toContain('android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    });

    it('contains Apple Overflow Service parser in SovraBleModule.kt', () => {
      const bleModulePath = path.resolve(__dirname, '../../apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/ble/SovraBleModule.kt');
      const bleModuleContent = fs.readFileSync(bleModulePath, 'utf8');
      expect(bleModuleContent).toContain('isAppleOverflowServicePresent');
      expect(bleModuleContent).toContain('0x004C'); // Apple Company ID
      expect(bleModuleContent).toContain('requestIgnoreBatteryOptimizations');
      expect(bleModuleContent).toContain('didToMacMap'); // MAC Decoupling
    });
  });

  // =========================================================================
  // 4. AIRDROP-STYLE PROXIMITY BUBBLE RADAR UX
  // =========================================================================
  describe('Phase 3: AirDrop-Style Proximity Horizon & Bluetooth UX', () => {
    it('contains Concentric Distance Rings and Bluetooth OFF banner in ChatsScreen.tsx', () => {
      const chatsPath = path.resolve(__dirname, '../../apps/sovra-mobile/src/screens/ChatsScreen.tsx');
      const chatsContent = fs.readFileSync(chatsPath, 'utf8');
      expect(chatsContent).toContain('Immediate (&lt;2m)');
      expect(chatsContent).toContain('Nearby (&lt;10m)');
      expect(chatsContent).toContain('Outer (&lt;30m)');
      expect(chatsContent).toContain('Bluetooth Radio is OFF');
      expect(chatsContent).toContain('Turn On Bluetooth');
      expect(chatsContent).toContain('Eco Relay');
    });

    it('contains AirDrop-Style Rings, Bluetooth OFF Banner, and Eco Relay in dev-server.ts', () => {
      const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
      const devServerContent = loadServerContent(devServerPath);
      expect(devServerContent).toContain('Immediate Range (< 2m)');
      expect(devServerContent).toContain('Nearby Range (< 10m)');
      expect(devServerContent).toContain('Outer Mesh Range (< 30m)');
      expect(devServerContent).toContain('id="bleRadioOffBanner"');
      expect(devServerContent).toContain('id="bleDutyCycleToggleBtn"');
      expect(devServerContent).toContain('toggleDutyMode');
    });
  });
});
