import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Adversarial BOLA / IDOR & Authentication Defense Matrix', () => {
  let aliceToken: string;
  let aliceDid: string;
  let aliceHandle: string;

  let bobToken: string;
  let bobDid: string;
  let bobHandle: string;

  let eveToken: string;
  let eveDid: string;
  let eveHandle: string;

  let alicePostId: string;
  let alicePrivatePostId: string;
  let aliceCommentId: string;
  let aliceSession2Id: string;
  let friendRequestId: string;

  it('registers three distinct sovereign identities: User A (Alice), User B (Bob), and Attacker C (Eve)', async () => {
    aliceHandle = `@alice_sec_${Date.now()}`;
    const rA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: aliceHandle, name: 'Alice Sec', device: 'Workstation' }),
    });
    expect(rA.status).toBe(200);
    const dA = await rA.json();
    aliceToken = dA.sessionToken;
    aliceDid = dA.user.did;

    bobHandle = `@bob_sec_${Date.now()}`;
    const rB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: bobHandle, name: 'Bob Sec', device: 'Mobile' }),
    });
    expect(rB.status).toBe(200);
    const dB = await rB.json();
    bobToken = dB.sessionToken;
    bobDid = dB.user.did;

    eveHandle = `@eve_sec_${Date.now()}`;
    const rC = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: eveHandle, name: 'Eve Attacker', device: 'Attacker Rig' }),
    });
    expect(rC.status).toBe(200);
    const dC = await rC.json();
    eveToken = dC.sessionToken;
    eveDid = dC.user.did;
  });

  it('setup: Alice creates public post, private post, comment, and secondary hardware session', async () => {
    // 1. Public post
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ caption: 'Alice Sovereign Public Content #security', postType: 'text' }),
    });
    expect(postRes.status).toBe(200);
    const pData = await postRes.json();
    alicePostId = pData.post.id;

    // 2. Private post (only_me)
    const privRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ caption: 'Alice Secret Vault Key #privatevault', postType: 'text', visibility: 'only_me' }),
    });
    expect(privRes.status).toBe(200);
    const privData = await privRes.json();
    alicePrivatePostId = privData.post.id;

    // 3. Add comment to public post
    const comRes = await fetch(`${BASE_URL}/api/feed/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ postId: alicePostId, text: 'Alice author comment' }),
    });
    expect(comRes.status).toBe(200);
    const cData = await comRes.json();
    aliceCommentId = cData.comment.id;

    // 4. Register secondary device session for Alice
    const sess2Res = await fetch(`${BASE_URL}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: aliceHandle, device: 'Alice Secondary Laptop' }),
    });
    expect(sess2Res.status).toBe(200);

    const listSessRes = await fetch(`${BASE_URL}/api/user/sessions`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const sessList = await listSessRes.json();
    const s2 = sessList.sessions.find((s: any) => s.deviceName === 'Alice Secondary Laptop');
    expect(s2).toBeDefined();
    aliceSession2Id = s2.sessionId || s2.id;
  });

  // --- ATTACK VECTOR 1: BOLA / IDOR on POST EDITING ---
  it('[BOLA-01] Bob attempts to maliciously edit Alice post -> 403 Forbidden', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ postId: alicePostId, caption: 'DEFACED BY BOB' }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);

    // Verify post was NOT modified
    const checkRes = await fetch(`${BASE_URL}/api/feed/get?id=${alicePostId}`);
    const checkData = await checkRes.json();
    expect(checkData.post.caption).toBe('Alice Sovereign Public Content #security');
  });

  // --- ATTACK VECTOR 2: BOLA / IDOR on POST DELETION ---
  it('[BOLA-02] Bob attempts to maliciously delete Alice post -> 403 Forbidden', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ postId: alicePostId }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);

    // Verify post still exists
    const checkRes = await fetch(`${BASE_URL}/api/feed/get?id=${alicePostId}`);
    expect(checkRes.status).toBe(200);
  });

  // --- ATTACK VECTOR 3: BOLA / IDOR on COMMENT DELETION ---
  it('[BOLA-03] Bob attempts to maliciously delete Alice comment -> 403 Forbidden', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/comment/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ postId: alicePostId, commentId: aliceCommentId }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  // --- ATTACK VECTOR 4: BOLA / IDOR on POST VISIBILITY MUTATION ---
  it('[BOLA-04] Bob attempts to change visibility of Alice post -> 403 Forbidden', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/visibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ postId: alicePostId, visibility: 'only_me' }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  // --- ATTACK VECTOR 5: IDOR on HARDWARE SESSION REVOCATION ---
  it('[IDOR-05] Bob attempts to revoke Alice secondary device session -> 404/403 Rejected', async () => {
    const res = await fetch(`${BASE_URL}/api/user/sessions/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ sessionId: aliceSession2Id }),
    });
    expect([403, 404]).toContain(res.status);
    const data = await res.json();
    expect(data.ok).toBe(false);

    // Verify Alice session is NOT revoked
    const checkRes = await fetch(`${BASE_URL}/api/user/sessions`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const checkData = await checkRes.json();
    const s2 = checkData.sessions.find((s: any) => (s.sessionId || s.id) === aliceSession2Id);
    expect(s2.isRevoked).toBe(false);
  });

  // --- ATTACK VECTOR 6: PRIVACY ENGINE ENFORCEMENT ON GET ---
  it('[PRIV-06] Eve attempts to read Alice only_me private post -> 403 Forbidden', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/get?id=${alicePrivatePostId}`, {
      headers: { Authorization: `Bearer ${eveToken}` },
    });
    expect([403, 404]).toContain(res.status);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  // --- ATTACK VECTOR 7: PRIVACY LEAK DEFENSE IN SEARCH ---
  it('[PRIV-07] Eve attempts to discover Alice private post via search query -> Omitted from results', async () => {
    const res = await fetch(`${BASE_URL}/api/search?q=privatevault`, {
      headers: { Authorization: `Bearer ${eveToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const found = data.results.posts.find((p: any) => p.id === alicePrivatePostId);
    expect(found).toBeUndefined(); // MUST NOT leak private content
  });

  // --- ATTACK VECTOR 8: CHAT SNOOPING DEFENSE ---
  it('[CHAT-08] Eve attempts to read private direct message thread between Alice and Bob -> Filtered to 0', async () => {
    // Alice sends Bob a direct message
    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ recipientDid: bobDid, text: 'Alice top secret message to Bob' }),
    });
    expect(sendRes.status).toBe(200);

    // Eve queries messages
    const eveQueryRes = await fetch(`${BASE_URL}/api/chat/messages`, {
      headers: { Authorization: `Bearer ${eveToken}` },
    });
    expect(eveQueryRes.status).toBe(200);
    const eveData = await eveQueryRes.json();
    const intercepted = eveData.messages.find((m: any) => m.text?.includes('top secret'));
    expect(intercepted).toBeUndefined();
  });

  // --- ATTACK VECTOR 9: SENDER IDENTITY SPOOFING ---
  it('[SPOOF-09] Bob attempts to spoof sender identity in chat -> 403 Forbidden', async () => {
    const res = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ senderDid: aliceDid, recipientDid: eveDid, text: 'Spoofed from Alice' }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/mismatch|forge/i);
  });

  // --- ATTACK VECTOR 10: FRIEND REQUEST INTERCEPTION BOLA ---
  it('[BOLA-10] Eve attempts to accept friend request sent from Bob to Alice -> 403 Forbidden', async () => {
    // Bob sends friend request to Alice
    const reqRes = await fetch(`${BASE_URL}/api/friends/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ targetDid: aliceDid }),
    });
    expect(reqRes.status).toBe(200);
    const reqData = await reqRes.json();
    friendRequestId = reqData.relationship.id;

    // Eve attempts to accept the request directed to Alice
    const eveIntercept = await fetch(`${BASE_URL}/api/friends/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eveToken}` },
      body: JSON.stringify({ requestId: friendRequestId, status: 'accept' }),
    });
    expect(eveIntercept.status).toBe(403);
    const interceptData = await eveIntercept.json();
    expect(interceptData.ok).toBe(false);
  });

  // --- ATTACK VECTOR 11: NOTIFICATION PRIVACY ISOLATION ---
  it('[NOTIF-11] Eve queries notifications -> Strictly isolated, receives zero Alice notifications', async () => {
    const res = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${eveToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    for (const notif of data.notifications) {
      expect(notif.recipientDid).toBe(eveDid);
    }
  });

  // --- ATTACK VECTOR 12: ADMIN PRIVILEGE ESCALATION ---
  it('[ADMIN-12] Eve attempts to access Admin Console metrics without admin key -> 401/403 Rejected', async () => {
    // 1. GET /api/admin/metrics with unauthorized Eve token
    const resMetrics = await fetch(`${BASE_URL}/api/admin/metrics`, {
      headers: { Authorization: `Bearer ${eveToken}` },
    });
    expect([401, 403]).toContain(resMetrics.status);

    // 2. POST /api/admin/panic with unauthorized Eve token
    const resPanic = await fetch(`${BASE_URL}/api/admin/panic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eveToken}` },
      body: JSON.stringify({ confirmation: 'WIPE_ALL_DATA' }),
    });
    expect([401, 403]).toContain(resPanic.status);
  });

  // --- ATTACK VECTOR 13: ROLE ESCALATION VIA PROFILE UPDATE ---
  it('[ROLE-13] Eve attempts to escalate role to SUPER_ADMIN via profile update -> Role rejected/ignored', async () => {
    const res = await fetch(`${BASE_URL}/api/user/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eveToken}` },
      body: JSON.stringify({ role: 'SUPER_ADMIN', isAdmin: true, bio: 'Hacker Bio' }),
    });
    expect(res.status).toBe(200);

    // Call admin metrics with Eve token to prove role was NOT escalated
    const adminCheck = await fetch(`${BASE_URL}/api/admin/metrics`, {
      headers: { Authorization: `Bearer ${eveToken}` },
    });
    expect([401, 403]).toContain(adminCheck.status);
  });

  // --- ATTACK VECTOR 14: TAMPERED TOKEN DEFENSE ---
  it('[AUTH-14] Tampered session token rejected -> 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/user/sessions`, {
      headers: { Authorization: 'Bearer stk_tampered_malicious_signature_999999' },
    });
    expect(res.status).toBe(401);
  });

  // --- ATTACK VECTOR 15: MISSING AUTH HEADER ON PROTECTED ROUTE ---
  it('[AUTH-15] Missing authorization header on protected route -> 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: 'Anonymous post attempt' }),
    });
    expect(res.status).toBe(401);
  });
});
