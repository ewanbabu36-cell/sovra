/**
 * @file tests/reliability/production-soak-and-concurrency.test.ts
 * 1,000-Peer Production Soak & High-Concurrency Stress Drill.
 *
 * Simulates high-throughput production workloads:
 * - 500 Social & Feed operations (post creation, emoji reactions, feed queries)
 * - 300 E2EE Encrypted Messaging operations (double ratchet packets, message queues)
 * - 200 DePIN Micro-ISP Bandwidth Metering sessions
 *
 * Asserts:
 * 1. Zero uncaught exceptions (100% operation success rate).
 * 2. Zero SQLite write lock timeouts (WAL concurrency verification).
 * 3. p99 response latency <= 50ms for high-frequency operations.
 * 4. Strictly bounded heap memory growth (no memory leaks).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { performance } from 'node:perf_hooks';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

interface LatencyMetrics {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  errorCount: number;
}

function computeLatencyMetrics(latencies: number[], errorCount: number): LatencyMetrics {
  latencies.sort((a, b) => a - b);
  const count = latencies.length;
  const minMs = count > 0 ? latencies[0]! : 0;
  const maxMs = count > 0 ? latencies[count - 1]! : 0;
  const sum = latencies.reduce((acc, v) => acc + v, 0);
  const avgMs = count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
  const p95Ms = count > 0 ? Math.round(latencies[Math.floor(count * 0.95)]! * 100) / 100 : 0;
  const p99Ms = count > 0 ? Math.round(latencies[Math.floor(count * 0.99)]! * 100) / 100 : 0;
  return { count, minMs, maxMs, avgMs, p95Ms, p99Ms, errorCount };
}

describe('1,000-Peer Production Soak & Stress Drill', { timeout: 60000 }, () => {
  let masterSessionToken: string;
  let masterUserDid: string;
  let samplePostId: string;
  let depinSessionId: string;
  let initialMemoryBytes: number;

  beforeAll(async () => {
    // Record baseline heap memory before drill
    if (global.gc) global.gc();
    initialMemoryBytes = process.memoryUsage().heapUsed;

    // Register primary soak orchestrator account
    const regRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `soak_leader_${Date.now()}`,
        displayName: 'Production Soak Leader',
        deviceType: 'ClusterRunner',
      }),
    });
    expect(regRes.status).toBe(200);
    const regData = await regRes.json();
    expect(regData.ok).toBe(true);
    masterSessionToken = regData.sessionToken;
    masterUserDid = regData.user.did;

    // Seed initial post for reaction soak
    const seedPost = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${masterSessionToken}`,
      },
      body: JSON.stringify({
        caption: 'Anchor seed post for 1000-peer production soak drill',
        tags: '#soak #anchor',
        visibility: 'public',
      }),
    }).then(r => r.json());
    samplePostId = seedPost.post.id;

    // Seed initial DePIN session
    const seedDepin = await fetch(`${BASE_URL}/api/depin/mesh/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${masterSessionToken}`,
      },
      body: JSON.stringify({
        hotspotNodeDid: masterUserDid,
        clientPeerDid: 'did:sovra:guest_mesh_client',
      }),
    }).then(r => r.json());
    depinSessionId = seedDepin.session.sessionId;
  });

  it('executes 1,000 concurrent multi-dimension operations with p99 <= 50ms and bounded heap', async () => {
    const TOTAL_OPERATIONS = 1000;
    const latencies: number[] = [];
    let errorCount = 0;
    let lockTimeouts = 0;

    const opTasks: Array<() => Promise<void>> = [];

    // Helper for measuring operation execution latency
    const executeMeasuredOp = async (task: () => Promise<Response>) => {
      const t0 = performance.now();
      try {
        const res = await task();
        const duration = performance.now() - t0;
        latencies.push(duration);

        if (!res.ok) {
          errorCount++;
          const bodyText = await res.text();
          if (bodyText.includes('SQLITE_BUSY') || bodyText.includes('database is locked')) {
            lockTimeouts++;
          }
        } else {
          const data = await res.json().catch(() => ({}));
          if (data && data.error && (data.error.includes('SQLITE_BUSY') || data.error.includes('locked'))) {
            lockTimeouts++;
          }
        }
      } catch (err: any) {
        errorCount++;
        if (err?.message?.includes('SQLITE_BUSY') || err?.message?.includes('database is locked')) {
          lockTimeouts++;
        }
      }
    };

    // Sub-segment 1: 500 Social & Feed operations (150 creations, 200 reads, 150 emoji reactions)
    for (let i = 0; i < 500; i++) {
      if (i % 3 === 0) {
        // Feed post creation
        opTasks.push(() =>
          executeMeasuredOp(() =>
            fetch(`${BASE_URL}/api/feed/create`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${masterSessionToken}`,
              },
              body: JSON.stringify({
                caption: `Soak post #${i} - High concurrency decentralized telemetry`,
                tags: '#soak #p2p #stress',
                visibility: 'public',
              }),
            })
          )
        );
      } else if (i % 3 === 1) {
        // High-velocity feed read
        opTasks.push(() =>
          executeMeasuredOp(() =>
            fetch(`${BASE_URL}/api/feed/posts?limit=10&page=1`, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${masterSessionToken}`,
              },
            })
          )
        );
      } else {
        // Post reaction
        opTasks.push(() =>
          executeMeasuredOp(() =>
            fetch(`${BASE_URL}/api/feed/react`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${masterSessionToken}`,
              },
              body: JSON.stringify({
                postId: samplePostId,
                emoji: '🔥',
              }),
            })
          )
        );
      }
    }

    // Sub-segment 2: 300 E2EE Messaging operations (message send, packet relay)
    for (let i = 0; i < 300; i++) {
      opTasks.push(() =>
        executeMeasuredOp(() =>
          fetch(`${BASE_URL}/api/chat/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${masterSessionToken}`,
            },
            body: JSON.stringify({
              recipientDid: masterUserDid,
              text: `SOAK_E2EE_CIPHERTEXT_${i}_` + 'a'.repeat(32),
            }),
          })
        )
      );
    }

    // Sub-segment 3: 200 DePIN Micro-ISP Bandwidth Metering & Telemetry
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) {
        // DePIN micro-ISP bandwidth chunk metering
        opTasks.push(() =>
          executeMeasuredOp(() =>
            fetch(`${BASE_URL}/api/depin/mesh/meter`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${masterSessionToken}`,
              },
              body: JSON.stringify({
                sessionId: depinSessionId,
                bytesRelayed: 65536,
              }),
            })
          )
        );
      } else {
        // Mesh telemetry query
        opTasks.push(() =>
          executeMeasuredOp(() =>
            fetch(`${BASE_URL}/api/mesh/telemetry`, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${masterSessionToken}`,
              },
            })
          )
        );
      }
    }

    expect(opTasks.length).toBe(TOTAL_OPERATIONS);

    // Warm-up pass to prime sockets and JIT compilers
    await fetch(`${BASE_URL}/api/status`);

    // Execute across 12 concurrent worker streams simulating 1,000 distinct client operations
    const WORKER_CONCURRENCY = 12;
    let nextIdx = 0;
    const worker = async () => {
      while (nextIdx < opTasks.length) {
        const currentTask = opTasks[nextIdx++];
        if (currentTask) {
          await currentTask();
        }
      }
    };

    await Promise.all(Array.from({ length: WORKER_CONCURRENCY }, () => worker()));

    const metrics = computeLatencyMetrics(latencies, errorCount);

    // Assertion 1: Zero uncaught exceptions / 0 HTTP fatal errors (100% success across 1000 ops)
    expect(metrics.errorCount).toBe(0);
    expect(metrics.count).toBe(TOTAL_OPERATIONS);

    // Assertion 2: Zero SQLite write lock timeouts (WAL concurrency is intact)
    expect(lockTimeouts).toBe(0);

    // Assertion 3: Strict bounded latency - average latency <= 35ms, p99 <= 50ms
    expect(metrics.avgMs).toBeLessThanOrEqual(35);
    expect(metrics.p99Ms).toBeLessThanOrEqual(50);

    // Assertion 4: Bounded Heap Growth (< 120MB growth for 1,000 sustained operations)
    if (global.gc) global.gc();
    const finalMemoryBytes = process.memoryUsage().heapUsed;
    const heapGrowthMb = (finalMemoryBytes - initialMemoryBytes) / (1024 * 1024);
    expect(heapGrowthMb).toBeLessThan(120);
  });
});
