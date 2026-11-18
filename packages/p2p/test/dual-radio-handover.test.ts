/**
 * @file packages/p2p/test/dual-radio-handover.test.ts
 * Dual-Radio Hybrid Offline Mesh Suite (BLE + Wi-Fi Direct SHAREit/AirDrop Engine).
 *
 * Verifies:
 * 1. Payload Threshold Routing:
 *    - Payloads <= 64 KB remain on low-power BLE without activating Wi-Fi Direct.
 *    - Payloads > 64 KB dynamically negotiate Handover over BLE and stream over Wi-Fi Direct.
 * 2. Byte-for-Byte Fidelity:
 *    - 10 MB mock video stream transferred over Wi-Fi Direct with exact SHA-256 verification.
 * 3. Battery Conservation & Auto-Teardown:
 *    - Wi-Fi Direct Group Owner automatically powers down after transfer completion to save battery.
 * 4. Resilient Error Handling:
 *    - Corrupted or tampered high-speed payloads are rejected fail-closed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  generateEd25519KeyPair,
  bytesToHex,
  hexToBytes,
  sha256,
} from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';
import {
  MeshTransportManager,
  MeshRouter,
  DurableOutboxStore,
  LocalWifiTransport,
  VirtualWifiDirectAdapter,
  VirtualWifiDirectBus,
  MESH_MEDIA_HANDOVER_THRESHOLD_BYTES,
  TransportChannel,
  MeshEnvelope,
} from '../src/mesh/index.js';
import { ok } from '@sovra/shared';

describe('Dual-Radio Hybrid Offline Mesh (BLE + Wi-Fi Direct Engine)', () => {
  let aliceKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let bobKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let aliceDid: string;
  let bobDid: string;

  let aliceRouter: MeshRouter;
  let bobRouter: MeshRouter;

  let aliceWifiAdapter: VirtualWifiDirectAdapter;
  let bobWifiAdapter: VirtualWifiDirectAdapter;

  let aliceWifiTransport: LocalWifiTransport;
  let bobWifiTransport: LocalWifiTransport;

  let aliceManager: MeshTransportManager;
  let bobManager: MeshTransportManager;

  // Mock paired BLE channel linking Alice and Bob
  let aliceBleChannel: TransportChannel;
  let bobBleChannel: TransportChannel;

  beforeEach(async () => {
    VirtualWifiDirectBus.reset();

    aliceKeys = generateEd25519KeyPair();
    bobKeys = generateEd25519KeyPair();
    aliceDid = encodeEd25519DidKey(aliceKeys.publicKey);
    bobDid = encodeEd25519DidKey(bobKeys.publicKey);

    aliceRouter = new MeshRouter({
      localDid: aliceDid,
      localPrivateKey: aliceKeys.privateKey,
      outboxStore: new DurableOutboxStore({ localDid: aliceDid, inMemoryOnly: true }),
    });

    bobRouter = new MeshRouter({
      localDid: bobDid,
      localPrivateKey: bobKeys.privateKey,
      outboxStore: new DurableOutboxStore({ localDid: bobDid, inMemoryOnly: true }),
    });

    // Virtual Wi-Fi Direct adapters with 500ms auto-teardown for tests
    aliceWifiAdapter = new VirtualWifiDirectAdapter({
      localAddress: 'alice-wifi',
      simulatedIp: '192.168.49.2',
      autoTeardownTimeoutMs: 500,
    });

    bobWifiAdapter = new VirtualWifiDirectAdapter({
      localAddress: 'bob-wifi',
      simulatedIp: '192.168.49.1',
      autoTeardownTimeoutMs: 500,
    });

    aliceWifiTransport = new LocalWifiTransport({
      localAddress: 'alice-wifi',
      adapter: aliceWifiAdapter,
    });

    bobWifiTransport = new LocalWifiTransport({
      localAddress: 'bob-wifi',
      adapter: bobWifiAdapter,
    });

    aliceManager = new MeshTransportManager({
      router: aliceRouter,
      localWifiTransport: aliceWifiTransport,
    });

    bobManager = new MeshTransportManager({
      router: bobRouter,
      localWifiTransport: bobWifiTransport,
    });

    // Create bidirectional mock BLE channel between Alice and Bob
    let aliceOnData: ((d: Uint8Array) => void) | null = null;
    let bobOnData: ((d: Uint8Array) => void) | null = null;

    aliceBleChannel = {
      id: 'ble-alice-to-bob',
      peerAddress: 'bob-ble-mac',
      transportType: 'ble',
      mtu: 512,
      send: async (data: Uint8Array) => {
        if (bobOnData) {
          queueMicrotask(() => bobOnData!(new Uint8Array(data)));
        }
        return ok(undefined);
      },
      close: async () => {},
      onData: (h) => {
        aliceOnData = h;
        return () => { aliceOnData = null; };
      },
      onClose: () => () => {},
      onError: () => () => {},
    };
    (aliceBleChannel as any).remoteDid = bobDid;

    bobBleChannel = {
      id: 'ble-bob-to-alice',
      peerAddress: 'alice-ble-mac',
      transportType: 'ble',
      mtu: 512,
      send: async (data: Uint8Array) => {
        if (aliceOnData) {
          queueMicrotask(() => aliceOnData!(new Uint8Array(data)));
        }
        return ok(undefined);
      },
      close: async () => {},
      onData: (h) => {
        bobOnData = h;
        return () => { bobOnData = null; };
      },
      onClose: () => () => {},
      onError: () => () => {},
    };
    (bobBleChannel as any).remoteDid = aliceDid;

    // Attach BLE channels to both managers
    (aliceManager as any).attachChannelToRouter(aliceBleChannel);
    (bobManager as any).attachChannelToRouter(bobBleChannel);
  });

  afterEach(async () => {
    await aliceManager.stop();
    await bobManager.stop();
  });

  it('verifies that small payloads (<= 64 KB) route directly over BLE with zero Wi-Fi activations', async () => {
    const smallPayloadSize = 10 * 1024; // 10 KB (below threshold)
    const smallPayload = new Uint8Array(crypto.randomBytes(smallPayloadSize));

    let receivedEnvelope: MeshEnvelope | null = null;
    bobRouter.onMessage((env) => {
      receivedEnvelope = env;
    });

    const envelope = aliceRouter.createEnvelope({
      targetDid: bobDid,
      envelopeType: 'ENCRYPTED_MESSAGE',
      payloadBytes: smallPayload,
    });

    const routeResult = await aliceManager.routeMessage(envelope, 'bob-ble-mac');

    expect(routeResult.ok).toBe(true);
    if (routeResult.ok) {
      expect(routeResult.value.transport).toBe('ble');
      expect(routeResult.value.handover).toBe(false);
      expect(routeResult.value.bytesTransferred).toBe(smallPayloadSize);
    }

    // Await delivery microtask
    await new Promise(r => setTimeout(r, 50));

    expect(receivedEnvelope).not.toBeNull();
    expect(receivedEnvelope!.envelopeId).toBe(envelope.envelopeId);

    // Wi-Fi Direct must remain completely inactive (0 bytes, 0 transfers)
    expect(aliceWifiAdapter.transferCount).toBe(0);
    expect(aliceWifiAdapter.totalBytesTransferred).toBe(0);
    expect(bobWifiAdapter.transferCount).toBe(0);
  });

  it('verifies that large payloads (> 64 KB) dynamically trigger BLE Handover and stream over Wi-Fi Direct', async () => {
    const largePayloadSize = 2 * 1024 * 1024; // 2 MB (well above 64 KB threshold)
    const largePayload = new Uint8Array(crypto.randomBytes(largePayloadSize));
    const expectedSha256 = bytesToHex(sha256(largePayload));

    let receivedMediaData: Uint8Array | null = null;
    let receivedSha: string | null = null;

    bobManager.onMediaTransfer((_transferId, data, shaHex) => {
      receivedMediaData = data;
      receivedSha = shaHex;
    });

    const envelope = aliceRouter.createEnvelope({
      targetDid: bobDid,
      envelopeType: 'ENCRYPTED_MESSAGE',
      payloadBytes: largePayload,
    });

    const routeResult = await aliceManager.routeMessage(envelope, 'bob-ble-mac');

    expect(routeResult.ok).toBe(true);
    if (routeResult.ok) {
      expect(routeResult.value.transport).toBe('wifi_direct');
      expect(routeResult.value.handover).toBe(true);
      expect(routeResult.value.bytesTransferred).toBe(largePayloadSize);
    }

    // Await delivery
    await new Promise(r => setTimeout(r, 100));

    // Verify Bob received the complete media payload
    expect(receivedMediaData).not.toBeNull();
    expect(receivedMediaData!.byteLength).toBe(largePayloadSize);
    expect(receivedSha).toBe(expectedSha256);

    // Wi-Fi Direct must show exactly 1 transfer with 2 MB
    expect(aliceWifiAdapter.transferCount).toBe(1);
    expect(aliceWifiAdapter.totalBytesTransferred).toBe(largePayloadSize);
  });

  it('performs byte-for-byte fidelity test on 10 MB mock video file over simulated Wi-Fi Direct', async () => {
    const videoSize = 10 * 1024 * 1024; // 10 MB 1080p video
    const videoPayload = new Uint8Array(crypto.randomBytes(videoSize));
    const inputSha256 = bytesToHex(sha256(videoPayload));

    let outputSha256 = '';
    let outputBytes: Uint8Array | null = null;

    bobManager.onMediaTransfer((_id, data, shaHex) => {
      outputBytes = data;
      outputSha256 = shaHex;
    });

    const envelope = aliceRouter.createEnvelope({
      targetDid: bobDid,
      envelopeType: 'ENCRYPTED_MESSAGE',
      payloadBytes: videoPayload,
    });

    const result = await aliceManager.routeMessage(envelope, 'bob-ble-mac');
    expect(result.ok).toBe(true);

    await new Promise(r => setTimeout(r, 150));

    expect(outputBytes).not.toBeNull();
    expect(outputBytes!.byteLength).toBe(videoSize);
    expect(outputSha256).toBe(inputSha256);

    // Verify byte-for-byte exact equality across the entire 10 MB
    const isExactMatch = Buffer.from(videoPayload).equals(Buffer.from(outputBytes!));
    expect(isExactMatch).toBe(true);
  });

  it('verifies that Wi-Fi Direct automatically tears down and powers off within 3000ms post-transfer', async () => {
    // Configured with 500ms auto-teardown in beforeEach
    const payloadSize = 256 * 1024; // 256 KB
    const payload = new Uint8Array(crypto.randomBytes(payloadSize));

    const envelope = aliceRouter.createEnvelope({
      targetDid: bobDid,
      envelopeType: 'ENCRYPTED_MESSAGE',
      payloadBytes: payload,
    });

    const result = await aliceManager.routeMessage(envelope, 'bob-ble-mac');
    expect(result.ok).toBe(true);

    // Immediately after transfer, teardown timer is active
    expect(bobWifiAdapter.teardownCount).toBe(0);

    // Wait 600ms for auto-teardown to trigger
    await new Promise(r => setTimeout(r, 650));

    // Both group owner and client adapters must have triggered power-down teardown
    expect(bobWifiAdapter.teardownCount).toBeGreaterThan(0);
    expect(aliceWifiAdapter.teardownCount).toBeGreaterThan(0);
  });

  it('rejects corrupted or tampered payloads fail-closed', async () => {
    const payloadSize = 128 * 1024;
    const payload = new Uint8Array(crypto.randomBytes(payloadSize));

    let tamperInvoked = false;
    bobManager.onMediaTransfer(() => {
      tamperInvoked = true;
    });

    // Artificially inject tampered data into Bob's receiver
    const tamperedPayload = new Uint8Array(payload);
    tamperedPayload[42] = tamperedPayload[42] ^ 0xFF; // Corrupt byte
    const fakeSha = bytesToHex(sha256(payload)); // Original SHA doesn't match tampered bytes

    (bobManager as any).handleIncomingMediaTransfer('xfer_tampered', tamperedPayload, fakeSha);

    // Tampered payload must be dropped before calling handlers
    expect(tamperInvoked).toBe(false);
  });
});
