/**
 * @file tests/e2e/cw721-nft-and-livestream-superchat.test.ts
 * CosmWasm CW721 NFT Collectibles & Live Stream SuperChat E2E Suite.
 *
 * Verifies:
 * 1. Creator Studio CW721 NFT Drop Launchpad (POST /api/studio/nft/drop)
 * 2. Primary NFT Minting & Access Pass Issuance (POST /api/nft/mint)
 * 3. Multi-Asset Wallet Drawer NFT Collectibles Inventory (GET /api/wallet/assets)
 * 4. Creator Studio Monetization Dashboard NFT Revenue Reflection (GET /api/studio/dashboard)
 * 5. Real-Time CosmWasm CW20 Live Stream SuperChat & Holographic Alert Engine (POST /api/livestream/superchat)
 * 6. Top Supporters Leaderboard & SuperChat Feed (GET /api/livestream/superchats)
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('CosmWasm CW721 NFT Collectibles & Live Stream SuperChat Suite', () => {
  const creatorDid = 'did:sovra:creator_nft_test_' + Date.now();
  const creatorAddress = 'sovra12a806ca82d506a025d580d40600abc77a69e10e7';
  const fanAliceAddress = 'sovra1fan_alice_' + Date.now().toString(36);
  const fanBobAddress = 'sovra1fan_bob_' + Date.now().toString(36);

  let dropId = '';
  let nftContractAddress = '';
  let mintedTokenId1 = '';
  let liveSessionId = 'live_session_stream_' + Date.now();

  // 1. Creator Studio CW721 NFT Drop Launchpad
  describe('Creator Studio CW721 NFT Drop Launchpad (POST /api/studio/nft/drop)', () => {
    it('deploys and initializes a new CW721 VIP pass NFT collection', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/nft/drop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Inner Circle VIP Pass',
          symbol: 'VIP',
          maxSupply: 50,
          mintPrice: '5000000', // 5 SOV
          currency: 'SOV',
          mediaCid: 'bafybeivippassmedia_cid_123',
          metadata: {
            description: 'Exclusive backstage pass granting lifetime access to private live streams and alpha releases.',
            perks: ['VIP Stream Chat Badge', 'Direct Creator Backstage Calls', 'Annual Merch Drop'],
            attributes: [
              { trait_type: 'Access Level', value: 'Inner Circle' },
              { trait_type: 'Season', value: '2026 Season 1' },
            ]
          },
          creatorDid,
          creatorAddress
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.dropId).toBeDefined();
      expect(data.contractAddress).toMatch(/^sovra1wasm[0-9a-f]{32,64}$/);
      expect(data.drop.name).toBe('Inner Circle VIP Pass');
      expect(data.drop.symbol).toBe('VIP');
      expect(data.drop.maxSupply).toBe(50);
      expect(data.drop.mintedCount).toBe(0);

      dropId = data.dropId;
      nftContractAddress = data.contractAddress;
    });

    it('queries active creator NFT drops via GET /api/studio/nft/drops', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/nft/drops?creatorDid=${encodeURIComponent(creatorDid)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.drops)).toBe(true);
      expect(data.drops.length).toBeGreaterThanOrEqual(1);

      const foundDrop = data.drops.find((d: any) => d.dropId === dropId);
      expect(foundDrop).toBeDefined();
      expect(foundDrop.name).toBe('Inner Circle VIP Pass');
      expect(foundDrop.mintPrice).toBe('5000000');
    });
  });

  // 2. Primary NFT Minting & Access Pass Issuance
  describe('Primary NFT Minting & Access Pass Issuance (POST /api/nft/mint)', () => {
    it('mints VIP Pass #1 to Fan Alice', async () => {
      const res = await fetch(`${BASE_URL}/api/nft/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dropId,
          buyerAddress: fanAliceAddress,
          buyerDid: 'did:sovra:fan_alice'
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.tokenId).toBe('vip_#1');
      expect(data.nft.owner).toBe(fanAliceAddress);
      expect(data.nft.contractAddress).toBe(nftContractAddress);
      expect(data.drop.mintedCount).toBe(1);
      expect(data.drop.accumulatedRevenue).toBe('5000000');

      mintedTokenId1 = data.tokenId;
    });

    it('mints VIP Pass #2 to Fan Bob and tracks accumulated creator revenue', async () => {
      const res = await fetch(`${BASE_URL}/api/nft/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dropId,
          buyerAddress: fanBobAddress,
          buyerDid: 'did:sovra:fan_bob'
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.tokenId).toBe('vip_#2');
      expect(data.nft.owner).toBe(fanBobAddress);
      expect(data.drop.mintedCount).toBe(2);
      expect(data.drop.accumulatedRevenue).toBe('10000000'); // 10 SOV
    });
  });

  // 3. Multi-Asset Wallet Drawer NFT Inventory
  describe('Multi-Asset Wallet Drawer NFT Inventory (GET /api/wallet/assets)', () => {
    it('returns owned CW721 NFT pass in Alice wallet portfolio', async () => {
      const res = await fetch(`${BASE_URL}/api/wallet/assets?address=${encodeURIComponent(fanAliceAddress)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.nfts)).toBe(true);
      expect(data.nftCount).toBeGreaterThanOrEqual(1);

      const aliceNft = data.nfts.find((n: any) => n.tokenId === mintedTokenId1);
      expect(aliceNft).toBeDefined();
      expect(aliceNft.owner).toBe(fanAliceAddress);
      expect(aliceNft.name).toContain('Inner Circle VIP Pass');
      expect(aliceNft.image).toBeDefined();
    });
  });

  // 4. Creator Studio Monetization Dashboard NFT Revenue Reflection
  describe('Creator Studio Monetization Dashboard (GET /api/studio/dashboard)', () => {
    it('reflects NFT drops and accumulated primary sales revenue in studio metrics', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/dashboard?creatorDid=${encodeURIComponent(creatorDid)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.dashboard.nftDrops).toBeDefined();
      expect(data.dashboard.nftDrops.length).toBeGreaterThanOrEqual(1);
      expect(data.dashboard.totalNftRevenue).toBe('10000000');
      expect(data.dashboard.totalNftRevenueFormatted).toContain('SOV');
    });
  });

  // 5. CosmWasm CW20 Live Stream SuperChat & Holographic Alert Engine
  describe('CosmWasm CW20 Live Stream SuperChat & Holographic Alert Engine', () => {
    it('broadcasts Gold Tier SuperChat (100 FAN tokens) via POST /api/livestream/superchat', async () => {
      const res = await fetch(`${BASE_URL}/api/livestream/superchat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: liveSessionId,
          creatorDid,
          creatorAddress,
          senderAddress: fanAliceAddress,
          senderName: 'Alice Music Lover',
          amount: '100000000', // 100 FAN tokens
          tokenAddress: 'sovra1wasm_test_creator_token',
          tokenSymbol: 'FAN',
          message: 'The production quality on this track is mindblowing! 🔥'
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.animation).toBe('HOLOGRAPHIC_BANNER');
      expect(data.superchat).toBeDefined();
      expect(data.superchat.tier).toBe('gold');
      expect(data.superchat.bannerColor).toBe('#eab308');
      expect(data.superchat.amount).toBe('100000000');
      expect(data.superchat.message).toBe('The production quality on this track is mindblowing! 🔥');
      expect(Array.isArray(data.leaderboard)).toBe(true);
      expect(data.leaderboard.length).toBeGreaterThanOrEqual(1);
      expect(data.leaderboard[0].senderName).toBe('Alice Music Lover');
    });

    it('broadcasts Diamond Tier SuperChat (500 FAN tokens) and updates Leaderboard ranking', async () => {
      const res = await fetch(`${BASE_URL}/api/livestream/superchat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: liveSessionId,
          creatorDid,
          creatorAddress,
          senderAddress: fanBobAddress,
          senderName: 'Bob Whale Patron',
          amount: '500000000', // 500 FAN tokens
          tokenAddress: 'sovra1wasm_test_creator_token',
          tokenSymbol: 'FAN',
          message: 'Take my tokens! Drop the full album this Friday please! 💎'
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.superchat.tier).toBe('diamond');
      expect(data.superchat.bannerColor).toBe('#ec4899');
      expect(data.superchat.durationMs).toBe(30000);

      // Bob should now be #1 on the leaderboard (500 tokens > 100 tokens)
      expect(data.leaderboard[0].senderName).toBe('Bob Whale Patron');
      expect(data.leaderboard[1].senderName).toBe('Alice Music Lover');
    });

    it('queries active SuperChats and Top Supporters leaderboard via GET /api/livestream/superchats', async () => {
      const res = await fetch(`${BASE_URL}/api/livestream/superchats?sessionId=${encodeURIComponent(liveSessionId)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.superchats)).toBe(true);
      expect(data.superchats.length).toBe(2);
      expect(data.leaderboard.length).toBe(2);
      expect(data.leaderboard[0].senderName).toBe('Bob Whale Patron');
      expect(data.leaderboard[0].displayTotal).toBe('500');
    });
  });
});
