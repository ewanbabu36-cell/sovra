import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  canonicalCborDecode,
  canonicalCborEncode,
  createReleaseSignerRotation,
  generateEd25519KeyPair,
  getEd25519PublicKey,
  hexToBytes,
  sha256,
  signReleaseManifest,
  verifyAndApplyReleaseSignerRotation,
  verifyIndependentUpdateMirrors,
  verifySignedSoftwareRelease,
} from '@sovra/crypto';
import {
  CommunityGovernanceEngine,
  encodeSovraIdentityId,
} from '@sovra/identity';
import {
  AuthorizedORMap,
  DecoupledContributionAuditor,
  NoopNonTokenSettlementAdapter,
  ObservedRemoveSet,
  PART_K_REQUIRED_TABLES,
  RgaSequenceCrdt,
  SOVRA_EVENT_REGISTRY,
  SovraAppPermissionEngine,
  SovraCommerceEngine,
  SovraDocumentSyncEngine,
  SovraEventEngine,
  SovraNodeSqliteDatabase,
  createAndSignSovraSpecEvent,
  decodeSovraSpecEventCbor,
  encodeSovraSpecEventCbor,
  encodeUnsignedSovraSpecEventCbor,
  signBandwidthReceipt,
  validateSovraEventPayloadSchema,
  verifySovraSpecEvent,
} from '../src/index.js';

describe('Master Spec RFC 8949 CBOR, SOVRA-EVT, Part K DB, CRDTs, Commerce & Apps', () => {
  const VECTOR_PRIV = hexToBytes('0101010101010101010101010101010101010101010101010101010101010101');
  const VECTOR_PUB = getEd25519PublicKey(VECTOR_PRIV);
  const VECTOR_ID = 'sovra1qycxelj9jsrn35nxd08m46d5dlcp3tzjvgsmfhn99nfm2jq9s3tfch4gull';
  const EXPECTED_EVENT_ID = '9ffebb5e7067d4409b98987237f56061c3abb0a2f74d08fb28d97905868a911b';
  const EXPECTED_CBOR_HEX =
    'ab677061796c6f6164a36162026261616966697273745f76616c64746578747548656c6c6f20536f7665726569676e20576f726c646776657273696f6e016870726f746f636f6c65736f7672616873657175656e636501696465766963655f6964696465765f7665635f31696b65795f65706f6368016a637265617465645f61741a6553f10a6a6576656e745f747970656b736f6369616c2e706f73746a7265666572656e636573806b636f6e74656e745f636964f66b6964656e746974795f69647841736f7672613171796378656c6a396a73726e33356e786430386d34366435646c637033747a6a7667736d66686e39396e666d326a71397333746663683467756c6c';

  it('enforces RFC 8949 deterministic CBOR encoding & matches frozen SOVRA-EVT vector', () => {
    const enc1 = canonicalCborEncode({ zz: 1, a: 'hello', bb: [true, false, null, -5, new Uint8Array([1, 2])] });
    const enc2 = canonicalCborEncode({ bb: [true, false, null, -5, new Uint8Array([1, 2])], a: 'hello', zz: 1 });
    expect(bytesToHex(enc1)).toBe(bytesToHex(enc2));
    const decoded = canonicalCborDecode<any>(enc1, { strictDeterministic: true });
    expect(decoded.a).toBe('hello');
    expect(decoded.bb[3]).toBe(-5);

    const evt = createAndSignSovraSpecEvent(
      {
        identity_id: VECTOR_ID,
        device_id: 'dev_vec_1',
        event_type: 'social.post',
        payload: { b: 2, aa: 'first_val', text: 'Hello Sovereign World' },
        sequence: 1,
        key_epoch: 1,
        created_at: 1700000010,
        references: [],
        content_cid: null,
      },
      VECTOR_PRIV,
    );
    expect(bytesToHex(encodeUnsignedSovraSpecEventCbor(evt))).toBe(EXPECTED_CBOR_HEX);
    expect(evt.event_id).toBe(EXPECTED_EVENT_ID);
    const roundTrip = decodeSovraSpecEventCbor(encodeSovraSpecEventCbor(evt));
    expect(roundTrip.event_id).toBe(evt.event_id);
  });

  it('supports all 17 event types, unknown-optional forward compat, security-critical rejection, and tombstones', () => {
    expect(SOVRA_EVENT_REGISTRY).toHaveLength(17);
    const kp = generateEd25519KeyPair();
    const id = encodeSovraIdentityId(kp.publicKey);
    const engine = new SovraEventEngine();
    engine.registerAuthorizedSigner(id, 'dev_1', kp.publicKey);

    const post = engine.sign(
      engine.create({ identity_id: id, device_id: 'dev_1', event_type: 'social.post', payload: { text: 'Immutable' } }),
      kp.privateKey,
    );
    const p1 = engine.publish(post);
    expect(p1.ok).toBe(true);

    // Retract / Tombstone
    const del = engine.retract({
      targetEventId: post.event_id,
      identity_id: id,
      device_id: 'dev_1',
      signingPrivateKey: kp.privateKey,
    });
    expect(del.ok).toBe(true);
    expect(engine.isRetracted(post.event_id)).toBe(true);
    expect(engine.query({ include_retracted: false })).toHaveLength(1); // tombstone remains, retracted post filtered

    // Unknown optional event preserved safely
    const unknownOpt = createAndSignSovraSpecEvent(
      {
        identity_id: id,
        device_id: 'dev_1',
        event_type: 'app.custom_poll_v99',
        payload: { question: 'P2P?' },
        sequence: 3,
      },
      kp.privateKey,
    );
    const optRes = engine.publish(unknownOpt);
    expect(optRes.ok).toBe(true);
    if (optRes.ok) expect(optRes.value.status).toBe('ACCEPTED_UNKNOWN_OPTIONAL');

    // Unknown security-critical event fails closed
    const unknownCritical = createAndSignSovraSpecEvent(
      {
        identity_id: id,
        device_id: 'dev_1',
        event_type: 'identity.admin_backdoor',
        critical: true,
        payload: {},
        sequence: 4,
      },
      kp.privateKey,
    );
    expect(verifySovraSpecEvent(unknownCritical, kp.publicKey).ok).toBe(false);
  });

  it('implements Part K 14-table SQLite schema, duplicate/conflict protection, FK constraints, and index rebuild', async () => {
    const db = new SovraNodeSqliteDatabase(':memory:');
    await db.open();
    const tables = db.listTables();
    for (const required of PART_K_REQUIRED_TABLES) {
      expect(tables).toContain(required);
    }
    expect(db.getSchemaVersion()).toBe(1);

    const evt = createAndSignSovraSpecEvent(
      {
        identity_id: VECTOR_ID,
        device_id: 'dev_1',
        event_type: 'social.post',
        payload: { text: 'DB persisted' },
        sequence: 1,
      },
      VECTOR_PRIV,
    );
    expect(db.insertEvent(evt).inserted).toBe(true);
    expect(db.insertEvent(evt).duplicate).toBe(true);
    expect(() => db.insertEvent({ ...evt, signature: 'ff'.repeat(64) })).toThrow();

    const rebuilt = db.rebuildDerivedIndexes();
    expect(rebuilt).toBe(1);
    db.close();
  });

  it('converges OR-Set, OR-Map & RGA Sequence CRDTs, enforces commerce invariants, and sandboxes Apps & Governance forks', () => {
    // 1. OR-Set + RGA Sequence CRDT convergence under partition & out-of-order merge
    const setA = new ObservedRemoveSet<string>();
    const setB = new ObservedRemoveSet<string>();
    setA.add('tag-mesh', 'alice');
    setB.add('tag-offline', 'bob');
    setA.merge(setB);
    setB.merge(setA);
    expect(setA.values()).toEqual(['tag-mesh', 'tag-offline']);
    expect(setA.values()).toEqual(setB.values());

    const cart1 = new AuthorizedORMap();
    const cart2 = new AuthorizedORMap();
    cart1.setItemQuantity('tea', 2, 'alice');
    cart2.setItemQuantity('coffee', 1, 'alice');
    cart1.merge(cart2);
    expect(cart1.getActiveItems()).toEqual({ coffee: 1, tea: 2 });

    const doc1 = new RgaSequenceCrdt();
    const doc2 = new RgaSequenceCrdt();
    const n1 = doc1.insert(null, 'Hello', 'alice');
    doc2.applyRemoteNode(n1);
    const n2a = doc1.insert(n1.id, ' World', 'alice');
    const n2b = doc2.insert(n1.id, '!', 'bob');
    doc1.merge(doc2);
    doc2.merge(doc1);
    expect(doc1.renderText()).toBe(doc2.renderText());
    expect(doc1.renderText().includes('Hello')).toBe(true);
    doc1.deleteNode(n2a.id);
    doc2.merge(doc1);
    expect(doc2.renderText()).toBe('Hello!');
    void n2b;

    // Signed CRDT Sync Engine
    const kp = generateEd25519KeyPair();
    const sync = new SovraDocumentSyncEngine();
    sync.openDocument('doc_1', 'or-set');
    const ch = SovraDocumentSyncEngine.signChange(
      {
        document_id: 'doc_1',
        document_type: 'or-set',
        actor_id: VECTOR_ID,
        lamport: 1,
        dependencies: [],
        payload: { op: 'add', value: 'p2p' },
      },
      kp.privateKey,
    );
    expect(sync.applyChange('doc_1', ch, kp.publicKey).ok).toBe(true);
    expect(sync.resolveConflict('doc_1')).toEqual(['p2p']);

    // 2. Commerce State Machine (non-LWW inventory protection)
    const seller = generateEd25519KeyPair();
    const buyer = generateEd25519KeyPair();
    const sellerId = encodeSovraIdentityId(seller.publicKey);
    const buyerId = encodeSovraIdentityId(buyer.publicKey);
    const commerce = new SovraCommerceEngine();

    expect(
      commerce.processCommerceEvent(
        createAndSignSovraSpecEvent(
          { identity_id: sellerId, device_id: 'd1', event_type: 'business.create', payload: { businessId: 'biz_tea', name: 'Mountain Tea' }, sequence: 1 },
          seller.privateKey,
        ),
      ).ok,
    ).toBe(true);
    expect(commerce.getBusiness('biz_tea')?.verifiedByFounderAccount).toBe(false);

    commerce.processCommerceEvent(
      createAndSignSovraSpecEvent(
        { identity_id: sellerId, device_id: 'd1', event_type: 'market.listing', payload: { listingId: 'item_1', title: 'Green Tea', availableInventory: 2, priceUnits: 100, currencyOrUnit: 'INR' }, sequence: 2 },
        seller.privateKey,
      ),
    );
    expect(
      commerce.processCommerceEvent(
        createAndSignSovraSpecEvent(
          { identity_id: buyerId, device_id: 'd2', event_type: 'market.order', payload: { orderId: 'ord_1', listingId: 'item_1', quantity: 2 }, sequence: 1 },
          buyer.privateKey,
        ),
      ).ok,
    ).toBe(true);
    // Reject overselling beyond remaining inventory (0 remaining)
    expect(
      commerce.processCommerceEvent(
        createAndSignSovraSpecEvent(
          { identity_id: buyerId, device_id: 'd2', event_type: 'market.order', payload: { orderId: 'ord_2', listingId: 'item_1', quantity: 1 }, sequence: 2 },
          buyer.privateKey,
        ),
      ).ok,
    ).toBe(false);

    // 3. App Sandboxing blocking private key requests
    const appAuthor = generateEd25519KeyPair();
    expect(() =>
      SovraAppPermissionEngine.createSignedManifest(
        {
          version: 1,
          appId: 'evil.app',
          appName: 'Evil',
          appVersion: '1.0.0',
          minProtocolVersion: '1.0',
          authorIdentityId: encodeSovraIdentityId(appAuthor.publicKey),
          authorPublicKeyHex: bytesToHex(appAuthor.publicKey),
          requestedCapabilities: ['identity.export_private_key'],
          artifactCid: 'bafkreievil',
          sandboxed: true,
        },
        appAuthor.privateKey,
      ),
    ).toThrow();

    const goodManifest = SovraAppPermissionEngine.createSignedManifest(
      {
        version: 1,
        appId: 'reader.app',
        appName: 'Reader',
        appVersion: '1.0.0',
        minProtocolVersion: '1.0',
        authorIdentityId: encodeSovraIdentityId(appAuthor.publicKey),
        authorPublicKeyHex: bytesToHex(appAuthor.publicKey),
        requestedCapabilities: ['social.read', 'social.post'],
        artifactCid: 'bafkreireader',
        sandboxed: true,
      },
      appAuthor.privateKey,
    );
    const appEng = new SovraAppPermissionEngine();
    const grant = appEng.grantToApp({
      manifest: goodManifest,
      userIdentityId: buyerId,
      userPrivateKey: buyer.privateKey,
      userPublicKey: buyer.publicKey,
      approvedCapabilities: ['social.read'],
    });
    expect(appEng.authorizeAppAction(grant.grantId, 'social.read').ok).toBe(true);
    expect(appEng.authorizeAppAction(grant.grantId, 'social.post').ok).toBe(false);
    expect(appEng.authorizeAppAction(grant.grantId, 'identity.export_private_key').ok).toBe(false);
    appEng.revokeGrant(grant.grantId);
    expect(appEng.authorizeAppAction(grant.grantId, 'social.read').ok).toBe(false);

    // 4. Community Governance v1.0 & Fork Rights (token-free!)
    const gov = new CommunityGovernanceEngine();
    const prop = gov.createProposal({
      category: 'SOVRA-P',
      title: 'Add streaming block prefetching',
      specificationCid: 'bafkreiprop1',
      authorId: sellerId,
      authorPublicKeyHex: bytesToHex(seller.publicKey),
      backwardCompatibilityNotes: 'Minor extension; optional stream ID',
      securityConsiderations: 'Bounded chunk limits enforced',
    });
    gov.advanceToDiscussion(prop.proposalId);
    gov.advanceToReview(prop.proposalId);
    gov.submitReview({
      proposalId: prop.proposalId,
      reviewerId: buyerId,
      reviewerPrivateKey: buyer.privateKey,
      reviewerPublicKey: buyer.publicKey,
      backwardCompatible: true,
      securityReviewed: true,
      approved: true,
      notes: 'Clean review',
    });
    gov.castVote({
      proposalId: prop.proposalId,
      voterId: buyerId,
      voterPrivateKey: buyer.privateKey,
      voterPublicKey: buyer.publicKey,
      decision: 'YES',
    });
    const res = gov.finalizeDecision(prop.proposalId);
    expect(res.stage).toBe('ACCEPTED');
    gov.recordImplementation(prop.proposalId, 'bafkreiimpl1');
    gov.publishRelease(prop.proposalId, [
      { maintainerId: sellerId, privateKey: seller.privateKey, publicKey: seller.publicKey },
      { maintainerId: buyerId, privateKey: buyer.privateKey, publicKey: buyer.publicKey },
    ]);
    expect(gov.getProposal(prop.proposalId)?.stage).toBe('RELEASE');

    const fork = gov.declareFork({
      forkNetworkId: 'sovra-community-fork-1',
      parentNetworkId: 'sovra-mainnet-v1',
      parentSpecificationCid: 'bafkreiprop1',
      reason: 'Preserve zero-token social baseline',
      initiatorId: buyerId,
      initiatorPrivateKey: buyer.privateKey,
      initiatorPublicKey: buyer.publicKey,
    });
    expect(gov.verifyForkDeclaration(fork)).toBe(true);
  });

  it('IA-01 Sec 6, 7 & 8: versioned event schemas, decoupled zero-token contribution auditing, mirrors & signer key recovery', async () => {
    // 1. Versioned event payload schemas reject missing fields or unsupported schemaVersion
    expect(validateSovraEventPayloadSchema('social.post', { text: 'Valid post' }).valid).toBe(true);
    expect(validateSovraEventPayloadSchema('social.post', { schemaVersion: 1, text: 'Valid v1' }).valid).toBe(true);
    expect(validateSovraEventPayloadSchema('social.post', { schemaVersion: 99, text: 'Bad ver' }).valid).toBe(false);
    expect(validateSovraEventPayloadSchema('social.post', { wrongField: true }).valid).toBe(false);

    // 2. Decoupled zero-token seeder contribution auditing
    const dl = generateEd25519KeyPair();
    const adapter = new NoopNonTokenSettlementAdapter();
    const auditor = new DecoupledContributionAuditor(adapter);
    const validRcpt = signBandwidthReceipt(
      { receiptId: 'ia01-r1', contentCid: 'bafy1', seederDid: 'sovra1seeder', downloaderDid: 'sovra1dl', bytesServed: 10240, totalMediaBytes: 20480, timestamp: Date.now() },
      dl.privateKey,
    );
    const recRes = await auditor.recordReceipt(validRcpt, dl.publicKey);
    expect(recRes.accepted).toBe(true);
    expect(adapter.auditTrail).toHaveLength(1);
    expect((await auditor.recordReceipt(validRcpt, dl.publicKey)).accepted).toBe(false); // Replay rejected
    expect((await auditor.recordReceipt({ ...validRcpt, receiptId: 'ia01-self', downloaderDid: 'sovra1seeder' }, dl.publicKey)).accepted).toBe(false);

    // 3. M-of-N software update mirrors, reproducible build provenance & compromised signer recovery
    const signers = Array.from({ length: 4 }, () => generateEd25519KeyPair());
    const trusted = signers.map((s) => bytesToHex(s.publicKey));
    const replacement = generateEd25519KeyPair();
    const artifact = new TextEncoder().encode('IA-01 Reproducible Binary Artifact');
    const manifestBody = {
      version: '2.2.0',
      minCompatibleVersion: '2.0.0',
      protocolVersion: 2,
      platform: 'node-daemon' as const,
      artifactCid: 'bafkreiupd220',
      artifactSha256Hex: bytesToHex(sha256(artifact)),
      byteLength: artifact.byteLength,
      issuedAt: Math.floor(Date.now() / 1000),
      signerThreshold: 2,
      reproducibleBuild: {
        sourceCommitHex: 'a'.repeat(40),
        buildRecipeHashHex: 'b'.repeat(64),
      },
      mirrors: [
        { operatorId: 'mirror-eu', uri: 'ipfs://bafkreiupd220' },
        { operatorId: 'mirror-ap', uri: 'https://mirror.example.org/sovra-2.2.0.tgz' },
      ],
    };
    const signedManifest = {
      ...manifestBody,
      signatures: [0, 1].map((i) => signReleaseManifest(manifestBody, signers[i]!.privateKey, signers[i]!.publicKey)),
    };
    expect(verifyIndependentUpdateMirrors(signedManifest, 2).valid).toBe(true);
    expect(verifyIndependentUpdateMirrors(signedManifest, 3).valid).toBe(false);
    expect(verifySignedSoftwareRelease(signedManifest, { trustedSignerPubKeysHex: trusted, currentVersion: '2.0.0', minimumThreshold: 2 }, artifact).valid).toBe(true);

    // Signer 0 compromised -> Signer 1 & 2 (threshold 2) rotate out Signer 0 and induct replacement without Signer 0 participating
    const badAttempt = createReleaseSignerRotation(
      { revokedPubKeysHex: [trusted[0]!], addedPubKeysHex: [bytesToHex(replacement.publicKey)], issuedAt: Math.floor(Date.now() / 1000), sequence: 1 },
      [{ privateKey: signers[0]!.privateKey, publicKey: signers[0]!.publicKey }, { privateKey: signers[1]!.privateKey, publicKey: signers[1]!.publicKey }],
    );
    expect(verifyAndApplyReleaseSignerRotation(badAttempt, trusted, 2).valid).toBe(false);

    const goodRot = createReleaseSignerRotation(
      { revokedPubKeysHex: [trusted[0]!], addedPubKeysHex: [bytesToHex(replacement.publicKey)], issuedAt: Math.floor(Date.now() / 1000), sequence: 1 },
      [{ privateKey: signers[1]!.privateKey, publicKey: signers[1]!.publicKey }, { privateKey: signers[2]!.privateKey, publicKey: signers[2]!.publicKey }],
    );
    const applied = verifyAndApplyReleaseSignerRotation(goodRot, trusted, 2);
    expect(applied.valid).toBe(true);
    expect(applied.nextTrustedPubKeysHex).not.toContain(trusted[0]);
    expect(applied.nextTrustedPubKeysHex).toContain(bytesToHex(replacement.publicKey));
  });
});
