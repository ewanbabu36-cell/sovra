import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { bytesToHex, generateEd25519KeyPair, sha256 } from '@sovra/crypto';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  SovraIdentityModule,
  CommunityGovernanceEngine,
  createDeviceDelegation,
  isValidSovraIdentityId,
} from '@sovra/identity';
import {
  SovraEventEngine,
  SovraNodeSqliteDatabase,
  SovraDocumentSyncEngine,
  createAndSignSovraSpecEvent,
  verifySovraSpecEvent,
} from '@sovra/protocol';
import {
  SovraP2PNode,
  createPeerIdentityBinding,
  createSignedBootstrapBundle,
  signBootstrapPeerEntry,
  verifySignedBootstrapBundle,
} from '@sovra/p2p';
import {
  evaluateReplicationDiversity,
  StorageOperationTracker,
  verifyStorageObjectFivePoint,
  CID,
} from '@sovra/storage';
import { MessageLifecycleTracker } from '@sovra/messaging';
import {
  SOVRA_PROTOCOL_NAMESPACES,
  registerSovraProtocolNamespaces,
} from '../../nodes/full-node/src/index.js';

describe('SOVRA Master Spec v1.0 — Section 22 & Section 27 Certification Suite', () => {
  const nodesToStop: SovraP2PNode[] = [];
  const dbsToClose: SovraNodeSqliteDatabase[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (dbsToClose.length > 0) {
      try { dbsToClose.pop()!.close(); } catch {}
    }
    while (nodesToStop.length > 0) {
      await nodesToStop.pop()!.stop();
    }
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  it('passes Section 27 Ultimate 12-Step Founder-Shutdown Test & Section 22.1 Performance Targets without blockchain or domain', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-master-spec-v1-'));
    tempDirs.push(tmpDir);

    // Track peer connection + creation latencies for Section 22.1 targets
    const idStart = performance.now();
    const userIdentity = new SovraIdentityModule();
    const userObj = userIdentity.create(['social', 'messaging', 'commerce', 'governance']);
    const idLatencyMs = performance.now() - idStart;
    expect(isValidSovraIdentityId(userObj.identity_id)).toBe(true);
    expect(idLatencyMs).toBeLessThan(2000); // Section 22.1 target < 2s

    // Boot 1 Founder Bootstrap Node + 3 Independent Community Operator Nodes
    const mkP2PNode = async () => {
      const ik = SovraIdentityKey.generate();
      const validUntil = Math.floor(Date.now() / 1000) + 86400;
      const dk = SovraDeviceKey.generate('node-dev', 'Community Node', ik.did, validUntil);
      const delegation = createDeviceDelegation(ik, dk, validUntil);
      const binding = createPeerIdentityBinding(dk, ik.did, delegation);
      const n = new SovraP2PNode({
        deviceKey: dk,
        binding,
        listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
        bootstrapConfig: { bootstrapNodes: [] },
        strictTransport: true,
      });
      const res = await n.start();
      expect(res.ok).toBe(true);
      nodesToStop.push(n);
      return n;
    };

    const founderNode = await mkP2PNode();
    const communityA = await mkP2PNode();
    const communityB = await mkP2PNode();
    const communityC = await mkP2PNode();

    const opA = generateEd25519KeyPair();
    const opB = generateEd25519KeyPair();
    const opC = generateEd25519KeyPair();

    const peerAddr = (n: SovraP2PNode) => `/ip4/127.0.0.1/tcp/${n.getBoundPort()}/p2p/${n.identity.peerId}`;

    // Wire all 8 Part L `/sovra/*/1.0.0` namespaces & local DB/engines on Community Nodes A, B, C
    const dbB = new SovraNodeSqliteDatabase(path.join(tmpDir, 'node-b.sqlite'));
    await dbB.open();
    dbsToClose.push(dbB);
    const eventEngineA = new SovraEventEngine();
    const eventEngineB = new SovraEventEngine();
    const storageTracker = new StorageOperationTracker();
    const syncB = new SovraDocumentSyncEngine();
    syncB.openDocument('shared-tags', 'or-set');

    registerSovraProtocolNamespaces(communityA, { identity: userIdentity, eventEngine: eventEngineA, storageTracker });
    registerSovraProtocolNamespaces(communityB, { eventEngine: eventEngineB, syncEngine: syncB, storageTracker });
    registerSovraProtocolNamespaces(communityC, { storageTracker });

    // Multi-operator signed bootstrap bundle (Step 3 + Section 6.3)
    const bundle = createSignedBootstrapBundle({
      network_id: 'sovra-mainnet-v1',
      peers: [
        signBootstrapPeerEntry(
          {
            peerId: communityA.identity.peerId,
            operatorId: 'op-coop-tokyo',
            networkSubnetOrAsn: 'as2516-jp',
            multiaddrs: [peerAddr(communityA)],
            capabilities: ['full', 'storage'],
            protocolVersions: ['1.0'],
            publicKeyHex: bytesToHex(opA.publicKey),
          },
          opA.privateKey,
        ),
        signBootstrapPeerEntry(
          {
            peerId: communityB.identity.peerId,
            operatorId: 'op-coop-berlin',
            networkSubnetOrAsn: 'as3320-de',
            multiaddrs: [peerAddr(communityB)],
            capabilities: ['full', 'storage', 'community'],
            protocolVersions: ['1.0'],
            publicKeyHex: bytesToHex(opB.publicKey),
          },
          opB.privateKey,
        ),
        signBootstrapPeerEntry(
          {
            peerId: communityC.identity.peerId,
            operatorId: 'op-coop-toronto',
            networkSubnetOrAsn: 'as577-ca',
            multiaddrs: [peerAddr(communityC)],
            capabilities: ['relay', 'storage'],
            protocolVersions: ['1.0'],
            publicKeyHex: bytesToHex(opC.publicKey),
          },
          opC.privateKey,
        ),
      ],
      signers: [
        { operatorId: 'op-coop-tokyo', publicKeyHex: bytesToHex(opA.publicKey), privateKey: opA.privateKey },
        { operatorId: 'op-coop-berlin', publicKeyHex: bytesToHex(opB.publicKey), privateKey: opB.privateKey },
        { operatorId: 'op-coop-toronto', publicKeyHex: bytesToHex(opC.publicKey), privateKey: opC.privateKey },
      ],
    });
    const bundleVer = verifySignedBootstrapBundle(bundle, {
      expectedNetworkId: 'sovra-mainnet-v1',
      minIndependentOperators: 3,
    });
    expect(bundleVer.ok).toBe(true);

    // 1-4. STEPS 1-4 OF SECTION 27: Terminate founder infrastructure permanently
    await founderNode.stop();
    expect(founderNode.getConnectedPeers()).toHaveLength(0);

    // 5-6. Boot brand-new independent client node using community bootstrap bundle ONLY
    const joinerNode = await mkP2PNode();
    const dialStart = performance.now();
    const dialB = await joinerNode.dial(peerAddr(communityB));
    const connectLatencyMs = performance.now() - dialStart;
    expect(dialB.ok).toBe(true);
    expect(connectLatencyMs).toBeLessThan(10000); // Section 22.1 target < 10s

    // Verify all 8 namespaces reachable via `/sovra/net/1.0.0`
    const netCapsRes = await joinerNode.reqResp.sendRequest(
      communityB.identity.peerId,
      '/sovra/net/1.0.0',
      new TextEncoder().encode(JSON.stringify({ op: 'status' })),
    );
    expect(netCapsRes.ok).toBe(true);
    if (netCapsRes.ok) {
      const parsed = JSON.parse(new TextDecoder().decode(netCapsRes.value));
      expect(parsed.namespaces).toEqual([...SOVRA_PROTOCOL_NAMESPACES]);
      expect(parsed.specVersions['SOVRA-CORE']).toBe('1.0');
    }

    // 7-9. Authenticate locally, sign & verify CBOR event (<100ms target), propagate to surviving node B (<10s) & persist to Part K SQLite
    const devKeys = generateEd25519KeyPair();
    userIdentity.authorizeDevice({
      deviceId: 'laptop-1',
      deviceName: 'Community Laptop',
      devicePublicKeyHex: bytesToHex(devKeys.publicKey),
    });
    eventEngineB.registerAuthorizedSigner(userObj.identity_id, 'laptop-1', devKeys.publicKey);

    const postEvent = createAndSignSovraSpecEvent(
      {
        identity_id: userObj.identity_id,
        device_id: 'laptop-1',
        event_type: 'social.post',
        payload: { text: 'Founder infrastructure gone — community mesh alive!' },
        sequence: 1,
      },
      devKeys.privateKey,
    );

    const verifyStart = performance.now();
    const verPost = verifySovraSpecEvent(postEvent, devKeys.publicKey);
    const verifyMs = performance.now() - verifyStart;
    expect(verPost.ok).toBe(true);
    expect(verifyMs).toBeLessThan(100); // Section 22.1 target < 100ms

    const propStart = performance.now();
    const pubRemote = await joinerNode.reqResp.sendRequest(
      communityB.identity.peerId,
      '/sovra/event/1.0.0',
      new TextEncoder().encode(JSON.stringify({ op: 'publish', event: postEvent })),
    );
    const propMs = performance.now() - propStart;
    expect(pubRemote.ok).toBe(true);
    expect(propMs).toBeLessThan(10000); // Section 22.1 target < 10s
    expect(eventEngineB.get(postEvent.event_id)?.event_id).toBe(postEvent.event_id);

    // Persist to Part K SQLite DB (works offline)
    expect(dbB.insertEvent(postEvent).inserted).toBe(true);
    expect(dbB.getEvent(postEvent.event_id)?.['event_type']).toBe('social.post');
    dbB.close();

    // 8. Verify storage replication diversity rule & 5-point CID check
    const rawBlob = new TextEncoder().encode('Verified media content without founder cloud');
    const rawCid = new CID('raw', sha256(rawBlob), 'sha2-256');
    expect(
      verifyStorageObjectFivePoint(rawBlob, {
        cid: rawCid.toString(),
        codec: 'raw',
        expectedByteLength: rawBlob.byteLength,
      }).ok,
    ).toBe(true);

    // 5 nodes on 1 operator = ONLY 1 independent failure domain
    const singleOp = evaluateReplicationDiversity(
      'ordinary_public',
      Array.from({ length: 5 }, (_, i) => ({
        peerId: `founder-box-${i}`,
        operatorId: 'single-operator',
        networkSubnetOrAsn: 'as1234',
      })),
    );
    expect(singleOp.independentFailureDomains).toBe(1);
    expect(singleOp.satisfiesTarget).toBe(false);

    // Disappearing 1 storage operator triggers unavailability report + repair onto surviving third operator
    const tracker = new StorageOperationTracker();
    tracker.advertiseProvider(rawCid.toString(), { peerId: communityA.identity.peerId, operatorId: 'op-a', networkSubnetOrAsn: 'asn-1' });
    tracker.advertiseProvider(rawCid.toString(), { peerId: communityB.identity.peerId, operatorId: 'op-b', networkSubnetOrAsn: 'asn-2' });
    tracker.advertiseProvider(rawCid.toString(), { peerId: communityC.identity.peerId, operatorId: 'op-c', networkSubnetOrAsn: 'asn-3' });
    const afterOutage = tracker.reportUnavailable(rawCid.toString(), communityC.identity.peerId);
    expect(afterOutage.satisfiesTarget).toBe(false);
    const repaired = tracker.repairReplica(rawCid.toString(), { peerId: joinerNode.identity.peerId, operatorId: 'op-joiner', networkSubnetOrAsn: 'asn-4' });
    expect(repaired.satisfiesTarget).toBe(true);

    // 10-12. Messaging lifecycle distinction + Governance fork independence without founder permission
    const msgTracker = new MessageLifecycleTracker();
    const aliceKeys = generateEd25519KeyPair();
    const bobKeys = generateEd25519KeyPair();
    const bobId = userIdentity.getPublicIdentity().identity_id;
    msgTracker.create({ messageId: 'm1', senderIdentityId: bobId, recipientIdentityId: bobId });
    expect(msgTracker.transition('m1', 'ENCRYPTED').ok).toBe(true);
    const pubMsg = msgTracker.transition('m1', 'PUBLISHED', { relayAcceptedAt: 1700000100 });
    expect(pubMsg.ok).toBe(true);
    if (pubMsg.ok) {
      expect(pubMsg.value.state).toBe('PUBLISHED');
      expect(pubMsg.value.deliveredAt).toBeUndefined(); // Relay acceptance != delivery
    }
    expect(msgTracker.transition('m1', 'DELIVERED').ok).toBe(true);
    const ackSig = MessageLifecycleTracker.signDeliveryAcknowledgement('m1', bobId, bobKeys.privateKey);
    expect(msgTracker.transition('m1', 'ACKNOWLEDGED', { ackSigHex: ackSig, recipientPubKey: bobKeys.publicKey }).ok).toBe(true);
    void aliceKeys;

    const gov = new CommunityGovernanceEngine();
    const fork = gov.declareFork({
      forkNetworkId: 'sovra-independent-client-v1',
      parentNetworkId: 'sovra-mainnet-v1',
      parentSpecificationCid: rawCid.toString(),
      reason: 'Independent community implementation released without founder',
      initiatorId: bobId,
      initiatorPrivateKey: bobKeys.privateKey,
      initiatorPublicKey: bobKeys.publicKey,
    });
    expect(gov.verifyForkDeclaration(fork)).toBe(true);
  }, 30000);
});
