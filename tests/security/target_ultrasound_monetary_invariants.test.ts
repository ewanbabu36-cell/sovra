import { describe, it, expect, afterEach } from 'vitest';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';
import fs from 'node:fs';
import path from 'node:path';

describe('SOVRA Phase 3: Ultra-Sound Monetary Engine & Consensus Hard Cap Invariants', () => {
  const activeEngines: SqliteSocialDatabaseEngine[] = [];
  const testDirs: string[] = [];

  function createTestEngine(): SqliteSocialDatabaseEngine {
    const dir = path.resolve('D:/Sovra/.sovra-storage-dev-test-' + Math.random().toString(36).slice(2));
    testDirs.push(dir);
    const engine = new SqliteSocialDatabaseEngine(dir);
    activeEngines.push(engine);
    return engine;
  }

  afterEach(() => {
    while (activeEngines.length > 0) {
      const e = activeEngines.pop();
      try { e?.close(); } catch (_) {}
    }
    while (testDirs.length > 0) {
      const d = testDirs.pop();
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('enforces 100M SOV absolute hard cap constant and supply constraints', () => {
    const sqlite = createTestEngine();
    expect(SqliteSocialDatabaseEngine.MAX_LIFETIME_SOV_CAP).toBe(100_000_000);
    expect(SqliteSocialDatabaseEngine.GENESIS_INITIAL_SUPPLY_SOV).toBe(30_000_000);
    expect(SqliteSocialDatabaseEngine.CONSENSUS_BURN_SINK_DID).toBe('did:sov:burn:dead');
    expect(SqliteSocialDatabaseEngine.CONSENSUS_BURN_SINK_ADDRESS).toBe('sovra10000000000000000000000000000000000000dead');

    const metrics = sqlite.getUltraSoundMetrics();
    expect(metrics.maxLifetimeCapSov).toBe(100_000_000);
    expect(metrics.genesisSupplySov).toBe(30_000_000);
    expect(metrics.gasFeeBurnPercent).toBe(50);
    expect(metrics.adBurnPercent).toBe(20);
    expect(metrics.invariantHolds).toBe(true);
  });

  it('routes 50% of network gas fees permanently to Consensus Burn Sink on transactions', () => {
    const sqlite = createTestEngine();
    const now = Date.now();
    sqlite.db.prepare(`
      INSERT INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, device_type, created_at, updated_at)
      VALUES ('did:sovra:alice_test', '@alice', 'Alice', '👩', '#6366f1', 1000.0, 'BROWSER', ?, ?)
    `).run(now, now);

    sqlite.db.prepare(`
      INSERT INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, device_type, created_at, updated_at)
      VALUES ('did:sovra:bob_test', '@bob', 'Bob', '👨', '#10b981', 100.0, 'BROWSER', ?, ?)
    `).run(now, now);

    const initialBurned = sqlite.getCumulativeBurnedSov();

    // Alice transfers 100 SOV to Bob with 10.0 SOV fee
    const result = sqlite.executeAtomicLedgerTransfer({
      fromDid: 'did:sovra:alice_test',
      toDid: 'did:sovra:bob_test',
      amountSov: 100.0,
      feeSov: 10.0,
      txType: 'P2P_TRANSFER',
      memo: 'Test fee burn',
    });

    expect(result.ok).toBe(true);

    const newBurned = sqlite.getCumulativeBurnedSov();
    const burnedDelta = newBurned - initialBurned;

    // 50% of 10.0 SOV fee must be burned = 5.0 SOV
    expect(burnedDelta).toBeCloseTo(5.0, 5);

    const metrics = sqlite.getUltraSoundMetrics();
    expect(metrics.isDeflationary).toBe(true);
    expect(metrics.totalBurnedSov).toBeGreaterThanOrEqual(5.0);
    expect(metrics.invariantHolds).toBe(true);
  });

  it('routes 20% of ad-spend settlements permanently to Consensus Burn Sink', () => {
    const sqlite = createTestEngine();
    const now = Date.now();
    sqlite.db.prepare(`
      INSERT INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, device_type, created_at, updated_at)
      VALUES ('did:sovra:advertiser_nike', '@nike', 'Nike Ad', '📢', '#f59e0b', 5000.0, 'ENTERPRISE', ?, ?)
    `).run(now, now);

    sqlite.db.prepare(`
      INSERT INTO users (did, handle, display_name, avatar, avatar_bg, balance_sov, device_type, created_at, updated_at)
      VALUES ('did:sovra:publisher_creator', '@creator_media', 'Creator Media', '🎨', '#10b981', 0.0, 'BROWSER', ?, ?)
    `).run(now, now);

    const initialBurned = sqlite.getCumulativeBurnedSov();

    // Settle 1000 SOV ad spend
    const settlement = sqlite.processAdSpendSettlement({
      advertiserDid: 'did:sovra:advertiser_nike',
      publisherDid: 'did:sovra:publisher_creator',
      totalSpendSov: 1000.0,
      campaignId: 'camp_superbowl_2026',
    });

    expect(settlement.ok).toBe(true);
    expect(settlement.totalSpendSov).toBe(1000.0);
    expect(settlement.burnedSov).toBe(200.0); // 20% of 1000 = 200 SOV
    expect(settlement.publisherNetSov).toBe(800.0); // 80% of 1000 = 800 SOV

    // Verify publisher received 800 SOV
    const pub = sqlite.findUserByDid('did:sovra:publisher_creator');
    expect(pub?.balanceSov).toBeCloseTo(800.0, 2);

    // Verify advertiser debited 1000 SOV
    const adv = sqlite.findUserByDid('did:sovra:advertiser_nike');
    expect(adv?.balanceSov).toBeCloseTo(4000.0, 2);

    // Verify burn sink received 200 SOV
    const newBurned = sqlite.getCumulativeBurnedSov();
    expect(newBurned - initialBurned).toBeCloseTo(200.0, 2);
  });

  it('guarantees that Consensus Burn Sink is immutable and cannot be debited or transferred', () => {
    const sqlite = createTestEngine();
    // Attempting to transfer OUT of Consensus Burn Sink must strictly throw
    expect(() => {
      sqlite.executeAtomicLedgerTransfer({
        fromDid: SqliteSocialDatabaseEngine.CONSENSUS_BURN_SINK_DID,
        toDid: 'did:sovra:hacker_attempt',
        amountSov: 50.0,
        feeSov: 0.1,
      });
    }).toThrow(/Consensus Burn Sink is immutable/i);

    expect(() => {
      sqlite.executeAtomicLedgerTransfer({
        fromDid: SqliteSocialDatabaseEngine.CONSENSUS_BURN_SINK_ADDRESS,
        toDid: 'did:sovra:hacker_attempt',
        amountSov: 50.0,
        feeSov: 0.1,
      });
    }).toThrow(/Consensus Burn Sink is immutable/i);

    // Attempting idempotent transfer from burn sink must also fail closed
    const tipRes = sqlite.executeAtomicIdempotentTransfer({
      fromDid: SqliteSocialDatabaseEngine.CONSENSUS_BURN_SINK_DID,
      toDid: 'did:sovra:hacker_attempt',
      amountSov: 10.0,
      idempotencyKey: 'idem_burn_heist',
    });
    expect(tipRes.status).toBe('CONFLICT');
    expect(tipRes.statusCode).toBe(400);
    expect(tipRes.error).toMatch(/Consensus Burn Sink is immutable/i);
  });

  it('verifies supply invariant: circulating supply + burned supply strictly equals initial invariant', () => {
    const sqlite = createTestEngine();
    const metrics = sqlite.getUltraSoundMetrics();
    expect(metrics.invariantHolds).toBe(true);
    expect(metrics.circulatingSupplySov + metrics.totalBurnedSov).toBeLessThanOrEqual(SqliteSocialDatabaseEngine.MAX_LIFETIME_SOV_CAP);
  });
});
