/**
 * @file tests/e2e/video-call-verification.test.ts
 * SOVRA REAL-TIME ENCRYPTED VIDEO CALL ENGINE & DUAL-MODE UI VERIFICATION SUITE
 *
 * Verifies:
 * 1. UI contains dual-mode Audio & Video stages inside #e2eeCallModal
 * 2. Remote video feed (#remoteVideoFeed) and local self-view (#localVideoFeed) elements exist
 * 3. Fallback high-definition canvas peer video generator (#peerVideoCanvas) exists
 * 4. Mode switching (#callModeSwitchBtn) and camera toggle (#callVideoBtn) controls exist
 * 5. Fullscreen toggle and live 1080p HUD elements exist
 * 6. Responsive .is-video-call styling is present in CSS
 * 7. Backend WebRTC signaling offer with callType='video' is correctly stored and polled as 'video'
 * 8. Recipient correctly detects incoming callType='video'
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Sovra E2EE Video Call Engine & Responsive UI Verification Gate', () => {
  const ts = Date.now();
  let caller: { did: string; handle: string; sessionToken: string };
  let callee: { did: string; handle: string; sessionToken: string };
  let videoCallId: string;

  beforeAll(async () => {
    // Register caller
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@caller_vid_${ts}`,
        name: 'Caller Video Test',
        bio: 'P2P Video Tester 1',
      }),
    });
    const dataA = await resA.json();
    caller = { did: dataA.user.did, handle: dataA.user.handle, sessionToken: dataA.sessionToken };

    // Register callee
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@callee_vid_${ts}`,
        name: 'Callee Video Test',
        bio: 'P2P Video Tester 2',
      }),
    });
    const dataB = await resB.json();
    callee = { did: dataB.user.did, handle: dataB.user.handle, sessionToken: dataB.sessionToken };
  });

  it('serves dashboard HTML with dual-mode audio/video call stage architecture', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // 1. Dual-stage call containers
    expect(html).toContain('id="e2eeCallModalCard"');
    expect(html).toContain('id="callAudioStage"');
    expect(html).toContain('id="callVideoStage"');

    // 2. Video elements
    expect(html).toContain('id="remoteVideoFeed"');
    expect(html).toContain('id="localVideoFeed"');
    expect(html).toContain('id="remoteVideoFallback"');
    expect(html).toContain('id="peerVideoCanvas"');

    // 3. Floating HUD and PiP container
    expect(html).toContain('id="callVideoHudTop"');
    expect(html).toContain('LIVE HD 1080p');
    expect(html).toContain('id="callVideoTimer"');
    expect(html).toContain('id="localVideoContainer"');

    // 4. Call controls
    expect(html).toContain('id="callMuteBtn"');
    expect(html).toContain('id="callVideoBtn"');
    expect(html).toContain('id="callModeSwitchBtn"');
    expect(html).toContain('id="callEndBtn"');

    // 5. CSS styling for video mode
    expect(html).toContain('#e2eeCallModalCard.is-video-call');
  });

  it('contains client-side video stream acquisition, virtual camera fallback, and canvas generator', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    expect(html).toContain('function applyCallLayoutMode()');
    expect(html).toContain('function setupLocalCameraStream()');
    expect(html).toContain('function setupRemotePeerVideoStream(');
    expect(html).toContain('function initVirtualLocalCameraStream()');
    expect(html).toContain('function toggleCallVideo()');
    expect(html).toContain('function toggleCallMode()');
    expect(html).toContain('function toggleVideoCallFullscreen()');
    expect(html).toContain('function cleanupActiveCallSession()');
  });

  it('handles backend WebRTC video signaling lifecycle (offer -> incoming -> answer -> poll)', async () => {
    // 1. Caller offers video call
    const offerRes = await fetch(`${BASE_URL}/api/call/offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caller.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: callee.did,
        offerSdp: 'v=0\r\no=- 461173 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv\r\nm=video 9 UDP/TLS/RTP/SAVPF 111',
        callType: 'video',
      }),
    });
    expect(offerRes.status).toBe(200);
    const offerData = await offerRes.json();
    expect(offerData.ok).toBe(true);
    expect(offerData.session.callType).toBe('video');
    videoCallId = offerData.session.callId;

    // 2. Callee detects incoming video call
    const incRes = await fetch(`${BASE_URL}/api/call/incoming`, {
      headers: { Authorization: `Bearer ${callee.sessionToken}` },
    });
    expect(incRes.status).toBe(200);
    const incData = await incRes.json();
    expect(incData.ok).toBe(true);
    expect(incData.incomingCall).toBeDefined();
    expect(incData.incomingCall.callId).toBe(videoCallId);
    expect(incData.incomingCall.callType).toBe('video');

    // 3. Callee answers video call
    const ansRes = await fetch(`${BASE_URL}/api/call/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${callee.sessionToken}`,
      },
      body: JSON.stringify({
        callId: videoCallId,
        answerSdp: 'v=0\r\no=- 461173 3 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv\r\nm=video 9 UDP/TLS/RTP/SAVPF 111',
      }),
    });
    expect(ansRes.status).toBe(200);
    const ansData = await ansRes.json();
    expect(ansData.ok).toBe(true);
    expect(ansData.session.status).toBe('answered');
    expect(ansData.session.callType).toBe('video');

    // 4. Caller polls and verifies video session answered
    const pollRes = await fetch(`${BASE_URL}/api/call/poll?callId=${encodeURIComponent(videoCallId)}`, {
      headers: { Authorization: `Bearer ${caller.sessionToken}` },
    });
    expect(pollRes.status).toBe(200);
    const pollData = await pollRes.json();
    expect(pollData.ok).toBe(true);
    expect(pollData.session.status).toBe('answered');
    expect(pollData.session.callType).toBe('video');

    // 5. Caller terminates video call
    const endRes = await fetch(`${BASE_URL}/api/call/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caller.sessionToken}`,
      },
      body: JSON.stringify({
        callId: videoCallId,
        reason: 'user_hung_up',
      }),
    });
    expect(endRes.status).toBe(200);
    const endData = await endRes.json();
    expect(endData.ok).toBe(true);
    expect(endData.session.status).toBe('ended');
  });
});
