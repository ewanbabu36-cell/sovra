import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateEd25519KeyPair, bytesToHex } from '@sovra/crypto';
import {
  UnsignedProtocolEvent,
  SovraProtocolEvent,
  createSignedProtocolEvent,
  verifyProtocolEventIntegrity,
  computeProtocolEventId,
  canonicalizeUnsignedProtocolEvent,
  isProtocolVersionSupported,
  ProtocolAuthorizationEngine,
  DurableReplayStore,
  DurableEventStore,
  EventValidationPipeline,
  StateTransitionEngine,
  wrapInTransportEnvelope,
  relayTransportEnvelope,
  serializeTransportEnvelope,
  deserializeTransportEnvelope,
  PeerRegistry,
} from '../src/index.js';

describe('Phase 1: Core Protocol Contract & Deterministic Verification', () => {
  let tempDir: string;
  let storeFile: string;
  let replayFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-proto-test-'));
    storeFile = path.join(tempDir, 'events.log');
    replayFile = path.join(tempDir, 'replay.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function createTestIdentity() {
    const kp = generateEd25519KeyPair();
    const pubkeyHex = bytesToHex(kp.publicKey);
    return {
      pubkeyHex,
      did: `did:key:${pubkeyHex}`,
      privateKey: kp.privateKey,
    };
  }

  function makeUnsignedEvent<T>(
    author: ReturnType<typeof createTestIdentity>,
    eventType: string,
    payload: T,
    options?: {
      object?: { id: string; type: string; ownerDid?: string };
      capability?: string;
      nonce?: string;
      sequence?: number;
      createdAt?: number;
      expiresAt?: number;
    },
  ): UnsignedProtocolEvent<T> {
    return {
      protocolVersion: { major: 1, minor: 0 },
      eventType,
      author: {
        did: author.did,
        deviceId: 'dev-alpha',
        pubkeyHex: author.pubkeyHex,
      },
      object: options?.object,
      parents: [],
      logicalClock: { sequence: options?.sequence ?? 1 },
      nonce: options?.nonce ?? `nonce-${Date.now()}-${Math.random()}`,
      createdAt: options?.createdAt ?? Math.floor(Date.now() / 1000),
      expiresAt: options?.expiresAt,
      payload,
      capability: options?.capability,
    };
  }

  // ==========================================
  // 1. CANONICAL SERIALIZATION & DETERMINISTIC ID
  // ==========================================
  describe('Canonical Serialization & Deterministic Event ID', () => {
    it('produces bit-for-bit identical canonical bytes and event ID regardless of object key order', () => {
      const author = createTestIdentity();

      const rawA: UnsignedProtocolEvent = {
        protocolVersion: { major: 1, minor: 0 },
        eventType: 'post.create',
        author: { did: author.did, deviceId: 'dev-1', pubkeyHex: author.pubkeyHex },
        parents: ['ev-2', 'ev-1'], // Out of order parents
        logicalClock: { sequence: 1 },
        nonce: 'nonce-123',
        createdAt: 1000,
        payload: { title: 'First Post', z_index: 99, a_tag: 'test' },
      };

      const rawB: UnsignedProtocolEvent = {
        payload: { a_tag: 'test', z_index: 99, title: 'First Post' }, // Inverted key order
        nonce: 'nonce-123',
        createdAt: 1000,
        eventType: 'post.create',
        parents: ['ev-1', 'ev-2'], // Inverted parents
        author: { pubkeyHex: author.pubkeyHex, did: author.did, deviceId: 'dev-1' }, // Inverted author keys
        protocolVersion: { minor: 0, major: 1 },
        logicalClock: { sequence: 1 },
      };

      const canonicalA = canonicalizeUnsignedProtocolEvent(rawA);
      const canonicalB = canonicalizeUnsignedProtocolEvent(rawB);

      expect(canonicalA).toBe(canonicalB);

      const idA = computeProtocolEventId(rawA);
      const idB = computeProtocolEventId(rawB);

      expect(idA).toBe(idB);
      expect(idA.length).toBe(64); // 32-byte hex SHA-256
    });

    it('alters event ID upon any field mutation', () => {
      const author = createTestIdentity();
      const base = makeUnsignedEvent(author, 'post.create', { content: 'hello' }, { nonce: 'n-1', createdAt: 1000 });
      const baseId = computeProtocolEventId(base);

      // Mutate payload
      const mPayload = { ...base, payload: { content: 'hello world' } };
      expect(computeProtocolEventId(mPayload)).not.toBe(baseId);

      // Mutate timestamp
      const mTime = { ...base, createdAt: 1001 };
      expect(computeProtocolEventId(mTime)).not.toBe(baseId);

      // Mutate nonce
      const mNonce = { ...base, nonce: 'n-2' };
      expect(computeProtocolEventId(mNonce)).not.toBe(baseId);

      // Mutate capability
      const mCap = { ...base, capability: 'admin.manage' };
      expect(computeProtocolEventId(mCap)).not.toBe(baseId);

      // Mutate sequence
      const mSeq = { ...base, logicalClock: { sequence: 2 } };
      expect(computeProtocolEventId(mSeq)).not.toBe(baseId);
    });
  });

  // ==========================================
  // 2. SIGNATURE MODEL & ADVERSARIAL MUTATIONS
  // ==========================================
  describe('Signature Model & Adversarial Mutation Resistance', () => {
    it('verifies untampered signed protocol event', () => {
      const author = createTestIdentity();
      const unsigned = makeUnsignedEvent(author, 'post.create', { text: 'Verified' });
      const signed = createSignedProtocolEvent(unsigned, author.privateKey);

      const result = verifyProtocolEventIntegrity(signed);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(true);
    });

    it('strictly rejects event where payload was tampered with after signing', () => {
      const author = createTestIdentity();
      const unsigned = makeUnsignedEvent(author, 'post.create', { text: 'Legitimate text' });
      const signed = createSignedProtocolEvent(unsigned, author.privateKey);

      // Attacker tampers with payload without private key
      const tampered: SovraProtocolEvent = {
        ...signed,
        payload: { text: 'Malicious forged text' },
      };

      const result = verifyProtocolEventIntegrity(tampered);
      expect(result.ok).toBe(false);
      expect(result.error.protocolCode).toBe('MALFORMED');
    });

    it('strictly rejects event with tampered author public key', () => {
      const author = createTestIdentity();
      const imposter = createTestIdentity();

      const unsigned = makeUnsignedEvent(author, 'post.create', { text: 'Authentic' });
      const signed = createSignedProtocolEvent(unsigned, author.privateKey);

      // Imposter replaces author pubkey with their own
      const tampered: SovraProtocolEvent = {
        ...signed,
        author: {
          ...signed.author,
          pubkeyHex: imposter.pubkeyHex,
          did: imposter.did,
        },
      };

      const result = verifyProtocolEventIntegrity(tampered);
      expect(result.ok).toBe(false);
    });

    it('strictly rejects signature generated by wrong private key', () => {
      const author = createTestIdentity();
      const attacker = createTestIdentity();

      const unsigned = makeUnsignedEvent(author, 'post.create', { text: 'Impersonated' });
      // Attacker signs author's event with attacker's private key
      const fakeSigned = createSignedProtocolEvent(unsigned, attacker.privateKey);

      // But event.author still claims to be author
      const result = verifyProtocolEventIntegrity(fakeSigned);
      expect(result.ok).toBe(false);
      expect(result.error.protocolCode).toBe('INVALID_SIGNATURE');
    });
  });

  // ==========================================
  // 3. AUTHORIZATION & CAPABILITY ENGINE
  // ==========================================
  describe('Authorization & Capability Engine', () => {
    it('authorizes principal with required capability on owned object', async () => {
      const author = createTestIdentity();
      const engine = new ProtocolAuthorizationEngine({
        stateProvider: {
          getObjectState: () => ({ id: 'post-100', type: 'post', ownerDid: author.did }),
          getPrincipal: () => ({ principalDid: author.did, grantedCapabilities: new Set(['post.edit']) }),
          isDeviceRevoked: () => false,
        },
      });

      const unsigned = makeUnsignedEvent(
        author,
        'post.edit',
        { content: 'Updated post body' },
        { object: { id: 'post-100', type: 'post', ownerDid: author.did } },
      );
      const signed = createSignedProtocolEvent(unsigned, author.privateKey);

      const auth = await engine.authorizeEvent(signed);
      expect(auth.isAuthorized).toBe(true);
      expect(auth.decision).toBe('AUTHORIZED');
    });

    it('rejects mutation when principal lacks required capability (INVALID_CAPABILITY)', async () => {
      const author = createTestIdentity();
      const engine = new ProtocolAuthorizationEngine({
        stateProvider: {
          getObjectState: () => ({ id: 'post-100', type: 'post', ownerDid: author.did }),
          getPrincipal: () => ({ principalDid: author.did, grantedCapabilities: new Set(['post.create']) }), // Missing post.delete
          isDeviceRevoked: () => false,
        },
      });

      const unsigned = makeUnsignedEvent(
        author,
        'post.delete',
        { reason: 'User requested' },
        { object: { id: 'post-100', type: 'post', ownerDid: author.did } },
      );
      const signed = createSignedProtocolEvent(unsigned, author.privateKey);

      const auth = await engine.authorizeEvent(signed);
      expect(auth.isAuthorized).toBe(false);
      expect(auth.decision).toBe('INVALID_CAPABILITY');
    });

    it('rejects mutation when principal is not the object owner (NOT_OWNER)', async () => {
      const alice = createTestIdentity();
      const bob = createTestIdentity();

      const engine = new ProtocolAuthorizationEngine({
        stateProvider: {
          getObjectState: () => ({ id: 'post-100', type: 'post', ownerDid: bob.did }), // Bob owns post
          getPrincipal: () => ({ principalDid: alice.did, grantedCapabilities: new Set(['post.edit']) }),
          isDeviceRevoked: () => false,
        },
      });

      // Alice attempts to edit Bob's post
      const unsigned = makeUnsignedEvent(
        alice,
        'post.edit',
        { content: 'Defaced content' },
        { object: { id: 'post-100', type: 'post', ownerDid: bob.did } },
      );
      const signed = createSignedProtocolEvent(unsigned, alice.privateKey);

      const auth = await engine.authorizeEvent(signed);
      expect(auth.isAuthorized).toBe(false);
      expect(auth.decision).toBe('NOT_OWNER');
    });

    it('rejects mutation on deleted or tombstoned object (INVALID_STATE)', async () => {
      const author = createTestIdentity();
      const engine = new ProtocolAuthorizationEngine({
        stateProvider: {
          getObjectState: () => ({ id: 'post-100', type: 'post', ownerDid: author.did, isDeleted: true }),
          getPrincipal: () => ({ principalDid: author.did, grantedCapabilities: new Set(['post.edit']) }),
          isDeviceRevoked: () => false,
        },
      });

      const unsigned = makeUnsignedEvent(
        author,
        'post.edit',
        { content: 'Revive deleted post' },
        { object: { id: 'post-100', type: 'post' } },
      );
      const signed = createSignedProtocolEvent(unsigned, author.privateKey);

      const auth = await engine.authorizeEvent(signed);
      expect(auth.isAuthorized).toBe(false);
      expect(auth.decision).toBe('INVALID_STATE');
    });

    it('rejects operation from revoked device (INVALID_IDENTITY)', async () => {
      const author = createTestIdentity();
      const engine = new ProtocolAuthorizationEngine({
        stateProvider: {
          getObjectState: () => null,
          getPrincipal: () => ({ principalDid: author.did, grantedCapabilities: new Set(['post.create']) }),
          isDeviceRevoked: (authorDid, deviceId) => deviceId === 'dev-compromised',
        },
      });

      const unsigned: UnsignedProtocolEvent = {
        ...makeUnsignedEvent(author, 'post.create', { content: 'from lost phone' }),
        author: {
          did: author.did,
          deviceId: 'dev-compromised', // Revoked device
          pubkeyHex: author.pubkeyHex,
        },
      };
      const signed = createSignedProtocolEvent(unsigned, author.privateKey);

      const auth = await engine.authorizeEvent(signed);
      expect(auth.isAuthorized).toBe(false);
      expect(auth.decision).toBe('INVALID_IDENTITY');
      expect(auth.reason).toContain('revoked');
    });
  });

  // ==========================================
  // 4. REPLAY PROTECTION & DURABILITY
  // ==========================================
  describe('Replay Protection & Durable Persistence', () => {
    it('rejects duplicate event submission and reused nonces', async () => {
      const author = createTestIdentity();
      const replayStore = new DurableReplayStore({ filePath: replayFile });
      const engine = new ProtocolAuthorizationEngine({ replayStore });

      const unsigned = makeUnsignedEvent(author, 'post.create', { content: 'test' }, { nonce: 'nonce-1' });
      const signed = createSignedProtocolEvent(unsigned, author.privateKey);

      // First submission succeeds
      const first = await engine.authorizeEvent(signed);
      expect(first.isAuthorized).toBe(true);

      // Replayed submission with identical event ID is rejected
      const second = await engine.authorizeEvent(signed);
      expect(second.isAuthorized).toBe(false);
      expect(second.decision).toBe('REPLAY');

      // Reused nonce with different content is also rejected
      const reusedNonceUnsigned = makeUnsignedEvent(author, 'post.create', { content: 'different' }, { nonce: 'nonce-1' });
      const reusedNonceSigned = createSignedProtocolEvent(reusedNonceUnsigned, author.privateKey);

      const third = await engine.authorizeEvent(reusedNonceSigned);
      expect(third.isAuthorized).toBe(false);
      expect(third.decision).toBe('REPLAY');
    });

    it('survives process restart with persisted replay state', async () => {
      const author = createTestIdentity();

      // Instance A records an event and saves to disk
      const storeA = new DurableReplayStore({ filePath: replayFile });
      const unsigned = makeUnsignedEvent(author, 'post.create', { content: 'persisted' }, { nonce: 'persistent-nonce' });
      const signed = createSignedProtocolEvent(unsigned, author.privateKey);

      const engineA = new ProtocolAuthorizationEngine({ replayStore: storeA });
      expect((await engineA.authorizeEvent(signed)).isAuthorized).toBe(true);
      storeA.save();

      // Instance B starts afresh after restart
      const storeB = new DurableReplayStore({ filePath: replayFile });
      const engineB = new ProtocolAuthorizationEngine({ replayStore: storeB });

      // Replaying event against Instance B must be REJECTED!
      const replayed = await engineB.authorizeEvent(signed);
      expect(replayed.isAuthorized).toBe(false);
      expect(replayed.decision).toBe('REPLAY');
    });

    it('rejects events with timestamps outside clock drift window', async () => {
      const author = createTestIdentity();
      const engine = new ProtocolAuthorizationEngine({ maxClockDriftSeconds: 300 });

      const now = Math.floor(Date.now() / 1000);

      // Event from 1 hour in the past
      const past = makeUnsignedEvent(author, 'post.create', { content: 'old' }, { createdAt: now - 3600 });
      const pastSigned = createSignedProtocolEvent(past, author.privateKey);
      expect((await engine.authorizeEvent(pastSigned, now)).decision).toBe('EXPIRED');

      // Event from 1 hour in the future
      const future = makeUnsignedEvent(author, 'post.create', { content: 'future' }, { createdAt: now + 3600 });
      const futureSigned = createSignedProtocolEvent(future, author.privateKey);
      expect((await engine.authorizeEvent(futureSigned, now)).decision).toBe('EXPIRED');
    });
  });

  // ==========================================
  // 5. DURABLE EVENT STORE & CORRUPTION DETECTION
  // ==========================================
  describe('Durable Event Store & Crash Recovery', () => {
    it('appends events, persists to disk, and restores on restart', async () => {
      const author = createTestIdentity();
      const storeA = new DurableEventStore({ filePath: storeFile });

      const ev1 = createSignedProtocolEvent(
        makeUnsignedEvent(author, 'post.create', { text: 'Event 1' }),
        author.privateKey,
      );
      const ev2 = createSignedProtocolEvent(
        makeUnsignedEvent(author, 'post.create', { text: 'Event 2' }),
        author.privateKey,
      );

      await storeA.append(ev1);
      await storeA.append(ev2);

      expect(storeA.getCount()).toBe(2);

      // Checkpoint verification
      const cpA = await storeA.checkpoint();
      expect(cpA.totalEvents).toBe(2);
      expect(cpA.latestEventId).toBe(ev2.eventId);
      expect(cpA.stateHash.length).toBe(64);

      // Restart into storeB
      const storeB = new DurableEventStore({ filePath: storeFile });
      expect(storeB.getCount()).toBe(2);

      const retrieved1 = await storeB.get(ev1.eventId);
      expect(retrieved1?.eventId).toBe(ev1.eventId);

      const cpB = await storeB.checkpoint();
      expect(cpB.stateHash).toBe(cpA.stateHash); // Bit-for-bit identical state projection
    });

    it('detects on-disk cryptographic corruption and raises StorageFailureError', async () => {
      const author = createTestIdentity();
      const store = new DurableEventStore({ filePath: storeFile });

      const ev = createSignedProtocolEvent(
        makeUnsignedEvent(author, 'post.create', { text: 'Original bytes' }),
        author.privateKey,
      );
      await store.append(ev);

      // Maliciously tamper with the stored file directly on disk
      const content = fs.readFileSync(storeFile, 'utf8');
      const tamperedContent = content.replace('Original bytes', 'Corrupted bytes');
      fs.writeFileSync(storeFile, tamperedContent, 'utf8');

      // Fresh store loads corrupted file
      const storeTampered = new DurableEventStore({ filePath: storeFile });
      // Event with mismatched hash must NOT be returned as valid
      expect(await storeTampered.exists(ev.eventId)).toBe(false);
    });
  });

  // ==========================================
  // 6. STATE TRANSITION ENGINE
  // ==========================================
  describe('Deterministic State Transition Engine', () => {
    interface CounterState {
      totalPosts: number;
      lastAuthor?: string;
    }

    it('applies events through validation and executes pure deterministic transition', async () => {
      const author = createTestIdentity();

      const initialState: CounterState = { totalPosts: 0 };
      const reducer = (state: CounterState, ev: SovraProtocolEvent) => {
        if (ev.eventType === 'post.create') {
          return {
            ok: true as const,
            value: {
              nextState: {
                totalPosts: state.totalPosts + 1,
                lastAuthor: ev.author.did,
              },
            },
          };
        }
        return { ok: true as const, value: { nextState: state } };
      };

      const engine = new StateTransitionEngine(initialState, reducer);

      const ev1 = createSignedProtocolEvent(makeUnsignedEvent(author, 'post.create', { msg: '1' }), author.privateKey);
      const res1 = await engine.apply(ev1);

      expect(res1.ok).toBe(true);
      expect(engine.getState().totalPosts).toBe(1);
      expect(engine.getState().lastAuthor).toBe(author.did);

      // Re-applying same event is rejected by replay protection (does not double count)
      const resDuplicate = await engine.apply(ev1);
      expect(resDuplicate.ok).toBe(false);
      expect(engine.getState().totalPosts).toBe(1);
    });

    it('rejects invalid event and leaves current state untouched', async () => {
      const author = createTestIdentity();
      const initialState: CounterState = { totalPosts: 10 };
      const engine = new StateTransitionEngine(initialState, (s, e) => ({ ok: true as const, value: { nextState: s } }));

      // Invalid candidate with missing signature
      const invalid = { eventId: 'fake', eventType: 'post.create' };
      const res = await engine.apply(invalid);

      expect(res.ok).toBe(false);
      expect(engine.getState().totalPosts).toBe(10); // State preserved!
    });
  });

  // ==========================================
  // 7. TRANSPORT-NEUTRAL ENVELOPE & MULTI-TRANSPORT
  // ==========================================
  describe('Transport-Neutral Envelope & Multi-Transport Invariance', () => {
    it('maintains identical protocol semantics when sent via Local, BLE, or TCP', () => {
      const author = createTestIdentity();
      const event = createSignedProtocolEvent(makeUnsignedEvent(author, 'post.create', { msg: 'Transport neutral' }), author.privateKey);

      // 1. Wrap for Local Transport
      const localEnv = wrapInTransportEnvelope(event, 'peer-local', 'LOCAL');
      expect(localEnv.transportType).toBe('LOCAL');
      expect(localEnv.event.eventId).toBe(event.eventId);

      // 2. Wrap for BLE Mesh Transport
      const bleEnv = wrapInTransportEnvelope(event, 'peer-ble-node-1', 'BLE', { maxHops: 5 });
      expect(bleEnv.transportType).toBe('BLE');
      expect(bleEnv.maxHops).toBe(5);

      // Simulate multi-hop relay
      const relayed = relayTransportEnvelope(bleEnv, 'peer-ble-node-2');
      expect(relayed).not.toBeNull();
      expect(relayed?.hopCount).toBe(1);
      expect(relayed?.relayedBy).toContain('peer-ble-node-2');

      // 3. Serialize and deserialize over wire
      const wireBytes = serializeTransportEnvelope(relayed!);
      const unpacked = deserializeTransportEnvelope(wireBytes);

      expect(unpacked.event.eventId).toBe(event.eventId);
      expect(verifyProtocolEventIntegrity(unpacked.event).ok).toBe(true);
    });
  });

  // ==========================================
  // 8. PEER REGISTRY & PROTOCOL VERSIONING
  // ==========================================
  describe('Peer Registry & Protocol Versioning', () => {
    it('tracks peer descriptors independent of physical network addresses', () => {
      const registry = new PeerRegistry();

      registry.registerPeer({
        peerId: '12D3KooWTestPeer',
        userDid: 'did:key:zUser',
        supportedProtocolVersions: ['1.0'],
        supportedTransports: ['BLE', 'TCP', 'WEBRTC'],
        capabilities: ['social:write', 'knowledge:write'],
        lastSeen: Date.now(),
        trustState: 'VERIFIED',
        connectionState: 'CONNECTED',
        activeTransports: ['BLE', 'TCP'],
      });

      const peer = registry.getPeer('12D3KooWTestPeer');
      expect(peer).toBeDefined();
      expect(peer?.supportedTransports).toContain('BLE');
      expect(peer?.trustState).toBe('VERIFIED');
    });

    it('enforces protocol version compatibility', () => {
      expect(isProtocolVersionSupported({ major: 1, minor: 0 })).toBe(true);
      expect(isProtocolVersionSupported({ major: 1, minor: 1 })).toBe(false); // Unknown minor
      expect(isProtocolVersionSupported({ major: 2, minor: 0 })).toBe(false); // Incompatible major
    });
  });
});
