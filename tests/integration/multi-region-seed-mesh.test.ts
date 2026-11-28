/**
 * @file tests/integration/multi-region-seed-mesh.test.ts
 * Verifies 3-Region Global Bootstrap Seed Node Mesh (US-East, EU-Central, AP-East),
 * mathematically valid Ed25519 PeerIDs, cross-region Noise_XX dialing,
 * and Production DNS/Coturn/AssetLinks preflight verification.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GLOBAL_DEFAULT_SEEDS,
  GLOBAL_DEFAULT_RELAYS,
  extractPublicKeyFromPeerId,
} from '../../packages/p2p/dist/index.js';
import { startSeedNodeDaemon, type RunningSeedNode } from '../../scripts/bootstrap-node.ts';
import { verifyStaticInfraConfigs } from '../../scripts/verify-dns-ssl.ts';

describe('Multi-Region DePIN Seed Node Mesh & SSL Preflight Suite', () => {
  const activeNodes: RunningSeedNode[] = [];
  const tmpDirs: string[] = [];

  it('proves every PeerID in GLOBAL_DEFAULT_SEEDS and GLOBAL_DEFAULT_RELAYS is a genuine 32-byte Ed25519 PeerID', () => {
    for (const seed of [...GLOBAL_DEFAULT_SEEDS, ...GLOBAL_DEFAULT_RELAYS]) {
      const peerId = seed.multiaddr.split('/p2p/')[1];
      expect(peerId).toBeDefined();
      const pubBytes = extractPublicKeyFromPeerId(peerId!);
      expect(pubBytes.length).toBe(32);
    }
  });

  it('boots 3 regional seed nodes (us-east, eu-central, ap-east) and forms a live TCP Noise_XX mesh', async () => {
    const regions = ['us-east', 'eu-central', 'ap-east'] as const;

    for (const region of regions) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sovra-seed-${region}-`));
      tmpDirs.push(dir);
      const node = await startSeedNodeDaemon({
        p2pPort: 0,
        p2pHost: '127.0.0.1',
        httpPort: 0,
        dataDir: dir,
        publicIp: '127.0.0.1',
        region,
      });
      activeNodes.push(node);
    }

    const [usEast, euCentral, apEast] = activeNodes;

    // Cross-dial to form full 3-region mesh topology
    const d1 = await euCentral.dialSeedPeer(usEast.multiaddr);
    const d2 = await apEast.dialSeedPeer(usEast.multiaddr);
    const d3 = await apEast.dialSeedPeer(euCentral.multiaddr);

    expect(d1).toBe(true);
    expect(d2).toBe(true);
    expect(d3).toBe(true);

    // Query HTTP /health and /metrics endpoints across all 3 regional nodes
    for (const node of activeNodes) {
      const healthRes = await fetch(`http://127.0.0.1:${node.httpPort}/health`);
      expect(healthRes.status).toBe(200);
      const health = await healthRes.json();
      expect(health.status).toBe('healthy');
      expect(health.region).toBe(node.region);
      expect(health.connectedPeersCount).toBeGreaterThanOrEqual(1);
      expect(health.topics).toContain('sovra/feed/main');

      const metricsRes = await fetch(`http://127.0.0.1:${node.httpPort}/metrics`);
      expect(metricsRes.status).toBe(200);
      const metricsTxt = await metricsRes.text();
      expect(metricsTxt).toContain(`sovra_seed_up{region="${node.region}"} 1`);
    }
  });

  it('passes static DNS manifest, Caddy ACME TLS, Coturn TURNS (5349), HMAC-SHA1 & AssetLinks preflight checks', () => {
    const preflight = verifyStaticInfraConfigs();
    expect(preflight.errors).toEqual([]);
    expect(preflight.dnsManifestValid).toBe(true);
    expect(preflight.caddyTlsConfigValid).toBe(true);
    expect(preflight.coturnTlsConfigValid).toBe(true);
    expect(preflight.turnHmacVerified).toBe(true);
    expect(preflight.assetLinksValid).toBe(true);
  });

  afterAll(async () => {
    for (const n of activeNodes) {
      try { await n.stop(); } catch (_) {}
    }
    for (const dir of tmpDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});
