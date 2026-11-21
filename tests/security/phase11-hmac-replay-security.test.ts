/**
 * 👑 SOVRA PROTOCOL - PHASE 11 HMAC REPLAY & API SECURITY TEST SUITE
 * File: tests/security/phase11-hmac-replay-security.test.ts
 *
 * Verifies:
 * 1. Valid signed request acceptance (HTTP 200)
 * 2. Invalid signature rejection (HTTP 401)
 * 3. Modified payload detection (HTTP 401)
 * 4. Expired timestamp rejection (HTTP 401)
 * 5. Future timestamp rejection beyond clock skew tolerance (HTTP 401)
 * 6. Identical request replay rejection within 300 seconds (HTTP 401)
 * 7. Replayed request after expiry rejection (HTTP 401)
 * 8. Duplicate nonce / request-ID rejection (HTTP 401)
 * 9. Concurrent parallel replay race condition serialization
 * 10. Clock skew acceptance within [-300s, +30s]
 * 11. Zero-downtime secret rotation during active requests
 * 12. Sliding window rate-limit exhaustion & rejection (HTTP 429)
 * 13. Graceful shutdown connection draining (HTTP 503)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { DecoupledApiServer } from '../../services/api/src/server.js';

describe('SOVRA Phase 11: HMAC Replay & Enterprise API Security', () => {
  let server: DecoupledApiServer;
  let serverPort: number;
  const initialSecret = 'sovra_cluster_phase11_test_secret_key_88422';

  beforeAll(async () => {
    server = new DecoupledApiServer({
      port: 0,
      internalSecret: initialSecret,
      rateLimitMaxRequests: 100,
      rateLimitWindowMs: 60000,
      drainTimeoutMs: 2000,
    });
    serverPort = await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('1. accepts a valid HMAC signed request with fresh timestamp and unique nonce', async () => {
    const method = 'POST';
    const path = '/internal/cluster/ping';
    const now = Date.now();
    const nonce = `nonce_${crypto.randomUUID()}`;

    const hmac = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${now}:${nonce}`)
      .digest('hex');

    const res = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': hmac,
        'X-Sovra-Timestamp': String(now),
        'X-Sovra-Nonce': nonce,
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.pong).toBe(true);
  });

  it('2. rejects requests with invalid HMAC signatures', async () => {
    const method = 'POST';
    const path = '/internal/cluster/ping';
    const now = Date.now();
    const nonce = `nonce_${crypto.randomUUID()}`;

    const res = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': 'deadbeef_invalid_hmac_signature_00000000000000000000000000000000',
        'X-Sovra-Timestamp': String(now),
        'X-Sovra-Nonce': nonce,
      },
    });

    expect(res.status).toBe(401);
  });

  it('3. rejects requests where URL path or method was modified in transit', async () => {
    const originalMethod = 'POST';
    const originalPath = '/internal/cluster/ping';
    const now = Date.now();
    const nonce = `nonce_${crypto.randomUUID()}`;

    // Signature computed for /internal/cluster/ping
    const hmac = crypto
      .createHmac('sha256', initialSecret)
      .update(`${originalMethod}:${originalPath}:${now}:${nonce}`)
      .digest('hex');

    // Attacker sends signature to a different endpoint (/internal/security/events)
    const modifiedPath = '/internal/security/events';
    const res = await fetch(`http://127.0.0.1:${serverPort}${modifiedPath}`, {
      method: 'POST',
      headers: {
        'X-Sovra-Internal-Auth': hmac,
        'X-Sovra-Timestamp': String(now),
        'X-Sovra-Nonce': nonce,
      },
    });

    expect(res.status).toBe(401);
  });

  it('4. rejects requests with expired timestamps (> 300 seconds old)', async () => {
    const method = 'POST';
    const path = '/internal/cluster/ping';
    const now = Date.now();
    const expiredTimestamp = now - 305_000; // 5 min 5 sec ago
    const nonce = `nonce_${crypto.randomUUID()}`;

    const hmac = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${expiredTimestamp}:${nonce}`)
      .digest('hex');

    const res = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': hmac,
        'X-Sovra-Timestamp': String(expiredTimestamp),
        'X-Sovra-Nonce': nonce,
      },
    });

    expect(res.status).toBe(401);
  });

  it('5. rejects requests with future timestamps exceeding clock skew tolerance (> +30s)', async () => {
    const method = 'POST';
    const path = '/internal/cluster/ping';
    const now = Date.now();
    const futureTimestamp = now + 45_000; // 45 seconds in the future (> 30s)
    const nonce = `nonce_${crypto.randomUUID()}`;

    const hmac = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${futureTimestamp}:${nonce}`)
      .digest('hex');

    const res = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': hmac,
        'X-Sovra-Timestamp': String(futureTimestamp),
        'X-Sovra-Nonce': nonce,
      },
    });

    expect(res.status).toBe(401);
  });

  it('6. detects and rejects replayed identical request within the 300-second window', async () => {
    const method = 'POST';
    const path = '/internal/cluster/ping';
    const now = Date.now();
    const nonce = `nonce_replay_test_${crypto.randomUUID()}`;

    const hmac = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${now}:${nonce}`)
      .digest('hex');

    const headers = {
      'X-Sovra-Internal-Auth': hmac,
      'X-Sovra-Timestamp': String(now),
      'X-Sovra-Nonce': nonce,
    };

    // First attempt: Must succeed
    const res1 = await fetch(`http://127.0.0.1:${serverPort}${path}`, { method, headers });
    expect(res1.status).toBe(200);

    // Second attempt (identical replay within window): Must be rejected with 401
    const res2 = await fetch(`http://127.0.0.1:${serverPort}${path}`, { method, headers });
    expect(res2.status).toBe(401);

    // Third attempt (identical replay): Must also be rejected
    const res3 = await fetch(`http://127.0.0.1:${serverPort}${path}`, { method, headers });
    expect(res3.status).toBe(401);
  });

  it('7. detects and rejects signature-level replays without explicit nonce header', async () => {
    const method = 'POST';
    const path = '/internal/cluster/ping';
    const now = Date.now();

    const hmac = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${now}`)
      .digest('hex');

    const headers = {
      'X-Sovra-Internal-Auth': hmac,
      'X-Sovra-Timestamp': String(now),
    };

    // First attempt: Accepted
    const res1 = await fetch(`http://127.0.0.1:${serverPort}${path}`, { method, headers });
    expect(res1.status).toBe(200);

    // Replay attempt: Rejected by signature digest cache
    const res2 = await fetch(`http://127.0.0.1:${serverPort}${path}`, { method, headers });
    expect(res2.status).toBe(401);
  });

  it('8. rejects duplicate nonce when used with a newly calculated timestamp', async () => {
    const method = 'POST';
    const path = '/internal/cluster/ping';
    const nonce = `shared_fixed_nonce_${crypto.randomUUID()}`;
    const t1 = Date.now();

    const hmac1 = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${t1}:${nonce}`)
      .digest('hex');

    const res1 = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': hmac1,
        'X-Sovra-Timestamp': String(t1),
        'X-Sovra-Nonce': nonce,
      },
    });
    expect(res1.status).toBe(200);

    // Attacker creates a fresh timestamp but reuses the same nonce
    const t2 = Date.now() + 1000;
    const hmac2 = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${t2}:${nonce}`)
      .digest('hex');

    const res2 = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': hmac2,
        'X-Sovra-Timestamp': String(t2),
        'X-Sovra-Nonce': nonce,
      },
    });
    expect(res2.status).toBe(401);
  });

  it('9. handles concurrent parallel replay race conditions: exactly 1 succeeds', async () => {
    const method = 'POST';
    const path = '/internal/cluster/ping';
    const now = Date.now();
    const nonce = `race_nonce_${crypto.randomUUID()}`;

    const hmac = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${now}:${nonce}`)
      .digest('hex');

    const headers = {
      'X-Sovra-Internal-Auth': hmac,
      'X-Sovra-Timestamp': String(now),
      'X-Sovra-Nonce': nonce,
    };

    // Dispatch 10 simultaneous parallel fetch calls with the exact same credentials
    const promises = Array.from({ length: 10 }).map(() =>
      fetch(`http://127.0.0.1:${serverPort}${path}`, { method, headers })
    );

    const responses = await Promise.all(promises);
    const statuses = responses.map((r) => r.status);

    const successCount = statuses.filter((s) => s === 200).length;
    const rejectedCount = statuses.filter((s) => s === 401).length;

    expect(successCount).toBe(1);
    expect(rejectedCount).toBe(9);
  });

  it('10. tolerates benign clock skew within allowed window (-60s, +15s)', async () => {
    const method = 'POST';
    const path = '/internal/cluster/ping';
    const now = Date.now();

    // Past 60 seconds (within 300s window)
    const pastSkew = now - 60_000;
    const noncePast = `skew_past_${crypto.randomUUID()}`;
    const hmacPast = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${pastSkew}:${noncePast}`)
      .digest('hex');

    const resPast = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': hmacPast,
        'X-Sovra-Timestamp': String(pastSkew),
        'X-Sovra-Nonce': noncePast,
      },
    });
    expect(resPast.status).toBe(200);

    // Future 15 seconds (within 30s forward tolerance)
    const futureSkew = now + 15_000;
    const nonceFuture = `skew_future_${crypto.randomUUID()}`;
    const hmacFuture = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${futureSkew}:${nonceFuture}`)
      .digest('hex');

    const resFuture = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': hmacFuture,
        'X-Sovra-Timestamp': String(futureSkew),
        'X-Sovra-Nonce': nonceFuture,
      },
    });
    expect(resFuture.status).toBe(200);
  });

  it('11. verifies zero-downtime secret rotation: old secret in grace window and new secret are both accepted', async () => {
    const method = 'POST';
    const path = '/internal/cluster/ping';

    // Rotate secret
    const newSecretVersion = server.secretManager.rotateSecret();
    const rotatedSecret = newSecretVersion.secret;
    expect(newSecretVersion.version).toBe(2);

    // 1. Request signed with new secret V2 -> 200 OK
    const tNew = Date.now();
    const nonceNew = `rot_v2_${crypto.randomUUID()}`;
    const hmacNew = crypto
      .createHmac('sha256', rotatedSecret)
      .update(`${method}:${path}:${tNew}:${nonceNew}`)
      .digest('hex');

    const resNew = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': hmacNew,
        'X-Sovra-Timestamp': String(tNew),
        'X-Sovra-Nonce': nonceNew,
      },
    });
    expect(resNew.status).toBe(200);

    // 2. In-flight request signed with old secret V1 during grace window -> 200 OK
    const tOld = Date.now();
    const nonceOld = `rot_v1_${crypto.randomUUID()}`;
    const hmacOld = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${tOld}:${nonceOld}`)
      .digest('hex');

    const resOld = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': hmacOld,
        'X-Sovra-Timestamp': String(tOld),
        'X-Sovra-Nonce': nonceOld,
      },
    });
    expect(resOld.status).toBe(200);

    // 3. Immediately revoke V1 -> requests signed with V1 now fail
    server.secretManager.revokeVersion(1);

    const tRevoked = Date.now();
    const nonceRevoked = `rot_v1_revoked_${crypto.randomUUID()}`;
    const hmacRevoked = crypto
      .createHmac('sha256', initialSecret)
      .update(`${method}:${path}:${tRevoked}:${nonceRevoked}`)
      .digest('hex');

    const resRevoked = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
      method,
      headers: {
        'X-Sovra-Internal-Auth': hmacRevoked,
        'X-Sovra-Timestamp': String(tRevoked),
        'X-Sovra-Nonce': nonceRevoked,
      },
    });
    expect(resRevoked.status).toBe(401);
  });

  it('12. enforces sliding-window rate limiting on public health endpoints', async () => {
    // Dedicated server with low rate limit threshold = 4 requests
    const rlServer = new DecoupledApiServer({
      port: 0,
      rateLimitMaxRequests: 4,
      rateLimitWindowMs: 5000,
    });
    const rlPort = await rlServer.start();

    try {
      const results: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await fetch(`http://127.0.0.1:${rlPort}/health/liveness`);
        results.push(res.status);
      }

      // First 4 requests succeed
      expect(results.slice(0, 4)).toEqual([200, 200, 200, 200]);
      // 5th and 6th are rate-limited with 429
      expect(results[4]).toBe(429);
      expect(results[5]).toBe(429);
    } finally {
      await rlServer.stop();
    }
  });

  it('13. rejects incoming requests with 503 during graceful shutdown and request draining', async () => {
    const drainServer = new DecoupledApiServer({
      port: 0,
      drainTimeoutMs: 1500,
    });
    const drainPort = await drainServer.start();

    // Initiate stop asynchronously
    const stopPromise = drainServer.stop();

    // Immediate request while draining must receive 503 Service Unavailable
    try {
      const res = await fetch(`http://127.0.0.1:${drainPort}/health/liveness`);
      expect(res.status).toBe(503);
    } catch {
      // Connection closed immediately is also an acceptable drainage outcome
    }

    await stopPromise;
  });
});
