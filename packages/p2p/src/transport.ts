import * as net from 'node:net';
import {
  generateX25519KeyPair,
  diffieHellmanX25519,
  hkdfDerive,
  sha256,
  verifyEd25519,
  bytesToHex,
  hexToBytes,
  encryptChaCha20Poly1305,
  decryptChaCha20Poly1305,
  X25519KeyPairBytes,
} from '@sovra/crypto';
import { SovraDeviceKey, RevocationRegistry } from '@sovra/identity';
import { PeerIdentityBinding } from './types.js';
import { verifyPeerIdentityBinding } from './identity.js';
import { HandshakeError, PeerAuthenticationError, TransportError } from './errors.js';

// =========================================================================
// NOISE PROTOCOL FRAMEWORK (Revision 34) IMPLEMENTATION
// Pattern: Noise_XX_25519_ChaChaPoly_SHA256
// Handshake:
//   -> e
//   <- e, ee, s, es
//   -> s, se
// =========================================================================

const NOISE_PROTOCOL_NAME = 'Noise_XX_25519_ChaChaPoly_SHA256'; // Exactly 32 bytes ASCII
const SOVRA_PROLOGUE = new TextEncoder().encode('sovra:p2p:noise-xx:v1');
const ZEROS_32 = new Uint8Array(32);

/**
 * Builds a 12-byte AEAD nonce from a 64-bit sequence number per Noise specification.
 * Bytes 0..3: 0x00, Bytes 4..11: sequence number in Little-Endian.
 */
export function buildNoiseNonce(sequenceNumber: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer, nonce.byteOffset, 12);
  view.setBigUint64(4, sequenceNumber, true);
  return nonce;
}

/**
 * Noise CipherState maintaining 32-byte cipher key and 64-bit sequence counter.
 */
export class NoiseCipherState {
  private k: Uint8Array | null = null;
  private n = 0n;

  constructor(key?: Uint8Array) {
    if (key) {
      this.k = new Uint8Array(key);
    }
  }

  public get hasKey(): boolean {
    return this.k !== null;
  }

  public initializeKey(key: Uint8Array | null): void {
    this.k = key ? new Uint8Array(key) : null;
    this.n = 0n;
  }

  public get sequenceNumber(): bigint {
    return this.n;
  }

  public encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (!this.k) {
      return new Uint8Array(plaintext);
    }
    if (this.n === 0xffffffffffffffffn) {
      throw new HandshakeError('Nonce sequence number overflow in CipherState');
    }
    const nonce = buildNoiseNonce(this.n);
    const ciphertext = encryptChaCha20Poly1305(this.k, nonce, plaintext, ad);
    this.n++;
    return ciphertext;
  }

  public decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (!this.k) {
      return new Uint8Array(ciphertext);
    }
    if (this.n === 0xffffffffffffffffn) {
      throw new HandshakeError('Nonce sequence number overflow in CipherState');
    }
    const nonce = buildNoiseNonce(this.n);
    const plaintext = decryptChaCha20Poly1305(this.k, nonce, ciphertext, ad);
    this.n++;
    return plaintext;
  }
}

/**
 * Noise SymmetricState managing chaining key (ck), handshake hash (h), and CipherState.
 */
export class NoiseSymmetricState {
  public cipherState = new NoiseCipherState();
  public ck: Uint8Array;
  public h: Uint8Array;

  constructor(protocolName: string = NOISE_PROTOCOL_NAME) {
    const nameBytes = new TextEncoder().encode(protocolName);
    if (nameBytes.length <= 32) {
      this.h = new Uint8Array(32);
      this.h.set(nameBytes, 0);
    } else {
      this.h = sha256(nameBytes);
    }
    this.ck = new Uint8Array(this.h);
  }

  public mixKey(inputKeyMaterial: Uint8Array): void {
    // HKDF-Extract(ck, ikm) followed by HKDF-Expand to 64 bytes
    const derived = hkdfDerive(inputKeyMaterial, this.ck, new Uint8Array(0), 64);
    this.ck = derived.subarray(0, 32);
    const tempK = derived.subarray(32, 64);
    this.cipherState.initializeKey(tempK);
  }

  public mixHash(data: Uint8Array): void {
    const combined = new Uint8Array(this.h.length + data.length);
    combined.set(this.h, 0);
    combined.set(data, this.h.length);
    this.h = sha256(combined);
  }

  public encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.cipherState.encryptWithAd(this.h, plaintext);
    this.mixHash(ciphertext);
    return ciphertext;
  }

  public decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.cipherState.decryptWithAd(this.h, ciphertext);
    this.mixHash(ciphertext);
    return plaintext;
  }

  public split(): [NoiseCipherState, NoiseCipherState] {
    const derived = hkdfDerive(ZEROS_32, this.ck, new TextEncoder().encode('sovra:p2p:split'), 64);
    const c1Key = derived.subarray(0, 32);
    const c2Key = derived.subarray(32, 64);
    return [new NoiseCipherState(c1Key), new NoiseCipherState(c2Key)];
  }
}

/**
 * Payload carried inside encrypted Noise handshake messages (Message 2 & Message 3).
 * Bound to static X25519 key by device's Ed25519 signature.
 */
export interface NoiseHandshakePayload {
  readonly binding: PeerIdentityBinding;
  readonly staticKeySignatureHex: string; // Ed25519 signature over static X25519 public key
}

export interface HandshakeMessage1 {
  readonly rawBytes: Uint8Array; // e.pub (32B) + encrypted payload (0 or more)
  readonly ephemeralPublicKeyHex: string;
}

export interface HandshakeMessage2 {
  readonly rawBytes: Uint8Array; // e.pub (32B) + encrypted s.pub (48B) + encrypted payload
}

export interface HandshakeMessage3 {
  readonly rawBytes: Uint8Array; // encrypted s.pub (48B) + encrypted payload
}

/**
 * Established secure channel wrapping bidirectional ChaCha20-Poly1305 cipher states.
 */
export class SecureChannel {
  private sendSeq = 0n;
  private recvSeq = 0n;

  constructor(
    private readonly sendCipher: NoiseCipherState,
    private readonly recvCipher: NoiseCipherState,
    public readonly remotePeerId: string,
    public readonly remoteBinding: PeerIdentityBinding,
    public readonly isInitiator: boolean,
  ) {}

  public encrypt(plaintext: Uint8Array, associatedData?: Uint8Array): Uint8Array {
    const seq = this.sendSeq++;
    const ad = associatedData ?? new Uint8Array(0);
    const ciphertext = this.sendCipher.encryptWithAd(ad, plaintext);

    // Wire frame format: [8 bytes sequence number (Big-Endian)] + [ciphertext (with Poly1305 tag)]
    const framed = new Uint8Array(8 + ciphertext.length);
    const view = new DataView(framed.buffer, framed.byteOffset, 8);
    view.setBigUint64(0, seq, false);
    framed.set(ciphertext, 8);
    return framed;
  }

  public decrypt(framedCiphertext: Uint8Array, associatedData?: Uint8Array): Uint8Array {
    if (framedCiphertext.length < 24) {
      throw new TransportError('Ciphertext frame is too short to be valid');
    }
    const view = new DataView(framedCiphertext.buffer, framedCiphertext.byteOffset, 8);
    const seq = view.getBigUint64(0, false);

    if (seq < this.recvSeq) {
      throw new TransportError('Replay attack detected: sequence number lower than expected', {
        receivedSeq: String(seq),
        expectedMinSeq: String(this.recvSeq),
      });
    }
    if (seq > this.recvSeq) {
      throw new TransportError('Out-of-order or dropped frame detected in secure channel', {
        receivedSeq: String(seq),
        expectedSeq: String(this.recvSeq),
      });
    }
    this.recvSeq = seq + 1n;

    const rawCiphertext = framedCiphertext.subarray(8);
    const ad = associatedData ?? new Uint8Array(0);
    return this.recvCipher.decryptWithAd(ad, rawCiphertext);
  }
}

/**
 * Executes standard-compliant Noise_XX mutual authentication handshake.
 */
export class SecureTransportHandshake {
  /**
   * Initiator creates Message 1: -> e
   */
  public static initiate(prologue: Uint8Array = SOVRA_PROLOGUE): {
    message1: HandshakeMessage1;
    symmetricState: NoiseSymmetricState;
    ephemeralKeyPair: X25519KeyPairBytes;
  } {
    const sym = new NoiseSymmetricState();
    sym.mixHash(prologue);

    const ephemeralKeyPair = generateX25519KeyPair();
    sym.mixHash(ephemeralKeyPair.publicKey);

    // Empty payload for message 1
    const encryptedPayload = sym.encryptAndHash(new Uint8Array(0));

    const rawBytes = new Uint8Array(ephemeralKeyPair.publicKey.length + encryptedPayload.length);
    rawBytes.set(ephemeralKeyPair.publicKey, 0);
    rawBytes.set(encryptedPayload, ephemeralKeyPair.publicKey.length);

    return {
      message1: {
        rawBytes,
        ephemeralPublicKeyHex: bytesToHex(ephemeralKeyPair.publicKey),
      },
      symmetricState: sym,
      ephemeralKeyPair,
    };
  }

  /**
   * Responder processes Message 1 and generates Message 2: <- e, ee, s, es
   */
  public static respond(
    message1: HandshakeMessage1,
    responderDeviceKey: SovraDeviceKey,
    responderBinding: PeerIdentityBinding,
    staticKeyPair?: X25519KeyPairBytes,
    revocationRegistry?: RevocationRegistry,
    prologue: Uint8Array = SOVRA_PROLOGUE,
  ): {
    message2: HandshakeMessage2;
    symmetricState: NoiseSymmetricState;
    ephemeralKeyPair: X25519KeyPairBytes;
    staticKeyPair: X25519KeyPairBytes;
    initiatorEphemeralPub: Uint8Array;
  } {
    if (message1.rawBytes.length < 32) {
      throw new HandshakeError('Invalid Message 1: truncated ephemeral public key');
    }

    if (revocationRegistry && !verifyPeerIdentityBinding(responderBinding, revocationRegistry)) {
      throw new PeerAuthenticationError('Responder identity binding is revoked or invalid', {
        peerId: responderBinding.peerId,
      });
    }

    const sym = new NoiseSymmetricState();
    sym.mixHash(prologue);

    const initiatorEphemeralPub = message1.rawBytes.subarray(0, 32);
    sym.mixHash(initiatorEphemeralPub);
    sym.decryptAndHash(message1.rawBytes.subarray(32));

    const ephemeralKeyPair = generateX25519KeyPair();
    const staticKey = staticKeyPair ?? generateX25519KeyPair();

    // 1. Send e
    sym.mixHash(ephemeralKeyPair.publicKey);

    // 2. ee = DH(e, re)
    const ee = diffieHellmanX25519(ephemeralKeyPair.privateKey, initiatorEphemeralPub);
    sym.mixKey(ee);

    // 3. s = EncryptAndHash(s.pub)
    const encryptedStatic = sym.encryptAndHash(staticKey.publicKey);

    // 4. es = DH(s, re)
    const es = diffieHellmanX25519(staticKey.privateKey, initiatorEphemeralPub);
    sym.mixKey(es);

    // 5. Sign static key with device key to bind X25519 key to Ed25519 device identity
    const staticSig = responderDeviceKey.sign(staticKey.publicKey);
    const payloadObj: NoiseHandshakePayload = {
      binding: responderBinding,
      staticKeySignatureHex: bytesToHex(staticSig),
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
    const encryptedPayload = sym.encryptAndHash(payloadBytes);

    const rawBytes = new Uint8Array(
      ephemeralKeyPair.publicKey.length + encryptedStatic.length + encryptedPayload.length,
    );
    rawBytes.set(ephemeralKeyPair.publicKey, 0);
    rawBytes.set(encryptedStatic, ephemeralKeyPair.publicKey.length);
    rawBytes.set(encryptedPayload, ephemeralKeyPair.publicKey.length + encryptedStatic.length);

    return {
      message2: { rawBytes },
      symmetricState: sym,
      ephemeralKeyPair,
      staticKeyPair: staticKey,
      initiatorEphemeralPub,
    };
  }

  /**
   * Initiator processes Message 2 and generates Message 3: -> s, se
   */
  public static processMessage2AndCreateMessage3(
    message2: HandshakeMessage2,
    sym: NoiseSymmetricState,
    initiatorEphemeralPriv: Uint8Array,
    initiatorDeviceKey: SovraDeviceKey,
    initiatorBinding: PeerIdentityBinding,
    staticKeyPair?: X25519KeyPairBytes,
    revocationRegistry?: RevocationRegistry,
  ): {
    message3: HandshakeMessage3;
    channel: SecureChannel;
    responderBinding: PeerIdentityBinding;
  } {
    if (message2.rawBytes.length < 80) {
      // 32B e + 48B encrypted s + at least 16B payload tag
      throw new HandshakeError('Invalid Message 2: truncated payload');
    }

    const responderEphemeralPub = message2.rawBytes.subarray(0, 32);
    sym.mixHash(responderEphemeralPub);

    // ee = DH(e, re)
    const ee = diffieHellmanX25519(initiatorEphemeralPriv, responderEphemeralPub);
    sym.mixKey(ee);

    // Decrypt responder's static public key (48 bytes: 32 bytes pub + 16 bytes tag)
    const encryptedStatic = message2.rawBytes.subarray(32, 80);
    const responderStaticPub = sym.decryptAndHash(encryptedStatic);

    // es = DH(e, rs)
    const es = diffieHellmanX25519(initiatorEphemeralPriv, responderStaticPub);
    sym.mixKey(es);

    // Decrypt responder payload
    const encryptedPayload = message2.rawBytes.subarray(80);
    const decryptedPayloadBytes = sym.decryptAndHash(encryptedPayload);
    const responderPayload: NoiseHandshakePayload = JSON.parse(
      new TextDecoder().decode(decryptedPayloadBytes),
    );

    // Verify responder's identity binding
    const isBindingValid = verifyPeerIdentityBinding(
      responderPayload.binding,
      revocationRegistry,
    );
    if (!isBindingValid) {
      throw new PeerAuthenticationError('Responder identity binding is invalid or revoked', {
        peerId: responderPayload.binding.peerId,
      });
    }

    // Verify responder's signature on static X25519 public key
    const isStaticSigValid = verifyEd25519(
      hexToBytes(responderPayload.binding.devicePublicKeyHex),
      responderStaticPub,
      hexToBytes(responderPayload.staticKeySignatureHex),
    );
    if (!isStaticSigValid) {
      throw new HandshakeError('Responder signature over static X25519 key is invalid');
    }

    // Now initiator creates Message 3: -> s, se
    const staticKey = staticKeyPair ?? generateX25519KeyPair();
    const myEncryptedStatic = sym.encryptAndHash(staticKey.publicKey);

    // se = DH(s, re)
    const se = diffieHellmanX25519(staticKey.privateKey, responderEphemeralPub);
    sym.mixKey(se);

    // Sign static key with initiator device key
    const myStaticSig = initiatorDeviceKey.sign(staticKey.publicKey);
    const myPayloadObj: NoiseHandshakePayload = {
      binding: initiatorBinding,
      staticKeySignatureHex: bytesToHex(myStaticSig),
    };
    const myPayloadBytes = new TextEncoder().encode(JSON.stringify(myPayloadObj));
    const myEncryptedPayload = sym.encryptAndHash(myPayloadBytes);

    const msg3Bytes = new Uint8Array(myEncryptedStatic.length + myEncryptedPayload.length);
    msg3Bytes.set(myEncryptedStatic, 0);
    msg3Bytes.set(myEncryptedPayload, myEncryptedStatic.length);

    // Split handshake cipher states into transport states
    const [sendCipher, recvCipher] = sym.split();
    const channel = new SecureChannel(
      sendCipher,
      recvCipher,
      responderPayload.binding.peerId,
      responderPayload.binding,
      true,
    );

    return {
      message3: { rawBytes: msg3Bytes },
      channel,
      responderBinding: responderPayload.binding,
    };
  }

  /**
   * Responder processes Message 3 to finalize secure session.
   */
  public static finalizeResponder(
    message3: HandshakeMessage3,
    sym: NoiseSymmetricState,
    responderEphemeralPriv: Uint8Array,
    revocationRegistry?: RevocationRegistry,
  ): {
    channel: SecureChannel;
    initiatorBinding: PeerIdentityBinding;
  } {
    if (message3.rawBytes.length < 64) {
      // 48B encrypted static + at least 16B payload tag
      throw new HandshakeError('Invalid Message 3: truncated payload');
    }

    // Decrypt initiator static key
    const encryptedStatic = message3.rawBytes.subarray(0, 48);
    const initiatorStaticPub = sym.decryptAndHash(encryptedStatic);

    // se = DH(e, rs)
    const se = diffieHellmanX25519(responderEphemeralPriv, initiatorStaticPub);
    sym.mixKey(se);

    // Decrypt initiator payload
    const encryptedPayload = message3.rawBytes.subarray(48);
    const decryptedPayloadBytes = sym.decryptAndHash(encryptedPayload);
    const initiatorPayload: NoiseHandshakePayload = JSON.parse(
      new TextDecoder().decode(decryptedPayloadBytes),
    );

    // Verify initiator binding
    const isBindingValid = verifyPeerIdentityBinding(
      initiatorPayload.binding,
      revocationRegistry,
    );
    if (!isBindingValid) {
      throw new PeerAuthenticationError('Initiator identity binding is invalid or revoked', {
        peerId: initiatorPayload.binding.peerId,
      });
    }

    // Verify initiator signature over static key
    const isStaticSigValid = verifyEd25519(
      hexToBytes(initiatorPayload.binding.devicePublicKeyHex),
      initiatorStaticPub,
      hexToBytes(initiatorPayload.staticKeySignatureHex),
    );
    if (!isStaticSigValid) {
      throw new HandshakeError('Initiator signature over static X25519 key is invalid');
    }

    // Split handshake cipher states into transport states
    // Note: for responder, recvCipher is c1 (init->resp), sendCipher is c2 (resp->init)
    const [recvCipher, sendCipher] = sym.split();
    const channel = new SecureChannel(
      sendCipher,
      recvCipher,
      initiatorPayload.binding.peerId,
      initiatorPayload.binding,
      false,
    );

    return {
      channel,
      initiatorBinding: initiatorPayload.binding,
    };
  }
}

// =========================================================================
// REAL TCP SOCKET TRANSPORT ENGINE
// Length-delimited framing over Node.js node:net sockets
// =========================================================================

export interface TcpSocketOptions {
  host?: string;
  port: number;
}

/**
 * Length-delimited frame reader assembling byte streams over raw TCP sockets.
 * Buffers data and provides a FIFO queue of decoded frames without dropping frames.
 */
export class LengthPrefixedFrameCodec {
  private buffer = new Uint8Array(0);
  private frameQueue: Uint8Array[] = [];

  public appendData(chunk: Uint8Array): void {
    const combined = new Uint8Array(this.buffer.length + chunk.length);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.length);
    this.buffer = combined;

    while (this.buffer.length >= 4) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 4);
      const frameLen = view.getUint32(0, false);
      if (this.buffer.length < 4 + frameLen) {
        break; // Wait for more data
      }
      const frame = this.buffer.subarray(4, 4 + frameLen);
      this.frameQueue.push(new Uint8Array(frame));
      this.buffer = this.buffer.subarray(4 + frameLen);
    }
  }

  public hasFrame(): boolean {
    return this.frameQueue.length > 0;
  }

  public nextFrame(): Uint8Array | undefined {
    return this.frameQueue.shift();
  }

  public drainFrames(): Uint8Array[] {
    const all = this.frameQueue;
    this.frameQueue = [];
    return all;
  }

  public static encode(payload: Uint8Array): Uint8Array {
    const framed = new Uint8Array(4 + payload.length);
    const view = new DataView(framed.buffer, framed.byteOffset, 4);
    view.setUint32(0, payload.length, false);
    framed.set(payload, 4);
    return framed;
  }
}

/**
 * Concrete TCP Server and Client Transport for Node.js environments.
 */
export class TcpTransport {
  private server: net.Server | null = null;
  private isListening = false;

  public async listen(
    port: number,
    host = '127.0.0.1',
    onConnection: (socket: net.Socket) => void,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer(socket => {
        onConnection(socket);
      });

      srv.on('error', err => {
        reject(err);
      });

      srv.listen(port, host, () => {
        this.server = srv;
        this.isListening = true;
        const addr = srv.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(actualPort);
      });
    });
  }

  public async dial(port: number, host = '127.0.0.1', timeoutMs = 1500): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ port, host });
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => {
        socket.setTimeout(0);
        resolve(socket);
      });
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`TCP connection to ${host}:${port} timed out after ${timeoutMs}ms`));
      });
      socket.on('error', err => {
        reject(err);
      });
    });
  }

  public close(): Promise<void> {
    return new Promise(resolve => {
      if (this.server && this.isListening) {
        this.server.close(() => {
          this.isListening = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
