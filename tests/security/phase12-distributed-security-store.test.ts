/**
 * 👑 SOVRA PROTOCOL - PHASE 12: DISTRIBUTED REPLAY & RATE LIMITING TEST SUITE
 * File: tests/security/phase12-distributed-security-store.test.ts
 *
 * Verifies Workstream 4:
 * 1. Same nonce consumed on Replica A is immediately rejected on Replica B
 * 2. Simultaneous parallel replay on multiple replicas serialized atomically
 * 3. Distributed rate limiting enforced across replicas (alternating replicas cannot bypass)
 * 4. Shared storage outage triggers fail-closed behavior for protected requests
 * 5. Safe recovery and resumption after storage restoration
 * 6. Expired replay entries cleaned up safely without data corruption
 * 7. Concurrent atomic insertion into shared store
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DecoupledApiServer } from '../../services/api/src/server.js';
import { SharedSecurityStore } from '../../services/api/src/storage/shared-security-store.js';

describe('SOVRA Phase 12: Distributed Replay & Rate Limiting Store', () => {
  const secret = 'sovra_super_secret_phase12_production_key_32_bytes_long_valid';
  const sharedDbFile = path.resolve(process.cwd(), `.test-p12-shared-${Date.now()}.sqlite`);
  let sharedStore: SharedSecurityStore;

  let replicaA: DecoupledApiServer;
  let replicaB: DecoupledApiServer;
  let portA: number;
  let portB: number;

  beforeAll(async () => {
    sharedStore = new SharedSecurityStore({ dbPath: sharedDbFile });

    replicaA = new DecoupledApiServer({
      port: 0,
      internalSecret: secret,
      sharedStore,
      rateLimitMaxRequests: 100,
      rateLimitWindowMs: 10000,
    });

    replicaB = new DecoupledApiServer({
      port: 0,
      internalSecret: secret,
      sharedStore,
      rateLimitMaxRequests: 100,
      rateLimitWindowMs: 10000,
    });

    portA = await replicaA.start();
    portB = await replicaB.start();
  });

  afterAll(async () => {
    await replicaA.stop();
    await replicaB.stop();
    sharedStore.close();
    if (fs.existsSync(sharedDbFile)) fs.unlinkSync(sharedDbFile);
    if (fs.existsSync(`${sharedDbFile}-wal`)) fs.unlinkSync(`${sharedDbFile}-wal`);
    if (fs.existsSync(`${sharedDbFile}-shm`)) fs.unlinkSync(`${sharedDbFile}-shm`);
  });

  it('1. prevents replay across replicas: nonce consumed on Replica A is rejected on Replica B', async () => {
    const method = 'POST';
    const pathUrl = '/internal/cluster/ping';
    const nonce = `dist_nonce_${crypto.randomUUID()}`;
    const now = Date.now();

    const hmac = crypto
      .createHmac('sha256', secret)
      .update(`${method}:${pathUrl}:${now}:${nonce}`)
      .digest('hex');

    const headers = {
      'X-Sovra-Internal-Auth': hmac,
      'X-Sovra-Timestamp': String(now),
      'X-Sovra-Nonce': nonce,
    };

    // Replica A: Succeeded
    const resA = await fetch(`http://127.0.0.1:${portA}${pathUrl}`, { method, headers });
    expect(resA.status).toBe(200);

    // Replica B: Replay detected via shared store -> Rejected
    const resB = await fetch(`http://127.0.0.1:${portB}${pathUrl}`, { method, headers });
    expect(resB.status).toBe(401);
  });

  it('2. serializes simultaneous parallel requests to multiple replicas with exactly 1 success', async () => {
    const method = 'POST';
    const pathUrl = '/internal/cluster/ping';
    const nonce = `simul_nonce_${crypto.randomUUID()}`;
    const now = Date.now();

    const hmac = crypto
      .createHmac('sha256', secret)
      .update(`${method}:${pathUrl}:${now}:${nonce}`)
      .digest('hex');

    const headers = {
      'X-Sovra-Internal-Auth': hmac,
      'X-Sovra-Timestamp': String(now),
      'X-Sovra-Nonce': nonce,
    };

    // 8 requests evenly split across Replica A and Replica B sent simultaneously
    const requests = [
      fetch(`http://127.0.0.1:${portA}${pathUrl}`, { method, headers }),
      fetch(`http://127.0.0.1:${portB}${pathUrl}`, { method, headers }),
      fetch(`http://127.0.0.1:${portA}${pathUrl}`, { method, headers }),
      fetch(`http://127.0.0.1:${portB}${pathUrl}`, { method, headers }),
      fetch(`http://127.0.0.1:${portA}${pathUrl}`, { method, headers }),
      fetch(`http://127.0.0.1:${portB}${pathUrl}`, { method, headers }),
      fetch(`http://127.0.0.1:${portA}${pathUrl}`, { method, headers }),
      fetch(`http://127.0.0.1:${portB}${pathUrl}`, { method, headers }),
    ];

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);

    const successCount = statuses.filter((s) => s === 200).length;
    const rejectedCount = statuses.filter((s) => s === 401).length;

    expect(successCount).toBe(1);
    expect(rejectedCount).toBe(7);
  });

  it('3. enforces distributed rate limiting: alternating between replicas cannot bypass rate limits', async () => {
    const rlStore = new SharedSecurityStore();
    const rlServerA = new DecoupledApiServer({
      port: 0,
      sharedStore: rlStore,
      rateLimitMaxRequests: 4,
      rateLimitWindowMs: 10000,
    });
    const rlServerB = new DecoupledApiServer({
      port: 0,
      sharedStore: rlStore,
      rateLimitMaxRequests: 4,
      rateLimitWindowMs: 10000,
    });
    const pA = await rlServerA.start();
    const pB = await rlServerB.start();

    try {
      // Limit is 4 requests per 10s.
      // Client sends alternating requests: A, B, A, B (total 4 requests)
      const ports = [pA, pB, pA, pB];
      for (const port of ports) {
        const res = await fetch(`http://127.0.0.1:${port}/health/liveness`);
        expect(res.status).toBe(200);
      }

      // 5th request to Replica B must be rate limited with 429!
      const res5B = await fetch(`http://127.0.0.1:${pB}/health/liveness`);
      expect(res5B.status).toBe(429);

      // 6th request to Replica A must also be rate limited with 429!
      const res6A = await fetch(`http://127.0.0.1:${pA}/health/liveness`);
      expect(res6A.status).toBe(429);
    } finally {
      await rlServerA.stop();
      await rlServerB.stop();
      rlStore.close();
    }
  });

  it('4. fails closed during shared storage outage for protected internal requests', async () => {
    const method = 'POST';
    const pathUrl = '/internal/cluster/ping';
    const nonce = `outage_nonce_${crypto.randomUUID()}`;
    const now = Date.now();

    const hmac = crypto
      .createHmac('sha256', secret)
      .update(`${method}:${pathUrl}:${now}:${nonce}`)
      .digest('hex');

    // Simulate storage outage
    sharedStore.simulateOutage(true);

    try {
      const res = await fetch(`http://127.0.0.1:${portA}${pathUrl}`, {
        method,
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(now),
          'X-Sovra-Nonce': nonce,
        },
      });

      // Protected service call MUST FAIL CLOSED with 401
      expect(res.status).toBe(401);
    } finally {
      // Restore storage
      sharedStore.simulateOutage(false);
    }
  });

  it('5. resumes normal operations gracefully after storage outage recovery', async () => {
    const method = 'POST';
    const pathUrl = '/internal/cluster/ping';
    const nonce = `recovery_nonce_${crypto.randomUUID()}`;
    const now = Date.now();

    const hmac = crypto
      .createHmac('sha256', secret)
      .update(`${method}:${pathUrl}:${now}:${nonce}`)
      .digest('hex');

    const res = await fetch(`http://127.0.0.1:${portA}${pathUrl}`, {
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
  });

  it('6. safely cleans up expired nonces without deleting active nonces', () => {
    const now = Date.now();
    // Add expired nonce (expired 10 seconds ago)
    sharedStore.consumeNonce('expired_key_1', now - 20000, now - 10000);
    // Add active nonce (expires in 60 seconds)
    sharedStore.consumeNonce('active_key_1', now, now + 60000);

    const prunedCount = sharedStore.pruneExpiredNonces(now);
    expect(prunedCount).toBeGreaterThanOrEqual(1);

    expect(sharedStore.hasNonce('expired_key_1', now)).toBe(false);
    expect(sharedStore.hasNonce('active_key_1', now)).toBe(true);
  });

  it('7. tests low-level atomic insert concurrency on SharedSecurityStore directly', async () => {
    const testKey = `low_level_${crypto.randomUUID()}`;
    const now = Date.now();

    // Concurrently invoke consumeNonce 20 times with identical key
    const results = await Promise.all(
      Array.from({ length: 20 }).map(async () => {
        return sharedStore.consumeNonce(testKey, now, now + 60000);
      })
    );

    const trueCount = results.filter((r) => r === true).length;
    const falseCount = results.filter((r) => r === false).length;

    // Exactly one operation must succeed; 19 must fail
    expect(trueCount).toBe(1);
    expect(falseCount).toBe(19);
  });
});
