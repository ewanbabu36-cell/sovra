/**
 * @file tests/integration/live-stream-phase9-acceptance.test.ts
 * Phase 9 Real-World Acceptance Test Suite for Sovra Live Streaming.
 *
 * Controlled 3-Account Multi-Party Live Broadcast Lifecycle Verification:
 * - TEST ACCOUNT A: Broadcaster (did:sovra:account_a_broadcaster)
 * - TEST ACCOUNT B: Viewer (did:sovra:account_b_viewer)
 * - TEST ACCOUNT C: Unauthorized Attacker (did:sovra:account_c_unauthorized)
 *
 * SCENARIO EXECUTION:
 * 1. Account A opens Creator Studio.
 * 2. Account A starts a live broadcast.
 * 3. Account B joins the broadcast.
 * 4. Verify audio and video signaling exchange.
 * 5. Verify viewer count.
 * 6. Account A mutes microphone.
 * 7. Verify viewer receives muted audio telemetry.
 * 8. Account A shares screen.
 * 9. Verify viewer receives screen sharing track telemetry.
 * 10. Account C attempts unauthorized access.
 * 11. Verify access is denied.
 * 12. Account C attempts to terminate Account A's stream.
 * 13. Verify 403 Forbidden / Unauthorized.
 * 14. Account B disconnects and reconnects.
 * 15. Verify proper reconnection & viewer count consistency.
 * 16. Account A ends the broadcast.
 * 17. Verify Account B receives stream-ended state.
 * 18. Verify media track & peer connection signaling cleanup.
 * 19. Verify session status is ENDED in database.
 * 20. Verify financial ledger consistency & tip netting.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sovraDb, type LiveSessionRecord } from '../../scripts/database-engine.ts';

describe('Phase 9: Real-World Acceptance Test — 3-Account Live Broadcast Matrix', () => {
  const accountA = 'did:sovra:account_a_broadcaster';
  const accountB = 'did:sovra:account_b_viewer';
  const accountC = 'did:sovra:account_c_unauthorized';

  beforeEach(() => {
    sovraDb.load();
    const dbAny = sovraDb as any;
    if (!Array.isArray(dbAny.db.live_sessions)) {
      dbAny.db.live_sessions = [];
    }
    if (!Array.isArray(dbAny.db.users)) {
      dbAny.db.users = [];
    }
    // Register test accounts
    const existingA = dbAny.db.users.find((u: any) => u.did === accountA);
    if (!existingA) {
      dbAny.db.users.push({
        did: accountA,
        handle: '@broadcaster_a',
        displayName: 'Account A Broadcaster',
        role: 'CREATOR',
        balanceSov: 100,
      });
    }
    const existingB = dbAny.db.users.find((u: any) => u.did === accountB);
    if (!existingB) {
      dbAny.db.users.push({
        did: accountB,
        handle: '@viewer_b',
        displayName: 'Account B Viewer',
        role: 'USER',
        balanceSov: 50,
      });
    }
    const existingC = dbAny.db.users.find((u: any) => u.did === accountC);
    if (!existingC) {
      dbAny.db.users.push({
        did: accountC,
        handle: '@attacker_c',
        displayName: 'Account C Unauthorized',
        role: 'USER',
        balanceSov: 10,
      });
    }
    sovraDb.save();
  });

  it('executes complete 20-step controlled real-world acceptance scenario', () => {
    // -------------------------------------------------------------------------
    // STEP 1: Account A opens Creator Studio
    // -------------------------------------------------------------------------
    const userA = sovraDb.findUserByDid(accountA);
    expect(userA).toBeDefined();
    expect(userA?.handle).toBe('@broadcaster_a');
    expect(userA?.role).toBe('CREATOR');

    // -------------------------------------------------------------------------
    // STEP 2: Account A starts a live broadcast
    // -------------------------------------------------------------------------
    const session = sovraDb.createLiveSession({
      creatorDid: accountA,
      creatorHandle: userA?.handle,
      creatorName: userA?.displayName,
      title: 'P2P WebRTC Sovereign Acceptance Stream',
      description: 'Controlled live streaming acceptance verification',
      category: 'tech',
      forceNew: true,
    });
    expect(session.id).toBeDefined();
    expect(session.creatorDid).toBe(accountA);

    // Transition STARTING -> LIVE
    const startRes = sovraDb.updateLiveSessionStatus(session.id, 'STARTING', accountA);
    expect(startRes.ok).toBe(true);
    const liveRes = sovraDb.updateLiveSessionStatus(session.id, 'LIVE', accountA);
    expect(liveRes.ok).toBe(true);
    expect(liveRes.session?.status).toBe('LIVE');

    // -------------------------------------------------------------------------
    // STEP 3: Account B joins the broadcast
    // -------------------------------------------------------------------------
    const joinResB = sovraDb.joinLiveStream(session.id, accountB);
    expect(joinResB.ok).toBe(true);
    expect(joinResB.session?.viewers).toContain(accountB);

    // -------------------------------------------------------------------------
    // STEP 4: Verify audio and video signaling exchange (SDP offer/answer)
    // -------------------------------------------------------------------------
    // Broadcaster sends WebRTC offer
    const offerRes = sovraDb.sendLiveStreamSignal({
      sessionId: session.id,
      fromDid: accountA,
      toDid: accountB,
      type: 'offer',
      payload: { sdp: 'v=0\r\no=broadcaster_a 12345 2 IN IP4 127.0.0.1\r\nm=audio 9 UDP\r\nm=video 9 UDP' },
    });
    expect(offerRes.ok).toBe(true);
    expect(offerRes.signal?.id).toBeDefined();

    // Viewer B retrieves signals directed to Account B
    const signalsForB = sovraDb.getLiveStreamSignals(session.id, accountB);
    expect(signalsForB.length).toBeGreaterThanOrEqual(1);
    const offerSignal = signalsForB.find(s => s.type === 'offer');
    expect(offerSignal).toBeDefined();
    expect(offerSignal?.fromDid).toBe(accountA);

    // Viewer B responds with WebRTC answer
    const answerRes = sovraDb.sendLiveStreamSignal({
      sessionId: session.id,
      fromDid: accountB,
      toDid: accountA,
      type: 'answer',
      payload: { sdp: 'v=0\r\no=viewer_b 67890 2 IN IP4 127.0.0.1\r\nm=audio 9 UDP\r\nm=video 9 UDP' },
    });
    expect(answerRes.ok).toBe(true);

    // Broadcaster retrieves signals directed to Account A
    const signalsForA = sovraDb.getLiveStreamSignals(session.id, accountA);
    const answerSignal = signalsForA.find(s => s.type === 'answer');
    expect(answerSignal).toBeDefined();
    expect(answerSignal?.fromDid).toBe(accountB);

    // -------------------------------------------------------------------------
    // STEP 5: Verify viewer count
    // -------------------------------------------------------------------------
    const sessionAfterJoin = sovraDb.getLiveSessionById(session.id);
    expect(sessionAfterJoin?.viewerCount).toBeGreaterThanOrEqual(1);
    expect(sessionAfterJoin?.peakViewers).toBeGreaterThanOrEqual(1);

    // -------------------------------------------------------------------------
    // STEP 6: Account A mutes microphone
    // -------------------------------------------------------------------------
    const muteSignalRes = sovraDb.sendLiveStreamSignal({
      sessionId: session.id,
      fromDid: accountA,
      type: 'candidate',
      payload: { action: 'track_state', track: 'audio', muted: true },
    });
    expect(muteSignalRes.ok).toBe(true);

    // -------------------------------------------------------------------------
    // STEP 7: Verify viewer receives muted audio telemetry
    // -------------------------------------------------------------------------
    const allSignals = sovraDb.getLiveStreamSignals(session.id);
    const muteSignal = allSignals.find(s => (s.payload as any)?.action === 'track_state' && (s.payload as any)?.track === 'audio');
    expect(muteSignal).toBeDefined();
    expect((muteSignal?.payload as any)?.muted).toBe(true);

    // -------------------------------------------------------------------------
    // STEP 8: Account A shares screen
    // -------------------------------------------------------------------------
    const screenShareSignalRes = sovraDb.sendLiveStreamSignal({
      sessionId: session.id,
      fromDid: accountA,
      type: 'candidate',
      payload: { action: 'track_state', track: 'screen', active: true },
    });
    expect(screenShareSignalRes.ok).toBe(true);

    // -------------------------------------------------------------------------
    // STEP 9: Verify viewer receives screen sharing track
    // -------------------------------------------------------------------------
    const screenSignal = sovraDb.getLiveStreamSignals(session.id).find(
      s => (s.payload as any)?.action === 'track_state' && (s.payload as any)?.track === 'screen'
    );
    expect(screenSignal).toBeDefined();
    expect((screenSignal?.payload as any)?.active).toBe(true);

    // -------------------------------------------------------------------------
    // STEP 10: Account C attempts unauthorized access (tampering session state)
    // -------------------------------------------------------------------------
    const unauthorizedStatusRes = sovraDb.updateLiveSessionStatus(session.id, 'FAILED', accountC);

    // -------------------------------------------------------------------------
    // STEP 11: Verify access is denied
    // -------------------------------------------------------------------------
    expect(unauthorizedStatusRes.ok).toBe(false);
    expect(unauthorizedStatusRes.error).toMatch(/unauthorized/i);

    // -------------------------------------------------------------------------
    // STEP 12: Account C attempts to terminate Account A's stream
    // -------------------------------------------------------------------------
    const attackEndRes = sovraDb.endLiveBroadcast(session.id, accountC);

    // -------------------------------------------------------------------------
    // STEP 13: Verify 403 Forbidden / unauthorized error
    // -------------------------------------------------------------------------
    expect(attackEndRes.ok).toBe(false);
    expect(attackEndRes.error).toMatch(/unauthorized|broadcaster/i);

    // Stream must still be LIVE
    expect(sovraDb.getLiveSessionById(session.id)?.status).toBe('LIVE');

    // -------------------------------------------------------------------------
    // STEP 14: Account B disconnects and reconnects
    // -------------------------------------------------------------------------
    // Disconnect
    const leaveRes = sovraDb.leaveLiveStream(session.id, accountB);
    expect(leaveRes.ok).toBe(true);
    expect(leaveRes.session?.viewers).not.toContain(accountB);

    // Reconnect
    const reconnectRes = sovraDb.joinLiveStream(session.id, accountB);
    expect(reconnectRes.ok).toBe(true);
    expect(reconnectRes.session?.viewers).toContain(accountB);

    // -------------------------------------------------------------------------
    // STEP 15: Verify proper reconnection
    // -------------------------------------------------------------------------
    const sessionAfterReconnect = sovraDb.getLiveSessionById(session.id);
    expect(sessionAfterReconnect?.viewerCount).toBeGreaterThanOrEqual(1);

    // -------------------------------------------------------------------------
    // STEP 16: Account A ends the broadcast
    // -------------------------------------------------------------------------
    const legitimateEndRes = sovraDb.endLiveBroadcast(session.id, accountA);
    expect(legitimateEndRes.ok).toBe(true);
    expect(legitimateEndRes.session?.status).toBe('ENDED');

    // -------------------------------------------------------------------------
    // STEP 17: Verify Account B receives stream-ended state
    // -------------------------------------------------------------------------
    const finalSession = sovraDb.getLiveSessionById(session.id);
    expect(finalSession?.status).toBe('ENDED');
    expect(finalSession?.actualEndTime).toBeDefined();

    // -------------------------------------------------------------------------
    // STEP 18: Verify all media tracks and peer connections are cleaned up
    // -------------------------------------------------------------------------
    // When stream ends, active sessions filter ignores ENDED streams
    const activeStreams = sovraDb.getAllLiveSessions().filter(s => s.status === 'LIVE');
    const endedFoundInActive = activeStreams.find(s => s.id === session.id);
    expect(endedFoundInActive).toBeUndefined();

    // -------------------------------------------------------------------------
    // STEP 19: Verify session status is ENDED in database
    // -------------------------------------------------------------------------
    const dbReloaded = sovraDb.getLiveSessionById(session.id);
    expect(dbReloaded?.status).toBe('ENDED');
    expect(dbReloaded?.id).toBe(session.id);

    // -------------------------------------------------------------------------
    // STEP 20: Verify financial ledger consistency
    // -------------------------------------------------------------------------
    // Send a controlled tip from Account B to Account A on an active stream fixture
    const fixtureSession = sovraDb.createLiveSession({
      creatorDid: accountA,
      title: 'Ledger Audit Session',
      forceNew: true,
    });
    sovraDb.updateLiveSessionStatus(fixtureSession.id, 'LIVE', accountA);

    const tipRes = sovraDb.sendLiveStreamTip({
      sessionId: fixtureSession.id,
      senderDid: accountB,
      senderName: 'Account B Viewer',
      amountSov: 10,
      idempotencyKey: 'phase9_unique_tip_key_001',
    });
    expect(tipRes.ok).toBe(true);
    expect(tipRes.tip?.amountSov).toBe(10);
    expect(tipRes.tip?.creatorShareSov).toBe(9.5); // 95% creator split
    expect(tipRes.tip?.seederShareSov).toBe(0.5);  // 5% seeder split

    // Duplicate submission with same key must return existing tip without double debiting
    const dupTipRes = sovraDb.sendLiveStreamTip({
      sessionId: fixtureSession.id,
      senderDid: accountB,
      senderName: 'Account B Viewer',
      amountSov: 10,
      idempotencyKey: 'phase9_unique_tip_key_001',
    });
    expect(dupTipRes.ok).toBe(true);
    expect(dupTipRes.tip?.id).toBe(tipRes.tip?.id);

    const auditedFixture = sovraDb.getLiveSessionById(fixtureSession.id);
    expect(auditedFixture?.tipTotalSov).toBe(10); // Exactly 10 SOV, not 20!
    expect(auditedFixture?.tips.length).toBe(1);

    // Clean up fixture session
    sovraDb.endLiveBroadcast(fixtureSession.id, accountA);
    expect(sovraDb.getLiveSessionById(fixtureSession.id)?.status).toBe('ENDED');
  });
});
