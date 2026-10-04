import { describe, it, expect } from 'vitest';
import { calculateDynamicDifficulty } from '../src/index.js';

describe('Pillar 3: Dynamic Congestion-Based PoW Difficulty Scaling', () => {
  it('assigns minimal difficulty to normal users with high reputation during calm network', () => {
    // Normal user (reputation 1.0, 1 TPS): base difficulty 4 bits
    const diff = calculateDynamicDifficulty(4, 1, 1.0);
    expect(diff).toBe(4);
  });

  it('exponentially scales difficulty against low-reputation bots during spam congestion', () => {
    // Bot with 0.1 reputation attacking at 64 TPS:
    // log2(64) = 6. 6 / 0.1 = 60. Clamped to maxDifficulty (24 bits)
    const diff = calculateDynamicDifficulty(4, 64, 0.1, 24);
    expect(diff).toBe(24);

    // Legitimate high-reputation user during same 64 TPS network load:
    // 4 + (6 / 1.0) = 10 bits (~few milliseconds)
    const legitDiff = calculateDynamicDifficulty(4, 64, 1.0, 24);
    expect(legitDiff).toBe(10);
  });

  it('computes and verifies memory-hard PoW correctly with RAM scratchpad walks', async () => {
    const { computeMemoryHardPoW, verifyMemoryHardPoW } = await import('../src/index.js');
    const payload = new TextEncoder().encode('sovra:event:anti-sybil:test');

    // 4 bits difficulty with 16KiB memory footprint
    const result = computeMemoryHardPoW(payload, 4, 16);
    expect(result.iterations).toBeGreaterThanOrEqual(1);
    expect(result.nonce).toBeDefined();

    // Verify valid solution
    const isValid = verifyMemoryHardPoW(payload, result.nonce, 4, 16);
    expect(isValid).toBe(true);

    // Verify invalid nonce fails
    const isInvalid = verifyMemoryHardPoW(payload, result.nonce + 999n, 4, 16);
    // Almost certainly false unless birthday collision
    expect(isInvalid).toBe(false);
  });

  it('applies Web-of-Trust Sybil immunity discounts for verified passkeys and follow depth', async () => {
    const { calculateWebOfTrustDifficulty } = await import('../src/index.js');

    // Unverified anonymous peer on calm network: base 8 bits
    const anonDiff = calculateWebOfTrustDifficulty(8, 1);
    expect(anonDiff).toBe(8);

    // Verified hardware passkey + 1st degree follower + >90 day account on calm 1 TPS network:
    // Base 8, Congestion = 0. Discounts: -3 - 4 - 2 = -9 bits. max(0, 8 - 9) = 0 bits (instant posting!)
    const calmZeroDiff = calculateWebOfTrustDifficulty(8, 1, {
      isPasskeyVerified: true,
      followGraphDepth: 1,
      accountAgeDays: 120,
    });
    expect(calmZeroDiff).toBe(0);

    // Verified hardware passkey + 1st degree follower + >90 day account on active 16 TPS network:
    // Base 8 + log2(16) [4] = 12.
    // Discounts: Passkey (-3) + Depth 1 (-4) + Age (-2) + High Rep (-2) = -11 bits discount.
    // 12 - 11 = 1 bit (instant post!)
    const trustedDiff = calculateWebOfTrustDifficulty(8, 16, {
      isPasskeyVerified: true,
      followGraphDepth: 1,
      accountAgeDays: 120,
      reputationScore: 0.95,
    });
    expect(trustedDiff).toBe(1);

    // Attacker bot (unverified, 0 follow graph, 0 reputation) on 64 TPS network:
    // Base 8 + log2(64) [6] = 14 bits (no discounts)
    const attackerDiff = calculateWebOfTrustDifficulty(8, 64, {
      isPasskeyVerified: false,
      followGraphDepth: 0,
      accountAgeDays: 0,
      reputationScore: 0.1,
    });
    expect(attackerDiff).toBe(14);
  });
});

