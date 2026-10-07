/**
 * @file tests/reliability/observability-failure-alert.test.ts
 * SOVRA REAL-WORLD OBSERVABILITY, TELEMETRY & HEALTH PROBES TEST SUITE
 *
 * Verifies production observability endpoints: Kubernetes probes (/livez, /readyz, /healthz),
 * Prometheus scraping metrics (/metrics), administrative operational alerts, and database telemetry.
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = 'http://localhost:3001';

describe('Sovra Observability, Health Probes & Telemetry Suite', () => {
  it('GET /healthz returns status 200 with memory usage and database engine status', async () => {
    const res = await fetch(`${BASE_URL}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const data = await res.json();
    expect(data.status).toBe('healthy');
    expect(typeof data.uptimeSeconds).toBe('number');
    expect(data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(data.memoryUsage).toBeDefined();
    expect(data.memoryUsage.heapUsed).toBeGreaterThan(0);
    expect(data.database).toBeDefined();
    expect(data.database.backend).toBe('sqlite');
    expect(data.database.journalMode).toBe('WAL');
    expect(data.database.acidCompliant).toBe(true);
  });

  it('GET /livez responds with HTTP 200 for container orchestrator liveness checks', async () => {
    const res = await fetch(`${BASE_URL}/livez`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('alive');
    expect(typeof data.timestamp).toBe('number');
  });

  it('GET /readyz responds with HTTP 200 and passes all readiness subsystem probes', async () => {
    const res = await fetch(`${BASE_URL}/readyz`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('ready');
    expect(data.checks).toBeDefined();
    expect(data.checks.databaseIntegrity).toBe(true);
    expect(data.checks.storageAccessible).toBe(true);
    expect(data.checks.p2pOnline).toBe(true);
    expect(data.database.backend).toBe('sqlite');
    expect(data.database.journalMode).toBe('WAL');
  });

  it('GET /metrics provides Prometheus-formatted scrapable telemetry', async () => {
    const res = await fetch(`${BASE_URL}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');

    const text = await res.text();
    expect(text).toContain('# TYPE sovra_uptime_seconds gauge');
    expect(text).toContain('sovra_uptime_seconds');
    expect(text).toContain('# TYPE sovra_users_count gauge');
    expect(text).toContain('sovra_users_count');
    expect(text).toContain('# TYPE sovra_posts_count gauge');
    expect(text).toContain('sovra_posts_count');
    expect(text).toContain('# TYPE sovra_storage_bytes gauge');
    expect(text).toContain('sovra_storage_bytes');
    expect(text).toContain('# TYPE sovra_memory_heap_bytes gauge');
    expect(text).toContain('sovra_memory_heap_bytes');

    // Parse metric lines to verify numeric validity
    const lines = text.split('\n').filter(l => l && !l.startsWith('#'));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      const parts = line.split(' ');
      expect(parts.length).toBe(2);
      const val = Number(parts[1]);
      expect(Number.isNaN(val)).toBe(false);
      expect(val).toBeGreaterThanOrEqual(0);
    }
  });

  it('GET /api/admin/alerts exposes telemetry alerts array', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/alerts`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.alerts)).toBe(true);
    expect(typeof data.timestamp).toBe('number');
  });

  it('GET /api/status reports SQLite WAL persistence info and zero admin dependency', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('online');
    expect(data.peerId).toBeDefined();
    expect(data.did).toBeDefined();
    expect(data.listenAddress).toContain('/tcp/');
    expect(data.database).toBeDefined();
    expect(data.database.backend).toBe('sqlite');
    expect(data.database.journalMode).toBe('WAL');
    expect(data.database.path).toContain('sqlite');
    expect(data.zeroAdminDependency).toBe(true);
  });
});
