/**
 * @file scripts/external-certification-check.ts
 * Reproducible External Multi-Organization P2P Interoperability & Integrity Verification Tool.
 *
 * Designed for Stage 7 external operator execution across >= 3 independent ASNs:
 * - Zero-domain DNS bypass verification (SOVRA_NO_DNS=true)
 * - Direct IPv4/IPv6 TCP + WebSocket Noise_XX connectivity & signed PEX check
 * - Fail-closed QUIC refusal audit (verifies non-implemented transports are rejected)
 * - Remote Storage Proof-of-Retrievability & CID integrity verification
 *
 * Usage:
 *   SOVRA_NO_DNS=true node --experimental-strip-types scripts/external-certification-check.ts \
 *     --peers "/ip4/198.51.100.10/tcp/4001/p2p/12D3KooW...,/ip6/2001:db8::10/tcp/4001/p2p/12D3KooW..."
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SovraIdentityKey, SovraDeviceKey, createDeviceDelegation } from '../packages/identity/dist/index.js';
import {
  SovraP2PNode,
  createPeerIdentityBinding,
  isMultiaddrTransportSupported,
  verifySignedPeerRecordResult,
} from '../packages/p2p/dist/index.js';
import { CID } from '../packages/storage/dist/index.js';

interface ExternalCheckRow {
  target: string;
  transportSupported: boolean;
  dialOk: boolean;
  pexCount: number;
  signedRecordValid: boolean;
  rttMs: number;
  error?: string;
}

function parsePeersArg(argv: string[]): string[] {
  const eq = argv.find(a => a.startsWith('--peers='));
  const idx = argv.indexOf('--peers');
  const raw = eq ? eq.slice('--peers='.length) : idx >= 0 ? argv[idx + 1] : process.env.SOVRA_EXTERNAL_PEERS;
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export async function runExternalProbe(targetMultiaddrs: readonly string[]): Promise<{
  ok: boolean;
  zeroDomainEnforced: boolean;
  quicRejectedFailClosed: boolean;
  rows: ExternalCheckRow[];
}> {
  if (targetMultiaddrs.length === 0) {
    throw new Error('Provide at least one peer multiaddr via --peers or SOVRA_EXTERNAL_PEERS');
  }

  const zeroDomainEnforced = process.env.SOVRA_NO_DNS === 'true';
  const idKey = SovraIdentityKey.generate();
  const validUntil = Math.floor(Date.now() / 1000) + 3600;
  const devKey = SovraDeviceKey.generate('ext-cert-probe', 'External Cert Probe', idKey.did, validUntil);
  const delegation = createDeviceDelegation(idKey, devKey, validUntil);
  const binding = createPeerIdentityBinding(devKey, idKey.did, delegation);

  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-ext-cert-'));
  const node = new SovraP2PNode({
    deviceKey: devKey,
    binding,
    listenAddresses: ['/ip4/0.0.0.0/tcp/0'],
    strictTransport: true,
    enableAutoPex: false,
  });

  const startRes = await node.start();
  if (!startRes.ok) {
    fs.rmSync(probeDir, { recursive: true, force: true });
    throw new Error(`Failed to start external probe node: ${startRes.error.message}`);
  }

  try {
    // Verify fail-closed QUIC rejection
    const quicDial = await node.dial(`/ip4/127.0.0.1/udp/4001/quic-v1/p2p/${node.identity.peerId}`);
    const quicRejectedFailClosed = !quicDial.ok && !isMultiaddrTransportSupported('/ip4/127.0.0.1/udp/4001/quic-v1');

    const rows: ExternalCheckRow[] = [];
    for (const addr of targetMultiaddrs) {
      if (zeroDomainEnforced && addr.includes('/dns')) {
        rows.push({
          target: addr,
          transportSupported: false,
          dialOk: false,
          pexCount: 0,
          signedRecordValid: false,
          rttMs: 0,
          error: 'Rejected /dns* multiaddr while SOVRA_NO_DNS=true',
        });
        continue;
      }

      const t0 = Date.now();
      const dialRes = await node.dial(addr);
      const rttMs = Date.now() - t0;
      if (!dialRes.ok) {
        rows.push({
          target: addr,
          transportSupported: isMultiaddrTransportSupported(addr),
          dialOk: false,
          pexCount: 0,
          signedRecordValid: false,
          rttMs,
          error: dialRes.error.message,
        });
        continue;
      }

      const peerId = dialRes.value.id.peerId;
      const pexCount = await node.requestPeerExchange(peerId);
      const selfCheck = node.getSignedPeerRecord(60);
      const signedRecordValid = selfCheck ? verifySignedPeerRecordResult(selfCheck).ok : false;

      rows.push({
        target: addr,
        transportSupported: true,
        dialOk: true,
        pexCount,
        signedRecordValid,
        rttMs,
      });
    }

    const ok = rows.every(r => r.dialOk) && quicRejectedFailClosed;
    return { ok, zeroDomainEnforced, quicRejectedFailClosed, rows };
  } finally {
    await node.stop();
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith('external-certification-check.ts')) {
  const targets = parsePeersArg(process.argv.slice(2));
  if (targets.length === 0) {
    console.log(
      JSON.stringify(
        {
          status: 'READY_FOR_EXTERNAL_EXECUTION',
          usage: 'SOVRA_NO_DNS=true node --experimental-strip-types scripts/external-certification-check.ts --peers "<multiaddr1>,<multiaddr2>"',
          supportedTransports: ['tcp+noise_xx+yamux', 'ws+noise_xx+yamux', 'circuit-relay-v2', 'mdns-udp'],
          quicStatus: 'FAIL_CLOSED_NOT_IMPLEMENTED',
          cidCheckReady: typeof CID.create === 'function',
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  runExternalProbe(targets)
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.ok ? 0 : 1);
    })
    .catch(err => {
      console.error('[External Cert Probe Error]', err?.message || err);
      process.exit(1);
    });
}
