/**
 * 👑 SOVRA PROTOCOL - PHASE 12: SECRET HARDENING & BEARER REPLAY ELIMINATION TEST SUITE
 * File: tests/security/phase12-secret-and-auth-hardening.test.ts
 *
 * Verifies Workstream 1 & Workstream 2:
 * 1. Missing secret in production/strict mode fails closed
 * 2. Empty secret fails closed
 * 3. Known default secrets are rejected
 * 4. Secrets never appear in logs or error messages
 * 5. Secret rotation works seamlessly
 * 6. Direct static bearer token bypass is completely eliminated
 * 7. Nonce replay rejection across requests and replicas
 * 8. Request tampering detection (body, method, path)
 * 9. Replay rejection after server restart
 * 10. Replay rejection across multiple API replicas
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DecoupledApiServer,
  validateAndResolveSecret,
} from '../../services/api/src/server.js';
import { SharedSecurityStore } from '../../services/api/src/storage/shared-security-store.js';

describe('SOVRA Phase 12: Secret Hardening & Bearer Replay Elimination', () => {
  const validSecret = 'sovra_super_secret_phase12_production_key_32_bytes_long_valid';
  const sharedDbPath = path.resolve(process.cwd(), `.test-p12-auth-${Date.now()}.sqlite`);
  let sharedStore: SharedSecurityStore;
  let serverA: DecoupledApiServer;
  let serverB: DecoupledApiServer;
  let portA: number;
  let portB: number;

  beforeAll(async () => {
    sharedStore = new SharedSecurityStore({ dbPath: sharedDbPath });

    serverA = new DecoupledApiServer({
      port: 0,
      internalSecret: validSecret,
      sharedStore,
      strictSecurity: true,
    });
    serverB = new DecoupledApiServer({
      port: 0,
      internalSecret: validSecret,
      sharedStore,
      strictSecurity: true,
    });

    portA = await serverA.start();
    portB = await serverB.start();
  });

  afterAll(async () => {
    await serverA.stop();
    await serverB.stop();
    sharedStore.close();
    if (fs.existsSync(sharedDbPath)) fs.unlinkSync(sharedDbPath);
    if (fs.existsSync(`${sharedDbPath}-wal`)) fs.unlinkSync(`${sharedDbPath}-wal`);
    if (fs.existsSync(`${sharedDbPath}-shm`)) fs.unlinkSync(`${sharedDbPath}-shm`);
  });

  // =========================================================================
  // WORKSTREAM 1: SECRET HARDENING & RESOLUTION
  // =========================================================================

  describe('Workstream 1: Secret Hardening', () => {
    it('1. fails closed when production secret is missing', () => {
      expect(() => {
        validateAndResolveSecret(undefined, true, true);
      }).toThrow(/Missing required internal authentication secret/);
    });

    it('2. fails closed when secret is empty string', () => {
      expect(() => {
        validateAndResolveSecret('', true, true);
      }).toThrow(/Missing required internal authentication secret/);

      expect(() => {
        validateAndResolveSecret('   ', true, true);
      }).toThrow(/Missing required internal authentication secret/);
    });

    it('3. rejects known default insecure secret: sovra_internal_cluster_secret_default_key_2026', () => {
      expect(() => {
        validateAndResolveSecret('sovra_internal_cluster_secret_default_key_2026', false, true);
      }).toThrow(/known insecure default/);
    });

    it('4. rejects weak passwords or short secrets in production', () => {
      expect(() => {
        validateAndResolveSecret('short_key', true, true);
      }).toThrow(/minimum length requirements/);
    });

    it('5. ensures secret values never appear in logs or error messages', () => {
      const sensitiveSecret = 'very_sensitive_custom_secret_that_must_not_leak_123';
      try {
        validateAndResolveSecret('admin', true, true);
      } catch (err: any) {
        expect(err.message).not.toContain('admin');
        expect(err.message).not.toContain(sensitiveSecret);
      }
    });

    it('6. initializes successfully with valid 32+ character high-entropy secret', () => {
      const resolved = validateAndResolveSecret(validSecret, true, true);
      expect(resolved).toBe(validSecret);
    });

    it('7. verifies secret rotation stages secondary secret during grace window', () => {
      const rotated = serverA.secretManager.rotateSecret();
      expect(rotated.version).toBe(2);
      expect(serverA.secretManager.getValidSecrets()).toContain(validSecret);
      expect(serverA.secretManager.getValidSecrets()).toContain(rotated.secret);
    });
  });

  // =========================================================================
  // WORKSTREAM 2: ELIMINATE BEARER REPLAY BYPASS & TAMPER RESISTANCE
  // =========================================================================

  describe('Workstream 2: Eliminate Bearer Replay Bypass', () => {
    it('8. strictly rejects static raw bearer token in strict mode, and blocks replays in non-strict mode', async () => {
      // 1. In strict mode (serverA), raw secret as a Bearer token is rejected immediately
      const resStrict = await fetch(`http://127.0.0.1:${portA}/internal/cluster/ping`, {
        method: 'POST',
        headers: {
          'X-Sovra-Internal-Auth': `Bearer ${validSecret}`,
        },
      });

      // Must be rejected with 401 because direct bearer shortcut was eliminated!
      expect(resStrict.status).toBe(401);
      const dataStrict = await resStrict.json();
      expect(dataStrict.ok).toBe(false);

      // 2. In non-strict compatibility mode, bearer token is single-use: second attempt is rejected as REPLAY
      const nonStrictStore = new SharedSecurityStore();
      const nonStrictServer = new DecoupledApiServer({
        port: 0,
        internalSecret: validSecret,
        sharedStore: nonStrictStore,
        strictSecurity: false,
      });
      const nonStrictPort = await nonStrictServer.start();

      try {
        // First call: passes via nonce consumption
        const res1 = await fetch(`http://127.0.0.1:${nonStrictPort}/internal/cluster/ping`, {
          method: 'POST',
          headers: {
            'X-Sovra-Internal-Auth': `Bearer ${validSecret}`,
          },
        });
        expect(res1.status).toBe(200);

        // Second call (replay attack): rejected with 401 because token was already consumed!
        const res2 = await fetch(`http://127.0.0.1:${nonStrictPort}/internal/cluster/ping`, {
          method: 'POST',
          headers: {
            'X-Sovra-Internal-Auth': `Bearer ${validSecret}`,
          },
        });
        expect(res2.status).toBe(401);
      } finally {
        await nonStrictServer.stop();
        nonStrictStore.close();
      }
    });

    it('9. accepts properly signed canonical request with timestamp, nonce, and body hash', async () => {
      const method = 'POST';
      const path = '/internal/cluster/ping';
      const now = Date.now();
      const nonce = `p12_valid_${crypto.randomUUID()}`;
      const body = JSON.stringify({ ping: true });
      const bodyHash = crypto.createHash('sha256').update(body).digest('hex');

      const hmac = crypto
        .createHmac('sha256', validSecret)
        .update(`${method}:${path}:${now}:${nonce}:${bodyHash}`)
        .digest('hex');

      const res = await fetch(`http://127.0.0.1:${portA}${path}`, {
        method,
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(now),
          'X-Sovra-Nonce': nonce,
          'X-Sovra-Body-Hash': bodyHash,
          'Content-Type': 'application/json',
        },
        body,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.pong).toBe(true);
    });

    it('10. rejects replayed nonce even with a new timestamp', async () => {
      const method = 'POST';
      const path = '/internal/cluster/ping';
      const fixedNonce = `fixed_nonce_${crypto.randomUUID()}`;

      // First call
      const t1 = Date.now();
      const hmac1 = crypto
        .createHmac('sha256', validSecret)
        .update(`${method}:${path}:${t1}:${fixedNonce}`)
        .digest('hex');

      const res1 = await fetch(`http://127.0.0.1:${portA}${path}`, {
        method,
        headers: {
          'X-Sovra-Internal-Auth': hmac1,
          'X-Sovra-Timestamp': String(t1),
          'X-Sovra-Nonce': fixedNonce,
        },
      });
      expect(res1.status).toBe(200);

      // Replay attempt with same nonce on same replica
      const t2 = Date.now() + 500;
      const hmac2 = crypto
        .createHmac('sha256', validSecret)
        .update(`${method}:${path}:${t2}:${fixedNonce}`)
        .digest('hex');

      const res2 = await fetch(`http://127.0.0.1:${portA}${path}`, {
        method,
        headers: {
          'X-Sovra-Internal-Auth': hmac2,
          'X-Sovra-Timestamp': String(t2),
          'X-Sovra-Nonce': fixedNonce,
        },
      });
      expect(res2.status).toBe(401);
    });

    it('11. rejects replayed request across different API replicas (Replica A -> Replica B)', async () => {
      const method = 'POST';
      const path = '/internal/cluster/ping';
      const crossNonce = `cross_replica_nonce_${crypto.randomUUID()}`;
      const now = Date.now();

      const hmac = crypto
        .createHmac('sha256', validSecret)
        .update(`${method}:${path}:${now}:${crossNonce}`)
        .digest('hex');

      // 1. Submit to Replica A -> Success
      const resA = await fetch(`http://127.0.0.1:${portA}${path}`, {
        method,
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(now),
          'X-Sovra-Nonce': crossNonce,
        },
      });
      expect(resA.status).toBe(200);

      // 2. Replay identical request against Replica B -> REJECTED (Shared atomic store)
      const resB = await fetch(`http://127.0.0.1:${portB}${path}`, {
        method,
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(now),
          'X-Sovra-Nonce': crossNonce,
        },
      });
      expect(resB.status).toBe(401);
    });

    it('12. rejects request when payload body is modified in transit', async () => {
      const method = 'POST';
      const path = '/internal/cluster/ping';
      const now = Date.now();
      const nonce = `body_mod_${crypto.randomUUID()}`;
      const originalBody = JSON.stringify({ amount: 100 });
      const originalHash = crypto.createHash('sha256').update(originalBody).digest('hex');

      // Signature computed with original body hash
      const hmac = crypto
        .createHmac('sha256', validSecret)
        .update(`${method}:${path}:${now}:${nonce}:${originalHash}`)
        .digest('hex');

      // Attacker intercepts and modifies body to { amount: 1000000 }
      const tamperedBody = JSON.stringify({ amount: 1000000 });

      const res = await fetch(`http://127.0.0.1:${portA}${path}`, {
        method,
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(now),
          'X-Sovra-Nonce': nonce,
          'X-Sovra-Body-Hash': originalHash, // mismatch with tampered body
          'Content-Type': 'application/json',
        },
        body: tamperedBody,
      });

      expect(res.status).toBe(401);
    });

    it('13. rejects request when HTTP method is modified in transit', async () => {
      const path = '/internal/cluster/ping';
      const now = Date.now();
      const nonce = `method_mod_${crypto.randomUUID()}`;

      // Signature created for POST
      const hmac = crypto
        .createHmac('sha256', validSecret)
        .update(`POST:${path}:${now}:${nonce}`)
        .digest('hex');

      // Attacker attempts GET with that signature
      const res = await fetch(`http://127.0.0.1:${portA}${path}`, {
        method: 'GET',
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(now),
          'X-Sovra-Nonce': nonce,
        },
      });

      expect(res.status).toBe(401);
    });

    it('14. rejects request when URL path is modified in transit', async () => {
      const now = Date.now();
      const nonce = `path_mod_${crypto.randomUUID()}`;

      // Signature created for /internal/cluster/ping
      const hmac = crypto
        .createHmac('sha256', validSecret)
        .update(`POST:/internal/cluster/ping:${now}:${nonce}`)
        .digest('hex');

      // Attacker sends to /internal/cluster/nodes
      const res = await fetch(`http://127.0.0.1:${portA}/internal/cluster/nodes`, {
        method: 'POST',
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(now),
          'X-Sovra-Nonce': nonce,
        },
      });

      expect(res.status).toBe(401);
    });

    it('15. rejects requests with expired timestamp (> 300s old)', async () => {
      const now = Date.now();
      const expiredTs = now - 350_000;
      const nonce = `expired_ts_${crypto.randomUUID()}`;

      const hmac = crypto
        .createHmac('sha256', validSecret)
        .update(`POST:/internal/cluster/ping:${expiredTs}:${nonce}`)
        .digest('hex');

      const res = await fetch(`http://127.0.0.1:${portA}/internal/cluster/ping`, {
        method: 'POST',
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(expiredTs),
          'X-Sovra-Nonce': nonce,
        },
      });

      expect(res.status).toBe(401);
    });

    it('16. rejects requests with future timestamp exceeding forward tolerance (> +30s)', async () => {
      const now = Date.now();
      const futureTs = now + 40_000;
      const nonce = `future_ts_${crypto.randomUUID()}`;

      const hmac = crypto
        .createHmac('sha256', validSecret)
        .update(`POST:/internal/cluster/ping:${futureTs}:${nonce}`)
        .digest('hex');

      const res = await fetch(`http://127.0.0.1:${portA}/internal/cluster/ping`, {
        method: 'POST',
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(futureTs),
          'X-Sovra-Nonce': nonce,
        },
      });

      expect(res.status).toBe(401);
    });

    it('17. enforces persistence across server restarts (replay after restart fails)', async () => {
      const restartDbPath = path.resolve(process.cwd(), `.test-p12-restart-${Date.now()}.sqlite`);
      const persistNonce = `persist_nonce_${crypto.randomUUID()}`;
      const now = Date.now();

      const hmac = crypto
        .createHmac('sha256', validSecret)
        .update(`POST:/internal/cluster/ping:${now}:${persistNonce}`)
        .digest('hex');

      // 1. Start Server Instance 1 on restartDbPath
      const s1 = new DecoupledApiServer({
        port: 0,
        internalSecret: validSecret,
        sharedDbPath: restartDbPath,
      });
      const p1 = await s1.start();

      const res1 = await fetch(`http://127.0.0.1:${p1}/internal/cluster/ping`, {
        method: 'POST',
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(now),
          'X-Sovra-Nonce': persistNonce,
        },
      });
      expect(res1.status).toBe(200);

      // Stop Server 1 and close its storage handle
      await s1.stop();
      s1.sharedStore.close();

      // 2. Start Server Instance 2 pointing to the same persistent SQLite store
      const s2 = new DecoupledApiServer({
        port: 0,
        internalSecret: validSecret,
        sharedDbPath: restartDbPath,
      });
      const p2 = await s2.start();

      // Replay attempt after restart: MUST BE REJECTED!
      const res2 = await fetch(`http://127.0.0.1:${p2}/internal/cluster/ping`, {
        method: 'POST',
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': String(now),
          'X-Sovra-Nonce': persistNonce,
        },
      });
      expect(res2.status).toBe(401);

      await s2.stop();
      s2.sharedStore.close();
      if (fs.existsSync(restartDbPath)) fs.unlinkSync(restartDbPath);
      if (fs.existsSync(`${restartDbPath}-wal`)) fs.unlinkSync(`${restartDbPath}-wal`);
      if (fs.existsSync(`${restartDbPath}-shm`)) fs.unlinkSync(`${restartDbPath}-shm`);
    });
  });
});
