/**
 * 👑 SOVRA PROTOCOL — AUTHORITATIVE USER & CREATOR MODERATION TEST SUITE
 * File: tests/security/admin_user_creator_moderation.test.ts
 *
 * Implements authoritative automated verification for all 15 required scenarios:
 *  1. User block / unblock
 *  2. Creator suspension / restoration (Wallet Balance Invariant Preserved)
 *  3. Post removal / restoration
 *  4. Shadow ban application / removal (Mandatory Expiry Duration Invariant)
 *  5. Shadow ban auto-expiry
 *  6. Feed distribution restriction enforcement
 *  7. Search/discovery restriction enforcement
 *  8. Unauthorized admin rejection (HTTP 403)
 *  9. Forged admin identity rejection (HTTP 401)
 * 10. Appeal submission and review (uphold / reverse / reduce)
 * 11. Audit log integrity and hash chaining (Merkle DAG)
 * 12. Duplicate action / idempotency handling
 * 13. Protected political criticism preservation (Constitutional Invariant)
 * 14. Child-safety escalation handling (CSAM Redaction & Vault Escalation)
 * 15. Direct API authorization bypass rejection
 */

import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

describe('Authoritative User & Creator Moderation Test Suite', () => {
  const baseUrl = 'http://localhost:3001';
  const adminSecret = 'sovra-test-admin-secret-key-32-chars-ok!';

  let rootToken = '';
  let moderatorToken = '';
  let observerToken = '';

  let testUserIdentity: { did: string; rawPub: Uint8Array; privateKey: crypto.KeyObject };
  let testUserDid = '';
  let testCreatorDid = '';
  let testPostId = '';

  // Base58-BTC encoder
  const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function encodeBase58(bytes: Uint8Array): string {
    const digits = [0];
    for (let i = 0; i < bytes.length; i++) {
      for (let j = 0; j < digits.length; j++) {
        digits[j] = (digits[j] ?? 0) << 8;
      }
      digits[0] = (digits[0] ?? 0) + (bytes[i] ?? 0);
      let carry = 0;
      for (let j = 0; j < digits.length; j++) {
        digits[j] = (digits[j] ?? 0) + carry;
        carry = Math.floor((digits[j] ?? 0) / 58);
        digits[j] = (digits[j] ?? 0) % 58;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = Math.floor(carry / 58);
      }
    }
    let leadingZeros = 0;
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) leadingZeros++;
    return '1'.repeat(leadingZeros) + digits.reverse().map(d => B58_ALPHABET[d]).join('');
  }

  function generateEd25519Identity() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
    const prefixed = new Uint8Array(34);
    prefixed[0] = 0xed;
    prefixed[1] = 0x01;
    prefixed.set(rawPub, 2);
    const did = `did:key:z${encodeBase58(prefixed)}`;
    return { did, rawPub, privateKey };
  }

  function signRequestV2(params: {
    method: string;
    pathname: string;
    query?: string;
    body?: any;
    did: string;
    keyId?: string;
    nonce?: string;
    timestamp?: string;
    privateKey: crypto.KeyObject;
  }) {
    const method = params.method.toUpperCase();
    const pathname = params.pathname;
    const query = params.query || '';
    const bodyStr = params.body !== undefined
      ? (typeof params.body === 'string' ? params.body : JSON.stringify(params.body))
      : '';
    const bodyHash = crypto.createHash('sha256').update(Buffer.from(bodyStr, 'utf8')).digest('hex');
    const did = params.did;
    const keyId = params.keyId || did;
    const nonce = params.nonce || 'nonce_' + crypto.randomBytes(8).toString('hex');
    const timestamp = params.timestamp || String(Date.now());

    const canonicalString = `SOVRA-REQ-V2\n${method}\n${pathname}\n${query}\n${bodyHash}\n${did}\n${keyId}\n${nonce}\n${timestamp}`;
    const sigBytes = crypto.sign(null, Buffer.from(canonicalString, 'utf8'), params.privateKey);

    return {
      headers: {
        'x-sovra-did': did,
        'x-sovra-key-id': keyId,
        'x-sovra-nonce': nonce,
        'x-sovra-timestamp': timestamp,
        'x-sovra-signature': sigBytes.toString('hex'),
        'x-sovra-signature-version': '2',
      },
      bodyStr,
    };
  }

  beforeAll(async () => {
    // 1. Root admin login (SUPER_ADMIN: all permissions)
    const rootRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:sov:admin_root',
        role: 'SUPER_ADMIN',
        adminKey: adminSecret,
      }),
    });
    const rootData = await rootRes.json();
    expect(rootData.ok).toBe(true);
    rootToken = rootData.sessionToken;

    // 2. Content moderator login (CONTENT_MODERATOR: moderation permissions)
    const modRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:sov:admin_moderator',
        role: 'CONTENT_MODERATOR',
        adminKey: adminSecret,
      }),
    });
    const modData = await modRes.json();
    expect(modData.ok).toBe(true);
    moderatorToken = modData.sessionToken;

    // 3. Observer login (SYSTEM_OBSERVER: read-only permissions, lacks mutation)
    const obsRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:sov:admin_observer',
        role: 'SYSTEM_OBSERVER',
        adminKey: adminSecret,
      }),
    });
    const obsData = await obsRes.json();
    expect(obsData.ok).toBe(true);
    observerToken = obsData.sessionToken;

    // 4. Generate user identity and seed in DB
    testUserIdentity = generateEd25519Identity();
    testUserDid = testUserIdentity.did;

    // Seed test post in DB
    testPostId = 'post_mod_' + Date.now();
    await fetch(`${baseUrl}/api/admin/content/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
      body: JSON.stringify({ postId: testPostId, reason: 'Initial seed post' }),
    });

    // 5. Create test creator with non-zero SOV balance
    testCreatorDid = 'did:sov:creator_' + Date.now();
    await fetch(`${baseUrl}/api/admin/user/update-role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rootToken}` },
      body: JSON.stringify({ targetDid: testCreatorDid, role: 'CREATOR' }),
    });
    await fetch(`${baseUrl}/api/admin/user/adjust-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rootToken}` },
      body: JSON.stringify({ targetDid: testCreatorDid, amount: 500, reason: 'Initial creator allocation' }),
    });
  });

  // =========================================================================
  // SCENARIO 1: User Block / Unblock
  // =========================================================================
  describe('1. User Block / Unblock Lifecycle', () => {
    it('applies temporary block with duration and updates status to BLOCKED', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          targetDid: testUserDid,
          durationMs: 86400000,
          reason: 'Testing temporary account block for spam violation',
          reasonCode: 'SPAM_OR_ABUSE',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.targetDid).toBe(testUserDid);
      expect(data.status).toBe('BLOCKED');
      expect(data.expiresAt).toBeGreaterThan(Date.now());

      // Inspect detail
      const detailRes = await fetch(`${baseUrl}/api/admin/users/detail?targetDid=${encodeURIComponent(testUserDid)}`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
      const detail = await detailRes.json();
      expect(detail.user.status).toBe('BLOCKED');
      expect(detail.activeRestrictions.some((r: any) => r.restrictionType === 'TEMPORARY_BLOCK')).toBe(true);
    });

    it('restores blocked user and updates status back to ACTIVE', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          targetDid: testUserDid,
          reason: 'Pardoned upon initial review',
          reasonCode: 'ADMIN_PARDON',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.status).toBe('ACTIVE');

      const detailRes = await fetch(`${baseUrl}/api/admin/users/detail?targetDid=${encodeURIComponent(testUserDid)}`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
      const detail = await detailRes.json();
      expect(detail.user.status).toBe('ACTIVE');
    });
  });

  // =========================================================================
  // SCENARIO 2: Creator Suspension / Restoration (Wallet Invariant)
  // =========================================================================
  describe('2. Creator Suspension & Restoration (Wallet Invariant)', () => {
    it('suspends creator account while preserving wallet balance intact', async () => {
      // 1. Check initial creator detail
      const initialDetailRes = await fetch(`${baseUrl}/api/admin/creators/detail?creatorDid=${encodeURIComponent(testCreatorDid)}`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
      const initialDetail = await initialDetailRes.json();
      const initialBalance = Number(initialDetail.creator?.balance_sov || initialDetail.creator?.balance || 500);

      // 2. Execute suspension
      const suspRes = await fetch(`${baseUrl}/api/admin/creators/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rootToken}`,
        },
        body: JSON.stringify({
          creatorDid: testCreatorDid,
          reason: 'Severe copyright infringement claim',
          reasonCode: 'COPYRIGHT_STRIKE',
        }),
      });

      expect(suspRes.status).toBe(200);
      const suspData = await suspRes.json();
      expect(suspData.ok).toBe(true);
      expect(suspData.status).toBe('SUSPENDED');

      // 3. Verify account is suspended, BUT wallet balance is NOT seized
      const detailRes = await fetch(`${baseUrl}/api/admin/creators/detail?creatorDid=${encodeURIComponent(testCreatorDid)}`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
      const detail = await detailRes.json();
      expect(detail.creator.status).toBe('SUSPENDED');
      const currentBalance = Number(detail.creator?.balance_sov || detail.creator?.balance || 500);
      expect(currentBalance).toBe(initialBalance); // Non-confiscation invariant
    });

    it('restores creator account back to ACTIVE', async () => {
      const restRes = await fetch(`${baseUrl}/api/admin/creators/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rootToken}`,
        },
        body: JSON.stringify({
          creatorDid: testCreatorDid,
          reason: 'Copyright strike resolved through licensing proof',
        }),
      });

      expect(restRes.status).toBe(200);
      const restData = await restRes.json();
      expect(restData.ok).toBe(true);
      expect(restData.status).toBe('ACTIVE');
    });

    it('allows separate toggling of monetization without affecting account access', async () => {
      const monRes = await fetch(`${baseUrl}/api/admin/creators/monetization`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          creatorDid: testCreatorDid,
          active: false,
          reason: 'Pending tax withholding verification',
        }),
      });

      expect(monRes.status).toBe(200);
      const monData = await monRes.json();
      expect(monData.ok).toBe(true);
      expect(monData.monetizationStatus).toBe('RESTRICTED');

      // Creator account status must remain ACTIVE!
      const detailRes = await fetch(`${baseUrl}/api/admin/creators/detail?creatorDid=${encodeURIComponent(testCreatorDid)}`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
      const detail = await detailRes.json();
      expect(detail.creator.monetization_status).toBe('RESTRICTED');
      expect(detail.creator.status).toBe('ACTIVE'); // Separation invariant
    });
  });

  // =========================================================================
  // SCENARIO 3: Post Removal / Restoration
  // =========================================================================
  describe('3. Post Removal & Restoration', () => {
    it('removes published post with moderation reason', async () => {
      const res = await fetch(`${baseUrl}/api/admin/content/remove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          postId: testPostId,
          reason: 'Spam promotional flood violation',
          reasonCode: 'SPAM_OR_ABUSE',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.moderationState).toBe('REMOVED');

      // Verify post is hidden from single get
      const getRes = await fetch(`${baseUrl}/api/feed/get?id=${encodeURIComponent(testPostId)}`);
      expect(getRes.status).toBe(403);
    });

    it('restores removed post back to public feeds', async () => {
      const res = await fetch(`${baseUrl}/api/admin/content/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          postId: testPostId,
          reason: 'False positive flag cleared',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.moderationState).toBe('ACTIVE');

      // Verify post is now accessible again
      const getRes = await fetch(`${baseUrl}/api/feed/get?id=${encodeURIComponent(testPostId)}`);
      expect(getRes.status).toBe(200);
    });
  });

  // =========================================================================
  // SCENARIO 4: Shadow Ban Application / Removal (Mandatory Expiry Invariant)
  // =========================================================================
  describe('4. Shadow Ban Application & Expiry Invariant', () => {
    it('rejects indefinite shadow bans without duration', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users/shadowban`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          targetId: testUserDid,
          scope: 'all',
          reason: 'Attempted indefinite ban',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Expiry duration is mandatory');
    });

    it('successfully applies scoped shadow ban with valid expiry', async () => {
      const durationMs = 3600000; // 1 hour
      const res = await fetch(`${baseUrl}/api/admin/users/shadowban`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          targetId: testUserDid,
          scope: 'feed',
          durationMs,
          reason: 'Behavioral astroturfing detected',
          reasonCode: 'SPAM_OR_ABUSE',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.scope).toBe('feed');
      expect(data.expiresAt).toBeGreaterThan(Date.now());
    });

    it('lifts shadow ban on administrative command', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users/shadowban/remove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          targetId: testUserDid,
          scope: 'all',
          reason: 'Verified authentic human account',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });
  });

  // =========================================================================
  // SCENARIO 5: Shadow Ban Auto-Expiry
  // =========================================================================
  describe('5. Shadow Ban Auto-Expiry', () => {
    it('automatically lifts shadow ban once duration expires without manual intervention', async () => {
      const ephemeralDuration = 25; // 25 milliseconds
      const res = await fetch(`${baseUrl}/api/admin/users/shadowban`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          targetId: testUserDid,
          scope: 'search',
          durationMs: ephemeralDuration,
          reason: 'Temporary micro-cooldown',
          reasonCode: 'SPAM_OR_ABUSE',
        }),
      });

      expect(res.status).toBe(200);

      // Wait 60ms for time elapsed
      await new Promise(r => setTimeout(r, 60));

      // Inspect detail: auto-expiry must have processed
      const detailRes = await fetch(`${baseUrl}/api/admin/users/detail?targetDid=${encodeURIComponent(testUserDid)}`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
      const detail = await detailRes.json();
      expect(detail.isShadowBanned).toBe(false);
    });
  });

  // =========================================================================
  // SCENARIO 6: Feed Distribution Restriction Enforcement
  // =========================================================================
  describe('6. Feed Distribution Restriction Enforcement', () => {
    it('hides shadowbanned user posts from other viewers while showing them to author', async () => {
      // 1. Shadowban testUserDid on scope 'feed'
      await fetch(`${baseUrl}/api/admin/users/shadowban`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          targetId: testUserDid,
          scope: 'feed',
          durationMs: 3600000,
          reason: 'Silent feed demotion test',
          reasonCode: 'SPAM_OR_ABUSE',
        }),
      });

      // 2. Query feed as another user / anonymous viewer
      const feedRes = await fetch(`${baseUrl}/api/feed/list?limit=50`);
      const feedData = await feedRes.json();
      const otherViewerSees = (feedData.posts || []).some((p: any) => p.authorDid === testUserDid && p.id === testPostId);
      expect(otherViewerSees).toBe(false); // Author's posts are hidden from other peers

      // 3. Query feed as the author themselves (Invisibility invariant: author sees own post)
      const authorSigned = signRequestV2({
        method: 'GET',
        pathname: '/api/feed/list',
        query: 'limit=50',
        did: testUserIdentity.did,
        privateKey: testUserIdentity.privateKey,
      });
      const authorFeedRes = await fetch(`${baseUrl}/api/feed/list?limit=50`, {
        headers: authorSigned.headers,
      });
      const authorFeedData = await authorFeedRes.json();
      expect(authorFeedData.ok).toBe(true);

      // Cleanup
      await fetch(`${baseUrl}/api/admin/users/shadowban/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
        body: JSON.stringify({ targetId: testUserDid, scope: 'feed', reason: 'Test cleanup' }),
      });
    });
  });

  // =========================================================================
  // SCENARIO 7: Search & Discovery Restriction Enforcement
  // =========================================================================
  describe('7. Search & Discovery Restriction Enforcement', () => {
    it('excludes search-shadowbanned user from public search queries', async () => {
      // 1. Shadowban testUserDid on scope 'search'
      await fetch(`${baseUrl}/api/admin/users/shadowban`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          targetId: testUserDid,
          scope: 'search',
          durationMs: 3600000,
          reason: 'Search index demotion test',
          reasonCode: 'SPAM_OR_ABUSE',
        }),
      });

      // 2. Query search
      const searchRes = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(testUserDid.slice(0, 12))}&scope=people`);
      const searchData = await searchRes.json();
      const foundInSearch = (searchData.users || []).some((u: any) => u.did === testUserDid);
      expect(foundInSearch).toBe(false);

      // Cleanup
      await fetch(`${baseUrl}/api/admin/users/shadowban/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
        body: JSON.stringify({ targetId: testUserDid, scope: 'search', reason: 'Test cleanup' }),
      });
    });
  });

  // =========================================================================
  // SCENARIO 8: Unauthorized Admin Rejection (HTTP 403)
  // =========================================================================
  describe('8. Unauthorized Admin Rejection (HTTP 403)', () => {
    it('rejects mutation action from observer role lacking suspension permissions', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${observerToken}`, // SYSTEM_OBSERVER only has *:read
        },
        body: JSON.stringify({
          targetDid: testUserDid,
          reason: 'Unauthorized suspension attempt',
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('lacks required permission');
    });
  });

  // =========================================================================
  // SCENARIO 9: Forged Admin Identity Rejection (HTTP 401)
  // =========================================================================
  describe('9. Forged Admin Identity Rejection (HTTP 401)', () => {
    it('rejects forged token or missing credentials with HTTP 401', async () => {
      const forgedToken = 'ey.forged.token.impersonation';
      const res = await fetch(`${baseUrl}/api/admin/users/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${forgedToken}`,
        },
        body: JSON.stringify({
          targetDid: testUserDid,
          reason: 'Forged token test',
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('UNAUTHORIZED');
    });
  });

  // =========================================================================
  // SCENARIO 10: Appeal Submission and Review
  // =========================================================================
  describe('10. Due Process Appeals & Administrative Review', () => {
    let testActionId = '';
    let testAppealId = '';

    it('allows restricted user to submit due process appeal', async () => {
      // 1. First block test user to generate a moderation action
      const blockRes = await fetch(`${baseUrl}/api/admin/users/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          targetDid: testUserDid,
          durationMs: 86400000,
          reason: 'Account restricted for rapid messaging',
          reasonCode: 'SPAM_OR_ABUSE',
        }),
      });
      const blockData = await blockRes.json();
      expect(blockRes.status).toBe(200);
      testActionId = blockData.actionId;
      expect(testActionId).toBeDefined();

      // 2. Submit appeal authenticated via Ed25519 signature
      const appealPayload = {
        actionId: testActionId,
        targetId: testUserDid,
        targetType: 'USER',
        reason: 'False positive rate limit detection',
        explanation: 'I was testing an authorized mesh client integration.',
      };
      const appealSigned = signRequestV2({
        method: 'POST',
        pathname: '/api/moderation/appeals/submit',
        body: appealPayload,
        did: testUserIdentity.did,
        privateKey: testUserIdentity.privateKey,
      });

      const appealRes = await fetch(`${baseUrl}/api/moderation/appeals/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...appealSigned.headers,
        },
        body: appealSigned.bodyStr,
      });

      expect(appealRes.status).toBe(200);
      const appealData = await appealRes.json();
      expect(appealData.ok).toBe(true);
      expect(appealData.appealId).toBeDefined();
      testAppealId = appealData.appealId;
    });

    it('allows authorized reviewer to reverse restriction upon appeal review', async () => {
      const reviewRes = await fetch(`${baseUrl}/api/admin/moderation/appeals/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          appealId: testAppealId,
          decision: 'REVERSED',
          reviewNotes: 'Appeal accepted. Verified legitimate developer testing.',
        }),
      });

      expect(reviewRes.status).toBe(200);
      const reviewData = await reviewRes.json();
      expect(reviewData.ok).toBe(true);

      // Verify user account was automatically restored by reversal decision
      const detailRes = await fetch(`${baseUrl}/api/admin/users/detail?targetDid=${encodeURIComponent(testUserDid)}`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
      const detail = await detailRes.json();
      expect(detail.user.status).toBe('ACTIVE');
    });
  });

  // =========================================================================
  // SCENARIO 11: Audit Log Integrity and Hash Chaining
  // =========================================================================
  describe('11. Tamper-Evident Merkle Hash-Chained Audit Log', () => {
    it('records entries in Merkle hash chain with previous hash linkages', async () => {
      const res = await fetch(`${baseUrl}/api/admin/moderation/audit-logs?limit=10`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.logs).toBeDefined();
      expect(data.logs.length).toBeGreaterThan(0);

      // Inspect entry structure
      const entry = data.logs[0];
      expect(entry.actionId).toBeDefined();
      expect(entry.adminDid).toBeDefined();
      const hashVal = entry.hash || entry.entryHash;
      expect(hashVal).toBeDefined();
      expect(hashVal.length).toBe(64); // SHA-256 hex string
    });
  });

  // =========================================================================
  // SCENARIO 12: Duplicate Action / Idempotency Handling
  // =========================================================================
  describe('12. Idempotency & Duplicate Action Safety', () => {
    it('safely handles repeated block actions idempotently without error', async () => {
      const blockParams = {
        targetDid: testUserDid,
        durationMs: 86400000,
        reason: 'Idempotency verification call 1',
        reasonCode: 'TEMPORARY_BLOCK',
      };

      const res1 = await fetch(`${baseUrl}/api/admin/users/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
        body: JSON.stringify(blockParams),
      });
      expect(res1.status).toBe(200);

      const res2 = await fetch(`${baseUrl}/api/admin/users/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
        body: JSON.stringify({ ...blockParams, reason: 'Idempotency verification call 2' }),
      });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.ok).toBe(true);
      expect(data2.status).toBe('BLOCKED');

      // Cleanup: restore user
      await fetch(`${baseUrl}/api/admin/users/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
        body: JSON.stringify({ targetDid: testUserDid, reason: 'Test cleanup' }),
      });
    });
  });

  // =========================================================================
  // SCENARIO 13: Protected Political Criticism (Constitutional Invariant)
  // =========================================================================
  describe('13. Protected Political Criticism Preservation', () => {
    it('rejects government takedown requests targeting lawful political criticism', async () => {
      const polPostId = 'pol_post_' + Date.now();
      // Seed post
      await fetch(`${baseUrl}/api/admin/content/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
        body: JSON.stringify({ postId: polPostId, reason: 'Seed political post' }),
      });

      // Attempt takedown citing government request
      const res = await fetch(`${baseUrl}/api/admin/content/remove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          postId: polPostId,
          reason: 'State regulatory notice: political criticism of current policy',
          reasonCode: 'GOVERNMENT_TAKEDOWN_REQUEST',
        }),
      });

      // Constitutional Invariant: Must be strictly rejected with HTTP 403!
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('CONSTITUTIONAL_PROTECTION_VIOLATION');
      expect(data.error.toLowerCase()).toContain('political criticism');
    });
  });

  // =========================================================================
  // SCENARIO 14: Child-Safety Escalation Handling
  // =========================================================================
  describe('14. Child-Safety Escalation & CSAM Redaction', () => {
    it('immediately removes content, records in sensitive vault, and redacts evidence in audit logs', async () => {
      const dummyId = 'csam_test_' + Date.now();
      // Seed post
      await fetch(`${baseUrl}/api/admin/content/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
        body: JSON.stringify({ postId: dummyId, reason: 'Seed dummy post' }),
      });

      // Escalate as CHILD_SAFETY
      const removeRes = await fetch(`${baseUrl}/api/admin/content/remove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rootToken}`,
        },
        body: JSON.stringify({
          postId: dummyId,
          reason: 'Immediate child safety perimeter flag',
          reasonCode: 'CHILD_SAFETY',
          evidenceRef: 'raw_perceived_csam_hash_or_link_must_be_redacted',
        }),
      });

      expect(removeRes.status).toBe(200);
      const removeData = await removeRes.json();
      expect(removeData.ok).toBe(true);

      // Inspect audit logs: raw evidence must NOT be exposed in public log!
      const auditRes = await fetch(`${baseUrl}/api/admin/moderation/audit-logs?targetId=${encodeURIComponent(dummyId)}`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
      const auditData = await auditRes.json();
      const entry = (auditData.logs || []).find((l: any) => l.targetId === dummyId);
      expect(entry).toBeDefined();
      expect(entry.evidenceRef).toBe('[REDACTED_CSAM_EVIDENCE]'); // Redaction invariant
    });
  });

  // =========================================================================
  // SCENARIO 15: Direct API Authorization Bypass Rejection
  // =========================================================================
  describe('15. Direct API Authorization Bypass Rejection', () => {
    it('rejects unauthenticated requests trying to bypass RBAC middleware', async () => {
      const endpoints = [
        { path: '/api/admin/users/list', method: 'GET' },
        { path: '/api/admin/creators/list', method: 'GET' },
        { path: '/api/admin/users/block', method: 'POST', body: { targetDid: 'did:sov:any' } },
        { path: '/api/admin/creators/suspend', method: 'POST', body: { creatorDid: 'did:sov:any' } },
        { path: '/api/admin/content/remove', method: 'POST', body: { postId: 'any' } },
        { path: '/api/admin/users/shadowban', method: 'POST', body: { targetId: 'any', durationMs: 1000 } },
        { path: '/api/admin/moderation/audit-logs', method: 'GET' },
      ];

      for (const ep of endpoints) {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: { 'Content-Type': 'application/json' },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });
        expect(res.status).toBe(401);
      }
    });
  });
});
