import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import {
  encodeGeohash,
  decodeGeohash,
  calculateHaversineDistanceKm,
  getGeohashesInRadius,
  fuzzCoordinates,
} from '../../packages/social/src/geohash.js';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Geo-Spatial Geohash & Trustless P2P Escrow Marketplace', () => {
  const sellerDid = 'did:sov:test_seller_market_01';
  const buyerDid = 'did:sov:test_buyer_market_02';

  beforeEach(() => {
    sovraDb.load();
    // Ensure test seller and buyer exist with initial balances
    let seller = sovraDb.findUserByDid(sellerDid);
    if (!seller) {
      sovraDb.registerUser({
        did: sellerDid,
        handle: 'seller_alice',
        displayName: 'Alice Marketplace Seller',
        balanceSov: 50,
      });
      seller = sovraDb.findUserByDid(sellerDid);
    }
    if (seller) {
      seller.balanceSov = 50;
    }

    let buyer = sovraDb.findUserByDid(buyerDid);
    if (!buyer) {
      sovraDb.registerUser({
        did: buyerDid,
        handle: 'buyer_bob',
        displayName: 'Bob Marketplace Buyer',
        balanceSov: 200,
      });
      buyer = sovraDb.findUserByDid(buyerDid);
    }
    if (buyer) {
      buyer.balanceSov = 200;
    }
  });

  describe('1. Geohash Encoding, Decoding & Privacy Fuzzing', () => {
    it('encodes and decodes GPS coordinates deterministically', () => {
      const lat = 37.7749;
      const lon = -122.4194;
      const hash = encodeGeohash(lat, lon, 6);
      expect(hash).toBeDefined();
      expect(hash.length).toBe(6);

      const decoded = decodeGeohash(hash);
      expect(Math.abs(decoded.point.latitude - lat)).toBeLessThan(0.01);
      expect(Math.abs(decoded.point.longitude - lon)).toBeLessThan(0.01);
    });

    it('computes accurate Haversine great-circle distances', () => {
      // Distance between San Francisco (37.7749, -122.4194) and Oakland (37.8044, -122.2712) ~ 13.5 km
      const dist = calculateHaversineDistanceKm(37.7749, -122.4194, 37.8044, -122.2712);
      expect(dist).toBeGreaterThan(12);
      expect(dist).toBeLessThan(15);
    });

    it('generates spatial bounding geohash sets for a radius', () => {
      const hashes = getGeohashesInRadius(37.7749, -122.4194, 10);
      expect(hashes.length).toBe(9); // center + 8 neighbors
      // All hashes should be non-empty strings of uniform length
      for (const h of hashes) {
        expect(typeof h).toBe('string');
        expect(h.length).toBe(hashes[0].length);
      }
    });

    it('fuzzes GPS coordinates to protect exact house/street address', () => {
      const exactLat = 37.7749295;
      const exactLon = -122.4194155;
      const fuzzed = fuzzCoordinates(exactLat, exactLon, 2.5);

      // Fuzzed centroid should be within 3km of exact coordinate
      const drift = calculateHaversineDistanceKm(exactLat, exactLon, fuzzed.latitude, fuzzed.longitude);
      expect(drift).toBeLessThan(3.5);
      // But not identical to 7 decimal places
      expect(fuzzed.latitude).not.toBe(exactLat);
    });
  });

  describe('2. Trustless P2P Escrow State Machine & QR Handover Proof', () => {
    it('executes full Escrow lifecycle: RESERVED -> DISPATCHED -> RELEASED with cryptographic delivery verification', () => {
      // 1. Seller lists item
      const item = sovraDb.createMarketplaceItem({
        sellerDid,
        title: 'M3 Max MacBook Pro 64GB',
        description: 'Pristine condition, mint battery',
        priceSov: 75.0,
        category: 'electronics',
        latitude: 37.7749,
        longitude: -122.4194,
        condition: 'like_new',
      });

      expect(item.id).toBeDefined();
      expect(item.status).toBe('active');
      expect(item.priceSov).toBe(75.0);

      const buyerBefore = Number(sovraDb.findUserByDid(buyerDid)?.balanceSov ?? 0);
      const sellerBefore = Number(sovraDb.findUserByDid(sellerDid)?.balanceSov ?? 0);

      // 2. Buyer creates escrow
      const { escrow, deliverySecret } = sovraDb.createMarketplaceEscrow(buyerDid, item.id);
      expect(escrow.status).toBe('RESERVED_IN_ESCROW');
      expect(escrow.amountSov).toBe(75.0);
      expect(deliverySecret).toBeDefined();

      // Verify buyer balance was debited immediately
      const buyerAfterReserve = sovraDb.findUserByDid(buyerDid)!.balanceSov;
      expect(buyerAfterReserve).toBe(buyerBefore - 75.0);

      // Verify item status transitioned to in_escrow
      const itemInEscrow = sovraDb.getMarketplaceItemById(item.id);
      expect(itemInEscrow?.status).toBe('in_escrow');

      // 3. Seller marks dispatched / ready for handover
      const dispatchedEscrow = sovraDb.dispatchMarketplaceEscrow(sellerDid, escrow.id);
      expect(dispatchedEscrow.status).toBe('DISPATCHED');

      // 4. Attempt release with forged secret -> MUST FAIL
      expect(() => {
        sovraDb.releaseMarketplaceEscrow(sellerDid, escrow.id, 'forged_fake_secret_hex');
      }).toThrow(/Invalid delivery verification secret/);

      // 5. Seller scans valid delivery secret from buyer QR code -> RELEASED
      const releasedEscrow = sovraDb.releaseMarketplaceEscrow(sellerDid, escrow.id, deliverySecret);
      expect(releasedEscrow.status).toBe('RELEASED_TO_SELLER');
      expect(releasedEscrow.releasedAt).toBeDefined();

      // Verify seller balance was credited
      const sellerAfterRelease = sovraDb.findUserByDid(sellerDid)!.balanceSov;
      expect(sellerAfterRelease).toBe(sellerBefore + 75.0);

      // Verify item status updated to sold
      const itemSold = sovraDb.getMarketplaceItemById(item.id);
      expect(itemSold?.status).toBe('sold');
    });

    it('handles dispute flow on contested escrow transactions', () => {
      const item = sovraDb.createMarketplaceItem({
        sellerDid,
        title: 'Vintage Road Bike',
        description: 'Classic steel frame',
        priceSov: 20.0,
        category: 'vehicles',
        latitude: 37.7749,
        longitude: -122.4194,
      });

      const { escrow } = sovraDb.createMarketplaceEscrow(buyerDid, item.id);
      expect(escrow.status).toBe('RESERVED_IN_ESCROW');

      const disputed = sovraDb.disputeMarketplaceEscrow(buyerDid, escrow.id, 'Item not as described during physical inspection');
      expect(disputed.status).toBe('DISPUTED');
      expect(disputed.disputeReason).toContain('Item not as described');
    });

    it('rejects purchase when buyer has insufficient SOV balance', () => {
      const expensiveItem = sovraDb.createMarketplaceItem({
        sellerDid,
        title: 'Tesla Model S Plaid',
        description: 'Fast EV',
        priceSov: 999999.0,
        category: 'vehicles',
        latitude: 37.7749,
        longitude: -122.4194,
      });

      expect(() => {
        sovraDb.createMarketplaceEscrow(buyerDid, expensiveItem.id);
      }).toThrow(/Insufficient SOV balance/);
    });
  });

  describe('3. Geo-Spatial Discovery for Items and Neighborhood Circles', () => {
    it('filters items by spatial radius and category', () => {
      // Listing in SF (0 km)
      sovraDb.createMarketplaceItem({
        sellerDid,
        title: 'SF Local Espresso Machine',
        description: 'Near Mission District',
        priceSov: 15.0,
        category: 'electronics',
        latitude: 37.7749,
        longitude: -122.4194,
      });

      // Listing in Oakland (~13.5 km away)
      sovraDb.createMarketplaceItem({
        sellerDid,
        title: 'Oakland Standing Desk',
        description: 'Pick up in Grand Lake',
        priceSov: 30.0,
        category: 'furniture',
        latitude: 37.8044,
        longitude: -122.2712,
      });

      // 5km query from SF center: should include SF item, exclude Oakland item
      const sfOnlyItems = sovraDb.getMarketplaceItems({
        latitude: 37.7749,
        longitude: -122.4194,
        radiusKm: 5,
      });
      const titles5k = sfOnlyItems.map(i => i.title);
      expect(titles5k).toContain('SF Local Espresso Machine');
      expect(titles5k).not.toContain('Oakland Standing Desk');

      // 25km query from SF center: should include both
      const bayAreaItems = sovraDb.getMarketplaceItems({
        latitude: 37.7749,
        longitude: -122.4194,
        radiusKm: 25,
      });
      const titles25k = bayAreaItems.map(i => i.title);
      expect(titles25k).toContain('SF Local Espresso Machine');
      expect(titles25k).toContain('Oakland Standing Desk');
    });

    it('creates and queries nearby neighborhood groups', () => {
      const group = sovraDb.createLocalGroup({
        name: 'Mission District Builders',
        description: 'Local P2P mesh and hardware hackers in the Mission',
        creatorDid: sellerDid,
        latitude: 37.7599,
        longitude: -122.4148,
        radiusKm: 5,
        category: 'technology',
      });

      expect(group.id).toBeDefined();
      expect(group.geohash).toBeDefined();

      const nearbyGroups = sovraDb.getNearbyLocalGroups({
        latitude: 37.7749,
        longitude: -122.4194,
        radiusKm: 10,
      });

      expect(nearbyGroups.some(g => g.name === 'Mission District Builders')).toBe(true);
    });
  });
});
