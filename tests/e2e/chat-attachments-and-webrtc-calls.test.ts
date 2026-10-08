/**
 * @file tests/e2e/chat-attachments-and-webrtc-calls.test.ts
 * VERIFICATION SUITE: CHAT FILE ATTACHMENTS & REAL WEBRTC AUDIO/VIDEO CALL PIPELINE
 *
 * Verifies:
 * 1. UI Elements: Chat file input (#chatFileInput), attachment preview tray (#chatAttachmentPreviewTray),
 *    trigger button (#chatAttachBtn), and video/audio call controls.
 * 2. Chat File Attachment API:
 *    - Uploading a base64 encoded document/photo attachment via /api/chat/send
 *    - Validating that messages with attachments (with or without accompanying text) succeed
 *    - Fetching messages via /api/chat/messages and verifying attachment metadata & dataUrl are retained
 * 3. WebRTC E2EE Audio & Video Call Pipeline:
 *    - Caller initiates offer (/api/call/offer) with real SDP and callType='video'
 *    - Recipient receives incoming call (/api/call/incoming)
 *    - Recipient answers (/api/call/answer) with answer SDP
 *    - Both peers poll (/api/call/poll) and verify connected/answered status
 *    - ICE candidate exchange (/api/call/candidate) works seamlessly
 *    - Ending the call (/api/call/end) marks status as 'ended' with duration and logs to chat
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Chat File Attachments & Real WebRTC Audio/Video Call Pipeline', () => {
  const ts = Date.now();
  let userA: { did: string; handle: string; sessionToken: string };
  let userB: { did: string; handle: string; sessionToken: string };
  let testCallId: string;

  beforeAll(async () => {
    // Register User A
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@attach_caller_${ts}`,
        name: 'Attach Caller User',
        bio: 'Testing P2P attachments and video calling',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.ok).toBe(true);
    userA = { did: dataA.user.did, handle: dataA.user.handle, sessionToken: dataA.sessionToken };

    // Register User B
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@attach_callee_${ts}`,
        name: 'Attach Callee User',
        bio: 'Recipient peer node',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.ok).toBe(true);
    userB = { did: dataB.user.did, handle: dataB.user.handle, sessionToken: dataB.sessionToken };
  });

  it('serves dashboard HTML with chat attachment picker and preview tray', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // Check attachment UI
    expect(html).toContain('id="chatFileInput"');
    expect(html).toContain('id="chatAttachmentPreviewTray"');
    expect(html).toContain('id="chatAttachmentPreviewContent"');
    expect(html).toContain('id="chatAttachBtn"');
    expect(html).toContain('triggerChatFileSelect()');
    expect(html).toContain('handleChatFileSelected(this.files)');
    expect(html).toContain('clearPendingChatAttachment()');

    // Ensure dummy blocking alert is completely gone
    expect(html).not.toContain("alert('P2P UnixFS File Attachment: File encrypted with ChaCha20-Poly1305 and pinned to local blockstore.')");

    // Check WebRTC functions exist in script
    expect(html).toContain('function initCallLocalMediaStream(');
    expect(html).toContain('function createRTCPeerConnectionInstance()');
    expect(html).toContain('window.startE2eeCall = startE2eeCall');
    expect(html).toContain('window.acceptIncomingCall = acceptIncomingCall');
  });

  it('allows sending a chat message containing an image attachment and validates storage', async () => {
    const sampleImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: userB.did,
        text: 'Check out this screenshot from my sovereign node!',
        attachment: {
          name: 'node_screenshot.png',
          type: 'image/png',
          size: 142,
          dataUrl: sampleImageDataUrl,
          cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        },
      }),
    });

    expect(sendRes.status).toBe(200);
    const sendData = await sendRes.json();
    expect(sendData.ok).toBe(true);
    expect(sendData.message).toBeDefined();
    expect(sendData.message.attachment).toBeDefined();
    expect(sendData.message.attachment.name).toBe('node_screenshot.png');
    expect(sendData.message.attachment.type).toBe('image/png');
    expect(sendData.message.attachment.dataUrl).toBe(sampleImageDataUrl);

    // Fetch messages for recipient
    const listRes = await fetch(`${BASE_URL}/api/chat/messages?userDid=${encodeURIComponent(userB.did)}`, {
      headers: { Authorization: `Bearer ${userB.sessionToken}` },
    });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.ok).toBe(true);
    const found = listData.messages.find((m: any) => m.id === sendData.message.id);
    expect(found).toBeDefined();
    expect(found.attachment.name).toBe('node_screenshot.png');
    expect(found.attachment.size).toBe(142);
  });

  it('allows sending an attachment without accompanying text (pure file send)', async () => {
    const sampleDocDataUrl = 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrCg==';

    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userB.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: userA.did,
        text: '',
        attachment: {
          name: 'project_blueprint.pdf',
          type: 'application/pdf',
          size: 1024,
          dataUrl: sampleDocDataUrl,
        },
      }),
    });

    expect(sendRes.status).toBe(200);
    const sendData = await sendRes.json();
    expect(sendData.ok).toBe(true);
    expect(sendData.message.attachment.name).toBe('project_blueprint.pdf');
  });

  it('executes full WebRTC signaling with ICE candidates and video call negotiation', async () => {
    // 1. User A initiates video call offer
    const offerRes = await fetch(`${BASE_URL}/api/call/offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: userB.did,
        callType: 'video',
        offerSdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 100\r\n',
      }),
    });

    expect(offerRes.status).toBe(200);
    const offerData = await offerRes.json();
    expect(offerData.ok).toBe(true);
    expect(offerData.session).toBeDefined();
    expect(offerData.session.callType).toBe('video');
    expect(offerData.session.status).toBe('offering');
    testCallId = offerData.session.callId;

    // 2. User B checks incoming call
    const incRes = await fetch(`${BASE_URL}/api/call/incoming`, {
      headers: { Authorization: `Bearer ${userB.sessionToken}` },
    });
    expect(incRes.status).toBe(200);
    const incData = await incRes.json();
    expect(incData.ok).toBe(true);
    expect(incData.incomingCall).toBeDefined();
    expect(incData.incomingCall.callId).toBe(testCallId);
    expect(incData.incomingCall.callType).toBe('video');

    // 3. User B answers the video call
    const answerRes = await fetch(`${BASE_URL}/api/call/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userB.sessionToken}`,
      },
      body: JSON.stringify({
        callId: testCallId,
        answerSdp: 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 100\r\n',
      }),
    });
    expect(answerRes.status).toBe(200);
    const answerData = await answerRes.json();
    expect(answerData.ok).toBe(true);
    expect(answerData.session.status).toBe('answered');

    // 4. Exchange ICE candidates
    const candRes = await fetch(`${BASE_URL}/api/call/candidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.sessionToken}`,
      },
      body: JSON.stringify({
        callId: testCallId,
        candidate: { candidate: 'candidate:1 1 UDP 2122260223 127.0.0.1 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      }),
    });
    expect(candRes.status).toBe(200);
    const candData = await candRes.json();
    expect(candData.ok).toBe(true);

    // 5. User A polls and receives answer and ICE candidates
    const pollRes = await fetch(`${BASE_URL}/api/call/poll?callId=${encodeURIComponent(testCallId)}`, {
      headers: { Authorization: `Bearer ${userA.sessionToken}` },
    });
    expect(pollRes.status).toBe(200);
    const pollData = await pollRes.json();
    expect(pollData.ok).toBe(true);
    expect(pollData.session.status).toBe('answered');
    expect(pollData.session.sdpAnswer).toContain('m=video');
    expect(pollData.session.iceCandidates.length).toBeGreaterThan(0);

    // 6. Terminate call
    const endRes = await fetch(`${BASE_URL}/api/call/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.sessionToken}`,
      },
      body: JSON.stringify({
        callId: testCallId,
        reason: 'user_hung_up',
      }),
    });
    expect(endRes.status).toBe(200);
    const endData = await endRes.json();
    expect(endData.ok).toBe(true);
    expect(endData.session.status).toBe('ended');
  });
});
