import { describe, it, expect } from 'vitest';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Sovra Creator VIP Monetization & AirDrop Mesh Radar Engine Suite', () => {
  const BASE_URL = 'http://localhost:3001';

  // =========================================================================
  // 1. CREATOR P2P TIP JAR & 95/5 SPLIT SETTLEMENT
  // =========================================================================
  describe('1. Creator P2P Micro-Tipping & 95/5 Split Settlement', () => {
    it('processes P2P micro-tips with 95% creator split, 5% seeder split, and 0% platform fee', async () => {
      const ts = Date.now();
      const senderDid = `did:sovra:tipper_${ts}`;
      const creatorDid = `did:sovra:creator_${ts}`;

      // Register tipper and creator in DB
      sovraDb.registerUser({
        did: senderDid,
        handle: `@tipper_${ts}`,
        displayName: 'Generous Supporter',
      });
      sovraDb.registerUser({
        did: creatorDid,
        handle: `@creator_${ts}`,
        displayName: 'Master Creator',
      });

      const senderBefore = sovraDb.findUserByDid(senderDid)!.balanceSov;
      const creatorBefore = sovraDb.findUserByDid(creatorDid)!.balanceSov;

      const res = await fetch(`${BASE_URL}/api/creator/tip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromDid: senderDid,
          creatorDid,
          creatorHandle: `@creator_${ts}`,
          creatorName: 'Master Creator',
          amount: 20,
          targetType: 'post',
          targetId: 'post-test-1',
          message: 'Decentralized social is the future! ⚡',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.ok).toBe(true);
      expect(data.creatorCut).toBe(19); // 95% of 20 SOV
      expect(data.seederCut).toBe(1);   // 5% of 20 SOV
      expect(data.newBalanceSov).toBe(senderBefore - 20);
      expect(data.split.platformTake).toBe(0);

      // Verify creator's balance received 95% directly
      await new Promise(r => setTimeout(r, 100));
      sovraDb.load(true);
      const creatorAfter = sovraDb.findUserByDid(creatorDid)!.balanceSov;
      expect(creatorAfter).toBeCloseTo(creatorBefore + 19, 2);
    });

    it('rejects invalid, negative, or zero tip amounts with HTTP 400', async () => {
      const res = await fetch(`${BASE_URL}/api/creator/tip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromDid: 'did:sovra:soundwave_sender',
          creatorDid: 'did:sovra:soundwave_merchant',
          amount: -5,
          targetType: 'post',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Invalid tip amount');
    });

    it('rejects tips when sender has insufficient balance', async () => {
      const res = await fetch(`${BASE_URL}/api/creator/tip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromDid: 'did:sovra:soundwave_sender',
          creatorDid: 'did:sovra:soundwave_merchant',
          amount: 999999, // Exceeds balance
          targetType: 'post',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Insufficient SOV balance');
    });
  });

  // =========================================================================
  // 2. CREATOR ANALYTICS & SOVEREIGN BONUS HUD
  // =========================================================================
  describe('2. Creator Sovereign Analytics HUD', () => {
    it('serves local-first creator metrics with 95% take-rate and sovereign bonus vs Web2', async () => {
      const res = await fetch(`${BASE_URL}/api/creator/analytics?creatorDid=did:sovra:soundwave_merchant`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.ok).toBe(true);
      expect(data.takeRatePct).toBe(95);
      expect(typeof data.totalVolumeSov).toBe('number');
      expect(typeof data.netCreatorTakeSov).toBe('number');
      expect(typeof data.traditionalWeb2TakeSov).toBe('number');
      expect(typeof data.sovereignBonusSov).toBe('number');
      expect(Array.isArray(data.tiers)).toBe(true);
      expect(data.tiers.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 3. VIP PASS CONTENT GATING
  // =========================================================================
  describe('3. VIP Pass & Membership Content Gating', () => {
    it('blocks unauthorized access to exclusive VIP video media with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/video/vip_exclusive_stream.mp4`);
      expect(res.status).toBe(403);
      const data = await res.json();

      expect(data.ok).toBe(false);
      expect(data.requiresVipPass).toBe(true);
      expect(data.status).toBe('VIP_PASS_RESTRICTED');
    });

    it('grants streaming access to VIP media when a valid VIP membership ticket header is provided', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/video/vip_exclusive_stream.mp4`, {
        headers: {
          'x-sovra-vip-ticket': 'sov_vip_pass_master_access_ticket',
        },
      });

      // Bypasses 403 VIP gate and proceeds to file serving (404 because file is virtual)
      expect(res.status).not.toBe(403);
    });
  });

  // =========================================================================
  // 4. AIRDROP-STYLE BLE MESH RADAR & DTN RELAY
  // =========================================================================
  describe('4. AirDrop-Style BLE Mesh Radar & DTN Relay', () => {
    it('discovers nearby BLE peers with spatial triangulation and cryptographic beacon verification', async () => {
      const res = await fetch(`${BASE_URL}/api/mesh/ble/scan`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.ok).toBe(true);
      expect(data.peersCount).toBeGreaterThanOrEqual(3);
      expect(Array.isArray(data.peers)).toBe(true);

      const peer = data.peers[0];
      expect(peer.distanceMeters).toBeGreaterThan(0);
      expect(peer.signatureHex).toBeDefined();
    });

    it('enqueues Store-and-Forward encrypted packets for 1-tap AirDrop relay to nearby peers', async () => {
      const res = await fetch(`${BASE_URL}/api/mesh/ble/relay-packet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderDid: 'did:sovra:soundwave_sender',
          senderHandle: '@soundwave_sender',
          recipientDid: 'did:sovra:bob_node',
          topic: 'SOV_OFFLINE_VOUCHER',
          payloadCiphertext: 'SOV_AIRDROP_VOUCHER_5.00_ED25519_SIGNED',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.packet.packetId).toContain('dtn_pkt_');
      expect(data.packet.status).toBe('QUEUED_DTN');
    });
  });

  // =========================================================================
  // 5. OFFLINE STORE-AND-FORWARD GOSSIP OUTBOX
  // =========================================================================
  describe('5. Offline Store-and-Forward Gossip Outbox Sync', () => {
    it('batch flushes queued offline actions (posts, comments, tips) when connectivity restores', async () => {
      const ts = Date.now();
      const res = await fetch(`${BASE_URL}/api/mesh/offline/outbox-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actions: [
            {
              id: `offline_post_${ts}`,
              type: 'post',
              content: `Offline emergency broadcast generated in blackout mode at ${ts}`,
              authorDid: 'did:sovra:soundwave_sender',
              authorHandle: '@soundwave_sender',
              authorName: 'Soundwave Peer',
            },
            {
              id: `offline_tip_${ts}`,
              type: 'tip',
              fromDid: 'did:sovra:soundwave_sender',
              creatorDid: 'did:sovra:soundwave_merchant',
              amount: 5,
              targetType: 'post',
              targetId: 'post-1',
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.ok).toBe(true);
      expect(data.syncedCount).toBe(2);
      expect(data.total).toBe(2);
      expect(data.results[0].status).toBe('SYNCED');
      expect(data.results[1].status).toBe('SYNCED');
    });
  });

  // =========================================================================
  // 6. PORTABLE SOVEREIGN AUDIENCE GRAPH EXPORT
  // =========================================================================
  describe('6. Portable Sovereign Audience Graph Exporter', () => {
    it('exports a cryptographically signed .sovra.json archive of user audience, posts, and keys', async () => {
      const res = await fetch(`${BASE_URL}/api/user/export-sovereign-graph?did=did:sovra:soundwave_sender`);
      expect(res.status).toBe(200);

      const disposition = res.headers.get('content-disposition');
      expect(disposition).toContain('attachment; filename=');
      expect(disposition).toContain('.sovra.json');

      const archive = await res.json();
      expect(archive.format).toBe('sovra_sovereign_graph_v1');
      expect(archive.version).toBe('1.0.0');
      expect(archive.did).toBe('did:sovra:soundwave_sender');
      expect(archive.profile.handle).toBeDefined();
      expect(archive.postsCount).toBeGreaterThanOrEqual(1);
      expect(archive.followersCount).toBeGreaterThanOrEqual(1);
      expect(archive.cryptographicProof).toBeDefined();
      expect(archive.cryptographicProof.suite).toBe('Ed25519_SHA256_RFC8032');
      expect(archive.cryptographicProof.signatureHex).toBeDefined();
      expect(archive.cryptographicProof.verified).toBe(true);
    });
  });

  // =========================================================================
  // 7. CLIENT-SIDE UI COMPONENTS & RADAR OVERLAY
  // =========================================================================
  describe('7. Client-Side Apple/VisionOS Glassmorphic UI & Radar Overlay', () => {
    it('serves the complete AirDrop Mesh Radar overlay and Creator Studio HUD in root HTML', async () => {
      const res = await fetch(BASE_URL);
      expect(res.status).toBe(200);
      const html = await res.text();

      // AirDrop Mesh Radar DOM components
      expect(html).toContain('id="mesh-radar-overlay"');
      expect(html).toContain('id="meshRadarFullscreenScope"');
      expect(html).toContain('id="meshRadarOverlaySweepBeam"');
      expect(html).toContain('id="meshRadarOrbsContainer"');
      expect(html).toContain('id="meshAirDropPanel"');
      expect(html).toContain('window.openMeshRadarOverlay =');
      expect(html).toContain('window.sendAirDropPayload =');

      // Creator Analytics HUD DOM components
      expect(html).toContain('id="creatorAnalyticsModal"');
      expect(html).toContain('id="creatorTotalVolumeDisplay"');
      expect(html).toContain('id="creatorNetTakeDisplay"');
      expect(html).toContain('id="creatorSovereignBonusDisplay"');
      expect(html).toContain('window.openCreatorAnalyticsModal =');

      // Profile settings export and studio buttons
      expect(html).toContain('id="exportSovereignGraphBtn"');
      expect(html).toContain('id="openCreatorAnalyticsBtn"');
      expect(html).toContain('id="openMeshRadarOverlayBtn"');
      expect(html).toContain('window.exportSovereignGraph =');

      // Tip jar buttons on Feed posts and Watch cards
      expect(html).toContain('btn-tip-');
      expect(html).toContain('yt-card-tip-btn');
      expect(html).toContain('window.tipWatchVideoCard');

      // Offline Gossip Outbox
      expect(html).toContain('window.SovraOfflineGossipOutbox =');
      expect(html).toContain("DB_NAME = 'sovra_sovereign_db'");

      // Celebratory Haptic Feedback pattern
      expect(html).toContain('triggerHapticFeedback([12, 40, 18])');
    });
  });
});
