import { describe, it, expect } from 'vitest';
import {
  calculateChannelImbalance,
  calculateDynamicRoutingFee,
  VirtualChannelMeshRouter,
  StakeBackedDisputeBondManager,
} from '../src/index.js';

describe('Pillar 8: Virtual State Channel Mesh & Circular Rebate Netting', () => {
  it('calculates channel imbalance ratio correctly between -1.0 and 1.0', () => {
    // Balanced channel: Local 50, Remote 50 -> Lambda = 0.0
    expect(calculateChannelImbalance(50n, 50n)).toBe(0.0);

    // Outbound surplus: Local 90, Remote 10 -> Lambda = (90-10)/100 = 0.8
    expect(calculateChannelImbalance(90n, 10n)).toBe(0.8);

    // Inbound surplus / local depleted: Local 10, Remote 90 -> Lambda = (10-90)/100 = -0.8
    expect(calculateChannelImbalance(10n, 90n)).toBe(-0.8);
  });

  it('rewards rebalancing flows with discounts or rebates and charges congestion on depleted flows', () => {
    const baseFee = 100n;

    // Outbound send when local has heavy surplus (Local 90, Remote 10 -> Lambda = 0.8)
    // Sending helps restore balance, multiplier = 1 - 0.8 = 0.2 (rebate territory)
    const surplusQuote = calculateDynamicRoutingFee(baseFee, 90n, 10n, true);
    expect(surplusQuote.fee).toBe(20n);
    expect(surplusQuote.isRebate).toBe(true);

    // Outbound send when local is depleted (Local 10, Remote 90 -> Lambda = -0.8)
    // Sending worsens imbalance, multiplier = 1 - (-0.8) = 1.8 (congestion penalty)
    const depletedQuote = calculateDynamicRoutingFee(baseFee, 10n, 90n, true);
    expect(depletedQuote.fee).toBe(180n);
    expect(depletedQuote.isRebate).toBe(false);
  });

  it('plans multi-hop route across intermediary state channels', () => {
    const router = new VirtualChannelMeshRouter();
    router.registerChannel({
      channelId: 'chan_consumer_seeder',
      peerDid: 'did:sovra:seeder',
      localBalance: 1000n,
      remoteBalance: 200n,
      capacity: 1200n,
    });
    router.registerChannel({
      channelId: 'chan_seeder_creator',
      peerDid: 'did:sovra:creator',
      localBalance: 800n,
      remoteBalance: 300n,
      capacity: 1100n,
    });

    const quote = router.planMultiHopRoute(100n, 10n, ['chan_consumer_seeder', 'chan_seeder_creator']);
    expect(quote.isFeasible).toBe(true);
    expect(quote.hops.length).toBe(2);
    expect(quote.totalFee).toBeGreaterThan(0n);
  });
});

describe('Pillar 7: Stake-Backed Dispute Bonds & Restitution', () => {
  it('scales required dispute bond with creator view count and complainant reputation', () => {
    const baseStake = 1000n;

    // Viral creator (100,000 views) vs low reputation troll (0.1 rep)
    // viewFactor = 1 + log10(100,000) = 6.0; repFactor = 1 / 0.1 = 10.0; total = 60x multiplier
    const highRiskBond = StakeBackedDisputeBondManager.calculateRequiredBond(baseStake, 100000, 0.1);
    expect(highRiskBond).toBe(60000n);

    // Small creator (10 views) vs high reputation entity (1.0 rep)
    // viewFactor = 1 + log10(10) = 2.0; repFactor = 1 / 1.0 = 1.0; total = 2x multiplier
    const lowRiskBond = StakeBackedDisputeBondManager.calculateRequiredBond(baseStake, 10, 1.0);
    expect(lowRiskBond).toBe(2000n);
  });

  it('slashes 100% of complainant bond and awards 90% restitution to creator upon fraudulent claim', () => {
    const manager = new StakeBackedDisputeBondManager();
    const dispute = manager.registerDispute(
      'cid_news_report',
      'did:sovra:journalist',
      'did:sovra:troll',
      'DMCA_COPYRIGHT',
      10000,
      0.2,
      1000n,
    );

    expect(dispute.stakedBondAmount).toBeGreaterThan(1000n);

    // Oracles review and reject false claim (upheldByOracles = false)
    const resolution = manager.resolveDispute(dispute.disputeId, false);
    expect(resolution.isTakedownUpheld).toBe(false);
    expect(resolution.bondSlashed).toBe(true);

    // 90% restitution to victim creator
    const expectedRestitution = (dispute.stakedBondAmount * 90n) / 100n;
    expect(resolution.creatorRestitutionAmount).toBe(expectedRestitution);
    expect(resolution.refundToComplainant).toBe(0n);
  });

  it('refunds complainant bond in full when claim is upheld by oracles', () => {
    const manager = new StakeBackedDisputeBondManager();
    const dispute = manager.registerDispute(
      'cid_pirated_movie',
      'did:sovra:pirate',
      'did:sovra:studio',
      'DMCA_COPYRIGHT',
      500,
      0.9,
      1000n,
    );

    const resolution = manager.resolveDispute(dispute.disputeId, true);
    expect(resolution.isTakedownUpheld).toBe(true);
    expect(resolution.bondSlashed).toBe(false);
    expect(resolution.refundToComplainant).toBe(dispute.stakedBondAmount);
    expect(resolution.creatorRestitutionAmount).toBe(0n);
  });
});
