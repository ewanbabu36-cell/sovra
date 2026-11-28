import { describe, it, expect } from 'vitest';
import {
  ColdPeerFallbackEngine,
  BitSwapEngine,
  MemoryBlockstore,
  CID,
  IntegrityVerificationError,
  ContentNotFoundError,
} from '../../packages/storage/src/index.js';

describe('ColdPeerFallbackEngine & DePIN Storage Tiering', () => {
  it('resolves cold blocks and cryptographically verifies CID integrity', async () => {
    const rawData = new TextEncoder().encode('Sovereign decentralized content block 001');
    const cid = CID.create('raw', rawData);
    const cidStr = cid.toString();

    const fallbackEngine = new ColdPeerFallbackEngine({
      customFetcher: async (url: string) => {
        if (url.includes(cidStr)) {
          return rawData;
        }
        return null;
      },
    });

    fallbackEngine.registerGateway({
      name: 'edge-gateway-alpha',
      urlTemplate: 'https://gateway.sovra.net/ipfs/{cid}',
      priority: 1,
      isOnline: true,
      failures: 0,
    });

    const recovered = await fallbackEngine.resolveColdBlock(cidStr);
    expect(recovered).not.toBeNull();
    expect(new TextDecoder().decode(recovered!)).toBe('Sovereign decentralized content block 001');

    const stats = fallbackEngine.getStats();
    expect(stats.totalBytesRecovered).toBe(rawData.length);
    expect(stats.totalFallbacksServed).toBe(1);
  });

  it('rejects tampered blocks with IntegrityVerificationError and penalizes rogue miner', async () => {
    const originalData = new TextEncoder().encode('Legitimate un-tampered data payload');
    const cid = CID.create('raw', originalData);
    const cidStr = cid.toString();

    const tamperedData = new TextEncoder().encode('MALICIOUS_SUBSTITUTE_BLOCK');

    const fallbackEngine = new ColdPeerFallbackEngine({
      customFetcher: async () => tamperedData,
    });

    fallbackEngine.registerMiner({
      peerId: 'peer_malicious_node',
      did: 'did:sovra:attacker123',
      endpoint: 'https://malicious.node/blocks/{cid}',
      reputationScore: 50,
      totalBytesServed: 0,
      rewardBalance_uSOV: 0,
      lastActive: Date.now(),
    });

    await expect(fallbackEngine.resolveColdBlock(cidStr)).rejects.toThrow(IntegrityVerificationError);

    const miner = fallbackEngine.getMiner('peer_malicious_node');
    expect(miner).toBeDefined();
    expect(miner!.reputationScore).toBe(30); // penalized -20 points
    expect(miner!.rewardBalance_uSOV).toBe(0); // 0 rewards awarded
  });

  it('accrues DePIN micro-rewards to honest storage miners on successful recovery', async () => {
    const blockData = new Uint8Array(128 * 1024); // 128 KB
    blockData.fill(42);
    const cid = CID.create('raw', blockData);
    const cidStr = cid.toString();

    const fallbackEngine = new ColdPeerFallbackEngine({
      rewardRate_uSOVPer64KB: 2.5,
      customFetcher: async () => blockData,
    });

    fallbackEngine.registerMiner({
      peerId: 'peer_depin_hero',
      did: 'did:sovra:miner_hero',
      endpoint: 'https://miner.sovra.mesh/get/{cid}',
      reputationScore: 80,
      totalBytesServed: 0,
      rewardBalance_uSOV: 0,
      lastActive: Date.now(),
    });

    const recovered = await fallbackEngine.resolveColdBlock(cidStr);
    expect(recovered).not.toBeNull();
    expect(recovered!.length).toBe(128 * 1024);

    const miner = fallbackEngine.getMiner('peer_depin_hero');
    expect(miner!.totalBytesServed).toBe(128 * 1024);
    expect(miner!.rewardBalance_uSOV).toBe(5.0); // 2 blocks of 64KB * 2.5 uSOV = 5.0 uSOV
    expect(miner!.reputationScore).toBe(81);
  });

  it('enables BitSwapEngine to recover cold blocks transparently when 0 target peers are online', async () => {
    const blockstore = new MemoryBlockstore();
    const bitSwap = new BitSwapEngine(blockstore);

    const content = new TextEncoder().encode('Cold archive stored on DePIN storage layer');
    const cid = CID.create('raw', content);
    const cidStr = cid.toString();

    // Without fallback, 0 peers throws ContentNotFoundError
    await expect(bitSwap.requestBlock(cidStr, [])).rejects.toThrow(ContentNotFoundError);

    // Attach ColdPeerFallbackEngine
    const fallbackEngine = new ColdPeerFallbackEngine({
      customFetcher: async () => content,
    });
    fallbackEngine.registerGateway({
      name: 'archive-gateway',
      urlTemplate: 'https://archive.sovra.net/{cid}',
      priority: 1,
      isOnline: true,
      failures: 0,
    });

    bitSwap.setColdPeerFallback(fallbackEngine);

    // Now requestBlock recovers block seamlessly
    const resolved = await bitSwap.requestBlock(cidStr, []);
    expect(new TextDecoder().decode(resolved)).toBe('Cold archive stored on DePIN storage layer');

    // Block is now stored in local blockstore
    const exists = await blockstore.has(cid);
    expect(exists).toBe(true);
  });

  it('races parallel hedged miners so slow peers do not stall fast recovery and awards speed bonus', async () => {
    const rawData = new TextEncoder().encode('Hedged parallel block delivery payload');
    const cid = CID.create('raw', rawData);
    const cidStr = cid.toString();

    const fallbackEngine = new ColdPeerFallbackEngine({
      rewardRate_uSOVPer64KB: 2.0,
      fastResponseThresholdMs: 200,
      speedBonusMultiplier: 1.5,
      hedgeConcurrency: 3,
      customFetcher: async (url: string) => {
        if (url.includes('slow-miner')) {
          await new Promise(resolve => setTimeout(resolve, 600));
          return null;
        }
        return rawData;
      },
    });

    fallbackEngine.registerMiner({
      peerId: 'peer_slow_1',
      did: 'did:sovra:slow1',
      endpoint: 'http://198.51.100.10:4001/slow-miner/{cid}',
      reputationScore: 90,
      totalBytesServed: 0,
      rewardBalance_uSOV: 0,
      lastActive: Date.now(),
    });
    fallbackEngine.registerMiner({
      peerId: 'peer_slow_2',
      did: 'did:sovra:slow2',
      endpoint: 'http://198.51.100.11:4001/slow-miner/{cid}',
      reputationScore: 85,
      totalBytesServed: 0,
      rewardBalance_uSOV: 0,
      lastActive: Date.now(),
    });
    fallbackEngine.registerMiner({
      peerId: 'peer_fast_direct',
      did: 'did:sovra:fast1',
      endpoint: 'http://127.0.0.1:4001/fast-miner/{cid}',
      reputationScore: 80,
      totalBytesServed: 0,
      rewardBalance_uSOV: 0,
      lastActive: Date.now(),
    });

    const t0 = Date.now();
    const recovered = await fallbackEngine.resolveColdBlock(cidStr);
    const elapsedMs = Date.now() - t0;

    expect(recovered).not.toBeNull();
    expect(elapsedMs).toBeLessThan(350);

    const fastMiner = fallbackEngine.getMiner('peer_fast_direct');
    expect(fastMiner).toBeDefined();
    expect(fastMiner!.latencyMs).toBeDefined();
    expect(fastMiner!.rewardBalance_uSOV).toBe(3.0); // 1 * 2.0 * 1.5 speed bonus
    expect(fallbackEngine.rankMinersBySpeed()[0]!.peerId).toBe('peer_fast_direct');
  });
});
