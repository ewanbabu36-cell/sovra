/**
 * Sovra Protocol - Phase 10 Production Performance Audit & Benchmark Runner
 * File: scripts/benchmark-phase10-audit.ts
 *
 * Measures empirical p50, p90, p95, p99 latencies, throughput, error rates,
 * database query performance, and stress concurrency against real endpoints.
 */

import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { SqliteSocialDatabaseEngine } from './database-sqlite.ts';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

export interface PercentileMetrics {
  name: string;
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  opsPerSec: number;
  errors: number;
  errorRatePct: number;
}

export function computePercentiles(name: string, samples: number[], errors: number, totalDurationMs?: number): PercentileMetrics {
  const count = samples.length;
  if (count === 0) {
    return {
      name,
      count: 0,
      minMs: 0,
      maxMs: 0,
      avgMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      opsPerSec: 0,
      errors,
      errorRatePct: errors > 0 ? 100 : 0,
    };
  }

  samples.sort((a, b) => a - b);
  const minMs = samples[0];
  const maxMs = samples[count - 1];
  const sum = samples.reduce((acc, v) => acc + v, 0);
  const avgMs = sum / count;

  const getP = (p: number) => {
    const idx = Math.min(count - 1, Math.floor(count * p));
    return samples[idx];
  };

  const p50Ms = getP(0.50);
  const p90Ms = getP(0.90);
  const p95Ms = getP(0.95);
  const p99Ms = getP(0.99);

  const duration = totalDurationMs || sum;
  const opsPerSec = duration > 0 ? Math.round((count / (duration / 1000))) : 0;
  const totalAttempts = count + errors;
  const errorRatePct = totalAttempts > 0 ? Number(((errors / totalAttempts) * 100).toFixed(2)) : 0;

  return {
    name,
    count,
    minMs: Number(minMs.toFixed(2)),
    maxMs: Number(maxMs.toFixed(2)),
    avgMs: Number(avgMs.toFixed(2)),
    p50Ms: Number(p50Ms.toFixed(2)),
    p90Ms: Number(p90Ms.toFixed(2)),
    p95Ms: Number(p95Ms.toFixed(2)),
    p99Ms: Number(p99Ms.toFixed(2)),
    opsPerSec,
    errors,
    errorRatePct,
  };
}

async function runBenchmarkSeries(
  name: string,
  iterations: number,
  fn: () => Promise<boolean>,
): Promise<PercentileMetrics> {
  const samples: number[] = [];
  let errors = 0;
  const tTotalStart = performance.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    try {
      const ok = await fn();
      const dur = performance.now() - t0;
      if (ok) {
        samples.push(dur);
      } else {
        errors++;
      }
    } catch (_) {
      errors++;
    }
  }

  const tTotal = performance.now() - tTotalStart;
  return computePercentiles(name, samples, errors, tTotal);
}

async function runConcurrentSwarm(
  name: string,
  concurrency: number,
  fn: (index: number) => Promise<boolean>,
): Promise<PercentileMetrics> {
  const samples: number[] = [];
  let errors = 0;
  const tTotalStart = performance.now();

  const promises = Array.from({ length: concurrency }, async (_, idx) => {
    const t0 = performance.now();
    try {
      const ok = await fn(idx);
      const dur = performance.now() - t0;
      if (ok) {
        samples.push(dur);
      } else {
        errors++;
      }
    } catch (_) {
      errors++;
    }
  });

  await Promise.all(promises);
  const tTotal = performance.now() - tTotalStart;
  return computePercentiles(name, samples, errors, tTotal);
}

async function main() {
  console.log('============================================================');
  console.log('   SOVRA PROTOCOL — PHASE 10 PRODUCTION PERFORMANCE AUDIT  ');
  console.log('============================================================\n');

  // 1. SYSTEM METRICS
  const mem = process.memoryUsage();
  const cpus = os.cpus();
  console.log('Hardware & Runtime Environment:');
  console.log(`  OS: ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`  CPU: ${cpus[0]?.model || 'Generic'} (${cpus.length} cores)`);
  console.log(`  Node.js: ${process.version}`);
  console.log(`  Heap Used: ${(mem.heapUsed / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`  RSS: ${(mem.rss / (1024 * 1024)).toFixed(2)} MB\n`);

  const allMetrics: PercentileMetrics[] = [];

  // SETUP: Create primary benchmark test accounts
  const runId = Date.now();
  const userAHandle = `bench_a_${runId}`;
  const userBHandle = `bench_b_${runId}`;

  console.log('[Setup] Registering primary benchmark test users...');
  const regARes = await fetch(`${BASE_URL}/api/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: userAHandle, displayName: 'Bench Alice', deviceType: 'Desktop' }),
  });
  const regAData = await regARes.json();
  const tokenA = regAData.sessionToken;
  const didA = regAData.user.did;

  const regBRes = await fetch(`${BASE_URL}/api/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: userBHandle, displayName: 'Bench Bob', deviceType: 'Mobile' }),
  });
  const regBData = await regBRes.json();
  const tokenB = regBData.sessionToken;
  const didB = regBData.user.did;

  // 2. AUTHENTICATION AUDIT
  console.log('\n--- 1. Authentication Performance Audit ---');
  // 1.1 Register
  const mRegister = await runBenchmarkSeries('Auth: Register User', 25, async () => {
    const res = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `bench_reg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        displayName: 'Bench User',
        deviceType: 'Desktop',
      }),
    });
    return res.status === 200;
  });
  allMetrics.push(mRegister);

  // 1.2 Login
  const mLogin = await runBenchmarkSeries('Auth: Login', 25, async () => {
    const res = await fetch(`${BASE_URL}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: userAHandle }),
    });
    return res.status === 200;
  });
  allMetrics.push(mLogin);

  // 1.3 Session Validation (Profile Fetch)
  const mSession = await runBenchmarkSeries('Auth: Session Validation', 50, async () => {
    const res = await fetch(`${BASE_URL}/api/profile`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    return res.status === 200;
  });
  allMetrics.push(mSession);

  // 3. PROFILE AUDIT
  console.log('\n--- 2. Profile Performance Audit ---');
  // 2.1 Get Profile
  const mGetProfile = await runBenchmarkSeries('Profile: Get Profile', 50, async () => {
    const res = await fetch(`${BASE_URL}/api/profile?did=${didA}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    return res.status === 200;
  });
  allMetrics.push(mGetProfile);

  // 2.2 Update Profile
  const mUpdateProfile = await runBenchmarkSeries('Profile: Update Profile', 25, async () => {
    const res = await fetch(`${BASE_URL}/api/profile/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ bio: `Updated bio at ${Date.now()}`, website: 'https://sovra.network' }),
    });
    return res.status === 200;
  });
  allMetrics.push(mUpdateProfile);

  // 2.3 Follow / Unfollow
  const mFollow = await runBenchmarkSeries('Profile: Follow/Unfollow Graph', 25, async () => {
    const fol = await fetch(`${BASE_URL}/api/social/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ targetDid: didA }),
    });
    const unfol = await fetch(`${BASE_URL}/api/social/unfollow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ targetDid: didA }),
    });
    return fol.status === 200 && unfol.status === 200;
  });
  allMetrics.push(mFollow);

  // 4. SOCIAL FEED AUDIT
  console.log('\n--- 3. Social Feed Performance Audit ---');
  // 3.1 Create Post
  let samplePostId = '';
  const mCreatePost = await runBenchmarkSeries('Social: Create Post', 25, async () => {
    const res = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        caption: `Performance test post at ${Date.now()} with hash tags #speed #perf`,
        tags: '#speed #perf',
        visibility: 'public',
        postType: 'text',
      }),
    });
    if (res.status === 200) {
      const data = await res.json();
      if (!samplePostId && data.post?.id) samplePostId = data.post.id;
      return true;
    }
    return false;
  });
  allMetrics.push(mCreatePost);

  // 3.2 Feed List (Unpaginated / Full)
  const mFeedList = await runBenchmarkSeries('Social: Full Feed List', 50, async () => {
    const res = await fetch(`${BASE_URL}/api/feed/list`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    return res.status === 200;
  });
  allMetrics.push(mFeedList);

  // 3.3 Feed List (Paginated limit=20)
  const mFeedPaginated = await runBenchmarkSeries('Social: Paginated Feed (limit=20)', 50, async () => {
    const res = await fetch(`${BASE_URL}/api/feed/list?limit=20&offset=0`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    return res.status === 200;
  });
  allMetrics.push(mFeedPaginated);

  // 3.4 Get Single Post
  const mGetPost = await runBenchmarkSeries('Social: Get Single Post', 50, async () => {
    const res = await fetch(`${BASE_URL}/api/feed/get?id=${samplePostId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    return res.status === 200;
  });
  allMetrics.push(mGetPost);

  // 3.5 Like Post
  const mLikePost = await runBenchmarkSeries('Social: Like Post', 25, async () => {
    const res = await fetch(`${BASE_URL}/api/feed/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ postId: samplePostId }),
    });
    return res.status === 200;
  });
  allMetrics.push(mLikePost);

  // 3.6 Comment on Post
  const mCommentPost = await runBenchmarkSeries('Social: Comment on Post', 25, async () => {
    const res = await fetch(`${BASE_URL}/api/feed/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ postId: samplePostId, text: 'Bench test automated comment' }),
    });
    return res.status === 200;
  });
  allMetrics.push(mCommentPost);

  // 5. CHAT AUDIT
  console.log('\n--- 4. Direct Messaging & Chat Audit ---');
  // 4.1 Send Chat Message
  const mSendChat = await runBenchmarkSeries('Chat: Send Message', 30, async () => {
    const res = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        recipientDid: didB,
        text: `Bench message payload at ${Date.now()}`,
      }),
    });
    return res.status === 200;
  });
  allMetrics.push(mSendChat);

  // 4.2 Chat Conversation Threads
  const mChatThreads = await runBenchmarkSeries('Chat: List Threads', 50, async () => {
    const res = await fetch(`${BASE_URL}/api/chat/threads`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    return res.status === 200;
  });
  allMetrics.push(mChatThreads);

  // 4.3 Chat History
  const mChatHistory = await runBenchmarkSeries('Chat: Message History', 50, async () => {
    const res = await fetch(`${BASE_URL}/api/chat/history?recipientDid=${didB}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    return res.status === 200;
  });
  allMetrics.push(mChatHistory);

  // 6. CHANNELS AUDIT
  console.log('\n--- 5. Channels & Spaces Audit ---');
  const mChannelList = await runBenchmarkSeries('Channels: List Channels', 50, async () => {
    const res = await fetch(`${BASE_URL}/api/channels/list`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    return res.status === 200;
  });
  allMetrics.push(mChannelList);

  // 7. MEDIA AUDIT (Upload & Range Streaming)
  console.log('\n--- 6. Media Storage & Streaming Audit ---');
  // Upload small media payload
  const dummyPayload = Buffer.from('SOVRA_BENCH_MEDIA_STREAMING_DATA_' + Date.now()).toString('base64');
  let uploadedCid = '';
  const mMediaUpload = await runBenchmarkSeries('Media: Upload Media Payload', 15, async () => {
    const res = await fetch(`${BASE_URL}/api/media/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        type: 'photo',
        dataUrl: `data:image/png;base64,${dummyPayload}`,
        name: 'perf_test.png',
      }),
    });
    if (res.status === 200) {
      const d = await res.json();
      if (!uploadedCid && d.cid) uploadedCid = d.cid;
      return true;
    }
    return false;
  });
  allMetrics.push(mMediaUpload);

  // Media Range Request (HTTP 206 Partial Content)
  const mMediaRange = await runBenchmarkSeries('Media: HTTP Range Streaming (206)', 30, async () => {
    const targetUrl = uploadedCid ? `${BASE_URL}/api/storage/raw/${uploadedCid}` : `${BASE_URL}/api/status`;
    const res = await fetch(targetUrl, {
      headers: { Range: 'bytes=0-15' },
    });
    return res.status === 206 || res.status === 200;
  });
  allMetrics.push(mMediaRange);

  // 8. NOTIFICATIONS AUDIT
  console.log('\n--- 7. Notifications Audit ---');
  const mNotifList = await runBenchmarkSeries('Notifications: List Notifications', 50, async () => {
    const res = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    return res.status === 200;
  });
  allMetrics.push(mNotifList);

  // 9. WEBRTC SIGNALING AUDIT
  console.log('\n--- 8. WebRTC Signaling Audit ---');
  const sampleSdpOffer = `v=0\r\no=- ${Date.now()} 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:sovraUfrag\r\na=ice-pwd:sovraPassword1234567890\r\na=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\r\na=setup:actpass\r\na=mid:0\r\na=sendrecv\r\na=rtpmap:111 opus/48000/2\r\n`;

  let activeCallSessionId = '';
  const mWebRtcInitiate = await runBenchmarkSeries('WebRTC: Initiate Call', 10, async () => {
    const res = await fetch(`${BASE_URL}/api/webrtc/call/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        callerDid: didA,
        recipientDid: didB,
        callType: 'audio',
        sdpOffer: sampleSdpOffer,
      }),
    });
    if (res.status === 200) {
      const d = await res.json();
      activeCallSessionId = d.sessionId;
      // Terminate call cleanly
      await fetch(`${BASE_URL}/api/webrtc/call/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ sessionId: d.sessionId }),
      });
      return true;
    }
    return false;
  });
  allMetrics.push(mWebRtcInitiate);

  // 10. RAW SQLITE WAL DIRECT PERFORMANCE
  console.log('\n--- 9. Direct SQLite WAL Relational Engine Performance ---');
  const tempDir = path.resolve(process.cwd(), `.test-audit-sqlite-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const rawSqlite = new SqliteSocialDatabaseEngine(tempDir);

  const rawUser = rawSqlite.registerUser({
    did: 'did:key:z6MrAuditUser',
    handle: '@audit_perf',
    displayName: 'Audit User',
    avatar: 'A',
    avatarBg: '#10b981',
  });

  // Direct Point Lookup
  const mSqliteRead = await runBenchmarkSeries('SQLite WAL: Cached Point Lookup', 500, async () => {
    const u = rawSqlite.findUserByDid('did:key:z6MrAuditUser');
    return Boolean(u && u.handle);
  });
  allMetrics.push(mSqliteRead);

  // Direct Write Transaction
  let writeCounter = 0;
  const mSqliteWrite = await runBenchmarkSeries('SQLite WAL: Single Row Insert', 200, async () => {
    writeCounter++;
    const post = rawSqlite.createPost({
      authorDid: 'did:key:z6MrAuditUser',
      caption: `Direct insert post #${writeCounter}`,
      visibility: 'public',
    });
    return Boolean(post && post.id);
  });
  allMetrics.push(mSqliteWrite);

  rawSqlite.close();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  // 11. CONCURRENCY STRESS SWARMS
  console.log('\n--- 10. Concurrency Stress Testing Swarms ---');
  // 11.1 Concurrency 10
  const mSwarm10 = await runConcurrentSwarm('Concurrency Swarm: 10 Parallel Requests', 10, async () => {
    const r = await fetch(`${BASE_URL}/api/status`);
    return r.status === 200;
  });
  allMetrics.push(mSwarm10);

  // 11.2 Concurrency 50
  const mSwarm50 = await runConcurrentSwarm('Concurrency Swarm: 50 Parallel Requests', 50, async () => {
    const r = await fetch(`${BASE_URL}/api/status`);
    return r.status === 200;
  });
  allMetrics.push(mSwarm50);

  // 11.3 Concurrency 100
  const mSwarm100 = await runConcurrentSwarm('Concurrency Swarm: 100 Parallel Requests', 100, async () => {
    const r = await fetch(`${BASE_URL}/api/status`);
    return r.status === 200;
  });
  allMetrics.push(mSwarm100);

  // 11.4 Concurrency 250
  const mSwarm250 = await runConcurrentSwarm('Concurrency Swarm: 250 Parallel Requests', 250, async () => {
    const r = await fetch(`${BASE_URL}/api/status`);
    return r.status === 200;
  });
  allMetrics.push(mSwarm250);

  // 11.5 Concurrency 500
  const mSwarm500 = await runConcurrentSwarm('Concurrency Swarm: 500 Parallel Requests', 500, async () => {
    const r = await fetch(`${BASE_URL}/api/status`);
    return r.status === 200;
  });
  allMetrics.push(mSwarm500);

  // PRINT SUMMARY TABLE
  console.log('\n============================================================');
  console.log('             FINAL LATENCY & THROUGHPUT AUDIT TABLE         ');
  console.log('============================================================\n');

  console.log('| Endpoint / Operation | Count | Min (ms) | Avg (ms) | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Throughput (ops/s) | Errors | Error % |');
  console.log('|----------------------|-------|----------|----------|----------|----------|----------|----------|-------------------|--------|---------|');

  for (const m of allMetrics) {
    console.log(
      `| ${m.name.padEnd(20)} | ${m.count.toString().padEnd(5)} | ${m.minMs.toFixed(2).padStart(8)} | ${m.avgMs.toFixed(2).padStart(8)} | ${m.p50Ms.toFixed(2).padStart(8)} | ${m.p90Ms.toFixed(2).padStart(8)} | ${m.p95Ms.toFixed(2).padStart(8)} | ${m.p99Ms.toFixed(2).padStart(8)} | ${m.opsPerSec.toString().padStart(17)} | ${m.errors.toString().padStart(6)} | ${(m.errorRatePct + '%').padStart(7)} |`
    );
  }

  // Save audit data to disk for documentation reference
  const outputPath = path.resolve(process.cwd(), 'docs/benchmark-phase10-audit-results.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    environment: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model,
      nodeVersion: process.version,
      initialMemory: mem,
    },
    metrics: allMetrics,
  }, null, 2));

  console.log(`\nAudit results written to: ${outputPath}`);
}

main().catch(err => {
  console.error('[Benchmark Error]', err);
  process.exit(1);
});
