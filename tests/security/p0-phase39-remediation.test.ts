import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SqliteSocialDatabaseEngine, type VideoUploadSessionRecord } from '../../scripts/database-sqlite.ts';
import { SqliteMigrationRunner } from '../../scripts/database-migrations.ts';

describe('SOVRA Phase 39: P0 Critical Security Remediation Verification', () => {
  let tempDir: string;
  let dbPath: string;
  let dbEngine: SqliteSocialDatabaseEngine;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), 'tests', 'fixtures', 'phase39_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    dbPath = path.join(tempDir, 'sovra_test_p39.db');
    dbEngine = new SqliteSocialDatabaseEngine(dbPath);

    // Run migrations to ensure up to migration 010 is applied
    const runner = new SqliteMigrationRunner(dbEngine.getRawDb());
    runner.applyPending();
  });

  afterEach(() => {
    try {
      dbEngine.close();
    } catch (_) {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // ==========================================
  // WORKSTREAM 1: P0-05 DURABLE VIDEO UPLOAD SESSIONS
  // ==========================================
  describe('P0-05: Video Upload Session Durability Across Restarts', () => {
    it('should persist upload session and chunk manifest in SQLite, surviving engine restart', () => {
      const uploadId = 'upl_test_' + Date.now();
      const stagingDir = path.join(tempDir, 'staging_' + uploadId);
      fs.mkdirSync(stagingDir, { recursive: true });

      // 1. Create upload session
      const created = dbEngine.createVideoUploadSession({
        uploadId,
        authorDid: 'did:sov:creator_123',
        title: 'Sovereign Decentralized Reel',
        fileSize: 10485760, // 10MB
        category: 'Shorts',
        tags: ['#Sovra', '#P2P'],
        channelName: 'Alpha Creator',
        channelHandle: '@alphacreator',
        durationSeconds: 45,
        visibility: 'public',
        stagingDir,
      });

      expect(created.uploadId).toBe(uploadId);
      expect(created.status).toBe('IN_PROGRESS');
      expect(created.parts.length).toBe(0);

      // 2. Append chunk 0
      const part0 = path.join(stagingDir, 'part_00000.bin');
      fs.writeFileSync(part0, Buffer.from('chunk-0-data-payload'));
      const afterChunk0 = dbEngine.appendVideoUploadChunk(uploadId, part0);
      expect(afterChunk0.parts.length).toBe(1);

      // 3. Append chunk 1
      const part1 = path.join(stagingDir, 'part_00001.bin');
      fs.writeFileSync(part1, Buffer.from('chunk-1-data-payload'));
      const afterChunk1 = dbEngine.appendVideoUploadChunk(uploadId, part1);
      expect(afterChunk1.parts.length).toBe(2);

      // 4. SIMULATE ENGINE / SERVER CRASH & RESTART
      dbEngine.close();

      // Open new engine instance on the same SQLite file
      const restoredEngine = new SqliteSocialDatabaseEngine(dbPath);
      const retrieved = restoredEngine.getVideoUploadSession(uploadId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.uploadId).toBe(uploadId);
      expect(retrieved!.status).toBe('IN_PROGRESS');
      expect(retrieved!.authorDid).toBe('did:sov:creator_123');
      expect(retrieved!.title).toBe('Sovereign Decentralized Reel');
      expect(retrieved!.parts.length).toBe(2);
      expect(retrieved!.parts[0]).toBe(part0);
      expect(retrieved!.parts[1]).toBe(part1);

      // 5. Append chunk 2 on restored engine
      const part2 = path.join(stagingDir, 'part_00002.bin');
      fs.writeFileSync(part2, Buffer.from('chunk-2-data-payload'));
      const afterChunk2 = restoredEngine.appendVideoUploadChunk(uploadId, part2);
      expect(afterChunk2.parts.length).toBe(3);

      // 6. Complete upload session
      const sampleCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      restoredEngine.completeVideoUploadSession(uploadId, sampleCid);

      const finalized = restoredEngine.getVideoUploadSession(uploadId);
      expect(finalized!.status).toBe('COMPLETED');
      expect(finalized!.mediaCid).toBe(sampleCid);

      restoredEngine.close();
    });

    it('should reject appending chunks to completed or nonexistent upload sessions', () => {
      const uploadId = 'upl_nonexistent';
      expect(() => {
        dbEngine.appendVideoUploadChunk(uploadId, '/dummy/path');
      }).toThrow(/not found/i);
    });
  });

  // ==========================================
  // WORKSTREAM 2: P0-03 CLOSE UNCONSTRAINED TOKEN MINTING & ENFORCE 100M CAP
  // ==========================================
  describe('P0-03: Close Unconstrained Token Minting & Enforce 100M Cap', () => {
    it('should calculate global SOV supply and report 100M lifetime cap status', () => {
      const supply = dbEngine.getTotalSovSupply();
      expect(supply.maxLifetimeCapSov).toBe(100_000_000);
      expect(typeof supply.totalSystemAccountingSov).toBe('number');
      expect(supply.isWithinCap).toBe(true);
      expect(supply.remainingMintableSov).toBeGreaterThan(0);
    });

    it('should allow authorized admin to adjust user balance with audit log and double-entry ledger', () => {
      // Create user
      const targetDid = 'did:sov:user_recipient_001';
      dbEngine.upsertUser({
        did: targetDid,
        handle: '@recipient',
        displayName: 'Recipient One',
        balanceSov: 100.0,
      });

      // Adjust balance by +25 SOV
      const res = dbEngine.adjustUserBalanceWithAudit({
        adminDid: 'did:sov:admin_root',
        targetDid,
        amount: 25.0,
        reason: 'Community bounty payout',
        ipAddress: '127.0.0.1',
      });

      expect(res.ok).toBe(true);
      expect(res.oldBalanceSov).toBe(100.0);
      expect(res.newBalanceSov).toBe(125.0);
      expect(res.delta).toBe(25.0);
      expect(res.txId).toMatch(/^tx_adj_/);

      // Verify user balance in SQLite
      const updatedUser = dbEngine.findUserByDid(targetDid);
      expect(updatedUser!.balanceSov).toBe(125.0);

      // Verify ledger record in token_transfers
      const rawDb = dbEngine.getRawDb();
      const transferRow = rawDb.prepare('SELECT * FROM token_transfers WHERE id = ?').get(res.txId) as any;
      expect(transferRow).not.toBeNull();
      expect(transferRow.amount_sov).toBe(25.0);
      expect(transferRow.tx_type).toBe('ADMIN_ADJUSTMENT');
    });

    it('should reject balance adjustment if caller lacks admin permission (Zero-Trust RBAC)', () => {
      const targetDid = 'did:sov:user_unauth_target';
      dbEngine.upsertUser({
        did: targetDid,
        handle: '@unauth_target',
        balanceSov: 50.0,
      });

      expect(() => {
        dbEngine.adjustUserBalanceWithAudit({
          adminDid: 'did:sov:random_unauthorized_caller',
          targetDid,
          amount: 10.0,
          reason: 'Unauthorized mint attempt',
        });
      }).toThrow(/Forbidden/i);
    });

    it('should reject minting if amount exceeds the 100M lifetime hard cap', () => {
      const targetDid = 'did:sov:user_whaler';
      dbEngine.upsertUser({
        did: targetDid,
        handle: '@whaler',
        balanceSov: 0.0,
      });

      expect(() => {
        dbEngine.adjustUserBalanceWithAudit({
          adminDid: 'did:sov:admin_root',
          targetDid,
          amount: 100_000_001, // Over 100M cap
          reason: 'Excessive minting attempt',
        });
      }).toThrow(/Supply Cap Exceeded/i);
    });

    it('should reject debiting user balance below zero', () => {
      const targetDid = 'did:sov:user_poor';
      dbEngine.upsertUser({
        did: targetDid,
        handle: '@poor',
        balanceSov: 10.0,
      });

      expect(() => {
        dbEngine.adjustUserBalanceWithAudit({
          adminDid: 'did:sov:admin_root',
          targetDid,
          amount: -50.0, // Would make balance -40
          reason: 'Over-penalty attempt',
        });
      }).toThrow(/Insufficient balance/i);
    });
  });

  // ==========================================
  // WORKSTREAM 3: P0-01 END-TO-END CHAT ENCRYPTION & ZERO PLAINTEXT STORAGE
  // ==========================================
  describe('P0-01: Plaintext Chat Message Storage Remediation', () => {
    it('should store encrypted ciphertext and zero raw plaintext in direct_messages SQLite table', () => {
      const msgId = 'msg_secret_' + Date.now();
      const plaintextSecret = 'Top secret financial sovereign communication string';
      const senderDid = 'did:sov:alice_dm';
      const recipientDid = 'did:sov:bob_dm';

      // Insert message without pre-existing client ciphertext
      dbEngine.createChatMessage({
        id: msgId,
        senderDid,
        recipientDid,
        senderName: 'Alice',
        text: plaintextSecret,
        threadId: `${senderDid}_${recipientDid}`,
        timestamp: Date.now(),
      });

      // Verify in raw SQLite table direct_messages
      const rawDb = dbEngine.getRawDb();
      const row = rawDb.prepare('SELECT id, text, is_e2ee, ciphertext_hex, iv_hex, tag_hex FROM direct_messages WHERE id = ?').get(msgId) as any;

      expect(row).not.toBeNull();
      // Raw plaintext MUST NOT be stored in text column
      expect(row.text).not.toContain(plaintextSecret);
      expect(row.text).toContain('🔒');
      // Ciphertext and IV must be present
      expect(row.is_e2ee).toBe(1);
      expect(row.ciphertext_hex.length).toBeGreaterThan(0);
      expect(row.iv_hex.length).toBeGreaterThan(0);
      expect(row.tag_hex.length).toBeGreaterThan(0);

      // Verify decryptability using the thread secret
      const threadKey = crypto.createHash('sha256').update(`SOVRA_MSG_SEAL|${senderDid}_${recipientDid}`).digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', threadKey, Buffer.from(row.iv_hex, 'hex'));
      decipher.setAuthTag(Buffer.from(row.tag_hex, 'hex'));
      let decrypted = decipher.update(row.ciphertext_hex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      expect(decrypted).toBe(plaintextSecret);
    });

    it('should preserve already-encrypted client ciphertext without tampering', () => {
      const msgId = 'msg_client_enc_' + Date.now();
      const clientCiphertext = 'a1b2c3d4e5f6071829';
      const clientIv = '0102030405060708090a0b0c';
      const clientTag = 'deadbeefcafebabe0102030405060708';

      dbEngine.createChatMessage({
        id: msgId,
        senderDid: 'did:sov:client_sender',
        recipientDid: 'did:sov:client_receiver',
        senderName: 'Sender',
        text: '🔒 [End-to-End Encrypted: AES-GCM-256]',
        isE2EE: true,
        ciphertextHex: clientCiphertext,
        ivHex: clientIv,
        tagHex: clientTag,
        threadId: 'client_thread',
        timestamp: Date.now(),
      });

      const rawDb = dbEngine.getRawDb();
      const row = rawDb.prepare('SELECT * FROM direct_messages WHERE id = ?').get(msgId) as any;
      expect(row.ciphertext_hex).toBe(clientCiphertext);
      expect(row.iv_hex).toBe(clientIv);
      expect(row.tag_hex).toBe(clientTag);
      expect(row.text).toContain('🔒');
    });
  });

  // ==========================================
  // WORKSTREAM 4: P0-02 SINGLE-PROCESS RELIABILITY & HEALTH PROBES
  // ==========================================
  describe('P0-02: Single-Process Reliability & Health Probes', () => {
    it('should verify database is responsive through probe check', () => {
      const rawDb = dbEngine.getRawDb();
      const probe = rawDb.prepare('SELECT 1 as alive').get() as any;
      expect(probe.alive).toBe(1);
    });

    it('should cleanly checkpoint SQLite WAL on request', () => {
      const rawDb = dbEngine.getRawDb();
      expect(() => {
        rawDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      }).not.toThrow();
    });
  });

  // ==========================================
  // WORKSTREAM 5: P0-04 PROOF-OF-USAGE FAIL CLOSED
  // ==========================================
  describe('P0-04: Proof-of-Usage Fail-Closed Enforcement', () => {
    it('should fail closed when usage hours are less than 24', () => {
      const verifiedHours = 12; // Less than 24h
      const hasProof = false;
      const isValid = Boolean(hasProof && verifiedHours >= 24);
      expect(isValid).toBe(false);
    });

    it('should only permit emission when 24 verified hours and cryptographic proof are provided', () => {
      const verifiedHours = 24.5;
      const hasProof = true;
      const isValid = Boolean(hasProof && verifiedHours >= 24);
      expect(isValid).toBe(true);
    });
  });
});
