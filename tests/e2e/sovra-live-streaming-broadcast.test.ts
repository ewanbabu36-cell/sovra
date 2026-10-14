/**
 * @file tests/e2e/sovra-live-streaming-broadcast.test.ts
 * SOVRA P2P LIVE STREAMING & REAL-TIME SWARM BROADCAST SUITE
 *
 * Verifies:
 * 1. Broadcast initiation & live room provisioning (POST /api/live/stream/start)
 * 2. Mesh live stream discovery & active stream filtering (GET /api/live/streams)
 * 3. Swarm viewer join/leave protocol & viewer counts (POST /api/live/stream/join, leave)
 * 4. WebRTC peer signaling mesh (SDP offer/answer exchange, ICE candidates)
 * 5. Real-time live comments & event polling stream (POST /api/live/chat, GET /api/live/stream/events)
 * 6. Live SOV micro-tipping with 95/5 split & FLYING_COINS particle payload
 * 7. End broadcast lifecycle & automatic archive creation in Watch catalog
 * 8. Client UI layout verification (#sovraLiveStreamModal, @keyframes floatCoinUp, SovraLiveStreamEngine)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA P2P Live Streaming & Swarm Broadcast Engine', () => {
  const ts = Date.now();
  let broadcaster: { did: string; handle: string; name: string; sessionToken: string };
  let viewerAlice: { did: string; handle: string; name: string; sessionToken: string };
  let viewerBob: { did: string; handle: string; name: string; sessionToken: string };
  let liveSessionId: string;
  let archiveVideoId: string;

  beforeAll(async () => {
    // 1. Register Broadcaster
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@broadcaster_${ts}`,
        name: 'Sovereign Broadcaster',
        bio: 'P2P mesh live streamer',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.ok).toBe(true);
    broadcaster = {
      did: dataA.user.did,
      handle: dataA.user.handle,
      name: dataA.user.name,
      sessionToken: dataA.sessionToken,
    };

    // 2. Register Viewer Alice
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@alice_viewer_${ts}`,
        name: 'Alice Mesh Watcher',
        bio: 'P2P enthusiast',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.ok).toBe(true);
    viewerAlice = {
      did: dataB.user.did,
      handle: dataB.user.handle,
      name: dataB.user.name,
      sessionToken: dataB.sessionToken,
    };

    // 3. Register Viewer Bob
    const resC = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@bob_supporter_${ts}`,
        name: 'Bob Supporter',
        bio: 'Decentralized creator supporter',
      }),
    });
    expect(resC.status).toBe(200);
    const dataC = await resC.json();
    expect(dataC.ok).toBe(true);
    viewerBob = {
      did: dataC.user.did,
      handle: dataC.user.handle,
      name: dataC.user.name,
      sessionToken: dataC.sessionToken,
    };
  });

  describe('1. Broadcast Initiation & WebRTC Live Room Provisioning', () => {
    it('starts a live broadcast with instant room provisioning and active status', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${broadcaster.sessionToken}`,
        },
        body: JSON.stringify({
          title: `Mesh Hackathon Live Demo ${ts}`,
          category: 'tech',
          description: 'Live P2P swarm coding and decentralized deployment',
        }),
      });

      expect([200, 201]).toContain(res.status);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.session).toBeDefined();
      expect(data.session.id).toBeDefined();
      liveSessionId = data.session.id;

      expect(data.session.status).toBe('LIVE');
      expect(data.session.title).toBe(`Mesh Hackathon Live Demo ${ts}`);
      expect(data.session.creatorDid).toBe(broadcaster.did);
      expect(data.webrtcRoomId || data.session.webrtcRoomId).toMatch(/^room[-_]live-/);
      expect(data.session.viewerCount).toBeGreaterThanOrEqual(1);
      expect(data.session.peakViewers).toBeGreaterThanOrEqual(1);
      expect(data.session.tipTotalSov).toBe(0);
    });

    it('rejects broadcast start without valid title', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${broadcaster.sessionToken}`,
        },
        body: JSON.stringify({
          title: '   ',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('2. Mesh Live Stream Discovery & Filtering', () => {
    it('discovers the live stream in the active streams catalog', async () => {
      const res = await fetch(`${BASE_URL}/api/live/streams?status=LIVE`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.streams)).toBe(true);

      const found = data.streams.find((s: any) => s.id === liveSessionId);
      expect(found).toBeDefined();
      expect(found.status).toBe('LIVE');
      expect(found.title).toBe(`Mesh Hackathon Live Demo ${ts}`);
      expect(found.creatorDid).toBe(broadcaster.did);
    });

    it('returns all streams when querying without status filter', async () => {
      const res = await fetch(`${BASE_URL}/api/live/streams`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.streams)).toBe(true);
      const found = data.streams.find((s: any) => s.id === liveSessionId);
      expect(found).toBeDefined();
    });
  });

  describe('3. Swarm Viewer Join / Leave Protocol', () => {
    it('allows Viewer Alice to join the live room, incrementing viewer count', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerAlice.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.viewerCount).toBe(2);
      expect(data.session.viewers).toContain(viewerAlice.did);
      expect(Array.isArray(data.recentComments)).toBe(true);
      expect(Array.isArray(data.recentTips)).toBe(true);
    });

    it('allows Viewer Bob to join the live room, incrementing viewer count to 3', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerBob.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.viewerCount).toBe(3);
      expect(data.session.viewers).toContain(viewerBob.did);
    });

    it('handles viewer leaving, decrementing viewer count without terminating stream', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerAlice.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.viewerCount).toBe(2);
      expect(data.session.viewers).not.toContain(viewerAlice.did);
      expect(data.session.status).toBe('LIVE');
    });
  });

  describe('4. WebRTC Mesh Signaling Protocol', () => {
    it('relays broadcaster SDP offer directed to Viewer Bob', async () => {
      const offerPayload = {
        type: 'offer',
        sdp: 'v=0\r\no=broadcaster 123456 2 IN IP4 127.0.0.1\r\ns=SovraLive\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
      };

      const res = await fetch(`${BASE_URL}/api/live/stream/signal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${broadcaster.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
          toDid: viewerBob.did,
          type: 'offer',
          payload: offerPayload,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.signalId).toBeDefined();
    });

    it('allows Viewer Bob to fetch signals directed to him', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/signals?sessionId=${liveSessionId}&peerDid=${viewerBob.did}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.signals)).toBe(true);

      const offerSignal = data.signals.find((s: any) => s.type === 'offer' && s.toDid === viewerBob.did);
      expect(offerSignal).toBeDefined();
      expect(offerSignal.fromDid).toBe(broadcaster.did);
      expect(offerSignal.payload.sdp).toContain('SovraLive');
    });

    it('relays Viewer Bob SDP answer back to broadcaster', async () => {
      const answerPayload = {
        type: 'answer',
        sdp: 'v=0\r\no=bob 654321 2 IN IP4 127.0.0.1\r\ns=SovraLive\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
      };

      const res = await fetch(`${BASE_URL}/api/live/stream/signal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerBob.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
          toDid: broadcaster.did,
          type: 'answer',
          payload: answerPayload,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it('allows broadcaster to fetch SDP answer from Viewer Bob', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/signals?sessionId=${liveSessionId}&peerDid=${broadcaster.did}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      const answerSignal = data.signals.find((s: any) => s.type === 'answer' && s.toDid === broadcaster.did);
      expect(answerSignal).toBeDefined();
      expect(answerSignal.fromDid).toBe(viewerBob.did);
      expect(answerSignal.payload.type).toBe('answer');
    });

    it('exchanges ICE candidates between peers', async () => {
      const candidatePayload = {
        candidate: 'candidate:842163049 1 udp 1677729535 192.168.1.100 54123 typ srflx raddr 10.0.0.1 rport 54123',
        sdpMid: '0',
        sdpMLineIndex: 0,
      };

      const res = await fetch(`${BASE_URL}/api/live/stream/signal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerBob.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
          toDid: broadcaster.did,
          type: 'candidate',
          payload: candidatePayload,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      // Verify broadcaster sees the ICE candidate
      const checkRes = await fetch(`${BASE_URL}/api/live/stream/signals?sessionId=${liveSessionId}&peerDid=${broadcaster.did}`);
      const checkData = await checkRes.json();
      const candSignal = checkData.signals.find((s: any) => s.type === 'candidate' && s.fromDid === viewerBob.did);
      expect(candSignal).toBeDefined();
      expect(candSignal.payload.candidate).toContain('192.168.1.100');
    });
  });

  describe('5. Real-Time Live Comments & Swarm Event Polling', () => {
    it('posts real-time chat comments to the live stream', async () => {
      const res = await fetch(`${BASE_URL}/api/live/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerBob.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
          text: 'P2P mesh video feed is crystal clear! 🚀',
        }),
      });

      expect([200, 201]).toContain(res.status);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.message).toBeDefined();
      expect(data.message.text).toBe('P2P mesh video feed is crystal clear! 🚀');
      expect(data.message.senderDid).toBe(viewerBob.did);
    });

    it('polls stream events and receives the new comment', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/events?sessionId=${liveSessionId}&since=0`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.status).toBe('LIVE');
      expect(data.viewerCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(data.comments)).toBe(true);

      const foundComment = data.comments.find((c: any) => c.text === 'P2P mesh video feed is crystal clear! 🚀');
      expect(foundComment).toBeDefined();
      expect(foundComment.senderDid).toBe(viewerBob.did);
    });
  });

  describe('6. Real-Time SOV Micro-Tipping (95/5 Split & Floating Animation)', () => {
    it('processes 25 SOV tip with 95/5 instant split and returns FLYING_COINS particle payload', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/tip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerBob.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
          amountSov: 25,
          note: 'Awesome live stream demonstration!',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.animation).toBe('FLYING_COINS');
      expect(data.tip).toBeDefined();
      expect(data.tip.amountSov).toBe(25);
      expect(data.tip.senderDid).toBe(viewerBob.did);
      expect(data.tip.creatorSplitSov).toBe(23.75); // 95%
      expect(data.tip.seederSplitSov).toBe(1.25);  // 5%
      expect(data.split.creatorSov).toBe(23.75);
      expect(data.split.seederSov).toBe(1.25);
      expect(data.tipTotalSov).toBe(25);
    });

    it('processes a second 100 SOV tip and updates total session tips accurately', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/tip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerBob.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
          amountSov: 100,
          note: 'Super tip for decentralized sovereign technology!',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.animation).toBe('FLYING_COINS');
      expect(data.tip.creatorSplitSov).toBe(95);  // 95% of 100
      expect(data.tip.seederSplitSov).toBe(5);   // 5% of 100
      expect(data.tipTotalSov).toBe(125);         // 25 + 100
    });

    it('verifies tipping generated real-time chat announcements and events', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/events?sessionId=${liveSessionId}&since=0`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.tipTotalSov).toBe(125);
      expect(data.tips.length).toBeGreaterThanOrEqual(2);

      // Verify chat has tip announcements
      const tipChat = data.comments.find((c: any) => c.isTip === true);
      expect(tipChat).toBeDefined();
      expect(tipChat.tipAmount).toBeGreaterThan(0);
    });

    it('rejects invalid tip amounts', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/tip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerBob.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
          amountSov: -10,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('7. Conclude Broadcast & Automatic Watch Catalog Archival', () => {
    it('rejects attempt to end broadcast by non-creator peer', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerBob.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toMatch(/Only broadcaster|broadcast/i);
    });

    it('allows broadcaster to end the stream and generates Watch archive replay', async () => {
      const res = await fetch(`${BASE_URL}/api/live/stream/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${broadcaster.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: liveSessionId,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.session.status).toBe('ENDED');
      expect(data.archiveVideo).toBeDefined();
      expect(data.archiveVideo.id).toBeDefined();
      archiveVideoId = data.archiveVideo.id;

      expect(data.archiveVideo.title).toContain('Replay');
      expect(data.archiveVideo.channelHandle).toBe(broadcaster.handle.replace('@', ''));
    });

    it('retrieves the auto-archived live replay from Watch video catalog', async () => {
      const res = await fetch(`${BASE_URL}/api/youtube/video?videoId=${archiveVideoId}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.video.id).toBe(archiveVideoId);
      expect(data.video.channelHandle).toBe(broadcaster.handle.replace('@', ''));
      expect(data.video.channelName).toBe(broadcaster.name);
      expect(data.video.title).toContain(`Mesh Hackathon Live Demo ${ts}`);
    });

    it('confirms the stream is no longer listed in active LIVE streams', async () => {
      const res = await fetch(`${BASE_URL}/api/live/streams?status=LIVE`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      const found = data.streams.find((s: any) => s.id === liveSessionId);
      expect(found).toBeUndefined();
    });
  });

  describe('8. Client HTML & Live Room UI Elements Gate', () => {
    it('serves client index HTML containing live modal and floating coin animation styles', async () => {
      const res = await fetch(`${BASE_URL}/`);
      expect(res.status).toBe(200);
      const html = await res.text();

      // UI Modal Container
      expect(html).toContain('id="sovraLiveStreamModal"');
      // Floating Comments Overlay
      expect(html).toContain('id="liveCommentsOverlay"');
      // Floating Gold Coins Container
      expect(html).toContain('id="liveFloatingCoinsContainer"');
      // Live Streamer Controls
      expect(html).toContain('id="liveBroadcasterControls"');
      // CSS Keyframe Animation
      expect(html).toContain('@keyframes floatCoinUp');
      // Quick Tip Buttons
      expect(html).toContain('sendLiveStreamPresetTip(5)');
      expect(html).toContain('sendLiveStreamPresetTip(10)');
      expect(html).toContain('sendLiveStreamPresetTip(25)');
      // Drawer Navigation Entry
      expect(html).toContain('P2P Live Streams');
      // Client Engine Object
      expect(html).toContain('window.SovraLiveStreamEngine');
    });
  });
});
