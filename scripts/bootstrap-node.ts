/**
 * @file scripts/bootstrap-node.ts
 * Production-Grade Public Bootstrap Seed Node Daemon for Sovra Network.
 *
 * Implements:
 * 1. Persistent Ed25519 identity key generation/loading.
 * 2. Real OS TCP socket listener on 0.0.0.0:4001 with Noise_XX transport.
 * 3. Kademlia DHT Rendezvous routing table server mode.
 * 4. Circuit Relay v2 packet forwarder for mobile peers behind symmetric NAT.
 * 5. GossipSub v1.2 mesh coordinator for feed, chats, and delivery receipts.
 * 6. HTTP JSON Health & Prometheus Metrics endpoint on port 8080.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateEd25519KeyPair,
  bytesToHex,
  hexToBytes,
  sha256,
} from '../packages/crypto/dist/index.js';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
} from '../packages/identity/dist/index.js';
import {
  SovraP2PNode,
  createPeerIdentityBinding,
} from '../packages/p2p/dist/index.js';

const P2P_PORT = parseInt(process.env.SOVRA_P2P_PORT ?? '4001', 10);
const P2P_HOST = process.env.SOVRA_P2P_HOST ?? '0.0.0.0';
const HTTP_PORT = parseInt(process.env.SOVRA_HTTP_PORT ?? '8080', 10);
const DATA_DIR = process.env.SOVRA_DATA_DIR ?? path.join(process.cwd(), '.sovra-seed');
const PUBLIC_IP = process.env.SOVRA_PUBLIC_IP ?? '127.0.0.1';

interface StoredKeyConfig {
  identityPrivateKeyHex: string;
  devicePrivateKeyHex: string;
}

function ensureDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadOrGenerateKeys(): { identityKey: SovraIdentityKey; deviceKey: SovraDeviceKey } {
  ensureDirectory(DATA_DIR);
  const keyPath = path.join(DATA_DIR, 'seed-node-keys.json');
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;

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

async function main(): Promise<void> {
  console.log('============================================================');
  console.log('        SOVRA GLOBAL BOOTSTRAP SEED NODE RUNNER             ');
  console.log('============================================================');

  const { identityKey, deviceKey } = loadOrGenerateKeys();
  const validUntilSec = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const delegation = createDeviceDelegation(identityKey, deviceKey, validUntilSec);

  const binding = createPeerIdentityBinding(deviceKey, identityKey.did, delegation);

  const p2pNode = new SovraP2PNode({
    deviceKey,
    binding,
    listenAddresses: [`/ip4/${P2P_HOST}/tcp/${P2P_PORT}`],
    limits: {
      maxInboundConnections: 1000,
      maxOutboundConnections: 500,
      maxStreamsPerConnection: 128,
    },
  });

  const startRes = await p2pNode.start();
  if (!startRes.ok) {
    console.error('[FATAL] Failed to start P2P Node:', startRes.error);
    process.exit(1);
  }

  const peerId = p2pNode.identity.peerId;
  const did = identityKey.did;
  const multiaddrIp4 = `/ip4/${PUBLIC_IP}/tcp/${P2P_PORT}/p2p/${peerId}`;

  // Subscribe to core network GossipSub topics
  p2pNode.pubsub.subscribe('sovra/feed/main');
  p2pNode.pubsub.subscribe('sovra/creator/live');
  p2pNode.pubsub.subscribe('sovra/chats/mesh');

  console.log(`[P2P] Seed Node Listening: ${P2P_HOST}:${P2P_PORT}`);
  console.log(`[P2P] Peer ID:            ${peerId}`);
  console.log(`[P2P] Sovereign DID:      ${did}`);
  console.log(`[P2P] Public Multiaddr:   ${multiaddrIp4}`);

  // HTTP Health & Status Server on port 8080
  const startTime = Date.now();
  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/health' || req.url === '/api/status') {
      const activeConnections = p2pNode.connManager.getAllConnections();
      const statusPayload = {
        status: 'healthy',
        role: 'bootstrap-seed',
        version: '1.0.0',
        peerId,
        did,
        multiaddr: multiaddrIp4,
        listenPort: P2P_PORT,
        connectedPeersCount: activeConnections.length,
        connectedPeers: activeConnections.map(c => ({
          peerId: c.peerId,
          remoteAddress: c.remoteAddress,
          state: c.state,
        })),
        routingTablePeersCount: p2pNode.dht.getRoutingTableSize?.() ?? 0,
        topics: ['sovra/feed/main', 'sovra/creator/live', 'sovra/chats/mesh'],
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        memoryUsage: process.memoryUsage(),
      };
      res.writeHead(200);
      res.end(JSON.stringify(statusPayload, null, 2));
      return;
    }

    if (req.url === '/metrics') {
      // Prometheus format metrics
      const activeConns = p2pNode.connManager.getAllConnections().length;
      const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
      const metricsText = [
        '# HELP sovra_seed_up Whether the seed node is online',
        '# TYPE sovra_seed_up gauge',
        'sovra_seed_up 1',
        '# HELP sovra_connected_peers Number of active connected peers',
        '# TYPE sovra_connected_peers gauge',
        `sovra_connected_peers ${activeConns}`,
        '# HELP sovra_uptime_seconds Total node uptime in seconds',
        '# TYPE sovra_uptime_seconds counter',
        `sovra_uptime_seconds ${uptimeSec}`,
      ].join('\n');

      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.writeHead(200);
      res.end(metricsText);
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[HTTP] Health Status Endpoint: http://0.0.0.0:${HTTP_PORT}/health`);
    console.log(`[HTTP] Prometheus Metrics:     http://0.0.0.0:${HTTP_PORT}/metrics`);
    console.log('============================================================');
    console.log('  🚀 Seed node is online and ready for global peer connections!');
    console.log('============================================================');
  });

  // Graceful Shutdown
  const shutdown = async () => {
    console.log('\n[STOP] Shutting down seed node gracefully...');
    httpServer.close();
    await p2pNode.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[FATAL] Seed Node crashed:', err);
  process.exit(1);
});
