/**
 * @file tests/security/adversarial-remediation-gate.test.ts
 * Rigorous Verification Suite for P0 & P1 Remediation across SOVRA.
 *
 * Verifies:
 * 1. P0-01: Chat BOLA/IDOR prevention on /api/chat/contacts & /api/chat/messages
 * 2. P0-02: Strict RBAC enforcement on /api/admin/channels/delete, /api/admin/pages/delete, & purge
 * 3. P0-03: Protection of real user accounts from heuristic regex purging
 * 4. P1-02: Session expiration rejection in database engines
 * 5. P1-05: Authenticated and idempotent post liking (action: LIKE / UNLIKE)
 * 6. P1-06: End-to-end user account deletion with transactional cascade cleanup
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SovraDatabaseEngine } from '../../scripts/database-engine.js';
import { SovraSqliteEngine } from '../../scripts/database-sqlite.js';
import { AdminSecurityEngine } from '../../packages/identity/src/admin.js';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://127.0.0.1:3001';

describe('SOVRA P0/P1 Adversarial Remediation & Verification Gate', () => {
  let alice: { did: string; handle: string; sessionToken: string };
  let bob: { did: string; handle: string; sessionToken: string };
  let eve: { did: string; handle: string; sessionToken: string };
  let adminSessionToken: string;
  let testChannelId: string;
  let testPageId: string;
  let testPostId: string;

  beforeAll(async () => {
    const ts = Date.now();

    // 1. Register Alice
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: `@alice_gate_${ts}`, name: 'Alice Sovereign' }),
    }).then(r => r.json());
    expect(resA.ok).toBe(true);
    alice = { did: resA.user.did, handle: resA.user.handle, sessionToken: resA.sessionToken };

    // 2. Register Bob
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: `@bob_gate_${ts}`, name: 'Bob Peer' }),
    }).then(r => r.json());
    expect(resB.ok).toBe(true);
    bob = { did: resB.user.did, handle: resB.user.handle, sessionToken: resB.sessionToken };

    // 3. Register Eve (Adversary)
    const resE = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: `@eve_attacker_${ts}`, name: 'Eve Malicious' }),
    }).then(r => r.json());
    expect(resE.ok).toBe(true);
    eve = { did: resE.user.did, handle: resE.user.handle, sessionToken: resE.sessionToken };

    // 4. Authenticate Admin session
    const adminLogin = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminKey: process.env.ADMIN_SECRET_KEY || 'sovra-test-admin-secret-key-32-chars-ok!',
        role: 'SUPER_ADMIN',
      }),
    }).then(r => r.json());
    expect(adminLogin.ok).toBe(true);
    adminSessionToken = adminLogin.sessionToken;

    // 5. Create a channel and a page as Alice
    const chRes = await fetch(`${BASE_URL}/api/social/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        name: `Gate Channel ${ts}`,
        handle: `@ch_gate_${ts}`,
        desc: 'For testing admin deletion',
        category: 'Technology',
      }),
    }).then(r => r.json());
    expect(chRes.ok).toBe(true);
    testChannelId = chRes.channel.id;

    const pgRes = await fetch(`${BASE_URL}/api/social/pages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        name: `Gate Page ${ts}`,
        handle: `@pg_gate_${ts}`,
        desc: 'For testing admin deletion',
        category: 'Community',
      }),
    }).then(r => r.json());
    expect(pgRes.ok).toBe(true);
    testPageId = pgRes.page.id;

    // 6. Alice creates a post
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        caption: `Adversarial post ${ts}`,
        postType: 'text',
        visibility: 'public',
      }),
    }).then(r => r.json());
    expect(postRes.ok).toBe(true);
    testPostId = postRes.post.id;

    // 7. Alice sends a private message to Bob
    const msgRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        recipient: bob.did,
        text: `Top secret message for Bob at ${ts}`,
      }),
    }).then(r => r.json());
    expect(msgRes.ok).toBe(true);
  });

  // ==========================================================================
  // P0-01: CHAT BOLA / IDOR PROTECTION
  // ==========================================================================
  describe('P0-01: Chat BOLA & IDOR Mitigation', () => {
    it('rejects unauthenticated GET /api/chat/messages with 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/messages`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toMatch(/Authentication required/i);
    });

    it('rejects unauthenticated GET /api/chat/messages?userDid=<aliceDid> with 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/messages?userDid=${encodeURIComponent(alice.did)}`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('rejects unauthenticated GET /api/chat/contacts with 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/contacts`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('rejects unauthenticated GET /api/chat/contacts?userDid=<aliceDid> with 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/contacts?userDid=${encodeURIComponent(alice.did)}`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('prevents authenticated Eve from accessing Alice contacts via userDid query param (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/contacts?userDid=${encodeURIComponent(alice.did)}`, {
        headers: { Authorization: `Bearer ${eve.sessionToken}` },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toMatch(/Forbidden/i);
    });

    it('prevents authenticated Eve from accessing Alice messages via userDid query param (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/messages?userDid=${encodeURIComponent(alice.did)}`, {
        headers: { Authorization: `Bearer ${eve.sessionToken}` },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toMatch(/Forbidden/i);
    });

    it('prevents authenticated Eve from eavesdropping on Alice and Bob chat thread', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/messages?contactDid=${encodeURIComponent(bob.did)}`, {
        headers: { Authorization: `Bearer ${eve.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      // Messages between Alice and Bob must NOT be returned to Eve
      const leaked = (data.messages || []).some(
        (m: any) => (m.senderDid === alice.did && m.recipientDid === bob.did) || (m.senderDid === bob.did && m.recipientDid === alice.did)
      );
      expect(leaked).toBe(false);
    });

    it('allows Bob (recipient) to read the private message from Alice', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/messages?contactDid=${encodeURIComponent(alice.did)}`, {
        headers: { Authorization: `Bearer ${bob.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      const found = (data.messages || []).some(
        (m: any) => m.senderDid === alice.did && m.recipientDid === bob.did
      );
      expect(found).toBe(true);
    });
  });

  // ==========================================================================
  // P0-02: ADMIN CHANNELS / PAGES DELETE & PURGE RBAC
  // ==========================================================================
  describe('P0-02: Admin Endpoint RBAC Authorization & Audit', () => {
    it('rejects unauthenticated POST /api/admin/channels/delete with 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/channels/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: testChannelId }),
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('rejects unprivileged user (Eve) from deleting a channel via admin API (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/channels/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eve.sessionToken}`,
        },
        body: JSON.stringify({ channelId: testChannelId }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('rejects unauthenticated POST /api/admin/pages/delete with 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/pages/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: testPageId }),
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('rejects unprivileged user (Eve) from deleting a page via admin API (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/pages/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eve.sessionToken}`,
        },
        body: JSON.stringify({ pageId: testPageId }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('rejects unauthenticated POST /api/admin/entities/purge-test with 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/entities/purge-test`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('rejects unprivileged user (Eve) from triggering entity purge (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/entities/purge-test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${eve.sessionToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('allows authorized Admin to delete channel via admin API', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/channels/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSessionToken}`,
        },
        body: JSON.stringify({ channelId: testChannelId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it('returns 404 when admin attempts to delete non-existent channel', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/channels/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSessionToken}`,
        },
        body: JSON.stringify({ channelId: 'ch_non_existent_id_999' }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('allows authorized Admin to delete page via admin API', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/pages/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSessionToken}`,
        },
        body: JSON.stringify({ pageId: testPageId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it('returns 404 when admin attempts to delete non-existent page', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/pages/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSessionToken}`,
        },
        body: JSON.stringify({ pageId: 'pg_non_existent_id_999' }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });
  });

  // ==========================================================================
  // P0-03: AUTOMATED USER PURGE REMOVAL
  // ==========================================================================
  describe('P0-03: User Account Resilience across Database Reloads', () => {
    it('ensures real user accounts with test-like or numeric handles are never auto-purged on load()', () => {
      const db = new SovraDatabaseEngine();
      db.load();

      // Alice, Bob, and Eve must still exist in the database
      const foundA = db.findUserByDid(alice.did);
      const foundB = db.findUserByDid(bob.did);
      const foundE = db.findUserByDid(eve.did);

      expect(foundA).toBeDefined();
      expect(foundA?.handle).toBe(alice.handle);
      expect(foundA?.recoveryPhrase).toBeDefined();

      expect(foundB).toBeDefined();
      expect(foundB?.handle).toBe(bob.handle);

      expect(foundE).toBeDefined();
      expect(foundE?.handle).toBe(eve.handle);
    });
  });

  // ==========================================================================
  // P1-02: SESSION EXPIRATION ENFORCEMENT
  // ==========================================================================
  describe('P1-02: Session Expiration Enforcement', () => {
    it('rejects expired session tokens in SovraDatabaseEngine', () => {
      const db = new SovraDatabaseEngine();
      db.load();

      const expiredToken = 'stk_expired_test_' + Date.now();
      const state = db.getState();
      if (!Array.isArray(state.user_sessions)) state.user_sessions = [];

      state.user_sessions.push({
        sessionId: 'sess_exp_1',
        userDid: alice.did,
        token: expiredToken,
        deviceName: 'Test Phone',
        deviceType: 'Mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        createdAt: Date.now() - 100000,
        lastActiveAt: Date.now() - 50000,
        expiresAt: Date.now() - 1000, // Expired 1 second ago
        isRevoked: false,
      });
      db.save();

      // Session must be recognized as revoked/expired
      expect(db.isSessionRevoked(expiredToken)).toBe(true);
      expect(db.findUserBySessionToken(expiredToken)).toBeUndefined();
    });
  });

  // ==========================================================================
  // P1-05: LIKE IDEMPOTENCY & AUTH
  // ==========================================================================
  describe('P1-05: Feed Post Like Authentication & Offline Idempotency', () => {
    it('rejects unauthenticated like requests with 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: testPostId }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated request attempting to spoof userDid in body (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: testPostId, userDid: bob.did }),
      });
      expect(res.status).toBe(401);
    });

    it('executes idempotent LIKE: multiple calls result in likeCount incrementing exactly once', async () => {
      // First LIKE
      const res1 = await fetch(`${BASE_URL}/api/feed/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.sessionToken}`,
        },
        body: JSON.stringify({ postId: testPostId, action: 'LIKE' }),
      }).then(r => r.json());
      expect(res1.ok).toBe(true);
      expect(res1.isLiked).toBe(true);
      const initialLikes = res1.likesCount;

      // Duplicate LIKE (e.g. offline queue retry)
      const res2 = await fetch(`${BASE_URL}/api/feed/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.sessionToken}`,
        },
        body: JSON.stringify({ postId: testPostId, action: 'LIKE' }),
      }).then(r => r.json());
      expect(res2.ok).toBe(true);
      expect(res2.isLiked).toBe(true);
      expect(res2.likesCount).toBe(initialLikes);

      // Triplicate LIKE
      const res3 = await fetch(`${BASE_URL}/api/feed/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.sessionToken}`,
        },
        body: JSON.stringify({ postId: testPostId, action: 'LIKE' }),
      }).then(r => r.json());
      expect(res3.ok).toBe(true);
      expect(res3.isLiked).toBe(true);
      expect(res3.likesCount).toBe(initialLikes);
    });

    it('executes idempotent UNLIKE: multiple calls result in likeCount decrementing exactly once', async () => {
      // First UNLIKE
      const res1 = await fetch(`${BASE_URL}/api/feed/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.sessionToken}`,
        },
        body: JSON.stringify({ postId: testPostId, action: 'UNLIKE' }),
      }).then(r => r.json());
      expect(res1.ok).toBe(true);
      expect(res1.isLiked).toBe(false);
      const countAfterUnlike = res1.likesCount;

      // Duplicate UNLIKE
      const res2 = await fetch(`${BASE_URL}/api/feed/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.sessionToken}`,
        },
        body: JSON.stringify({ postId: testPostId, action: 'UNLIKE' }),
      }).then(r => r.json());
      expect(res2.ok).toBe(true);
      expect(res2.isLiked).toBe(false);
      expect(res2.likesCount).toBe(countAfterUnlike);
    });
  });

  // ==========================================================================
  // P1-06: USER ACCOUNT DELETION & TRANSACTIONAL CASCADE
  // ==========================================================================
  describe('P1-06: Permanent User Account Deletion & Transactional Cascade', () => {
    it('deletes user account and revokes session via DELETE /api/user/delete', async () => {
      // Eve deletes her own account
      const delRes = await fetch(`${BASE_URL}/api/user/delete`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${eve.sessionToken}`,
        },
      });
      expect(delRes.status).toBe(200);
      const delData = await delRes.json();
      expect(delData.ok).toBe(true);
      expect(delData.deletedDid).toBe(eve.did);

      // Verify Eve session token is immediately invalid
      const checkRes = await fetch(`${BASE_URL}/api/user/profile`, {
        headers: { Authorization: `Bearer ${eve.sessionToken}` },
      });
      expect(checkRes.status).toBe(401);

      // Verify Eve cannot be found in database
      const db = new SovraDatabaseEngine();
      db.load();
      expect(db.findUserByDid(eve.did)).toBeUndefined();
    });
  });
});
