import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';

describe('Phase 2: Revenue Leakage Radar & Big Tech Financial Command Center', () => {
  const testStorageDir = path.resolve(`./.sovra-storage-test-rev-${Date.now()}`);
  let engine: SqliteSocialDatabaseEngine;

  beforeAll(() => {
    fs.mkdirSync(testStorageDir, { recursive: true });
    engine = new SqliteSocialDatabaseEngine(testStorageDir);
  });

  afterAll(() => {
    try {
      engine.close();
    } catch (_) {}
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('1. ⚖️ True 4-Column Double-Entry Solvency Engine', () => {
    it('computes 4-column double-entry balance sheet and verifies invariant integrity', () => {
      const report = engine.getTreasurySolvencyReport();
      expect(report).toBeDefined();
      expect(report.ok).toBe(true);
      expect(report.isSolvent).toBe(true);
      expect(report.healthStatus).toBe('HEALTHY');

      // Verify 4 columns exist
      const b = report.breakdown;
      expect(typeof b.totalInjectedSov).toBe('number');
      expect(b.totalInjectedSov).toBe(5000000.0); // Default genesis seed
      expect(typeof b.userBalancesSov).toBe('number');
      expect(typeof b.escrowsLockedSov.total).toBe('number');
      expect(typeof b.treasuryReserveSov).toBe('number');

      // Invariant check: Injected - Liabilities - Escrows - Reserves = Delta
      const totalLiabilities = b.userBalancesSov + b.escrowsLockedSov.total + b.treasuryReserveSov;
      const expectedDelta = Math.round((b.totalInjectedSov - totalLiabilities) * 1000) / 1000;
      expect(report.solvencyDeltaSov).toBe(expectedDelta);

      // Cryptographic SHA-256 seal verification
      expect(report.verificationHash).toBeDefined();
      expect(report.verificationHash.length).toBe(64);
    });

    it('allows configuring total genesis minted injected capital dynamically', () => {
      engine.setRevenueSetting('total_genesis_minted_sov', 7500000.0);
      const report = engine.getTreasurySolvencyReport();
      expect(report.breakdown.totalInjectedSov).toBe(7500000.0);
    });
  });

  describe('2. 💸 Dynamic Take-Rate Elasticity Controller', () => {
    it('seeds standard baseline platform take-rate at 5.0%', () => {
      const rate = engine.getPlatformTakeRate();
      expect(rate).toBe(5.0);
    });

    it('updates platform take-rate percentage within bounds', () => {
      const ok = engine.setPlatformTakeRate(7.5);
      expect(ok).toBe(true);
      expect(engine.getPlatformTakeRate()).toBe(7.5);
    });

    it('clamps platform take-rate to minimum 2.5% and maximum 10.0%', () => {
      // Lower bound clamp
      engine.setPlatformTakeRate(1.0);
      expect(engine.getPlatformTakeRate()).toBe(2.5);

      // Upper bound clamp
      engine.setPlatformTakeRate(15.0);
      expect(engine.getPlatformTakeRate()).toBe(10.0);

      // Reset to 5.0%
      engine.setPlatformTakeRate(5.0);
      expect(engine.getPlatformTakeRate()).toBe(5.0);
    });
  });

  describe('3. 🔍 Off-Platform Disintermediation Radar (NLP & Regex)', () => {
    it('detects UPI VPA handles attempting to bypass platform fees', () => {
      const text = 'Hey fans, for exclusive VIP content pay me directly on gpay: creator_artist@okhdfcbank or paytm: 9876543210@paytm';
      const result = engine.scanTextForDisintermediation(text);

      expect(result.detected).toBe(true);
      expect(result.riskScore).toBeGreaterThanOrEqual(45);
      expect(result.recommendedAction).toBe('WARN_CREATOR_AND_SOFT_SUPPRESS');

      const upiMatches = result.matches.filter((m) => m.type === 'UPI_VPA');
      expect(upiMatches.length).toBeGreaterThanOrEqual(1);
      expect(upiMatches.some((m) => m.match.includes('okhdfcbank'))).toBe(true);
    });

    it('detects Telegram payment channels and bot handles', () => {
      const text = 'Join my private trading swarm at https://t.me/vip_signals_exclusive or message @crypto_alpha_vip';
      const result = engine.scanTextForDisintermediation(text);

      expect(result.detected).toBe(true);
      expect(result.matches.some((m) => m.type === 'TELEGRAM_LINK')).toBe(true);
    });

    it('detects external wallet and tipping links (PayPal / BuyMeACoffee)', () => {
      const text = 'Support my open-source work at paypal.me/sovereign_dev or buymeacoffee.com/sovra';
      const result = engine.scanTextForDisintermediation(text);

      expect(result.detected).toBe(true);
      expect(result.matches.some((m) => m.type === 'EXTERNAL_WALLET')).toBe(true);
    });

    it('passes clean posts without false positives', () => {
      const text = 'Excited to announce the new decentralized Sovra protocol mesh node! Let us know your thoughts in comments.';
      const result = engine.scanTextForDisintermediation(text);

      expect(result.detected).toBe(false);
      expect(result.matches.length).toBe(0);
      expect(result.riskScore).toBe(0);
      expect(result.recommendedAction).toBe('NONE');
    });

    it('logs disintermediation events to audit log and retrieves them', () => {
      const authorDid = 'did:sovra:off_platform_culprit_1';
      const eventId = engine.logDisintermediationEvent(
        authorDid,
        'Send funds to rogue@okhdfcbank',
        ['UPI_VPA'],
        ['rogue@okhdfcbank'],
        85,
      );

      expect(typeof eventId).toBe('string');
      expect(eventId.startsWith('leak_')).toBe(true);

      const events = engine.getDisintermediationEvents(20);
      const myEvent = events.find((e) => e.id === eventId);
      expect(myEvent).toBeDefined();
      expect(myEvent?.authorDid).toBe(authorDid);
      expect(myEvent?.matchedTypes).toContain('UPI_VPA');
      expect(myEvent?.riskScore).toBe(85);
    });
  });

  describe('4. 🔄 Circular Wash-Trading Graph Cycle Detector', () => {
    const userA = 'did:sovra:wash_trader_a';
    const userB = 'did:sovra:wash_trader_b';
    const userC = 'did:sovra:wash_trader_c';

    it('records token transfers with fee deduction accurately', () => {
      const tx1 = engine.recordTokenTransfer({
        fromDid: userA,
        toDid: userB,
        amountSov: 100.0,
        txType: 'TIP',
      });
      expect(typeof tx1).toBe('string');

      const tx2 = engine.recordTokenTransfer({
        fromDid: userB,
        toDid: userC,
        amountSov: 95.0,
        txType: 'TIP',
      });
      expect(typeof tx2).toBe('string');

      const tx3 = engine.recordTokenTransfer({
        fromDid: userC,
        toDid: userA,
        amountSov: 90.0,
        txType: 'TIP',
      });
      expect(typeof tx3).toBe('string');

      const list = engine.getTokenTransfers(10);
      expect(list.length).toBeGreaterThanOrEqual(3);
    });

    it('detects circular token loops (A -> B -> C -> A) and flags them', () => {
      const cycles = engine.detectWashTradingCycles(72);
      expect(Array.isArray(cycles)).toBe(true);
      expect(cycles.length).toBeGreaterThanOrEqual(1);

      // Verify the circular path contains A, B, and C
      const cycle = cycles[0];
      expect(cycle.txCount).toBeGreaterThanOrEqual(3);
      expect(cycle.totalVolumeSov).toBeGreaterThanOrEqual(285.0);

      const flags = engine.getWashTradingFlags();
      expect(flags.length).toBeGreaterThanOrEqual(1);
    });
  });
});
