import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { generateEd25519KeyPair, bytesToHex, sha256, signReleaseManifest, verifySignedSoftwareRelease } from '../../packages/crypto/dist/index.js';
import { verifyKeyRotationAssertion } from '../../packages/identity/dist/index.js';
import { BlindPushRelayServer } from '../../packages/messaging/dist/index.js';
import {
  probeStunUdp,
  getZeroDomainBootstrapMultiaddrs,
  createSignedBootstrapBundle,
  signBootstrapPeerEntry,
} from '../../packages/p2p/dist/index.js';
import { startVolunteerNodeDaemon, type RunningVolunteerNode } from '../../scripts/volunteer-node.ts';
import { handlePushRoutes, getOrCreateVapidKeys, resetPushStoreCacheForTests } from '../../scripts/routes/push.routes.ts';
import { handleEnterpriseProtocolRoutes } from '../../scripts/routes/enterprise-protocol.routes.ts';
import { SOVRA_RTC_CONFIGURATION, getWebRtcConfiguration } from '../../scripts/webrtc-config.ts';
import {
  createSignedStreamTicket,
  verifySignedStreamTicket,
  getMediaEncryptionKey,
  resetHlsSecretsCacheForTests,
} from '../../scripts/routes/media.routes.ts';
import { getIceServers } from '../../scripts/dev-server.ts';
import { NativeMobileBleAdapter } from '../../apps/sovra-mobile/src/services/native-ble-bridge.ts';
import { SecureKeyStore } from '../../apps/sovra-mobile/src/services/secure-keystore.ts';
import { MultiRelayManager } from '../../apps/sovra-mobile/src/services/multi-relay-manager.ts';
import { verifyAndDownloadUpdate } from '../../apps/sovra-mobile/src/services/release-updater.ts';
import { SovraLocalDatabase, MemoryStorageDriver } from '../../apps/sovra-mobile/src/services/local-database.ts';

function readBoundedBody(req: http.IncomingMessage, _res: http.ServerResponse, limit = 256 * 1024): Promise<{ body: string; ok: boolean }> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total <= limit) chunks.push(c);
    });
    req.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), ok: total <= limit }));
  });
}

describe('Zero-Domain & Zero-Cloud Full Ecosystem Parity Verification', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.SOVRA_ONION_HOSTNAME;
    resetPushStoreCacheForTests();
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  it('syncs compiled mobile bundle + index.html into Android assets and uses real SHA-256 (not 00..00) in browser bundles', () => {
    const rootDir = process.cwd();
    const distBundle = path.join(rootDir, 'apps/sovra-mobile/dist/bundle.js');
    const apkAssetBundle = path.join(rootDir, 'apps/sovra-mobile/android/app/src/main/assets/bundle.js');
    const apkAssetHtml = path.join(rootDir, 'apps/sovra-mobile/android/app/src/main/assets/index.html');
    const clientBundle = path.join(rootDir, 'apps/sovra-app/dist/bundle.js');

    expect(fs.existsSync(distBundle)).toBe(true);
    expect(fs.existsSync(apkAssetBundle)).toBe(true);
    expect(fs.existsSync(apkAssetHtml)).toBe(true);
    expect(fs.statSync(apkAssetBundle).size).toBe(fs.statSync(distBundle).size);
    expect(fs.readFileSync(apkAssetHtml, 'utf8')).toContain('./bundle.js');

    // Verify esbuild shim no longer embeds the old `'00'.repeat(32)` zero placeholder
    const shimSrc = fs.readFileSync(path.join(rootDir, 'scripts/esbuild-node-shim.ts'), 'utf8');
    expect(shimSrc).toContain('sha256Sync');
    expect(fs.readFileSync(clientBundle, 'utf8')).not.toContain('"0".repeat(64)');
    expect(fs.readFileSync(distBundle, 'utf8')).not.toContain('"0".repeat(64)');
  });

  it('runs volunteer daemon in zero-domain default mode with built-in STUN, /api/seeds/bundle, and /api/seeds/import', async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-zd-va-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-zd-vb-'));
    cleanups.push(() => {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    });

    const nodeA: RunningVolunteerNode = await startVolunteerNodeDaemon({
      role: 'relay',
      dataDir: dirA,
      p2pPort: 0,
      httpPort: 0,
      enableStun: true,
      stunPort: 0,
      onionAddress: 'b'.repeat(56) + '.onion',
    });
    cleanups.push(() => nodeA.stop());

    const nodeB: RunningVolunteerNode = await startVolunteerNodeDaemon({
      role: 'relay',
      dataDir: dirB,
      p2pPort: 0,
      httpPort: 0,
    });
    cleanups.push(() => nodeB.stop());

    // Confirm zero-domain default without passing explicit enableDnsFallback=false
    const seedsRes = await fetch(`${nodeA.httpUrl}/api/seeds`);
    const seedsJson: any = await seedsRes.json();
    expect(seedsJson.zeroDomainMode).toBe(true);
    expect(seedsJson.self.stunEndpoint).toMatch(/^stun:127\.0\.0\.1:\d+$/);
    expect(seedsJson.self.onionMultiaddr).toContain(`/onion3/${'b'.repeat(56)}:`);

    // Real RFC 5389 UDP STUN binding against nodeA's built-in responder (zero Google/Cloudflare dependency)
    const stunPort = Number(seedsJson.self.stunEndpoint.split(':').pop());
    const stunProbe = await probeStunUdp('127.0.0.1', stunPort, 1500);
    expect(stunProbe).not.toBeNull();
    expect(stunProbe!.observedIp).toBe('127.0.0.1');

    // Signed Bootstrap Bundle export + tamper rejection + valid import on nodeB
    const bundleRes = await fetch(`${nodeA.httpUrl}/api/seeds/bundle`);
    const bundleData: any = await bundleRes.json();
    expect(bundleData.ok).toBe(true);
    expect(bundleData.bundle.peers.length).toBeGreaterThanOrEqual(1);

    const tampered = structuredClone(bundleData.bundle);
    tampered.network_id = 'evil-fork';
    const badImport = await fetch(`${nodeB.httpUrl}/api/seeds/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle: tampered }),
    });
    expect(badImport.status).toBe(400);

    const okImport = await fetch(`${nodeB.httpUrl}/api/seeds/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle: bundleData.bundle }),
    });
    expect(okImport.status).toBe(200);
    const impJson: any = await okImport.json();
    expect(impJson.ok).toBe(true);
    expect(impJson.importedCount).toBe(1);
    expect(nodeB.getPeerBook().some(p => p.peerId === nodeA.peerId)).toBe(true);
  }, 15000);

  it('persists VAPID + push tokens, delivers SSE wakeups without ntfy.sh, retries 429, and prunes 410 Gone tokens', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-push-zd-'));
    const prevStorage = process.env.SOVRA_STORAGE_DIR;
    process.env.SOVRA_STORAGE_DIR = tmpDir;
    resetPushStoreCacheForTests();
    cleanups.push(() => {
      if (prevStorage === undefined) delete process.env.SOVRA_STORAGE_DIR;
      else process.env.SOVRA_STORAGE_DIR = prevStorage;
      resetPushStoreCacheForTests();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const v1 = getOrCreateVapidKeys();
    resetPushStoreCacheForTests();
    const v2 = getOrCreateVapidKeys();
    expect(v2.publicKey).toBe(v1.publicKey);
    expect(v1.publicKey).not.toContain('BEl62iUY');

    // Mock self-hosted UnifiedPush target: first returns 429 then 200; dead endpoint returns 410 Gone
    let retryHits = 0;
    const upServer = http.createServer((req, res) => {
      if (req.url === '/up-retry') {
        retryHits++;
        if (retryHits === 1) {
          res.writeHead(429, { 'Retry-After': '0' });
          res.end('rate limited');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'up-msg-ok' }));
        return;
      }
      if (req.url === '/wp-gone') {
        res.writeHead(410);
        res.end('Gone');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>(r => upServer.listen(0, '127.0.0.1', r));
    const upPort = (upServer.address() as any).port;
    cleanups.push(() => new Promise<void>(r => upServer.close(() => r())));

    const blindRelay = new BlindPushRelayServer();
    const apiSrv = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const handled = await handlePushRoutes({ req, res, url, blindPushRelay: blindRelay, readBoundedBody });
      if (!handled) { res.writeHead(404); res.end(); }
    });
    await new Promise<void>(r => apiSrv.listen(0, '127.0.0.1', r));
    const apiBase = `http://127.0.0.1:${(apiSrv.address() as any).port}`;
    cleanups.push(() => new Promise<void>(r => apiSrv.close(() => r())));

    // 1. SSE wakeup stream receives zero-cloud event without ntfy.sh / FCM / APNs
    const targetDid = 'did:key:z6MkZeroCloudSseTarget';
    const blindChannelId = crypto.createHash('sha256').update(targetDid).digest('hex');

    const ssePromise = new Promise<string>((resolve, reject) => {
      const req = http.get(`${apiBase}/api/push/stream?blindChannelId=${blindChannelId}`, (resp) => {
        let acc = '';
        resp.on('data', (chunk: Buffer) => {
          acc += chunk.toString('utf8');
          if (acc.includes('event: wakeup')) {
            req.destroy();
            resolve(acc);
          }
        });
      });
      req.on('error', reject);
      setTimeout(() => { req.destroy(); reject(new Error('SSE wakeup timeout')); }, 3000);
    });
    await new Promise(r => setTimeout(r, 80));

    // Register 410 Gone WebPush endpoint + self-hosted UnifiedPush with 429 retry
    await fetch(`${apiBase}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'web-dead-1',
        deviceDid: targetDid,
        blindChannelId,
        pushToken: `http://127.0.0.1:${upPort}/wp-gone`,
      }),
    });
    await fetch(`${apiBase}/api/push/register-native`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userDid: targetDid,
        provider: 'unifiedpush',
        endpointUrl: `http://127.0.0.1:${upPort}/up-retry`,
      }),
    });

    const dispatchRes = await fetch(`${apiBase}/api/push/blind-dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientDid: targetDid, blindChannelId }),
    });
    const dispatchJson: any = await dispatchRes.json();
    expect(dispatchJson.ok).toBe(true);
    expect(dispatchJson.sseDispatched).toBeGreaterThanOrEqual(1);
    expect(retryHits).toBe(2); // Retried 429 -> 200 cleanly
    const sseData = await ssePromise;
    expect(sseData).toContain(blindChannelId);

    // Confirm dead 410 endpoint was pruned from persistent disk store + unregister works
    const regStore = JSON.parse(fs.readFileSync(path.join(tmpDir, 'push-registrations.json'), 'utf8'));
    expect((regStore.webSubscriptions || []).some((s: any) => s.endpoint.includes('/wp-gone'))).toBe(false);

    const unregRes = await fetch(`${apiBase}/api/push/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userDid: targetDid, endpoint: `http://127.0.0.1:${upPort}/up-retry` }),
    });
    expect((await unregRes.json()).ok).toBe(true);
  }, 15000);

  it('validates 2-of-3 Ed25519 release manifests, WebView BLE CustomEvent GATT bridge, and Android Hardware Keystore wrap/unwrap', async () => {
    const s1 = generateEd25519KeyPair();
    const s2 = generateEd25519KeyPair();
    const s3 = generateEd25519KeyPair();
    const trustedKeys = [s1, s2, s3].map(s => bytesToHex(s.publicKey));

    const manifest = {
      version: '1.2.0',
      minCompatibleVersion: '1.0.0',
      protocolVersion: 1,
      platform: 'android-apk' as const,
      artifactCid: 'bafybeizero0domain0sovra0apk0artifact0000000000000000001',
      artifactSha256Hex: 'ab'.repeat(32),
      byteLength: 42000000,
      issuedAt: Math.floor(Date.now() / 1000),
      signerThreshold: 2,
      signatures: [] as any[],
    };
    const sig1 = signReleaseManifest(manifest, s1.privateKey, s1.publicKey);
    const sig2 = signReleaseManifest(manifest, s2.privateKey, s2.publicKey);
    manifest.signatures.push(sig1, sig2);

    const okVer = verifySignedSoftwareRelease(manifest, { trustedSignerPubKeysHex: trustedKeys, currentVersion: '1.0.0', minimumThreshold: 2 });
    expect(okVer.valid).toBe(true);
    expect(okVer.validSigners.length).toBe(2);

    // Hardware Keystore wrap/unwrap custody check (no raw device seed in localStorage)
    const memMap = new Map<string, string>();
    const prevWin = (globalThis as any).window;
    const prevLs = (globalThis as any).localStorage;
    const listeners = new Map<string, Set<(ev: any) => void>>();
    const mockWin: any = {
      SovraKeystoreNative: {
        isHardwareBacked: () => true,
        wrapSecret: (b64: string) => JSON.stringify({ hwBacked: true, wrapped: b64.split('').reverse().join('') }),
        unwrapSecret: (j: string) => JSON.parse(j).wrapped.split('').reverse().join(''),
      },
      SovraBleNative: {
        isAvailable: () => true,
        isBluetoothEnabled: () => true,
        startScanning: () => true,
        stopScanning: () => {},
        connectGatt: (addr: string) => {
          setTimeout(() => {
            const set = listeners.get('onGattConnected');
            set?.forEach(fn => fn({ detail: { gattId: 'gatt-77', address: addr, mtu: 512 } }));
          }, 15);
          return true;
        },
        writeCharacteristic: () => true,
      },
      addEventListener: (ev: string, fn: any) => {
        if (!listeners.has(ev)) listeners.set(ev, new Set());
        listeners.get(ev)!.add(fn);
      },
      removeEventListener: (ev: string, fn: any) => listeners.get(ev)?.delete(fn),
    };
    (globalThis as any).window = mockWin;
    (globalThis as any).localStorage = {
      getItem: (k: string) => memMap.get(k) ?? null,
      setItem: (k: string, v: string) => memMap.set(k, v),
      removeItem: (k: string) => memMap.delete(k),
    };
    cleanups.push(() => {
      (globalThis as any).window = prevWin;
      (globalThis as any).localStorage = prevLs;
    });

    const ks = new SecureKeyStore();
    expect(ks.isHardwareBacked()).toBe(true);
    const id = ks.getOrGenerateMeshIdentity();
    expect(id.did).toMatch(/^did:key:z6Mk/);
    expect(memMap.has('sovra_hw_wrapped_seed_v1')).toBe(true);
    expect(memMap.has('sovra_device_entropy_seed')).toBe(false);

    const ble = new NativeMobileBleAdapter();
    expect(await ble.isAvailable()).toBe(true);
    const ch = await ble.connect('AA:BB:CC:DD:EE:FF');
    expect(ch.mtu).toBe(512);
  });

  it('enforces enterprise release mirror routes, fail-closed APNs, honest .onion status, zero-domain relays, and clean initial balance', async () => {
    const tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-ent-zd-'));
    const prevStorage = process.env.SOVRA_STORAGE_DIR;
    const prevApnsKeyId = process.env.APNS_KEY_ID;
    const prevApnsTeam = process.env.APNS_TEAM_ID;
    const prevApnsPriv = process.env.APNS_PRIVATE_KEY;
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_PRIVATE_KEY;
    delete process.env.SOVRA_ONION_HOSTNAME;
    process.env.SOVRA_STORAGE_DIR = tmpStorage;
    cleanups.push(() => {
      if (prevStorage === undefined) delete process.env.SOVRA_STORAGE_DIR;
      else process.env.SOVRA_STORAGE_DIR = prevStorage;
      if (prevApnsKeyId !== undefined) process.env.APNS_KEY_ID = prevApnsKeyId;
      if (prevApnsTeam !== undefined) process.env.APNS_TEAM_ID = prevApnsTeam;
      if (prevApnsPriv !== undefined) process.env.APNS_PRIVATE_KEY = prevApnsPriv;
      fs.rmSync(tmpStorage, { recursive: true, force: true });
    });

    const srv = http.createServer(async (req, res) => {
      const handled = await handleEnterpriseProtocolRoutes(req, res);
      if (!handled) { res.writeHead(404); res.end(); }
    });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const baseUrl = `http://127.0.0.1:${(srv.address() as any).port}`;
    cleanups.push(() => new Promise<void>(r => {
      (srv as any).closeAllConnections?.();
      srv.close(() => r());
    }));

    // 1. Honest Tor onion service discovery
    const unconfRes = await fetch(`${baseUrl}/.well-known/tor-onion-service`);
    const unconfJson: any = await unconfRes.json();
    expect(unconfRes.status).toBe(200);
    expect(unconfJson.configured).toBe(false);
    expect(unconfJson.status).toBe('not_configured');

    process.env.SOVRA_ONION_HOSTNAME = 'c'.repeat(56) + '.onion';
    const confRes = await fetch(`${baseUrl}/.well-known/tor-onion-service`);
    const confJson: any = await confRes.json();
    expect(confJson.configured).toBe(true);
    expect(confJson.status).toBe('active');
    expect(confJson.version).toBe(3);
    expect(confJson.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);

    // 2. Fail-closed APNs wakeup when .p8 credentials absent
    const apnsRes = await fetch(`${baseUrl}/api/push/apns/dispatch-wakeup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken: 'deadbeef', payload: { aps: { 'content-available': 1 } } }),
    });
    const apnsJson: any = await apnsRes.json();
    expect(apnsRes.status).toBe(503);
    expect(apnsJson.dispatched).toBe(false);
    expect(String(apnsJson.error)).toContain('ERR_APNS_NOT_CONFIGURED');

    // 3. M-of-N Release Mirror route (rejects 1-of-3, accepts & persists 2-of-3)
    const s1 = generateEd25519KeyPair();
    const s2 = generateEd25519KeyPair();
    const s3 = generateEd25519KeyPair();
    const trusted = [s1, s2, s3].map(s => bytesToHex(s.publicKey));
    const baseManifest = {
      version: '2.0.1',
      minCompatibleVersion: '1.0.0',
      protocolVersion: 1,
      platform: 'android-apk' as const,
      artifactCid: 'bafybeizero0domain0mirror0release0artifact0000000000000002',
      artifactSha256Hex: 'cd'.repeat(32),
      byteLength: 51000000,
      issuedAt: Math.floor(Date.now() / 1000),
      signerThreshold: 2,
      signatures: [] as any[],
    };
    const oneSig = { ...baseManifest, signatures: [signReleaseManifest(baseManifest, s1.privateKey, s1.publicKey)] };
    const rejRes = await fetch(`${baseUrl}/api/releases/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: oneSig, trustedSignerPubKeysHex: trusted, minimumThreshold: 2 }),
    });
    expect(rejRes.status).toBe(403);

    const twoSig = {
      ...baseManifest,
      signatures: [
        signReleaseManifest(baseManifest, s1.privateKey, s1.publicKey),
        signReleaseManifest(baseManifest, s2.privateKey, s2.publicKey),
      ],
    };
    const pubRes = await fetch(`${baseUrl}/api/releases/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: twoSig, trustedSignerPubKeysHex: trusted, minimumThreshold: 2 }),
    });
    expect(pubRes.status).toBe(200);
    const latestRes = await fetch(`${baseUrl}/api/releases/latest?platform=android-apk`);
    const latestJson: any = await latestRes.json();
    expect(latestRes.status).toBe(200);
    expect(latestJson.manifest.version).toBe('2.0.1');

    // 4. WebRTC ICE defaults exclude third-party openrelay TURN unless opted in
    const iceServers = getIceServers();
    expect(iceServers.some(s => JSON.stringify(s.urls).includes('openrelay.metered.ca'))).toBe(false);

    // 5. MultiRelayManager zero-domain mode + clean initial mobile balance
    const mgr = MultiRelayManager.getInstance();
    expect(mgr.isZeroDomainOnly()).toBe(true);
    expect(mgr.getFastestRelays(10).some(r => r.url.includes('.sovra.network'))).toBe(false);
    mgr.importBootstrapUrls(['https://192.168.1.77:3443'], 'Local Mesh');
    expect(mgr.getFastestRelays(10).some(r => r.url === 'https://192.168.1.77:3443')).toBe(true);

    const db = SovraLocalDatabase.getInstance(new MemoryStorageDriver());
    expect(db.getCachedBalance()).toBe('0.00 SOV');
  }, 15000);

  it('replays missed zero-cloud SSE wakeup hints using Last-Event-ID and deduplicates hints', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-sse-replay-'));
    const prevDir = process.env.SOVRA_STORAGE_DIR;
    process.env.SOVRA_STORAGE_DIR = tmpDir;
    resetPushStoreCacheForTests();
    cleanups.push(() => {
      if (prevDir === undefined) delete process.env.SOVRA_STORAGE_DIR;
      else process.env.SOVRA_STORAGE_DIR = prevDir;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const blindRelay = new BlindPushRelayServer();
    const srv = http.createServer(async (req, res) => {
      const handled = await handlePushRoutes({
        req,
        res,
        url: new URL(req.url || '/', 'http://127.0.0.1'),
        blindPushRelay: blindRelay,
        readBoundedBody,
      });
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const baseUrl = `http://127.0.0.1:${(srv.address() as any).port}`;
    cleanups.push(() => new Promise<void>(r => {
      (srv as any).closeAllConnections?.();
      srv.close(() => r());
    }));

    const recipientDid = 'did:key:z6MksReplayTarget';
    const sendHint = async (hint: string) => {
      const r = await fetch(`${baseUrl}/api/push/blind-dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientDid, opaqueWakeupHint: hint }),
      });
      expect(r.status).toBe(200);
    };

    // Connect live stream first to capture assigned event id for hint-alpha-1
    const ac1 = new AbortController();
    const sse1 = await fetch(`${baseUrl}/api/push/stream?did=${encodeURIComponent(recipientDid)}`, {
      signal: ac1.signal,
    });
    expect(sse1.status).toBe(200);
    await sendHint('hint-alpha-1');
    const reader1 = sse1.body!.getReader();
    const decoder = new TextDecoder();
    let liveText = '';
    const d1 = Date.now() + 2000;
    while (Date.now() < d1 && !liveText.includes('hint-alpha-1')) {
      const chunk = await reader1.read();
      if (chunk.done) break;
      liveText += decoder.decode(chunk.value, { stream: true });
    }
    ac1.abort();
    const idMatch = liveText.match(/id:\s*(\d+)[\r\n]+event:\s*wakeup[\r\n]+data:[^\r\n]*hint-alpha-1/);
    expect(idMatch?.[1]).toBeTruthy();
    const alphaEventId = Number(idMatch![1]);

    // Dispatch hint-beta-2 (and a duplicate copy) while client is offline / Doze
    await sendHint('hint-beta-2');
    await sendHint('hint-beta-2'); // duplicate hint must be deduplicated from replay buffer

    // Reconnect with Last-Event-ID -> must replay only missed hint-beta-2
    const ac2 = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/push/stream?did=${encodeURIComponent(recipientDid)}`, {
      headers: { 'Last-Event-ID': String(alphaEventId) },
      signal: ac2.signal,
    });
    expect(sseRes.status).toBe(200);
    const reader2 = sseRes.body!.getReader();
    let collected = '';
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !collected.includes('hint-beta-2')) {
      const chunk = await reader2.read();
      if (chunk.done) break;
      collected += decoder.decode(chunk.value, { stream: true });
    }
    ac2.abort();
    expect(collected).toMatch(new RegExp(`id:\\s*${alphaEventId + 1}\\b`));
    expect(collected).toContain('hint-beta-2');
    expect(collected).not.toContain('hint-alpha-1');
  });

  it('persists HLS secrets across restarts, serves real archival CAS bytes, and fails closed on SOVRA_REQUIRE_LIVE_CHAIN_RPC', async () => {
    const tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-cas-hls-'));
    const prevStorage = process.env.SOVRA_STORAGE_DIR;
    const prevHlsSecret = process.env.SOVRA_HLS_SECRET;
    const prevHlsKeySecret = process.env.SOVRA_HLS_KEY_SECRET;
    const prevRequireRpc = process.env.SOVRA_REQUIRE_LIVE_CHAIN_RPC;
    delete process.env.SOVRA_HLS_SECRET;
    delete process.env.SOVRA_HLS_KEY_SECRET;
    delete process.env.SOVRA_EVM_RPC_URL;
    delete process.env.SOVRA_SOLANA_RPC_URL;
    process.env.SOVRA_STORAGE_DIR = tmpStorage;
    resetHlsSecretsCacheForTests();

    cleanups.push(() => {
      if (prevStorage === undefined) delete process.env.SOVRA_STORAGE_DIR;
      else process.env.SOVRA_STORAGE_DIR = prevStorage;
      if (prevHlsSecret !== undefined) process.env.SOVRA_HLS_SECRET = prevHlsSecret;
      if (prevHlsKeySecret !== undefined) process.env.SOVRA_HLS_KEY_SECRET = prevHlsKeySecret;
      if (prevRequireRpc === undefined) delete process.env.SOVRA_REQUIRE_LIVE_CHAIN_RPC;
      else process.env.SOVRA_REQUIRE_LIVE_CHAIN_RPC = prevRequireRpc;
      resetHlsSecretsCacheForTests();
      fs.rmSync(tmpStorage, { recursive: true, force: true });
    });

    const ticket = createSignedStreamTicket('media_42', 'sovra1user');
    const keyBefore = getMediaEncryptionKey('media_42');
    resetHlsSecretsCacheForTests(); // Simulate process restart reading hls-secrets.json from disk
    expect(verifySignedStreamTicket(ticket, 'media_42').valid).toBe(true);
    expect(getMediaEncryptionKey('media_42').equals(keyBefore)).toBe(true);

    const srv = http.createServer(async (req, res) => {
      const handled = await handleEnterpriseProtocolRoutes(req, res);
      if (!handled) { res.writeHead(404); res.end(); }
    });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const baseUrl = `http://127.0.0.1:${(srv.address() as any).port}`;
    cleanups.push(() => new Promise<void>(r => {
      (srv as any).closeAllConnections?.();
      srv.close(() => r());
    }));

    const payloadBytes = Buffer.from('SOVRA-REAL-CAS-BINARY-BLOB-V1-0123456789');
    const pinRes = await fetch(`${baseUrl}/api/media/archival/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaHash: 'cas-test-hash-1',
        mimeType: 'application/octet-stream',
        contentBase64: payloadBytes.toString('base64'),
      }),
    });
    const pinJson: any = await pinRes.json();
    expect(pinRes.status).toBe(200);
    expect(pinJson.casStored).toBe(true);
    expect(pinJson.gateways.length).toBeGreaterThanOrEqual(2);
    expect(pinJson.gateways.some((g: string) => g.includes('arweave.net') || g.includes('cloudflare-ipfs.com'))).toBe(false);

    const streamRes = await fetch(`${baseUrl}/media/archival/cas-test-hash-1`);
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('x-sovra-storage-provider')).toBe('local-cas');
    const fetchedBuf = Buffer.from(await streamRes.arrayBuffer());
    expect(fetchedBuf.equals(payloadBytes)).toBe(true);

    process.env.SOVRA_REQUIRE_LIVE_CHAIN_RPC = 'true';
    const evmFail = await fetch(`${baseUrl}/api/bridge/evm/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creatorDid: 'did:key:z6MkTest',
        targetAddress: '0x' + '11'.repeat(20),
        amountSov: 10,
      }),
    });
    expect(evmFail.status).toBe(503);
    const solFail = await fetch(`${baseUrl}/api/bridge/solana/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creatorDid: 'did:key:z6MkTest',
        solanaAddress: '11111111111111111111111111111111',
        amountSov: 10,
      }),
    });
    expect(solFail.status).toBe(503);
  });

  it('keeps zero-domain ICE/STUN/DHT empty unless custom-configured, rotates/backs up keys with scrypt, and verifies M-of-N release artifacts', async () => {
    const prevLs = (globalThis as any).localStorage;
    const prevNoDns = process.env.SOVRA_NO_DNS;
    const prevAllowStun = process.env.SOVRA_ALLOW_PUBLIC_STUN;
    const memMap = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => memMap.get(k) ?? null,
      setItem: (k: string, v: string) => memMap.set(k, v),
      removeItem: (k: string) => memMap.delete(k),
    };
    process.env.SOVRA_NO_DNS = 'true';
    delete process.env.SOVRA_ALLOW_PUBLIC_STUN;

    cleanups.push(() => {
      (globalThis as any).localStorage = prevLs;
      if (prevNoDns === undefined) delete process.env.SOVRA_NO_DNS;
      else process.env.SOVRA_NO_DNS = prevNoDns;
      if (prevAllowStun !== undefined) process.env.SOVRA_ALLOW_PUBLIC_STUN = prevAllowStun;
    });

    // Zero third-party STUN/ICE in server dev-server helper when SOVRA_NO_DNS=true
    expect(getIceServers()).toEqual([]);

    const mgr = new MultiRelayManager();
    expect(mgr.getZeroDomainStunServers()).toEqual([]);
    expect(mgr.getZeroDomainDhtSeeds()).toEqual([]);
    expect(mgr.getZeroDomainRtcIceServers()).toEqual([]);

    const pinHex = 'ef'.repeat(32);
    mgr.importBootstrapBundle({
      peers: [{ httpUrl: 'https://203.0.113.88:3443', spkiSha256: pinHex }],
    });
    expect(mgr.getRelaySpkiPin('https://203.0.113.88:3443')).toBe(pinHex);
    mgr.addCustomStunServer('stun:192.168.1.9:3478');
    expect(mgr.getZeroDomainRtcIceServers()).toEqual([{ urls: 'stun:192.168.1.9:3478' }]);

    // SecureKeyStore epoch rotation + scrypt passphrase backup/restore
    const ks = new SecureKeyStore();
    const id0 = ks.getOrGenerateMeshIdentity();
    const rot1 = ks.rotateIdentityKey();
    expect(rot1.identity.did).not.toBe(id0.did);
    expect(rot1.assertion.oldDid).toBe(id0.did);
    expect(rot1.assertion.newDid).toBe(rot1.identity.did);
    expect(verifyKeyRotationAssertion(rot1.assertion)).toBe(true);

    ks.setVaultPassphrase('sovereign-passphrase-2026', { N: 1024 });
    expect(ks.unlockWithPassphrase('wrong-pass', { N: 1024 })).toBeNull();
    expect(ks.unlockWithPassphrase('sovereign-passphrase-2026', { N: 1024 })?.did).toBe(rot1.identity.did);

    const backup = ks.exportEncryptedBackup('backup-secret-pass', { N: 1024 });
    ks.wipe();
    const restored = ks.restoreFromEncryptedBackup(backup, 'backup-secret-pass');
    expect(restored.did).toBe(rot1.identity.did);

    // M-of-N release-updater rejects tampered binary bytes and accepts exact SHA-256 binary
    const m1 = generateEd25519KeyPair();
    const m2 = generateEd25519KeyPair();
    const trusted = [bytesToHex(m1.publicKey), bytesToHex(m2.publicKey)];
    const goodBinary = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x99, 0xaa, 0xbb]);
    const tamperedBinary = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00]);
    const unsignedRel = {
      version: '2.1.0',
      minCompatibleVersion: '1.0.0',
      protocolVersion: 1,
      platform: 'android-apk' as const,
      artifactCid: 'bafybeireleaseartifactgood',
      artifactSha256Hex: bytesToHex(sha256(goodBinary)),
      byteLength: goodBinary.length,
      issuedAt: Math.floor(Date.now() / 1000),
      signerThreshold: 2,
      mirrors: [
        { operatorId: 'mirror-eu', uri: 'http://203.0.113.10:3001/sovra.apk' },
        { operatorId: 'mirror-jp', uri: 'http://198.51.100.20:3001/sovra.apk' },
      ],
    };
    const manifest = {
      ...unsignedRel,
      signatures: [
        signReleaseManifest(unsignedRel, m1.privateKey, m1.publicKey),
        signReleaseManifest(unsignedRel, m2.privateKey, m2.publicKey),
      ],
    };
    const policy = {
      trustedSignerPubKeysHex: trusted,
      currentVersion: '1.0.0',
      currentProtocolVersion: 1,
      minimumThreshold: 2,
    };

    await expect(
      verifyAndDownloadUpdate({
        manifest,
        policy,
        fetcher: async () => new Response(tamperedBinary, { status: 200 }),
      }),
    ).rejects.toThrow(/ERR_RELEASE_DOWNLOAD_VERIFICATION_FAILED/);

    const okDownload = await verifyAndDownloadUpdate({
      manifest,
      policy,
      fetcher: async () => new Response(goodBinary, { status: 200 }),
    });
    expect(Buffer.from(okDownload.artifactBytes).equals(Buffer.from(goodBinary))).toBe(true);
    expect(okDownload.validSigners.length).toBe(2);
    expect(okDownload.distinctOperators).toEqual(['mirror-eu', 'mirror-jp']);
  });

  it('purifies WebRTC defaults and proves clean cold-start bootstrap with zero DNS and signed seed bundles', async () => {
    // 1. Verify zero-domain WebRTC default excludes third-party Google/Cloudflare/Mozilla STUN, *.sovra.network, and openrelay
    expect(SOVRA_RTC_CONFIGURATION.iceServers).toEqual([]);
    const dynCfg = getWebRtcConfiguration({ userDid: 'did:key:z6MksPhase1Test' });
    expect(dynCfg.iceServers).toEqual([]);
    const defaultSeeds = getZeroDomainBootstrapMultiaddrs([], false);
    expect(defaultSeeds.some(s => s.startsWith('/dns'))).toBe(false);

    // 2. Clean cold-start volunteer nodes with DNS off & mDNS off: start empty, then discover solely via signed bundle
    const tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-cold-a-'));
    const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-cold-b-'));
    cleanups.push(() => {
      fs.rmSync(tmpDirA, { recursive: true, force: true });
      fs.rmSync(tmpDirB, { recursive: true, force: true });
    });

    const nodeA = await startVolunteerNodeDaemon({
      role: 'seed',
      dataDir: tmpDirA,
      p2pPort: 0,
      httpPort: 0,
      enableDnsFallback: false,
      enableMdns: false,
    });
    cleanups.push(() => nodeA.stop());

    const nodeB = await startVolunteerNodeDaemon({
      role: 'relay',
      dataDir: tmpDirB,
      p2pPort: 0,
      httpPort: 0,
      enableDnsFallback: false,
      enableMdns: false,
    });
    cleanups.push(() => nodeB.stop());

    // Cold-start nodeB must start with 0 remote peers and 0 .sovra.network addresses
    expect(nodeB.p2pNode.connManager.getAllConnections()).toHaveLength(0);
    expect(nodeA.p2pNode.getAdvertisedAddresses().some(a => a.includes('sovra.network'))).toBe(false);

    // Fetch /api/seeds/bundle directly from nodeA via loopback IP HTTP and import into nodeB (zero DNS lookups)
    const { createRequire } = await import('node:module');
    const dnsCjs = createRequire(import.meta.url)('node:dns');
    const origLookup = dnsCjs.lookup;
    let dnsCalls = 0;
    dnsCjs.lookup = function (...args: any[]) {
      const host = String(args[0] || '');
      if (host && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
        dnsCalls++;
      }
      return origLookup.apply(this, args);
    };
    cleanups.push(() => {
      dnsCjs.lookup = origLookup;
    });

    const bundleRes = await fetch(`${nodeA.httpUrl}/api/seeds/bundle`);
    expect(bundleRes.status).toBe(200);
    const bundleData: any = await bundleRes.json();
    const impRes = await fetch(`${nodeB.httpUrl}/api/seeds/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle: bundleData.bundle, minIndependentOperators: 1 }),
    });
    expect(impRes.status).toBe(200);
    const dialRes = await nodeB.p2pNode.dial(nodeA.multiaddr);
    expect(dialRes.ok).toBe(true);
    expect(nodeB.p2pNode.connManager.getAllConnections().some(c => c.peerId === nodeA.p2pNode.identity.peerId)).toBe(true);
    expect(dnsCalls).toBe(0);
  });

  it('persists SSE event cursors across relay restarts, replays missed cursor events, and wires Android UnifiedPush vs foreground SSE telemetry', async () => {
    const tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-p4-push-'));
    const prevStorage = process.env.SOVRA_STORAGE_DIR;
    process.env.SOVRA_STORAGE_DIR = tmpStorage;
    resetPushStoreCacheForTests();

    const { emitSseWakeup } = await import('../../scripts/routes/push.routes.ts');
    const { MobileSyncEngine } = await import('../../apps/sovra-mobile/src/services/sync-engine.ts');

    const receivedDistributorPayloads: any[] = [];
    const distributorServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          receivedDistributorPayloads.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>(r => distributorServer.listen(0, '127.0.0.1', r));
    const distPort = (distributorServer.address() as any).port;

    const blindRelay = new BlindPushRelayServer();
    const relayServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (await handlePushRoutes({ req, res, url, blindPushRelay: blindRelay, readBoundedBody })) return;
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>(r => relayServer.listen(0, '127.0.0.1', r));
    const relayPort = (relayServer.address() as any).port;
    const relayUrl = `http://127.0.0.1:${relayPort}`;

    const prevWindow = (globalThis as any).window;
    cleanups.push(async () => {
      (globalThis as any).window = prevWindow;
      resetPushStoreCacheForTests();
      if (prevStorage === undefined) delete process.env.SOVRA_STORAGE_DIR;
      else process.env.SOVRA_STORAGE_DIR = prevStorage;
      await new Promise<void>(r => relayServer.close(() => r()));
      await new Promise<void>(r => distributorServer.close(() => r()));
      fs.rmSync(tmpStorage, { recursive: true, force: true });
    });

    const userDid = 'did:key:z6MksPhase4CursorUser';
    const blindCh = crypto.createHash('sha256').update(userDid).digest('hex');

    // 1. Emit 3 offline wakeups -> persist sse-wakeup-buffer.json -> reset RAM cache (simulates relay restart)
    const del1 = emitSseWakeup(blindCh, userDid, { opaqueWakeupHint: 'hint-p4-1' });
    const del2 = emitSseWakeup(blindCh, userDid, { opaqueWakeupHint: 'hint-p4-2' });
    const del3 = emitSseWakeup(blindCh, userDid, { opaqueWakeupHint: 'hint-p4-3' });
    expect([del1, del2, del3]).toEqual([0, 0, 0]);
    const bufFile = path.join(tmpStorage, 'sse-wakeup-buffer.json');
    expect(fs.existsSync(bufFile)).toBe(true);
    const savedBeforeRestart = JSON.parse(fs.readFileSync(bufFile, 'utf8'));
    expect(savedBeforeRestart.nextEventId).toBe(4);
    expect(savedBeforeRestart.channels[blindCh].map((e: any) => e.id)).toEqual([1, 2, 3]);

    resetPushStoreCacheForTests();

    // Emit 4th event AFTER restart: cursor must stay monotonic (id === 4 -> nextEventId === 5, NEVER reset to 1!)
    emitSseWakeup(blindCh, userDid, { opaqueWakeupHint: 'hint-p4-4' });
    const savedAfterRestart = JSON.parse(fs.readFileSync(bufFile, 'utf8'));
    expect(savedAfterRestart.nextEventId).toBe(5);
    expect(savedAfterRestart.channels[blindCh].map((e: any) => e.id)).toEqual([1, 2, 3, 4]);

    // 2. Reconnect with Last-Event-ID: 1 -> must replay ONLY missed events 2, 3, 4 in order
    const replayedIds: number[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        `${relayUrl}/api/push/stream?did=${encodeURIComponent(userDid)}`,
        { headers: { 'Last-Event-ID': '1' } },
        res => {
          let buf = '';
          res.on('data', (chunk: Buffer) => {
            buf += chunk.toString('utf8');
            const matches = Array.from(buf.matchAll(/^id:\s*(\d+)/gm)).map(m => Number(m[1]));
            if (matches.length >= 3) {
              replayedIds.push(...matches);
              req.destroy();
              resolve();
            }
          });
          setTimeout(() => { req.destroy(); resolve(); }, 1500);
        },
      );
      req.on('error', err => {
        if ((err as any).code !== 'ECONNRESET') reject(err);
      });
    });
    expect(replayedIds).toEqual([2, 3, 4]);

    // 3. Wire Android SovraUnifiedPushNative JS bridge -> register distributor -> receive endpoint DOM event -> dispatch wakeup
    const listeners = new Map<string, Array<(ev: any) => void>>();
    let nativeRegCalls: Array<{ pkg: string; tok: string }> = [];
    const mockEndpoint = `http://127.0.0.1:${distPort}/unifiedpush/up-tok-1`;
    (globalThis as any).window = {
      addEventListener: (name: string, fn: (ev: any) => void) => {
        const arr = listeners.get(name) ?? [];
        arr.push(fn);
        listeners.set(name, arr);
      },
      dispatchEvent: (ev: any) => {
        for (const fn of listeners.get(ev.type) ?? []) fn(ev);
        return true;
      },
      SovraUnifiedPushNative: {
        listDistributors: () => JSON.stringify(['io.heckel.ntfy']),
        registerDistributor: (pkg: string, tok: string) => {
          nativeRegCalls.push({ pkg, tok });
          return true;
        },
        getLastEndpointJson: () => JSON.stringify({ endpoint: mockEndpoint, token: 'sovra-default' }),
      },
    };

    const mm = MultiRelayManager.getInstance();
    await mm.addCustomRelay(relayUrl, 'Phase4 Relay');
    mm.setActiveRelay(relayUrl);

    const engine = MobileSyncEngine.getInstance();
    (engine as any).unifiedPushListenersAttached = false;
    const initiated = engine.registerUnifiedPushDistributor(undefined, userDid);
    expect(initiated).toBe(true);
    expect(nativeRegCalls).toEqual([{ pkg: 'io.heckel.ntfy', tok: 'sovra-default' }]);

    await engine.syncUnifiedPushEndpoint(mockEndpoint, 'sovra-default', userDid);
    const dispatchRes = await fetch(`${relayUrl}/api/push/dispatch-native`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientDid: userDid, title: 'Ping', body: 'Wakeup' }),
    });
    expect(dispatchRes.status).toBe(200);
    expect(receivedDistributorPayloads.length).toBeGreaterThanOrEqual(1);

    const telemetry = engine.getPushDeliveryTelemetry();
    expect(telemetry.unifiedPushBridgeAvailable).toBe(true);
    expect(telemetry.installedUnifiedPushDistributors).toEqual(['io.heckel.ntfy']);
    expect(telemetry.backgroundAndroidChannel).toBe('unifiedpush');
    expect(telemetry.backgroundIosChannel).toBe('unsupported');
  });

  it('eliminates raw entropy seed from localStorage in Web fallback, supports cross-reload passphrase recovery, device wipe/rotation, and passes SHA-256/Ed25519/AES-GCM/BIP-39 KATs', async () => {
    const { getEd25519PublicKey, signEd25519, verifyEd25519, hexToBytes } = await import('../../packages/crypto/dist/index.js');
    const { entropyToMnemonic, validateMnemonic, mnemonicToIdentity } = await import('../../apps/sovra-mobile/src/services/mnemonic.ts');

    // 1. Official Known-Answer Tests (KATs)
    // FIPS 180-4 SHA-256
    expect(bytesToHex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(bytesToHex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    // RFC 8032 Section 7.1 Ed25519 Vector 1 (empty message) & Vector 2 (1-byte 0x72)
    const v1Sk = hexToBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
    const v1PkExpected = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
    const v1SigExpected = 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';
    const v1Pk = getEd25519PublicKey(v1Sk);
    expect(bytesToHex(v1Pk)).toBe(v1PkExpected);
    const v1Sig = signEd25519(v1Sk, new Uint8Array(0));
    expect(bytesToHex(v1Sig)).toBe(v1SigExpected);
    expect(verifyEd25519(v1Pk, new Uint8Array(0), v1Sig)).toBe(true);
    expect(verifyEd25519(v1Pk, new Uint8Array([0x00]), v1Sig)).toBe(false);

    const v2Sk = hexToBytes('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb');
    const v2Pk = getEd25519PublicKey(v2Sk);
    expect(bytesToHex(v2Pk)).toBe('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c');
    expect(verifyEd25519(v2Pk, new Uint8Array([0x72]), signEd25519(v2Sk, new Uint8Array([0x72])))).toBe(true);

    // NIST SP 800-38D AES-256-GCM Test Case 14 (256-bit zero key, 96-bit zero IV, 16-byte zero block)
    const gcmKey = await crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const gcmOut = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, gcmKey, new Uint8Array(16)));
    expect(bytesToHex(gcmOut.subarray(0, 16))).toBe('cea7403d4d606b6e074ec5d3baf39d18');
    expect(bytesToHex(gcmOut.subarray(16, 32))).toBe('d0d1c8a799996bf0265b98b5d48ab919');

    // BIP-39 Trezor official KAT vectors (128-bit & 256-bit)
    expect(entropyToMnemonic(new Uint8Array(16).fill(0x00))).toBe(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    );
    expect(entropyToMnemonic(new Uint8Array(16).fill(0x7f))).toBe(
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
    );
    expect(entropyToMnemonic(new Uint8Array(32).fill(0xff))).toBe(
      'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote',
    );
    expect(validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon')).toBe(false);

    // 2. Web Fallback Storage Security: zero raw entropy seed in localStorage, reload recovery, device loss & rotation
    const lsMap = new Map<string, string>();
    const prevWin = (globalThis as any).window;
    const prevLs = (globalThis as any).localStorage;
    (globalThis as any).window = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => lsMap.get(k) ?? null,
      setItem: (k: string, v: string) => lsMap.set(k, v),
      removeItem: (k: string) => lsMap.delete(k),
    };
    cleanups.push(() => {
      (globalThis as any).window = prevWin;
      (globalThis as any).localStorage = prevLs;
    });

    const ks1 = new SecureKeyStore();
    const id1 = ks1.getOrGenerateMeshIdentity();
    expect(lsMap.has('sovra_device_entropy_seed')).toBe(false);
    expect(lsMap.has('sovra_mesh_priv_key')).toBe(false);
    expect(ks1.getSecurityPosture().hasRawSeedInLocalStorage).toBe(false);
    expect(ks1.getSecurityPosture().storageBacking).toBe('memory-ephemeral');

    ks1.setVaultPassphrase('StrongWebVaultPass!2026', { N: 1024 });
    expect(lsMap.has('sovra_device_entropy_seed')).toBe(false);
    expect(ks1.getSecurityPosture().storageBacking).toBe('passphrase-only');

    // Simulate full browser reload / new JS heap sharing only localStorage
    const ksReloaded = new SecureKeyStore();
    expect(ksReloaded.unlockWithPassphrase('WrongPass!', { N: 1024 })).toBeNull();
    const unlocked = ksReloaded.unlockWithPassphrase('StrongWebVaultPass!2026', { N: 1024 });
    expect(unlocked?.did).toBe(id1.did);
    expect(lsMap.has('sovra_device_entropy_seed')).toBe(false);

    // Device loss backup -> full wipe -> restore on clean device -> rotate identity key
    const backupJson = ksReloaded.exportEncryptedBackup('RecoveryPhrase#99', { N: 1024 });
    ksReloaded.wipe();
    expect(lsMap.size).toBe(0);

    const ksNewPhone = new SecureKeyStore();
    const recovered = ksNewPhone.restoreFromEncryptedBackup(backupJson, 'RecoveryPhrase#99');
    expect(recovered.did).toBe(id1.did);
    const rot = ksNewPhone.rotateIdentityKey();
    expect(verifyKeyRotationAssertion(rot.assertion)).toBe(true);
    expect(mnemonicToIdentity(recovered.mnemonic!).did).toBe(id1.did);
  });

  it('enforces cryptographic Ed25519 builder attestations (rejecting metadata-only strings & forgeries) and streams verified artifacts across live HTTP mirrors', async () => {
    const { signBuilderAttestation, verifyBuilderProvenanceAttestations, createReleaseSignerRotation, verifyAndApplyReleaseSignerRotation } = await import('../../packages/crypto/dist/index.js');

    const s1 = generateEd25519KeyPair();
    const s2 = generateEd25519KeyPair();
    const s3 = generateEd25519KeyPair();
    const b1 = generateEd25519KeyPair();
    const b2 = generateEd25519KeyPair();
    const trustedSigners = [bytesToHex(s1.publicKey), bytesToHex(s2.publicKey), bytesToHex(s3.publicKey)];
    const trustedBuilders = [bytesToHex(b1.publicKey), bytesToHex(b2.publicKey)];

    const binary = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x42, 0x49, 0x4e, 0x26]);
    const shaHex = bytesToHex(sha256(binary));
    const sourceCommitHex = '6c0e705000000000000000000000000000000000';
    const buildRecipeHashHex = bytesToHex(sha256(new TextEncoder().encode('recipe:mobile-bundle-v1')));

    // 1. Metadata-only string attestations NEVER count as verified provenance
    const metaOnlyBase = {
      version: '3.0.0',
      minCompatibleVersion: '1.0.0',
      protocolVersion: 1,
      platform: 'android-apk' as const,
      artifactCid: 'bafybeip6metaonly',
      artifactSha256Hex: shaHex,
      byteLength: binary.length,
      issuedAt: Math.floor(Date.now() / 1000),
      signerThreshold: 2,
      reproducibleBuild: {
        sourceCommitHex,
        buildRecipeHashHex,
        builderAttestations: ['builder-metadata-only-string-1', 'builder-metadata-only-string-2'],
      },
      mirrors: [
        { operatorId: 'mirror-alpha', uri: 'https://203.0.113.10:3443/releases/3.0.0/sovra.apk' },
        { operatorId: 'mirror-beta', uri: 'http://198.51.100.20:3001/releases/3.0.0/sovra.apk' },
      ],
    };
    const metaOnlyManifest = {
      ...metaOnlyBase,
      signatures: [
        signReleaseManifest(metaOnlyBase, s1.privateKey, s1.publicKey),
        signReleaseManifest(metaOnlyBase, s2.privateKey, s2.publicKey),
      ],
    };
    expect(
      verifySignedSoftwareRelease(metaOnlyManifest, {
        trustedSignerPubKeysHex: trustedSigners,
        trustedBuilderPubKeysHex: trustedBuilders,
        minimumBuilderAttestations: 2,
        currentVersion: '1.0.0',
        minimumThreshold: 2,
      }, binary),
    ).toMatchObject({ valid: false, validBuilders: [] });

    // 2. Cryptographic builder attestations fail when signature or commit is tampered
    const validAtt1 = signBuilderAttestation(
      { sourceCommitHex, buildRecipeHashHex, artifactSha256Hex: shaHex, byteLength: binary.length, builtAt: Math.floor(Date.now() / 1000) },
      b1.privateKey,
      b1.publicKey,
    );
    const validAtt2 = signBuilderAttestation(
      { sourceCommitHex, buildRecipeHashHex, artifactSha256Hex: shaHex, byteLength: binary.length, builtAt: Math.floor(Date.now() / 1000) },
      b2.privateKey,
      b2.publicKey,
    );
    const forgedAtt2 = { ...validAtt2, signatureHex: 'ff'.repeat(64) };
    expect(
      verifyBuilderProvenanceAttestations(
        { artifactSha256Hex: shaHex, byteLength: binary.length, reproducibleBuild: { sourceCommitHex, buildRecipeHashHex, builderAttestations: [validAtt1, forgedAtt2] } },
        { trustedBuilderPubKeysHex: trustedBuilders, minimumBuilderAttestations: 2 },
      ).valid,
    ).toBe(false);

    // 3. Signer key rotation rejects revoked key voting for itself & accepts surviving 2-of-2
    const s4 = generateEd25519KeyPair();
    const selfRevoke = createReleaseSignerRotation(
      { revokedPubKeysHex: [trustedSigners[0]!], addedPubKeysHex: [bytesToHex(s4.publicKey)], issuedAt: Math.floor(Date.now() / 1000), sequence: 1 },
      [{ privateKey: s1.privateKey, publicKey: s1.publicKey }, { privateKey: s2.privateKey, publicKey: s2.publicKey }],
    );
    expect(verifyAndApplyReleaseSignerRotation(selfRevoke, trustedSigners, 2).valid).toBe(false);

    // 4. Live HTTP mirror publish (with real artifactBase64) -> fetch -> download -> verifyAndDownloadUpdate (no mock fetcher!)
    const tmpMirrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-rel-mirror-'));
    const prevStorage = process.env.SOVRA_STORAGE_DIR;
    process.env.SOVRA_STORAGE_DIR = tmpMirrorDir;
    const mirrorSrv = http.createServer(async (req, res) => {
      const reqUrl = req.url || '/';
      if (await handleEnterpriseProtocolRoutes(req, res, reqUrl, req.method || 'GET', () => '127.0.0.1')) return;
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>(r => mirrorSrv.listen(0, '127.0.0.1', r));
    const mirrorPort = (mirrorSrv.address() as any).port;
    const mirrorBase = `http://127.0.0.1:${mirrorPort}`;
    cleanups.push(async () => {
      if (prevStorage === undefined) delete process.env.SOVRA_STORAGE_DIR;
      else process.env.SOVRA_STORAGE_DIR = prevStorage;
      await new Promise<void>(r => mirrorSrv.close(() => r()));
      fs.rmSync(tmpMirrorDir, { recursive: true, force: true });
    });

    const signedBase = {
      ...metaOnlyBase,
      reproducibleBuild: {
        sourceCommitHex,
        buildRecipeHashHex,
        builderAttestations: [validAtt1, validAtt2],
      },
      mirrors: [
        { operatorId: 'vol-eu', uri: 'ipfs://bafybeip6failovermissing' },
        { operatorId: 'vol-us', uri: `${mirrorBase}/api/releases/3.0.0/artifact` },
      ],
    };
    const signedManifest = {
      ...signedBase,
      signatures: [
        signReleaseManifest(signedBase, s1.privateKey, s1.publicKey),
        signReleaseManifest(signedBase, s2.privateKey, s2.publicKey),
      ],
    };
    const pubRes = await fetch(`${mirrorBase}/api/releases/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: signedManifest,
        trustedSignerPubKeysHex: trustedSigners,
        trustedBuilderPubKeysHex: trustedBuilders,
        minimumBuilderAttestations: 2,
        minimumThreshold: 2,
        artifactBase64: Buffer.from(binary).toString('base64'),
      }),
    });
    expect(pubRes.status).toBe(200);
    const pubJson: any = await pubRes.json();
    expect(pubJson.artifactHosted).toBe(true);
    expect(pubJson.validBuilders).toHaveLength(2);

    const downloaded = await verifyAndDownloadUpdate({
      mirrorBaseUrls: [mirrorBase],
      policy: {
        trustedSignerPubKeysHex: trustedSigners,
        trustedBuilderPubKeysHex: trustedBuilders,
        minimumBuilderAttestations: 2,
        currentVersion: '1.0.0',
        minimumThreshold: 2,
      },
    });
    expect(Buffer.from(downloaded.artifactBytes).equals(Buffer.from(binary))).toBe(true);
    expect(downloaded.validBuilders).toHaveLength(2);
    expect(downloaded.validSigners).toHaveLength(2);
  });

  it('supports non-extractable WebCrypto IndexedDB keys, binary nativeHttpFetch over SPKI/Tor, and native APK installer verification bridge', async () => {
    const { installVerifiedAndroidUpdate } = await import('../../apps/sovra-mobile/src/services/release-updater.ts');

    // 1. WebCrypto non-extractable key + mock IndexedDB vault persistence with ZERO raw seed in localStorage
    const idbStore = new Map<string, any>();
    const lsMap = new Map<string, string>();
    const prevIdb = (globalThis as any).indexedDB;
    const prevLs = (globalThis as any).localStorage;
    const prevWin = (globalThis as any).window;
    (globalThis as any).localStorage = {
      getItem: (k: string) => lsMap.get(k) ?? null,
      setItem: (k: string, v: string) => lsMap.set(k, v),
      removeItem: (k: string) => lsMap.delete(k),
    };
    (globalThis as any).indexedDB = {
      open: () => {
        const req: any = {};
        queueMicrotask(() => {
          const db = {
            objectStoreNames: { contains: () => true },
            createObjectStore: () => {},
            transaction: () => ({
              objectStore: () => ({
                get: (k: string) => {
                  const r: any = {};
                  queueMicrotask(() => { r.result = idbStore.get(k); r.onsuccess?.(); });
                  return r;
                },
                put: (v: any, k: string) => {
                  const r: any = {};
                  queueMicrotask(() => { idbStore.set(k, v); r.onsuccess?.(); });
                  return r;
                },
              }),
            }),
          };
          req.result = db;
          req.onupgradeneeded?.({ target: { result: db } });
          req.onsuccess?.();
        });
        return req;
      },
    };
    cleanups.push(() => {
      (globalThis as any).indexedDB = prevIdb;
      (globalThis as any).localStorage = prevLs;
      (globalThis as any).window = prevWin;
    });

    const ks = new SecureKeyStore();
    const id = ks.getOrGenerateMeshIdentity();
    const wcOk = await ks.storeIdentityWithWebCryptoAsync(id);
    expect(wcOk).toBe(true);
    expect(lsMap.has('sovra_device_entropy_seed')).toBe(false);
    const wrappedCryptoKey = idbStore.get('vault_aes_master_v1');
    expect(wrappedCryptoKey?.extractable).toBe(false);

    const ks2 = new SecureKeyStore();
    const loadedFromWc = await ks2.loadIdentityWithWebCryptoAsync();
    expect(loadedFromWc?.did).toBe(id.did);
    expect(Buffer.from(loadedFromWc!.privateKey).equals(Buffer.from(id.privateKey))).toBe(true);

    // 2. MultiRelayManager Tor SOCKS5 URI validation + binary bodyBase64 nativeFetch + SovraUpdaterNative bridge
    const mgr = new (MultiRelayManager as any)();
    expect(() => mgr.setTorSocks5Proxy('http://invalid')).toThrow(/socks5/i);
    mgr.setTorSocks5Proxy('socks5h://127.0.0.1:9050');
    expect(mgr.getTorSocks5Proxy()).toBe('socks5h://127.0.0.1:9050');

    const rawBinary = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x88]);
    let seenSocksArg = '';
    let seenPinArg = '';
    let installedSha = '';
    mgr.setRelaySpkiPin('https://203.0.113.55:3443', 'aa'.repeat(32));
    (globalThis as any).window = {
      localStorage: (globalThis as any).localStorage,
      addEventListener: (name: string, fn: any) => {
        (globalThis as any).__mockEvs = (globalThis as any).__mockEvs || {};
        (globalThis as any).__mockEvs[name] = fn;
      },
      removeEventListener: () => {},
      SovraHttpNative: {
        requestAsync: (reqId: string, _url: string, _m: string, _h: string, _b: string, pin: string, tor: string) => {
          seenPinArg = pin;
          seenSocksArg = tor;
          queueMicrotask(() => {
            (globalThis as any).__mockEvs?.['sovraHttpResponse']?.({
              detail: {
                requestId: reqId,
                status: 200,
                headers: { 'content-type': 'application/octet-stream' },
                bodyBase64: Buffer.from(rawBinary).toString('base64'),
                body: '',
              },
            });
          });
        },
      },
      SovraUpdaterNative: {
        verifyAndInstallApkBase64: (_b64: string, expectedSha: string) => {
          installedSha = expectedSha;
          return JSON.stringify({ ok: true, launched: true, sha256Hex: expectedSha });
        },
      },
    };

    const binRes = await mgr.nativeFetch('https://203.0.113.55:3443/api/releases/3.0.0/artifact');
    const gotBytes = new Uint8Array(await binRes.arrayBuffer());
    expect(seenPinArg).toBe('aa'.repeat(32));
    expect(seenSocksArg).toBe('socks5h://127.0.0.1:9050');
    expect(Buffer.from(gotBytes).equals(Buffer.from(rawBinary))).toBe(true);

    const expectedSha = bytesToHex(sha256(rawBinary));
    const installRes = installVerifiedAndroidUpdate({
      manifest: { artifactSha256Hex: expectedSha, version: '3.0.0', platform: 'android-apk' } as any,
      artifactBytes: rawBinary,
      validSigners: [],
      validBuilders: [],
      distinctOperators: [],
      mirrorUri: 'https://203.0.113.55:3443/api/releases/3.0.0/artifact',
    });
    expect(installRes).toEqual({ launched: true, method: 'android-intent' });
    expect(installedSha).toBe(expectedSha);
  });
});
