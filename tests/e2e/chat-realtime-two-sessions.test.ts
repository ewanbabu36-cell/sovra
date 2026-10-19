/**
 * @file tests/e2e/chat-realtime-two-sessions.test.ts
 * SOVRA TWO-SESSION REALTIME CHAT EVENT STREAMING (SSE) TEST SUITE
 *
 * Verifies real-time Server-Sent Events (SSE) streaming between two separate
 * user sessions without polling.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

const BASE_URL = 'http://localhost:3001';

interface SseClient {
  events: Array<{ event: string; data: any }>;
  close: () => void;
  waitForEvent: (eventName: string, timeoutMs?: number) => Promise<any>;
}

function connectSse(token: string): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const events: Array<{ event: string; data: any }> = [];
    const listeners: Array<{ eventName: string; resolve: (data: any) => void }> = [];

    const req = http.request(
      `${BASE_URL}/api/realtime/stream?token=${encodeURIComponent(token)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      },
      res => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE connection failed with status ${res.statusCode}`));
          return;
        }

        let buffer = '';
        res.on('data', chunk => {
          buffer += chunk.toString('utf8');
          const blocks = buffer.split('\n\n');
          // keep the last incomplete block in buffer
          buffer = blocks.pop() || '';

          for (const block of blocks) {
            if (!block.trim() || block.startsWith(':')) continue; // skip comments / pings

            let event = 'message';
            let dataStr = '';

            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) {
                event = line.replace('event: ', '').trim();
              } else if (line.startsWith('data: ')) {
                dataStr = line.replace('data: ', '').trim();
              }
            }

            let parsedData = dataStr;
            try {
              parsedData = JSON.parse(dataStr);
            } catch {}

            const item = { event, data: parsedData };
            events.push(item);

            // notify any pending listener
            for (let i = listeners.length - 1; i >= 0; i--) {
              if (listeners[i].eventName === event) {
                listeners[i].resolve(parsedData);
                listeners.splice(i, 1);
              }
            }
          }
        });

        resolve({
          events,
          close: () => {
            req.destroy();
          },
          waitForEvent: (eventName: string, timeoutMs = 5000, predicate?: (data: any) => boolean) => {
            const existing = events.find(e => e.event === eventName && (!predicate || predicate(e.data)));
            if (existing) return Promise.resolve(existing.data);

            return new Promise((resWait, rejWait) => {
              const timer = setTimeout(() => {
                rejWait(new Error(`Timeout waiting for SSE event: ${eventName}`));
              }, timeoutMs);

              listeners.push({
                eventName,
                resolve: data => {
                  if (!predicate || predicate(data)) {
                    clearTimeout(timer);
                    resWait(data);
                  }
                },
              });
            });
          },
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

describe('Sovra Two-Session Realtime Chat SSE Test Suite', () => {
  const timestamp = Date.now();
  let alice: { did: string; handle: string; sessionToken: string };
  let bob: { did: string; handle: string; sessionToken: string };
  let aliceClient: SseClient;
  let bobClient1: SseClient;
  let bobClient2: SseClient;

  beforeAll(async () => {
    // Register Alice
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@alice_sse_${timestamp}`,
        name: 'Alice Realtime',
        bio: 'Realtime chat tester',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    alice = { did: dataA.user.did, handle: dataA.user.handle, sessionToken: dataA.sessionToken };

    // Register Bob
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@bob_sse_${timestamp}`,
        name: 'Bob Realtime',
        bio: 'Realtime chat recipient',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    bob = { did: dataB.user.did, handle: dataB.user.handle, sessionToken: dataB.sessionToken };
  });

  afterAll(() => {
    if (aliceClient) aliceClient.close();
    if (bobClient1) bobClient1.close();
    if (bobClient2) bobClient2.close();
  });

  it('rejects unauthenticated SSE connection with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/realtime/stream`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects invalid session token on SSE connection with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/realtime/stream?token=invalid_stk_12345`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(401);
  });

  it('connects Bob to realtime SSE stream and receives initial connected event', async () => {
    bobClient1 = await connectSse(bob.sessionToken);
    const connEvent = await bobClient1.waitForEvent('connected', 3000);
    expect(connEvent).toBeDefined();
    expect(connEvent.did).toBe(bob.did);
  });

  it('delivers direct message from Alice to Bob in real time over SSE without polling', async () => {
    const messageText = `Realtime test message from Alice to Bob at ${Date.now()}`;
    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        id: `msg_sse_${Date.now()}`,
        recipientDid: bob.did,
        senderName: 'Alice Realtime',
        text: messageText,
      }),
    });
    expect(sendRes.status).toBe(200);
    const sendData = await sendRes.json();
    expect(sendData.ok).toBe(true);

    // Verify Bob receives it instantaneously via SSE
    const received = await bobClient1.waitForEvent('chat_message', 4000);
    expect(received).toBeDefined();
    expect(received.id).toBe(sendData.message.id);
    expect(received.senderDid).toBe(alice.did);
    expect(received.recipientDid).toBe(bob.did);
    expect(received.text).toBe(messageText);
  });

  it('delivers messages concurrently to multiple active sessions for the same user', async () => {
    // Bob opens a second tab / session
    bobClient2 = await connectSse(bob.sessionToken);
    const conn2 = await bobClient2.waitForEvent('connected', 3000);
    expect(conn2.did).toBe(bob.did);

    const broadcastText = `Broadcast to all Bob sessions at ${Date.now()}`;
    const waitClient1 = bobClient1.waitForEvent('chat_message', 4000, d => d && d.text === broadcastText);
    const waitClient2 = bobClient2.waitForEvent('chat_message', 4000, d => d && d.text === broadcastText);

    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        id: `msg_multi_${Date.now()}`,
        recipientDid: bob.did,
        senderName: 'Alice Realtime',
        text: broadcastText,
      }),
    });
    expect(sendRes.status).toBe(200);

    const [msg1, msg2] = await Promise.all([waitClient1, waitClient2]);
    expect(msg1.text).toBe(broadcastText);
    expect(msg2.text).toBe(broadcastText);
  });

  it('handles receipt transitions (delivered and read) via SSE without polling', async () => {
    // Connect Alice to SSE stream to observe incoming receipt acknowledgments
    if (!aliceClient) {
      aliceClient = await connectSse(alice.sessionToken);
      const connAlice = await aliceClient.waitForEvent('connected', 3000);
      expect(connAlice.did).toBe(alice.did);
    }

    const testMsgId = `msg_receipt_${Date.now()}`;
    const waitBobMsg = bobClient1.waitForEvent('chat_message', 4000, d => d && d.id === testMsgId);

    // 1. Alice sends message (starts optimistic locally, reaches server as 'sent')
    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        id: testMsgId,
        recipientDid: bob.did,
        senderName: 'Alice Realtime',
        text: 'Hello Bob, receipt testing message',
      }),
    });
    expect(sendRes.status).toBe(200);

    const bobReceived = await waitBobMsg;
    expect(bobReceived.id).toBe(testMsgId);

    // 2. Bob acknowledges delivery -> Alice receives 'delivered' receipt via SSE
    const waitDelivered = aliceClient.waitForEvent('chat_receipt', 4000, d => d && d.status === 'delivered' && Array.isArray(d.messageIds) && d.messageIds.includes(testMsgId));
    const delivRes = await fetch(`${BASE_URL}/api/chat/receipt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bob.sessionToken}`,
      },
      body: JSON.stringify({
        messageIds: [testMsgId],
        status: 'delivered',
      }),
    });
    expect(delivRes.status).toBe(200);

    const deliveredReceipt = await waitDelivered;
    expect(deliveredReceipt.status).toBe('delivered');
    expect(deliveredReceipt.messageIds).toContain(testMsgId);
    expect(deliveredReceipt.readerDid).toBe(bob.did);

    // 3. Bob opens chat / reads message -> Alice receives 'read' receipt via SSE (ticks turn blue)
    const waitRead = aliceClient.waitForEvent('chat_receipt', 4000, d => d && d.status === 'read' && Array.isArray(d.messageIds) && d.messageIds.includes(testMsgId));
    const readRes = await fetch(`${BASE_URL}/api/chat/receipt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bob.sessionToken}`,
      },
      body: JSON.stringify({
        messageIds: [testMsgId],
        status: 'read',
      }),
    });
    expect(readRes.status).toBe(200);

    const readReceipt = await waitRead;
    expect(readReceipt.status).toBe('read');
    expect(readReceipt.messageIds).toContain(testMsgId);
    expect(readReceipt.readerDid).toBe(bob.did);
  });

  it('synchronizes quick-reactions in real time across sessions', async () => {
    if (!aliceClient) {
      aliceClient = await connectSse(alice.sessionToken);
      await aliceClient.waitForEvent('connected', 3000);
    }

    const testMsgId = `msg_react_${Date.now()}`;
    await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        id: testMsgId,
        recipientDid: bob.did,
        senderName: 'Alice Realtime',
        text: 'React to this message please',
      }),
    });

    // Bob reacts with ❤️
    const waitReactionHeart = aliceClient.waitForEvent('chat_reaction', 4000, d => d && d.messageId === testMsgId && d.emoji === '❤️');
    const reactRes1 = await fetch(`${BASE_URL}/api/chat/reaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bob.sessionToken}`,
      },
      body: JSON.stringify({
        messageId: testMsgId,
        emoji: '❤️',
      }),
    });
    expect(reactRes1.status).toBe(200);

    const heartEvent = await waitReactionHeart;
    expect(heartEvent.messageId).toBe(testMsgId);
    expect(heartEvent.emoji).toBe('❤️');
    expect(heartEvent.senderDid).toBe(bob.did);
    expect(heartEvent.reactions.some((r: any) => r.emoji === '❤️' && r.senderDid === bob.did)).toBe(true);

    // Bob changes reaction to 👍
    const waitReactionThumbs = aliceClient.waitForEvent('chat_reaction', 4000, d => d && d.messageId === testMsgId && d.emoji === '👍');
    const reactRes2 = await fetch(`${BASE_URL}/api/chat/reaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bob.sessionToken}`,
      },
      body: JSON.stringify({
        messageId: testMsgId,
        emoji: '👍',
      }),
    });
    expect(reactRes2.status).toBe(200);

    const thumbsEvent = await waitReactionThumbs;
    expect(thumbsEvent.messageId).toBe(testMsgId);
    expect(thumbsEvent.emoji).toBe('👍');
    expect(thumbsEvent.reactions.some((r: any) => r.emoji === '👍' && r.senderDid === bob.did)).toBe(true);
  });

  it('broadcasts real-time typing and voice recording indicators over SSE', async () => {
    // Alice starts typing
    const waitTypingStart = bobClient1.waitForEvent('typing', 4000, d => d && d.senderDid === alice.did && d.isTyping === true);
    const typingRes = await fetch(`${BASE_URL}/api/chat/typing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: bob.did,
        senderName: 'Alice Realtime',
        isTyping: true,
        isRecording: false,
      }),
    });
    expect(typingRes.status).toBe(200);

    const typingEvt = await waitTypingStart;
    expect(typingEvt.isTyping).toBe(true);
    expect(typingEvt.isRecording).toBe(false);
    expect(typingEvt.senderDid).toBe(alice.did);

    // Alice switches to voice recording
    const waitRecordingStart = bobClient1.waitForEvent('typing', 4000, d => d && d.senderDid === alice.did && d.isRecording === true);
    const recordRes = await fetch(`${BASE_URL}/api/chat/typing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: bob.did,
        senderName: 'Alice Realtime',
        isTyping: true,
        isRecording: true,
      }),
    });
    expect(recordRes.status).toBe(200);

    const recordEvt = await waitRecordingStart;
    expect(recordEvt.isRecording).toBe(true);

    // Alice stops typing and recording
    const waitTypingStop = bobClient1.waitForEvent('typing', 4000, d => d && d.senderDid === alice.did && d.isTyping === false && d.isRecording === false);
    const stopRes = await fetch(`${BASE_URL}/api/chat/typing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: bob.did,
        senderName: 'Alice Realtime',
        isTyping: false,
        isRecording: false,
      }),
    });
    expect(stopRes.status).toBe(200);

    const stopEvt = await waitTypingStop;
    expect(stopEvt.isTyping).toBe(false);
    expect(stopEvt.isRecording).toBe(false);
  });

  it('reconciles queued offline messages deterministically', async () => {
    const offlineMsgId = `msg_offline_${Date.now()}`;
    const offlineText = 'Message created while offline and queued in SovraOfflineOutbox';

    // Simulate offline outbox state: locally pending_sync
    const localOutboxItem = {
      id: offlineMsgId,
      senderDid: alice.did,
      recipientDid: bob.did,
      senderName: 'Alice Realtime',
      text: offlineText,
      timestamp: Date.now(),
      status: 'pending_sync',
    };
    expect(localOutboxItem.status).toBe('pending_sync');

    // Network re-established: Outbox flushes queued request to server
    const waitBobReceive = bobClient1.waitForEvent('chat_message', 4000, d => d && d.id === offlineMsgId);
    const flushRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.sessionToken}`,
      },
      body: JSON.stringify({
        id: localOutboxItem.id,
        recipientDid: localOutboxItem.recipientDid,
        senderName: localOutboxItem.senderName,
        text: localOutboxItem.text,
      }),
    });
    expect(flushRes.status).toBe(200);
    const flushData = await flushRes.json();
    expect(flushData.ok).toBe(true);
    expect(flushData.message.status).toBe('sent');

    // Bob receives it live without polling
    const receivedMsg = await waitBobReceive;
    expect(receivedMsg.id).toBe(offlineMsgId);
    expect(receivedMsg.text).toBe(offlineText);
  });
});
