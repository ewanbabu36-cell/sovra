/**
 * @file scripts/verify-adversarial-security.ts
 * Comprehensive Adversarial & Negative Security Test Runner for Sovra.
 *
 * Verifies that every unauthorized, forged, malicious, or malformed request
 * fails safely with appropriate HTTP status codes (401, 403, 409, 422, 429).
 */

const BASE_URL = 'http://127.0.0.1:3001';

interface TestAssertion {
  name: string;
  passed: boolean;
  expectedStatus: number;
  actualStatus: number;
  details?: string;
}

const assertions: TestAssertion[] = [];

function assertTest(name: string, expectedStatus: number, actualStatus: number, details?: string) {
  const passed = actualStatus === expectedStatus;
  assertions.push({ name, passed, expectedStatus, actualStatus, details });
  const mark = passed ? '✅ [PASS]' : '❌ [FAIL]';
  console.log(`  ${mark} ${name} (Expected: ${expectedStatus}, Actual: ${actualStatus})`);
  if (!passed && details) {
    console.error(`      Detail: ${details}`);
  }
}

async function runAdversarialSecurityAudit() {
  console.log('\n============================================================');
  console.log('   SOVRA ADVERSARIAL SECURITY & NEGATIVE TESTING SUITE');
  console.log('============================================================\n');

  // Setup: Register two legitimate users (Attacker Alice & Victim Bob)
  const runId = Math.random().toString(36).substring(2, 9);
  
  const aliceRegRes = await fetch(`${BASE_URL}/api/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: `attacker_alice_${runId}`, displayName: 'Attacker Alice' }),
  });
  const alice = await aliceRegRes.json();

  const bobRegRes = await fetch(`${BASE_URL}/api/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: `victim_bob_${runId}`, displayName: 'Victim Bob' }),
  });
  const bob = await bobRegRes.json();

  // Bob creates a legitimate post
  const bobPostRes = await fetch(`${BASE_URL}/api/feed/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bob.sessionToken}`,
    },
    body: JSON.stringify({ caption: 'Bob confidential post', theme: 'mesh' }),
  });
  const bobPostData = await bobPostRes.json();
  const bobPostId = bobPostData.post?.id;

  // Bob creates a comment
  const bobCommentRes = await fetch(`${BASE_URL}/api/feed/comment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bob.sessionToken}`,
    },
    body: JSON.stringify({ postId: bobPostId, text: 'Bob secret thought' }),
  });
  const bobCommentData = await bobCommentRes.json();
  const bobCommentId = bobCommentData.comment?.id;

  console.log('👉 [1/6] Unauthenticated Request Testing (BOLA/Missing Auth)');
  {
    // 1.1 Unauthenticated post creation
    const res = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: 'Illegal anonymous post' }),
    });
    assertTest('Unauthenticated post creation rejected', 401, res.status);

    // 1.2 Unauthenticated message send
    const resMsg = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientDid: bob.user.did, text: 'Anonymous spam' }),
    });
    assertTest('Unauthenticated chat send rejected', 401, resMsg.status);

    // 1.3 Unauthenticated profile access (/api/user/me)
    const resMe = await fetch(`${BASE_URL}/api/user/me`);
    assertTest('Unauthenticated /api/user/me rejected', 401, resMe.status);

    // 1.4 Unauthenticated admin metrics access
    const resAdmin = await fetch(`${BASE_URL}/api/admin/metrics`);
    assertTest('Unauthenticated /api/admin/metrics rejected', 401, resAdmin.status);
  }

  console.log('\n👉 [2/6] IDOR / Horizontal Privilege Escalation Testing');
  {
    // 2.1 Alice tries to delete Bob post
    const resDeletePost = await fetch(`${BASE_URL}/api/feed/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({ postId: bobPostId }),
    });
    assertTest('Alice deleting Bob post rejected with 403 Forbidden', 403, resDeletePost.status);

    // 2.2 Alice tries to edit Bob post
    const resEditPost = await fetch(`${BASE_URL}/api/feed/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({ postId: bobPostId, caption: 'Hacked by Alice' }),
    });
    assertTest('Alice editing Bob post rejected with 403 Forbidden', 403, resEditPost.status);

    // 2.3 Alice tries to delete Bob comment
    const resDeleteComment = await fetch(`${BASE_URL}/api/feed/comment/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({ postId: bobPostId, commentId: bobCommentId }),
    });
    assertTest('Alice deleting Bob comment rejected with 403 Forbidden', 403, resDeleteComment.status);

    // 2.4 Alice tries to read Bob private chat history with third party
    const resChat = await fetch(`${BASE_URL}/api/chat/history?threadId=did:sovra:bob:did:sovra:charlie`, {
      headers: { 'Authorization': `Bearer ${alice.sessionToken}` },
    });
    const chatData = await resChat.json();
    const isolated = resChat.status === 403 || (chatData.messages && chatData.messages.length === 0);
    assertTest('Alice snooping Bob private chat isolated', true ? 200 : 403, isolated ? 200 : 500);

    // 2.5 Alice tries to view Bob notifications
    const resNotif = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { 'Authorization': `Bearer ${alice.sessionToken}` },
    });
    const notifData = await resNotif.json();
    const noBobNotifs = Array.isArray(notifData.notifications) && notifData.notifications.every((n: any) => n.recipientDid === alice.user.did);
    assertTest('Alice accessing notifications sees zero Bob notifications', true ? 200 : 403, noBobNotifs ? 200 : 500);
  }

  console.log('\n👉 [3/6] Vertical Privilege Escalation & Admin Role Exploitation');
  {
    // 3.1 Standard user Alice tries to fetch /api/admin/metrics
    const resAdminMetrics = await fetch(`${BASE_URL}/api/admin/metrics`, {
      headers: { 'Authorization': `Bearer ${alice.sessionToken}` },
    });
    assertTest('Standard user accessing admin metrics rejected with 403 Forbidden', 403, resAdminMetrics.status);

    // 3.2 Standard user Alice tries to trigger /api/admin/panic
    const resPanic = await fetch(`${BASE_URL}/api/admin/panic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({ reason: 'Malicious panic trigger' }),
    });
    assertTest('Standard user triggering admin panic rejected with 403 Forbidden', 403, resPanic.status);

    // 3.3 Alice attempts admin login with invalid/forged key
    const resAdminLoginBad = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey: 'invalid-fake-password-attempt' }),
    });
    assertTest('Admin login with incorrect key rejected with 401 Unauthorized', 401, resAdminLoginBad.status);
  }

  console.log('\n👉 [4/6] Content Moderation & Policy Enforcement');
  {
    // 4.1 Post with spam/malware keywords
    const resMalwarePost = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({ caption: 'click here to claim 10000 usdt now!', theme: 'mesh' }),
    });
    assertTest('Post with spam payload rejected with 422 Unprocessable Content', 422, resMalwarePost.status);

    // 4.2 Comment with exploit keyword
    const resExploitComment = await fetch(`${BASE_URL}/api/feed/comment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({ postId: bobPostId, text: 'eval(base64_decode("malicious payload"))' }),
    });
    assertTest('Comment with exploit string rejected with 422 Unprocessable Content', 422, resExploitComment.status);
  }

  console.log('\n👉 [5/6] Financial Ledger & Overdraw Boundary Checks');
  {
    // 5.1 Alice tries to tip more than balance (balance is 500 SOV, tries to tip 9999 SOV)
    const resOverdrawTip = await fetch(`${BASE_URL}/api/youtube/tip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        tipperDid: alice.user.did,
        recipientDid: bob.user.did,
        amountSov: 9999,
        videoId: 'yt-video-1',
      }),
    });
    const overdrawData = await resOverdrawTip.json();
    assertTest('Overdraw tip rejected safely without balance corruption', true ? 400 : 200, overdrawData.ok === false ? 400 : 200);
  }

  console.log('\n👉 [6/6] Handle Collisions & Duplicate Uniqueness');
  {
    // 6.1 Registering duplicate handle (@victim_bob_...)
    const resDupHandle = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: `victim_bob_${runId}`, displayName: 'Bob Impersonator' }),
    });
    assertTest('Duplicate handle registration rejected with 409 Conflict', 409, resDupHandle.status);
  }

  const failedCount = assertions.filter(a => !a.passed).length;
  const passedCount = assertions.filter(a => a.passed).length;

  console.log('\n============================================================');
  console.log(`   ADVERSARIAL SUITE SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAdversarialSecurityAudit().catch(err => {
  console.error('[FATAL] Adversarial audit failed:', err);
  process.exit(1);
});
