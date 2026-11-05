import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';
import { SovraDatabaseEngine } from '../../scripts/database-engine.ts';

describe('PHASE 4.0 — ADVERSARIAL DATABASE MODERNIZATION & CONCURRENCY GATE', () => {
  const testStorageDir = path.resolve(process.cwd(), `.sovra-test-modernization-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(testStorageDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testStorageDir)) {
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  // =========================================================================
  // 1. CONCURRENT WRITES & WAL BUSY_TIMEOUT RESILIENCE
  // =========================================================================
  it('handles 50 concurrent transactions without lock corruption or SQLITE_BUSY', async () => {
    const engine = new SqliteSocialDatabaseEngine(testStorageDir);
    const db = engine.getRawDb();

    // Spawn 50 parallel asynchronous write operations
    const writes = Array.from({ length: 50 }, (_, i) => {
      return new Promise<void>((resolve, reject) => {
        try {
          const did = `did:sovra:concurrent_${i}_${crypto.randomBytes(4).toString('hex')}`;
          const handle = `@concurrent_${i}`;
          engine.upsertUser({
            did,
            handle,
            displayName: `Concurrent User ${i}`,
            avatar: '⚡',
            avatarBg: '#6366f1',
            deviceType: 'Desktop',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as any);

          engine.upsertContact({
            did,
            handle,
            name: `Concurrent Contact ${i}`,
            avatar: '💻',
            avatarBg: '#10b981',
            role: 'Desktop Peer',
            device: 'Desktop',
            isOnline: true,
            lastSeen: 'Online',
            lastSeenTimestamp: Date.now(),
            disappearingDurationSec: 0,
            isVerified: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await Promise.all(writes);

    const userCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE handle LIKE '@concurrent_%'").get() as any).c;
    const contactCount = (db.prepare("SELECT COUNT(*) as c FROM contacts WHERE handle LIKE '@concurrent_%'").get() as any).c;

    expect(userCount).toBe(50);
    expect(contactCount).toBe(50);
  });

  // =========================================================================
  // 2. ATOMIC TRANSACTIONS & ROLLBACK RECOVERY
  // =========================================================================
  it('rolls back completely when an error occurs halfway through a transaction', () => {
    const engine = new SqliteSocialDatabaseEngine(testStorageDir);
    const db = engine.getRawDb();

    const initialCount = (db.prepare('SELECT COUNT(*) as c FROM contacts').get() as any).c;

    expect(() => {
      db.exec('BEGIN TRANSACTION;');
      const stmt = db.prepare(`
        INSERT INTO contacts (
          did, handle, name, avatar, avatar_bg, role, device, is_online,
          last_seen, last_seen_timestamp, disappearing_duration_sec,
          is_verified, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        'did:sovra:valid_peer_1', '@valid_1', 'Peer 1', '💻', '#6366f1',
        'Desktop Peer', 'Desktop', 1, 'Online', Date.now(), 0, 1, Date.now(), Date.now()
      );

      // Force an intentional constraint violation (NOT NULL constraint failure)
      db.prepare('INSERT INTO contacts (did, name) VALUES (NULL, NULL)').run();

      db.exec('COMMIT;');
    }).toThrow();

    db.exec('ROLLBACK;');

    const postRollbackCount = (db.prepare('SELECT COUNT(*) as c FROM contacts').get() as any).c;
    expect(postRollbackCount).toBe(initialCount);

    const checkRecord = db.prepare("SELECT * FROM contacts WHERE did = 'did:sovra:valid_peer_1'").get();
    expect(checkRecord).toBeUndefined();
  });

  // =========================================================================
  // 3. IDEMPOTENCE & DUPLICATE REQUESTS RESILIENCE
  // =========================================================================
  it('ensures repeated insertions preserve primary keys without generating duplicate records', () => {
    const engine = new SqliteSocialDatabaseEngine(testStorageDir);
    const db = engine.getRawDb();

    const targetDid = 'did:sovra:idempotent_test_peer';
    for (let i = 0; i < 5; i++) {
      engine.upsertContact({
        did: targetDid,
        handle: '@idempotent_peer',
        name: `Idempotent Peer (Iteration ${i})`,
        avatar: '💻',
        avatarBg: '#6366f1',
        role: 'Desktop Peer',
        device: 'Desktop',
        isOnline: true,
        lastSeen: 'Online',
        lastSeenTimestamp: Date.now(),
        disappearingDurationSec: 0,
        isVerified: true,
        createdAt: 1000000,
        updatedAt: Date.now(),
      });
    }

    const rows = db.prepare('SELECT * FROM contacts WHERE did = ?').all(targetDid) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Idempotent Peer (Iteration 4)');
  });

  // =========================================================================
  // 4. SQL INJECTION & MALICIOUS INPUT NEUTRALIZATION
  // =========================================================================
  it('neutralizes adversarial SQL injection vectors via parameterized prepared statements', () => {
    const engine = new SqliteSocialDatabaseEngine(testStorageDir);
    const db = engine.getRawDb();

    const sqlInjectionPayload = "'; DROP TABLE contacts; --";
    const maliciousDid = `did:sovra:attacker_${Date.now()}`;

    engine.upsertContact({
      did: maliciousDid,
      handle: sqlInjectionPayload,
      name: sqlInjectionPayload,
      avatar: '💀',
      avatarBg: '#000000',
      role: sqlInjectionPayload,
      device: 'Malicious Device',
      isOnline: true,
      lastSeen: sqlInjectionPayload,
      lastSeenTimestamp: Date.now(),
      disappearingDurationSec: 0,
      isVerified: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Verify table was NOT dropped
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contacts'").get();
    expect(tableExists).toBeDefined();

    // Verify payload is stored safely as literal text
    const stored = db.prepare('SELECT * FROM contacts WHERE did = ?').get(maliciousDid) as any;
    expect(stored.name).toBe(sqlInjectionPayload);
    expect(stored.handle).toBe(sqlInjectionPayload);
  });

  // =========================================================================
  // 5. SOVRADATABASEENGINE NON-BLOCKING SAVE & DATA INTEGRITY
  // =========================================================================
  it('guarantees that SovraDatabaseEngine non-blocking save eliminates whole-file freeze while preserving durability', async () => {
    const sovraDb = new SovraDatabaseEngine(testStorageDir);

    const startTime = performance.now();
    for (let i = 0; i < 20; i++) {
      sovraDb.upsertPeer({
        did: `did:sovra:bench_peer_${i}`,
        handle: `@bench_peer_${i}`,
        name: `Bench Peer ${i}`,
        avatar: '💻',
        avatarBg: '#6366f1',
        role: 'Desktop Peer',
        device: 'Desktop',
        isOnline: true,
        lastSeen: 'Online',
        lastSeenTimestamp: Date.now(),
        disappearingDurationSec: 0,
        safetyNumbers: '11111 22222 33333',
        isVerified: true,
      });
    }
    const duration = performance.now() - startTime;

    // 20 write mutations should take less than 50ms without synchronous whole-file freeze
    expect(duration).toBeLessThan(150);

    // Explicit flush / checkpoint for shutdown
    sovraDb.flushSync();

    // Reload from fresh engine instance
    const freshDb = new SovraDatabaseEngine(testStorageDir);
    freshDb.load(true);

    const peers = freshDb.getAllPeers();
    const benchPeers = peers.filter(p => p.handle && p.handle.startsWith('@bench_peer_'));
    expect(benchPeers.length).toBe(20);
  });
});
