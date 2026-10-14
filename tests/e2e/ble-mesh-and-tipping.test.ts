import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  SOVRA_BLE_SERVICE_UUID,
  SOVRA_BLE_TX_CHAR_UUID,
  SOVRA_BLE_RX_CHAR_UUID,
  estimateBleDistanceMeters,
  createSignedBeaconFrame,
  verifyBeaconFrame,
  OfflineBleMeshEngine,
} from '../../scripts/ble-mesh-engine.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Phase 3 (Offline BLE Mesh Radar) & Phase 4 (Universal Creator SOV Tipping) Suite', () => {
  let devServerCode: string;

  beforeAll(() => {
    devServerCode = fs.readFileSync(path.resolve(__dirname, '../../scripts/dev-server.ts'), 'utf-8');
  });

  // =========================================================================
  // PHASE 3: OFFLINE BLE MESH RADAR & DTN EPIDEMIC ROUTING
  // =========================================================================
  describe('Phase 3: Offline BLE Mesh Radar & Epidemic DTN Engine', () => {
    it('defines standard 128-bit Sovra GATT Service and TX/RX Characteristic UUIDs', () => {
      expect(SOVRA_BLE_SERVICE_UUID).toBe('00005076-0000-1000-8000-00805f9b34fb');
      expect(SOVRA_BLE_TX_CHAR_UUID).toBe('00005077-0000-1000-8000-00805f9b34fb');
      expect(SOVRA_BLE_RX_CHAR_UUID).toBe('00005078-0000-1000-8000-00805f9b34fb');
    });

    it('accurately triangulates physical distance in meters from RSSI (dBm) using ITU Log-Distance Path Loss', () => {
      const dist1m = estimateBleDistanceMeters(-59, -59);
      expect(dist1m).toBeCloseTo(1.0, 1);

      const distCloser = estimateBleDistanceMeters(-48, -59);
      const distFarther = estimateBleDistanceMeters(-78, -59);
      expect(distCloser).toBeLessThan(dist1m);
      expect(distFarther).toBeGreaterThan(dist1m);
    });

    it('creates and verifies cryptographic HMAC-SHA256 BLE proximity beacon frames and rejects tampered frames', () => {
      const beacon = createSignedBeaconFrame({
        senderDid: 'did:sovra:mesh_tester_1',
        senderHandle: '@mesh_tester_1',
        senderName: 'Mesh Tester One',
        rssiDbm: -55,
        txPowerDbm: -59,
      });

      expect(beacon.distanceMeters).toBeGreaterThan(0);
      expect(verifyBeaconFrame(beacon).valid).toBe(true);

      // Tamper with RSSI/Did and ensure signature verification fails
      const tampered = { ...beacon, peerDid: 'did:sovra:attacker_spoof' };
      expect(verifyBeaconFrame(tampered).valid).toBe(false);
    });

    it('discovers nearby BLE peers, queues Store-and-Forward DTN packets, and performs bilateral epidemic sync', () => {
      const mesh = new OfflineBleMeshEngine();
      const peers = mesh.scanNearbyPeers();
      expect(peers.length).toBeGreaterThanOrEqual(3);

      // Broadcast new signed beacon from a nearby mobile device
      const registered = mesh.registerBeacon({
        peerDid: 'did:sovra:field_medic_node',
        handle: '@field_medic',
        displayName: 'Field Medic Relay',
        rssiDbm: -51,
      });
      expect(registered.peerDid).toBe('did:sovra:field_medic_node');
      expect(registered.distanceMeters).toBeGreaterThan(0);

      // Enqueue Store-and-Forward encrypted DTN packet for Field Medic
      const pkt = mesh.enqueueOfflinePacket({
        senderDid: 'did:sovra:self_node',
        recipientDid: 'did:sovra:field_medic_node',
        payloadCiphertext: Buffer.from('Emergency medical supply coordinates: 28.6139N, 77.2090E').toString('hex'),
        ttlHops: 5,
      });
      expect(pkt.packetId).toContain('dtn_pkt_');
      expect(pkt.hopsRemaining).toBe(5);

      // Perform bilateral epidemic sync with Field Medic
      const syncResult = mesh.syncWithPeer({
        initiatorDid: 'did:sovra:self_node',
        responderDid: 'did:sovra:field_medic_node',
      });
      expect(syncResult.deliveredPackets.length).toBeGreaterThanOrEqual(1);
      expect(syncResult.deliveredPackets[0].packetId).toBe(pkt.packetId);
      expect(syncResult.deliveredPackets[0].deliveredAt).toBeDefined();
    });

    it('exposes Phase 3 BLE Mesh Radar REST routes and interactive 360° Radar HUD in dev-server.ts', () => {
      expect(devServerCode).toContain("pathname === '/api/mesh/ble/scan'");
      expect(devServerCode).toContain("pathname === '/api/mesh/ble/beacon'");
      expect(devServerCode).toContain("pathname === '/api/mesh/ble/relay-packet'");
      expect(devServerCode).toContain("pathname === '/api/mesh/ble/sync'");
      expect(devServerCode).toContain('id="sovraBleMeshRadarCard"');
      expect(devServerCode).toContain('id="bleRadarScope"');
      expect(devServerCode).toContain('id="bleRadarBlipsContainer"');
      expect(devServerCode).toContain('window.SovraBleMeshRadar = {');
    });
  });

  // =========================================================================
  // PHASE 4: UNIVERSAL CREATOR SOV TIPPING & 95/5 BITSWAP SEEDER SPLIT
  // =========================================================================
  describe('Phase 4: Universal Creator SOV Tipping Engine (Reels, Feed Posts, Watch Videos)', () => {
    it('processes SOV tips across Reels, Feed Posts, and Videos with 95% Creator / 5% Seeder split and 0% Platform Fee', () => {
      const ts = Date.now();
      const senderDid = `did:sovra:tipper_${ts}`;
      const creatorDid = `did:sovra:creator_${ts}`;

      // Register tipper & creator in database
      sovraDb.registerUser({
        did: senderDid,
        handle: `@tipper_${ts}`,
        displayName: 'Sovereign Supporter',
      });
      sovraDb.registerUser({
        did: creatorDid,
        handle: `@creator_${ts}`,
        displayName: 'Original Creator',
      });

      const senderBefore = sovraDb.findUserByDid(senderDid)!.balanceSov;
      const creatorBefore = sovraDb.findUserByDid(creatorDid)!.balanceSov;

      // 1. Tip a Reel (20 SOV)
      const reelList = sovraDb.getState().reels;
      const targetReel = reelList[0];
      expect(targetReel).toBeDefined();
      const reelTipsBefore = Number(targetReel.tipsTotalSov || targetReel.tipsSov || 0);

      const tipRes = sovraDb.processTip({
        fromDid: senderDid,
        creatorDid,
        creatorHandle: `@creator_${ts}`,
        creatorName: 'Original Creator',
        targetType: 'reel',
        targetId: targetReel.id,
        amount: 20,
        message: 'Awesome sovereign reel!',
        rootHash: `0xroot_${ts}`,
        signatureHex: `0xsig_${ts}`,
      });

      expect(tipRes.ok).toBe(true);
      expect(tipRes.creatorCut).toBe(19); // 95% of 20 SOV
      expect(tipRes.seederCut).toBe(1);   // 5% of 20 SOV
      expect(tipRes.newBalanceSov).toBe(senderBefore - 20);
      expect(tipRes.targetTotalTipsSov).toBe(reelTipsBefore + 20);

      // Verify creator received 95% directly into their SOV balance
      const creatorAfter = sovraDb.findUserByDid(creatorDid)!.balanceSov;
      expect(creatorAfter).toBeCloseTo(creatorBefore + 19, 2);

      // 2. Tip a Feed Post (10 SOV)
      const feedPosts = sovraDb.getState().posts;
      const targetPost = feedPosts[0];
      expect(targetPost).toBeDefined();

      const postTipRes = sovraDb.processTip({
        fromDid: senderDid,
        creatorDid,
        targetType: 'post',
        targetId: targetPost.id,
        amount: 10,
        message: 'Great technical post!',
      });
      expect(postTipRes.ok).toBe(true);
      expect(postTipRes.creatorCut).toBe(9.5);
      expect(postTipRes.seederCut).toBe(0.5);

      // 3. Verify Creator Tips Ledger records both tips and aggregates earnings
      const ledger = sovraDb.getCreatorTipsLedger(creatorDid);
      expect(ledger.records.length).toBeGreaterThanOrEqual(2);
      expect(ledger.totalEarnedAsCreatorSov).toBeCloseTo(28.5, 2); // 19 + 9.5 SOV
    });

    it('exposes Phase 4 Universal Creator Tipping routes, Reels Tip button, and Tipping Modal in dev-server.ts', () => {
      expect(devServerCode).toContain('id="reelSovTipBtn"');
      expect(devServerCode).toContain('id="reelTipSovCount"');
      expect(devServerCode).toContain('id="creatorSovTipModal"');
      expect(devServerCode).toContain('window.SovraCreatorTippingEngine = {');
      expect(devServerCode).toContain('submitUniversalCreatorTip');
    });
  });
});
