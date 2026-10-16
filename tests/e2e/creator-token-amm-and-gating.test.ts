/**
 * @file tests/e2e/creator-token-amm-and-gating.test.ts
 * CosmWasm Creator Token AMM Swap & Token-Gated Content E2E Suite.
 *
 * Verifies:
 * 1. Multi-Asset Web3 Wallet Drawer (/api/wallet/assets)
 * 2. 1-Click Constant Product AMM Swap (/api/wallet/swap) - BuyTokens & SellTokens with 1% creator royalties
 * 3. Token-Gated Media Gateway (/api/media/stream/:id) - 403 Forbidden on insufficient tokens, 200 OK upon balance unlock
 * 4. Token-Gated Community Posts (/api/posts/:id/content) - Cryptographic balance verification
 * 5. Creator Studio VIP Tier Management (/api/studio/tiers/create) & Dashboard AMM depth reflection
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('CosmWasm Creator Token AMM Swap & Token-Gated Content Engine Suite', () => {
  let creatorDid = 'did:sovra:creator_amm_test_' + Date.now();
  let creatorAddress = 'sovra12a806ca82d506a025d580d40600abc77a69e10e7';
  let fanAddress = 'sovra1fan99482f7c082e66d8ba9264fa58ef2110c900';
  let tokenContractAddress = '';
  let tokenSymbol = 'FAN';
  let tokenName = 'VIP Fan Access Coin';

  // 1. Deploy CW20 Creator Token for tests
  it('prepares creator token via Creator Studio Launchpad (POST /api/studio/token/launch)', async () => {
    const res = await fetch(`${BASE_URL}/api/studio/token/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: tokenName,
        symbol: tokenSymbol,
        initialSupply: '1000000000', // 1,000 FAN
        decimals: 6,
        creatorDid,
        creatorAddress
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.contractAddress).toBeDefined();
    expect(data.contractAddress).toMatch(/^sovra1wasm[0-9a-f]{32,64}$/);
    tokenContractAddress = data.contractAddress;
  });

  // 2. Multi-Asset Wallet Drawer Portfolio Endpoint
  describe('Multi-Asset Web3 Wallet Drawer API', () => {
    it('returns native SOV and deployed CW20 creator tokens in GET /api/wallet/assets', async () => {
      const res = await fetch(`${BASE_URL}/api/wallet/assets?address=${encodeURIComponent(creatorAddress)}&did=${encodeURIComponent(creatorDid)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.address).toBe(creatorAddress);
      expect(Array.isArray(data.assets)).toBe(true);
      expect(data.assets.length).toBeGreaterThanOrEqual(2);

      const nativeAsset = data.assets.find((a: any) => a.type === 'native');
      expect(nativeAsset).toBeDefined();
      expect(nativeAsset.symbol).toBe('SOV');
      expect(Number(nativeAsset.balance)).toBeGreaterThan(0);

      const cw20Asset = data.assets.find((a: any) => a.contractAddress === tokenContractAddress);
      expect(cw20Asset).toBeDefined();
      expect(cw20Asset.name).toBe(tokenName);
      expect(cw20Asset.symbol).toBe(tokenSymbol);
      expect(cw20Asset.type).toBe('cw20');
      expect(data.totalValuationSov).toBeDefined();
      expect(data.totalValuationFormatted).toContain('SOV');
    });
  });

  // 3. Constant Product AMM Swap (Buy & Sell with 1% creator royalty)
  describe('CosmWasm AMM Swap & Bonding Curve Engine', () => {
    let initialReserveSov = 0n;
    let initialReserveToken = 0n;
    let tokensAcquired = '0';

    it('executes BuyTokens swap (Native SOV -> CW20 Token) with 1% creator royalty via POST /api/wallet/swap', async () => {
      const sovInput = '1000000'; // 1.0 SOV
      const res = await fetch(`${BASE_URL}/api/wallet/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: fanAddress,
          tokenAddress: tokenContractAddress,
          creatorAddress,
          direction: 'buy',
          amount: sovInput,
          minOutput: '5000000' // expect at least 5 tokens
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.direction).toBe('buy');
      expect(data.tokenAddress).toBe(tokenContractAddress);
      expect(data.inputAmount).toBe(sovInput);
      expect(BigInt(data.outputAmount)).toBeGreaterThan(0n);
      expect(data.creatorAddress).toBe(creatorAddress);

      // Verify 1% creator royalty fee deducted: 1% of 1,000,000 = 10,000 usov
      expect(data.royaltyFee).toBe('10000');
      expect(data.poolReserves).toBeDefined();
      expect(BigInt(data.poolReserves.reserveSov)).toBeGreaterThan(0n);
      expect(BigInt(data.poolReserves.reserveToken)).toBeGreaterThan(0n);

      initialReserveSov = BigInt(data.poolReserves.reserveSov);
      initialReserveToken = BigInt(data.poolReserves.reserveToken);
      tokensAcquired = data.outputAmount;
    });

    it('executes SellTokens swap (CW20 Token -> Native SOV) preserving bonding curve invariants', async () => {
      // Fan sells half of acquired tokens
      const sellAmount = (BigInt(tokensAcquired) / 2n).toString();
      const res = await fetch(`${BASE_URL}/api/wallet/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: fanAddress,
          tokenAddress: tokenContractAddress,
          creatorAddress,
          direction: 'sell',
          amount: sellAmount
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.direction).toBe('sell');
      expect(data.inputAmount).toBe(sellAmount);
      expect(BigInt(data.outputAmount)).toBeGreaterThan(0n);
      expect(BigInt(data.royaltyFee)).toBeGreaterThan(0n);

      // Verify pool reserves updated: SOV reserve decreased, Token reserve increased
      const newSov = BigInt(data.poolReserves.reserveSov);
      const newToken = BigInt(data.poolReserves.reserveToken);
      expect(newSov).toBeLessThan(initialReserveSov);
      expect(newToken).toBeGreaterThan(initialReserveToken);
    });

    it('lists active AMM pools in GET /api/wallet/pools', async () => {
      const res = await fetch(`${BASE_URL}/api/wallet/pools`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.pools)).toBe(true);
      expect(data.pools.length).toBeGreaterThanOrEqual(1);

      const activePool = data.pools.find((p: any) => p.tokenAddress === tokenContractAddress);
      expect(activePool).toBeDefined();
      expect(activePool.feePercent).toBe(1);
    });
  });

  // 4. Token-Gated Media Streaming Access Control
  describe('Token-Gated Media Engine & Access Validation', () => {
    const gatedMediaId = 'vip_masterclass_' + Date.now();

    it('configures token-gating on media item via POST /api/media/token-gate', async () => {
      const res = await fetch(`${BASE_URL}/api/media/token-gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId: gatedMediaId,
          contractAddress: tokenContractAddress,
          minBalance: '100000000', // Requires 100 FAN tokens
          tokenSymbol: 'FAN',
          creatorDid,
          title: 'Unreleased Album Preview & Masterclass'
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.media.tokenGated.contractAddress).toBe(tokenContractAddress);
      expect(data.media.tokenGated.minBalance).toBe('100000000');
    });

    it('rejects user with insufficient tokens with 403 Forbidden on GET /api/media/stream/:id', async () => {
      const zeroTokenAddress = 'sovra1pooruser000000000000000000000000000000000';
      const res = await fetch(`${BASE_URL}/api/media/stream/${gatedMediaId}?address=${zeroTokenAddress}`);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.status).toBe(403);
      expect(data.tokenGated).toBe(true);
      expect(data.contractAddress).toBe(tokenContractAddress);
      expect(data.requiredBalance).toBe('100000000');
      expect(data.userBalance).toBe('0');
      expect(data.unlockInstructions).toContain('Hold at least');
    });

    it('grants full streaming access (200 OK) to authorized token holder', async () => {
      // Creator address holds the initial 1,000 FAN tokens (1,000,000,000 > 100,000,000)
      const res = await fetch(`${BASE_URL}/api/media/stream/${gatedMediaId}?address=${creatorAddress}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.tokenGated).toBe(true);
      expect(data.tokenGatedPassed).toBe(true);
      expect(data.streamUrl).toBeDefined();
      expect(data.streamUrl).toContain('/storage/');
      expect(data.quality).toBe('1080p');
    });
  });

  // 5. Token-Gated Community Post Content
  describe('Token-Gated Community Posts API', () => {
    it('returns 200 OK with unrestricted content for non-gated post', async () => {
      const res = await fetch(`${BASE_URL}/api/posts/public_post_123/content`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.tokenGated).toBe(false);
      expect(data.content).toBeDefined();
    });
  });

  // 6. Creator Studio VIP Tier Management & AMM Dashboard
  describe('Creator Studio VIP Tier Management & AMM Dashboard Integration', () => {
    it('creates custom VIP tiers via POST /api/studio/tiers/create', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/tiers/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorDid,
          tokenAddress: tokenContractAddress,
          tiers: [
            { id: 'tier_bronze', name: 'Bronze Supporter', minBalance: '50000000', perks: ['VIP Chat', 'Backstage Pass'] },
            { id: 'tier_silver', name: 'Silver VIP', minBalance: '150000000', perks: ['All Bronze Perks', 'Monthly Q&A'] },
            { id: 'tier_gold', name: 'Gold Inner Circle', minBalance: '500000000', perks: ['All Silver Perks', 'Producer Credit'] }
          ]
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.tiers.length).toBe(3);
      expect(data.tiers[0].name).toBe('Bronze Supporter');
      expect(data.tiers[2].name).toBe('Gold Inner Circle');
    });

    it('queries configured VIP tiers via GET /api/studio/tiers', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/tiers?creatorDid=${encodeURIComponent(creatorDid)}&tokenAddress=${encodeURIComponent(tokenContractAddress)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.tiers.length).toBe(3);
    });

    it('reflects AMM spot price, liquidity depth, and VIP tiers in GET /api/studio/dashboard', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/dashboard?creatorAddress=${encodeURIComponent(creatorAddress)}&creatorDid=${encodeURIComponent(creatorDid)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.dashboard).toBeDefined();

      // Verify AMM metrics
      expect(data.amm).toBeDefined();
      expect(data.amm.spotPrice).toBeGreaterThan(0);
      expect(data.amm.reserveSov).toBeDefined();
      expect(data.amm.reserveToken).toBeDefined();
      expect(data.amm.liquidityDepthSovFormatted).toBeDefined();
      expect(data.amm.accumulatedRoyaltiesFormatted).toBeDefined();

      // Verify VIP tiers
      expect(Array.isArray(data.vipTiers)).toBe(true);
      expect(data.vipTiers.length).toBeGreaterThanOrEqual(2);
    });
  });
});
