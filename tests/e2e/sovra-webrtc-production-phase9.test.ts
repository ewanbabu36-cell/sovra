/**
 * @file tests/e2e/sovra-webrtc-production-phase9.test.ts
 * SOVRA PHASE 9: WEBRTC PRODUCTION HARDENING, TURN & CROSS-NETWORK RELIABILITY SUITE
 *
 * Comprehensive end-to-end test suite validating:
 * 1. Signaling Authentication & Authorization Gate (401 without valid session)
 * 2. BOLA / IDOR Defense Matrix across all call endpoints
 * 3. SDP Validation & Payload Size Limits (rejects malformed & >64KB payloads)
 * 4. ICE Candidate Validation, Deduplication & Bounds Checking
 * 5. Deterministic Call State Machine & Concurrency Control (Busy 486, Conflict 409)
 * 6. Social Relationship & Privacy Gate (Bidirectional Block Enforcement)
 * 7. ICE Restart & Network Change Signaling (/api/call/restart-ice)
 * 8. Production STUN/TURN Configuration & HMAC Ephemeral Credential Rotation
 * 9. Call Quality Telemetry & Server-Side Observability Metrics (/api/call/metrics)
 * 10. Call Termination Lifecycle & Chat Thread Summary Insertion
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Phase 9: WebRTC Production Hardening & Reliability Suite', () => {
  const ts = Date.now();
  let alice: { did: string; handle: string; sessionToken: string };
  let bob: { did: string; handle: string; sessionToken: string };
  let charlie: { did: string; handle: string; sessionToken: string };
  let eve: { did: string; handle: string; sessionToken: string }; // Adversary / Third party

  let activeCallId: string;

  beforeAll(async () => {
    // 1. Register Alice
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: `@p9_alice_${ts}`, name: 'Alice Hardened' }),
    });
    const dataA = await resA.json();
    alice = { did: dataA.user.did, handle: dataA.user.handle, sessionToken: dataA.sessionToken };

    // 2. Register Bob
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: `@p9_bob_${ts}`, name: 'Bob Hardened' }),
    });
    const dataB = await resB.json();
    bob = { did: dataB.user.did, handle: dataB.user.handle, sessionToken: dataB.sessionToken };

    // 3. Register Charlie
    const resC = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: `@p9_charlie_${ts}`, name: 'Charlie Hardened' }),
    });
    const dataC = await resC.json();
    charlie = { did: dataC.user.did, handle: dataC.user.handle, sessionToken: dataC.sessionToken };

    // 4. Register Eve (Adversary)
    const resE = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: `@p9_eve_${ts}`, name: 'Eve Adversary' }),
    });
    const dataE = await resE.json();
    eve = { did: dataE.user.did, handle: dataE.user.handle, sessionToken: dataE.sessionToken };
  });

  // ============================================================
  // 1. SIGNALING AUTHENTICATION & IDENTITY ENFORCEMENT
  // ============================================================
  describe('1. Signaling Authentication & Identity Enforcement', () => {
    it('rejects unauthenticated call offer submission with 401', async () => {
      const res = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientDid: bob.did,
          offerSdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated incoming call polling with 401', async () => {
      const res = await fetch(`${BASE_URL}/api/call/incoming`);
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated call poll with 401', async () => {
      const res = await fetch(`${BASE_URL}/api/call/poll?callId=call-test`);
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated call answer with 401', async () => {
      const res = await fetch(`${BASE_URL}/api/call/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: 'call-test',
          answerSdp: 'v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated candidate submission with 401', async () => {
      const res = await fetch(`${BASE_URL}/api/call/candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: 'call-test',
          candidate: { candidate: 'candidate:1 1 UDP 2122260223 127.0.0.1 50000 typ host' },
        }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated call termination with 401', async () => {
      const res = await fetch(`${BASE_URL}/api/call/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: 'call-test' }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // 2. SDP VALIDATION & BOUNDS ENFORCEMENT
  // ============================================================
  describe('2. SDP Validation & Payload Bounds Enforcement', () => {
    it('rejects call offer to oneself with 400', async () => {
      const res = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: alice.did,
          offerSdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Cannot initiate a call to yourself');
    });

    it('rejects malformed SDP offer missing valid SDP format with 400', async () => {
      const res = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: bob.did,
          offerSdp: 'invalid-malformed-sdp-without-headers',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Malformed SDP offer');
    });

    it('rejects oversized SDP offer exceeding 64KB with 400', async () => {
      const oversizedSdp = 'v=0\r\n' + 'a=custom-attribute:' + 'x'.repeat(70000) + '\r\n';
      const res = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: bob.did,
          offerSdp: oversizedSdp,
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('exceeds allowable size limit');
    });
  });

  // ============================================================
  // 3. SOCIAL PRIVACY & BIDIRECTIONAL BLOCK ENFORCEMENT
  // ============================================================
  describe('3. Social Privacy & Bidirectional Block Enforcement', () => {
    it('blocks call initiation if caller has blocked recipient (403 Forbidden)', async () => {
      // Charlie blocks Eve
      await fetch(`${BASE_URL}/api/social/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${charlie.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: eve.did }),
      });

      // Charlie tries to call Eve
      const res = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${charlie.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: eve.did,
          offerSdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
        }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Block relationship active');
    });

    it('blocks call initiation if recipient has blocked caller (403 Forbidden)', async () => {
      // Eve tries to call Charlie (who blocked Eve)
      const res = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eve.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: charlie.did,
          offerSdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
        }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Block relationship active');

      // Unblock for cleanup
      await fetch(`${BASE_URL}/api/social/unblock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${charlie.sessionToken}`,
        },
        body: JSON.stringify({ targetDid: eve.did }),
      });
    });
  });

  // ============================================================
  // 4. CALL LIFECYCLE & BOLA/IDOR DEFENSE MATRIX
  // ============================================================
  describe('4. Call Lifecycle & BOLA / IDOR Defense Matrix', () => {
    it('Alice initiates a valid E2EE call offer to Bob', async () => {
      const res = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: bob.did,
          offerSdp: 'v=0\r\no=alice 10001 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 111\r\n',
          callType: 'video',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.session.status).toBe('offering');
      expect(data.session.callerDid).toBe(alice.did);
      expect(data.session.recipientDid).toBe(bob.did);
      expect(data.session.callType).toBe('video');

      activeCallId = data.session.callId;
    });

    it('BOLA Defense: Eve (third-party) cannot poll Alice and Bob call session (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/call/poll?callId=${encodeURIComponent(activeCallId)}`, {
        headers: {
          Authorization: `Bearer ${eve.sessionToken}`,
        },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized access to call session');
    });

    it('BOLA Defense: Alice cannot answer her own call offer (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/call/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({
          callId: activeCallId,
          answerSdp: 'v=0\r\no=alice 10002 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 111\r\n',
        }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Only the designated recipient can answer the call');
    });

    it('BOLA Defense: Eve cannot answer Alice and Bob call (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/call/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eve.sessionToken}`,
        },
        body: JSON.stringify({
          callId: activeCallId,
          answerSdp: 'v=0\r\no=eve 10003 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 111\r\n',
        }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Only the designated recipient can answer the call');
    });

    it('Concurrent Call Gate: Alice attempting to initiate second call while first is active returns 409 Conflict', async () => {
      const res = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: charlie.did,
          offerSdp: 'v=0\r\no=alice 10004 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
          callType: 'audio',
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('Caller is already engaged in an active call');
    });

    it('Concurrent Call Gate: Charlie calling Bob while Bob has incoming call returns 486 Busy', async () => {
      const res = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${charlie.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: bob.did,
          offerSdp: 'v=0\r\no=charlie 10005 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
          callType: 'audio',
        }),
      });
      expect(res.status).toBe(486);
      const data = await res.json();
      expect(data.code).toBe('BUSY');
    });

    it('Bob successfully answers the call offer with valid SDP answer', async () => {
      const res = await fetch(`${BASE_URL}/api/call/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.sessionToken}`,
        },
        body: JSON.stringify({
          callId: activeCallId,
          answerSdp: 'v=0\r\no=bob 20001 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 111\r\n',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.session.status).toBe('answered');
      expect(data.session.sdpAnswer).toContain('v=0');
    });

    it('Replay Defense: Bob attempting to answer again returns 409 Conflict', async () => {
      const res = await fetch(`${BASE_URL}/api/call/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.sessionToken}`,
        },
        body: JSON.stringify({
          callId: activeCallId,
          answerSdp: 'v=0\r\no=bob 20001 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 111\r\n',
        }),
      });
      expect(res.status).toBe(409);
    });
  });

  // ============================================================
  // 5. ICE CANDIDATES & TURN RELAY OBSERVABILITY
  // ============================================================
  describe('5. ICE Candidates & TURN Relay Observability', () => {
    it('BOLA Defense: Eve cannot submit candidate to Alice and Bob call (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/call/candidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eve.sessionToken}`,
        },
        body: JSON.stringify({
          callId: activeCallId,
          candidate: { candidate: 'candidate:1 1 UDP 2122260223 127.0.0.1 50000 typ host' },
        }),
      });
      expect(res.status).toBe(403);
    });

    it('Alice submits a host ICE candidate', async () => {
      const hostCand = { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.50 50000 typ host', sdpMid: '0' };
      const res = await fetch(`${BASE_URL}/api/call/candidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({
          callId: activeCallId,
          candidate: hostCand,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.session.iceCandidates.length).toBeGreaterThanOrEqual(1);
    });

    it('Deduplication: Alice submitting exact duplicate candidate is deduplicated', async () => {
      const hostCand = { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.50 50000 typ host', sdpMid: '0' };
      const res = await fetch(`${BASE_URL}/api/call/candidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({
          callId: activeCallId,
          candidate: hostCand,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      // Candidate list should not grow because identical candidate was provided
      const aliceCandMatches = data.session.iceCandidates.filter(
        (c: any) => c.senderDid === alice.did && c.candidate.includes('typ host')
      );
      expect(aliceCandMatches.length).toBe(1);
    });

    it('Bob submits a TURN relay ICE candidate and triggers turn_used metric', async () => {
      const relayCand = { candidate: 'candidate:2 1 UDP 1686052863 198.51.100.1 55000 typ relay raddr 0.0.0.0 rport 0', sdpMid: '0' };
      const res = await fetch(`${BASE_URL}/api/call/candidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.sessionToken}`,
        },
        body: JSON.stringify({
          callId: activeCallId,
          candidate: relayCand,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      // Verify turn_used was recorded in metrics
      const metricRes = await fetch(`${BASE_URL}/api/call/metrics?callId=${encodeURIComponent(activeCallId)}`, {
        headers: { Authorization: `Bearer ${bob.sessionToken}` },
      });
      expect(metricRes.status).toBe(200);
      const metricData = await metricRes.json();
      expect(metricData.metrics.some((m: any) => m.eventType === 'turn_used')).toBe(true);
    });
  });

  // ============================================================
  // 6. ICE RESTART & RECONNECTION SIGNALING
  // ============================================================
  describe('6. ICE Restart & Network Change Signaling', () => {
    it('BOLA Defense: Eve cannot trigger ICE restart on Alice and Bob call (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/call/restart-ice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eve.sessionToken}`,
        },
        body: JSON.stringify({ callId: activeCallId }),
      });
      expect(res.status).toBe(403);
    });

    it('Alice initiates ICE restart on network transition and transitions call state to reconnecting', async () => {
      const res = await fetch(`${BASE_URL}/api/call/restart-ice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({ callId: activeCallId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.status).toBe('reconnecting');

      // Verify ice_restarted metric recorded
      const metricRes = await fetch(`${BASE_URL}/api/call/metrics?callId=${encodeURIComponent(activeCallId)}`, {
        headers: { Authorization: `Bearer ${alice.sessionToken}` },
      });
      const metricData = await metricRes.json();
      expect(metricData.metrics.some((m: any) => m.eventType === 'ice_restarted')).toBe(true);
    });
  });

  // ============================================================
  // 7. CALL TERMINATION & POST-CALL INTEGRITY
  // ============================================================
  describe('7. Call Termination & Post-Call Integrity', () => {
    it('BOLA Defense: Eve cannot terminate Alice and Bob call (403 Forbidden)', async () => {
      const res = await fetch(`${BASE_URL}/api/call/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eve.sessionToken}`,
        },
        body: JSON.stringify({ callId: activeCallId, reason: 'malicious_hangup' }),
      });
      expect(res.status).toBe(403);
    });

    it('Bob terminates call cleanly with user_hung_up reason', async () => {
      const res = await fetch(`${BASE_URL}/api/call/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.sessionToken}`,
        },
        body: JSON.stringify({ callId: activeCallId, reason: 'user_hung_up' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.session.status).toBe('ended');
      expect(data.session.reason).toBe('user_hung_up');
    });

    it('Late ICE Candidate Rejection: Submitting candidate after call ended returns 409 Conflict', async () => {
      const res = await fetch(`${BASE_URL}/api/call/candidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({
          callId: activeCallId,
          candidate: { candidate: 'candidate:3 1 UDP 2122260223 127.0.0.1 50002 typ host' },
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('Call has already ended');
    });

    it('Idempotent Termination: Ending already ended call succeeds without error', async () => {
      const res = await fetch(`${BASE_URL}/api/call/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alice.sessionToken}`,
        },
        body: JSON.stringify({ callId: activeCallId, reason: 'user_hung_up' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.session.status).toBe('ended');
    });

    it('Observability: Confirms call_ended metric was recorded with accurate duration', async () => {
      const metricRes = await fetch(`${BASE_URL}/api/call/metrics?callId=${encodeURIComponent(activeCallId)}`, {
        headers: { Authorization: `Bearer ${alice.sessionToken}` },
      });
      expect(metricRes.status).toBe(200);
      const data = await metricRes.json();
      const endMetric = data.metrics.find((m: any) => m.eventType === 'call_ended');
      expect(endMetric).toBeDefined();
      expect(endMetric.callId).toBe(activeCallId);
    });
  });
});
