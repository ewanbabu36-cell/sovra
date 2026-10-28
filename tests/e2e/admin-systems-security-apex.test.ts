import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite';

describe('Sovra Super-Console Systems & Security Apex Invariants', () => {
  let engine: SqliteSocialDatabaseEngine;
  const testStorageDir = path.resolve('./.sovra-test-systems-apex');

  beforeEach(() => {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
    fs.mkdirSync(testStorageDir, { recursive: true });
    engine = new SqliteSocialDatabaseEngine(testStorageDir);
  });

  afterEach(() => {
    engine.close();
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  });

  // =========================================================================
  // CONSTRAINT 1: SQLite with WAL mode & Sub-millisecond Execution
  // =========================================================================
  it('Constraint 1: should enforce WAL mode and high-performance safety PRAGMAs', () => {
    const db = (engine as any).db;
    const journalMode = db.prepare('PRAGMA journal_mode;').get() as any;
    expect(journalMode.journal_mode.toLowerCase()).toBe('wal');

    const syncMode = db.prepare('PRAGMA synchronous;').get() as any;
    // NORMAL synchronous mode is 1
    expect(Number(syncMode.synchronous)).toBe(1);

    const foreignKeys = db.prepare('PRAGMA foreign_keys;').get() as any;
    expect(Number(foreignKeys.foreign_keys)).toBe(1);
  });

  // =========================================================================
  // CONSTRAINT 2: Zero Thread Blocking Asynchronous DFS Wash-Trading Detection
  // =========================================================================
  it('Constraint 2: should execute async wash-trading cycle detection without event loop starvation', async () => {
    const now = Date.now();
    const db = (engine as any).db;

    // Seed a 3-hop circular wash-trading loop: A -> B -> C -> A
    const transfers = [
      ['tx_apex_1', 'did:sov:alice', 'did:sov:bob', 150.0, 0.5, 'TIP', now - 1000],
      ['tx_apex_2', 'did:sov:bob', 'did:sov:charlie', 150.0, 0.5, 'TIP', now - 500],
      ['tx_apex_3', 'did:sov:charlie', 'did:sov:alice', 150.0, 0.5, 'TIP', now - 100],
    ];

    const insert = db.prepare('INSERT INTO token_transfers (id, from_did, to_did, amount_sov, fee_sov, tx_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const t of transfers) {
      insert.run(...t);
    }

    const start = performance.now();
    const cycles = await engine.detectWashTradingCyclesAsync(72, 5);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100); // Sub-100ms total runtime
    expect(cycles.length).toBeGreaterThanOrEqual(1);

    const loop = cycles.find(c => c.cycle.includes('did:sov:alice') && c.cycle.includes('did:sov:bob') && c.cycle.includes('did:sov:charlie'));
    expect(loop).toBeDefined();
    expect(loop?.totalVolumeSov).toBe(450.0);
    expect(loop?.txCount).toBe(3);
  });

  // =========================================================================
  // CONSTRAINT 3: Invariant Integrity & Atomic 4-Column Double-Entry Transfers
  // =========================================================================
  it('Constraint 3A: should execute atomic 4-column double-entry ledger transfers with strict solvency check', () => {
    // Create two test users with starting balances
    const userA = {
      did: 'did:sov:sender_alice',
      handle: 'alice_trader',
      displayName: 'Alice Trader',
      bio: 'Verified Trader',
      avatarUrl: '',
      bannerUrl: '',
      followerCount: 0,
      followingCount: 0,
      postsCount: 0,
      verified: true,
      createdAt: Date.now(),
      balanceSov: 500.0,
      privacySettings: { isPrivate: false, allowDirectMessages: true, allowP2pCalls: true },
    };

    const userB = {
      did: 'did:sov:receiver_bob',
      handle: 'bob_creator',
      displayName: 'Bob Creator',
      bio: 'Verified Creator',
      avatarUrl: '',
      bannerUrl: '',
      followerCount: 0,
      followingCount: 0,
      postsCount: 0,
      verified: true,
      createdAt: Date.now(),
      balanceSov: 100.0,
      privacySettings: { isPrivate: false, allowDirectMessages: true, allowP2pCalls: true },
    };

    engine.upsertUser(userA);
    engine.upsertUser(userB);

    // Perform atomic transfer of 120 SOV from Alice to Bob
    const result = engine.executeAtomicLedgerTransfer({
      fromDid: userA.did,
      toDid: userB.did,
      amountSov: 120.0,
      feeSov: 0.0,
      memo: 'Creator grant sponsorship',
      adminDid: 'did:sov:admin_root',
    });

    expect(result.txId).toMatch(/^tx_/);
    expect(result.fromBalanceAfter).toBe(380.0);
    expect(result.toBalanceAfter).toBe(220.0);
    expect(result.solvencyInvariantPassed).toBe(true);

    // Verify user balances in DB
    const dbAlice = engine.getUserByDid(userA.did);
    const dbBob = engine.getUserByDid(userB.did);
    expect(dbAlice?.balanceSov).toBe(380.0);
    expect(dbBob?.balanceSov).toBe(220.0);

    // Verify immutable record in token_transfers
    const db = (engine as any).db;
    const transferRecord = db.prepare('SELECT * FROM token_transfers WHERE id = ?').get(result.txId) as any;
    expect(transferRecord).toBeDefined();
    expect(transferRecord.from_did).toBe(userA.did);
    expect(transferRecord.to_did).toBe(userB.did);
    expect(transferRecord.amount_sov).toBe(120.0);
  });

  it('Constraint 3B: should reject transfer and rollback atomically if sender has insufficient funds', () => {
    const userA = {
      did: 'did:sov:poor_alice',
      handle: 'poor_alice',
      displayName: 'Poor Alice',
      bio: '',
      avatarUrl: '',
      bannerUrl: '',
      followerCount: 0,
      followingCount: 0,
      postsCount: 0,
      verified: false,
      createdAt: Date.now(),
      balanceSov: 25.0,
      privacySettings: { isPrivate: false, allowDirectMessages: true, allowP2pCalls: true },
    };

    const userB = {
      did: 'did:sov:rich_bob',
      handle: 'rich_bob',
      displayName: 'Rich Bob',
      bio: '',
      avatarUrl: '',
      bannerUrl: '',
      followerCount: 0,
      followingCount: 0,
      postsCount: 0,
      verified: false,
      createdAt: Date.now(),
      balanceSov: 100.0,
      privacySettings: { isPrivate: false, allowDirectMessages: true, allowP2pCalls: true },
    };

    engine.upsertUser(userA);
    engine.upsertUser(userB);

    // Alice tries to transfer 50 SOV with only 25 SOV balance
    expect(() => {
      engine.executeAtomicLedgerTransfer({
        fromDid: userA.did,
        toDid: userB.did,
        amountSov: 50.0,
      });
    }).toThrow(/Insufficient balance/i);

    // Verify balances did not change
    expect(engine.getUserByDid(userA.did)?.balanceSov).toBe(25.0);
    expect(engine.getUserByDid(userB.did)?.balanceSov).toBe(100.0);
  });

  // =========================================================================
  // CONSTRAINT 4: RBAC Validation & Cryptographic Tamper-Proof Audit Chain
  // =========================================================================
  it('Constraint 4A: should enforce strict RBAC permissions and role assignments', () => {
    // Check root admin permissions
    expect(engine.hasPermission('did:sov:admin_root', 'kill_switches:write')).toBe(true);
    expect(engine.hasPermission('did:sov:admin_root', 'any_arbitrary_permission')).toBe(true);

    // Check Incident Commander
    expect(engine.hasPermission('did:sov:admin_commander', 'kill_switches:write')).toBe(true);
    expect(engine.hasPermission('did:sov:admin_commander', 'broadcasts:write')).toBe(true);
    expect(engine.hasPermission('did:sov:admin_commander', 'take_rate:write')).toBe(false);

    // Check Finance Auditor
    expect(engine.hasPermission('did:sov:admin_auditor', 'solvency:read')).toBe(true);
    expect(engine.hasPermission('did:sov:admin_auditor', 'ledger:transfer')).toBe(true);
    expect(engine.hasPermission('did:sov:admin_auditor', 'god_dial:write')).toBe(false);

    // Check Content Moderator
    expect(engine.hasPermission('did:sov:admin_moderator', 'god_dial:write')).toBe(true);
    expect(engine.hasPermission('did:sov:admin_moderator', 'shadowbans:write')).toBe(true);
    expect(engine.hasPermission('did:sov:admin_moderator', 'kill_switches:write')).toBe(false);

    // Dynamically assign custom role
    engine.assignRbacRole('did:sov:custom_ops', 'OPS_ENGINEER', ['telemetry:read', 'wiretap:read']);
    expect(engine.hasPermission('did:sov:custom_ops', 'wiretap:read')).toBe(true);
    expect(engine.hasPermission('did:sov:custom_ops', 'kill_switches:write')).toBe(false);
  });

  it('Constraint 4B: should generate cryptographic Merkle hash chain and verify valid audit integrity', () => {
    // Record multiple admin actions
    const entry1 = engine.recordTamperProofAuditEntry({
      adminDid: 'did:sov:admin_commander',
      actionType: 'KILL_SWITCH_ENGAGED',
      targetResource: 'MEDIA_UPLOADS_FROZEN',
      payload: { reason: 'Prevent CSAM flood attack', previousState: 0 },
      ipAddress: '192.168.1.50',
    });

    const entry2 = engine.recordTamperProofAuditEntry({
      adminDid: 'did:sov:admin_auditor',
      actionType: 'TAKE_RATE_UPDATED',
      targetResource: 'PLATFORM_TAKE_RATE',
      payload: { previousPct: 5.0, newPct: 6.5 },
      ipAddress: '192.168.1.75',
    });

    expect(entry1.sequenceNum).toBe(1);
    expect(entry2.sequenceNum).toBe(2);
    expect(entry2.prevHash).toBe(entry1.currentHash);

    // Verify chain integrity
    const chainAudit = engine.verifyTamperProofAuditChain();
    expect(chainAudit.isValid).toBe(true);
    expect(chainAudit.totalEntries).toBe(3); // Genesis (0) + Entry1 (1) + Entry2 (2)
    expect(chainAudit.headHash).toBe(entry2.currentHash);
  });

  it('Constraint 4C: should immediately detect unauthorized adversarial tampering in the audit ledger', () => {
    const db = (engine as any).db;

    // Record legitimate action
    engine.recordTamperProofAuditEntry({
      adminDid: 'did:sov:admin_root',
      actionType: 'SHADOWBAN_APPLIED',
      targetResource: 'did:sov:spammer_123',
      payload: { decay: 0.02 },
      ipAddress: '127.0.0.1',
    });

    // Verify it is currently valid
    expect(engine.verifyTamperProofAuditChain().isValid).toBe(true);

    // Adversary directly hacks SQLite to tamper with payload_json or target_resource
    db.prepare("UPDATE admin_tamper_evident_audit_ledger SET payload_json = '{\"decay\":0.99,\"hacked\":true}' WHERE sequence_num = 1").run();

    // Verify tamper proof audit chain detects the breach!
    const tamperedAudit = engine.verifyTamperProofAuditChain();
    expect(tamperedAudit.isValid).toBe(false);
    expect(tamperedAudit.tamperedAtSeq).toBe(1);
    expect(tamperedAudit.reason).toMatch(/Cryptographic signature mismatch|altered/i);
  });
});
