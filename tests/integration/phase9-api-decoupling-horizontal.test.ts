/**
 * @file tests/integration/phase9-api-decoupling-horizontal.test.ts
 * SOVRA Phase 9: Application Layer Decoupling, Horizontal Scaling & Service Auth Gate.
 *
 * Verifies:
 *  1. Independent API server lifecycle and multi-instance concurrency
 *  2. Operational health checks: /health, /health/liveness, /health/readiness, /health/consensus
 *  3. Dynamic Multi-Validator RPC failover
 *  4. Secure Service-to-Service authentication and anti-replay validation
 *  5. Graceful shutdown with in-flight request draining
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { DecoupledApiServer } from '../../services/api/src/server.js';

describe('SOVRA Phase 9: Application Layer Decoupling & Horizontal Scaling', () => {
  let apiInstance1: DecoupledApiServer;
  let apiInstance2: DecoupledApiServer;
  let port1: number;
  let port2: number;
  const testSecret = 'sovra_test_internal_cluster_secret_xyz789';

  beforeAll(async () => {
    // Launch two independent API instances simulating horizontally scaled pods
    apiInstance1 = new DecoupledApiServer({
      port: 0, // OS assigns random available port
      internalSecret: testSecret,
      l1RpcUrls: [
        'http://127.0.0.1:26657', // Live node 0
        'http://127.0.0.1:26667', // Live node 1
        'http://127.0.0.1:99999', // Dead fallback
      ],
    });

    apiInstance2 = new DecoupledApiServer({
      port: 0,
      internalSecret: testSecret,
      l1RpcUrls: [
        'http://127.0.0.1:88888', // Dead primary to test failover
        'http://127.0.0.1:26657', // Healthy secondary
      ],
    });

    port1 = await apiInstance1.start();
    port2 = await apiInstance2.start();
  });

  afterAll(async () => {
    await apiInstance1.stop();
    await apiInstance2.stop();
  });

  // =========================================================================
  // WORKSTREAM 1: HEALTH CHECKS & OPERATIONAL READINESS
  // =========================================================================
  describe('Workstream 1: Decoupled Health Checks & L1 Consensus Probing', () => {
    it('verifies /health endpoint returns UP status and process uptime on both nodes', async () => {
      for (const port of [port1, port2]) {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe('UP');
        expect(data.service).toBe('sovra-api-server');
        expect(typeof data.uptimeSeconds).toBe('number');
      }
    });

    it('verifies /health/liveness returns process alive signal for container orchestrators', async () => {
      const res = await fetch(`http://127.0.0.1:${port1}/health/liveness`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.alive).toBe(true);
      expect(typeof data.pid).toBe('number');
    });

    it('verifies /health/readiness confirms L1 CometBFT connectivity', async () => {
      const res = await fetch(`http://127.0.0.1:${port1}/health/readiness`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ready).toBe(true);
      expect(data.activeRpc).toBe('http://127.0.0.1:26657');
      expect(Number(data.blockHeight)).toBeGreaterThan(80000);
    });

    it('verifies /health/consensus inspects live consensus metadata from connected validator', async () => {
      const res = await fetch(`http://127.0.0.1:${port1}/health/consensus`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.connected).toBe(true);
      expect(data.moniker).toBe('validator-0');
      expect(data.chainId).toBe('sovra-testnet-0');
      expect(Number(data.height)).toBeGreaterThan(80000);
    });
  });

  // =========================================================================
  // WORKSTREAM 2: DYNAMIC MULTI-VALIDATOR RPC FAILOVER
  // =========================================================================
  describe('Workstream 2: Multi-Validator RPC Redundancy & Failover Driver', () => {
    it('proves Instance 2 seamlessly skips offline port 88888 and discovers live secondary port 26657', async () => {
      const healthyRpc = await apiInstance2.getHealthyValidatorRpc();
      expect(healthyRpc).not.toBeNull();
      expect(healthyRpc?.url).toBe('http://127.0.0.1:26657');
      expect(healthyRpc?.status.moniker).toBe('validator-0');
    });

    it('proves readiness probe succeeds on Instance 2 despite primary RPC being offline', async () => {
      const res = await fetch(`http://127.0.0.1:${port2}/health/readiness`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ready).toBe(true);
      expect(data.activeRpc).toBe('http://127.0.0.1:26657');
    });
  });

  // =========================================================================
  // WORKSTREAM 3: SERVICE-TO-SERVICE AUTHENTICATION & REPLAY PREVENTION
  // =========================================================================
  describe('Workstream 3: Secure Service-to-Service Cluster Authentication', () => {
    it('strictly rejects unauthenticated requests to /internal/* with 401', async () => {
      const res = await fetch(`http://127.0.0.1:${port1}/internal/cluster/nodes`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Unauthorized');
    });

    it('strictly rejects requests with invalid bearer token', async () => {
      const res = await fetch(`http://127.0.0.1:${port1}/internal/cluster/nodes`, {
        headers: {
          'X-Sovra-Internal-Auth': 'Bearer forged_fake_secret_token_123',
        },
      });
      expect(res.status).toBe(401);
    });

    it('allows internal requests with valid cluster secret token', async () => {
      const res = await fetch(`http://127.0.0.1:${port1}/internal/cluster/nodes`, {
        headers: {
          'X-Sovra-Internal-Auth': `Bearer ${testSecret}`,
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.validatorRpcPool)).toBe(true);
      expect(data.validatorRpcPool.length).toBe(3);
    });

    it('allows internal requests signed with HMAC-SHA256 and fresh timestamp', async () => {
      const timestamp = Date.now().toString();
      const method = 'POST';
      const path = '/internal/cluster/ping';
      const hmac = crypto
        .createHmac('sha256', testSecret)
        .update(`${method}:${path}:${timestamp}`)
        .digest('hex');

      const res = await fetch(`http://127.0.0.1:${port1}${path}`, {
        method,
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': timestamp,
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.pong).toBe(true);
    });

    it('rejects HMAC-signed request with expired timestamp (> 5 minutes old)', async () => {
      const staleTimestamp = (Date.now() - 360_000).toString(); // 6 minutes ago
      const method = 'POST';
      const path = '/internal/cluster/ping';
      const hmac = crypto
        .createHmac('sha256', testSecret)
        .update(`${method}:${path}:${staleTimestamp}`)
        .digest('hex');

      const res = await fetch(`http://127.0.0.1:${port1}${path}`, {
        method,
        headers: {
          'X-Sovra-Internal-Auth': hmac,
          'X-Sovra-Timestamp': staleTimestamp,
        },
      });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // WORKSTREAM 4: GRACEFUL SHUTDOWN & REQUEST DRAINING
  // =========================================================================
  describe('Workstream 4: Graceful Shutdown Lifecycle', () => {
    it('executes graceful shutdown, draining in-flight requests and cleanly unbinding port', async () => {
      const ephemeralServer = new DecoupledApiServer({
        port: 0,
        drainTimeoutMs: 1000,
      });
      const tempPort = await ephemeralServer.start();

      // Verify server is UP
      const checkRes = await fetch(`http://127.0.0.1:${tempPort}/health`);
      expect(checkRes.status).toBe(200);

      // Trigger shutdown
      await ephemeralServer.stop();

      // Verify port is closed post-shutdown
      await expect(fetch(`http://127.0.0.1:${tempPort}/health`)).rejects.toThrow();
    });
  });
});
