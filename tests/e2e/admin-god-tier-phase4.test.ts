import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';

describe('Phase 4: Wiretap X-Ray, Unit Economics & Chronos Time-Travel Snapshots', () => {
  const testStorageDir = path.resolve(`./.sovra-storage-test-phase4-${Date.now()}`);
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

  describe('1. 📡 Wiretap X-Ray Packet Buffer (Zero Dark Traffic)', () => {
    it('records and retrieves real-time HTTP & P2P network telemetry', () => {
      engine.recordWiretapRequest({
        method: 'POST',
        path: '/api/feed/tip',
        status: 200,
        latencyMs: 3.4,
        ipAddress: '198.51.100.12',
        userAgent: 'SovraNativeClient/3.0',
        bytes: 1024,
        did: 'did:sovra:fan_99',
      });

      engine.recordWiretapRequest({
        method: 'GET',
        path: '/api/mesh/nodes',
        status: 200,
        latencyMs: 1.2,
        ipAddress: '198.51.100.15',
        userAgent: 'SovraNativeClient/3.0',
        bytes: 4096,
      });

      const list = engine.getWiretapRequests(10);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(2);

      const tipReq = list.find((r) => r.path === '/api/feed/tip');
      expect(tipReq).toBeDefined();
      expect(tipReq?.method).toBe('POST');
      expect(tipReq?.status).toBe(200);
      expect(tipReq?.latencyMs).toBe(3.4);
      expect(tipReq?.ipAddress).toBe('198.51.100.12');
    });
  });

  describe('2. 📈 Autonomous Unit Economics & Financial Runway Engine', () => {
    it('computes daily burn, intake, and runway forecast', () => {
      const forecast = engine.getRunwayForecast();
      expect(forecast).toBeDefined();
      expect(typeof forecast.liquidTreasurySov).toBe('number');
      expect(typeof forecast.dailyIntakeSov).toBe('number');
      expect(typeof forecast.dailyBurnSov).toBe('number');
      expect(typeof forecast.netCashflowSov).toBe('number');
      expect(typeof forecast.runwayDays).toBe('number');
      expect(['PROFITABLE_COMPOUNDING', 'STABLE_SUSTAINABLE', 'RUNWAY_CRITICAL']).toContain(forecast.healthStatus);
    });

    it('calculates creator ROI attribution to eliminate unprofitable subsidies', () => {
      const creators = engine.getCreatorRoiAttribution();
      expect(Array.isArray(creators)).toBe(true);
      // Even with 0 users, it safely returns an empty array or seeded top list
      for (const c of creators) {
        expect(c.creatorDid).toBeDefined();
        expect(typeof c.roiRatio).toBe('number');
        expect(['VIP_HIGH_ROI', 'SELF_SUSTAINING', 'UNPROFITABLE_SUBSIDY']).toContain(c.status);
      }
    });
  });

  describe('3. ⏱️ Chronos Immutable Time-Travel Snapshots (Zero-Error Recovery)', () => {
    it('creates an atomic point-in-time database snapshot with cryptographic SHA-256 seal', () => {
      const snapshot = engine.createChronosSnapshot('pre_deployment_baseline', 'SUPER-ADMIN');
      expect(snapshot).toBeDefined();
      expect(snapshot.id.startsWith('snap_')).toBe(true);
      expect(snapshot.fileSizeBytes).toBeGreaterThan(0);
      expect(snapshot.sha256Seal).toBeDefined();
      expect(snapshot.sha256Seal.length).toBe(64);

      // Verify file exists on disk
      expect(fs.existsSync(snapshot.filePath)).toBe(true);
    });

    it('lists all historical chronos snapshots with byte sizes and seals', () => {
      const list = engine.listChronosSnapshots();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(1);

      const snap = list[0];
      expect(snap.label).toBe('pre_deployment_baseline');
      expect(snap.fileSizeMb).toBeDefined();
      expect(snap.createdBy).toBe('SUPER-ADMIN');
    });
  });
});
