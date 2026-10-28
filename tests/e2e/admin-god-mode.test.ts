import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';

describe('Phase 3: God-Mode Omnipresent Panopticon & Nuclear Blast-Radius Matrix', () => {
  const testStorageDir = path.resolve(`./.sovra-storage-test-god-${Date.now()}`);
  let engine: SqliteSocialDatabaseEngine;

  const testUserDid = 'did:sovra:god_test_user_1';
  let testSessionId = '';

  beforeAll(() => {
    fs.mkdirSync(testStorageDir, { recursive: true });
    engine = new SqliteSocialDatabaseEngine(testStorageDir);

    // Register a test user and active session
    engine.registerUser({
      did: testUserDid,
      handle: '@god_subject_alpha',
      displayName: 'God Subject Alpha',
      name: 'God Subject Alpha',
      avatar: 'S',
      avatarBg: '#6366f1',
      bio: 'Test user for Panopticon spy testing',
      website: '',
      websiteUrl: '',
      deviceType: 'Desktop',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const sess = engine.createSession({
      userDid: testUserDid,
      token: 'token_alpha_secret_999',
      deviceName: 'MacBook Pro M3 Max',
      deviceType: 'Desktop',
      ipAddress: '203.0.113.42',
      userAgent: 'Mozilla/5.0 SovraMeshClient/2.4',
    });
    testSessionId = sess.sessionId;
  });

  afterAll(() => {
    try {
      engine.close();
    } catch (_) {}
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('1. 👁️ The Panopticon: Live Swarm Session Spy & Termination', () => {
    it('retrieves all connected user sessions with complete device & IP telemetry', () => {
      const sessions = engine.getPanopticonSessions(50);
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeGreaterThanOrEqual(1);

      const target = sessions.find((s) => s.sessionId === testSessionId);
      expect(target).toBeDefined();
      expect(target?.userDid).toBe(testUserDid);
      expect(target?.handle).toBe('@god_subject_alpha');
      expect(target?.deviceName).toBe('MacBook Pro M3 Max');
      expect(target?.ipAddress).toBe('203.0.113.42');
      expect(target?.isRevoked).toBe(false);
    });

    it('terminates and revokes any user session instantly', () => {
      const ok = engine.terminateUserSession(testSessionId);
      expect(ok).toBe(true);

      const sessions = engine.getPanopticonSessions(50);
      const target = sessions.find((s) => s.sessionId === testSessionId);
      expect(target).toBeDefined();
      expect(target?.isRevoked).toBe(true);
    });
  });

  describe('2. 🛑 The Nuclear Kill-Switch Matrix (Blast-Radius Isolation)', () => {
    it('seeds all 8 nuclear hardware kill-switches in armed standby', () => {
      const switches = engine.getKillSwitches();
      expect(switches.length).toBeGreaterThanOrEqual(8);

      const withdrawals = switches.find((s) => s.switchId === 'GLOBAL_WITHDRAWALS_FROZEN');
      expect(withdrawals).toBeDefined();
      expect(withdrawals?.isActive).toBe(false);

      const lockdown = switches.find((s) => s.switchId === 'GLOBAL_LOCKDOWN_MODE');
      expect(lockdown).toBeDefined();
      expect(lockdown?.isActive).toBe(false);
    });

    it('engages and verifies a nuclear kill-switch in sub-millisecond time', () => {
      expect(engine.isKillSwitchActive('GLOBAL_WITHDRAWALS_FROZEN')).toBe(false);

      // Engage Freeze
      const ok = engine.setKillSwitch('GLOBAL_WITHDRAWALS_FROZEN', true, 'CHIEF-SECURITY-OFFICER');
      expect(ok).toBe(true);
      expect(engine.isKillSwitchActive('GLOBAL_WITHDRAWALS_FROZEN')).toBe(true);

      const switches = engine.getKillSwitches();
      const sw = switches.find((s) => s.switchId === 'GLOBAL_WITHDRAWALS_FROZEN');
      expect(sw?.isActive).toBe(true);
      expect(sw?.triggeredBy).toBe('CHIEF-SECURITY-OFFICER');

      // Lift Freeze
      engine.setKillSwitch('GLOBAL_WITHDRAWALS_FROZEN', false, 'CHIEF-SECURITY-OFFICER');
      expect(engine.isKillSwitchActive('GLOBAL_WITHDRAWALS_FROZEN')).toBe(false);
    });
  });

  describe('3. 🍯 Honeypot Canary Traps (Zero-Day Crawler Neutralization)', () => {
    it('catches unauthorized intrusion attempts and logs forensic evidence', () => {
      const result = engine.recordHoneypotIntrusion(
        '/api/internal/debug-keys',
        '198.51.100.77',
        'SqlMap-PenTest-Crawler/1.0',
        JSON.stringify({ host: 'localhost:3001' }),
        '{"exploit": "attempt_sql_injection"}',
      );

      expect(result).toBeDefined();
      expect(result.intrusionId.startsWith('trap_')).toBe(true);
      expect(result.actionTaken).toBe('ZERO_REACH_SHADOWBAN_APPLIED');

      const intrusions = engine.getHoneypotIntrusions(10);
      const caught = intrusions.find((i) => i.id === result.intrusionId);
      expect(caught).toBeDefined();
      expect(caught?.trapPath).toBe('/api/internal/debug-keys');
      expect(caught?.sourceIp).toBe('198.51.100.77');
    });

    it('automatically applies zero-reach shadowban to the intruder', () => {
      const intruderDid = 'did:ip:198_51_100_77';
      const shadow = engine.isShadowbanned(intruderDid);
      expect(shadow.shadowbanned).toBe(true);
      expect(shadow.decayFactor).toBe(0.0);
    });
  });

  describe('4. 👻 Ghost Mode: Zero-Knowledge Audited Impersonation', () => {
    it('creates an ephemeral read-only ghost session for any target DID', () => {
      const ghost = engine.createGhostSession(testUserDid, 'SUPER-ADMIN-DESK', '127.0.0.1');
      expect(ghost).toBeDefined();
      expect(ghost?.ghostToken.startsWith('ghost_sec_')).toBe(true);
      expect(ghost?.targetDid).toBe(testUserDid);
      expect(ghost?.targetHandle).toBe('@god_subject_alpha');
      expect(ghost?.expiresAt).toBeGreaterThan(Date.now());

      // Validate session
      const validation = engine.validateGhostSession(ghost!.ghostToken);
      expect(validation.valid).toBe(true);
      expect(validation.targetDid).toBe(testUserDid);
    });

    it('rejects invalid or forged ghost tokens', () => {
      const fake = engine.validateGhostSession('ghost_sec_forged_fake_token_123');
      expect(fake.valid).toBe(false);
    });
  });

  describe('5. 🤖 24/7 Autonomous AI Sentinel Threat Evaluator', () => {
    it('runs continuous heuristic health audit and scores swarm threat level', () => {
      const audit = engine.runSentinelHealthAudit();
      expect(audit).toBeDefined();
      expect(['GREEN', 'ELEVATED', 'HIGH', 'CRITICAL']).toContain(audit.threatLevel);
      expect(typeof audit.score).toBe('number');
      expect(typeof audit.heuristics.activeSessions).toBe('number');
      expect(typeof audit.heuristics.sybilSpikeRate1h).toBe('number');
      expect(typeof audit.heuristics.honeypotTriggers24h).toBe('number');
      expect(audit.recommendedPosture).toBeDefined();
    });
  });
});
