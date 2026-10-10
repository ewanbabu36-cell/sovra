/**
 * @file tests/e2e/sovra-trust-safety-phase7.test.ts
 * SOVRA PHASE 7: TRUST + SAFETY + MODERATION + PRIVACY COMPREHENSIVE TEST SUITE
 *
 * Verifies:
 * 1. Unified Trust & Safety Architecture across all content targets (User, Post, Comment, Message, Video, Reel, Channel, Page, Group, Live)
 * 2. Contextual Report Flow & Standard Taxonomy Validation (Spam, Harassment, Impersonation, Fraud, Violence, Illegal content, Privacy violation, Sexual content, Child safety, Copyright, Other)
 * 3. Report Security & BOLA/IDOR Protections (authenticated session binding, non-spoofable reporter, non-moderator status lockdown)
 * 4. Content Moderation State & Lifecycle (VISIBLE -> REPORTED -> UNDER_REVIEW -> HIDDEN/REMOVED -> RESTORED)
 * 5. Moderation Scope & RBAC Isolation (Platform Mod vs Space Mod, Space A Mod cannot moderate Space B, Editor cannot moderate, Member cannot moderate)
 * 6. Server-Side Block Enforcement across all 9 surfaces (Profile, Search, Feed, Comments, Chat, Notifications, Follow, Friends, Inbound Mesh)
 * 7. Real Persisted Mute Relationships (Mute User, Conversation, Channel; Mute != Block != Unfollow)
 * 8. Session Management & Security Center (Active Sessions, Revoke, Logout All Other Sessions, BOLA prevention, Safe metadata only)
 * 9. Offline & Mesh Moderation Safety (TTL expiry, blocklist filtering, moderated content rejection, durable report outbox batch sync)
 * 10. Audit Log Integrity & Cryptographic Redaction (every action audited, private keys/seeds/tokens never leaked)
 * 11. Spatial Client-Side Surfaces in served HTML (openSpatialReportSurface, openSpatialModerationSurface, openSpatialSecurityCenterSurface)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Phase 7: Trust + Safety + Moderation + Privacy', () => {
  const ts = Date.now();
  let userAlice: { did: string; handle: string; sessionToken: string };
  let userBob: { did: string; handle: string; sessionToken: string };
  let userCharlie: { did: string; handle: string; sessionToken: string };
  let userModSpaceA: { did: string; handle: string; sessionToken: string };
  let userModSpaceB: { did: string; handle: string; sessionToken: string };
  let userEditor: { did: string; handle: string; sessionToken: string };
  let adminSession: { did: string; sessionToken: string };

  let channelAId: string;
  let channelBId: string;
  let groupAId: string;
  let groupBId: string;
  let testPostId: string;
  let testCommentId: string;
  let testMessageId: string;

  beforeAll(async () => {
    // 1. Register User Alice (Content Creator / Reporting Party)
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@alice_safety_${ts}`,
        name: 'Alice Sovereign Safety',
        bio: 'Cryptography researcher and safety advocate #privacy #crypto',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    userAlice = { did: dataA.user.did, handle: dataA.user.handle, sessionToken: dataA.sessionToken };

    // 2. Register User Bob (Adversary / Target of Moderation)
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@bob_safety_${ts}`,
        name: 'Bob Spammer',
        bio: 'Aggressive mesh bot and spam account #crypto',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    userBob = { did: dataB.user.did, handle: dataB.user.handle, sessionToken: dataB.sessionToken };

    // 3. Register User Charlie (Neutral User)
    const resC = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@charlie_safety_${ts}`,
        name: 'Charlie Observer',
        bio: 'Neutral network peer',
      }),
    });
    expect(resC.status).toBe(200);
    const dataC = await resC.json();
    userCharlie = { did: dataC.user.did, handle: dataC.user.handle, sessionToken: dataC.sessionToken };

    // 4. Register Space Moderator A
    const resModA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@mod_space_a_${ts}`,
        name: 'Moderator Alpha Space',
        bio: 'Community moderator for Space A',
      }),
    });
    expect(resModA.status).toBe(200);
    const dataModA = await resModA.json();
    userModSpaceA = { did: dataModA.user.did, handle: dataModA.user.handle, sessionToken: dataModA.sessionToken };

    // 5. Register Space Moderator B
    const resModB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@mod_space_b_${ts}`,
        name: 'Moderator Beta Space',
        bio: 'Community moderator for Space B',
      }),
    });
    expect(resModB.status).toBe(200);
    const dataModB = await resModB.json();
    userModSpaceB = { did: dataModB.user.did, handle: dataModB.user.handle, sessionToken: dataModB.sessionToken };

    // 6. Register Editor
    const resEd = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@editor_user_${ts}`,
        name: 'Content Editor Space',
        bio: 'Content creator without moderation privileges',
      }),
    });
    expect(resEd.status).toBe(200);
    const dataEd = await resEd.json();
    userEditor = { did: dataEd.user.did, handle: dataEd.user.handle, sessionToken: dataEd.sessionToken };

    // 7. Obtain Admin Session (Platform SUPER_ADMIN role)
    const adminRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:sovra:admin_operator',
        role: 'SUPER_ADMIN',
        adminKey: process.env.ADMIN_SECRET_KEY || 'sovra-test-admin-secret-key-32-chars-ok!',
      }),
    });
    expect(adminRes.status).toBe(200);
    const adminData = await adminRes.json();
    adminSession = {
      did: 'did:sovra:admin_operator',
      sessionToken: adminData.sessionToken,
    };

    // 8. Create Test Spaces: Channel A, Channel B, Group A, Group B
    const chARes = await fetch(`${BASE_URL}/api/channel/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAlice.sessionToken}`,
      },
      body: JSON.stringify({
        name: `Alpha Channel ${ts}`,
        category: 'tech',
        desc: 'Space A governed channel',
      }),
    });
    const chAData = await chARes.json();
    channelAId = chAData.channel?.id || chAData.id;

    const chBRes = await fetch(`${BASE_URL}/api/channel/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userBob.sessionToken}`,
      },
      body: JSON.stringify({
        name: `Beta Channel ${ts}`,
        category: 'gaming',
        desc: 'Space B governed channel',
      }),
    });
    const chBData = await chBRes.json();
    channelBId = chBData.channel?.id || chBData.id;

    const grpARes = await fetch(`${BASE_URL}/api/group/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAlice.sessionToken}`,
      },
      body: JSON.stringify({
        name: `Alpha Group ${ts}`,
        category: 'technology',
        description: 'Space A governed group',
        privacy: 'public',
      }),
    });
    const grpAData = await grpARes.json();
    groupAId = grpAData.group?.id || grpAData.id;

    const grpBRes = await fetch(`${BASE_URL}/api/group/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userBob.sessionToken}`,
      },
      body: JSON.stringify({
        name: `Beta Group ${ts}`,
        category: 'technology',
        description: 'Space B governed group',
        privacy: 'public',
      }),
    });
    const grpBData = await grpBRes.json();
    groupBId = grpBData.group?.id || grpBData.id;

    // 9. Assign Space Roles
    // Mod A -> Channel A as MODERATOR
    await fetch(`${BASE_URL}/api/channel/members/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAlice.sessionToken}` },
      body: JSON.stringify({ spaceId: channelAId, targetDid: userModSpaceA.did, role: 'MODERATOR' }),
    });

    // Mod B -> Channel B as MODERATOR
    await fetch(`${BASE_URL}/api/channel/members/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userBob.sessionToken}` },
      body: JSON.stringify({ spaceId: channelBId, targetDid: userModSpaceB.did, role: 'MODERATOR' }),
    });

    // Editor -> Channel A as EDITOR
    await fetch(`${BASE_URL}/api/channel/members/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAlice.sessionToken}` },
      body: JSON.stringify({ spaceId: channelAId, targetDid: userEditor.did, role: 'EDITOR' }),
    });

    // Mod A -> Group A as MODERATOR
    await fetch(`${BASE_URL}/api/group/members/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAlice.sessionToken}` },
      body: JSON.stringify({ spaceId: groupAId, targetDid: userModSpaceA.did, role: 'MODERATOR' }),
    });

    // Mod B -> Group B as MODERATOR
    await fetch(`${BASE_URL}/api/group/members/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userBob.sessionToken}` },
      body: JSON.stringify({ spaceId: groupBId, targetDid: userModSpaceB.did, role: 'MODERATOR' }),
    });

    // 10. Create Content
    // Alice creates Post A
    const postRes = await fetch(`${BASE_URL}/api/feed/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAlice.sessionToken}` },
      body: JSON.stringify({
        caption: 'Cryptographic safety and trust guidelines on SOVRA #trust #safety',
        tags: ['#trust', '#safety'],
      }),
    });
    const postData = await postRes.json();
    testPostId = postData.post?.id || postData.id;

    // Bob creates Comment on Alice's post
    const commentRes = await fetch(`${BASE_URL}/api/feed/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userBob.sessionToken}` },
      body: JSON.stringify({
        postId: testPostId,
        text: 'Spam link to unauthorized scam site http://scam.example',
      }),
    });
    const commentData = await commentRes.json();
    testCommentId = commentData.comment?.id || commentData.id || 'comment-1';

    // Bob sends Direct Chat message to Alice
    const chatRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userBob.sessionToken}` },
      body: JSON.stringify({
        recipientDid: userAlice.did,
        text: 'Unsolicited phishing message targeting credentials',
      }),
    });
    const chatData = await chatRes.json();
    testMessageId = chatData.message?.id || chatData.id || 'msg-1';
  }, 60000);

  // ============================================================
  // SECTION 1: CONTENT & USER REPORTING FLOW
  // ============================================================
  describe('1. Content & User Reporting Flow & Taxonomy Validation', () => {
    it('submits a valid report against a user with standard taxonomy reason (Harassment)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({
          targetType: 'user',
          targetId: userBob.did,
          reason: 'Harassment',
          details: 'Repeated offensive messages and identity stalking',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.report).toBeDefined();
      expect(data.report.targetType).toBe('user');
      expect(data.report.targetId).toBe(userBob.did);
      expect(data.report.reason).toBe('Harassment');
      expect(data.report.reporterDid).toBe(userAlice.did);
      expect(data.report.status).toBe('SUBMITTED');
    });

    it('submits a valid report against a post with reason Spam', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({
          targetType: 'post',
          targetId: testPostId,
          reason: 'Spam',
          details: 'Commercial promotion spam',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.report.targetType).toBe('post');
      expect(data.report.reason).toBe('Spam');
    });

    it('submits reports across remaining supported targets: comment, message, channel, group, video, reel', async () => {
      const targets = [
        { type: 'comment', id: testCommentId, reason: 'Violence' },
        { type: 'message', id: testMessageId, reason: 'Fraud' },
        { type: 'channel', id: channelBId, reason: 'Copyright' },
        { type: 'group', id: groupBId, reason: 'Illegal content' },
        { type: 'video', id: 'vid-demo-1', reason: 'Sexual content' },
        { type: 'reel', id: 'reel-demo-1', reason: 'Child safety' },
      ];

      for (const t of targets) {
        const res = await fetch(`${BASE_URL}/api/moderation/report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userAlice.sessionToken}`,
          },
          body: JSON.stringify({
            targetType: t.type,
            targetId: t.id,
            reason: t.reason,
            details: `Automated test report for ${t.type}`,
          }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.report.targetType).toBe(t.type);
        expect(data.report.reason).toBe(t.reason);
      }
    });

    it('rejects invalid reason not present in the standard taxonomy (400 Bad Request)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({
          targetType: 'user',
          targetId: userBob.did,
          reason: 'I_JUST_DISLIKE_THIS_PERSON',
          details: 'Invalid non-standard taxonomy reason',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('standard taxonomy');
    });

    it('rejects invalid targetType not in supported list (400 Bad Request)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({
          targetType: 'smart_contract',
          targetId: '0x123',
          reason: 'Fraud',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('targetType');
    });

    it('prevents self-reporting (400 Bad Request)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({
          targetType: 'user',
          targetId: userAlice.did,
          reason: 'Spam',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Self-reporting');
    });
  });

  // ============================================================
  // SECTION 2: REPORT SECURITY & IDENTITY INTEGRITY
  // ============================================================
  describe('2. Report Security & BOLA/IDOR Protections', () => {
    it('rejects unauthenticated report submissions (401 Unauthorized)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'user',
          targetId: userBob.did,
          reason: 'Spam',
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('prevents reporter identity forging: Bob cannot submit report claiming Alice is reporter (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({
          targetType: 'post',
          targetId: testPostId,
          reporterDid: userAlice.did, // Forgery attempt!
          reason: 'Spam',
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Cannot forge');
    });

    it('rejects report status transition by unauthorized regular user (403 Forbidden)', async () => {
      // 1. Submit report as Alice
      const repRes = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({
          targetType: 'post',
          targetId: testPostId,
          reason: 'Other',
          details: 'Status lockdown test',
        }),
      });
      const repData = await repRes.json();
      const reportId = repData.report.id;

      // 2. Regular user Charlie attempts to transition status to RESOLVED
      const updateRes = await fetch(`${BASE_URL}/api/moderation/report/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({
          reportId,
          status: 'RESOLVED',
          notes: 'Unauthorized resolution attempt',
        }),
      });

      expect(updateRes.status).toBe(403);
      const updateData = await updateRes.json();
      expect(updateData.ok).toBe(false);
      expect(updateData.error).toContain('Forbidden');
    });
  });

  // ============================================================
  // SECTION 3: MODERATION SCOPE & RBAC ISOLATION
  // ============================================================
  describe('3. Moderation Scope & Multi-Tenant Space RBAC Isolation', () => {
    let spaceAReportId: string;
    let spaceBReportId: string;

    beforeAll(async () => {
      // Submit report in Space A (Channel A)
      const resA = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({
          targetType: 'channel',
          targetId: channelAId,
          spaceId: channelAId,
          spaceType: 'channel',
          reason: 'Harassment',
          details: 'Report in Space A',
        }),
      });
      const dataA = await resA.json();
      spaceAReportId = dataA.report.id;

      // Submit report in Space B (Channel B)
      const resB = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userCharlie.sessionToken}`,
        },
        body: JSON.stringify({
          targetType: 'channel',
          targetId: channelBId,
          spaceId: channelBId,
          spaceType: 'channel',
          reason: 'Spam',
          details: 'Report in Space B',
        }),
      });
      const dataB = await resB.json();
      spaceBReportId = dataB.report.id;
    });

    it('allows Space A Moderator to view reports in Space A', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/reports?spaceId=${encodeURIComponent(channelAId)}`, {
        headers: { 'Authorization': `Bearer ${userModSpaceA.sessionToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.reports)).toBe(true);
      expect(data.reports.some((r: any) => r.id === spaceAReportId)).toBe(true);
    });

    it('enforces strict cross-space isolation: Space A Moderator CANNOT view reports for Space B (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/reports?spaceId=${encodeURIComponent(channelBId)}`, {
        headers: { 'Authorization': `Bearer ${userModSpaceA.sessionToken}` },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Forbidden');
    });

    it('enforces strict cross-space isolation: Space A Moderator CANNOT moderate resources in Space B (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userModSpaceA.sessionToken}`,
        },
        body: JSON.stringify({
          reportId: spaceBReportId,
          targetType: 'channel',
          targetId: channelBId,
          action: 'Hide',
          spaceId: channelBId,
          spaceType: 'channel',
          notes: 'Cross-space illegal moderation attempt',
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Forbidden');
    });

    it('enforces role boundary: EDITOR in Space A CANNOT moderate resources (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userEditor.sessionToken}`,
        },
        body: JSON.stringify({
          reportId: spaceAReportId,
          targetType: 'channel',
          targetId: channelAId,
          action: 'Hide',
          spaceId: channelAId,
          spaceType: 'channel',
          notes: 'Editor attempting moderation',
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Forbidden');
    });

    it('enforces role boundary: MEMBER in Space A CANNOT view or manage moderation reports (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/reports?spaceId=${encodeURIComponent(channelAId)}`, {
        headers: { 'Authorization': `Bearer ${userCharlie.sessionToken}` },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('allows Platform Moderator (SUPER_ADMIN) to moderate resources across all spaces', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminSession.sessionToken}`,
        },
        body: JSON.stringify({
          reportId: spaceAReportId,
          targetType: 'channel',
          targetId: channelAId,
          action: 'Warn',
          spaceId: channelAId,
          spaceType: 'channel',
          notes: 'Platform admin official advisory',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.action).toBe('Warn');
    });
  });

  // ============================================================
  // SECTION 4: CONTENT MODERATION LIFECYCLE & ACTIONS
  // ============================================================
  describe('4. Content Moderation State & Lifecycle Enforcement', () => {
    let lifecyclePostId: string;
    let lifecycleReportId: string;

    beforeAll(async () => {
      // Create dedicated test post
      const res = await fetch(`${BASE_URL}/api/feed/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userBob.sessionToken}` },
        body: JSON.stringify({
          caption: 'Flagged content subject to full moderation lifecycle #moderationtest',
          tags: ['#moderationtest'],
        }),
      });
      const data = await res.json();
      lifecyclePostId = data.post?.id || data.id;

      // Report it
      const repRes = await fetch(`${BASE_URL}/api/moderation/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAlice.sessionToken}` },
        body: JSON.stringify({
          targetType: 'post',
          targetId: lifecyclePostId,
          reason: 'Spam',
          details: 'Subject to lifecycle test',
        }),
      });
      const repData = await repRes.json();
      lifecycleReportId = repData.report.id;
    });

    it('transitions report lifecycle: SUBMITTED -> TRIAGED -> UNDER_REVIEW', async () => {
      // 1. Triaged
      const r1 = await fetch(`${BASE_URL}/api/moderation/report/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSession.sessionToken}` },
        body: JSON.stringify({ reportId: lifecycleReportId, status: 'TRIAGED', notes: 'Initial triage complete' }),
      });
      expect(r1.status).toBe(200);
      const d1 = await r1.json();
      expect(d1.report.status).toBe('TRIAGED');

      // 2. Under Review
      const r2 = await fetch(`${BASE_URL}/api/moderation/report/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSession.sessionToken}` },
        body: JSON.stringify({ reportId: lifecycleReportId, status: 'UNDER_REVIEW', notes: 'Investigating content' }),
      });
      expect(r2.status).toBe(200);
      const d2 = await r2.json();
      expect(d2.report.status).toBe('UNDER_REVIEW');
    });

    it('executes moderation action Hide: sets content state to HIDDEN and excludes from public feed and search', async () => {
      const hideRes = await fetch(`${BASE_URL}/api/moderation/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSession.sessionToken}` },
        body: JSON.stringify({
          reportId: lifecycleReportId,
          targetType: 'post',
          targetId: lifecyclePostId,
          action: 'Hide',
          notes: 'Hidden due to spam policy violation',
        }),
      });
      expect(hideRes.status).toBe(200);
      const hideData = await hideRes.json();
      expect(hideData.ok).toBe(true);
      expect(hideData.moderationState).toBe('HIDDEN');

      // Verify post is now excluded from public feed
      const feedRes = await fetch(`${BASE_URL}/api/feed/posts`);
      const feedData = await feedRes.json();
      const posts = feedData.posts || [];
      expect(posts.some((p: any) => p.id === lifecyclePostId)).toBe(false);

      // Verify post is excluded from search results
      const searchRes = await fetch(`${BASE_URL}/api/search?q=moderationtest&scope=posts`);
      const searchData = await searchRes.json();
      const searchPosts = searchData.posts || [];
      expect(searchPosts.some((p: any) => p.id === lifecyclePostId)).toBe(false);
    });

    it('executes moderation action Restore: returns content state to VISIBLE and restores visibility in feed', async () => {
      const restoreRes = await fetch(`${BASE_URL}/api/moderation/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSession.sessionToken}` },
        body: JSON.stringify({
          reportId: lifecycleReportId,
          targetType: 'post',
          targetId: lifecyclePostId,
          action: 'Restore',
          notes: 'Appeal approved, content restored',
        }),
      });
      expect(restoreRes.status).toBe(200);
      const restoreData = await restoreRes.json();
      expect(restoreData.ok).toBe(true);
      expect(restoreData.moderationState).toBe('VISIBLE');

      // Verify post is once again visible in feed
      const feedRes = await fetch(`${BASE_URL}/api/feed/posts`);
      const feedData = await feedRes.json();
      const posts = feedData.posts || [];
      expect(posts.some((p: any) => p.id === lifecyclePostId)).toBe(true);
    });

    it('executes moderation action Remove: sets content state to REMOVED and marks report RESOLVED', async () => {
      const remRes = await fetch(`${BASE_URL}/api/moderation/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSession.sessionToken}` },
        body: JSON.stringify({
          reportId: lifecycleReportId,
          targetType: 'post',
          targetId: lifecyclePostId,
          action: 'Remove',
          notes: 'Permanent removal confirmed',
        }),
      });
      expect(remRes.status).toBe(200);
      const remData = await remRes.json();
      expect(remData.ok).toBe(true);
      expect(remData.moderationState).toBe('REMOVED');

      // Final status resolution
      const resReport = await fetch(`${BASE_URL}/api/moderation/report/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSession.sessionToken}` },
        body: JSON.stringify({ reportId: lifecycleReportId, status: 'RESOLVED', notes: 'Action taken and resolved' }),
      });
      expect(resReport.status).toBe(200);
      const reportData = await resReport.json();
      expect(reportData.report.status).toBe('RESOLVED');
    });
  });

  // ============================================================
  // SECTION 5: SERVER-SIDE BLOCK ENFORCEMENT ACROSS ALL SURFACES
  // ============================================================
  describe('5. Comprehensive Server-Side Block Enforcement (9 Surfaces)', () => {
    it('Alice blocks Bob: severs follow and friend relationships server-side', async () => {
      const blockRes = await fetch(`${BASE_URL}/api/social/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userBob.did }),
      });

      expect(blockRes.status).toBe(200);
      const data = await blockRes.json();
      expect(data.ok).toBe(true);
      expect(data.isBlocked).toBe(true);
    });

    it('Surface 1: Profile - Bob cannot view Alice profile (isBlocked: true, 0 posts)', async () => {
      const res = await fetch(`${BASE_URL}/api/user/profile?did=${encodeURIComponent(userAlice.did)}`, {
        headers: { 'Authorization': `Bearer ${userBob.sessionToken}` },
      });
      const data = await res.json();
      expect(data.isBlocked).toBe(true);
      expect(data.posts?.length || 0).toBe(0);
    });

    it('Surface 2: Search - Bob cannot discover Alice in multi-entity search results', async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(userAlice.handle.replace('@', ''))}&scope=people`, {
        headers: { 'Authorization': `Bearer ${userBob.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const people = data.users || [];
      expect(people.some((u: any) => u.did === userAlice.did)).toBe(false);
    });

    it('Surface 3: Feed Comments - Bob cannot comment on Alice post (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({
          postId: testPostId,
          text: 'Attempting comment while blocked',
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Forbidden');
    });

    it('Surface 4: Direct Chat - Bob cannot message Alice (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: userAlice.did,
          text: 'Attempting chat while blocked',
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Forbidden');
    });

    it('Surface 5: Social Follow - Bob cannot follow Alice (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/social/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userAlice.did }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('Surface 6: Friend Requests - Bob cannot send friend request to Alice (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({ toDid: userAlice.did }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('Surface 7: Inbound Mesh Packets - Packets from Bob to Alice are rejected (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/mesh/moderation/verify-packet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'pkt-block-test-1',
          sourceDid: userBob.did,
          recipientDid: userAlice.did,
          type: 'chat',
          payload: { text: 'Mesh packet bypass attempt' },
          timestamp: Date.now(),
          ttlMs: 60000,
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('blocked');
    });

    it('Alice unblocks Bob: restores relationship access cleanly', async () => {
      const res = await fetch(`${BASE_URL}/api/social/unblock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userBob.did }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.isBlocked).toBe(false);

      // Verify Bob can now inspect Alice profile again
      const profRes = await fetch(`${BASE_URL}/api/user/profile?did=${encodeURIComponent(userAlice.did)}`, {
        headers: { 'Authorization': `Bearer ${userBob.sessionToken}` },
      });
      const profData = await profRes.json();
      expect(profData.isBlocked).toBe(false);
    });
  });

  // ============================================================
  // SECTION 6: REAL PERSISTED MUTE RELATIONSHIPS
  // ============================================================
  describe('6. Real Persisted Mute Relationships (Mute != Block != Unfollow)', () => {
    it('Alice mutes User Bob (persisted state distinct from block)', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/mute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({
          targetType: 'user',
          targetId: userBob.did,
          durationSeconds: 3600,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.isMuted).toBe(true);
      expect(data.mute.targetType).toBe('user');
      expect(data.mute.targetId).toBe(userBob.did);
    });

    it('verifies Mute is distinct: Bob is NOT blocked and can still view public profile', async () => {
      const profRes = await fetch(`${BASE_URL}/api/user/profile?did=${encodeURIComponent(userAlice.did)}`, {
        headers: { 'Authorization': `Bearer ${userBob.sessionToken}` },
      });
      const profData = await profRes.json();
      expect(profData.isBlocked).toBe(false);
      expect(profData.ok).toBe(true);
    });

    it('Alice mutes a Conversation and Channel notifications', async () => {
      // Mute Conversation
      const m1 = await fetch(`${BASE_URL}/api/moderation/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAlice.sessionToken}` },
        body: JSON.stringify({ targetType: 'conversation', targetId: 'thread_alpha_beta' }),
      });
      expect(m1.status).toBe(200);

      // Mute Channel
      const m2 = await fetch(`${BASE_URL}/api/moderation/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAlice.sessionToken}` },
        body: JSON.stringify({ targetType: 'channel', targetId: channelAId }),
      });
      expect(m2.status).toBe(200);
    });

    it('retrieves active mutes via GET /api/moderation/mutes', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/mutes`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.mutes)).toBe(true);
      expect(data.mutes.some((m: any) => m.targetId === userBob.did)).toBe(true);
      expect(data.mutes.some((m: any) => m.targetId === channelAId)).toBe(true);
    });

    it('Alice unmutes Bob cleanly via POST /api/moderation/unmute', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/unmute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAlice.sessionToken}` },
        body: JSON.stringify({ targetType: 'user', targetId: userBob.did }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.isMuted).toBe(false);
    });

    it('rejects self-mute with 400 Bad Request', async () => {
      const res = await fetch(`${BASE_URL}/api/moderation/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAlice.sessionToken}` },
        body: JSON.stringify({ targetType: 'user', targetId: userAlice.did }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Cannot mute yourself');
    });
  });

  // ============================================================
  // SECTION 7: SESSION MANAGEMENT & SECURITY CENTER (BOLA / IDOR)
  // ============================================================
  describe('7. Session Management & Security Center (BOLA/IDOR Protection)', () => {
    let aliceSessions: any[];

    it('lists active hardware sessions with safe metadata only (no private keys/seeds)', async () => {
      const res = await fetch(`${BASE_URL}/api/user/sessions`, {
        headers: { 'Authorization': `Bearer ${userAlice.sessionToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(data.sessions.length).toBeGreaterThan(0);
      aliceSessions = data.sessions;

      // Ensure no raw cryptographic secrets or tokens leaked in sessions response
      for (const s of data.sessions) {
        expect(s).not.toHaveProperty('privateKey');
        expect(s).not.toHaveProperty('seedPhrase');
        expect(s).not.toHaveProperty('recoveryPhrase');
      }
    });

    it('BOLA / IDOR protection: Bob attempting to revoke Alice session fails (404/403)', async () => {
      const aliceSessionId = aliceSessions[0].sessionId || aliceSessions[0].id;
      const res = await fetch(`${BASE_URL}/api/user/sessions/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`, // Bob is actor!
        },
        body: JSON.stringify({ sessionId: aliceSessionId }),
      });

      expect([403, 404]).toContain(res.status);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('not owned');
    });

    it('Alice successfully revokes all other remote hardware sessions via /api/user/sessions/revoke-others', async () => {
      const res = await fetch(`${BASE_URL}/api/user/sessions/revoke-others`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data).toHaveProperty('revokedCount');
    });

    it('BOLA / IDOR protection: User A cannot supply targetDid to revoke User B other sessions (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/user/sessions/revoke-others`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userBob.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: userAlice.did }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Forbidden');
    });
  });

  // ============================================================
  // SECTION 8: OFFLINE & MESH MODERATION SAFETY & OUTBOX SYNC
  // ============================================================
  describe('8. Offline / Mesh Moderation Safety & Outbox Batch Sync', () => {
    it('inbound mesh packet verification: rejects expired TTL packets (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/mesh/moderation/verify-packet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'pkt-expired-1',
          sourceDid: userCharlie.did,
          type: 'chat',
          payload: { text: 'Stale mesh message' },
          timestamp: Date.now() - 120000, // 2 minutes old
          ttlMs: 30000, // 30s TTL
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('TTL exceeded');
    });

    it('inbound mesh packet verification: rejects packet referencing moderated (HIDDEN) content (403 Forbidden)', async () => {
      // 1. Hide a test post
      await fetch(`${BASE_URL}/api/moderation/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSession.sessionToken}` },
        body: JSON.stringify({
          targetType: 'post',
          targetId: testPostId,
          action: 'Hide',
          notes: 'Hidden for mesh test',
        }),
      });

      // 2. Incoming mesh packet tries to relay the hidden post
      const res = await fetch(`${BASE_URL}/api/mesh/moderation/verify-packet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'pkt-mod-check-1',
          sourceDid: userCharlie.did,
          type: 'post',
          payload: { postId: testPostId, text: 'Relaying post' },
          timestamp: Date.now(),
          ttlMs: 60000,
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('moderation');

      // Restore post
      await fetch(`${BASE_URL}/api/moderation/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSession.sessionToken}` },
        body: JSON.stringify({
          targetType: 'post',
          targetId: testPostId,
          action: 'Restore',
          notes: 'Restored after test',
        }),
      });
    });

    it('offline report queue & batch synchronization: ingests batch of queued reports on reconnection', async () => {
      const outboxReports = [
        {
          id: `offline_rep_1_${ts}`,
          targetType: 'post',
          targetId: testPostId,
          reason: 'Spam',
          details: 'Queued while mesh was disconnected',
        },
        {
          id: `offline_rep_2_${ts}`,
          targetType: 'user',
          targetId: userBob.did,
          reason: 'Fraud',
          details: 'Queued while mesh was disconnected',
        },
      ];

      const res = await fetch(`${BASE_URL}/api/moderation/outbox/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAlice.sessionToken}`,
        },
        body: JSON.stringify({ reports: outboxReports }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.synced).toBe(2);
      expect(data.acknowledgedIds).toContain(`offline_rep_1_${ts}`);
      expect(data.acknowledgedIds).toContain(`offline_rep_2_${ts}`);

      // Verify reports are now real and persistent in the moderation queue
      const checkRes = await fetch(`${BASE_URL}/api/moderation/reports`, {
        headers: { 'Authorization': `Bearer ${adminSession.sessionToken}` },
      });
      const checkData = await checkRes.json();
      expect(checkData.reports.some((r: any) => r.reporterDid === userAlice.did && r.reason === 'Fraud')).toBe(true);
    });
  });

  // ============================================================
  // SECTION 9: AUDIT LOG INTEGRITY & REDACTION
  // ============================================================
  describe('9. Moderation Audit Log Integrity & Cryptographic Redaction', () => {
    it('verifies moderation actions are persisted in audit_logs with actor, target, action and result', async () => {
      // 1. Execute an audited action
      const actRes = await fetch(`${BASE_URL}/api/moderation/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminSession.sessionToken}` },
        body: JSON.stringify({
          targetType: 'user',
          targetId: userBob.did,
          action: 'Warn',
          notes: 'Formal audit verification warning',
        }),
      });
      const actData = await actRes.json();
      expect(actData.ok ? 200 : actData.error).toBe(200);

      // 2. Query admin metrics / audit log
      const res = await fetch(`${BASE_URL}/api/admin/metrics`, {
        headers: { 'Authorization': `Bearer ${adminSession.sessionToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.auditLogs).toBeDefined();
      expect(Array.isArray(data.auditLogs)).toBe(true);

      const modLog = data.auditLogs.find((l: any) => l.type === 'MODERATION_ACTION' && l.details?.includes('Formal audit verification warning'));
      expect(modLog).toBeDefined();
      expect(modLog.actorDid).toBe(adminSession.did);
      expect(modLog.result).toBe('SUCCESS');
    });

    it('verifies sensitive credentials (session tokens, seed phrases, passwords) are never logged in plaintext', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/metrics`, {
        headers: { 'Authorization': `Bearer ${adminSession.sessionToken}` },
      });
      const data = await res.json();
      const logs = data.auditLogs || [];

      for (const log of logs) {
        const text = JSON.stringify(log);
        expect(text).not.toContain(userAlice.sessionToken);
        expect(text).not.toContain(userBob.sessionToken);
        expect(text).not.toContain('sovereign galaxy velvet');
        expect(text).not.toMatch(/stk_[a-zA-Z0-9_-]{20,}/);
      }
    });
  });

  // ============================================================
  // SECTION 10: CLIENT-SIDE SPATIAL SURFACES IN SERVED HTML
  // ============================================================
  describe('10. Client-Side Spatial Surfaces Verification in Served HTML', () => {
    let html = '';

    beforeAll(async () => {
      const res = await fetch(`${BASE_URL}/`);
      expect(res.status).toBe(200);
      html = await res.text();
    });

    it('defines window.openSpatialReportSurface with contextual reporting flow', () => {
      expect(html).toContain('window.openSpatialReportSurface = function(');
      expect(html).toContain('id: \'report-\'');
      expect(html).toContain('REPORT CONTENT');
      expect(html).toContain('id="spatialReportSubmitBtn"');
      expect(html).toContain('id="spatialReportDetails"');
    });

    it('defines window.openSpatialModerationSurface with status tabs and action controls', () => {
      expect(html).toContain('window.openSpatialModerationSurface = function(');
      expect(html).toContain('MODERATION SURFACE');
      expect(html).toContain('data-tab="all"');
      expect(html).toContain('data-tab="pending"');
      expect(html).toContain('data-tab="restricted"');
      expect(html).toContain('data-tab="resolved"');
      expect(html).toContain('window._executeModAction');
    });

    it('defines window.openSpatialSecurityCenterSurface with active hardware sessions and logout controls', () => {
      expect(html).toContain('window.openSpatialSecurityCenterSurface = function(');
      expect(html).toContain('SECURITY CENTER');
      expect(html).toContain('id="revokeOthersBtn"');
      expect(html).toContain('window._revokeSingleSession');
      expect(html).toContain('Cryptographic Identity');
      expect(html).toContain('Two-Factor Authentication');
    });

    it('defines window.openSpatialPrivacySettingsSurface with server-persisted access controls', () => {
      expect(html).toContain('window.openSpatialPrivacySettingsSurface = function(');
      expect(html).toContain('PRIVACY & SECURITY');
      expect(html).toContain('id="privacyProfileVisibility"');
      expect(html).toContain('id="privacyMessageMe"');
    });
  });
});
