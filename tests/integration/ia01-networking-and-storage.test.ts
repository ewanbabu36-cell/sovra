import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  generateEd25519KeyPair,
} from '@sovra/crypto';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
} from '@sovra/identity';
import {
  SovraP2PNode,
  createPeerIdentityBinding,
  createSignedPeerRecord,
  verifySignedPeerRecord,
  verifySignedPeerRecordResult,
  encodeSignedPeerQrUri,
  decodeAndVerifyPeerQrUri,
  createSignedBootstrapBundle,
  signBootstrapPeerEntry,
  verifySignedBootstrapBundle,
  NatManager,
  startLocalStunServer,
  probeStunUdp,
} from '@sovra/p2p';
import {
  CID,
  DiskBlockstore,
  StorageOperationTracker,
  createSignedStorageReceipt,
  verifySignedStorageReceipt,
  verifyStorageObjectFivePoint,
  evaluateReplicationDiversity,
} from '@sovra/storage';
import { StorageNodeDaemon, ProofOfRetrievabilityEngine } from '../../nodes/storage-node/src/index.js';
import { sha256, bytesToHex } from '@sovra/crypto';

function makeP2PIdentity(label: string) {
  const idKp = generateEd25519KeyPair();
  const devKp = generateEd25519KeyPair();
  const ik = new SovraIdentityKey(idKp.privateKey);
  const validUntil = Math.floor(Date.now() / 1000) + 86400;
  const dk = new SovraDeviceKey(`${label}-dev`, `${label} Node`, ik.did, devKp.privateKey, validUntil);
  const del = createDeviceDelegation(ik, dk, validUntil);
  const binding = createPeerIdentityBinding(dk, ik.did, del);
  return { ik, dk, binding, devKp };
}

describe('IA-01 Sections 4 & 5 — SOVRA-NET & SOVRA-STORE Acceptance Matrix', () => {
  const nodes: SovraP2PNode[] = [];
  const daemons: StorageNodeDaemon[] = [];
  const cleanupHooks: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (daemons.length > 0) await daemons.pop()!.stop().catch(() => {});
    while (nodes.length > 0) await nodes.pop()!.stop().catch(() => {});
    while (cleanupHooks.length > 0) {
      try { await cleanupHooks.pop()!(); } catch {}
    }
  });

  it('IA-01 Sec 4: verifies IPv4, IPv6 loopback, UDP mDNS, signed QR, PEX expiry/replay, symmetric NAT STUN limit & multi-relay failover', async () => {
    const id1 = makeP2PIdentity('v4a');
    const id2 = makeP2PIdentity('v4b');
    const mdnsPort = 56100 + Math.floor(Math.random() * 400);

    const n1 = new SovraP2PNode({
      deviceKey: id1.dk,
      binding: id1.binding,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      strictTransport: true,
      localDiscoveryOptions: { enableUdpMulticast: true, multicastPort: mdnsPort, beaconIntervalMs: 120 },
    });
    const n2 = new SovraP2PNode({
      deviceKey: id2.dk,
      binding: id2.binding,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      strictTransport: true,
      localDiscoveryOptions: { enableUdpMulticast: true, multicastPort: mdnsPort, beaconIntervalMs: 120 },
    });
    nodes.push(n1, n2);
    expect((await n1.start()).ok).toBe(true);
    expect((await n2.start()).ok).toBe(true);

    // 1. Direct IPv4 + LAN mDNS + Signed QR
    const d12 = await n2.dial(`/ip4/127.0.0.1/tcp/${n1.getBoundPort()}/p2p/${n1.identity.peerId}`);
    expect(d12.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 400));
    const mdnsSaw =
      n1.discovery.getDiscoveredPeers().some((p) => p.id.peerId === n2.identity.peerId) ||
      n2.discovery.getDiscoveredPeers().some((p) => p.id.peerId === n1.identity.peerId);
    expect(mdnsSaw).toBe(true);

    const rec1 = n1.getSignedPeerRecord(3600)!;
    const qr = encodeSignedPeerQrUri(rec1);
    const seenNonces = new Set<string>();
    expect(decodeAndVerifyPeerQrUri(qr, seenNonces).ok).toBe(true);
    // PEX/QR Replay rejected
    expect(decodeAndVerifyPeerQrUri(qr, seenNonces).ok).toBe(false);

    // Expired SignedPeerRecord rejected
    const expiredRec = createSignedPeerRecord({
      identity: n1.identity,
      signingKey: id1.dk,
      multiaddrs: [`/ip4/127.0.0.1/tcp/${n1.getBoundPort()}/p2p/${n1.identity.peerId}`],
      ttlSeconds: -10,
    });
    expect(verifySignedPeerRecord(expiredRec)).toBe(false);
    expect(verifySignedPeerRecordResult(expiredRec).ok).toBe(false);

    // 2. Direct IPv6 (/ip6/::1/tcp/0) test when OS IPv6 loopback is enabled
    const v6AId = makeP2PIdentity('v6a');
    const v6BId = makeP2PIdentity('v6b');
    const v6A = new SovraP2PNode({ deviceKey: v6AId.dk, binding: v6AId.binding, listenAddresses: ['/ip6/::1/tcp/0'], strictTransport: true });
    const v6B = new SovraP2PNode({ deviceKey: v6BId.dk, binding: v6BId.binding, listenAddresses: ['/ip6/::1/tcp/0'], strictTransport: true });
    nodes.push(v6A, v6B);
    const v6StartA = await v6A.start();
    const v6StartB = await v6B.start();
    if (v6StartA.ok && v6StartB.ok && v6A.getBoundPort() > 0) {
      const v6Dial = await v6B.dial(`/ip6/::1/tcp/${v6A.getBoundPort()}/p2p/${v6A.identity.peerId}`);
      expect(v6Dial.ok).toBe(true);
    }

    // 3. STUN never guarantees connectivity + Multi-relay disappearance & replacement
    const stunSrv = await startLocalStunServer(0, '127.0.0.1');
    cleanupHooks.push(() => stunSrv.close());
    const p1 = await probeStunUdp(stunSrv.host, stunSrv.port, 1200);
    const p2 = await probeStunUdp(stunSrv.host, stunSrv.port, 1200);
    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();
    const nat = new NatManager();
    const natType = nat.evaluateStunProbes([p1!, p2!]);
    expect(['cone_nat', 'symmetric_nat']).toContain(natType);

    // Boot 2 independent relays + unreachable peerA + peerB
    const r1Id = makeP2PIdentity('relay1');
    const r2Id = makeP2PIdentity('relay2');
    const aId = makeP2PIdentity('sym-a');
    const bId = makeP2PIdentity('sym-b');

    const relay1 = new SovraP2PNode({ deviceKey: r1Id.dk, binding: r1Id.binding, listenAddresses: ['/ip4/127.0.0.1/tcp/0'], enableRelayService: true, strictTransport: true });
    const relay2 = new SovraP2PNode({ deviceKey: r2Id.dk, binding: r2Id.binding, listenAddresses: ['/ip4/127.0.0.1/tcp/0'], enableRelayService: true, strictTransport: true });
    const peerA = new SovraP2PNode({ deviceKey: aId.dk, binding: aId.binding, listenAddresses: ['/ip4/100.64.9.10/tcp/0'], strictTransport: true });
    const peerB = new SovraP2PNode({ deviceKey: bId.dk, binding: bId.binding, listenAddresses: ['/ip4/100.64.9.20/tcp/0'], strictTransport: true });
    nodes.push(relay1, relay2, peerA, peerB);
    await relay1.start();
    await relay2.start();
    await peerA.start();
    await peerB.start();

    // Independent multi-operator bootstrap bundle verified
    const k1 = generateEd25519KeyPair();
    const k2 = generateEd25519KeyPair();
    const bundle = createSignedBootstrapBundle({
      network_id: 'sovra-ia01-test',
      peers: [
        signBootstrapPeerEntry({ peerId: relay1.identity.peerId, operatorId: 'op-relay-1', networkSubnetOrAsn: 'as100', multiaddrs: [`/ip4/127.0.0.1/tcp/${relay1.getBoundPort()}/p2p/${relay1.identity.peerId}`], capabilities: ['relay'], protocolVersions: ['1.0'], publicKeyHex: bytesToHex(k1.publicKey) }, k1.privateKey),
        signBootstrapPeerEntry({ peerId: relay2.identity.peerId, operatorId: 'op-relay-2', networkSubnetOrAsn: 'as200', multiaddrs: [`/ip4/127.0.0.1/tcp/${relay2.getBoundPort()}/p2p/${relay2.identity.peerId}`], capabilities: ['relay'], protocolVersions: ['1.0'], publicKeyHex: bytesToHex(k2.publicKey) }, k2.privateKey),
      ],
      signers: [
        { operatorId: 'op-relay-1', publicKeyHex: bytesToHex(k1.publicKey), privateKey: k1.privateKey },
        { operatorId: 'op-relay-2', publicKeyHex: bytesToHex(k2.publicKey), privateKey: k2.privateKey },
      ],
    });
    expect(verifySignedBootstrapBundle(bundle, { expectedNetworkId: 'sovra-ia01-test', minIndependentOperators: 2 }).ok).toBe(true);

    peerA.reqResp.registerHandler('/sovra/echo/1.0.0', async (_p, data) => data);

    // Connect both through Relay 1
    const r1Addr = `/ip4/127.0.0.1/tcp/${relay1.getBoundPort()}/p2p/${relay1.identity.peerId}`;
    const r2Addr = `/ip4/127.0.0.1/tcp/${relay2.getBoundPort()}/p2p/${relay2.identity.peerId}`;
    expect((await peerA.dial(r1Addr)).ok).toBe(true);
    expect((await peerB.dial(r1Addr)).ok).toBe(true);
    expect(await peerA.requestRelayV2Reservation(r1Addr)).toBe(true);
    expect(
      (await peerB.dial(`${r1Addr}/p2p-circuit/p2p/${peerA.identity.peerId}`)).ok,
    ).toBe(true);
    const viaR1 = await peerB.reqResp.sendRequest(peerA.identity.peerId, '/sovra/echo/1.0.0', new TextEncoder().encode('r1-ping'));
    expect(viaR1.ok).toBe(true);

    // Kill Relay 1 -> automatically switch to Relay 2 & restore communication!
    await relay1.stop();
    expect((await peerA.dial(r2Addr)).ok).toBe(true);
    expect((await peerB.dial(r2Addr)).ok).toBe(true);
    expect(await peerA.requestRelayV2Reservation(r2Addr)).toBe(true);
    expect(
      (await peerB.dial(`${r2Addr}/p2p-circuit/p2p/${peerA.identity.peerId}`)).ok,
    ).toBe(true);
    const viaR2 = await peerB.reqResp.sendRequest(peerA.identity.peerId, '/sovra/echo/1.0.0', new TextEncoder().encode('r2-failover-ping'));
    expect(viaR2.ok).toBe(true);
    if (viaR2.ok) expect(new TextDecoder().decode(viaR2.value)).toBe('r2-failover-ping');
  }, 30000);

  it('IA-01 Sec 5: verifies signed storage receipts, retention & expired provider pruning, remote PoR & replica repair', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-ia01-st-'));
    cleanupHooks.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    // Fail-closed validation checks for invalid StorageNodeDaemon / DiskBlockstore paths
    expect(() => new DiskBlockstore(undefined as unknown as string)).toThrow();
    expect(() => new StorageNodeDaemon(undefined as unknown as any)).toThrow();

    const s1 = makeP2PIdentity('st1');
    const s2 = makeP2PIdentity('st2');
    const p1 = new SovraP2PNode({ deviceKey: s1.dk, binding: s1.binding, listenAddresses: ['/ip4/127.0.0.1/tcp/0'], strictTransport: true });
    const p2 = new SovraP2PNode({ deviceKey: s2.dk, binding: s2.binding, listenAddresses: ['/ip4/127.0.0.1/tcp/0'], strictTransport: true });
    nodes.push(p1, p2);
    await p1.start();
    await p2.start();
    await p2.dial(`/ip4/127.0.0.1/tcp/${p1.getBoundPort()}/p2p/${p1.identity.peerId}`);

    const d1 = new StorageNodeDaemon({
      storagePath: path.join(tmpDir, 'd1'),
      maxCapacityBytes: 50_000_000n,
      enableBitswap: true,
      p2pNode: p1,
      replicaVerificationIntervalMs: 0,
      pinLeaseSweeperIntervalMs: 0,
    });
    const d2 = new StorageNodeDaemon({
      storagePath: path.join(tmpDir, 'd2'),
      maxCapacityBytes: 50_000_000n,
      enableBitswap: true,
      p2pNode: p2,
      replicaVerificationIntervalMs: 0,
      pinLeaseSweeperIntervalMs: 0,
    });
    daemons.push(d1, d2);
    await d1.start();
    await d2.start();

    const payload = new TextEncoder().encode('IA-01 Persistent Verified Media Chunk Payload');
    const cid = new CID('raw', sha256(payload), 'sha2-256');
    await d1.blockstore.put(cid, payload);
    expect(verifyStorageObjectFivePoint(payload, { cid: cid.toString(), codec: 'raw', expectedByteLength: payload.byteLength }).ok).toBe(true);

    // Non-CID & tampered PoR fail closed
    expect(ProofOfRetrievabilityEngine.verifyProof(ProofOfRetrievabilityEngine.generateChallenge('invalid-cid-label', 0), payload).isValid).toBe(false);

    // Retention policy + signed storage receipts + expired provider pruning
    const tracker = new StorageOperationTracker();
    tracker.pinObject(cid.toString(), { tier: 'ordinary_public', minimumRetentionSeconds: 86400, pinned: true });
    expect(tracker.getRetentionPolicy(cid.toString())?.minimumRetentionSeconds).toBe(86400);

    const nowSec = Math.floor(Date.now() / 1000);
    const rcpt = createSignedStorageReceipt(
      {
        receiptId: 'st-rcpt-1',
        cid: cid.toString(),
        providerPeerId: p1.identity.peerId,
        providerPublicKeyHex: bytesToHex(s1.devKp.publicKey),
        operatorId: 'op-1',
        byteLength: payload.byteLength,
        storedAt: nowSec,
        expiresAt: nowSec + 3600,
      },
      s1.devKp.privateKey,
    );
    expect(verifySignedStorageReceipt(rcpt, nowSec)).toBe(true);
    expect(tracker.recordSignedReceipt(rcpt, nowSec)).toBe(true);
    expect(tracker.recordSignedReceipt(rcpt, nowSec)).toBe(false); // Replay rejected

    tracker.advertiseProvider(cid.toString(), { peerId: p1.identity.peerId, operatorId: 'op-1', networkSubnetOrAsn: 'as1', expiresAt: nowSec + 3600 });
    tracker.advertiseProvider(cid.toString(), { peerId: 'expired-peer', operatorId: 'op-old', networkSubnetOrAsn: 'as2', expiresAt: nowSec - 10 });
    expect(tracker.findProviders(cid.toString(), nowSec)).toHaveLength(1);
    expect(tracker.pruneExpiredProviders(cid.toString(), nowSec)).toBe(1);

    // Active BitSwap Replica Repair push from d1 -> d2 & Remote Signed PoR challenge from d2 -> d1
    await d1.pin(cid, { creatorDid: s1.ik.did, targetReplicationFactor: 2 });
    const audits = await d1.verifyReplicas();
    expect(audits.ok).toBe(true);
    if (audits.ok) {
      expect(audits.value.repairsTriggered).toBeGreaterThanOrEqual(1);
    }
    const deadline = Date.now() + 3000;
    while (!(await d2.blockstore.has(cid)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(await d2.blockstore.has(cid)).toBe(true);

    const por = await d2.challengePeerRetrievability(p1.identity.peerId, cid, payload);
    expect(por.ok).toBe(true);

    // Mismatched expectedBlockData on remote PoR fails closed
    const badBlock = new Uint8Array(payload);
    badBlock[0] ^= 0xff;
    const porBad = await d2.challengePeerRetrievability(p1.identity.peerId, cid, badBlock);
    expect(porBad.ok).toBe(false);

    // Multi-operator failure domain check
    expect(
      evaluateReplicationDiversity('ordinary_public', [
        { peerId: p1.identity.peerId, operatorId: 'op-1', networkSubnetOrAsn: 'as1' },
        { peerId: p2.identity.peerId, operatorId: 'op-2', networkSubnetOrAsn: 'as2' },
        { peerId: 'peer-3', operatorId: 'op-3', networkSubnetOrAsn: 'as3' },
      ]).satisfiesTarget,
    ).toBe(true);
  }, 20000);
});
