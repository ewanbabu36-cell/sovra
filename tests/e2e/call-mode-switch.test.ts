/**
 * @file tests/e2e/call-mode-switch.test.ts
 * SOVRA BIDIRECTIONAL CALL MODE SWITCHING (AUDIO <-> VIDEO) E2E SUITE
 *
 * Verifies:
 * 1. UI contains WhatsApp Web-style quick switch pill (#callSwitchToVideoPillWrap & #callSwitchToVideoPillBtn)
 * 2. UI contains video top HUD voice switch button (#callTopVoiceModeBtn)
 * 3. Client functions window.switchCallMode, window.toggleCallMode, window.handleRemoteCallModeSwitch exist
 * 4. Active audio call session can be upgraded to video mode seamlessly via POST /api/call/switch-mode
 * 5. Active video call session can be downgraded to voice mode seamlessly via POST /api/call/switch-mode
 * 6. Session polling reflects updated callType ('video' and 'audio')
 * 7. BOLA/IDOR protection: unauthorized principals are forbidden (403) from switching call modes
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Sovra Bidirectional Audio <-> Video Call Mode Switching', () => {
  const ts = Date.now();
  let caller: { did: string; handle: string; sessionToken: string };
  let callee: { did: string; handle: string; sessionToken: string };
  let attacker: { did: string; handle: string; sessionToken: string };
  let callId: string;

  beforeAll(async () => {
    // 1. Register caller
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@mode_caller_${ts}`,
        name: 'Mode Caller',
      }),
    });
    const dataA = await resA.json();
    caller = { did: dataA.user.did, handle: dataA.user.handle, sessionToken: dataA.sessionToken };

    // 2. Register callee
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@mode_callee_${ts}`,
        name: 'Mode Callee',
      }),
    });
    const dataB = await resB.json();
    callee = { did: dataB.user.did, handle: dataB.user.handle, sessionToken: dataB.sessionToken };

    // 3. Register third-party attacker
    const resC = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@mode_attacker_${ts}`,
        name: 'Mode Attacker',
      }),
    });
    const dataC = await resC.json();
    attacker = { did: dataC.user.did, handle: dataC.user.handle, sessionToken: dataC.sessionToken };
  });

  it('serves call UI elements for switching between audio and video modes', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // WhatsApp-style switch-to-video pill button in audio stage
    expect(html).toContain('id="callSwitchToVideoPillWrap"');
    expect(html).toContain('id="callSwitchToVideoPillBtn"');
    expect(html).toContain('📹 Switch to Video Call');

    // Voice mode return button in video HUD top
    expect(html).toContain('id="callTopVoiceModeBtn"');
    expect(html).toContain('📱 Voice Mode');

    // Dock control buttons
    expect(html).toContain('id="callModeSwitchBtn"');
    expect(html).toContain('id="callVideoBtn"');

    // Client-side switching functions
    expect(html).toContain('function switchCallMode(');
    expect(html).toContain('function toggleCallMode(');
    expect(html).toContain('function handleRemoteCallModeSwitch(');
    expect(html).toContain('window.switchCallMode = switchCallMode;');
    expect(html).toContain('window.handleRemoteCallModeSwitch = handleRemoteCallModeSwitch;');
  });

  it('initiates an audio call and establishes answered session', async () => {
    // Caller creates audio offer
    const offerRes = await fetch(`${BASE_URL}/api/call/offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caller.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: callee.did,
        offerSdp: 'v=0\r\no=- 1111 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',
        callType: 'audio',
      }),
    });
    expect(offerRes.status).toBe(200);
    const offerData = await offerRes.json();
    expect(offerData.ok).toBe(true);
    expect(offerData.session.callType).toBe('audio');
    callId = offerData.session.callId;

    // Callee answers call
    const ansRes = await fetch(`${BASE_URL}/api/call/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${callee.sessionToken}`,
      },
      body: JSON.stringify({
        callId,
        answerSdp: 'v=0\r\no=- 2222 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',
      }),
    });
    expect(ansRes.status).toBe(200);
    const ansData = await ansRes.json();
    expect(ansData.ok).toBe(true);
    expect(ansData.session.status).toBe('answered');
    expect(ansData.session.callType).toBe('audio');
  });

  it('allows caller to switch call mode from audio to video mid-call', async () => {
    const switchRes = await fetch(`${BASE_URL}/api/call/switch-mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caller.sessionToken}`,
      },
      body: JSON.stringify({
        callId,
        mode: 'video',
      }),
    });
    expect(switchRes.status).toBe(200);
    const switchData = await switchRes.json();
    expect(switchData.ok).toBe(true);
    expect(switchData.mode).toBe('video');
    expect(switchData.callId).toBe(callId);

    // Verify session poll reflects video mode
    const pollRes = await fetch(`${BASE_URL}/api/call/poll?callId=${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${callee.sessionToken}` },
    });
    expect(pollRes.status).toBe(200);
    const pollData = await pollRes.json();
    expect(pollData.ok).toBe(true);
    expect(pollData.session.callType).toBe('video');
  });

  it('allows callee to switch call mode from video back to audio (vice-versa) mid-call', async () => {
    const switchRes = await fetch(`${BASE_URL}/api/call/switch-mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${callee.sessionToken}`,
      },
      body: JSON.stringify({
        callId,
        mode: 'audio',
      }),
    });
    expect(switchRes.status).toBe(200);
    const switchData = await switchRes.json();
    expect(switchData.ok).toBe(true);
    expect(switchData.mode).toBe('audio');

    // Verify session poll reflects audio mode
    const pollRes = await fetch(`${BASE_URL}/api/call/poll?callId=${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${caller.sessionToken}` },
    });
    expect(pollRes.status).toBe(200);
    const pollData = await pollRes.json();
    expect(pollData.ok).toBe(true);
    expect(pollData.session.callType).toBe('audio');
  });

  it('enforces authorization and prevents unauthorized third parties from switching call modes', async () => {
    // Attacker tries to switch mode on caller/callee's call
    const badSwitch = await fetch(`${BASE_URL}/api/call/switch-mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${attacker.sessionToken}`,
      },
      body: JSON.stringify({
        callId,
        mode: 'video',
      }),
    });
    expect(badSwitch.status).toBe(403);
    const badData = await badSwitch.json();
    expect(badData.ok).toBe(false);
    expect(badData.error).toContain('Unauthorized');

    // Missing callId returns 400
    const missingRes = await fetch(`${BASE_URL}/api/call/switch-mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caller.sessionToken}`,
      },
      body: JSON.stringify({
        mode: 'video',
      }),
    });
    expect(missingRes.status).toBe(400);

    // Non-existent callId returns 404
    const notFoundRes = await fetch(`${BASE_URL}/api/call/switch-mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caller.sessionToken}`,
      },
      body: JSON.stringify({
        callId: 'non-existent-call-id',
        mode: 'video',
      }),
    });
    expect(notFoundRes.status).toBe(404);
  });

  it('terminates call cleanly and resets session', async () => {
    const endRes = await fetch(`${BASE_URL}/api/call/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caller.sessionToken}`,
      },
      body: JSON.stringify({
        callId,
        reason: 'user_hung_up',
      }),
    });
    expect(endRes.status).toBe(200);
    const endData = await endRes.json();
    expect(endData.ok).toBe(true);
    expect(endData.session.status).toBe('ended');
  });
});
