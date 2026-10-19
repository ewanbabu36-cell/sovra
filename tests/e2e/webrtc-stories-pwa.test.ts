import { describe, it, expect, beforeAll } from 'vitest';
import http from 'node:http';

const BASE_URL = 'http://127.0.0.1:3001';

describe('Sovra Loop Iteration #7: WebRTC Calling, Ephemeral Stories & Offline PWA Suite', () => {
  const ts = Date.now();
  let callerUser: { did: string; handle: string; sessionToken: string };
  let calleeUser: { did: string; handle: string; sessionToken: string };

  const fetchServedHtml = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      http.get(BASE_URL, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });
  };

  beforeAll(async () => {
    // 1. Register Caller User
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@call_alice_${ts}`,
        name: 'Alice Caller',
        bio: 'WebRTC Test Caller',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.ok).toBe(true);
    callerUser = { did: dataA.user.did, handle: dataA.user.handle, sessionToken: dataA.sessionToken };

    // 2. Register Callee User
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@call_bob_${ts}`,
        name: 'Bob Callee',
        bio: 'WebRTC Test Callee',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.ok).toBe(true);
    calleeUser = { did: dataB.user.did, handle: dataB.user.handle, sessionToken: dataB.sessionToken };
  });

  describe('1. WhatsApp-Grade WebRTC Audio/Video Call HUD & Client Engine', () => {
    it('serves call overlay and floating PiP modal hidden by default to avoid screen freezing', async () => {
      const html = await fetchServedHtml();

      // Fullscreen Call Overlay HUD
      expect(html).toContain('id="spatialCallOverlay"');
      expect(html).toMatch(/id="spatialCallOverlay"[^>]*style="[^"]*display:\s*none/i);

      // Floating PiP HUD
      expect(html).toContain('id="spatialCallPipFloating"');
      expect(html).toMatch(/id="spatialCallPipFloating"[^>]*style="[^"]*display:\s*none/i);
    });

    it('contains all essential call HUD controls, video streams, status labels, and timers', async () => {
      const html = await fetchServedHtml();

      // Video streams & avatar displays
      expect(html).toContain('id="spatialRemoteVideo"');
      expect(html).toContain('id="spatialLocalVideo"');
      expect(html).toContain('id="spatialCallAvatarIcon"');
      expect(html).toContain('id="spatialCallPeerName"');
      expect(html).toContain('id="spatialCallStatusText"');
      expect(html).toContain('id="spatialCallDuration"');

      // Call action controls
      expect(html).toContain('id="btnToggleCallMic"');
      expect(html).toContain('id="btnToggleCallCamera"');
      expect(html).toContain('id="btnToggleCallScreenShare"');
      expect(html).toContain('id="btnMinimizeCallPip"');
      expect(html).toContain('id="spatialCallEndBtn"');
      expect(html).toContain('id="spatialCallAcceptBtn"');
      expect(html).toContain('id="spatialCallDeclineBtn"');
    });

    it('includes full client-side spatial calling state machine and signaling listeners', async () => {
      const html = await fetchServedHtml();

      // Client functions for call lifecycle
      expect(html).toContain('function openSpatialCallOverlay(');
      expect(html).toContain('function closeSpatialCallOverlay(');
      expect(html).toContain('function acceptSpatialCall(');
      expect(html).toContain('function declineSpatialCall(');
      expect(html).toContain('function endSpatialCall(');
      expect(html).toContain('function minimizeSpatialCallToPip(');
      expect(html).toContain('function expandSpatialCallFromPip(');
      expect(html).toContain('function toggleSpatialCallMic(');
      expect(html).toContain('function toggleSpatialCallCamera(');
      expect(html).toContain('function toggleSpatialCallScreenShare(');
      expect(html).toContain('function handleSpatialCallSignal(');
    });
  });

  describe('2. WebRTC Signaling Routes & Auto-Inserted Chat Bubbles', () => {
    it('executes call offer, answer, and termination with automated chat bubble insertion', async () => {
      // 1. Create Call Offer from Alice to Bob
      const offerRes = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${callerUser.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: calleeUser.did,
          offerSdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
          callType: 'video',
        }),
      });
      expect(offerRes.status).toBe(200);
      const offerData = await offerRes.json();
      expect(offerData.ok).toBe(true);
      const callId = offerData.session?.callId || offerData.sessionId;
      expect(callId).toBeDefined();

      // 2. Callee checks incoming call
      const incomingRes = await fetch(`${BASE_URL}/api/call/incoming`, {
        headers: {
          'Authorization': `Bearer ${calleeUser.sessionToken}`,
        },
      });
      expect(incomingRes.status).toBe(200);
      const incomingData = await incomingRes.json();
      expect(incomingData.ok).toBe(true);
      expect(incomingData.incomingCall?.callId).toBe(callId);
      expect(incomingData.incomingCall?.callType).toBe('video');

      // 3. Callee accepts and submits answer SDP
      const answerRes = await fetch(`${BASE_URL}/api/call/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${calleeUser.sessionToken}`,
        },
        body: JSON.stringify({
          callId,
          answerSdp: 'v=0\r\no=- 54321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
        }),
      });
      expect(answerRes.status).toBe(200);
      const answerData = await answerRes.json();
      expect(answerData.ok).toBe(true);
      expect(answerData.session?.status).toBe('answered');

      // 4. Exchange ICE Candidate
      const candRes = await fetch(`${BASE_URL}/api/call/candidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${callerUser.sessionToken}`,
        },
        body: JSON.stringify({
          callId,
          candidate: { candidate: 'candidate:1 1 UDP 2122260223 127.0.0.1 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 },
        }),
      });
      expect(candRes.status).toBe(200);
      const candData = await candRes.json();
      expect(candData.ok).toBe(true);

      // 5. Terminate the active call (connected duration)
      const endRes = await fetch(`${BASE_URL}/api/call/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${callerUser.sessionToken}`,
        },
        body: JSON.stringify({
          callId,
        }),
      });
      expect(endRes.status).toBe(200);
      const endData = await endRes.json();
      expect(endData.ok).toBe(true);

      // 6. Verify chat message was automatically inserted for the call summary
      const chatRes = await fetch(`${BASE_URL}/api/chat/messages?peer=${calleeUser.did}`, {
        headers: {
          'Authorization': `Bearer ${callerUser.sessionToken}`,
        },
      });
      expect(chatRes.status).toBe(200);
      const chatData = await chatRes.json();
      expect(chatData.ok).toBe(true);
      const lastMsg = chatData.messages[chatData.messages.length - 1];
      expect(lastMsg).toBeDefined();
      expect(lastMsg.text).toMatch(/📹 Video Call ended • \d\d:\d\d/);
    });

    it('inserts missed call bubble when call is declined or ended before answer', async () => {
      // 1. Initiate another call offer
      const offerRes = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${callerUser.sessionToken}`,
        },
        body: JSON.stringify({
          recipientDid: calleeUser.did,
          offerSdp: 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
          callType: 'audio',
        }),
      });
      const offerData = await offerRes.json();
      const callId = offerData.session?.callId || offerData.sessionId;

      // 2. End without answering (declined)
      const endRes = await fetch(`${BASE_URL}/api/call/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${calleeUser.sessionToken}`,
        },
        body: JSON.stringify({
          callId,
          reason: 'declined',
        }),
      });
      expect(endRes.status).toBe(200);

      // 3. Verify declined voice call bubble was inserted into chat
      const chatRes = await fetch(`${BASE_URL}/api/chat/messages?peer=${calleeUser.did}`, {
        headers: {
          'Authorization': `Bearer ${callerUser.sessionToken}`,
        },
      });
      const chatData = await chatRes.json();
      const msgs = chatData.messages;
      const declinedMsg = msgs.find((m: any) => m.text?.includes('Declined Voice Call'));
      expect(declinedMsg).toBeDefined();
    });
  });

  describe('3. Instagram-Grade 24h Ephemeral Stories Tray & Segmented Viewer', () => {
    it('serves the stories bar tray and segmented viewer modal in HTML', async () => {
      const html = await fetchServedHtml();

      // Stories Bar
      expect(html).toContain('id="sovereignStoriesBar"');
      expect(html).toContain('id="myStoryRing"');
      expect(html).toContain('openStoryCreatorModal');

      // Fullscreen Story Viewer Modal
      expect(html).toContain('id="sovereignStoryViewerModal"');
      expect(html).toMatch(/id="sovereignStoryViewerModal"[^>]*style="[^"]*display:\s*none/i);
      expect(html).toContain('id="storySegmentsHeader"');
      expect(html).toContain('id="storyModalAuthor"');
      expect(html).toContain('id="storyModalText"');

      // Hold to pause & Touch navigation & reactions
      expect(html).toContain('pauseStoryTimer()');
      expect(html).toContain('resumeStoryTimer()');
      expect(html).toContain('prevStorySegment()');
      expect(html).toContain('nextStorySegment()');
      expect(html).toContain('sendStoryReaction');
      expect(html).toContain('data-idx=');
      expect(html).toContain('data-handle=');
      expect(html).toContain('🔥');
      expect(html).toContain('❤️');
      expect(html).toContain('😂');
      expect(html).toContain('👏');
      expect(html).toContain('💯');
    });

    it('exposes 24-hour TTL pruning endpoint /api/stories/prune', async () => {
      const pruneRes = await fetch(`${BASE_URL}/api/stories/prune`, { method: 'POST' });
      expect(pruneRes.status).toBe(200);
      const pruneData = await pruneRes.json();
      expect(pruneData.ok).toBe(true);
      expect(typeof pruneData.prunedCount).toBe('number');
      expect(typeof pruneData.remainingCount).toBe('number');
    });
  });

  describe('4. Sub-10ms Ctrl+K / Cmd+K Global Command Palette (Linear Parity)', () => {
    it('serves keyboard-driven command palette searching live across people, channels, posts and quick actions', async () => {
      const html = await fetchServedHtml();

      // Modal container & sub-10ms perf indicator
      expect(html).toContain('id="globalCommandPaletteModal"');
      expect(html).toMatch(/id="globalCommandPaletteModal"[^>]*style="[^"]*display:\s*none/i);
      expect(html).toContain('id="globalCommandPaletteInput"');
      expect(html).toContain('id="globalCommandPaletteResults"');
      expect(html).toContain('palettePerfTime');

      // Global hotkey binding
      expect(html).toContain("(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'");

      // Mandatory Quick App Actions
      expect(html).toContain('Open Creator Studio');
      expect(html).toContain('Open Admin Console');
      expect(html).toContain('Start Call (Audio/Video)');
      expect(html).toContain('Create Story (+ Add Story)');

      // Multi-entity search hooks
      expect(html).toContain('socialOmniCatalog.people');
      expect(html).toContain('socialOmniCatalog.channels');
      expect(html).toContain('feedPostsData');

      // Arrow-key keyboard navigation
      expect(html).toContain("event.key === 'ArrowDown'");
      expect(html).toContain("event.key === 'ArrowUp'");
      expect(html).toContain("event.key === 'Enter'");
      expect(html).toContain("event.key === 'Escape'");
      expect(html).toContain('paletteSelectedIndex');
      expect(html).toContain('renderPaletteResultsSelection');
    });
  });

  describe('5. Offline-First PWA Service Worker & SWR Snapshot Cache', () => {
    it('serves /sw.js with Stale-While-Revalidate and offline API snapshot caching', async () => {
      const swRes = await fetch(`${BASE_URL}/sw.js`);
      expect(swRes.status).toBe(200);
      const swText = await swRes.text();

      // Stale-While-Revalidate strategy
      expect(swText).toContain('Stale-While-Revalidate');
      expect(swText).toContain('cache.match');
      expect(swText).toContain('cache.put');

      // API snapshot caching for offline resilience
      expect(swText).toContain('sovra-api-snapshots-v1');
      expect(swText).toContain('/api/feed');
      expect(swText).toContain('/api/chat/threads');
      expect(swText).toContain('/api/chat/messages');
      expect(swText).toContain('/api/status');

      // Offline fallback page
      expect(swText).toContain('Sovra Mesh Offline');
      expect(swText).toContain('Operating in disconnected local mode');
    });
  });
});
