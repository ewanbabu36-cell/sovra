/**
 * @file packages/p2p/src/signaling.ts
 * Decentralized Zero-Server WebRTC Signaling over Libp2p GossipSub.
 *
 * Replaces centralized HTTP endpoints (/api/call/*) with permissionless,
 * end-to-end encrypted (Noise-grade X25519 + ChaCha20-Poly1305 + Ed25519)
 * signaling topics over the Sovra P2P GossipSub mesh.
 */

import { Result, ok, err } from '@sovra/shared';
import {
  bytesToHex,
  hexToBytes,
  secureRandomBytes,
  generateX25519KeyPair,
  diffieHellmanX25519,
  hkdfDerive,
  encryptChaCha20Poly1305,
  decryptChaCha20Poly1305,
  verifyEd25519,
  sha256,
  decodeBase58Btc,
} from '@sovra/crypto';
import type { SovraP2PNode } from './node.js';

export type SignalingMessageType = 'offer' | 'answer' | 'candidate' | 'end' | 'switch-mode';

export interface SignalPayload {
  readonly callId: string;
  readonly type: SignalingMessageType;
  readonly callType?: 'voice' | 'video' | undefined;
  readonly sdp?: string | undefined;
  readonly candidate?: any | undefined;
  readonly reason?: string | undefined;
  readonly mode?: 'voice' | 'video' | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface EncryptedSignalEnvelope {
  readonly version: 1;
  readonly senderDid: string;
  readonly recipientDid: string;
  readonly callId: string;
  readonly type: SignalingMessageType;
  readonly timestamp: number;
  readonly nonceHex: string; // 12-byte hex nonce for AEAD
  readonly ephemeralPubKeyHex: string; // 32-byte hex X25519 ephemeral pubkey
  readonly ciphertextHex: string; // Encrypted SignalPayload
  readonly signatureHex: string; // Ed25519 signature of sender over envelope header + ciphertext
}

export interface DecryptedSignal {
  readonly senderDid: string;
  readonly recipientDid: string;
  readonly payload: SignalPayload;
  readonly timestamp: number;
}

export interface P2PSignalingConfig {
  readonly myDid: string;
  readonly signEd25519Fn: (message: Uint8Array) => Uint8Array;
  readonly myX25519PrivateKey: Uint8Array;
  readonly maxClockSkewMs?: number | undefined; // Default 60,000ms (60s)
}

export class P2PSignalingChannel {
  private readonly listeners = new Set<(signal: DecryptedSignal) => void>();
  private readonly seenNonces = new Set<string>();
  private _isSubscribed = false;
  private readonly maxClockSkewMs: number;
  private cleanupInterval?: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly p2pNode: SovraP2PNode,
    private readonly config: P2PSignalingConfig,
  ) {
    this.maxClockSkewMs = config.maxClockSkewMs ?? 60_000;
  }

  public getTopicForDid(did: string): string {
    return `/sovra/v1/signal/${did}`;
  }

  public get myTopic(): string {
    return this.getTopicForDid(this.config.myDid);
  }

  public get isSubscribed(): boolean {
    return this._isSubscribed;
  }

  /**
   * Subscribe to incoming decentralized signals directed to my DID.
   */
  public async start(): Promise<Result<void>> {
    if (this._isSubscribed) return ok(undefined);

    const subRes = await this.p2pNode.pubsub.subscribe(this.myTopic, (message) => {
      this.handleIncomingRawMessage(message.data);
    });

    if (!subRes.ok) {
      return err(subRes.error);
    }

    this._isSubscribed = true;

    // Periodic cleanup of replay protection cache
    this.cleanupInterval = setInterval(() => {
      if (this.seenNonces.size > 10_000) {
        this.seenNonces.clear();
      }
    }, 120_000);

    return ok(undefined);
  }

  /**
   * Stop and unsubscribe from signaling topic.
   */
  public async stop(): Promise<Result<void>> {
    if (!this._isSubscribed) return ok(undefined);

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    const unsubRes = await this.p2pNode.pubsub.unsubscribe(this.myTopic);
    this._isSubscribed = false;
    this.listeners.clear();
    this.seenNonces.clear();

    if (!unsubRes.ok) {
      return err(unsubRes.error);
    }

    return ok(undefined);
  }

  /**
   * Register listener for decrypted incoming signals.
   */
  public onSignal(handler: (signal: DecryptedSignal) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /**
   * Send an end-to-end encrypted signaling message to a target peer.
   */
  public async sendSignal(
    recipientDid: string,
    recipientX25519PubKeyHex: string,
    payload: SignalPayload,
  ): Promise<Result<void>> {
    try {
      const recipientPubKeyBytes = hexToBytes(recipientX25519PubKeyHex);
      if (recipientPubKeyBytes.length !== 32) {
        return err(new Error('Recipient X25519 public key must be exactly 32 bytes'));
      }

      // 1. Generate Ephemeral X25519 keypair for Forward Secrecy
      const ephemeralKey = generateX25519KeyPair();
      const sharedSecret = diffieHellmanX25519(ephemeralKey.privateKey, recipientPubKeyBytes);

      // 2. Derive AEAD Key using HKDF
      const salt = new TextEncoder().encode('sovra_signal_v1_salt');
      const info = new TextEncoder().encode(`signal:${this.config.myDid}:${recipientDid}`);
      const aeadKey = hkdfDerive(sharedSecret, salt, info, 32);

      // 3. Serialize and Encrypt Payload
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      const nonce = secureRandomBytes(12);
      const ciphertext = encryptChaCha20Poly1305(aeadKey, nonce, payloadBytes);

      const timestamp = Date.now();
      const nonceHex = bytesToHex(nonce);
      const ephemeralPubKeyHex = bytesToHex(ephemeralKey.publicKey);
      const ciphertextHex = bytesToHex(ciphertext);

      // 4. Ed25519 Signature over canonical commitment
      const commitment = this.computeEnvelopeCommitment(
        1,
        this.config.myDid,
        recipientDid,
        payload.callId,
        payload.type,
        timestamp,
        nonceHex,
        ephemeralPubKeyHex,
        ciphertextHex,
      );
      const signatureBytes = this.config.signEd25519Fn(commitment);
      const signatureHex = bytesToHex(signatureBytes);

      const envelope: EncryptedSignalEnvelope = {
        version: 1,
        senderDid: this.config.myDid,
        recipientDid,
        callId: payload.callId,
        type: payload.type,
        timestamp,
        nonceHex,
        ephemeralPubKeyHex,
        ciphertextHex,
        signatureHex,
      };

      const targetTopic = this.getTopicForDid(recipientDid);
      const envelopeBytes = new TextEncoder().encode(JSON.stringify(envelope));

      const pubRes = await this.p2pNode.pubsub.publish(targetTopic, envelopeBytes);
      if (!pubRes.ok) {
        return err(pubRes.error);
      }

      return ok(undefined);
    } catch (e: any) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Helper: Send SDP Offer
   */
  public async sendOffer(
    recipientDid: string,
    recipientX25519PubKeyHex: string,
    callId: string,
    sdp: string,
    callType: 'voice' | 'video',
    metadata?: Record<string, unknown>,
  ): Promise<Result<void>> {
    return this.sendSignal(recipientDid, recipientX25519PubKeyHex, {
      callId,
      type: 'offer',
      callType,
      sdp,
      metadata,
    });
  }

  /**
   * Helper: Send SDP Answer
   */
  public async sendAnswer(
    recipientDid: string,
    recipientX25519PubKeyHex: string,
    callId: string,
    sdp: string,
  ): Promise<Result<void>> {
    return this.sendSignal(recipientDid, recipientX25519PubKeyHex, {
      callId,
      type: 'answer',
      sdp,
    });
  }

  /**
   * Helper: Send ICE Candidate
   */
  public async sendCandidate(
    recipientDid: string,
    recipientX25519PubKeyHex: string,
    callId: string,
    candidate: any,
  ): Promise<Result<void>> {
    return this.sendSignal(recipientDid, recipientX25519PubKeyHex, {
      callId,
      type: 'candidate',
      candidate,
    });
  }

  /**
   * Helper: Send Call Termination
   */
  public async sendEnd(
    recipientDid: string,
    recipientX25519PubKeyHex: string,
    callId: string,
    reason?: string,
  ): Promise<Result<void>> {
    return this.sendSignal(recipientDid, recipientX25519PubKeyHex, {
      callId,
      type: 'end',
      reason,
    });
  }

  /**
   * Helper: Switch Voice/Video Mode
   */
  public async sendSwitchMode(
    recipientDid: string,
    recipientX25519PubKeyHex: string,
    callId: string,
    mode: 'voice' | 'video',
  ): Promise<Result<void>> {
    return this.sendSignal(recipientDid, recipientX25519PubKeyHex, {
      callId,
      type: 'switch-mode',
      mode,
    });
  }

  /**
   * Decrypt and verify an incoming raw signaling message.
   */
  public handleIncomingRawMessage(rawBytes: Uint8Array): Result<DecryptedSignal> {
    try {
      const jsonStr = new TextDecoder().decode(rawBytes);
      const envelope = JSON.parse(jsonStr) as EncryptedSignalEnvelope;

      if (envelope.version !== 1) {
        return err(new Error(`Unsupported signaling version: ${envelope.version}`));
      }

      if (envelope.recipientDid !== this.config.myDid) {
        return err(new Error('Signal not intended for this node DID'));
      }

      // Replay Protection 1: Nonce Check
      if (this.seenNonces.has(envelope.nonceHex)) {
        return err(new Error('Replay attack detected: duplicate signal nonce'));
      }

      // Replay Protection 2: Timestamp Check
      const now = Date.now();
      if (Math.abs(now - envelope.timestamp) > this.maxClockSkewMs) {
        return err(new Error('Signal timestamp expired or clock skew exceeded'));
      }

      // 1. Verify Sender Ed25519 Signature
      const commitment = this.computeEnvelopeCommitment(
        envelope.version,
        envelope.senderDid,
        envelope.recipientDid,
        envelope.callId,
        envelope.type,
        envelope.timestamp,
        envelope.nonceHex,
        envelope.ephemeralPubKeyHex,
        envelope.ciphertextHex,
      );

      const senderEd25519PubKey = this.extractEd25519PubKeyFromDid(envelope.senderDid);
      if (!senderEd25519PubKey) {
        return err(new Error(`Cannot extract Ed25519 public key from sender DID: ${envelope.senderDid}`));
      }

      const sigBytes = hexToBytes(envelope.signatureHex);
      const isSigValid = verifyEd25519(senderEd25519PubKey, commitment, sigBytes);
      if (!isSigValid) {
        return err(new Error('Cryptographic signature verification failed on signal envelope'));
      }

      // 2. Perform ECDH with Ephemeral Key
      const ephemeralPubKeyBytes = hexToBytes(envelope.ephemeralPubKeyHex);
      const sharedSecret = diffieHellmanX25519(this.config.myX25519PrivateKey, ephemeralPubKeyBytes);

      // 3. Derive AEAD Key
      const salt = new TextEncoder().encode('sovra_signal_v1_salt');
      const info = new TextEncoder().encode(`signal:${envelope.senderDid}:${envelope.recipientDid}`);
      const aeadKey = hkdfDerive(sharedSecret, salt, info, 32);

      // 4. Decrypt Payload
      const nonceBytes = hexToBytes(envelope.nonceHex);
      const ciphertextBytes = hexToBytes(envelope.ciphertextHex);
      const decryptedBytes = decryptChaCha20Poly1305(aeadKey, nonceBytes, ciphertextBytes);

      const payload = JSON.parse(new TextDecoder().decode(decryptedBytes)) as SignalPayload;

      // Mark nonce as seen
      this.seenNonces.add(envelope.nonceHex);

      const decryptedSignal: DecryptedSignal = {
        senderDid: envelope.senderDid,
        recipientDid: envelope.recipientDid,
        payload,
        timestamp: envelope.timestamp,
      };

      // Notify registered listeners
      for (const listener of this.listeners) {
        try {
          listener(decryptedSignal);
        } catch {}
      }

      return ok(decryptedSignal);
    } catch (e: any) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private computeEnvelopeCommitment(
    version: number,
    senderDid: string,
    recipientDid: string,
    callId: string,
    type: SignalingMessageType,
    timestamp: number,
    nonceHex: string,
    ephemeralPubKeyHex: string,
    ciphertextHex: string,
  ): Uint8Array {
    const raw = `${version}:${senderDid}:${recipientDid}:${callId}:${type}:${timestamp}:${nonceHex}:${ephemeralPubKeyHex}:${ciphertextHex}`;
    return sha256(new TextEncoder().encode(raw));
  }

  /**
   * Helper to extract 32-byte Ed25519 public key from did:key:z6Mku...
   */
  private extractEd25519PubKeyFromDid(did: string): Uint8Array | null {
    try {
      if (!did.startsWith('did:key:z')) return null;
      // Multicodec ed25519-pub prefix is 0xed, 0x01 (two bytes: 237, 1)
      const multibase = did.slice(9);
      const bytes = decodeBase58Btc(multibase);
      if (bytes[0] === 0xed && bytes[1] === 0x01 && bytes.length === 34) {
        return bytes.slice(2);
      }
      return null;
    } catch {
      return null;
    }
  }
}
