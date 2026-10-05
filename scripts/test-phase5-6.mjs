import assert from 'node:assert';

const BASE_URL = 'http://localhost:3001';

async function runTests() {
  console.log('🧪 Starting Phase 5 & Phase 6 Integration Tests...\n');

  // Test 1: GET /api/reels/list
  console.log('1️⃣ Testing GET /api/reels/list...');
  const reelsRes = await fetch(`${BASE_URL}/api/reels/list`);
  assert.strictEqual(reelsRes.status, 200);
  const reelsData = await reelsRes.json();
  assert.strictEqual(reelsData.ok, true);
  assert.ok(Array.isArray(reelsData.reels));
  console.log(`   ✅ Fetched ${reelsData.reels.length} reels from database`);

  // Test 2: POST /api/reels/create (Ingest 9:16 vertical video)
  console.log('\n2️⃣ Testing POST /api/reels/create (Vertical Video Upload)...');
  // Simulated small MP4 sample binary (128 bytes)
  const sampleMp4Bytes = Buffer.from('AAAAIGZ0eXBpc29tAAAAAGlzb21tcDQxYXZjMW1wNDI=' + 'A'.repeat(80), 'utf-8');
  const base64DataUrl = `data:video/mp4;base64,${sampleMp4Bytes.toString('base64')}`;

  const createReelRes = await fetch(`${BASE_URL}/api/reels/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caption: '🚀 Building decentralized 9:16 vertical reels with BitSwap & libp2p! #sovra #p2p #web3',
      audioTrack: 'Original Sound — @alice_creator',
      tags: ['#sovra', '#p2p', '#reels', '#distributed'],
      videoData: base64DataUrl,
      mimeType: 'video/mp4',
      creatorDid: 'did:sovra:creator_test_alice',
      creatorHandle: 'alice_creator',
      creatorName: 'Alice P2P Architect',
    }),
  });
  assert.strictEqual(createReelRes.status, 200);
  const createdReelData = await createReelRes.json();
  assert.strictEqual(createdReelData.ok, true);
  assert.ok(createdReelData.reel);
  assert.ok(createdReelData.reel.cid.startsWith('bafy'));
  assert.ok(createdReelData.reel.videoUrl);
  const uploadedCid = createdReelData.reel.cid;
  const uploadedReelId = createdReelData.reel.id;
  console.log(`   ✅ Reel created: ID ${uploadedReelId}, CID: ${uploadedCid}, Video URL: ${createdReelData.reel.videoUrl}`);

  // Test 3: GET /api/reels/video/:cid (Full & HTTP 206 Range Stream)
  console.log('\n3️⃣ Testing GET /api/reels/video/:cid Video Streaming...');
  const fullVideoRes = await fetch(`${BASE_URL}/api/reels/video/${uploadedCid}`);
  assert.strictEqual(fullVideoRes.status, 200);
  assert.strictEqual(fullVideoRes.headers.get('content-type'), 'video/mp4');
  const fullBuf = await fullVideoRes.arrayBuffer();
  assert.strictEqual(fullBuf.byteLength, sampleMp4Bytes.length);
  console.log(`   ✅ Full video stream: ${fullBuf.byteLength} bytes`);

  // HTTP 206 Partial Content Range Request
  const rangeRes = await fetch(`${BASE_URL}/api/reels/video/${uploadedCid}`, {
    headers: { Range: 'bytes=0-49' },
  });
  assert.strictEqual(rangeRes.status, 206);
  assert.ok(rangeRes.headers.get('content-range')?.startsWith('bytes 0-49/'));
  assert.strictEqual(rangeRes.headers.get('content-length'), '50');
  const rangeBuf = await rangeRes.arrayBuffer();
  assert.strictEqual(rangeBuf.byteLength, 50);
  console.log(`   ✅ HTTP 206 Partial Content range stream verified (bytes 0-49/128)`);

  // Test 4: POST /api/reels/like
  console.log('\n4️⃣ Testing POST /api/reels/like (Toggle Like)...');
  const likeRes = await fetch(`${BASE_URL}/api/reels/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reelId: uploadedReelId,
      userDid: 'did:sovra:tester_bob',
    }),
  });
  assert.strictEqual(likeRes.status, 200);
  const likeData = await likeRes.json();
  assert.strictEqual(likeData.ok, true);
  assert.strictEqual(likeData.likesCount, 1);
  assert.strictEqual(likeData.isLiked, true);
  console.log(`   ✅ Reel liked (likesCount: ${likeData.likesCount})`);

  // Test 5: POST /api/reels/comment & GET /api/reels/comments
  console.log('\n5️⃣ Testing Reels Comments Persistence...');
  const commentRes = await fetch(`${BASE_URL}/api/reels/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reelId: uploadedReelId,
      text: 'Insane 60fps streaming quality directly from local storage!',
      authorDid: 'did:sovra:tester_bob',
      authorHandle: 'bob_live',
      authorName: 'Bob Telecom',
      authorAvatar: 'B',
    }),
  });
  assert.strictEqual(commentRes.status, 200);
  const commentData = await commentRes.json();
  assert.strictEqual(commentData.ok, true);
  assert.ok(commentData.comment);

  const getCommentsRes = await fetch(`${BASE_URL}/api/reels/comments?reelId=${uploadedReelId}`);
  assert.strictEqual(getCommentsRes.status, 200);
  const getCommentsData = await getCommentsRes.json();
  assert.strictEqual(getCommentsData.ok, true);
  assert.ok(getCommentsData.comments.some(c => c.text.includes('Insane 60fps streaming')));
  console.log(`   ✅ Reel comment persisted: "${commentData.comment.text}"`);

  // Test 6: GET /api/youtube/video (Watch Studio)
  console.log('\n6️⃣ Testing GET /api/youtube/video (Watch Studio Comments)...');
  const ytVidRes = await fetch(`${BASE_URL}/api/youtube/video?id=yt-video-1`);
  assert.strictEqual(ytVidRes.status, 200);
  const ytVidData = await ytVidRes.json();
  assert.strictEqual(ytVidData.ok, true);
  assert.ok(Array.isArray(ytVidData.comments));
  console.log(`   ✅ Watch studio comments fetched: ${ytVidData.comments.length} comments`);

  // Test 7: POST /api/youtube/comment (Top-level & Nested Reply)
  console.log('\n7️⃣ Testing POST /api/youtube/comment (Persistent Comments & Replies)...');
  const postYtCommentRes = await fetch(`${BASE_URL}/api/youtube/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: 'yt-video-1',
      text: 'Super clean zero-RTT Noise_XX handshake presentation!',
      authorName: 'Alice Architect',
      authorHandle: 'alice_creator',
      authorAvatar: 'A',
    }),
  });
  assert.strictEqual(postYtCommentRes.status, 200);
  const postYtCommentData = await postYtCommentRes.json();
  assert.strictEqual(postYtCommentData.ok, true);
  const parentCommentId = postYtCommentData.comment.id;
  console.log(`   ✅ Watch studio top-level comment added: ${parentCommentId}`);

  // Nested Reply
  const replyRes = await fetch(`${BASE_URL}/api/youtube/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: 'yt-video-1',
      parentCommentId,
      text: 'Thanks Alice! Noise_XX allows instant authenticated swarms without round-trip latency.',
      authorName: 'Bob Telecom',
      authorHandle: 'bob_live',
      authorAvatar: 'B',
    }),
  });
  assert.strictEqual(replyRes.status, 200);
  const replyData = await replyRes.json();
  assert.strictEqual(replyData.ok, true);
  assert.ok(replyData.reply);
  console.log(`   ✅ Nested reply added to ${parentCommentId}`);

  // Test 7b: POST /api/youtube/comment/like (Like Comment & Reply)
  console.log('\n7️⃣b Testing POST /api/youtube/comment/like...');
  const likeCommentRes = await fetch(`${BASE_URL}/api/youtube/comment/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: 'yt-video-1',
      commentId: parentCommentId,
    }),
  });
  assert.strictEqual(likeCommentRes.status, 200);
  const likeCommentData = await likeCommentRes.json();
  assert.strictEqual(likeCommentData.ok, true);
  assert.ok(likeCommentData.likes >= 1);
  console.log(`   ✅ Comment liked: new count ${likeCommentData.likes}`);

  // Like the nested reply
  const likeReplyRes = await fetch(`${BASE_URL}/api/youtube/comment/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: 'yt-video-1',
      commentId: replyData.reply.id,
    }),
  });
  assert.strictEqual(likeReplyRes.status, 200);
  const likeReplyData = await likeReplyRes.json();
  assert.strictEqual(likeReplyData.ok, true);
  assert.ok(likeReplyData.likes >= 1);
  console.log(`   ✅ Nested reply liked: new count ${likeReplyData.likes}`);

  // Test 8: POST /api/youtube/tip (Wallet Balance Ledger Deduction & Super Thanks)
  console.log('\n8️⃣ Testing POST /api/youtube/tip (Sovereign Wallet Ledger & Split)...');
  // First register or get current user balance
  const userRegRes = await fetch(`${BASE_URL}/api/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      did: 'did:sovra:tipper_wallet_alice',
      handle: '@tipper_alice',
      name: 'Alice Tipper',
      avatar: 'A',
    }),
  });
  const userRegData = await userRegRes.json();
  assert.strictEqual(userRegData.ok, true);
  const initialBalance = userRegData.user.balanceSov;
  console.log(`   Initial balance of tipper: ${initialBalance} SOV`);

  const tipRes = await fetch(`${BASE_URL}/api/youtube/tip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromDid: 'did:sovra:tipper_wallet_alice',
      creatorDid: 'did:sovra:creator_studio_broadcast',
      amount: 50,
      videoId: 'yt-video-1',
      authorName: 'Alice Tipper',
      message: 'Keep innovating the decentralized media future! 🚀',
    }),
  });
  assert.strictEqual(tipRes.status, 200);
  const tipData = await tipRes.json();
  assert.strictEqual(tipData.ok, true);
  assert.strictEqual(tipData.split.creator, 47.5); // 95%
  assert.strictEqual(tipData.split.seeder, 2.5); // 5%
  assert.strictEqual(tipData.newBalance, initialBalance - 50);
  console.log(`   ✅ Tip voucher generated: ${tipData.voucher.voucherId}`);
  console.log(`      Creator Split: 95% = ${tipData.split.creator} SOV`);
  console.log(`      Seeder Split: 5% = ${tipData.split.seeder} SOV`);
  console.log(`      Updated Wallet Balance: ${tipData.newBalance} SOV (deducted 50 SOV)`);

  // Test 9: GET /api/admin/metrics (Live Dynamic Metrics)
  console.log('\n9️⃣ Testing GET /api/admin/metrics (Operations Console Metrics)...');
  const metricsRes = await fetch(`${BASE_URL}/api/admin/metrics`);
  assert.strictEqual(metricsRes.status, 200);
  const metrics = await metricsRes.json();
  assert.strictEqual(metrics.ok, true);
  assert.ok(metrics.registeredUsersCount >= 1);
  assert.ok(typeof metrics.diskStorageBytes === 'number' && metrics.diskStorageBytes > 0);
  assert.ok(typeof metrics.diskStorageMb === 'number' && metrics.diskStorageMb > 0);
  assert.ok(Array.isArray(metrics.auditLogs));
  assert.ok(metrics.auditLogs.length > 0);
  assert.ok(metrics.reelsCount >= 1);
  console.log(`   ✅ Admin Live Metrics:`);
  console.log(`      - Registered Users Count: ${metrics.registeredUsersCount}`);
  console.log(`      - Chat Messages Volume: ${metrics.chatMessagesVolume}`);
  console.log(`      - Disk Storage Consumed: ${metrics.diskStorageMb} MB (${metrics.diskStorageBytes} bytes)`);
  console.log(`      - Audit Logs Count: ${metrics.auditLogs.length} (Latest: [${metrics.auditLogs[0].action}] ${metrics.auditLogs[0].details})`);

  // Test 10: GET /admin (Operations Console HTML Render)
  console.log('\n🔟 Testing GET /admin (Operations Console UI Render)...');
  const adminHtmlRes = await fetch(`${BASE_URL}/admin`);
  const adminHtml = await adminHtmlRes.text();
  assert.ok(adminHtml.includes('Sovra Ops Console'));
  assert.ok(adminHtml.includes('Registered Users'));
  assert.ok(adminHtml.includes('metricDiskStorage'));
  assert.ok(adminHtml.includes('Activity Audit') || adminHtml.includes('Audit Ledger'));
  assert.ok(adminHtml.includes('Users &amp; Chat Mesh') || adminHtml.includes('Users & Chat Mesh'));
  console.log(`   ✅ /admin HTML contains all Phase 6 dynamic operations views and live metrics!`);

  console.log('\n🎉 ALL 10 PHASE 5 & PHASE 6 INTEGRATION TESTS PASSED 100%!\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
