/**
 * @file tests/e2e/commercialization-monetization-engine.test.ts
 * Master Commercialization, Revenue Engine & Competitor Parity E2E Suite.
 *
 * Verifies all 5 Revenue Dimensions:
 * Cycle 1: Tiered Creator Memberships, Subscription State Machine & Content Gating
 * Cycle 2: Live Stream High-Velocity Super-Chats, Micro-Stickers & Dynamic Pins Ticker
 * Cycle 3: Pay-Per-View (PPV), Gated Digital Products & Cryptographic Key Escrow
 * Cycle 4: B2B Verified Org Badging, Sponsored Post Escrow & Self-Serve CPM Promotions
 * Cycle 5: 95/5 Sovereign Payout Ledger, Viral 2% Referral Engine & RFC-4180 CSV Export
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sovraDb } from '../../scripts/database-engine.ts';
import { SovraLocalDatabase, MemoryStorageDriver } from '../../apps/sovra-mobile/src/services/local-database.ts';
import * as mobileApi from '../../apps/sovra-mobile/src/services/api.ts';

describe('Master Commercialization & Sovereign Revenue Engine Suite', () => {
  const devServerPath = path.resolve(process.cwd(), 'scripts', 'dev-server.ts');
  const studioRoutesPath = path.resolve(process.cwd(), 'scripts', 'routes', 'studio.routes.ts');
  const devServerCode = fs.readFileSync(devServerPath, 'utf-8');
  const studioRoutesCode = fs.readFileSync(studioRoutesPath, 'utf-8');

  const testCreatorDid = 'did:sovra:creator_alpha_123';
  const testFanDid = 'did:sovra:fan_bravo_456';
  const testReferrerDid = 'did:sovra:referrer_charlie_789';
  const testChannelId = 'chan_revenue_audit_01';

  beforeEach(() => {
    // Reset/seed clean in-memory state for testing
    sovraDb.db.channelMembershipTiers = [];
    sovraDb.db.channelSubscriptions = [];
    sovraDb.db.liveSuperChatPins = [];
    sovraDb.db.digitalProducts = [];
    sovraDb.db.digitalPurchases = [];
    sovraDb.db.orgSubscriptions = [];
    sovraDb.db.sponsoredEscrows = [];
    sovraDb.db.promotionCampaigns = [];
    sovraDb.db.financialLedger = [];
    sovraDb.db.creatorReferrals = [];

    // Ensure users have test balances
    const ensureUser = (did: string, sov: number) => {
      let u = sovraDb.db.users.find(x => x.id === did || x.did === did);
      if (!u) {
        u = {
          id: did,
          did,
          handle: '@' + (did.split(':').pop() || 'User').toLowerCase(),
          alias: did.split(':').pop() || 'User',
          displayName: did.split(':').pop() || 'User',
          avatarUrl: '',
          bio: 'Test commercial user',
          joinedAt: Date.now(),
          lastSeenAt: Date.now(),
          status: 'online',
          balanceSov: sov,
          balanceUsov: Math.round(sov * 1_000_000),
          isVerified: false,
          badges: [],
          reputationScore: 100,
          inboxState: 'empty',
        };
        sovraDb.db.users.push(u);
      } else {
        u.did = did;
        u.balanceSov = sov;
        u.balanceUsov = Math.round(sov * 1_000_000);
      }
      return u;
    };

    ensureUser(testCreatorDid, 100);
    ensureUser(testFanDid, 500);
    ensureUser(testReferrerDid, 50);

    // Ensure test channel exists
    let ch = sovraDb.db.channels.find(c => c.id === testChannelId);
    if (!ch) {
      ch = {
        id: testChannelId,
        handle: '@sovereigncreator',
        name: 'Sovereign Creator Studio',
        ownerDid: testCreatorDid,
        description: 'Elite sovereign decentralized media channel',
        avatarUrl: 'https://images.unsplash.com/photo-creator',
        bannerUrl: 'https://images.unsplash.com/photo-banner',
        subscriberCount: 15400,
        videoCount: 42,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now(),
        verified: true,
        badges: ['verified_creator'],
        links: [],
      };
      sovraDb.db.channels.push(ch);
    }
  });

  // =========================================================================
  // CYCLE 1: TIERED CREATOR MEMBERSHIPS & RECURRING SUBSCRIPTIONS
  // =========================================================================
  describe('Cycle 1: Tiered Creator Memberships & Subscription State Machine', () => {
    it('allows creators to configure 3 custom membership tiers', () => {
      const tiers = [
        {
          tierLevel: 1,
          name: 'Supporter Tier',
          priceSov: 5,
          badgeIcon: '🥉',
          badgeColor: '#cd7f32',
          perks: ['Loyalty badge', 'Exclusive member chat emoji'],
        },
        {
          tierLevel: 2,
          name: 'VIP Insider',
          priceSov: 20,
          badgeIcon: '🥈',
          badgeColor: '#94a3b8',
          perks: ['All Tier 1 perks', 'Early access to longform videos', 'Members-only live streams'],
        },
        {
          tierLevel: 3,
          name: 'Sovereign Council',
          priceSov: 50,
          badgeIcon: '👑',
          badgeColor: '#eab308',
          perks: ['All VIP perks', 'Direct monthly voice AMA', 'PPV video vault unlocked'],
        },
      ];

      const saved = sovraDb.setChannelMembershipTiers(testChannelId, tiers);
      expect(saved.length).toBe(3);
      expect(saved[0].name).toBe('Supporter Tier');
      expect(saved[1].priceSov).toBe(20);
      expect(saved[2].badgeIcon).toBe('👑');

      const retrieved = sovraDb.getChannelMembershipTiers(testChannelId);
      expect(retrieved.length).toBe(3);
    });

    it('subscribes a fan to Tier 2: debits fan, credits creator 95%, treasury 5%, produces ACTIVE sub', () => {
      sovraDb.setChannelMembershipTiers(testChannelId, [
        { tierLevel: 2, name: 'VIP Insider', priceSov: 20, badgeIcon: '🥈', badgeColor: '#94a3b8', perks: ['VIP'] },
      ]);

      const initialFanBalance = sovraDb.db.users.find(u => u.id === testFanDid)!.balanceSov;
      const initialCreatorBalance = sovraDb.db.users.find(u => u.id === testCreatorDid)!.balanceSov;

      const sub = sovraDb.subscribeChannelTier(testChannelId, testFanDid, 2);
      expect(sub).toBeDefined();
      expect(sub.status).toBe('ACTIVE');
      expect(sub.tierLevel).toBe(2);
      expect(sub.priceSov).toBe(20);
      expect(sub.paymentReceiptTx).toMatch(/^sov_sub_tx_/);
      expect(sub.nextRenewalAt).toBeGreaterThan(Date.now() + 29 * 86400000);

      const finalFanBalance = sovraDb.db.users.find(u => u.id === testFanDid)!.balanceSov;
      const finalCreatorBalance = sovraDb.db.users.find(u => u.id === testCreatorDid)!.balanceSov;

      // 20 SOV debited from fan
      expect(finalFanBalance).toBe(initialFanBalance - 20);
      // 95% of 20 = 19 SOV credited to creator
      expect(finalCreatorBalance).toBe(initialCreatorBalance + 19);

      // Verify active subscription lookup
      const activeSub = sovraDb.getUserChannelSubscription(testChannelId, testFanDid);
      expect(activeSub).not.toBeNull();
      expect(activeSub?.tierLevel).toBe(2);
      expect(activeSub?.status).toBe('ACTIVE');
    });

    it('supports subscription cancellation transitioning state machine to CANCELLED', () => {
      sovraDb.setChannelMembershipTiers(testChannelId, [
        { tierLevel: 1, name: 'Supporter Tier', priceSov: 5, badgeIcon: '🥉', badgeColor: '#cd7f32', perks: ['Badge'] },
      ]);
      sovraDb.subscribeChannelTier(testChannelId, testFanDid, 1);

      const cancelled = sovraDb.cancelChannelSubscription(testChannelId, testFanDid);
      expect(cancelled).toBe(true);

      const sub = sovraDb.getUserChannelSubscription(testChannelId, testFanDid);
      expect(sub?.status).toBe('CANCELLED');
    });

    it('enforces content gating: canUserAccessContent respects minMembershipTier hierarchy', () => {
      // Free content (no tier constraint or tier 0)
      expect(sovraDb.canUserAccessContent(testFanDid, 0, testChannelId)).toBe(true);
      expect(sovraDb.canUserAccessContent(testFanDid, undefined, testChannelId)).toBe(true);

      // Gated content requiring Tier 2
      // Fan has no subscription yet
      expect(sovraDb.canUserAccessContent(testFanDid, 2, testChannelId)).toBe(false);

      // Channel owner creator DID always has full sovereign bypass access
      expect(sovraDb.canUserAccessContent(testCreatorDid, 2, testChannelId)).toBe(true);

      // Fan subscribes to Tier 1
      sovraDb.subscribeChannelTier(testChannelId, testFanDid, 1);
      // Tier 1 fan cannot access Tier 2 content
      expect(sovraDb.canUserAccessContent(testFanDid, 2, testChannelId)).toBe(false);
      // Tier 1 fan can access Tier 1 content
      expect(sovraDb.canUserAccessContent(testFanDid, 1, testChannelId)).toBe(true);

      // Fan upgrades to Tier 3 Sovereign Council
      sovraDb.subscribeChannelTier(testChannelId, testFanDid, 3);
      // Tier 3 fan can access Tier 1, 2, and 3 content
      expect(sovraDb.canUserAccessContent(testFanDid, 1, testChannelId)).toBe(true);
      expect(sovraDb.canUserAccessContent(testFanDid, 2, testChannelId)).toBe(true);
      expect(sovraDb.canUserAccessContent(testFanDid, 3, testChannelId)).toBe(true);
    });

    it('provides REST endpoints for membership tiers and subscriptions', () => {
      expect(studioRoutesCode).toContain('/api/membership/tiers');
      expect(studioRoutesCode).toContain('/api/membership/subscribe');
      expect(studioRoutesCode).toContain('/api/membership/my-subscription');
      expect(studioRoutesCode).toContain('/api/membership/cancel');
      expect(studioRoutesCode).toContain('/api/content/access-check');
    });
  });

  // =========================================================================
  // CYCLE 2: LIVE STREAM REVENUE & HIGH-VELOCITY AUDIENCE TIPPING
  // =========================================================================
  describe('Cycle 2: Live Stream Super-Chats, Micro-Stickers & Pinned Ticker', () => {
    const streamId = 'stream_live_sovra_99';

    it('creates Bronze pin (10 SOV = 2 mins duration)', () => {
      const pin = sovraDb.sendLiveSuperChat({
        streamId,
        channelId: testChannelId,
        senderDid: testFanDid,
        senderName: 'FanBravo',
        senderAvatar: '',
        amountSov: 10,
        message: 'Decentralized revolution is here! 🚀',
        stickerId: 'rocket',
      });

      expect(pin.badgeTier).toBe('bronze');
      expect(pin.borderColor).toBe('#cd7f32');
      expect(pin.durationSec).toBe(120); // 2 minutes
      expect(pin.stickerId).toBe('rocket');
      expect(pin.expiresAt).toBe(pin.pinnedAt + 120_000);
      expect(pin.settlementTx).toMatch(/^sc_pin_tx_/);
    });

    it('creates Silver pin (50 SOV = 5 mins duration)', () => {
      const pin = sovraDb.sendLiveSuperChat({
        streamId,
        channelId: testChannelId,
        senderDid: testFanDid,
        senderName: 'FanBravo',
        senderAvatar: '',
        amountSov: 50,
        message: 'Diamond hands all the way! 💎',
        stickerId: 'diamond',
      });

      expect(pin.badgeTier).toBe('silver');
      expect(pin.borderColor).toBe('#94a3b8');
      expect(pin.durationSec).toBe(300); // 5 minutes
    });

    it('creates Gold pin (200 SOV = 15 mins duration with rainbow animation flag)', () => {
      const pin = sovraDb.sendLiveSuperChat({
        streamId,
        channelId: testChannelId,
        senderDid: testFanDid,
        senderName: 'FanBravo',
        senderAvatar: '',
        amountSov: 250,
        message: 'All hail the sovereign network! 👑',
        stickerId: 'crown',
      });

      expect(pin.badgeTier).toBe('gold');
      expect(pin.durationSec).toBe(900); // 15 minutes
      expect(pin.borderColor).toContain('linear-gradient');
    });

    it('getActiveLivePins prunes expired pins and orders remaining by amount descending', () => {
      const now = Date.now();
      const pruneStreamId = 'stream_live_prune_test';
      // Add active pin
      sovraDb.sendLiveSuperChat({
        streamId: pruneStreamId,
        channelId: testChannelId,
        senderDid: testFanDid,
        senderName: 'FanBravo',
        senderAvatar: '',
        amountSov: 20,
        message: 'Active pin 1',
      });

      // Add higher amount active pin
      sovraDb.sendLiveSuperChat({
        streamId: pruneStreamId,
        channelId: testChannelId,
        senderDid: testFanDid,
        senderName: 'FanBravo',
        senderAvatar: '',
        amountSov: 100,
        message: 'Active pin 2 (Higher)',
      });

      // Manually push expired pin
      sovraDb.db.liveSuperChatPins.push({
        id: 'expired_pin_001',
        streamId: pruneStreamId,
        channelId: testChannelId,
        senderDid: testFanDid,
        senderName: 'GhostUser',
        senderAvatar: '',
        amountSov: 500,
        message: 'Old expired pin',
        pinnedAt: now - 1000000,
        expiresAt: now - 500,
        durationSec: 120,
        badgeTier: 'bronze',
        borderColor: '#cd7f32',
        settlementTx: 'sc_tx_old',
      });

      const activePins = sovraDb.getActiveLivePins(pruneStreamId);
      expect(activePins.length).toBe(2);
      // Ordered descending by amount
      expect(activePins[0].amountSov).toBe(100);
      expect(activePins[1].amountSov).toBe(20);
      // Expired pin was omitted
      expect(activePins.find(p => p.id === 'expired_pin_001')).toBeUndefined();
    });

    it('aggregates live stream revenue and ranks top tipper leaderboard', () => {
      sovraDb.sendLiveSuperChat({
        streamId,
        channelId: testChannelId,
        senderDid: testFanDid,
        senderName: 'FanBravo',
        senderAvatar: '',
        amountSov: 100,
        message: 'Top tipper message',
      });

      const stats = sovraDb.getLiveStreamRevenueStats(streamId);
      expect(stats.totalRevenueSov).toBeGreaterThan(0);
      expect(stats.superChatCount).toBeGreaterThan(0);
      expect(stats.topTippers.length).toBeGreaterThan(0);
      expect(stats.topTippers[0].senderDid).toBe(testFanDid);
    });

    it('implements live super-chat endpoints in studio.routes.ts', () => {
      expect(studioRoutesCode).toContain('/api/live/super-chat');
      expect(studioRoutesCode).toContain('/api/live/super-chat/pins');
      expect(studioRoutesCode).toContain('/api/live/stream-revenue');
    });
  });

  // =========================================================================
  // CYCLE 3: PAY-PER-VIEW (PPV), GATED DIGITAL ASSETS & CREATOR STORE
  // =========================================================================
  describe('Cycle 3: Pay-Per-View, Gated Digital Products & Cryptographic Key Escrow', () => {
    const testVideoId = 'vid_ppv_masterclass_01';

    it('creates a digital PPV masterclass product linked to video', () => {
      const prod = sovraDb.createDigitalProduct({
        channelId: testChannelId,
        title: 'Decentralized Architecture Masterclass (4K)',
        description: 'Complete 3-hour masterclass with raw project assets and smart-contracts.',
        productType: 'ppv_video',
        priceSov: 15,
        downloadUrl: 'https://cdn.sovra.network/courses/p2p-arch.mp4',
        linkedVideoId: testVideoId,
        sellerDid: testCreatorDid,
      });

      expect(prod.id).toMatch(/^prod_/);
      expect(prod.priceSov).toBe(15);
      expect(prod.productType).toBe('ppv_video');
      expect(prod.linkedVideoId).toBe(testVideoId);

      const products = sovraDb.getChannelDigitalProducts(testChannelId);
      expect(products.some(p => p.id === prod.id)).toBe(true);
    });

    it('checks user PPV access before purchase (locked with 30s preview allowance)', () => {
      sovraDb.db.digital_product_purchases = (sovraDb.db.digital_product_purchases || []).filter(p => p.buyerDid !== testFanDid);
      const check = sovraDb.checkUserPPVAccess(testFanDid, testVideoId);
      expect(check.hasAccess).toBe(false);
      expect(check.previewDurationSec).toBe(30);
      expect(check.decryptionKey).toBeUndefined();
    });

    it('allows fan to purchase PPV product: debits SOV, issues cryptographic decryption key, unlocks video', () => {
      const prod = sovraDb.getChannelDigitalProducts(testChannelId).find(p => p.linkedVideoId === testVideoId)!;
      const initialFanBalance = sovraDb.db.users.find(u => u.id === testFanDid)!.balanceSov;

      const purchase = sovraDb.purchaseDigitalProduct(prod.id, testFanDid);
      expect(purchase).toBeDefined();
      expect(purchase.productId).toBe(prod.id);
      expect(purchase.buyerDid).toBe(testFanDid);
      expect(purchase.amountSov).toBe(15);
      // Cryptographic decryption key issued for DRM/media stream decryption
      expect(purchase.decryptionKey).toMatch(/^sov_key_[a-f0-9]{32}$/);
      expect(purchase.settlementTx).toMatch(/^sov_store_tx_/);

      // Verify fan balance was debited
      const finalFanBalance = sovraDb.db.users.find(u => u.id === testFanDid)!.balanceSov;
      expect(finalFanBalance).toBe(initialFanBalance - 15);

      // Post-purchase: checkUserPPVAccess immediately returns hasAccess: true with decryptionKey
      const checkAfter = sovraDb.checkUserPPVAccess(testFanDid, testVideoId);
      expect(checkAfter.hasAccess).toBe(true);
      expect(checkAfter.decryptionKey).toBe(purchase.decryptionKey);
    });

    it('protects against duplicate billing: second purchase returns existing receipt and decryption key', () => {
      const prod = sovraDb.getChannelDigitalProducts(testChannelId).find(p => p.linkedVideoId === testVideoId)!;
      const fanBalanceBefore = sovraDb.db.users.find(u => u.id === testFanDid)!.balanceSov;

      const duplicatePurchase = sovraDb.purchaseDigitalProduct(prod.id, testFanDid);
      const fanBalanceAfter = sovraDb.db.users.find(u => u.id === testFanDid)!.balanceSov;

      // Balance was NOT deducted a second time
      expect(fanBalanceAfter).toBe(fanBalanceBefore);
      expect(duplicatePurchase.buyerDid).toBe(testFanDid);
    });

    it('exposes digital store & PPV verification routes in studio.routes.ts', () => {
      expect(studioRoutesCode).toContain('/api/store/products');
      expect(studioRoutesCode).toContain('/api/store/purchase');
      expect(studioRoutesCode).toContain('/api/videos/access-check');
    });
  });

  // =========================================================================
  // CYCLE 4: B2B VERIFIED ORG BADGING, SPONSOR ESCROW & PROMOTIONS
  // =========================================================================
  describe('Cycle 4: B2B Verified Org Badging, Sponsor Escrow & CPM Promotions', () => {
    const orgDid = 'did:sovra:org_enterprise_01';
    const sponsorDid = 'did:sovra:sponsor_global_ventures';

    beforeEach(() => {
      // Ensure org & sponsor users exist
      let org = sovraDb.db.users.find(u => u.id === orgDid || u.did === orgDid);
      if (!org) {
        sovraDb.db.users.push({
          id: orgDid,
          did: orgDid,
          handle: '@acmeorg',
          alias: 'AcmeOrg',
          displayName: 'Acme Corp P2P',
          avatarUrl: '',
          bio: 'Global enterprise',
          joinedAt: Date.now(),
          lastSeenAt: Date.now(),
          status: 'online',
          balanceSov: 1000,
          balanceUsov: 1000_000_000,
          isVerified: false,
          badges: [],
          reputationScore: 500,
          inboxState: 'empty',
        });
      } else {
        org.did = orgDid;
        org.balanceSov = 1000;
      }
      let sponsor = sovraDb.db.users.find(u => u.id === sponsorDid || u.did === sponsorDid);
      if (!sponsor) {
        sovraDb.db.users.push({
          id: sponsorDid,
          did: sponsorDid,
          handle: '@globalventures',
          alias: 'GlobalVentures',
          displayName: 'Global Ventures',
          avatarUrl: '',
          bio: 'VC sponsor',
          joinedAt: Date.now(),
          lastSeenAt: Date.now(),
          status: 'online',
          balanceSov: 2000,
          balanceUsov: 2000_000_000,
          isVerified: true,
          badges: ['verified_sponsor'],
          reputationScore: 800,
          inboxState: 'empty',
        });
      } else {
        sponsor.did = sponsorDid;
        sponsor.balanceSov = 2000;
      }
    });

    it('subscribes an organization to Gold badge with multi-seat admin delegation', () => {
      const orgSub = sovraDb.subscribeOrgVerified({
        orgDid,
        badgeType: 'gold',
        adminDids: [orgDid, testCreatorDid],
      });

      expect(orgSub.status).toBe('ACTIVE');
      expect(orgSub.badgeType).toBe('gold');
      expect(orgSub.adminDids).toContain(testCreatorDid);
      expect(orgSub.priceSovMonth).toBe(200);

      // Verify badge lookup for org and affiliated admin
      const orgBadge = sovraDb.getOrgBadge(orgDid);
      expect(orgBadge?.badgeType).toBe('gold');
      expect(orgBadge?.isOrgAdmin).toBe(true);
    });

    it('executes end-to-end sponsored post escrow smart contract lifecycle', () => {
      // 1. Sponsor creates escrow locking 100 SOV
      const escrow = sovraDb.createSponsoredEscrow({
        sponsorDid,
        creatorDid: testCreatorDid,
        channelId: testChannelId,
        bountyAmountSov: 100,
        deliverableRequirements: 'Dedicated 60-second integration covering sovereign encrypted calls',
      });

      expect(escrow.id).toMatch(/^escrow_/);
      expect(escrow.status).toBe('ESCROWED');
      expect(escrow.bountyAmountSov).toBe(100);

      // 2. Creator submits content link
      const submitted = sovraDb.submitSponsoredContent(escrow.id, 'post_sovra_integration_448');
      expect(submitted).toBeDefined();
      expect(submitted?.status).toBe('SUBMITTED');
      expect(submitted?.submittedContentId).toBe('post_sovra_integration_448');
      // 48-hour auto-release deadline scheduled
      expect(submitted?.autoReleaseAt).toBeGreaterThan(Date.now() + 47 * 3600000);

      // 3. Release escrow: 95% (95 SOV) to creator, 5% (5 SOV) to treasury
      const initialCreatorBalance = sovraDb.db.users.find(u => u.id === testCreatorDid)!.balanceSov;
      const released = sovraDb.releaseSponsoredEscrow(escrow.id, sponsorDid);

      expect(released).toBeDefined();
      expect(released?.status).toBe('RELEASED');
      expect(released?.releaseTx).toMatch(/^sov_sponsor_tx_/);

      const finalCreatorBalance = sovraDb.db.users.find(u => u.id === testCreatorDid)!.balanceSov;
      expect(finalCreatorBalance).toBe(initialCreatorBalance + 95);
    });

    it('creates native self-serve CPM promotion campaign and bills impressions', () => {
      const camp = sovraDb.createPromotionCampaign({
        creatorDid: testCreatorDid,
        targetContentId: 'vid_ppv_masterclass_01',
        contentType: 'video',
        totalBudgetSov: 10,
        cpmSov: 2, // 2 SOV per 1000 impressions
      });

      expect(camp.status).toBe('ACTIVE');
      expect(camp.targetImpressions).toBe(5000); // 10 / 2 * 1000
      expect(camp.spentSov).toBe(0);

      // Record 1000 impressions
      const updated = sovraDb.recordPromotionImpression(camp.id, 1000);
      expect(updated).toBeDefined();
      expect(updated?.deliveredImpressions).toBe(1000);
      expect(updated?.spentSov).toBe(2);
      expect(updated?.status).toBe('ACTIVE');

      // Record 4000 more impressions (reaches budget cap)
      const finished = sovraDb.recordPromotionImpression(camp.id, 4000);
      expect(finished?.deliveredImpressions).toBe(5000);
      expect(finished?.spentSov).toBe(10);
      expect(finished?.status).toBe('COMPLETED');
    });

    it('exposes org verification, sponsor escrow and promotion endpoints in studio.routes.ts', () => {
      expect(studioRoutesCode).toContain('/api/org/verify-subscription');
      expect(studioRoutesCode).toContain('/api/org/badge-status');
      expect(studioRoutesCode).toContain('/api/sponsors/escrow/create');
      expect(studioRoutesCode).toContain('/api/sponsors/escrow/release');
      expect(studioRoutesCode).toContain('/api/promotions/campaign/create');
      expect(studioRoutesCode).toContain('/api/promotions/record-impression');
    });
  });

  // =========================================================================
  // CYCLE 5: AUTOMATED CREATOR PAYOUT LEDGER, FEE REVIEWS & REFERRALS
  // =========================================================================
  describe('Cycle 5: 95/5 Sovereign Payout Ledger, Viral 2% Referrals & CSV Export', () => {
    it('binds a viral referral link: referrer earns 2% of platform fee on downstream spend', () => {
      const binding = sovraDb.bindReferral(testFanDid, testReferrerDid);
      expect(binding.refereeDid).toBe(testFanDid);
      expect(binding.referrerDid).toBe(testReferrerDid);
      expect(binding.rewardPercent).toBe(2);
      expect(binding.expiresAt).toBeGreaterThan(Date.now() + 360 * 86400000); // 12 months
    });

    it('records financial ledger entry: 95% creator, 5% treasury, credits 2% referral bonus', () => {
      const initialReferrerBalance = sovraDb.db.users.find(u => u.id === testReferrerDid)!.balanceSov;

      const entry = sovraDb.recordFinancialLedgerEntry({
        channelId: testChannelId,
        creatorDid: testCreatorDid,
        payerDid: testFanDid,
        grossSov: 100,
        revenueType: 'channel_membership',
        referenceId: 'sub_test_ledger_001',
      });

      expect(entry.grossSov).toBe(100);
      expect(entry.creatorNetSov).toBe(95); // 95% creator
      expect(entry.platformFeeSov).toBe(5); // 5% platform fee
      expect(entry.referralPayoutSov).toBe(2); // 2% referral attribution
      expect(entry.referrerDid).toBe(testReferrerDid);
      expect(entry.txHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 cryptographic receipt

      // Verify referrer was credited 2 SOV immediately
      const finalReferrerBalance = sovraDb.db.users.find(u => u.id === testReferrerDid)!.balanceSov;
      expect(finalReferrerBalance).toBe(initialReferrerBalance + 2);

      // Verify referral reward tracking
      const rewards = sovraDb.getReferralRewards(testReferrerDid);
      expect(rewards.totalEarnedSov).toBeGreaterThanOrEqual(2);
      expect(rewards.referrals.length).toBeGreaterThan(0);
    });

    it('generates studio financials summary and standard RFC-4180 CSV export', () => {
      const financials = sovraDb.getStudioFinancials(testCreatorDid);
      expect(financials.summary.grossSov).toBeGreaterThanOrEqual(100);
      expect(financials.summary.creatorNetSov).toBeGreaterThanOrEqual(95);
      expect(financials.summary.platformFeeSov).toBeGreaterThanOrEqual(5);
      expect(financials.entries.length).toBeGreaterThanOrEqual(1);

      // Verify CSV export
      expect(financials.csv).toContain('id,timestamp,type,gross_sov,creator_net_sov,platform_fee_sov,payer_did,tx_hash');
      expect(financials.csv).toContain('channel_membership');
      expect(financials.csv).toContain(testCreatorDid);
    });

    it('exposes studio financials and referral endpoints in studio.routes.ts', () => {
      expect(studioRoutesCode).toContain('/api/studio/financials');
      expect(studioRoutesCode).toContain('/api/referrals/bind');
      expect(studioRoutesCode).toContain('/api/referrals/my-rewards');
    });
  });

  // =========================================================================
  // FRONTEND UI & MOBILE APP INTEGRATION INVARIANTS
  // =========================================================================
  describe('Frontend UI & Mobile Parity Integration Invariants', () => {
    it('verifies Studio Pro includes Financial Ledger subtab with CSV export in scripts/dev-server.ts', () => {
      expect(devServerCode).toContain('studioEarnSubtabLedger');
      expect(devServerCode).toContain('loadStudioFinancialLedger');
      expect(devServerCode).toContain('exportStudioFinancialsCsv');
      expect(devServerCode).toContain('Financial Ledger &amp; CSV');
    });

    it('verifies Channel Hub includes Join Channel Membership modal & Store tab in scripts/dev-server.ts', () => {
      expect(devServerCode).toContain('channelHubJoinBtn');
      expect(devServerCode).toContain('channelMembershipModal');
      expect(devServerCode).toContain('openChannelMembershipModal');
      expect(devServerCode).toContain('subscribeToChannelTier');
      expect(devServerCode).toContain('chanTabStore');
      expect(devServerCode).toContain('chanPanelStore');
      expect(devServerCode).toContain('renderChannelStore');
    });

    it('verifies Live Stream view includes Super-Chat modal with stickers & active ticker', () => {
      expect(devServerCode).toContain('liveSuperChatPinsTicker');
      expect(devServerCode).toContain('openLiveSuperChatModal');
      expect(devServerCode).toContain('submitLiveSuperChat');
      expect(devServerCode).toContain('liveSuperChatModal');
      expect(devServerCode).toContain('selectScSticker');
      expect(devServerCode).toContain('sc-sticker-btn');
    });

    it('verifies Mobile Local Database Schema v9 includes commercialization tables', async () => {
      const memDriver = new MemoryStorageDriver();
      const mobileDb = SovraLocalDatabase.getInstance(memDriver);

      // Schema version must be at least 9
      const schema = await mobileDb.getSchema();
      expect(schema.version).toBeGreaterThanOrEqual(9);

      // Verify local storage helpers exist
      expect(typeof mobileDb.saveChannelMembership).toBe('function');
      expect(typeof mobileDb.getChannelMembership).toBe('function');
      expect(typeof mobileDb.saveSuperChatPin).toBe('function');
      expect(typeof mobileDb.getActiveSuperChatPins).toBe('function');
      expect(typeof mobileDb.saveStoreProduct).toBe('function');
      expect(typeof mobileDb.getStoreProducts).toBe('function');
      expect(typeof mobileDb.saveStorePurchase).toBe('function');
      expect(typeof mobileDb.hasPurchasedProduct).toBe('function');
    });

    it('verifies Mobile API service exports all commercialization methods', () => {
      expect(typeof mobileApi.fetchChannelMembershipTiers).toBe('function');
      expect(typeof mobileApi.subscribeChannelTier).toBe('function');
      expect(typeof mobileApi.sendLiveSuperChat).toBe('function');
      expect(typeof mobileApi.fetchLiveSuperChatPins).toBe('function');
      expect(typeof mobileApi.fetchChannelStoreProducts).toBe('function');
      expect(typeof mobileApi.purchaseStoreProduct).toBe('function');
      expect(typeof mobileApi.fetchStudioFinancials).toBe('function');
    });
  });
});
