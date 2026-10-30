/**
 * @file tests/unit/modular-api-dispatch.test.ts
 * 👑 SOVRA ENTERPRISE MODULAR API & SECURITY TEST SUITE
 *
 * Verifies:
 * 1. Security Middleware & OWASP Top 10 Headers:
 *    - Applies X-Frame-Options: SAMEORIGIN
 *    - Applies X-Content-Type-Options: nosniff
 *    - Applies Content-Security-Policy
 *    - Dynamic CORS headers
 * 2. Auth Controller & Cryptographic DIDs:
 *    - User registration generates unique `did:sovra:...` and session token
 *    - Login retrieves or creates active session
 *    - User/me endpoint verifies authentication state
 * 3. Wallet Controller & Sovereign Balance:
 *    - Balance inquiry returns valid SOV amount
 *    - P2P transfers correctly adjust balances and record transactions
 * 4. Telemetry Controller & Node Health:
 *    - Returns node status, uptime, and system telemetry
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { dispatchApiRequest } from '../../services/api/src/routes/index.ts';
import { securityMiddleware } from '../../services/api/src/middleware/security.middleware.ts';
import { authController } from '../../services/api/src/controllers/auth.controller.ts';
import { walletController } from '../../services/api/src/controllers/wallet.controller.ts';
import { telemetryController } from '../../services/api/src/controllers/telemetry.controller.ts';

// Mock MockHttp objects
function createMockHttp(method: string, url: string, bodyObj?: any, headers: Record<string, string> = {}) {
  const req: any = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };

  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          this.headers[k.toLowerCase()] = v;
        }
      }
    },
    end(data?: any) {
      if (data) this.body = typeof data === 'string' ? data : data.toString();
    },
  };

  process.nextTick(() => {
    if (bodyObj !== undefined) {
      req.emit('data', Buffer.from(JSON.stringify(bodyObj)));
    }
    req.emit('end');
  });

  return { req, res };
}

describe('👑 Enterprise Modular API & Security Engineering Gate', () => {
  it('1. Applies OWASP Top 10 Security Headers and CORS Protection', async () => {
    const { req, res } = createMockHttp('GET', '/api/status', undefined, { origin: 'http://localhost:3001' });
    const handled = await dispatchApiRequest(req, res, '/api/status');
    expect(handled).toBe(true);

    // OWASP Headers
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
  });

  it('2. Auth Controller: registers new user with cryptographic DID and session token', async () => {
    const { req, res } = createMockHttp('POST', '/api/auth/register', {
      handle: 'enterprise_user',
      displayName: 'Enterprise Architect',
    });

    const handled = await dispatchApiRequest(req, res, '/api/auth/register');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(201);

    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.user.did).toMatch(/^did:sovra:[a-f0-9]{32}$/);
    expect(body.user.handle).toBe('enterprise_user');
    expect(body.token).toMatch(/^sov_sess_[a-f0-9]{64}$/);
  });

  it('3. Auth Controller: authenticates user and resolves /api/user/me profile', async () => {
    // Login to get token
    const { req: loginReq, res: loginRes } = createMockHttp('POST', '/api/auth/login', {
      handle: 'satoshi_sovereign',
    });
    await dispatchApiRequest(loginReq, loginRes, '/api/auth/login');
    expect(loginRes.statusCode).toBe(200);
    const loginData = JSON.parse(loginRes.body);
    const token = loginData.token;

    // Use token in /api/user/me
    const { req: meReq, res: meRes } = createMockHttp('GET', '/api/user/me', undefined, {
      authorization: `Bearer ${token}`,
    });
    const handled = await dispatchApiRequest(meReq, meRes, '/api/user/me');
    expect(handled).toBe(true);
    expect(meRes.statusCode).toBe(200);

    const meData = JSON.parse(meRes.body);
    expect(meData.ok).toBe(true);
    expect(meData.authenticated).toBe(true);
    expect(meData.user.handle).toBe('satoshi_sovereign');
  });

  it('4. Wallet Controller: queries sovereign vault balance and handles P2P transfer', async () => {
    // 1. Check initial balance
    const { req: balReq, res: balRes } = createMockHttp('GET', '/api/wallet/balance', undefined, {
      'x-sovra-did': 'did:sovra:architect_alpha',
    });
    await dispatchApiRequest(balReq, balRes, '/api/wallet/balance');
    expect(balRes.statusCode).toBe(200);
    const balData = JSON.parse(balRes.body);
    expect(balData.ok).toBe(true);
    expect(balData.balance).toBe(500.0);

    // 2. Perform Transfer
    const { req: txReq, res: txRes } = createMockHttp('POST', '/api/wallet/transfer', {
      recipientDid: 'did:sovra:recipient_beta',
      amount: 150.0,
      memo: 'Peer node contribution',
    }, {
      'x-sovra-did': 'did:sovra:architect_alpha',
    });
    await dispatchApiRequest(txReq, txRes, '/api/wallet/transfer');
    expect(txRes.statusCode).toBe(200);
    const txData = JSON.parse(txRes.body);
    expect(txData.ok).toBe(true);
    expect(txData.transaction.amount).toBe(150.0);
    expect(txData.newBalance).toBe(350.0);
  });

  it('5. Telemetry Controller: delivers live node telemetry and zero unhandled errors', async () => {
    const { req, res } = createMockHttp('GET', '/api/status');
    await dispatchApiRequest(req, res, '/api/status');
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ONLINE');
    expect(body.systemTelemetry).toBeDefined();
    expect(body.systemTelemetry.version).toBe('1.0.0-ENTERPRISE');
  });

  it('6. Social Controller: manages post creation, reactions, comments, and soft deletion', async () => {
    // 1. Create a new post
    const { req: createReq, res: createRes } = createMockHttp(
      'POST',
      '/api/posts',
      {
        content: 'Enterprise decentralized feed architecture verified.',
        authorHandle: 'lead_architect',
        authorName: 'Lead Architect',
      },
      { 'x-sovra-did': 'did:sovra:architect_test' }
    );
    await dispatchApiRequest(createReq, createRes, '/api/posts');
    expect(createRes.statusCode).toBe(201);
    const createData = JSON.parse(createRes.body);
    expect(createData.ok).toBe(true);
    expect(createData.post.authorHandle).toBe('lead_architect');
    expect(createData.post.content).toBe('Enterprise decentralized feed architecture verified.');
    const postId = createData.post.id;

    // 2. Query Feed (includes new post)
    const { req: feedReq, res: feedRes } = createMockHttp('GET', '/api/posts?limit=10');
    await dispatchApiRequest(feedReq, feedRes, '/api/posts');
    expect(feedRes.statusCode).toBe(200);
    const feedData = JSON.parse(feedRes.body);
    expect(feedData.ok).toBe(true);
    expect(feedData.posts.some((p: any) => p.id === postId)).toBe(true);

    // 3. Add Micro-reaction (Like)
    const { req: reactReq, res: reactRes } = createMockHttp(
      'POST',
      `/api/posts/${postId}/reactions`,
      { reaction: 'like' },
      { 'x-sovra-did': 'did:sovra:architect_test' }
    );
    await dispatchApiRequest(reactReq, reactRes, `/api/posts/${postId}/reactions`);
    expect(reactRes.statusCode).toBe(200);
    const reactData = JSON.parse(reactRes.body);
    expect(reactData.likesCount).toBe(1);
    expect(reactData.reactions.like).toBe(1);

    // 4. Add Comment
    const { req: commentReq, res: commentRes } = createMockHttp(
      'POST',
      `/api/posts/${postId}/comments`,
      {
        content: 'Verified by autonomous QA pipeline.',
        authorHandle: 'qa_engineer',
      },
      { 'x-sovra-did': 'did:sovra:qa_bot' }
    );
    await dispatchApiRequest(commentReq, commentRes, `/api/posts/${postId}/comments`);
    expect(commentRes.statusCode).toBe(201);
    const commentData = JSON.parse(commentRes.body);
    expect(commentData.comment.content).toBe('Verified by autonomous QA pipeline.');

    // 5. Query Comments
    const { req: getCommentsReq, res: getCommentsRes } = createMockHttp(
      'GET',
      `/api/posts/${postId}/comments`
    );
    await dispatchApiRequest(getCommentsReq, getCommentsRes, `/api/posts/${postId}/comments`);
    expect(getCommentsRes.statusCode).toBe(200);
    const commentsList = JSON.parse(getCommentsRes.body);
    expect(commentsList.totalCount).toBe(1);

    // 6. Soft Delete Post
    const { req: delReq, res: delRes } = createMockHttp(
      'DELETE',
      `/api/posts/${postId}`,
      undefined,
      { 'x-sovra-did': 'did:sovra:architect_test' }
    );
    await dispatchApiRequest(delReq, delRes, `/api/posts/${postId}`);
    expect(delRes.statusCode).toBe(200);

    // Verify post is excluded from active feed
    const { req: feedAfterReq, res: feedAfterRes } = createMockHttp('GET', '/api/posts?limit=10');
    await dispatchApiRequest(feedAfterReq, feedAfterRes, '/api/posts');
    const feedAfterData = JSON.parse(feedAfterRes.body);
    expect(feedAfterData.posts.some((p: any) => p.id === postId)).toBe(false);
  });

  it('7. Chat Controller: manages end-to-end direct messages, thread retrieval, and read receipts', async () => {
    const senderDid = 'did:sovra:alice_peer';
    const recipientDid = 'did:sovra:bob_peer';

    // 1. Send direct message
    const { req: sendReq, res: sendRes } = createMockHttp(
      'POST',
      '/api/chat/messages',
      {
        recipientDid,
        content: 'Decentralized message via sovereign mesh.',
        attachmentCid: 'bafybeic52...sample',
        disappearingSeconds: 86400,
      },
      { 'x-sovra-did': senderDid }
    );
    await dispatchApiRequest(sendReq, sendRes, '/api/chat/messages');
    expect(sendRes.statusCode).toBe(201);
    const sendData = JSON.parse(sendRes.body);
    expect(sendData.ok).toBe(true);
    expect(sendData.message.senderDid).toBe(senderDid);
    expect(sendData.message.recipientDid).toBe(recipientDid);
    expect(sendData.message.isDelivered).toBe(true);
    expect(sendData.message.isRead).toBe(false);
    expect(sendData.message.disappearingSeconds).toBe(86400);

    const messageId = sendData.message.id;
    const threadId = sendData.message.threadId;

    // 2. Fetch thread messages
    const { req: getMsgReq, res: getMsgRes } = createMockHttp(
      'GET',
      `/api/chat/messages/${threadId}`
    );
    await dispatchApiRequest(getMsgReq, getMsgRes, `/api/chat/messages/${threadId}`);
    expect(getMsgRes.statusCode).toBe(200);
    const msgList = JSON.parse(getMsgRes.body);
    expect(msgList.messages.length).toBeGreaterThanOrEqual(1);

    // 3. Mark message as read
    const { req: readReq, res: readRes } = createMockHttp(
      'POST',
      `/api/chat/messages/${messageId}/read`
    );
    await dispatchApiRequest(readReq, readRes, `/api/chat/messages/${messageId}/read`);
    expect(readRes.statusCode).toBe(200);
    const readData = JSON.parse(readRes.body);
    expect(readData.isRead).toBe(true);

    // 4. Fetch threads list for recipient
    const { req: threadsReq, res: threadsRes } = createMockHttp(
      'GET',
      '/api/chat/threads',
      undefined,
      { 'x-sovra-did': recipientDid }
    );
    await dispatchApiRequest(threadsReq, threadsRes, '/api/chat/threads');
    expect(threadsRes.statusCode).toBe(200);
    const threadsData = JSON.parse(threadsRes.body);
    expect(threadsData.ok).toBe(true);
    expect(threadsData.threads.some((t: any) => t.threadId === threadId)).toBe(true);
  });
});
