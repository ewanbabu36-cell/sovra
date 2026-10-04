import { describe, it, expect } from 'vitest';
import {
  AdaptiveBitrateEngine,
  EdgePreWarmCache,
} from '../src/index.js';

describe('Pillar 4: Dynamic Adaptive Bitrate (ABR) & Edge Pre-Warm Pool', () => {
  it('selects optimal video resolution based on measured live download bandwidth', () => {
    // 1MB downloaded in 1 second = 8 Mbps * 0.75 = 6 Mbps -> 1080p
    const bw1080 = AdaptiveBitrateEngine.calculateMeasuredBandwidthBps(1024 * 1024, 1000);
    expect(AdaptiveBitrateEngine.selectBestResolution(bw1080)).toBe('1080p');

    // 250KB downloaded in 1 second = 2 Mbps * 0.75 = 1.5 Mbps -> 480p
    const bw480 = AdaptiveBitrateEngine.calculateMeasuredBandwidthBps(256 * 1024, 1000);
    expect(AdaptiveBitrateEngine.selectBestResolution(bw480)).toBe('480p');

    // Slow connection (100KB in 2 seconds) -> downshifts to 360p to prevent freezing
    const bw360 = AdaptiveBitrateEngine.calculateMeasuredBandwidthBps(100 * 1024, 2000);
    expect(AdaptiveBitrateEngine.selectBestResolution(bw360)).toBe('360p');
  });

  it('pre-warms Segment 0 in RAM cache delivering sub-100ms first-frame playback', () => {
    const cache = new EdgePreWarmCache(10);
    const manifestCid = 'bafybeimaster123';
    const segment0Data = new Uint8Array([0, 1, 2, 3, 4, 5]);

    cache.preWarm(manifestCid, segment0Data);
    expect(cache.has(manifestCid)).toBe(true);

    const retrieved = cache.getSegment0(manifestCid);
    expect(retrieved).toBeDefined();
    expect(retrieved?.[0]).toBe(0);
    expect(cache.size()).toBe(1);
  });

  it('dynamically adapts playback stream resolution based on real-time buffer health', async () => {
    const { DynamicBufferHealthController } = await import('../src/index.js');

    // Buffer < 2.0s triggers critical freeze safeguard
    const crit = DynamicBufferHealthController.evaluateBuffer(1.4, '720p');
    expect(crit.recommendedResolution).toBe('360p');
    expect(crit.shouldFallbackToEdgeSeeder).toBe(true);
    expect(crit.reason).toContain('Critical buffer freeze risk');

    // Buffer > 8.0s triggers upgrade to 1080p pure swarm
    const healthy = DynamicBufferHealthController.evaluateBuffer(9.5, '720p');
    expect(healthy.recommendedResolution).toBe('1080p');
    expect(healthy.shouldFallbackToEdgeSeeder).toBe(false);

    // Buffer in comfortable range (5.0s) stays at current resolution
    const stable = DynamicBufferHealthController.evaluateBuffer(5.0, '720p');
    expect(stable.recommendedResolution).toBe('720p');
    expect(stable.shouldFallbackToEdgeSeeder).toBe(false);
  });

  it('speculatively targets Segment 0 for upcoming posts in user feed', async () => {
    const { SpeculativePreWarmCache } = await import('../src/index.js');
    const feed = [
      { index: 4, segment0Cid: 'cid-seg0-post4' },
      { index: 5, segment0Cid: 'cid-seg0-post5' },
      { index: 6, segment0Cid: 'cid-seg0-post6' },
      { index: 7, segment0Cid: 'cid-seg0-post7' },
      { index: 8, segment0Cid: 'cid-seg0-post8' },
    ];

    // User is looking at post 5: speculatively targets upcoming posts 6 and 7
    const targets = SpeculativePreWarmCache.getTargetSegment0PrefetchCids(5, feed, 2);
    expect(targets).toEqual(['cid-seg0-post6', 'cid-seg0-post7']);
  });

  it('routes video playback through Hybrid Swarm-Mesh Video Pipeline', async () => {
    const { HybridSwarmVideoPipeline } = await import('../src/index.js');

    // First 1-second segment (Segment 0): Direct high-availability edge relay pull (sub-80ms)
    const seg0Plan = HybridSwarmVideoPipeline.resolveSegmentRoute(0);
    expect(seg0Plan.isSegment0).toBe(true);
    expect(seg0Plan.transport).toBe('edge_direct_pull');
    expect(seg0Plan.targetLatencyMs).toBeLessThanOrEqual(80);

    // Subsequent segments (1, 2, 3...): Assembled over background P2P BitSwap swarm
    const seg1Plan = HybridSwarmVideoPipeline.resolveSegmentRoute(1);
    expect(seg1Plan.isSegment0).toBe(false);
    expect(seg1Plan.transport).toBe('p2p_swarm_bitswap');

    const seg2Plan = HybridSwarmVideoPipeline.resolveSegmentRoute(2);
    expect(seg2Plan.transport).toBe('p2p_swarm_bitswap');
  });

  it('allocates grace period bootstrap credits for new unprimed consumers in BitSwap', async () => {
    const { DynamicCreditBootstrap } = await import('../src/index.js');

    // New node (0ms age) receives full grace credit (exact 2MB = 2,097,152 bytes)
    const freshCredit = DynamicCreditBootstrap.calculateGraceCreditBytes(0);
    expect(freshCredit).toBe(2 * 1024 * 1024);

    // Node after 5 minutes (300,000ms) has decayed grace credit (exact 1MB = 1,048,576 bytes)
    const midCredit = DynamicCreditBootstrap.calculateGraceCreditBytes(300000);
    expect(midCredit).toBe(1 * 1024 * 1024);

    // Node after 10 minutes (600,000ms) grace window expires (0 bytes)
    const expiredCredit = DynamicCreditBootstrap.calculateGraceCreditBytes(600000);
    expect(expiredCredit).toBe(0);

    // Older peer (>10 min) receives 0 grace credit
    expect(DynamicCreditBootstrap.calculateGraceCreditBytes(700000)).toBe(0);
  });
});

