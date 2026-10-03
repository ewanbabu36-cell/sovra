import {
  generateX25519KeyPair,
  diffieHellmanX25519,
  hkdfDerive,
  sha256,
  verifyEd25519,
  secureRandomBytes,
  bytesToHex,
  hexToBytes,
  encryptChaCha20Poly1305,
  decryptChaCha20Poly1305,
} from '@sovra/crypto';
import { SovraDeviceKey, RevocationRegistry } from '@sovra/identity';
import { PeerIdentityBinding } from './types.js';
import { verifyPeerIdentityBinding } from './identity.js';
import { HandshakeError, PeerAuthenticationError } from './errors.js';

export interface HandshakeMessage1 {
  readonly ephemeralPublicKeyHex: string;
  readonly nonceHex: string;
}

export interface HandshakeMessage2 {
  readonly ephemeralPublicKeyHex: string;
  readonly nonceHex: string;
  readonly binding: PeerIdentityBinding;
  readonly signatureHex: string;
}

export interface HandshakeMessage3 {
  readonly binding: PeerIdentityBinding;
  readonly signatureHex: string;
}

export interface SessionCipherKeys {
  readonly inboundKey: Uint8Array;
  readonly outboundKey: Uint8Array;
  readonly remotePeerId: string;
  readonly remoteBinding: PeerIdentityBinding;
}

/**
 * Builds a 12-byte AEAD nonce from a directional prefix and a 64-bit sequence number.
 */
function buildNonce(prefix: number, sequenceNumber: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce[0] = prefix;
  const view = new DataView(nonce.buffer, nonce.byteOffset, 12);
  view.setBigUint64(4, sequenceNumber, false);
  return nonce;
}

/**
 * Secure channel wrapper encrypting and decrypting data frames using ChaCha20-Poly1305.
 * Enforces forward secrecy and monotonic sequence replay protection.
 */
export class SecureChannel {
  private sendSeq = 0n;
  private recvSeq = 0n;

  constructor(
    private readonly inboundKey: Uint8Array,
    private readonly outboundKey: Uint8Array,
    public readonly remotePeerId: string,
    public readonly remoteBinding: PeerIdentityBinding,
    private readonly isInitiator: boolean,
  ) {}

  public encrypt(plaintext: Uint8Array, associatedData?: Uint8Array): Uint8Array {
    const seq = this.sendSeq++;
    const prefix = this.isInitiator ? 1 : 2;
    const nonce = buildNonce(prefix, seq);

    // Frame layout: [8 bytes sequence number (Big-Endian)] + [ciphertext + 16 bytes tag]
    const ciphertext = encryptChaCha20Poly1305(this.outboundKey, nonce, plaintext, associatedData);
    const framed = new Uint8Array(8 + ciphertext.length);
    const view = new DataView(framed.buffer, framed.byteOffset, 8);
    view.setBigUint64(0, seq, false);
    framed.set(ciphertext, 8);
    return framed;
  }

  public decrypt(framedCiphertext: Uint8Array, associatedData?: Uint8Array): Uint8Array {
    if (framedCiphertext.length < 24) {
      // 8 bytes seq + at least 16 bytes auth tag
      throw new HandshakeError('Ciphertext frame is too short to be valid');
    }
    const view = new DataView(framedCiphertext.buffer, framedCiphertext.byteOffset, 8);
    const seq = view.getBigUint64(0, false);

    // Enforce monotonic sequence progression to prevent replay attacks
    if (seq < this.recvSeq) {
      throw new HandshakeError('Replay attack detected: sequence number lower than expected', {
        receivedSeq: String(seq),
        expectedMinSeq: String(this.recvSeq),
      });
    }
    this.recvSeq = seq + 1n;

    const prefix = this.isInitiator ? 2 : 1;
    const nonce = buildNonce(prefix, seq);
    const rawCiphertext = framedCiphertext.subarray(8);

    return decryptChaCha20Poly1305(this.inboundKey, nonce, rawCiphertext, associatedData);
  }
}

/**
 * Executes a simulated or real mutual Noise-style handshake between two peers.
 */
export class SecureTransportHandshake {
  /**
   * Generates Initiator Message 1 (ephemeral key announcement).
   */
  public static initiate(): {
    message1: HandshakeMessage1;
    ephemeralKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array };
  } {
    const ephemeralKeyPair = generateX25519KeyPair();
    const nonce = secureRandomBytes(16);
    return {
      message1: {
        ephemeralPublicKeyHex: bytesToHex(ephemeralKeyPair.publicKey),
        nonceHex: bytesToHex(nonce),
      },
      ephemeralKeyPair,
    };
  }

  /**
   * Responds to Message 1 by generating Message 2 (ephemeral key + identity assertion + signature).
   */
  public static respond(
    message1: HandshakeMessage1,
    responderDeviceKey: SovraDeviceKey,
    responderBinding: PeerIdentityBinding,
    revocationRegistry?: RevocationRegistry,
  ): {
    message2: HandshakeMessage2;
    ephemeralKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array };
    initiatorEphemeralPub: Uint8Array;
  } {
    const initiatorEphemeralPub = hexToBytes(message1.ephemeralPublicKeyHex);
    if (initiatorEphemeralPub.length !== 32) {
      throw new HandshakeError('Invalid initiator ephemeral public key');
    }

    if (revocationRegistry && !verifyPeerIdentityBinding(responderBinding, revocationRegistry)) {
      throw new PeerAuthenticationError('Responder identity binding is revoked or invalid', {
        peerId: responderBinding.peerId,
      });
    }

    const ephemeralKeyPair = generateX25519KeyPair();
    const nonce = secureRandomBytes(16);

    // Compute transcript hash for authentication
    const transcriptBytes = new TextEncoder().encode(
      `sovra:handshake:msg2:${message1.ephemeralPublicKeyHex}:${bytesToHex(ephemeralKeyPair.publicKey)}:${message1.nonceHex}:${bytesToHex(nonce)}`,
    );
    const transcriptHash = sha256(transcriptBytes);
    const signature = responderDeviceKey.sign(transcriptHash);

    return {
      message2: {
        ephemeralPublicKeyHex: bytesToHex(ephemeralKeyPair.publicKey),
        nonceHex: bytesToHex(nonce),
        binding: responderBinding,
        signatureHex: bytesToHex(signature),
      },
      ephemeralKeyPair,
      initiatorEphemeralPub,
    };
  }

  /**
   * Initiator processes Message 2 and creates Message 3.
   */
  public static processMessage2AndCreateMessage3(
    message1: HandshakeMessage1,
    message2: HandshakeMessage2,
    initiatorEphemeralPriv: Uint8Array,
    initiatorDeviceKey: SovraDeviceKey,
    initiatorBinding: PeerIdentityBinding,
    revocationRegistry?: RevocationRegistry,
  ): {
    message3: HandshakeMessage3;
    channel: SecureChannel;
  } {
    // 1. Verify responder's identity binding
    const isBindingValid = verifyPeerIdentityBinding(message2.binding, revocationRegistry);
    if (!isBindingValid) {
      throw new PeerAuthenticationError('Responder identity binding is invalid or revoked', {
        peerId: message2.binding.peerId,
      });
    }

    // 2. Verify responder's signature on handshake transcript
    const responderEphemeralPub = hexToBytes(message2.ephemeralPublicKeyHex);
    const transcriptBytes = new TextEncoder().encode(
      `sovra:handshake:msg2:${message1.ephemeralPublicKeyHex}:${message2.ephemeralPublicKeyHex}:${message1.nonceHex}:${message2.nonceHex}`,
    );
    const transcriptHash = sha256(transcriptBytes);
    const isSigValid = verifyEd25519(
      hexToBytes(message2.binding.devicePublicKeyHex),
      transcriptHash,
      hexToBytes(message2.signatureHex),
    );
    if (!isSigValid) {
      throw new HandshakeError('Responder handshake transcript signature is invalid');
    }

    // 3. Compute Diffie-Hellman shared secret
    const sharedSecret = diffieHellmanX25519(initiatorEphemeralPriv, responderEphemeralPub);

    // 4. Create Initiator's authentication signature for Message 3
    const msg3TranscriptBytes = new TextEncoder().encode(
      `sovra:handshake:msg3:${message1.ephemeralPublicKeyHex}:${message2.ephemeralPublicKeyHex}:${bytesToHex(transcriptHash)}`,
    );
    const msg3TranscriptHash = sha256(msg3TranscriptBytes);
    const initiatorSig = initiatorDeviceKey.sign(msg3TranscriptHash);

    // 5. Derive directional session keys
    const salt = sha256(
      new Uint8Array([...hexToBytes(message1.nonceHex), ...hexToBytes(message2.nonceHex)]),
    );
    const k1 = hkdfDerive(
      sharedSecret,
      salt,
      new TextEncoder().encode('sovra:p2p:init-to-resp'),
      32,
    );
    const k2 = hkdfDerive(
      sharedSecret,
      salt,
      new TextEncoder().encode('sovra:p2p:resp-to-init'),
      32,
    );

    const channel = new SecureChannel(k2, k1, message2.binding.peerId, message2.binding, true);

    return {
      message3: {
        binding: initiatorBinding,
        signatureHex: bytesToHex(initiatorSig),
      },
      channel,
    };
  }

  /**
   * Responder processes Message 3 to finalize secure session.
   */
  public static finalizeResponder(
    message1: HandshakeMessage1,
    message2: HandshakeMessage2,
    message3: HandshakeMessage3,
    responderEphemeralPriv: Uint8Array,
    initiatorEphemeralPub: Uint8Array,
    revocationRegistry?: RevocationRegistry,
  ): SecureChannel {
    // 1. Verify initiator's identity binding
    const isBindingValid = verifyPeerIdentityBinding(message3.binding, revocationRegistry);
    if (!isBindingValid) {
      throw new PeerAuthenticationError('Initiator identity binding is invalid or revoked', {
        peerId: message3.binding.peerId,
      });
    }

    // 2. Verify initiator's transcript signature
    const transcriptBytes = new TextEncoder().encode(
      `sovra:handshake:msg2:${message1.ephemeralPublicKeyHex}:${message2.ephemeralPublicKeyHex}:${message1.nonceHex}:${message2.nonceHex}`,
    );
    const transcriptHash = sha256(transcriptBytes);
    const msg3TranscriptBytes = new TextEncoder().encode(
      `sovra:handshake:msg3:${message1.ephemeralPublicKeyHex}:${message2.ephemeralPublicKeyHex}:${bytesToHex(transcriptHash)}`,
    );
    const msg3TranscriptHash = sha256(msg3TranscriptBytes);
    const isSigValid = verifyEd25519(
      hexToBytes(message3.binding.devicePublicKeyHex),
      msg3TranscriptHash,
      hexToBytes(message3.signatureHex),
    );
    if (!isSigValid) {
      throw new HandshakeError('Initiator handshake transcript signature is invalid');
    }

    // 3. Compute Diffie-Hellman shared secret
    const sharedSecret = diffieHellmanX25519(responderEphemeralPriv, initiatorEphemeralPub);

    // 4. Derive directional session keys
    const salt = sha256(
      new Uint8Array([...hexToBytes(message1.nonceHex), ...hexToBytes(message2.nonceHex)]),
    );
    const k1 = hkdfDerive(
      sharedSecret,
      salt,
      new TextEncoder().encode('sovra:p2p:init-to-resp'),
      32,
    );
    const k2 = hkdfDerive(
      sharedSecret,
      salt,
      new TextEncoder().encode('sovra:p2p:resp-to-init'),
      32,
    );

    return new SecureChannel(k1, k2, message3.binding.peerId, message3.binding, false);
  }
}
