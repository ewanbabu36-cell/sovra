/**
 * @file tests/integration/zero-domain-p2p-volunteer-mesh.test.ts
 * Verifies Sovra's Bitcoin / BitTorrent / Nostr distribution & networking model:
 * - Native offline bundles (iOS & Android Capacitor configs without hosted URLs)
 * - Zero hardcoded domain fallbacks in P2P NAT/Relay defaults
 * - BitTorrent/Bitcoin-style peer book snapshot persistence & Peer Exchange (PEX)
 * - Live zero-domain volunteer daemon mesh (no DNS fallback, PEX announcement & lookup)
 * - Mobile MultiRelayManager PEX sync + optional zero-domain-only DNS bypass
 */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PeerDiscoveryManager } from '../../packages/p2p/src/discovery.ts';
import { startVolunteerNodeDaemon, type RunningVolunteerNode } from '../../scripts/volunteer-node.ts';
import { multiRelayManager } from '../../apps/sovra-mobile/src/services/multi-relay-manager.ts';

async function httpJson(url: string, init?: RequestInit): Promise<{ status: number; data: any }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

describe('Zero-Domain Native Binary & Volunteer Node Architecture', () => {
  const runningNodes: RunningVolunteerNode[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    multiRelayManager.setZeroDomainOnly(false);
    while (runningNodes.length > 0) {
      const node = runningNodes.pop();
      if (node) {
        await node.stop().catch(() => {});
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('uses standalone offline bundled webDir on both iOS and Android Capacitor configs (no central server URL)', () => {
    const iosConfigPath = path.join(process.cwd(), 'apps', 'ios', 'App', 'App', 'capacitor.config.json');
    const androidConfigPath = path.join(process.cwd(), 'apps', 'sovra-mobile', 'capacitor.config.json');

    const iosConfig = JSON.parse(fs.readFileSync(iosConfigPath, 'utf8'));
    const androidConfig = JSON.parse(fs.readFileSync(androidConfigPath, 'utf8'));

    expect(iosConfig.webDir).toBe('dist');
    expect(iosConfig.server?.url).toBeUndefined();
    expect(iosConfig.server?.iosScheme).toBe('sovra');

    expect(androidConfig.webDir).toBe('dist');
    expect(androidConfig.server?.url).toBeUndefined();
    expect(androidConfig.server?.androidScheme).toBe('https');
  });

  it('uses domain-less loopback fallback relay instead of central p2p-relay.sovra.net in P2P NAT layer', () => {
    const natSource = fs.readFileSync(path.join(process.cwd(), 'packages', 'p2p', 'src', 'nat.ts'), 'utf8');
    expect(natSource).not.toContain('p2p-relay.sovra.net');
    expect(natSource).toContain('127.0.0.1:4001');
  });

  it('persists and re-ingests BitTorrent/Bitcoin-style peer book snapshots via PeerDiscoveryManager PEX', () => {
    const localPeerA = '12D3KooWZeroDomainPeerAlpha000000000000000000000000001';
    const localPeerB = '12D3KooWZeroDomainPeerBeta0000000000000000000000000002';
    const dnsPeerC = '12D3KooWDnsFallbackPeerGamma00000000000000000000000003';

    const discovery = new PeerDiscoveryManager('12D3KooWSelfNode000000000000000000000000000000000000');
    const ingested = discovery.ingestPeerExchange([
      `/dns4/relay.example.org/tcp/4001/p2p/${dnsPeerC}`,
      `/ip4/127.0.0.1/tcp/4002/p2p/${localPeerA}`,
      `/ip4/192.168.1.50/tcp/4003/p2p/${localPeerB}`,
    ]);
    expect(ingested).toBe(3);

    discovery.recordPeerLatency(localPeerA, 5);
    discovery.recordPeerLatency(localPeerB, 22);
    discovery.recordPeerLatency(dnsPeerC, 90);

    const rankedBefore = discovery.getFastestPeers(10);
    expect(rankedBefore.length).toBe(3);
    expect(rankedBefore[0].id.peerId).toBe(localPeerA);

    const snapshot = discovery.exportPeerBookSnapshot();
    expect(snapshot.length).toBe(3);

    const restored = new PeerDiscoveryManager('12D3KooWSelfNode000000000000000000000000000000000000');
    const restoredCount = restored.importPeerBookSnapshot(snapshot);
    expect(restoredCount).toBe(3);
    expect(restored.getFastestPeers(3)[0].id.peerId).toBe(localPeerA);
  });

  it('removes dead trycloudflare URLs and supports zero-domain-only filtering in MultiRelayManager', () => {
    const mobileServiceSource = fs.readFileSync(
      path.join(process.cwd(), 'apps', 'sovra-mobile', 'src', 'services', 'multi-relay-manager.ts'),
      'utf8'
    );
    expect(mobileServiceSource).not.toContain('aud-sharing-thru-hay.trycloudflare.com');

    expect(multiRelayManager.isZeroDomainRelay('http://127.0.0.1:3001')).toBe(true);
    expect(multiRelayManager.isZeroDomainRelay('http://sovra-node.onion:8080')).toBe(true);
    expect(multiRelayManager.isZeroDomainRelay('https://seed1.sovra.network')).toBe(false);

    multiRelayManager.setZeroDomainOnly(true);
    expect(multiRelayManager.isZeroDomainOnly()).toBe(true);

    const filteredRelays = multiRelayManager.getFastestRelays(10);
    expect(filteredRelays.length).toBeGreaterThanOrEqual(1);
    expect(filteredRelays.every(r => multiRelayManager.isZeroDomainRelay(r.url))).toBe(true);
    expect(filteredRelays.some(r => r.url.includes('127.0.0.1:3001'))).toBe(true);
  });

  it('boots two domain-less volunteer daemons, persists peers.json, validates PEX announcements, and syncs mobile PEX', async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-vol-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-vol-b-'));
    tempDirs.push(dirA, dirB);

    const nodeA = await startVolunteerNodeDaemon({
      role: 'full',
      region: 'volunteer-lan-a',
      dataDir: dirA,
      p2pPort: 0,
      httpPort: 0,
      storagePort: 0,
      enableDnsFallback: false,
    });
    runningNodes.push(nodeA);

    const nodeB = await startVolunteerNodeDaemon({
      role: 'relay',
      region: 'volunteer-lan-b',
      dataDir: dirB,
      p2pPort: 0,
      httpPort: 0,
      enableDnsFallback: false,
    });
    runningNodes.push(nodeB);

    expect(nodeA.role).toBe('full');
    expect(nodeA.storageDaemon).toBeDefined();
    expect(nodeB.role).toBe('relay');
    expect(nodeB.storageDaemon).toBeUndefined();
    expect(nodeA.httpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(nodeB.multiaddr).toContain(`/p2p/${nodeB.peerId}`);

    // Reject forged non-Ed25519 PeerIDs and unsigned announcements on PEX
    const forgedRes = await httpJson(`${nodeA.httpUrl}/api/peers/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        multiaddr: '/ip4/127.0.0.1/tcp/4999/p2p/12D3KooWInvalidForgedPeerIdNot32Bytes',
      }),
    });
    expect(forgedRes.status).toBe(400);
    expect(forgedRes.data.ok).toBe(false);

    const unsignedRes = await httpJson(`${nodeA.httpUrl}/api/peers/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        multiaddr: nodeB.multiaddr,
        httpUrl: nodeB.httpUrl,
      }),
    });
    expect(unsignedRes.status).toBe(400);
    expect(unsignedRes.data.ok).toBe(false);

    // Valid signed Ed25519 volunteer node announcement -> persisted to peers.json
    const signedNodeBRecord = nodeB.signSelfPeerRecord(3600);
    const tamperedRec = { ...signedNodeBRecord, region: 'spoofed-region' };
    const tamperedRes = await httpJson(`${nodeA.httpUrl}/api/peers/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedRecord: tamperedRec }),
    });
    expect(tamperedRes.status).toBe(400);
    expect(tamperedRes.data.ok).toBe(false);

    const announceRes = await httpJson(`${nodeA.httpUrl}/api/peers/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        multiaddr: nodeB.multiaddr,
        httpUrl: nodeB.httpUrl,
        region: 'volunteer-lan-b',
        signedRecord: signedNodeBRecord,
      }),
    });
    expect(announceRes.status).toBe(200);
    expect(announceRes.data.ok).toBe(true);
    expect(announceRes.data.peerBookCount).toBeGreaterThanOrEqual(1);

    const persistedFile = path.join(dirA, 'peers.json');
    expect(fs.existsSync(persistedFile)).toBe(true);
    const savedEntries = JSON.parse(fs.readFileSync(persistedFile, 'utf8'));
    expect(savedEntries.some((p: any) => p.peerId === nodeB.peerId && p.httpUrl === nodeB.httpUrl)).toBe(true);

    const peersRes = await httpJson(`${nodeA.httpUrl}/api/peers`);
    expect(peersRes.status).toBe(200);
    expect(peersRes.data.ok).toBe(true);
    expect(peersRes.data.multiaddrs.some((ma: string) => ma.includes(nodeB.peerId))).toBe(true);

    const seedsRes = await httpJson(`${nodeA.httpUrl}/api/seeds`);
    expect(seedsRes.status).toBe(200);
    expect(seedsRes.data.zeroDomainMode).toBe(true);
    expect(Array.isArray(seedsRes.data.globalSeeds)).toBe(true);

    // Mobile client discovers nodeB's volunteer HTTP relay via PEX without centralized DNS
    const addedCount = await multiRelayManager.syncPeerExchangeFromRelays(nodeA.httpUrl);
    expect(addedCount).toBeGreaterThanOrEqual(1);
    const discoveredRelay = multiRelayManager.getAllRelays().find(r => r.url === nodeB.httpUrl);
    expect(discoveredRelay).toBeDefined();
  }, 30000);
});
