import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  generateEd25519KeyPair,
  bytesToHex,
  sha256,
} from '@sovra/crypto';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
} from '@sovra/identity';
import {
  SovraP2PNode,
  createPeerIdentityBinding,
} from '@sovra/p2p';
import {
  CID,
  MemoryBlockstore,
  BitSwapEngine,
  IntegrityVerificationError,
  ContentNotFoundError,
  createSignedStorageReceipt,
  verifySignedStorageReceipt,
  evaluateReplicationDiversity,
} from '@sovra/storage';
import {
  StorageNodeDaemon,
  ProofOfRetrievabilityEngine,
  POR_PROTOCOL_ID,
} from '../src/index.js';

function makeIdentity(label: string) {
  const idKp = generateEd25519KeyPair();
  const devKp = generateEd25519KeyPair();
  const ik = new SovraIdentityKey(idKp.privateKey);
  const validUntil = Math.floor(Date.now() / 1000) + 86400;
  const dk = new SovraDeviceKey(`${label}-dev`, `${label} Node`, ik.did, devKp.privateKey, validUntil);
  const del = createDeviceDelegation(ik, dk, validUntil);
  const binding = createPeerIdentityBinding(dk, ik.did, del);
  return { ik, dk, binding, devKp };
}

describe('Stage 3 — Storage Integrity, PoR Fail-Closed, Byzantine BitSwap & Distributed Recovery', () => {
  const nodes: SovraP2PNode[] = [];
  const daemons: StorageNodeDaemon[] = [];
  const tmpDirs: string[] = [];

  afterEach(async () => {
    while (daemons.length > 0) await daemons.pop()!.stop().catch(() => {});
    while (nodes.length > 0) await nodes.pop()!.stop().catch(() => {});
    while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  });

  it('rejects PoR signature spoofing, challenge replay, and slow responses even when prover reports 1ms latency', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-st-por-'));
    tmpDirs.push(tmpDir);

    const aId = makeIdentity('por-challenger');
    const bId = makeIdentity('por-prover');
    const evilId = makeIdentity('por-imposter');

    const payload = new TextEncoder().encode('Verified Storage Chunk For Fail-Closed PoR Audit');
    const cid = CID.create('raw', payload);
    const challenge = ProofOfRetrievabilityEngine.generateChallenge(cid.toString());

    // 1. Valid signed proof passes
    const validProof = ProofOfRetrievabilityEngine.createSignedProof(
      challenge,
      payload,
      bId.binding.peerId,
      msg => bId.dk.sign(msg),
    );
    expect(
      ProofOfRetrievabilityEngine.verifySignedProof(challenge, validProof, bId.binding.peerId, payload, 2000),
    ).toBe(true);

    // 2. Cross-peer signer spoofing rejected
    const spoofedProof = ProofOfRetrievabilityEngine.createSignedProof(
      challenge,
      payload,
      bId.binding.peerId,
      msg => evilId.dk.sign(msg),
    );
    expect(
      ProofOfRetrievabilityEngine.verifySignedProof(challenge, spoofedProof, bId.binding.peerId, payload, 2000),
    ).toBe(false);

    // 3. Delayed respondedAt exceeding maxResponseTimeMs fails closed even if proofResponseTimeMs is falsified to 1
    const staleChallenge = { ...challenge, issuedAt: Date.now() - 5000 };
    const forgedTimingProof = { ...validProof, proofResponseTimeMs: 1 };
    expect(
      ProofOfRetrievabilityEngine.verifySignedProof(staleChallenge, forgedTimingProof, bId.binding.peerId, payload, 500),
    ).toBe(false);

    // 4. Non-CID challenge rejected in both verifyProof and verifySignedProof
    expect(
      ProofOfRetrievabilityEngine.verifySignedProof(
        { ...challenge, cid: 'not-a-cid' },
        { ...validProof, cid: 'not-a-cid' },
        bId.binding.peerId,
        payload,
      ),
    ).toBe(false);

    // 5. Replayed inbound challengeId is rejected over real P2P Noise_XX channel
    const pA = new SovraP2PNode({ deviceKey: aId.dk, binding: aId.binding, listenAddresses: ['/ip4/127.0.0.1/tcp/0'], strictTransport: true });
    const pB = new SovraP2PNode({ deviceKey: bId.dk, binding: bId.binding, listenAddresses: ['/ip4/127.0.0.1/tcp/0'], strictTransport: true });
    nodes.push(pA, pB);
    await Promise.all([pA.start(), pB.start()]);

    const dB = new StorageNodeDaemon({
      storagePath: path.join(tmpDir, 'dB'),
      maxCapacityBytes: 20_000_000n,
      enableBitswap: true,
      p2pNode: pB,
      replicaVerificationIntervalMs: 0,
      pinLeaseSweeperIntervalMs: 0,
    });
    daemons.push(dB);
    await dB.start();
    await dB.blockstore.put(cid, payload);
    expect((await pA.dial(`/ip4/127.0.0.1/tcp/${pB.getBoundPort()}/p2p/${pB.identity.peerId}`)).ok).toBe(true);

    const firstRes = await pA.reqResp.sendRequest(
      pB.identity.peerId,
      POR_PROTOCOL_ID,
      new TextEncoder().encode(JSON.stringify({ challenge })),
    );
    expect(firstRes.ok).toBe(true);
    if (firstRes.ok) {
      expect(JSON.parse(new TextDecoder().decode(firstRes.value)).ok).toBe(true);
    }

    const replayRes = await pA.reqResp.sendRequest(
      pB.identity.peerId,
      POR_PROTOCOL_ID,
      new TextEncoder().encode(JSON.stringify({ challenge })),
    );
    expect(replayRes.ok).toBe(true);
    if (replayRes.ok) {
      expect(JSON.parse(new TextDecoder().decode(replayRes.value)).ok).toBe(false);
    }
  });

  it('rejects malformed-CID or expired SignedStorageReceipt records and counts failure domains accurately', () => {
    const prov = makeIdentity('rcpt-prov');
    const payload = new TextEncoder().encode('Storage Receipt Valid Block');
    const validCid = CID.create('raw', payload).toString();
    const nowSec = Math.floor(Date.now() / 1000);

    const badCidReceipt = createSignedStorageReceipt(
      {
        receiptId: 'bad-rcpt-1',
        cid: 'arbitrary-label-not-cid',
        providerPeerId: prov.binding.peerId,
        providerPublicKeyHex: bytesToHex(prov.devKp.publicKey),
        operatorId: 'op-coop-1',
        byteLength: payload.byteLength,
        storedAt: nowSec,
        expiresAt: nowSec + 3600,
      },
      prov.devKp.privateKey,
    );
    expect(verifySignedStorageReceipt(badCidReceipt, nowSec)).toBe(false);

    const validReceipt = createSignedStorageReceipt(
      {
        receiptId: 'good-rcpt-1',
        cid: validCid,
        providerPeerId: prov.binding.peerId,
        providerPublicKeyHex: bytesToHex(prov.devKp.publicKey),
        operatorId: 'op-coop-1',
        byteLength: payload.byteLength,
        storedAt: nowSec,
        expiresAt: nowSec + 3600,
      },
      prov.devKp.privateKey,
    );
    expect(verifySignedStorageReceipt(validReceipt, nowSec)).toBe(true);
    expect(verifySignedStorageReceipt(validReceipt, nowSec + 3601)).toBe(false);

    // Same operator running multiple nodes still counts as 1 independent failure domain
    const collocated = evaluateReplicationDiversity('ordinary_public', [
      { peerId: 'p1', operatorId: 'single-op', networkSubnetOrAsn: 'as100' },
      { peerId: 'p2', operatorId: 'single-op', networkSubnetOrAsn: 'as200' },
      { peerId: 'p3', operatorId: 'single-op', networkSubnetOrAsn: 'as300' },
    ]);
    expect(collocated.independentFailureDomains).toBe(1);
    expect(collocated.satisfiesTarget).toBe(false);
  });

  it('rejects Byzantine corrupted BitSwap blocks without polluting blockstore and fails over to honest storage peer', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-st-byz-'));
    tmpDirs.push(tmpDir);

    const payload = new TextEncoder().encode('Authentic Multi-Peer BitSwap Block Payload');
    const cid = CID.create('raw', payload);
    const corrupted = new Uint8Array(payload);
    corrupted[0] ^= 0xff;

    const readerStore = new MemoryBlockstore();
    const bs = new BitSwapEngine(readerStore, { defaultTimeoutMs: 1500 });
    bs.setNetwork({
      sendMessage: async (targetPeerId, msg) => {
        if (!msg.wantlist || msg.wantlist.some(w => w.cancel)) return;
        if (targetPeerId === 'evil-peer') {
          setTimeout(() => {
            bs.handleInboundMessage('evil-peer', {
              blocks: [{ cid: cid.toString(), data: corrupted }],
            }).catch(err => {
              expect(err).toBeInstanceOf(IntegrityVerificationError);
            });
          }, 10);
        } else if (targetPeerId === 'honest-peer') {
          setTimeout(() => {
            bs.handleInboundMessage('honest-peer', {
              blocks: [{ cid: cid.toString(), data: payload }],
            }).catch(() => {});
          }, 40);
        }
      },
      getConnectedPeers: () => ['evil-peer', 'honest-peer'],
    });

    const retrieved = await bs.requestBlock(cid, ['evil-peer', 'honest-peer']);
    expect(Buffer.from(retrieved).equals(Buffer.from(payload))).toBe(true);
    expect(Buffer.from((await readerStore.get(cid))!).equals(Buffer.from(payload))).toBe(true);

    // Offline missing block fails closed with ContentNotFoundError
    const emptyEngine = new BitSwapEngine(new MemoryBlockstore());
    await expect(emptyEngine.requestBlock(CID.create('raw', new Uint8Array([9, 8, 7])))).rejects.toThrow(
      ContentNotFoundError,
    );
  });
});
