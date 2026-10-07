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
});
