/**
 * @file tests/e2e/call-termination-sync.test.ts
 * SOVRA BIDIRECTIONAL CALL SIGNALING & TERMINATION SYNCHRONIZATION TEST SUITE
 *
 * Verifies standard call termination lifecycle:
 * 1. Caller initiates E2EE call offer to recipient (/api/call/offer)
 * 2. Recipient detects incoming call (/api/call/incoming)
 * 3. Recipient answers call (/api/call/answer)
 * 4. Both peers poll active session status (/api/call/poll) and verify 'answered'
 * 5. Peer A terminates call (/api/call/end)
 * 6. Peer B polls active session status (/api/call/poll) and immediately detects 'ended' with duration and reason
 * 7. Verifies call record and summary message inserted into chat messages
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = 'http://localhost:3001';

describe('Sovra Call Termination & Bidirectional Signaling Sync Gate', () => {
  const ts = Date.now();
  let ewan: { did: string; handle: string; sessionToken: string };
  let meraj: { did: string; handle: string; sessionToken: string };
  let activeCallId: string;

  beforeAll(async () => {
    // 1. Register Ewan
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@ewan_call_${ts}`,
        name: 'Ewan Voice',
        bio: 'E2EE Call Peer 1',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.ok).toBe(true);
    ewan = { did: dataA.user.did, handle: dataA.user.handle, sessionToken: dataA.sessionToken };

    // 2. Register Meraj
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@meraj_call_${ts}`,
        name: 'Meraj Voice',
        bio: 'E2EE Call Peer 2',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.ok).toBe(true);
    meraj = { did: dataB.user.did, handle: dataB.user.handle, sessionToken: dataB.sessionToken };
  });

  it('allows Ewan to initiate a call offer to Meraj', async () => {
    const res = await fetch(`${BASE_URL}/api/call/offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ewan.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: meraj.did,
        offerSdp: 'v=0\r\no=ewan 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
        isVideo: false,
        callType: 'voice',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session).toBeDefined();
    expect(body.session.callId).toBeTruthy();
    expect(['offering', 'ringing']).toContain(body.session.status);
    expect(body.session.callerDid).toBe(ewan.did);
    expect(body.session.recipientDid).toBe(meraj.did);

    activeCallId = body.session.callId;
  });

  it('allows Meraj to detect incoming call from Ewan', async () => {
    const res = await fetch(`${BASE_URL}/api/call/incoming`, {
      headers: {
        Authorization: `Bearer ${meraj.sessionToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.incomingCall).toBeDefined();
    expect(body.incomingCall.callId).toBe(activeCallId);
    expect(body.incomingCall.callerDid).toBe(ewan.did);
    expect(['audio', 'voice']).toContain(body.incomingCall.callType);
  });

  it('allows Meraj to answer the call', async () => {
    const res = await fetch(`${BASE_URL}/api/call/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${meraj.sessionToken}`,
      },
      body: JSON.stringify({
        callId: activeCallId,
        answerSdp: 'v=0\r\no=meraj 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session.status).toBe('answered');
  });

  it('returns status=answered when Ewan polls active signaling session', async () => {
    const res = await fetch(`${BASE_URL}/api/call/poll?callId=${encodeURIComponent(activeCallId)}`, {
      headers: {
        Authorization: `Bearer ${ewan.sessionToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session.status).toBe('answered');
    expect(body.session.callId).toBe(activeCallId);
  });

  it('allows Meraj to disconnect the call via /api/call/end', async () => {
    const res = await fetch(`${BASE_URL}/api/call/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${meraj.sessionToken}`,
      },
      body: JSON.stringify({
        callId: activeCallId,
        reason: 'meraj_hung_up',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session.status).toBe('ended');
    expect(body.session.reason).toBe('meraj_hung_up');
    expect(body.session.durationSec).toBeGreaterThanOrEqual(0);
  });

  it('returns status=ended immediately when Ewan polls the session after Meraj hangs up', async () => {
    // This directly tests the bug: Ewan polling during active call detects remote disconnect
    const res = await fetch(`${BASE_URL}/api/call/poll?callId=${encodeURIComponent(activeCallId)}`, {
      headers: {
        Authorization: `Bearer ${ewan.sessionToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session.status).toBe('ended');
    expect(body.session.reason).toBe('meraj_hung_up');
  });

  it('records an audit call log message between Ewan and Meraj in direct messages', async () => {
    const res = await fetch(`${BASE_URL}/api/chat/messages?peerDid=${encodeURIComponent(meraj.did)}`, {
      headers: {
        Authorization: `Bearer ${ewan.sessionToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.messages)).toBe(true);

    const callEndMsg = body.messages.find((m: any) =>
      typeof m.text === 'string' && m.text.includes('📞') && m.text.includes('ended')
    );
    expect(callEndMsg).toBeDefined();
  });
});
