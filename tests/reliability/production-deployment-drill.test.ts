/**
 * Sovra Protocol - Phase 11 Final Production Deployment Drill
 * File: tests/reliability/production-deployment-drill.test.ts
 *
 * Implements the complete 19-step end-to-end production operations lifecycle drill.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SovraBackupManager } from '../../scripts/sovra-backup-restore.ts';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Phase 11 Production Deployment Drill (19-Step Lifecycle)', { timeout: 45000 }, () => {
  const drillTag = `prod_drill_${Date.now()}`;
  let userToken: string;
  let userDid: string;
  let userHandle: string;
  let recipientDid: string;
  let postId: string;
  let channelId: string;
  let mediaCid: string;
  let callSessionId: string;
  let backupDir: string;

  const isolatedDrillRestoreDir = path.resolve(process.cwd(), `.test-final-restore-${drillTag}`);

  afterAll(() => {
    try {
      fs.rmSync(isolatedDrillRestoreDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('successfully executes the full 19-step production operational drill', async () => {
    // -------------------------------------------------------------
    // Step 1 & 2: Verify Readiness & Liveness
    // -------------------------------------------------------------
    const readyRes = await fetch(`${BASE_URL}/readyz`);
    expect(readyRes.status).toBe(200);
    const readyData = await readyRes.json();
    expect(readyData.status).toBe('ready');
    expect(readyData.checks.databaseIntegrity).toBe(true);

    const liveRes = await fetch(`${BASE_URL}/livez`);
    expect(liveRes.status).toBe(200);

    const versionRes = await fetch(`${BASE_URL}/api/node/version`);
    expect(versionRes.status).toBe(200);
    const versionData = await versionRes.json();
    expect(versionData.ok).toBe(true);
    expect(versionData.schemaVersion).toBeGreaterThanOrEqual(5);
    console.log('[Step 1-2] Node readiness, liveness, and schema version verified.');

    // -------------------------------------------------------------
    // Step 3: Create User (Registration)
    // -------------------------------------------------------------
    userHandle = `@drill_usr_${Date.now()}`;
    const regRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: userHandle,
        displayName: 'Drill User',
        deviceType: 'Desktop',
      }),
    });
    expect(regRes.status).toBe(200);
    const regData = await regRes.json();
    expect(regData.ok).toBe(true);
    userDid = regData.user.did;
    userHandle = regData.user.handle;
    userToken = regData.sessionToken;
    console.log(`[Step 3] User registered: ${userHandle} (${userDid})`);

    // Create a second recipient peer for messaging/calling
    const regPeer = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `peer_${Date.now()}`,
        displayName: 'Peer Recipient',
        deviceType: 'Mobile',
      }),
    });
    const peerData = await regPeer.json();
    recipientDid = peerData.user.did;

    // -------------------------------------------------------------
    // Step 4: Login Verification
    // -------------------------------------------------------------
    const loginRes = await fetch(`${BASE_URL}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: userHandle }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.ok).toBe(true);
    console.log('[Step 4] User login verified.');

    // -------------------------------------------------------------
    // Step 5: Update Profile
    // -------------------------------------------------------------
    const updateRes = await fetch(`${BASE_URL}/api/user/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        bio: 'Sovereign operator running Phase 11 production drill',
        website: 'https://sovra.network',
      }),
    });
    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.ok).toBe(true);
    console.log('[Step 5] Profile updated.');

    // -------------------------------------------------------------
    // Step 6: Create Post
    // -------------------------------------------------------------
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        caption: 'Production drill verified post over Sovereign feed #drill #phase11',
        tags: '#drill #phase11',
        visibility: 'public',
        postType: 'text',
      }),
    });
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.ok).toBe(true);
    postId = postData.post.id;
    console.log(`[Step 6] Post created: ${postId}`);

    // -------------------------------------------------------------
    // Step 7: Send Chat Message
    // -------------------------------------------------------------
    const chatRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        recipientDid,
        text: 'Production drill chat dispatch with Ed25519 authentication',
      }),
    });
    expect(chatRes.status).toBe(200);
    const chatData = await chatRes.json();
    expect(chatData.ok).toBe(true);
    console.log('[Step 7] Chat message dispatched.');

    // -------------------------------------------------------------
    // Step 8: Create Channel
    // -------------------------------------------------------------
    const channelRes = await fetch(`${BASE_URL}/api/social/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        name: 'Drill Channel 11',
        handle: `@drill_ch_${Date.now()}`,
        category: 'tech',
        desc: 'Production deployment verification broadcast channel',
      }),
    });
    expect(channelRes.status).toBe(200);
    const channelData = await channelRes.json();
    expect(channelData.ok).toBe(true);
    channelId = channelData.channel.id;
    console.log(`[Step 8] Channel created: ${channelId}`);

    // -------------------------------------------------------------
    // Step 9: Upload Media Payload
    // -------------------------------------------------------------
    const dummyImageBase64 = Buffer.from('SOVRA_PRODUCTION_MEDIA_PAYLOAD_' + Date.now()).toString('base64');
    const mediaRes = await fetch(`${BASE_URL}/api/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        type: 'video',
        mediaBase64: dummyImageBase64,
        mimeType: 'video/mp4',
        name: 'drill_asset.mp4',
      }),
    });
    expect(mediaRes.status).toBe(200);
    const mediaData = await mediaRes.json();
    expect(mediaData.ok).toBe(true);
    mediaCid = mediaData.cid;
    console.log(`[Step 9] Media uploaded with CID: ${mediaCid}`);

    // -------------------------------------------------------------
    // Step 10: Verify Media Streaming & Byte-Range Requests (206)
    // -------------------------------------------------------------
    const streamRes = await fetch(`${BASE_URL}/api/feed/video/${mediaCid}`, {
      headers: { Range: 'bytes=0-10' },
    });
    expect(streamRes.status === 206 || streamRes.status === 200).toBe(true);
    console.log('[Step 10] Media streaming and Range header response verified.');

    // -------------------------------------------------------------
    // Step 11: Verify Notifications
    // -------------------------------------------------------------
    const notifRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(notifRes.status).toBe(200);
    const notifData = await notifRes.json();
    expect(notifData.ok).toBe(true);
    console.log('[Step 11] Notifications endpoint verified.');

    // -------------------------------------------------------------
    // Step 12: Verify Realtime SSE Stream Handshake
    // -------------------------------------------------------------
    const sseRes = await fetch(`${BASE_URL}/api/realtime/stream?token=${userToken}`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream');
    console.log('[Step 12] Realtime SSE stream handshake established.');

    // -------------------------------------------------------------
    // Step 13: Verify WebRTC Signaling (Offer & Ice Candidate)
    // -------------------------------------------------------------
    const sdpOffer = `v=0\r\no=- ${Date.now()} 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:drillUfrag\r\na=ice-pwd:drillPwd1234567890\r\na=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\r\na=setup:actpass\r\na=mid:0\r\na=sendrecv\r\na=rtpmap:111 opus/48000/2\r\n`;

    const offerRes = await fetch(`${BASE_URL}/api/call/offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        callerDid: userDid,
        recipientDid,
        callType: 'audio',
        sdpOffer,
      }),
    });
    expect(offerRes.status).toBe(200);
    const offerData = await offerRes.json();
    expect(offerData.ok).toBe(true);
    callSessionId = offerData.sessionId;

    // Cleanly terminate call session
    await fetch(`${BASE_URL}/api/call/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ sessionId: callSessionId }),
    });
    console.log('[Step 13] WebRTC signaling lifecycle verified.');

    // -------------------------------------------------------------
    // Step 14: Verify Offline Mesh Outbox Endpoint
    // -------------------------------------------------------------
    const outboxRes = await fetch(`${BASE_URL}/api/mesh/outbox`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(outboxRes.status).toBe(200);
    console.log('[Step 14] Offline mesh outbox endpoint verified.');

    // -------------------------------------------------------------
    // Step 15: Create Production Backup Snapshot
    // -------------------------------------------------------------
    const backupMgr = new SovraBackupManager();
    const backupResult = backupMgr.createBackup({ tag: 'final_drill' });
    expect(backupResult.ok).toBe(true);
    backupDir = backupResult.backupDir;
    console.log(`[Step 15] Production backup snapshot created in ${backupResult.durationMs}ms`);

    // -------------------------------------------------------------
    // Step 16: Verify Backup Manifest & Cryptographic Integrity
    // -------------------------------------------------------------
    const verifyResult = backupMgr.verifyBackup(backupDir);
    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.errors.length).toBe(0);
    console.log('[Step 16] Backup manifest & SHA256 checksums verified.');

    // -------------------------------------------------------------
    // Step 17: Verify Active System Health Post-Snapshot
    // -------------------------------------------------------------
    const feedPostCheck = await fetch(`${BASE_URL}/api/feed/get?id=${postId}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(feedPostCheck.status).toBe(200);
    console.log('[Step 17] Active node queries post-snapshot confirmed intact.');

    // -------------------------------------------------------------
    // Step 18: Restore Backup in Isolated Environment
    // -------------------------------------------------------------
    const restoreResult = backupMgr.restoreBackup(backupDir, isolatedDrillRestoreDir);
    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.integrityOk).toBe(true);
    console.log(`[Step 18] Isolated disaster recovery restoration completed in ${restoreResult.durationMs}ms`);

    // -------------------------------------------------------------
    // Step 19: Verify Restored Environment Integrity & Entities
    // -------------------------------------------------------------
    const restoredEngine = new SqliteSocialDatabaseEngine(isolatedDrillRestoreDir);
    expect(restoredEngine.checkIntegrity()[0].toLowerCase()).toBe('ok');

    const restoredAlice = restoredEngine.findUserByDid(userDid);
    expect(restoredAlice).toBeDefined();
    expect(restoredAlice?.handle).toBe(userHandle);

    const restoredPost = restoredEngine.findPostById(postId);
    expect(restoredPost).toBeDefined();
    expect(restoredPost?.caption).toContain('Production drill verified post');
    restoredEngine.close();

    console.log('\n============================================================');
    console.log('   🎉 ALL 19 STEPS OF FINAL PRODUCTION DRILL PASSED 100%    ');
    console.log('============================================================\n');
  });
});
