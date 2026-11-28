/**
 * @file scripts/bootstrap-node.ts
 * Production-Grade Public Bootstrap Seed Node Daemon for Sovra Network.
 *
 * Implements:
 * 1. Persistent Ed25519 identity key generation/loading (or env deterministic override).
 * 2. Real OS TCP socket listener with Noise_XX transport.
 * 3. Kademlia DHT Rendezvous routing table server mode.
 * 4. Circuit Relay v2 packet forwarder for mobile peers behind symmetric NAT.
 * 5. GossipSub v1.2 mesh coordinator for feed, chats, and delivery receipts.
 * 6. HTTP JSON Health, Seed Discovery (/api/seeds), & Prometheus Metrics endpoint.
 */

import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateEd25519KeyPair,
  bytesToHex,
  hexToBytes,
} from '../packages/crypto/dist/index.js';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
} from '../packages/identity/dist/index.js';
import {
  SovraP2PNode,
  createPeerIdentityBinding,
  createSignedPeerRecord,
  verifySignedPeerRecord,
  encodeSignedPeerQrUri,
  decodeAndVerifyPeerQrUri,
  createSignedBootstrapBundle,
  signBootstrapPeerEntry,
  verifySignedBootstrapBundle,
  parseSignedBootstrapRegistryJson,
  startLocalStunServer,
  GLOBAL_DEFAULT_SEEDS,
  extractPublicKeyFromPeerId,
  getZeroDomainBootstrapMultiaddrs,
  rankMultiaddrsZeroDomainFirst,
  type SignedPeerRecord,
  type SignedBootstrapBundle,
  type SignedBootstrapPeerEntry,
  type PortMappingRequest,
} from '../packages/p2p/dist/index.js';

export interface SeedNodeOptions {
  p2pPort?: number;
  p2pHost?: string;
  httpPort?: number;
  dataDir?: string;
  publicIp?: string;
  region?: string;
  bootstrapPeers?: string[];
  enableDnsFallback?: boolean;
  enableMdns?: boolean;
  mdnsPort?: number;
  requireSignedPex?: boolean;
  enableUpnp?: boolean;
  upnpOptions?: Omit<PortMappingRequest, 'internalPort'>;
  enableStun?: boolean;
  stunPort?: number;
  socks5ProxyUrl?: string;
  onionAddress?: string;
  onionHostnameFile?: string;
  tlsCertPem?: string;
  tlsCertPath?: string;
  seedRegistryPath?: string;
  exportSeedBundlePath?: string;
  identityPrivateKeyHex?: string;
  devicePrivateKeyHex?: string;
}

export interface PersistedPeerEntry {
  peerId: string;
  multiaddr: string;
  httpUrl?: string;
  region?: string;
  lastSeenAt: number;
  source: 'bootstrap' | 'pex' | 'dialed';
  signedRecord?: SignedPeerRecord;
}

export interface RunningSeedNode {
  p2pNode: SovraP2PNode;
  httpServer: http.Server;
  peerId: string;
  did: string;
  region: string;
  multiaddr: string;
  onionMultiaddr?: string;
  relayMultiaddr: string;
  stunEndpoint?: string;
  tlsSpkiSha256?: string;
  httpUrl: string;
  qrUri: string;
  p2pPort: number;
  httpPort: number;
  dialSeedPeer: (multiaddr: string) => Promise<boolean>;
  announcePeer: (entry: {
    multiaddr?: string;
    httpUrl?: string;
    region?: string;
    signedRecord?: SignedPeerRecord;
  }) => Promise<{ ok: boolean; error?: string }>;
  importSeedBundle: (bundle: SignedBootstrapBundle, minOperators?: number) => Promise<{ ok: boolean; importedCount: number; error?: string }>;
  exportSignedSeedBundle: () => SignedBootstrapBundle;
  signSelfPeerRecord: (ttlSeconds?: number) => SignedPeerRecord;
  getPeerBook: () => PersistedPeerEntry[];
  stop: () => Promise<void>;
}

interface StoredKeyConfig {
  identityPrivateKeyHex: string;
  devicePrivateKeyHex: string;
}

function ensureDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadOrGenerateKeys(
  dataDir: string,
  overrideIdentityHex?: string,
  overrideDeviceHex?: string,
): { identityKey: SovraIdentityKey; deviceKey: SovraDeviceKey } {
  ensureDirectory(dataDir);
  const keyPath = path.join(dataDir, 'seed-node-keys.json');
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;

  if (overrideIdentityHex && overrideDeviceHex) {
    const idKey = new SovraIdentityKey(hexToBytes(overrideIdentityHex));
    const devKey = new SovraDeviceKey(
      'seed-device-primary',
      'Bootstrap Seed Node Primary Device',
      idKey.did,
      hexToBytes(overrideDeviceHex),
      validUntil,
    );
    return { identityKey: idKey, deviceKey: devKey };
  }

  if (fs.existsSync(keyPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(keyPath, 'utf-8')) as StoredKeyConfig;
      const idKey = new SovraIdentityKey(hexToBytes(raw.identityPrivateKeyHex));
      const devKey = new SovraDeviceKey(
        'seed-device-primary',
        'Bootstrap Seed Node Primary Device',
        idKey.did,
        hexToBytes(raw.devicePrivateKeyHex),
        validUntil,
      );
      return { identityKey: idKey, deviceKey: devKey };
    } catch {
      // Fallback to regeneration if corrupted
    }
  }

  const identityKp = generateEd25519KeyPair();
  const deviceKp = generateEd25519KeyPair();
  const idKey = new SovraIdentityKey(identityKp.privateKey);
  const devKey = new SovraDeviceKey(
    'seed-device-primary',
    'Bootstrap Seed Node Primary Device',
    idKey.did,
    deviceKp.privateKey,
    validUntil,
  );

  const keyConfig: StoredKeyConfig = {
    identityPrivateKeyHex: bytesToHex(identityKp.privateKey),
    devicePrivateKeyHex: bytesToHex(deviceKp.privateKey),
  };

  fs.writeFileSync(keyPath, JSON.stringify(keyConfig, null, 2), 'utf-8');
  return { identityKey: idKey, deviceKey: devKey };
}

export async function startSeedNodeDaemon(opts: SeedNodeOptions = {}): Promise<RunningSeedNode> {
  const P2P_PORT = opts.p2pPort ?? parseInt(process.env.SOVRA_P2P_PORT ?? '4001', 10);
  const P2P_HOST = opts.p2pHost ?? process.env.SOVRA_P2P_HOST ?? '0.0.0.0';
  const HTTP_PORT = opts.httpPort ?? parseInt(process.env.SOVRA_HTTP_PORT ?? '8080', 10);
  const DATA_DIR = opts.dataDir ?? process.env.SOVRA_DATA_DIR ?? path.join(process.cwd(), '.sovra-seed');
  const PUBLIC_IP = opts.publicIp ?? process.env.SOVRA_PUBLIC_IP ?? '127.0.0.1';
  const REGION = opts.region ?? process.env.SOVRA_REGION ?? 'global';
  // Zero-domain default: refuse DNS fallback unless caller or SOVRA_ALLOW_DNS/SOVRA_NO_DNS=false explicitly opts in
  const enableDnsFallback =
    opts.enableDnsFallback ??
    (process.env.SOVRA_ALLOW_DNS === 'true' || process.env.SOVRA_NO_DNS === 'false');
  const enableUpnp = opts.enableUpnp ?? process.env.SOVRA_ENABLE_UPNP === 'true';
  const enableStun = opts.enableStun ?? process.env.SOVRA_ENABLE_STUN === 'true';
  const stunBindPort = opts.stunPort ?? (process.env.SOVRA_STUN_PORT ? parseInt(process.env.SOVRA_STUN_PORT, 10) : 0);
  const socks5ProxyUrl = opts.socks5ProxyUrl ?? process.env.SOVRA_TOR_SOCKS5 ?? process.env.SOVRA_SOCKS5_PROXY;

  let resolvedOnionHost = (opts.onionAddress ?? process.env.SOVRA_ONION_HOSTNAME ?? '').trim();
  const onionFile = opts.onionHostnameFile ?? process.env.SOVRA_ONION_HOSTNAME_FILE;
  if (!resolvedOnionHost && onionFile && fs.existsSync(onionFile)) {
    try {
      resolvedOnionHost = fs.readFileSync(onionFile, 'utf8').trim();
    } catch {}
  }

  const envPeers = process.env.SOVRA_BOOTSTRAP_PEERS
    ? process.env.SOVRA_BOOTSTRAP_PEERS.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const BOOTSTRAP_PEERS = opts.bootstrapPeers ?? envPeers;

  const { identityKey, deviceKey } = loadOrGenerateKeys(
    DATA_DIR,
    opts.identityPrivateKeyHex ?? process.env.SOVRA_SEED_IDENTITY_PRIV_HEX,
    opts.devicePrivateKeyHex ?? process.env.SOVRA_SEED_DEVICE_PRIV_HEX,
  );
  const validUntilSec = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const delegation = createDeviceDelegation(identityKey, deviceKey, validUntilSec);
  const binding = createPeerIdentityBinding(deviceKey, identityKey.did, delegation);

  // Persistent Bitcoin-style peer book (<dataDir>/peers.json)
  const peersFilePath = path.join(DATA_DIR, 'peers.json');
  const peerBook = new Map<string, PersistedPeerEntry>();
  const MAX_PEER_BOOK = 256;

  const savePeerBook = () => {
    try {
      const sorted = Array.from(peerBook.values())
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .slice(0, MAX_PEER_BOOK);
      fs.writeFileSync(peersFilePath, JSON.stringify(sorted, null, 2), 'utf-8');
    } catch {}
  };

  if (fs.existsSync(peersFilePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(peersFilePath, 'utf-8')) as PersistedPeerEntry[];
      if (Array.isArray(saved)) {
        for (const entry of saved) {
          if (entry && entry.peerId && entry.multiaddr && (enableDnsFallback || !entry.multiaddr.startsWith('/dns'))) {
            peerBook.set(entry.peerId, entry);
          }
        }
      }
    } catch {}
  }

  const p2pNode = new SovraP2PNode({
    deviceKey,
    binding,
    listenAddresses: [`/ip4/${P2P_HOST}/tcp/${P2P_PORT}`],
    enableRelayService: true,
    strictTransport: true,
    enableUpnp,
    ...(opts.upnpOptions ? { upnpOptions: opts.upnpOptions } : {}),
    ...(socks5ProxyUrl ? { socks5ProxyUrl } : {}),
    localDiscoveryOptions: {
      enableUdpMulticast: opts.enableMdns ?? process.env.SOVRA_ENABLE_MDNS === 'true',
      ...(opts.mdnsPort ? { multicastPort: opts.mdnsPort } : {}),
    },
    relayConfig: {
      maxConcurrentCircuits: 250,
      defaultMaxDurationSeconds: 1800,
      defaultMaxBytesPerCircuit: 10 * 1024 * 1024,
      maxReservations: 1000,
    },
    limits: {
      maxInboundConnections: 1000,
      maxOutboundConnections: 500,
      maxStreamsPerConnection: 128,
    },
  });

  const startRes = await p2pNode.start();
  if (!startRes.ok) {
    throw new Error(`Failed to start P2P Node: ${String(startRes.error)}`);
  }

  const mappedLease = p2pNode.portMapper.getActiveLeases()[0];
  const dialHost = PUBLIC_IP === '0.0.0.0'
    ? (mappedLease?.externalIp || '127.0.0.1')
    : PUBLIC_IP;
  const peerId = p2pNode.identity.peerId;
  const did = identityKey.did;
  const boundPort = p2pNode.getBoundPort?.() ?? P2P_PORT;
  const advertisedPort = mappedLease?.externalPort ?? boundPort;
  const multiaddrIp4 = `/ip4/${dialHost}/tcp/${advertisedPort}/p2p/${peerId}`;
  const cleanOnionHost = resolvedOnionHost.replace(/\.onion$/i, '');
  const onionMultiaddr = cleanOnionHost
    ? (cleanOnionHost.length === 16
        ? `/onion/${cleanOnionHost.toLowerCase()}:${boundPort}/p2p/${peerId}`
        : `/onion3/${cleanOnionHost.toLowerCase()}:${boundPort}/p2p/${peerId}`)
    : undefined;
  const selfMultiaddrs = onionMultiaddr ? [multiaddrIp4, onionMultiaddr] : [multiaddrIp4];
  const relayMultiaddr = `${multiaddrIp4}/p2p-circuit`;

  let stunServer: { host: string; port: number; close: () => Promise<void> } | null = null;
  let stunEndpoint: string | undefined;
  if (enableStun) {
    const stunHost = P2P_HOST === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0';
    stunServer = await startLocalStunServer(stunBindPort, stunHost);
    stunEndpoint = `stun:${dialHost}:${stunServer.port}`;
  }

  p2pNode.pubsub.subscribe('sovra/feed/main');
  p2pNode.pubsub.subscribe('sovra/creator/live');
  p2pNode.pubsub.subscribe('sovra/chats/mesh');

  const upsertPeerBook = (entry: PersistedPeerEntry) => {
    if (entry.peerId === peerId) return;
    if (!enableDnsFallback && entry.multiaddr.startsWith('/dns')) return;
    const prev = peerBook.get(entry.peerId);
    peerBook.set(entry.peerId, {
      ...prev,
      ...entry,
      ...(entry.httpUrl ?? prev?.httpUrl ? { httpUrl: entry.httpUrl ?? prev?.httpUrl } : {}),
      ...(entry.region ?? prev?.region ? { region: entry.region ?? prev?.region } : {}),
    });
    savePeerBook();
  };

  p2pNode.discovery.onPeerDiscovered((discovered) => {
    if (discovered.peerId === peerId) return;
    const ranked = rankMultiaddrsZeroDomainFirst(discovered.addresses)
      .filter(a => (enableDnsFallback || !a.startsWith('/dns')) && (a.startsWith('/ip4/') || a.startsWith('/ip6/')));
    const bestAddr = ranked[0] || discovered.addresses[0];
    if (!bestAddr) return;
    const normalized = bestAddr.includes('/p2p/') ? bestAddr : `${bestAddr}/p2p/${discovered.peerId}`;
    upsertPeerBook({
      peerId: discovered.peerId,
      multiaddr: normalized,
      lastSeenAt: Date.now(),
      source: 'pex',
    });
  });

  const dialSeedPeer = async (targetMultiaddr: string): Promise<boolean> => {
    try {
      const m = targetMultiaddr.match(/\/p2p\/([^/]+)/);
      const targetPeerId = m?.[1];
      if (!targetPeerId || targetPeerId === peerId) return false;
      const connectRes = await p2pNode.dial(targetMultiaddr);
      const okDial = Boolean(connectRes.ok && connectRes.value.connectionType === 'direct');
      if (okDial) {
        upsertPeerBook({
          peerId: targetPeerId,
          multiaddr: targetMultiaddr,
          lastSeenAt: Date.now(),
          source: 'dialed',
        });
      }
      return okDial;
    } catch {
      return false;
    }
  };

  const requireSignedPex = opts.requireSignedPex ?? true;
  const seenAnnounceNonces = new Set<string>();

  const announcePeer = async (entry: {
    multiaddr?: string;
    httpUrl?: string;
    region?: string;
    signedRecord?: SignedPeerRecord;
  }): Promise<{ ok: boolean; error?: string }> => {
    const signedRec = entry.signedRecord;
    if (signedRec) {
      if (!verifySignedPeerRecord(signedRec, seenAnnounceNonces)) {
        return { ok: false, error: 'Invalid or replayed Ed25519 SignedPeerRecord signature' };
      }
      if (seenAnnounceNonces.size > 4096) seenAnnounceNonces.clear();
      const chosenAddr = rankMultiaddrsZeroDomainFirst(signedRec.multiaddrs)[0] || '';
      const resolvedHttp = signedRec.httpUrl || entry.httpUrl?.trim().replace(/\/+$/, '');
      const resolvedRegion = signedRec.region || entry.region;
      p2pNode.discovery.ingestSignedPeerRecord(signedRec);
      upsertPeerBook({
        peerId: signedRec.peerId,
        multiaddr: chosenAddr,
        ...(resolvedHttp ? { httpUrl: resolvedHttp } : {}),
        ...(resolvedRegion ? { region: resolvedRegion } : {}),
        lastSeenAt: Date.now(),
        source: 'pex',
        signedRecord: signedRec,
      });
      if (chosenAddr.startsWith('/ip4/') || chosenAddr.startsWith('/ip6/') || chosenAddr.includes('/onion')) {
        dialSeedPeer(chosenAddr).catch(() => {});
      }
      return { ok: true };
    }

    if (requireSignedPex) {
      return { ok: false, error: 'SignedPeerRecord is required for decentralized peer announcements' };
    }

    const rawAddr = String(entry.multiaddr || '').trim();
    const parts = rawAddr.split('/p2p/');
    const targetPeerId = parts[1]?.split('/')[0]?.trim();
    if (!rawAddr || !targetPeerId) {
      return { ok: false, error: 'Valid multiaddr with /p2p/<peerId> is required' };
    }
    try {
      const pubBytes = extractPublicKeyFromPeerId(targetPeerId);
      if (pubBytes.length !== 32) {
        return { ok: false, error: 'Invalid Ed25519 PeerID length' };
      }
    } catch {
      return { ok: false, error: 'Malformed Ed25519 PeerID in multiaddr' };
    }
    upsertPeerBook({
      peerId: targetPeerId,
      multiaddr: rawAddr,
      ...(entry.httpUrl ? { httpUrl: entry.httpUrl.trim().replace(/\/+$/, '') } : {}),
      ...(entry.region ? { region: entry.region } : {}),
      lastSeenAt: Date.now(),
      source: 'pex',
    });
    if (rawAddr.startsWith('/ip4/') || rawAddr.startsWith('/ip6/')) {
      dialSeedPeer(rawAddr).catch(() => {});
    }
    return { ok: true };
  };

  const initialDialList = rankMultiaddrsZeroDomainFirst([
    ...BOOTSTRAP_PEERS,
    ...Array.from(peerBook.values()).map(p => p.multiaddr),
  ]).filter(addr => enableDnsFallback || !addr.startsWith('/dns'));

  for (const addr of initialDialList) {
    await dialSeedPeer(addr);
  }

  let actualHttpUrl = `http://${dialHost}:${HTTP_PORT}`;
  const tlsCertPath = opts.tlsCertPath ?? process.env.SOVRA_TLS_CERT_PATH;
  let tlsSpkiSha256: string | undefined;
  try {
    const pem = opts.tlsCertPem ?? (tlsCertPath && fs.existsSync(tlsCertPath) ? fs.readFileSync(tlsCertPath, 'utf8') : undefined);
    if (pem) {
      const cert = new crypto.X509Certificate(pem);
      const spkiDer = cert.publicKey.export({ type: 'spki', format: 'der' });
      tlsSpkiSha256 = crypto.createHash('sha256').update(spkiDer).digest('hex');
    }
  } catch {}

  const buildSelfSeedEntry = (): SignedBootstrapPeerEntry =>
    signBootstrapPeerEntry(
      {
        peerId,
        operatorId: did,
        networkSubnetOrAsn: REGION,
        multiaddrs: selfMultiaddrs,
        httpUrl: actualHttpUrl,
        ...(tlsSpkiSha256 ? { spkiSha256: tlsSpkiSha256 } : {}),
        capabilities: [
          'relay-v2',
          'gossipsub',
          'dht',
          ...(stunEndpoint ? ['stun'] : []),
          ...(onionMultiaddr ? ['onion-v3'] : []),
        ],
        protocolVersions: ['/sovra/pex/1.0.0', '/sovra/gossipsub/1.2.0', '/sovra/dht/1.0.0'],
        publicKeyHex: deviceKey.publicKeyHex,
      },
      deviceKey,
    );

  const exportSignedSeedBundle = (): SignedBootstrapBundle => {
    const entries: SignedBootstrapPeerEntry[] = [buildSelfSeedEntry()];
    for (const p of peerBook.values()) {
      if (!enableDnsFallback && p.multiaddr.startsWith('/dns')) continue;
      entries.push(
        signBootstrapPeerEntry(
          {
            peerId: p.peerId,
            operatorId: p.signedRecord?.did || p.peerId,
            networkSubnetOrAsn: p.region || 'community',
            multiaddrs: p.signedRecord?.multiaddrs?.length ? p.signedRecord.multiaddrs : [p.multiaddr],
            capabilities: ['relay-v2', 'pex'],
            protocolVersions: ['/sovra/pex/1.0.0'],
            publicKeyHex: p.signedRecord?.signerPublicKeyHex || deviceKey.publicKeyHex,
          },
          deviceKey,
        ),
      );
    }
    return createSignedBootstrapBundle({
      network_id: 'sovra-zero-domain-v1',
      peers: entries,
      signers: [
        {
          operatorId: did,
          publicKeyHex: deviceKey.publicKeyHex,
          privateKey: deviceKey,
        },
      ],
      ttlSeconds: 30 * 86400,
    });
  };

  const importSeedBundle = async (
    bundle: SignedBootstrapBundle,
    minOperators = 1,
  ): Promise<{ ok: boolean; importedCount: number; error?: string }> => {
    const ver = verifySignedBootstrapBundle(bundle, {
      minIndependentOperators: minOperators,
    });
    if (!ver.ok) {
      return { ok: false, importedCount: 0, error: ver.error.message };
    }
    let importedCount = 0;
    for (const entry of bundle.peers) {
      if (entry.peerId === peerId) continue;
      const bestAddr = rankMultiaddrsZeroDomainFirst(entry.multiaddrs).find(
        a => enableDnsFallback || !a.startsWith('/dns'),
      );
      if (!bestAddr) continue;
      upsertPeerBook({
        peerId: entry.peerId,
        multiaddr: bestAddr,
        ...(entry.networkSubnetOrAsn ? { region: entry.networkSubnetOrAsn } : {}),
        lastSeenAt: Date.now(),
        source: 'bootstrap',
      });
      dialSeedPeer(bestAddr).catch(() => {});
      importedCount++;
    }
    return { ok: true, importedCount };
  };

  const startTime = Date.now();
  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqPath = (req.url || '/').split('?')[0];

    if (reqPath === '/health' || reqPath === '/api/status') {
      const activeConnections = p2pNode.connManager.getAllConnections();
      for (const c of activeConnections) {
        if ((c.status === 'connected' || c.status === 'relayed') && c.multiaddr && !peerBook.has(c.peerId)) {
          upsertPeerBook({
            peerId: c.peerId,
            multiaddr: c.multiaddr,
            lastSeenAt: Date.now(),
            source: 'dialed',
          });
        }
      }

      const statusPayload = {
        status: 'healthy',
        role: 'bootstrap-seed',
        region: REGION,
        version: '1.0.0',
        zeroDomainMode: !enableDnsFallback,
        peerId,
        did,
        multiaddr: multiaddrIp4,
        ...(onionMultiaddr ? { onionMultiaddr } : {}),
        multiaddrs: selfMultiaddrs,
        relayMultiaddr,
        ...(stunEndpoint ? { stunEndpoint } : {}),
        upnpMapped: p2pNode.portMapper.getActiveLeases().length > 0,
        httpUrl: actualHttpUrl,
        relayStatus: p2pNode.getRelayStatus(),
        listenPort: advertisedPort,
        connectedPeersCount: activeConnections.length,
        peerBookCount: peerBook.size,
        connectedPeers: activeConnections.map(c => ({
          peerId: c.peerId,
          remoteAddress: c.socket?.remoteAddress,
          state: c.status,
        })),
        routingTablePeersCount: p2pNode.dht.allPeersCount,
        topics: ['sovra/feed/main', 'sovra/creator/live', 'sovra/chats/mesh'],
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        memoryUsage: process.memoryUsage(),
      };
      res.writeHead(200);
      res.end(JSON.stringify(statusPayload, null, 2));
      return;
    }

    if (reqPath === '/api/peers' && req.method === 'GET') {
      const activeConns = p2pNode.connManager.getAllConnections();
      for (const c of activeConns) {
        if ((c.status === 'connected' || c.status === 'relayed') && c.multiaddr && !peerBook.has(c.peerId)) {
          upsertPeerBook({
            peerId: c.peerId,
            multiaddr: c.multiaddr,
            lastSeenAt: Date.now(),
            source: 'dialed',
          });
        }
      }
      const selfRecord = createSignedPeerRecord({
        peerId,
        did,
        multiaddrs: selfMultiaddrs,
        httpUrl: actualHttpUrl,
        region: REGION,
        signingKey: deviceKey,
        ttlSeconds: 3600,
      });
      const peersList = rankMultiaddrsZeroDomainFirst([
        ...selfMultiaddrs,
        ...Array.from(peerBook.values()).map(p => p.multiaddr),
      ]);
      res.writeHead(200);
      res.end(
        JSON.stringify(
          {
            ok: true,
            self: {
              region: REGION,
              peerId,
              did,
              multiaddr: multiaddrIp4,
              ...(onionMultiaddr ? { onionMultiaddr } : {}),
              relayMultiaddr,
              ...(stunEndpoint ? { stunEndpoint } : {}),
              ...(tlsSpkiSha256 ? { spkiSha256: tlsSpkiSha256 } : {}),
              httpUrl: actualHttpUrl,
              signedRecord: selfRecord,
              qrUri: encodeSignedPeerQrUri(selfRecord),
            },
            connectedCount: activeConns.length,
            peers: Array.from(peerBook.values()),
            multiaddrs: peersList,
            ...(stunEndpoint ? { stunEndpoints: [stunEndpoint] } : {}),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (reqPath === '/api/peers/announce' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= 16 * 1024) chunks.push(chunk);
      });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const result = await announcePeer(parsed);
          res.writeHead(result.ok ? 200 : 400);
          res.end(JSON.stringify({ ...result, peerBookCount: peerBook.size }));
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON payload' }));
        }
      });
      return;
    }

    if (reqPath === '/api/seeds/bundle' && req.method === 'GET') {
      const bundle = exportSignedSeedBundle();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, bundle }, null, 2));
      return;
    }

    if (reqPath === '/api/seeds/import' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= 128 * 1024) chunks.push(chunk);
      });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof parsed.qrUri === 'string' && parsed.qrUri.trim()) {
            const qrRes = decodeAndVerifyPeerQrUri(parsed.qrUri);
            if (!qrRes.ok) {
              res.writeHead(400);
              res.end(JSON.stringify({ ok: false, error: qrRes.error.message }));
              return;
            }
            const r = await announcePeer({ signedRecord: qrRes.value });
            res.writeHead(r.ok ? 200 : 400);
            res.end(JSON.stringify({ ok: r.ok, importedCount: r.ok ? 1 : 0, peerBookCount: peerBook.size, error: r.error }));
            return;
          }
          if (parsed.bundle) {
            const impRes = await importSeedBundle(parsed.bundle, parsed.minIndependentOperators ?? 1);
            res.writeHead(impRes.ok ? 200 : 400);
            res.end(JSON.stringify({ ...impRes, peerBookCount: peerBook.size }));
            return;
          }
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: 'Missing bundle or qrUri in /api/seeds/import' }));
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON payload' }));
        }
      });
      return;
    }

    if (reqPath === '/api/seeds') {
      const zeroDomainAddrs = getZeroDomainBootstrapMultiaddrs(
        [...selfMultiaddrs, ...Array.from(peerBook.values()).map(p => p.multiaddr)],
        enableDnsFallback,
      );
      res.writeHead(200);
      res.end(
        JSON.stringify(
          {
            ok: true,
            zeroDomainMode: !enableDnsFallback,
            self: {
              region: REGION,
              peerId,
              multiaddr: multiaddrIp4,
              ...(onionMultiaddr ? { onionMultiaddr } : {}),
              relayMultiaddr,
              ...(stunEndpoint ? { stunEndpoint } : {}),
              ...(tlsSpkiSha256 ? { spkiSha256: tlsSpkiSha256 } : {}),
              httpUrl: actualHttpUrl,
            },
            peers: Array.from(peerBook.values()),
            bootstrapMultiaddrs: zeroDomainAddrs,
            ...(stunEndpoint ? { stunEndpoints: [stunEndpoint] } : {}),
            globalSeeds: enableDnsFallback
              ? GLOBAL_DEFAULT_SEEDS
              : GLOBAL_DEFAULT_SEEDS.filter(s => !s.multiaddr.startsWith('/dns')),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (reqPath === '/metrics') {
      const activeConns = p2pNode.connManager.getAllConnections().length;
      const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
      const relayStatus = p2pNode.getRelayStatus();
      const metricsText = [
        '# HELP sovra_seed_up Whether the seed node is online',
        '# TYPE sovra_seed_up gauge',
        `sovra_seed_up{region="${REGION}"} 1`,
        '# HELP sovra_connected_peers Number of active connected peers',
        '# TYPE sovra_connected_peers gauge',
        `sovra_connected_peers{region="${REGION}"} ${activeConns}`,
        '# HELP sovra_peer_book_entries Number of persisted PEX peer entries',
        '# TYPE sovra_peer_book_entries gauge',
        `sovra_peer_book_entries{region="${REGION}"} ${peerBook.size}`,
        '# HELP sovra_relay_active_reservations Number of active circuit reservations',
        '# TYPE sovra_relay_active_reservations gauge',
        `sovra_relay_active_reservations{region="${REGION}"} ${relayStatus.activeReservationsCount}`,
        '# HELP sovra_relay_active_circuits Number of active relayed circuits',
        '# TYPE sovra_relay_active_circuits gauge',
        `sovra_relay_active_circuits{region="${REGION}"} ${relayStatus.activeCircuitsCount}`,
        '# HELP sovra_uptime_seconds Total node uptime in seconds',
        '# TYPE sovra_uptime_seconds counter',
        `sovra_uptime_seconds{region="${REGION}"} ${uptimeSec}`,
      ].join('\n');

      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.writeHead(200);
      res.end(metricsText);
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  await new Promise<void>(resolve => {
    httpServer.listen(HTTP_PORT, '0.0.0.0', () => resolve());
  });
  const addr = httpServer.address();
  const actualHttpPort = typeof addr === 'object' && addr ? addr.port : HTTP_PORT;
  actualHttpUrl = `http://${dialHost}:${actualHttpPort}`;

  const seedRegistryPath = opts.seedRegistryPath ?? process.env.SOVRA_SEED_REGISTRY;
  if (seedRegistryPath && fs.existsSync(seedRegistryPath)) {
    try {
      const regRaw = fs.readFileSync(seedRegistryPath, 'utf8');
      const parsedReg = parseSignedBootstrapRegistryJson(regRaw, { minIndependentOperators: 1 });
      if (parsedReg.ok) {
        await importSeedBundle(parsedReg.value.bundle, 1);
      }
    } catch {}
  }

  const exportSeedBundlePath = opts.exportSeedBundlePath ?? process.env.SOVRA_EXPORT_SEED_BUNDLE;
  if (exportSeedBundlePath) {
    try {
      const outDir = path.dirname(exportSeedBundlePath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(exportSeedBundlePath, JSON.stringify(exportSignedSeedBundle(), null, 2), 'utf8');
    } catch {}
  }

  const signSelfPeerRecord = (ttlSeconds = 3600): SignedPeerRecord =>
    createSignedPeerRecord({
      peerId,
      did,
      multiaddrs: selfMultiaddrs,
      httpUrl: actualHttpUrl,
      region: REGION,
      signingKey: deviceKey,
      ttlSeconds,
    });

  return {
    p2pNode,
    httpServer,
    peerId,
    did,
    region: REGION,
    multiaddr: multiaddrIp4,
    ...(onionMultiaddr ? { onionMultiaddr } : {}),
    relayMultiaddr,
    ...(stunEndpoint ? { stunEndpoint } : {}),
    ...(tlsSpkiSha256 ? { tlsSpkiSha256 } : {}),
    httpUrl: actualHttpUrl,
    qrUri: encodeSignedPeerQrUri(signSelfPeerRecord(3600)),
    p2pPort: advertisedPort,
    httpPort: actualHttpPort,
    dialSeedPeer,
    announcePeer,
    importSeedBundle,
    exportSignedSeedBundle,
    signSelfPeerRecord,
    getPeerBook: () => Array.from(peerBook.values()),
    stop: async () => {
      savePeerBook();
      if (stunServer) {
        await stunServer.close().catch(() => {});
      }
      if (typeof (httpServer as any).closeAllConnections === 'function') {
        (httpServer as any).closeAllConnections();
      }
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
      await p2pNode.stop();
    },
  };
}

async function main(): Promise<void> {
  console.info('============================================================');
  console.info('        SOVRA GLOBAL BOOTSTRAP SEED NODE RUNNER             ');
  console.info('============================================================');

  const node = await startSeedNodeDaemon();
  console.info(`[P2P] Region:                 ${node.region}`);
  console.info(`[P2P] Seed Node Listening:    0.0.0.0:${node.p2pPort}`);
  console.info(`[P2P] Peer ID:                ${node.peerId}`);
  console.info(`[P2P] Sovereign DID:          ${node.did}`);
  console.info(`[P2P] Public Multiaddr:       ${node.multiaddr}`);
  console.info(`[P2P] Public Relay Multiaddr: ${node.relayMultiaddr}`);
  console.info(`[HTTP] Health Status Endpoint: http://0.0.0.0:${node.httpPort}/health`);
  console.info(`[HTTP] Prometheus Metrics:     http://0.0.0.0:${node.httpPort}/metrics`);
  console.info('============================================================');

  const shutdown = async () => {
    console.info('\n[STOP] Shutting down seed node gracefully...');
    await node.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && process.argv[1].endsWith('bootstrap-node.ts')) {
  main().catch(err => {
    console.error('[FATAL] Seed Node crashed:', err);
    process.exit(1);
  });
}
