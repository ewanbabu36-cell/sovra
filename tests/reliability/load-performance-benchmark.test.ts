import { describe, it, expect, beforeAll } from 'vitest';
import { performance } from 'node:perf_hooks';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

interface LatencyStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p95: number;
  p99: number;
  errors: number;
}

function calculateLatencyStats(latencies: number[], errors: number): LatencyStats {
  latencies.sort((a, b) => a - b);
  const count = latencies.length;
  const min = count > 0 ? latencies[0] : 0;
  const max = count > 0 ? latencies[count - 1] : 0;
  const sum = latencies.reduce((a, b) => a + b, 0);
  const avg = count > 0 ? sum / count : 0;
  const p95 = count > 0 ? latencies[Math.floor(count * 0.95)] : 0;
  const p99 = count > 0 ? latencies[Math.floor(count * 0.99)] : 0;
  return { count, min, max, avg, p95, p99, errors };
}

describe('Load & Throughput Performance Benchmark Suite', { timeout: 45000 }, () => {
  let sessionToken: string;

  beforeAll(async () => {
    // Register bench user
    const regRes = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `bench_${Date.now()}`,
        displayName: 'Bench User',
        deviceType: 'Desktop',
      }),
    });
    const regData = await regRes.json();
    sessionToken = regData.sessionToken;

    // Create 5 sample posts for feed benchmark realism
    for (let i = 0; i < 5; i++) {
      await fetch(`${BASE_URL}/api/feed/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          caption: `Bench test post content #${i} for realistic feed sizing`,
          tags: `#bench #${i}`,
          visibility: 'public',
        }),
      });
    }

    // Warm-up requests
    for (let i = 0; i < 5; i++) {
      await fetch(`${BASE_URL}/api/status`);
    }
  }, 30000);

  // --- BENCH-01: STATUS ENDPOINT THROUGHPUT & P95 LATENCY ---
  it('[BENCH-01] GET /api/status sustains 100 requests with p95 < 150ms and 0 errors', async () => {
    const REQUEST_COUNT = 100;
    const latencies: number[] = [];
    let errors = 0;

    for (let i = 0; i < REQUEST_COUNT; i++) {
      const start = performance.now();
      try {
        const res = await fetch(`${BASE_URL}/api/status`);
        const duration = performance.now() - start;
        if (res.status === 200) {
          latencies.push(duration);
        } else {
          errors++;
        }
      } catch (_) {
        errors++;
      }
    }

    const stats = calculateLatencyStats(latencies, errors);
    console.log(`\n[BENCH-01] GET /api/status Latency Metrics:`, {
      requests: stats.count,
      avgMs: Number(stats.avg.toFixed(2)),
      p95Ms: Number(stats.p95.toFixed(2)),
      p99Ms: Number(stats.p99.toFixed(2)),
      errors: stats.errors,
    });

    expect(stats.errors).toBe(0);
    expect(stats.count).toBe(REQUEST_COUNT);
    expect(stats.p95).toBeLessThan(150); // Under 150ms p95 SLA
  });

  // --- BENCH-02: FEED QUERY LATENCY & P95 ---
  it('[BENCH-02] GET /api/feed/list sustains 50 requests with p95 < 200ms and 0 errors', async () => {
    const REQUEST_COUNT = 50;
    const latencies: number[] = [];
    let errors = 0;

    for (let i = 0; i < REQUEST_COUNT; i++) {
      const start = performance.now();
      try {
        const res = await fetch(`${BASE_URL}/api/feed/list`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        const duration = performance.now() - start;
        if (res.status === 200) {
          const data = await res.json();
          if (data.ok) {
            latencies.push(duration);
          } else {
            errors++;
          }
        } else {
          errors++;
        }
      } catch (_) {
        errors++;
      }
    }

    const stats = calculateLatencyStats(latencies, errors);
    console.log(`\n[BENCH-02] GET /api/feed/list Latency Metrics:`, {
      requests: stats.count,
      avgMs: Number(stats.avg.toFixed(2)),
      p95Ms: Number(stats.p95.toFixed(2)),
      p99Ms: Number(stats.p99.toFixed(2)),
      errors: stats.errors,
    });

    expect(stats.errors).toBe(0);
    expect(stats.count).toBe(REQUEST_COUNT);
    expect(stats.p95).toBeLessThan(200); // Under 200ms p95 SLA
  });

  // --- BENCH-03: STORAGE STATS LATENCY ---
  it('[BENCH-03] GET /api/node/storage-stats sustains 50 requests with p95 < 150ms and 0 errors', async () => {
    const REQUEST_COUNT = 50;
    const latencies: number[] = [];
    let errors = 0;

    for (let i = 0; i < REQUEST_COUNT; i++) {
      const start = performance.now();
      try {
        const res = await fetch(`${BASE_URL}/api/node/storage-stats`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        const duration = performance.now() - start;
        if (res.status === 200) {
          latencies.push(duration);
        } else {
          errors++;
        }
      } catch (_) {
        errors++;
      }
    }

    const stats = calculateLatencyStats(latencies, errors);
    console.log(`\n[BENCH-03] GET /api/node/storage-stats Latency Metrics:`, {
      requests: stats.count,
      avgMs: Number(stats.avg.toFixed(2)),
      p95Ms: Number(stats.p95.toFixed(2)),
      p99Ms: Number(stats.p99.toFixed(2)),
      errors: stats.errors,
    });

    expect(stats.errors).toBe(0);
    expect(stats.count).toBe(REQUEST_COUNT);
    expect(stats.p95).toBeLessThan(150);
  });

  // --- BENCH-04: RAW SQLITE WAL TRANSACTION THROUGHPUT ---
  it('[BENCH-04] Raw SQLite WAL engine processes 500 operations with > 2,000 ops/sec', () => {
    const tempDir = path.resolve(process.cwd(), `.test-bench-sqlite-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const sqlite = new SqliteSocialDatabaseEngine(tempDir);

    const userRes = sqlite.registerUser({
      did: 'did:key:z6MrBenchUser',
      handle: '@bench_sqlite',
      displayName: 'Bench User',
      avatar: 'B',
      avatarBg: '#6366f1',
    });
    expect(userRes.ok).toBe(true);

    const OP_COUNT = 500;
    const start = performance.now();

    for (let i = 0; i < OP_COUNT; i++) {
      sqlite.findUserByDid('did:key:z6MrBenchUser');
    }

    const durationMs = performance.now() - start;
    const opsPerSec = Math.round((OP_COUNT / durationMs) * 1000);

    console.log(`\n[BENCH-04] SQLite WAL Query Throughput:`, {
      operations: OP_COUNT,
      totalDurationMs: Number(durationMs.toFixed(2)),
      opsPerSec,
    });

    expect(opsPerSec).toBeGreaterThan(2000); // Assert high throughput

    sqlite.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });
});
