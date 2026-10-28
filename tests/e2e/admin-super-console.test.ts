import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';

describe('Phase 1: Big Tech Operations Super-Console & The God Dial', () => {
  const testStorageDir = path.resolve(`./.sovra-storage-test-admin-${Date.now()}`);
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

  describe('1. 🎛️ The God Dial: Algorithmic Virality Multipliers', () => {
    it('seeds default algorithmic category dials with accurate base multipliers', () => {
      const dials = engine.getAlgoDials();
      expect(Array.isArray(dials)).toBe(true);
      expect(dials.length).toBeGreaterThanOrEqual(6);

      const newsDial = dials.find((d) => d.key === 'breaking_news');
      expect(newsDial).toBeDefined();
      expect(newsDial?.multiplier).toBe(2.0);

      const unverified = dials.find((d) => d.key === 'unverified_links');
      expect(unverified).toBeDefined();
      expect(unverified?.multiplier).toBe(0.3);
    });

    it('allows updating an existing dial multiplier atomically', () => {
      engine.setAlgoDial('breaking_news', 3.2, 'Breaking News & Live Swarms', 'Live event velocity boost');
      const dials = engine.getAlgoDials();
      const newsDial = dials.find((d) => d.key === 'breaking_news');
      expect(newsDial).toBeDefined();
      expect(newsDial?.multiplier).toBe(3.2);
    });

    it('creates new custom algorithmic dials dynamically', () => {
      engine.setAlgoDial('sovereign_identity', 3.5, 'Ecosystem', 'Content promoting decentralization');
      const dials = engine.getAlgoDials();
      const sovDial = dials.find((d) => d.key === 'sovereign_identity');
      expect(sovDial).toBeDefined();
      expect(sovDial?.multiplier).toBe(3.5);
      expect(sovDial?.category).toBe('Ecosystem');
    });
  });

  describe('2. 👁️ Silent Visibility Filtering & Shadowbanning (Meta/TikTok Parity)', () => {
    const targetDid = 'did:sovra:bad_actor_99';
    const targetHandle = '@spambot_prime';

    it('reports not shadowbanned for a clean DID', () => {
      const status = engine.isShadowbanned(targetDid);
      expect(status.shadowbanned).toBe(false);
      expect(status.decayFactor).toBe(1.0);
    });

    it('sets a silent shadowban with custom visibility decay factor', () => {
      engine.setShadowban(
        targetDid,
        targetHandle,
        'Suspected bot swarming & automated engagement farming',
        0.02,
        Date.now() + 86400000,
      );

      const status = engine.isShadowbanned(targetDid);
      expect(status.shadowbanned).toBe(true);
      expect(status.decayFactor).toBe(0.02);

      const list = engine.getShadowbans();
      const record = list.find((s) => s.did === targetDid);
      expect(record).toBeDefined();
      expect(record?.handle).toBe(targetHandle);
      expect(record?.decayFactor).toBe(0.02);
      expect(record?.reason).toContain('Suspected bot swarming');
    });

    it('lifts a shadowban cleanly', () => {
      engine.removeShadowban(targetDid);
      const status = engine.isShadowbanned(targetDid);
      expect(status.shadowbanned).toBe(false);

      const list = engine.getShadowbans();
      const record = list.find((s) => s.did === targetDid);
      expect(record).toBeUndefined();
    });
  });

  describe('3. 🚩 Canary Feature Flags & Rollouts (LaunchDarkly Parity)', () => {
    it('seeds standard feature flags for gradual deployment', () => {
      const flags = engine.getFeatureFlags();
      expect(flags.length).toBeGreaterThanOrEqual(6);

      const calling = flags.find((f) => f.id === 'webrtc_calling_v2');
      expect(calling).toBeDefined();
      expect(calling?.enabled).toBe(true);
      expect(calling?.rolloutPercentage).toBe(100);

      const meshIsp = flags.find((f) => f.id === 'mesh_isp_bandwidth_metering');
      expect(meshIsp).toBeDefined();
      expect(meshIsp?.rolloutPercentage).toBe(25);
    });

    it('updates rollout percentage and enable status', () => {
      const ok = engine.setFeatureFlag('mesh_isp_bandwidth_metering', true, 75);
      expect(ok).toBe(true);

      const flags = engine.getFeatureFlags();
      const flag = flags.find((f) => f.id === 'mesh_isp_bandwidth_metering');
      expect(flag?.enabled).toBe(true);
      expect(flag?.rolloutPercentage).toBe(75);
    });

    it('evaluates client feature flags deterministically per user DID', () => {
      // 100% rollout flag should always be true for any user
      engine.setFeatureFlag('ephemeral_stories_v2', true, 100);
      const eval1 = engine.evaluateClientFlags('did:sovra:user_alice');
      const eval2 = engine.evaluateClientFlags('did:sovra:user_bob');
      expect(eval1['ephemeral_stories_v2']).toBe(true);
      expect(eval2['ephemeral_stories_v2']).toBe(true);

      // 0% rollout flag should always be false
      engine.setFeatureFlag('ephemeral_stories_v2', true, 0);
      const eval3 = engine.evaluateClientFlags('did:sovra:user_alice');
      expect(eval3['ephemeral_stories_v2']).toBe(false);

      // Disabled flag is always false regardless of percentage
      engine.setFeatureFlag('ephemeral_stories_v2', false, 100);
      const eval4 = engine.evaluateClientFlags('did:sovra:user_alice');
      expect(eval4['ephemeral_stories_v2']).toBe(false);
    });
  });

  describe('4. 📢 Global Broadcast & Amber Alert Dispatcher', () => {
    let alertId: string;

    it('publishes critical global swarm broadcasts', () => {
      alertId = engine.publishBroadcastAlert({
        level: 'CRITICAL',
        title: 'Emergency Consensus Upgrade Scheduled',
        message: 'All sovereign peer nodes must synchronize block headers by 04:00 UTC.',
        actionLabel: 'Upgrade Guide',
        actionUrl: 'https://docs.sovra.network/consensus',
        isSticky: true,
      });

      expect(typeof alertId).toBe('string');
      expect(alertId.length).toBeGreaterThan(0);

      const activeAlerts = engine.getActiveBroadcastAlerts();
      expect(activeAlerts.length).toBeGreaterThanOrEqual(1);

      const myAlert = activeAlerts.find((a) => a.id === alertId);
      expect(myAlert).toBeDefined();
      expect(myAlert?.level).toBe('CRITICAL');
      expect(myAlert?.title).toBe('Emergency Consensus Upgrade Scheduled');
      expect(myAlert?.isSticky).toBe(true);
    });

    it('dismisses broadcast alerts immediately upon resolution', () => {
      const ok = engine.dismissBroadcastAlert(alertId);
      expect(ok).toBe(true);

      const activeAlerts = engine.getActiveBroadcastAlerts();
      const myAlert = activeAlerts.find((a) => a.id === alertId);
      expect(myAlert).toBeUndefined();

      // Should still be present in total audit logs with active = false
      const allAlerts = engine.getBroadcastAlerts();
      const archived = allAlerts.find((a) => a.id === alertId);
      expect(archived).toBeDefined();
      expect(Boolean(archived?.active)).toBe(false);
    });
  });

  describe('5. 🛡️ Forensic Compliance Vault & Legal Hold Dossier', () => {
    const suspectDid = 'did:sovra:forensic_subject_7';

    it('sets a cryptographic legal hold preventing data shredding', () => {
      expect(engine.hasLegalHold(suspectDid)).toBe(false);

      engine.setLegalHold(
        suspectDid,
        'CASE-2026-DOJ-9921',
        'Formal subpoena issued regarding cross-border financial compliance',
        'CHIEF-COMPLIANCE-OFFICER-01',
      );

      expect(engine.hasLegalHold(suspectDid)).toBe(true);

      const holds = engine.getLegalHolds();
      const hold = holds.find((h) => h.did === suspectDid);
      expect(hold).toBeDefined();
      expect(hold?.caseReference).toBe('CASE-2026-DOJ-9921');
      expect(hold?.investigator).toBe('CHIEF-COMPLIANCE-OFFICER-01');
    });

    it('generates a 1-click tamper-evident forensic dossier with SHA-256 seal', () => {
      const dossierResult = engine.generateForensicDossier(suspectDid);

      expect(dossierResult).toBeDefined();
      expect(dossierResult.sha256Seal).toBeDefined();
      expect(dossierResult.sha256Seal.length).toBe(64); // Valid SHA-256 hex string

      const dossier = dossierResult.dossier;
      expect(dossier.specVersion).toBe('SOVRA-FORENSIC-V1.0');
      expect(dossier.subject.did).toBe(suspectDid);
      expect(dossier.securityState.underLegalHold).toBe(true);
      expect(typeof dossier.socialMetrics.postsCount).toBe('number');
      expect(Array.isArray(dossier.hardwareSessions)).toBe(true);
    });

    it('lifts legal hold when formal investigation completes', () => {
      engine.removeLegalHold(suspectDid);
      expect(engine.hasLegalHold(suspectDid)).toBe(false);

      const holds = engine.getLegalHolds();
      const hold = holds.find((h) => h.did === suspectDid);
      expect(hold).toBeUndefined();
    });
  });
});
