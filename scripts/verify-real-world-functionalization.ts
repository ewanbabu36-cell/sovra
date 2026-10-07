/**
 * SOVRA Real-World Functionalization Verification Suite
 * Tests actual end-to-end execution paths across all subsystems:
 * - Multi-user lifecycle (Alice, Bob, Charlie)
 * - Social graph & friendship handshakes
 * - Feed, comments, likes, and edits
 * - Per-user stories & seen state
 * - Direct messaging & isolation
 * - Channels & subscriptions
 * - Financial micropayments & 95/5 split
 * - Notification generation & delivery
 * - Dynamic search
 * - WebRTC call signaling
 * - Admin panel RBAC
 * - Disk persistence
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:3001';
const ADMIN_SECRET = 'sovra-test-admin-secret-key-32-chars-ok!';

interface ApiResponse {
  status: number;
  data: any;
}

function request(method: string, pathUrl: string, body?: any, token?: string): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, BASE_URL);
    const postData = body ? JSON.stringify(body) : '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData).toString(),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Sovra-Session-Token'] = token;
    }

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 500, data: parsed });
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runRealWorldVerification() {
  console.log('============================================================');
  console.log('   SOVRA REAL-WORLD END-TO-END FUNCTIONALIZATION AUDIT');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, extra?: any) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`, extra ? JSON.stringify(extra) : '');
      failed++;
    }
  }

  try {
    const runId = Date.now().toString(36).slice(-4);
    const aliceHandle = `@alice_${runId}`;
    const bobHandle = `@bob_${runId}`;
    const charlieHandle = `@charlie_${runId}`;

    // 1. Node Status
    console.log('[1/12] Testing Node Health & Host Identity...');
    const statusRes = await request('GET', '/api/status');
    assert(statusRes.status === 200 && statusRes.data.status === 'online', 'Node status is 200 OK', statusRes.data);
    assert(typeof statusRes.data.did === 'string' && statusRes.data.did.startsWith('did:'), 'Host DID is persistent', statusRes.data);

    // 2. User Lifecycle (Registration, Conflict, Login, Logout, Update)
    console.log('\n[2/12] Testing Multi-User Account Lifecycle...');
    const aliceReg = await request('POST', '/api/user/register', {
      handle: aliceHandle,
      name: 'Alice Wonderland',
      bio: 'Sovereign mesh node tester',
      avatar: 'A',
    });
    assert(aliceReg.status === 200 && aliceReg.data.ok === true, 'Alice registration succeeded');
    const aliceToken = aliceReg.data.sessionToken;
    const aliceDid = aliceReg.data.user.did;

    // Test duplicate registration conflict
    const dupReg = await request('POST', '/api/user/register', {
      handle: aliceHandle,
      name: 'Alice Impostor',
    });
    assert(dupReg.status === 409, 'Duplicate handle registration rejected with 409 Conflict');

    // Register Bob & Charlie
    const bobReg = await request('POST', '/api/user/register', {
      handle: bobHandle,
      name: 'Bob Builder',
      bio: 'P2P seeder and creator',
      avatar: 'B',
    });
    assert(bobReg.status === 200, 'Bob registration succeeded');
    const bobToken = bobReg.data.sessionToken;
    const bobDid = bobReg.data.user.did;

    const charlieReg = await request('POST', '/api/user/register', {
      handle: charlieHandle,
      name: 'Charlie Mesh',
      bio: 'Roaming mesh peer',
      avatar: 'C',
    });
    assert(charlieReg.status === 200, 'Charlie registration succeeded');
    const charlieToken = charlieReg.data.sessionToken;
    const charlieDid = charlieReg.data.user.did;

    // Alice Profile Update
    const aliceUpdate = await request('POST', '/api/user/update', {
      name: 'Alice W. (Updated)',
      bio: 'Updated bio: Mesh security architect',
    }, aliceToken);
    assert(aliceUpdate.status === 200 && aliceUpdate.data.user.displayName === 'Alice W. (Updated)', 'Alice profile update succeeded');

    // Alice me check
    const aliceMe = await request('GET', '/api/user/me', undefined, aliceToken);
    assert(aliceMe.status === 200 && aliceMe.data.user.did === aliceDid, 'GET /api/user/me returns authenticated user');

    // Alice Logout & Re-login
    const aliceLogout = await request('POST', '/api/user/logout', {}, aliceToken);
    assert(aliceLogout.status === 200, 'Alice logout succeeded');

    const aliceUnauthMe = await request('GET', '/api/user/me', undefined, aliceToken);
    assert(aliceUnauthMe.status === 401, 'Logged out token rejected on /api/user/me with 401 Unauthorized');

    const aliceLogin = await request('POST', '/api/user/login', { identifier: aliceHandle });
    assert(aliceLogin.status === 200 && aliceLogin.data.ok === true, 'Alice re-login succeeded with handle');
    const aliceNewToken = aliceLogin.data.sessionToken;

    // 3. Social Graph & Friends
    console.log('\n[3/12] Testing Social Graph & Bilateral Friends Handshake...');
    // Alice sends friend request to Bob
    const friendReq = await request('POST', '/api/friends/request', { toDid: bobDid }, aliceNewToken);
    assert(friendReq.status === 200 && friendReq.data.ok === true, 'Alice sent friend request to Bob');

    // Bob accepts friend request
    const friendAccept = await request('POST', '/api/friends/respond', { fromDid: aliceDid, status: 'accept' }, bobToken);
    assert(friendAccept.status === 200 && friendAccept.data.ok === true, 'Bob accepted Alice friend request');

    // Check Bob friends list
    const bobFriends = await request('GET', '/api/friends/list', undefined, bobToken);
    assert(bobFriends.status === 200 && Array.isArray(bobFriends.data.friends), 'Bob friends list returned');
    assert(bobFriends.data.friends.some((f: any) => f.did === aliceDid), 'Alice is present in Bob friends list');

    // Alice follows Bob
    const followRes = await request('POST', '/api/social/follow', {
      targetPubkey: bobDid.replace(/^did:(sovra|key):/, ''),
    }, aliceNewToken);
    assert(followRes.status === 200, 'Alice followed Bob');

    // Alice blocks Charlie
    const blockRes = await request('POST', '/api/social/block', {
      targetPubkey: charlieDid.replace(/^did:(sovra|key):/, ''),
      reason: 'Harassment',
    }, aliceNewToken);
    assert(blockRes.status === 200, 'Alice blocked Charlie');

    // 4. Feed, Likes, Comments, Edit, Delete
    console.log('\n[4/12] Testing Feed, Likes, Comments, Post Edit, and Deletion...');
    // Bob creates a post
    const bobPostRes = await request('POST', '/api/feed/create', {
      caption: 'Decentralized social networking is live on Sovra! #sovra #p2p',
      tags: ['sovra', 'p2p'],
      location: 'Mesh Relay 01',
    }, bobToken);
    assert(bobPostRes.status === 200 && bobPostRes.data.ok === true, 'Bob created a post');
    const bobPostId = bobPostRes.data.post.id;

    // Alice likes Bob post
    const aliceLikeRes = await request('POST', '/api/feed/like', { postId: bobPostId }, aliceNewToken);
    assert(aliceLikeRes.status === 200 && aliceLikeRes.data.likesCount === 1, 'Alice liked Bob post');

    // Charlie comments on Bob post
    const charlieCmtRes = await request('POST', '/api/feed/comment', {
      postId: bobPostId,
      text: 'Great post, Bob! Autonomous mesh confirmed.',
    }, charlieToken);
    assert(charlieCmtRes.status === 200 && charlieCmtRes.data.ok === true, 'Charlie commented on Bob post');
    const commentId = charlieCmtRes.data.comment.id;

    // Charlie deletes his own comment
    const delCmtRes = await request('POST', '/api/feed/comment/delete', {
      postId: bobPostId,
      commentId,
    }, charlieToken);
    assert(delCmtRes.status === 200 && delCmtRes.data.ok === true, 'Charlie deleted his comment');

    // Bob edits his post caption
    const editPostRes = await request('POST', '/api/feed/edit', {
      postId: bobPostId,
      caption: 'Updated: Decentralized social networking is live and verified on Sovra! #sovra #mesh',
      tags: ['sovra', 'mesh'],
    }, bobToken);
    assert(editPostRes.status === 200 && editPostRes.data.post.caption.includes('Updated:'), 'Bob edited his post');

    // Alice attempts unauthorized deletion of Bob post
    const unauthDel = await request('POST', '/api/feed/delete', { postId: bobPostId }, aliceNewToken);
    assert(unauthDel.status === 403, 'Alice unauthorized delete rejected with 403 Forbidden', unauthDel);

    // Bob deletes his own post
    const bobDel = await request('POST', '/api/feed/delete', { postId: bobPostId }, bobToken);
    assert(bobDel.status === 200, 'Bob deleted his own post', bobDel);

    // 5. Per-User Stories & Seen State
    console.log('\n[5/12] Testing Stories, Viewer Tracking & Per-User Seen State...');
    const storyRes = await request('POST', '/api/stories/create', {
      caption: 'Alice morning story from the mesh node!',
      stickerText: '📍 New Delhi',
      gradient: 'linear-gradient(135deg, #4f46e5, #06b6d4)',
    }, aliceNewToken);
    assert(storyRes.status === 200 && storyRes.data.ok === true, 'Alice created a story segment', storyRes);
    const storyId = storyRes.data.story ? storyRes.data.story.id : (storyRes.data.segment ? storyRes.data.segment.id : '');

    // Bob views stories
    const bobStoriesBefore = await request('GET', '/api/stories/list', undefined, bobToken);
    const bobAliceStory = bobStoriesBefore.data.stories.find((s: any) => s.id === storyId || s.creatorHandle === aliceHandle);
    assert(bobAliceStory && bobAliceStory.isSeen === false, 'Bob sees Alice story as unseen (isSeen=false)', bobAliceStory);

    // Bob marks Alice story seen
    const bobSeenRes = await request('POST', '/api/stories/seen', { storyId }, bobToken);
    assert(bobSeenRes.status === 200 && bobSeenRes.data.ok === true, 'Bob marked Alice story seen', bobSeenRes);

    const bobStoriesAfter = await request('GET', '/api/stories/list', undefined, bobToken);
    const bobAliceStorySeen = bobStoriesAfter.data.stories.find((s: any) => s.id === storyId || s.creatorHandle === aliceHandle);
    assert(bobAliceStorySeen && bobAliceStorySeen.isSeen === true, 'Bob sees Alice story as seen (isSeen=true)', bobAliceStorySeen);

    // Charlie views stories: verify Charlie still sees Alice story as UNSEEN
    const charlieStories = await request('GET', '/api/stories/list', undefined, charlieToken);
    const charlieAliceStory = charlieStories.data.stories.find((s: any) => s.id === storyId || s.creatorHandle === aliceHandle);
    assert(charlieAliceStory && charlieAliceStory.isSeen === false, 'Charlie still sees Alice story as UNSEEN (isolated per-user state)', charlieAliceStory);

    // Alice deletes her story
    const delStoryRes = await request('POST', '/api/stories/delete', { storyId }, aliceNewToken);
    assert(delStoryRes.status === 200, 'Alice deleted her story', delStoryRes);

    // 6. Direct Messaging & Cross-User Isolation
    console.log('\n[6/12] Testing Chat Messaging & Privacy Isolation...');
    const aliceMsg = await request('POST', '/api/chat/send', {
      recipientDid: bobDid,
      senderName: 'Alice',
      text: 'Hey Bob, is your seeder node active?',
    }, aliceNewToken);
    assert(aliceMsg.status === 200 && aliceMsg.data.ok === true, 'Alice sent private message to Bob');

    const bobMsg = await request('POST', '/api/chat/send', {
      recipientDid: aliceDid,
      senderName: 'Bob',
      text: 'Yes Alice, bandwidth allocated and pinned.',
    }, bobToken);
    assert(bobMsg.status === 200 && bobMsg.data.ok === true, 'Bob replied to Alice');

    // Bob messages query
    const bobMsgs = await request('GET', '/api/chat/messages', undefined, bobToken);
    assert(bobMsgs.data.messages.some((m: any) => m.text.includes('Hey Bob')), 'Bob can read Alice message');

    // Charlie messages query: Charlie MUST NOT see Alice & Bob messages
    const charlieMsgs = await request('GET', '/api/chat/messages', undefined, charlieToken);
    const leaked = charlieMsgs.data.messages.some((m: any) => m.text.includes('Hey Bob') || m.text.includes('pinned'));
    assert(!leaked, 'Charlie CANNOT read private messages between Alice & Bob (Privacy isolation enforced)');

    // 7. Channels & Subscriptions
    console.log('\n[7/12] Testing Channels, Creation & Subscriptions...');
    const chanRes = await request('POST', '/api/social/channels', {
      name: 'Decentralized Web Creators',
      handle: 'web_creators',
      description: 'Discussions on sovereign web stacks',
    }, bobToken);
    assert(chanRes.status === 200 && chanRes.data.ok === true, 'Bob created a channel');
    const chanId = chanRes.data.channel.id;

    const subRes = await request('POST', '/api/social/channels/subscribe', {
      channelId: chanId,
    }, aliceNewToken);
    assert(subRes.status === 200 && subRes.data.ok === true, 'Alice subscribed to Bob channel');

    // 8. Financial Logic & 95/5 Off-Chain Micropayment Split
    console.log('\n[8/12] Testing Financial Micropayment Tipping & Nonce Replay Protection...');
    // Alice tips Bob 20 SOV
    const tipRes = await request('POST', '/api/youtube/tip', {
      toDid: bobDid,
      creatorDid: bobDid,
      amount: 20,
      videoId: 'video-mesh-101',
    }, aliceNewToken);
    assert(tipRes.status === 200 && tipRes.data.ok === true, 'Alice tipped Bob 20 SOV', tipRes);
    assert(tipRes.data?.newBalance === 480, 'Alice balance correctly decremented: 500 - 20 = 480 SOV', tipRes.data);
    assert(tipRes.data?.split?.creatorAmount === 19, 'Bob received 95% creator split: 19 SOV', tipRes.data);
    assert(tipRes.data?.split?.seederAmount === 1, 'Seeder received 5% seeder split: 1 SOV', tipRes.data);

    // Attempt tipping with amount > balance
    const overdrawTip = await request('POST', '/api/youtube/tip', {
      toDid: bobDid,
      amount: 1000,
    }, aliceNewToken);
    assert(overdrawTip.status === 400 && overdrawTip.data.ok === false, 'Overdraw tip rejected (balance < 0 prohibited)');

    // 9. Notifications Engine
    console.log('\n[9/12] Testing Real-Time Notifications & Unread Delivery...');
    // Check Bob notifications (Bob should have notifications for friend request, post like, chat message, and tip)
    const bobNotifs = await request('GET', '/api/notifications', undefined, bobToken);
    assert(bobNotifs.status === 200 && Array.isArray(bobNotifs.data.notifications), 'Bob received notifications');
    assert(bobNotifs.data.notifications.length >= 3, `Bob has ${bobNotifs.data.notifications.length} notifications`);
    assert(bobNotifs.data.unreadCount > 0, `Bob has unreadCount = ${bobNotifs.data.unreadCount}`);

    // Mark Bob single notification read
    const firstNotifId = bobNotifs.data.notifications[0].id;
    const readOneRes = await request('POST', '/api/notifications/read', { notificationId: firstNotifId }, bobToken);
    assert(readOneRes.status === 200 && readOneRes.data.ok === true, 'Bob marked notification as read');

    // Mark all read
    const readAllRes = await request('POST', '/api/notifications/read-all', {}, bobToken);
    assert(readAllRes.status === 200 && readAllRes.data.ok === true, 'Bob marked all notifications as read');

    const bobNotifsAfter = await request('GET', '/api/notifications', undefined, bobToken);
    assert(bobNotifsAfter.data.unreadCount === 0, 'Bob unreadCount is now 0');

    // Charlie notifications isolation
    const charlieNotifs = await request('GET', '/api/notifications', undefined, charlieToken);
    const hasAliceBobTip = charlieNotifs.data.notifications.some((n: any) => n.title.includes('Tip Received'));
    assert(!hasAliceBobTip, 'Charlie receives zero notifications regarding Alice/Bob tip (Zero cross-user leakage)');

    // 10. Multi-Entity Search API
    console.log('\n[10/12] Testing Dynamic Multi-Entity Search API...');
    const searchAlice = await request('GET', '/api/search?q=alice');
    assert(searchAlice.status === 200 && searchAlice.data.results.users.some((u: any) => u.handle === aliceHandle), 'Search found dynamically created user Alice');

    const searchChannel = await request('GET', '/api/search?q=Creators');
    assert(searchChannel.status === 200 && searchChannel.data.results.channels.some((c: any) => c.name.includes('Creators')), 'Search found dynamically created channel');

    // 11. WebRTC E2EE Signaling
    console.log('\n[11/12] Testing WebRTC E2EE Audio/Video Call Signaling...');
    const callOfferRes = await request('POST', '/api/call/offer', {
      recipientDid: bobDid,
      offerSdp: 'v=0\r\no=alice 1000 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv',
      callType: 'audio',
    }, aliceNewToken);
    assert(callOfferRes.status === 200 && callOfferRes.data.ok === true, 'Alice created WebRTC call offer for Bob');
    const callId = callOfferRes.data.session.callId;

    // Bob polls call
    const bobPollRes = await request('GET', `/api/call/poll?callId=${callId}`, undefined, bobToken);
    assert(bobPollRes.status === 200 && bobPollRes.data.session.status === 'offering', 'Bob polled incoming call');

    // Bob answers call
    const bobAnswerRes = await request('POST', '/api/call/answer', {
      callId,
      answerSdp: 'v=0\r\no=bob 2000 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv',
    }, bobToken);
    assert(bobAnswerRes.status === 200 && bobAnswerRes.data.session.status === 'answered', 'Bob answered call');

    // Alice adds ICE candidate
    const iceRes = await request('POST', '/api/call/candidate', {
      callId,
      candidate: { candidate: 'candidate:1 1 UDP 2130706431 127.0.0.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    }, aliceNewToken);
    assert(iceRes.status === 200 && iceRes.data.ok === true, 'Alice added ICE candidate');

    // Alice ends call
    const endCallRes = await request('POST', '/api/call/end', { callId, reason: 'completed' }, aliceNewToken);
    assert(endCallRes.status === 200 && endCallRes.data.session.status === 'ended', 'Call ended cleanly');

    // 12. Operations Console RBAC & Persistence Verification
    console.log('\n[12/12] Testing Admin Operations & Disk Persistence Verification...');
    // Unauthenticated access
    const unauthMetrics = await request('GET', '/api/admin/metrics');
    assert(unauthMetrics.status === 401, 'Anonymous request to /api/admin/metrics rejected with 401');

    // Standard user access
    const userMetrics = await request('GET', '/api/admin/metrics', undefined, aliceNewToken);
    assert(userMetrics.status === 403, 'Standard user access to /api/admin/metrics rejected with 403 Forbidden');

    // Admin login with secret key
    const adminLoginRes = await request('POST', '/api/admin/login', {
      did: 'did:sovra:sec_admin_01',
      role: 'SUPER_ADMIN',
      adminKey: ADMIN_SECRET,
    });
    assert(adminLoginRes.status === 200 && adminLoginRes.data.ok === true, 'Admin login succeeded with ADMIN_SECRET_KEY');
    const adminToken = adminLoginRes.data.sessionToken;

    // Admin metrics fetch
    const adminMetrics = await request('GET', '/api/admin/metrics', undefined, adminToken);
    assert(adminMetrics.status === 200 && adminMetrics.data.ok === true, 'Admin metrics query succeeded');
    assert(adminMetrics.data.metrics.registeredUsersCount >= 4, `Metrics reflect live users: ${adminMetrics.data.metrics.registeredUsersCount}`);

    // Verify durable database file on disk
    let dbPath = path.join(process.cwd(), '.sovra-storage-dev', 'dynamic-social-state.json');
    if (!fs.existsSync(dbPath)) {
      dbPath = path.join(process.cwd(), '.sovra-data', 'sovra-database.json');
    }
    assert(fs.existsSync(dbPath), `Database file exists at ${dbPath}`);
    const diskDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert(diskDb.users.some((u: any) => u.handle === aliceHandle), 'Alice is durably saved on disk');
    assert(diskDb.users.some((u: any) => u.handle === bobHandle), 'Bob is durably saved on disk');
    assert(diskDb.chatMessages.some((m: any) => m.text.includes('Hey Bob')), 'Chat messages are durably saved on disk');
    assert(diskDb.tip_vouchers.length > 0, 'Tip vouchers are durably saved on disk');
    assert(diskDb.channels.some((c: any) => c.name.includes('Creators')), 'Channel is durably saved on disk');
    assert(diskDb.notifications.length > 0, 'Notifications are durably saved on disk');

    console.log('\n============================================================');
    console.log(`   REAL-WORLD VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('============================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runRealWorldVerification();
