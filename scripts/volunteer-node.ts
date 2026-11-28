/**
 * @file scripts/volunteer-node.ts
 * Zero-Domain Community Volunteer Node Launcher (Bitcoin/BitTorrent/Nostr Parity).
 *
 * Runs a self-sovereign volunteer P2P node with zero central domain or hosting requirement:
 * - Persistent Ed25519 PeerID & DID keystore
 * - Noise_XX TCP P2P transport + Circuit Relay v2 + GossipSub mesh + Kademlia DHT
 * - Persistent <dataDir>/peers.json Peer Exchange (PEX)
 * - Tiered BitSwap Storage pinning & chunk delivery (full/storage roles)
 */

import path from 'node:path';
import { StorageNodeDaemon } from '../nodes/storage-node/dist/index.js';
import {
  startSeedNodeDaemon,
  type RunningSeedNode,
  type SeedNodeOptions,
} from './bootstrap-node.ts';

export type VolunteerRole = 'full' | 'relay' | 'storage' | 'seed';

export interface VolunteerNodeOptions extends SeedNodeOptions {
  role?: VolunteerRole;
  enableStorage?: boolean;
  storageQuotaMb?: number;
}

export interface RunningVolunteerNode extends RunningSeedNode {
  role: VolunteerRole;
  storageDaemon?: StorageNodeDaemon;
}

export async function startVolunteerNodeDaemon(
  opts: VolunteerNodeOptions = {},
): Promise<RunningVolunteerNode> {
  const role: VolunteerRole = opts.role ?? 'full';
  const dataDir =
    opts.dataDir ??
    process.env.SOVRA_DATA_DIR ??
    path.join(process.cwd(), `.sovra-volunteer-${role}`);
  const enableStorage =
    opts.enableStorage ?? (role === 'full' || role === 'storage');
  const storageQuotaMb = opts.storageQuotaMb ?? 1024;

  // Enforce zero-domain default unless caller explicitly opted into DNS fallback
  const seedNode = await startSeedNodeDaemon({
    ...opts,
    dataDir,
    region: opts.region ?? `volunteer-${role}`,
    enableDnsFallback: opts.enableDnsFallback ?? false,
  });

  let storageDaemon: StorageNodeDaemon | undefined;
  if (enableStorage) {
    storageDaemon = new StorageNodeDaemon({
      storagePath: path.join(dataDir, 'storage'),
      maxCapacityBytes: BigInt(storageQuotaMb) * 1024n * 1024n,
      enableBitswap: true,
      p2pNode: seedNode.p2pNode,
      replicaVerificationIntervalMs: 0,
      pinLeaseSweeperIntervalMs: 0,
    });
    const stRes = await storageDaemon.start();
    if (!stRes.ok) {
      await seedNode.stop();
      throw new Error(`Failed to start volunteer storage daemon: ${String(stRes.error)}`);
    }
  }

  return {
    ...seedNode,
    role,
    ...(storageDaemon ? { storageDaemon } : {}),
    stop: async () => {
      if (storageDaemon) {
        await storageDaemon.stop();
      }
      await seedNode.stop();
    },
  };
}

function parseCliArgs(argv: string[]): VolunteerNodeOptions {
  const getArg = (flag: string): string | undefined => {
    const eq = argv.find(a => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const roleRaw = (getArg('--role') || process.env.SOVRA_NODE_ROLE || 'full') as VolunteerRole;
  const p2pPortStr = getArg('--p2p-port') || process.env.SOVRA_P2P_PORT;
  const httpPortStr = getArg('--http-port') || process.env.SOVRA_HTTP_PORT;
  const stunPortStr = getArg('--stun-port') || process.env.SOVRA_STUN_PORT;
  const quotaStr = getArg('--quota-mb') || process.env.SOVRA_QUOTA_MB;
  const mdnsPortStr = getArg('--mdns-port') || process.env.SOVRA_MDNS_PORT;
  const peersStr = getArg('--peers') || process.env.SOVRA_BOOTSTRAP_PEERS;
  const socks5ProxyUrl = getArg('--socks5') || process.env.SOVRA_TOR_SOCKS5 || process.env.SOVRA_SOCKS5_PROXY;
  const onionHostnameFile = getArg('--onion-hostname-file') || process.env.SOVRA_ONION_HOSTNAME_FILE;
  const seedRegistryPath = getArg('--seed-registry') || process.env.SOVRA_SEED_REGISTRY;
  const exportSeedBundlePath = getArg('--export-seed-bundle') || process.env.SOVRA_EXPORT_SEED_BUNDLE;
  const tlsCertPath = getArg('--tls-cert') || process.env.SOVRA_TLS_CERT_PATH;

  return {
    role: ['full', 'relay', 'storage', 'seed'].includes(roleRaw) ? roleRaw : 'full',
    ...(p2pPortStr ? { p2pPort: parseInt(p2pPortStr, 10) } : {}),
    ...(httpPortStr ? { httpPort: parseInt(httpPortStr, 10) } : {}),
    ...(stunPortStr ? { stunPort: parseInt(stunPortStr, 10) } : {}),
    ...(getArg('--data-dir') ? { dataDir: getArg('--data-dir') } : {}),
    ...(getArg('--public-ip') ? { publicIp: getArg('--public-ip') } : {}),
    ...(quotaStr ? { storageQuotaMb: parseInt(quotaStr, 10) } : {}),
    ...(peersStr ? { bootstrapPeers: peersStr.split(',').map(s => s.trim()).filter(Boolean) } : {}),
    enableMdns: !argv.includes('--no-mdns') && process.env.SOVRA_ENABLE_MDNS !== 'false',
    ...(mdnsPortStr ? { mdnsPort: parseInt(mdnsPortStr, 10) } : {}),
    enableUpnp: argv.includes('--upnp') || process.env.SOVRA_ENABLE_UPNP === 'true',
    enableStun: argv.includes('--stun') || process.env.SOVRA_ENABLE_STUN === 'true',
    ...(socks5ProxyUrl ? { socks5ProxyUrl } : {}),
    ...(onionHostnameFile ? { onionHostnameFile } : {}),
    ...(seedRegistryPath ? { seedRegistryPath } : {}),
    ...(exportSeedBundlePath ? { exportSeedBundlePath } : {}),
    ...(tlsCertPath ? { tlsCertPath } : {}),
    enableDnsFallback: (argv.includes('--allow-dns') || process.env.SOVRA_ALLOW_DNS === 'true') && !argv.includes('--no-dns'),
  };
}

if (process.argv[1] && process.argv[1].endsWith('volunteer-node.ts')) {
  const opts = parseCliArgs(process.argv.slice(2));
  startVolunteerNodeDaemon(opts)
    .then((node) => {
      console.info('============================================================');
      console.info(` SOVRA VOLUNTEER P2P NODE ACTIVE (${node.role.toUpperCase()}) `);
      console.info('============================================================');
      console.info(` PeerID:          ${node.peerId}`);
      console.info(` Sovereign DID:   ${node.did}`);
      console.info(` P2P Multiaddr:   ${node.multiaddr}`);
      if (node.onionMultiaddr) console.info(` Tor Onion Addr:  ${node.onionMultiaddr}`);
      console.info(` Circuit Relay:   ${node.relayMultiaddr}`);
      if (node.stunEndpoint) console.info(` Sovereign STUN:  ${node.stunEndpoint}`);
      console.info(` PEX API:         ${node.httpUrl}/api/peers`);
      console.info(` Seed Bundle:     ${node.httpUrl}/api/seeds/bundle`);
      console.info(` Storage Enabled: ${Boolean(node.storageDaemon)}`);
      console.info('============================================================');

      const shutdown = async () => {
        await node.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('[FATAL] Volunteer node startup failed:', err);
      process.exit(1);
    });
}
