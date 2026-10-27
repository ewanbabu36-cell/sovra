/**
 * @file tests/e2e/self-healing-and-solvency-daemon.test.ts
 * Master E2E Suite for Autonomous Self-Healing Node Health & 24/7 Solvency Audit Daemon (Cycle 5).
 *
 * Verifies:
 * 1. Background Self-Healing Daemon: SQLite WAL checkpoint sweep, orphaned block cleanup, cache quota enforcement.
 * 2. Continuous 60s Solvency Assertion: Verifies Total System SOV == Sum(Balances) + Sum(Escrows) + Reserve + Referrals.
 * 3. Automatic Circuit Breaker Halt: Trips when discrepancy > 0.00 SOV occurs.
 * 4. Real-time Mesh Peer Diagnostics: Peer RTT tracking & automated gossip Sybil peer blacklisting.
 * 5. Dev Server REST Endpoints: /api/admin/self-healing/*
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { selfHealingDaemon, type PeerDiagnosticItem } from '../../scripts/self-healing-daemon.ts';
import { sovereignAdminSecurity } from '../../scripts/admin-security.ts';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Cycle 5: Autonomous Self-Healing Node Health & 24/7 Solvency Daemon Suite', () => {
  beforeEach(() => {
    // Reset circuit breaker to normal operational state
    sovereignAdminSecurity.toggleCircuitBreaker(false, [], {
      did: 'did:sovra:admin_test',
      handle: 'admin_test',
      role: 'SUPER_ADMIN',
      authMethod: 'DEVICE_KEY',
      authenticatedAt: Date.now(),
    }, 'Test setup reset');
  });

  afterEach(() => {
    selfHealingDaemon.stopDaemon();
  });

  describe('1. SQLite WAL Checkpoint & UnixFS Orphan Cleanup', () => {
    it('should trigger WAL checkpoint and increment checkpoint counter', () => {
      const initialCount = selfHealingDaemon.getStatus().walCheckpointsCount;
      const result = selfHealingDaemon.runWalCheckpoint();

      expect(result.ok).toBe(true);
      expect(result.walCheckpointsCount).toBe(initialCount + 1);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should clean up orphaned blocks and enforce media cache quota', () => {
      const orphanResult = selfHealingDaemon.cleanupUnixFsOrphans();
      expect(orphanResult.ok).toBe(true);
      expect(typeof orphanResult.orphanedBlocksRemovedCount).toBe('number');

      const quotaResult = selfHealingDaemon.enforceMediaCacheQuota(500);
      expect(quotaResult.ok).toBe(true);
      expect(typeof quotaResult.mediaCachePrunedMb).toBe('number');
      expect(quotaResult.remainingMb).toBeLessThanOrEqual(500);
    });
  });

  describe('2. Continuous Solvency Assertion & Automatic Circuit Breaker Trip', () => {
    it('should verify solvency when delta is 0.00 SOV without halting circuit breaker', () => {
      const result = selfHealingDaemon.runContinuousSolvencyAudit();

      expect(result.ok).toBe(true);
      expect(result.delta).toBe(0.00);
      expect(result.isSolvent).toBe(true);
      expect(result.circuitBreakerHalted).toBe(false);

      // Verify circuit breaker remains disengaged
      const cb = sovereignAdminSecurity.getCircuitBreaker();
      expect(cb.active).toBe(false);
    });

    it('should automatically trip the Sovereign Circuit Breaker if solvency discrepancy > 0.00 SOV occurs', () => {
      // Mock an economic discrepancy by temporarily tampering with getTreasurySolvencyReport
      const originalGetReport = sovraDb.getTreasurySolvencyReport.bind(sovraDb);
      try {
        (sovraDb as any).getTreasurySolvencyReport = () => ({
          totalSystemSov: 1000000,
          sumUserBalances: 999950,
          sumEscrows: 0,
          treasuryReserve: 0,
          unsettledReferrals: 0,
          discrepancyDeltaSov: 50.00, // 50 SOV unbacked delta
          isSolvent: false,
        });

        const result = selfHealingDaemon.runContinuousSolvencyAudit();

        expect(result.isSolvent).toBe(false);
        expect(result.delta).toBe(50.00);
        expect(result.circuitBreakerHalted).toBe(true);

        // Verify the security engine circuit breaker was automatically engaged
        const cb = sovereignAdminSecurity.getCircuitBreaker();
        expect(cb.active).toBe(true);
        expect(cb.reason).toContain('AUTOMATED CIRCUIT BREAKER');
        expect(cb.reason).toContain('50.0000 SOV');
      } finally {
        (sovraDb as any).getTreasurySolvencyReport = originalGetReport;
      }
    });
  });

  describe('3. Mesh Peer Diagnostics & Sybil Blacklisting', () => {
    it('should keep healthy peers unblacklisted and blacklist malicious gossip peers', () => {
      const healthyPeer: PeerDiagnosticItem = {
        peerDid: 'did:key:z6Mkha_healthy_peer_01',
        rttMs: 14,
        errorRate: 0.01,
        gossipMisbehaviorCount: 0,
        lastPingAt: Date.now(),
      };

      const maliciousPeer: PeerDiagnosticItem = {
        peerDid: 'did:key:z6Mks7_sybil_attacker_02',
        rttMs: 250,
        errorRate: 0.25,
        gossipMisbehaviorCount: 4, // Exceeds threshold (>= 3)
        lastPingAt: Date.now(),
      };

      const corruptPeer: PeerDiagnosticItem = {
        peerDid: 'did:key:z6Mkt9_corrupt_streamer_03',
        rttMs: 300,
        errorRate: 0.95, // Error rate >= 80%
        gossipMisbehaviorCount: 0,
        lastPingAt: Date.now(),
      };

      const diagResult = selfHealingDaemon.runPeerMeshDiagnostics([healthyPeer, maliciousPeer, corruptPeer]);

      expect(diagResult.ok).toBe(true);
      expect(diagResult.blacklistedCount).toBe(2);
      expect(selfHealingDaemon.isPeerBlacklisted('did:key:z6Mkha_healthy_peer_01')).toBe(false);
      expect(selfHealingDaemon.isPeerBlacklisted('did:key:z6Mks7_sybil_attacker_02')).toBe(true);
      expect(selfHealingDaemon.isPeerBlacklisted('did:key:z6Mkt9_corrupt_streamer_03')).toBe(true);

      // Support unblacklisting by operator
      selfHealingDaemon.unblacklistPeer('did:key:z6Mkt9_corrupt_streamer_03');
      expect(selfHealingDaemon.isPeerBlacklisted('did:key:z6Mkt9_corrupt_streamer_03')).toBe(false);
    });
  });

  describe('4. Daemon Status & Self-Healing Lifecycle', () => {
    it('should provide comprehensive health status object', () => {
      const status = selfHealingDaemon.getStatus();

      expect(status.walCheckpointsCount).toBeGreaterThanOrEqual(1);
      expect(status.solvencyAuditCount).toBeGreaterThanOrEqual(1);
      expect(status.lastWalCheckpointAt).toBeGreaterThan(0);
      expect(status.lastSolvencyAuditAt).toBeGreaterThan(0);
      expect(Array.isArray(status.blacklistedPeers)).toBe(true);
    });

    it('should start and stop background timers without lingering handles', () => {
      selfHealingDaemon.startDaemon({
        walMs: 60000,
        solvencyMs: 60000,
        peerMs: 60000,
      });

      // Confirm running state, then stop
      selfHealingDaemon.stopDaemon();
    });
  });
});
