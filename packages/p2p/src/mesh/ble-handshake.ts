/**
 * @file packages/p2p/src/mesh/ble-handshake.ts
 * Mutual Cryptographic Handshake & Forward-Secure Session Establishment over BLE.
 *
 * Implements:
 * 1. Mutual identity authentication using Ed25519 identity keys.
 * 2. Ephemeral X25519 Diffie-Hellman key exchange for forward secrecy.
 * 3. Fresh challenge nonces preventing replay attacks.
 * 4. HKDF-SHA256 derivation of distinct ChaCha20-Poly1305 tx/rx cipher keys.
 * 5. Session expiration & key confirmation.
 */

import {
  generateX25519KeyPair,
  diffieHellmanX25519,
  hkdfDerive,
  sha256,
  signEd25519,
  verifyEd25519,
  bytesToHex,
  hexToBytes,
  secureRandomBytes,
  encryptChaCha20Poly1305,
  decryptChaCha20Poly1305,
} from '@sovra/crypto';
import { encodeEd25519DidKey } from '@sovra/identity';

export enum ReplayStatus {
  NEW = 'NEW',
  DUPLICATE = 'DUPLICATE',
  OLD = 'OLD',
  INVALID = 'INVALID',
}

export class SlidingReplayWindow {
  private maxSeenSeq = 0n;
  private hasSeenAny = false;
  public readonly windowSize: bigint;
  private readonly seenSeqs = new Set<bigint>();

  constructor(windowSize = 256) {
    this.windowSize = BigInt(windowSize);
  }

  public check(seq: bigint): ReplayStatus {
    if (seq < 0n || seq >= 0xFFFFFFFFFFFFFFFEn) {
      return ReplayStatus.INVALID;
    }
    if (!this.hasSeenAny) {
      return ReplayStatus.NEW;
    }
    if (seq > this.maxSeenSeq) {
      return ReplayStatus.NEW;
    }
    if (this.maxSeenSeq >= this.windowSize && seq + this.windowSize <= this.maxSeenSeq) {
      return ReplayStatus.OLD;
    }
    if (this.seenSeqs.has(seq)) {
      return ReplayStatus.DUPLICATE;
    }
    return ReplayStatus.NEW;
  }

  public record(seq: bigint): void {
    if (!this.hasSeenAny) {
      this.hasSeenAny = true;
      this.maxSeenSeq = seq;
      this.seenSeqs.add(seq);
      return;
    }
    if (seq > this.maxSeenSeq) {
      this.maxSeenSeq = seq;
      this.seenSeqs.add(seq);
      if (this.maxSeenSeq > this.windowSize) {
        const threshold = this.maxSeenSeq - this.windowSize;
        for (const s of this.seenSeqs) {
          if (s <= threshold) {
            this.seenSeqs.delete(s);
          }
        }
      }
      return;
    }
    this.seenSeqs.add(seq);
  }

  public checkAndRecord(seq: bigint): ReplayStatus {
    const status = this.check(seq);
    if (status === ReplayStatus.NEW) {
      this.record(seq);
    }
    return status;
  }

  public reset(): void {
    this.maxSeenSeq = 0n;
    this.hasSeenAny = false;
    this.seenSeqs.clear();
  }

  public getHighestSeen(): bigint {
    return this.maxSeenSeq;
  }

  public isSeen(seq: bigint): boolean {
    return this.seenSeqs.has(seq);
  }
}

export function deriveChaCha20Nonce(iv: Uint8Array, seq: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce.set(iv);
  const view = new DataView(nonce.buffer, nonce.byteOffset, 12);
  const ivLow = view.getBigUint64(4, false);
  view.setBigUint64(4, ivLow ^ seq, false);
  return nonce;
}

export function constructBleAad(sessionId: string, seq: bigint): Uint8Array {
  const sessBytes = hexToBytes(sessionId.slice(0, 32));
  const aad = new Uint8Array(1 + 16 + 8);
  aad[0] = 0x01; // protocol version 1
  aad.set(sessBytes, 1);
  new DataView(aad.buffer, aad.byteOffset + 17, 8).setBigUint64(0, seq, false);
  return aad;
}

export interface AuthenticatedBleSession {
  readonly sessionId: string;
  readonly localDid: string;
  readonly remoteDid: string;
  readonly remoteDevicePubkeyHex: string;
  readonly establishedAt: number;
  readonly expiresAt: number;
  encrypt(plaintext: Uint8Array): Uint8Array;
  decrypt(ciphertext: Uint8Array): Uint8Array;
  getTxSequence?(): bigint;
  getHighestRxSequence?(): bigint;
  getReplayWindow?(): SlidingReplayWindow;
  setTxSequenceForTesting?(seq: bigint): void;
  reset?(): void;
}

export interface HandshakeStep1Message {
  readonly type: 'STEP_1_INITIATE';
  readonly version: number;
  readonly initiatorEphemeralPubkeyHex: string;
  readonly initiatorNonceHex: string;
  readonly timestamp: number;
}

export interface HandshakeStep2Message {
  readonly type: 'STEP_2_CHALLENGE_RESPONSE';
  readonly version: number;
  readonly responderEphemeralPubkeyHex: string;
  readonly responderNonceHex: string;
  readonly responderDid: string;
  readonly responderPubkeyHex: string;
  readonly signatureHex: string; // Signs (initiatorNonce + responderNonce + responderEphemeralPubkey)
  readonly timestamp: number;
}

export interface HandshakeStep3Message {
  readonly type: 'STEP_3_CONFIRM';
  readonly initiatorDid: string;
  readonly initiatorPubkeyHex: string;
  readonly signatureHex: string; // Signs (responderNonce + initiatorNonce + initiatorEphemeralPubkey)
  readonly keyConfirmationTagHex: string;
}

export interface ResponderHandshakeState {
  readonly responderDid: string;
  readonly responderNonce: Uint8Array;
  readonly initiatorNonce: Uint8Array;
  readonly responderEphemeralPubkey: Uint8Array;
  readonly confirmationKey: Uint8Array;
  readonly session: AuthenticatedBleSession;
}

function buildBleSession(
  sessionId: string,
  localDid: string,
  remoteDid: string,
  remoteDevicePubkeyHex: string,
  establishedAt: number,
  expiresAt: number,
  txKey: Uint8Array,
  rxKey: Uint8Array,
  txIv: Uint8Array,
  rxIv: Uint8Array,
): AuthenticatedBleSession {
  let txNonce = 0n;
  const replayWindow = new SlidingReplayWindow(256);

  const sessionObj: AuthenticatedBleSession = {
    sessionId,
    localDid,
    remoteDid,
    remoteDevicePubkeyHex,
    establishedAt,
    expiresAt,
    encrypt(plaintext: Uint8Array): Uint8Array {
      if (txNonce >= 0xFFFFFFFFFFFFFFFEn) {
        throw new Error('BLE AEAD session sequence number exhausted; re-handshake required');
      }
      const seq = txNonce++;
      const nonce = deriveChaCha20Nonce(txIv, seq);
      const aad = constructBleAad(sessionId, seq);
      const ciphertext = encryptChaCha20Poly1305(txKey, nonce, plaintext, aad);

      // Prepend explicit 8-byte sequence number (big-endian)
      const packet = new Uint8Array(8 + ciphertext.length);
      new DataView(packet.buffer, packet.byteOffset, packet.byteLength).setBigUint64(0, seq, false);
      packet.set(ciphertext, 8);
      return packet;
    },
    decrypt(packet: Uint8Array): Uint8Array {
      if (packet.length < 8 + 16) {
        throw new Error(`BLE packet too short for AEAD payload: ${packet.length} bytes (minimum 24 bytes)`);
      }
      const seq = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getBigUint64(0, false);
      const ciphertext = packet.subarray(8);

      const status = replayWindow.check(seq);
      if (status === ReplayStatus.DUPLICATE) {
        throw new Error(`Replay detected: BLE frame sequence ${seq} already processed`);
      }
      if (status === ReplayStatus.OLD) {
        throw new Error(`Packet expired: BLE frame sequence ${seq} is behind sliding window`);
      }
      if (status === ReplayStatus.INVALID) {
        throw new Error(`Invalid sequence number: BLE frame sequence ${seq} is out of allowable bounds`);
      }

      const nonce = deriveChaCha20Nonce(rxIv, seq);
      const aad = constructBleAad(sessionId, seq);
      const plaintext = decryptChaCha20Poly1305(rxKey, nonce, ciphertext, aad);

      // Authenticated! Now record sequence number in sliding replay window
      replayWindow.record(seq);

      return plaintext;
    },
    getTxSequence(): bigint {
      return txNonce;
    },
    getHighestRxSequence(): bigint {
      return replayWindow.getHighestSeen();
    },
    getReplayWindow(): SlidingReplayWindow {
      return replayWindow;
    },
    setTxSequenceForTesting(seq: bigint): void {
      txNonce = seq;
    },
    reset(): void {
      txNonce = 0n;
      replayWindow.reset();
    },
  };

  return sessionObj;
}

export class BleHandshakeEngine {
  public static readonly PROTOCOL_VERSION = 1;
  public static readonly SESSION_LIFETIME_MS = 3600_000; // 1 hour
  private static readonly seenStep1Nonces = new Map<string, number>();

  public static createStep1Initiate(): {
    step1: HandshakeStep1Message;
    ephemeralPrivate: Uint8Array;
    initiatorNonce: Uint8Array;
  } {
    return BleHandshakeEngine.createInitiatorStep1();
  }

  /**
   * Initiator Step 1: Generates ephemeral X25519 keypair and handshake initiation message.
   */
  public static createInitiatorStep1(): {
    step1: HandshakeStep1Message;
    ephemeralPrivate: Uint8Array;
    initiatorNonce: Uint8Array;
  } {
    const kp = generateX25519KeyPair();
    const nonce = secureRandomBytes(32);

    const step1: HandshakeStep1Message = {
      type: 'STEP_1_INITIATE',
      version: this.PROTOCOL_VERSION,
      initiatorEphemeralPubkeyHex: bytesToHex(kp.publicKey),
      initiatorNonceHex: bytesToHex(nonce),
      timestamp: Date.now(),
    };

    return {
      step1,
      ephemeralPrivate: kp.privateKey,
      initiatorNonce: nonce,
    };
  }

  /**
   * Responder Step 2: Validates Step 1, performs DH, signs challenge response.
   */
  public static processStep1AndCreateStep2(
    step1: HandshakeStep1Message,
    responderDid: string,
    responderDevicePrivkey: Uint8Array,
    responderDevicePubkeyHex: string,
  ): {
    step2: HandshakeStep2Message;
    session: AuthenticatedBleSession;
    responderState: ResponderHandshakeState;
  } {
    if (step1.version !== this.PROTOCOL_VERSION) {
      throw new Error(`Incompatible handshake protocol version: ${step1.version}`);
    }

    const now = Date.now();
    if (Math.abs(now - step1.timestamp) > 300_000) {
      throw new Error('Handshake Step 1 timestamp is stale or clock drift exceeds 5 minutes');
    }

    // Replay protection: check if initiatorNonce has been seen recently
    const seenAt = BleHandshakeEngine.seenStep1Nonces.get(step1.initiatorNonceHex);
    if (seenAt && (now - seenAt) < 300_000) {
      throw new Error('Handshake Step 1 initiator nonce replay detected');
    }
    BleHandshakeEngine.seenStep1Nonces.set(step1.initiatorNonceHex, now);
    if (BleHandshakeEngine.seenStep1Nonces.size > 1000) {
      for (const [n, ts] of BleHandshakeEngine.seenStep1Nonces.entries()) {
        if (now - ts > 300_000) BleHandshakeEngine.seenStep1Nonces.delete(n);
      }
    }

    const kp = generateX25519KeyPair();
    const responderNonce = secureRandomBytes(32);
    const initiatorEphemeralPubkey = hexToBytes(step1.initiatorEphemeralPubkeyHex);
    const initiatorNonce = hexToBytes(step1.initiatorNonceHex);

    // Compute shared secret: DH(responderPriv, initiatorPub)
    const sharedSecret = diffieHellmanX25519(kp.privateKey, initiatorEphemeralPubkey);

    // Sign challenge payload: initiatorNonce || responderNonce || responderEphemeralPubkey
    const challengeData = new Uint8Array(32 + 32 + 32);
    challengeData.set(initiatorNonce, 0);
    challengeData.set(responderNonce, 32);
    challengeData.set(kp.publicKey, 64);

    const challengeSig = signEd25519(responderDevicePrivkey, sha256(challengeData));

    // Derive symmetric keys: [txKey (responder->initiator), rxKey (initiator->responder), sessionTag]
    const salt = new Uint8Array(64);
    salt.set(initiatorNonce, 0);
    salt.set(responderNonce, 32);

    const derived = hkdfDerive(sharedSecret, salt, new TextEncoder().encode('sovra:ble:session:v1'), 120);
    const txKey = derived.slice(0, 32);
    const rxKey = derived.slice(32, 64);
    const confirmationKey = derived.slice(64, 96);
    const txIv = derived.slice(96, 108);
    const rxIv = derived.slice(108, 120);

    const step2: HandshakeStep2Message = {
      type: 'STEP_2_CHALLENGE_RESPONSE',
      version: this.PROTOCOL_VERSION,
      responderEphemeralPubkeyHex: bytesToHex(kp.publicKey),
      responderNonceHex: bytesToHex(responderNonce),
      responderDid,
      responderPubkeyHex: responderDevicePubkeyHex,
      signatureHex: bytesToHex(challengeSig),
      timestamp: now,
    };

    const sessionId = bytesToHex(sha256(confirmationKey));
    const session = buildBleSession(
      sessionId,
      responderDid,
      'pending_step_3',
      '',
      now,
      now + this.SESSION_LIFETIME_MS,
      txKey,
      rxKey,
      txIv,
      rxIv,
    );

    const responderState: ResponderHandshakeState = {
      responderDid,
      responderNonce,
      initiatorNonce,
      responderEphemeralPubkey: kp.publicKey,
      confirmationKey,
      session,
    };

    return { step2, session, responderState };
  }

  /**
   * Initiator Step 3: Validates Step 2, performs DH, creates Step 3 confirmation and returns session.
   */
  public static processStep2AndCreateStep3(
    step2: HandshakeStep2Message,
    initiatorEphemeralPrivkey: Uint8Array,
    initiatorNonce: Uint8Array,
    initiatorDid: string,
    initiatorDevicePrivkey: Uint8Array,
    initiatorDevicePubkeyHex: string,
  ): {
    step3: HandshakeStep3Message;
    session: AuthenticatedBleSession;
  } {
    // 1. Verify Responder Signature
    const responderEphemeralPubkey = hexToBytes(step2.responderEphemeralPubkeyHex);
    const responderNonce = hexToBytes(step2.responderNonceHex);
    const responderPubkey = hexToBytes(step2.responderPubkeyHex);

    const challengeData = new Uint8Array(32 + 32 + 32);
    challengeData.set(initiatorNonce, 0);
    challengeData.set(responderNonce, 32);
    challengeData.set(responderEphemeralPubkey, 64);

    const challengeHash = sha256(challengeData);
    const isValid = verifyEd25519(responderPubkey, challengeHash, hexToBytes(step2.signatureHex));
    if (!isValid) {
      throw new Error('Handshake Step 2 signature verification failed: invalid peer identity proof');
    }

    // Cryptographic DID-to-key binding check
    if (step2.responderDid.startsWith('did:key:z')) {
      const derivedDid = encodeEd25519DidKey(responderPubkey);
      if (derivedDid !== step2.responderDid) {
        throw new Error(`Responder identity mismatch: claimed DID ${step2.responderDid} does not match public key DID ${derivedDid}`);
      }
    }

    // 2. Perform DH(initiatorPriv, responderPub)
    const sharedSecret = diffieHellmanX25519(initiatorEphemeralPrivkey, responderEphemeralPubkey);

    const salt = new Uint8Array(64);
    salt.set(initiatorNonce, 0);
    salt.set(responderNonce, 32);

    const derived = hkdfDerive(sharedSecret, salt, new TextEncoder().encode('sovra:ble:session:v1'), 120);
    // Note reversal: initiator txKey is responder rxKey
    const rxKey = derived.slice(0, 32);
    const txKey = derived.slice(32, 64);
    const confirmationKey = derived.slice(64, 96);
    const rxIv = derived.slice(96, 108);
    const txIv = derived.slice(108, 120);

    // 3. Sign Initiator Confirmation
    const initiatorChallengeData = new Uint8Array(32 + 32 + 32);
    initiatorChallengeData.set(responderNonce, 0);
    initiatorChallengeData.set(initiatorNonce, 32);
    initiatorChallengeData.set(responderEphemeralPubkey, 64);

    const initiatorSig = signEd25519(initiatorDevicePrivkey, sha256(initiatorChallengeData));

    const step3: HandshakeStep3Message = {
      type: 'STEP_3_CONFIRM',
      initiatorDid,
      initiatorPubkeyHex: initiatorDevicePubkeyHex,
      signatureHex: bytesToHex(initiatorSig),
      keyConfirmationTagHex: bytesToHex(confirmationKey),
    };

    const now = Date.now();
    const sessionId = bytesToHex(sha256(confirmationKey));
    const session = buildBleSession(
      sessionId,
      initiatorDid,
      step2.responderDid,
      step2.responderPubkeyHex,
      now,
      now + this.SESSION_LIFETIME_MS,
      txKey,
      rxKey,
      txIv,
      rxIv,
    );

    return { step3, session };
  }

  /**
   * Responder Step 3 Validation: Validates initiator's Step 3 confirmation,
   * verifies initiator's Ed25519 signature and key confirmation tag,
   * and returns the fully authenticated session.
   */
  public static processStep3ForResponder(
    state: ResponderHandshakeState,
    step3: HandshakeStep3Message,
  ): AuthenticatedBleSession {
    if (step3.type !== 'STEP_3_CONFIRM') {
      throw new Error(`Invalid Step 3 message type: ${step3.type}`);
    }

    // 1. Verify key confirmation tag matches HKDF derivation
    const expectedConfirmationTagHex = bytesToHex(state.confirmationKey);
    if (step3.keyConfirmationTagHex !== expectedConfirmationTagHex) {
      throw new Error('Handshake Step 3 key confirmation tag mismatch');
    }

    // 2. Verify Initiator Signature: responderNonce || initiatorNonce || responderEphemeralPubkey
    const initiatorChallengeData = new Uint8Array(32 + 32 + 32);
    initiatorChallengeData.set(state.responderNonce, 0);
    initiatorChallengeData.set(state.initiatorNonce, 32);
    initiatorChallengeData.set(state.responderEphemeralPubkey, 64);

    const initiatorChallengeHash = sha256(initiatorChallengeData);
    const initiatorPubkey = hexToBytes(step3.initiatorPubkeyHex);
    const isValid = verifyEd25519(initiatorPubkey, initiatorChallengeHash, hexToBytes(step3.signatureHex));
    if (!isValid) {
      throw new Error('Handshake Step 3 initiator signature verification failed');
    }

    // Cryptographic DID-to-key binding check
    if (step3.initiatorDid.startsWith('did:key:z')) {
      const derivedDid = encodeEd25519DidKey(initiatorPubkey);
      if (derivedDid !== step3.initiatorDid) {
        throw new Error(`Initiator identity mismatch: claimed DID ${step3.initiatorDid} does not match public key DID ${derivedDid}`);
      }
    }

    // Update remote identity on existing session
    (state.session as any).remoteDid = step3.initiatorDid;
    (state.session as any).remoteDevicePubkeyHex = step3.initiatorPubkeyHex;
    return state.session;
  }
}

