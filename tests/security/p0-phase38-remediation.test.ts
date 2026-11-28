import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';

const BASE_URL = 'http://localhost:3001';

describe('SOVRA Phase 38: P0 Critical Functionality Remediation Verification', () => {

  // Test Admin Principal Token & Key
  const ADMIN_SECRET = 'sovra-test-admin-secret-key-32-chars-ok!';
  let adminSessionToken = '';
  let sqliteEngine: SqliteSocialDatabaseEngine;

  beforeAll(async () => {
    sqliteEngine = new SqliteSocialDatabaseEngine();

    // Authenticate Admin
    const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey: ADMIN_SECRET, role: 'SUPER_ADMIN' })
    });
    const loginData = await loginRes.json();
    expect(loginData.ok).toBe(true);
    expect(loginData.sessionToken).toBeTruthy();
    adminSessionToken = loginData.sessionToken;
  });

  // ========================================================
  // WORKSTREAM 1: ADMIN HARDWARE KILL SWITCH
  // ========================================================
  describe('Workstream 1: Admin Kill Switch Matrix', () => {
    const switchId = 'emergency_freeze_all_withdrawals';

    it('should engage kill switch when invoked by authorized administrator', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/nuclear/switch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminSessionToken}`,
          'x-admin-did': 'did:sov:admin_root'
        },
        body: JSON.stringify({
          switchId,
          active: true,
          reason: 'Automated Vitest Security Suite: Engage Test'
        })
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message).toContain('FROZEN');

      // Verify switch state via GET endpoint
      const listRes = await fetch(`${BASE_URL}/api/admin/nuclear/switches`);
      const listData = await listRes.json();
      expect(listData.ok).toBe(true);
      const target = listData.switches.find((s: any) => s.switchId === switchId);
      expect(target).toBeTruthy();
      expect(Boolean(target.isActive)).toBe(true);
    });

    it('should reject unauthorized privilege escalation attempts with HTTP 403', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/nuclear/switch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-did': 'did:sov:unauthorized_attacker_did_0001'
        },
        body: JSON.stringify({
          switchId,
          active: false,
          reason: 'Malicious unauthorized deactivation attempt'
        })
      });
      const data = await res.json();
      expect(res.status).toBe(403);
      expect(data.ok).toBe(false);
      expect(data.error).toContain('RBAC_PERMISSION_DENIED');
    });

    it('should lift freeze when invoked by authorized administrator', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/nuclear/switch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminSessionToken}`,
          'x-admin-did': 'did:sov:admin_root'
        },
        body: JSON.stringify({
          switchId,
          active: false,
          reason: 'Automated Vitest Security Suite: Lift Test'
        })
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message).toContain('STANDBY');
    });
  });

  // ========================================================
  // WORKSTREAM 2: SOLVENCY INVARIANT RECONCILER
  // ========================================================
  describe('Workstream 2: Solvency Invariant Reconciler (Strict READ-ONLY)', () => {
    it('should execute continuous double-entry solvency audit and confirm 0 drift', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/self-healing/trigger-solvency`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminSessionToken}`
        }
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.isSolvent).toBe(true);
      expect(data.delta).toBe(0);
      expect(data.circuitBreakerHalted).toBe(false);
    });
  });

  // ========================================================
  // WORKSTREAM 3: CHRONOS POINT-IN-TIME SNAPSHOT
  // ========================================================
  describe('Workstream 3: Chronos Immutable Point-in-Time Snapshot', () => {
    let createdSnapshotId = '';

    it('should seal an immutable SQLite point-in-time snapshot with SHA-256 seal', async () => {
      const label = 'test_audit_chronos_' + Date.now();
      const res = await fetch(`${BASE_URL}/api/admin/chronos/snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminSessionToken}`
        },
        body: JSON.stringify({ label })
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.snapshot).toBeTruthy();
      expect(data.snapshot.sha256Seal).toMatch(/^[a-f0-9]{64}$/i);
      expect(data.snapshot.id).toBeTruthy();
      createdSnapshotId = data.snapshot.id;

      // Verify physical snapshot file exists on disk
      if (data.snapshot.filePath) {
        expect(fs.existsSync(data.snapshot.filePath)).toBe(true);
      }
    });

    it('should list created snapshots in Chronos registry', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/chronos/snapshots`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.snapshots)).toBe(true);
      const found = data.snapshots.find((s: any) => s.id === createdSnapshotId);
      expect(found).toBeTruthy();
    });
  });

  // ========================================================
  // WORKSTREAM 4: TIPPING DOUBLE-SPEND PROTECTION & ATOMIC LEDGER
  // ========================================================
  describe('Workstream 4: Tipping Double-Spend & Idempotency Key Gate', () => {
    const senderDid = 'did:sovra:donor_' + Date.now();
    const recipientDid = 'did:sovra:creator_' + Date.now();
    let senderToken = 'stk_' + Math.random().toString(36).slice(2);

    beforeAll(async () => {
      // Register donor user
      const regSender = await fetch(`${BASE_URL}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          did: senderDid,
          handle: '@donor_' + Date.now(),
          displayName: 'Test Donor',
          deviceType: 'BROWSER',
          sessionToken: senderToken
        })
      });
      const sData = await regSender.json();
      if (sData.sessionToken) senderToken = sData.sessionToken;

      // Register creator user
      await fetch(`${BASE_URL}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          did: recipientDid,
          handle: '@creator_' + Date.now(),
          displayName: 'Test Creator',
          deviceType: 'BROWSER'
        })
      });

      // Fund donor with 200 SOV in SQLite directly
      sqliteEngine.upsertUser({
        did: senderDid,
        balanceSov: 200.0,
        sessionToken: senderToken
      });
    });

    it('should process a valid tip with atomic ledger debit/credit', async () => {
      const idempotencyKey = 'key_unique_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const res = await fetch(`${BASE_URL}/api/watch/tip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${senderToken}`,
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          recipientDid,
          amount: 25,
          message: 'Top content!',
          idempotencyKey
        })
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.txId).toBeTruthy();
      expect(data.amount).toBe(25);
      expect(data.newBalance).toBe(175);
    });

    it('should strictly deduplicate 5 concurrent requests with identical idempotency key to exactly 1 debit', async () => {
      const sharedKey = 'race_double_spend_test_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const tipAmount = 10;

      // Fire 5 concurrent requests simultaneously
      const promises = Array.from({ length: 5 }, () =>
        fetch(`${BASE_URL}/api/watch/tip`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${senderToken}`,
            'X-Idempotency-Key': sharedKey
          },
          body: JSON.stringify({
            recipientDid,
            amount: tipAmount,
            message: 'Concurrent race tip',
            idempotencyKey: sharedKey
          })
        }).then(async r => ({ status: r.status, data: await r.json() }))
      );

      const results = await Promise.all(promises);

      // Verify that responses were either HTTP 200 (completed with same txId) or HTTP 409 (in-flight reject)
      const txIds = new Set<string>();
      let successCount = 0;

      results.forEach(res => {
        if (res.status === 200 && res.data.ok) {
          successCount++;
          txIds.add(res.data.txId);
          // Balance after must be 165 (175 - 10), NEVER deducted multiple times!
          expect(res.data.newBalance).toBe(165);
        } else {
          expect([200, 409]).toContain(res.status);
        }
      });

      // Exactly ONE transaction ID across all 5 requests!
      expect(txIds.size).toBe(1);
      expect(successCount).toBeGreaterThanOrEqual(1);
    });

    it('should prohibit self-tipping circular wash transactions', async () => {
      const res = await fetch(`${BASE_URL}/api/watch/tip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${senderToken}`
        },
        body: JSON.stringify({
          recipientDid: senderDid, // Self-tipping
          amount: 10,
          message: 'Circular wash exploit attempt'
        })
      });
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Self-tipping prohibited');
    });

    it('should reject overdraft tip exceeding available balance', async () => {
      const res = await fetch(`${BASE_URL}/api/watch/tip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${senderToken}`
        },
        body: JSON.stringify({
          recipientDid,
          amount: 99999999, // Overdraft
          message: 'Overdraft exploit attempt'
        })
      });
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Insufficient balance');
    });
  });

  // ========================================================
  // WORKSTREAM 5: RESUMABLE VIDEO UPLOAD COMPLETION API
  // ========================================================
  describe('Workstream 5: Resumable Video Upload Completion API Pipeline', () => {
    let uploadId = '';
    const chunk1 = Buffer.from('FAKE_VIDEO_HEADER_PART_1_SOVRA_MAGIC_BYTES_12345');
    const chunk2 = Buffer.from('FAKE_VIDEO_PAYLOAD_PART_2_SOVRA_60FPS_ENCODING_67890');

    it('should initialize upload session via POST /api/videos/upload/init', async () => {
      const res = await fetch(`${BASE_URL}/api/videos/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Sovereign Decentralized Cinema 4K',
          fileSize: chunk1.length + chunk2.length,
          mimeType: 'video/mp4',
          category: 'Documentary',
          tags: ['#Sovra', '#P2P', '#Cinema'],
          channelName: 'Sovereign Studios',
          channelHandle: '@studios',
          durationSeconds: 120,
          visibility: 'public'
        })
      });
      const data = await res.json();
      expect([200, 201]).toContain(res.status);
      expect(data.ok).toBe(true);
      expect(data.uploadId).toMatch(/^upl_/);
      expect(data.chunkSize).toBe(8 * 1024 * 1024);
      uploadId = data.uploadId;
    });

    it('should stream chunk 1 via PATCH /api/videos/upload/chunk', async () => {
      const res = await fetch(`${BASE_URL}/api/videos/upload/chunk?uploadId=${encodeURIComponent(uploadId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes 0-${chunk1.length - 1}/${chunk1.length + chunk2.length}`
        },
        body: chunk1
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.bytesReceived).toBe(chunk1.length);
    });

    it('should stream chunk 2 via PATCH /api/videos/upload/chunk', async () => {
      const res = await fetch(`${BASE_URL}/api/videos/upload/chunk?uploadId=${encodeURIComponent(uploadId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${chunk1.length}-${chunk1.length + chunk2.length - 1}/${chunk1.length + chunk2.length}`
        },
        body: chunk2
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.chunkBytesReceived ?? data.bytesReceived).toBe(chunk2.length);
      expect(data.totalBytesReceived ?? data.bytesReceived).toBe(chunk1.length + chunk2.length);
    });

    it('should assemble chunks, compute CID, store file, and create video post via POST /api/videos/upload/complete', async () => {
      const res = await fetch(`${BASE_URL}/api/videos/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId })
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.video).toBeTruthy();
      expect(data.video.id).toBeTruthy();
      expect(data.video.cid).toMatch(/^bafy/);
      expect(data.video.url).toContain(data.video.cid);

      // Verify upload session is cleaned up
      const reComplete = await fetch(`${BASE_URL}/api/videos/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId })
      });
      expect(reComplete.status).toBe(404);
    });

    it('should return 404 when attempting to complete a non-existent or expired upload', async () => {
      const res = await fetch(`${BASE_URL}/api/videos/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: 'upl_fake_nonexistent_session_id' })
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('not found');
    });
  });
});
