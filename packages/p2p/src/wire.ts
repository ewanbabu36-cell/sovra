/**
 * @file packages/p2p/src/wire.ts
 * Canonical SIP-001 Wire Protocol Framing & Codec Engine.
 *
 * Implements the 75-byte minimum canonical binary wire frame:
 * [Magic: 4B 0x534F5652 ('SOVR')] [Version: 1B] [MsgType: 2B BE] [PayloadLength: 4B BE]
 * [Payload: N Bytes]
 * [Ed25519 Signature: 64 Bytes]
 *
 * Matching Bitcoin BIP-like Wire Standard & BitTorrent BEP-like Framing.
 */

import { Result, ok, err } from '@sovra/shared';
import { verifyEd25519 } from '@sovra/crypto';

export const SOVRA_WIRE_MAGIC = 0x534f5652; // 'SOVR' in ASCII
export const SOVRA_WIRE_VERSION = 0x01;
export const SOVRA_HEADER_LENGTH = 11; // 4 + 1 + 2 + 4
export const SOVRA_SIGNATURE_LENGTH = 64; // Ed25519 signature
export const SOVRA_MIN_FRAME_LENGTH = SOVRA_HEADER_LENGTH + SOVRA_SIGNATURE_LENGTH; // 75 Bytes
export const SOVRA_MAX_PAYLOAD_LENGTH = 16 * 1024 * 1024; // 16 MiB max payload

export enum SovraWireMsgType {
  NET_HANDSHAKE_INIT = 0x0001,
  NET_HANDSHAKE_RESP = 0x0002,
  NET_PING = 0x0010,
  NET_PONG = 0x0011,
  SOCIAL_EVENT_GOSSIP = 0x0020,
  SOCIAL_STATE_QUERY = 0x0021,
  SOCIAL_STATE_RESP = 0x0022,
  SIGNAL_WEBRTC_OFFER = 0x0030,
  SIGNAL_WEBRTC_ANSWER = 0x0031,
  SIGNAL_WEBRTC_ICE = 0x0032,
  SIGNAL_WEBRTC_HANGUP = 0x0033,
  SWARM_BITSWAP_WANT = 0x0040,
  SWARM_BITSWAP_BLOCK = 0x0041,
  SWARM_BITSWAP_CHOKE = 0x0042,
  SWARM_BITSWAP_UNCHOKE = 0x0043,
  SWARM_BITSWAP_HAVE = 0x0044,
  CHAIN_CONSENSUS_TX = 0x0050,
}

export interface SovraWireFrame {
  readonly magic: number;
  readonly version: number;
  readonly msgType: number;
  readonly payloadLength: number;
  readonly payload: Uint8Array;
  readonly signature: Uint8Array;
}

/**
 * Encodes a SIP-001 canonical wire frame.
 *
 * @param msgType 16-bit message type identifier
 * @param payload Raw binary payload (max 16 MiB)
 * @param signFn Function signing Header[0..11] || Payload[0..N] with sender's Ed25519 key
 */
export function encodeWireFrame(
  msgType: number,
  payload: Uint8Array,
  signFn: (commitBytes: Uint8Array) => Uint8Array,
): Uint8Array {
  if (payload.length > SOVRA_MAX_PAYLOAD_LENGTH) {
    throw new Error(`Payload length ${payload.length} exceeds max allowed ${SOVRA_MAX_PAYLOAD_LENGTH}`);
  }

  const commitLength = SOVRA_HEADER_LENGTH + payload.length;
  const commitBuffer = new Uint8Array(commitLength);
  const view = new DataView(commitBuffer.buffer, commitBuffer.byteOffset, commitBuffer.byteLength);

  // 1. Header Framing
  view.setUint32(0, SOVRA_WIRE_MAGIC, false); // Magic 0x534F5652 ('SOVR')
  view.setUint8(4, SOVRA_WIRE_VERSION); // Version 0x01
  view.setUint16(5, msgType, false); // MsgType Big-Endian
  view.setUint32(7, payload.length, false); // PayloadLength Big-Endian

  // 2. Payload Copy
  if (payload.length > 0) {
    commitBuffer.set(payload, SOVRA_HEADER_LENGTH);
  }

  // 3. Cryptographic Signature over Header + Payload
  const signature = signFn(commitBuffer);
  if (signature.length !== SOVRA_SIGNATURE_LENGTH) {
    throw new Error(`Invalid Ed25519 signature length: expected 64, got ${signature.length}`);
  }

  // 4. Final Wire Frame Assembly
  const totalLength = commitLength + SOVRA_SIGNATURE_LENGTH;
  const finalFrame = new Uint8Array(totalLength);
  finalFrame.set(commitBuffer, 0);
  finalFrame.set(signature, commitLength);

  return finalFrame;
}

/**
 * Decodes and validates a SIP-001 canonical wire frame from raw bytes.
 *
 * @param buffer Raw buffer containing at least 75 bytes
 * @param senderPubKey Optional 32-byte Ed25519 public key to verify signature immediately
 */
export function decodeWireFrame(
  buffer: Uint8Array,
  senderPubKey?: Uint8Array,
): Result<SovraWireFrame> {
  if (buffer.length < SOVRA_MIN_FRAME_LENGTH) {
    return err(new Error(`Frame buffer length ${buffer.length} is less than minimum 75 bytes`));
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = view.getUint32(0, false);
  if (magic !== SOVRA_WIRE_MAGIC) {
    return err(new Error(`Invalid magic header: expected 0x534F5652 ('SOVR'), got 0x${magic.toString(16).toUpperCase()}`));
  }

  const version = view.getUint8(4);
  if (version !== SOVRA_WIRE_VERSION) {
    return err(new Error(`Unsupported protocol version: ${version}`));
  }

  const msgType = view.getUint16(5, false);
  const payloadLength = view.getUint32(7, false);

  if (payloadLength > SOVRA_MAX_PAYLOAD_LENGTH) {
    return err(new Error(`Payload length ${payloadLength} exceeds maximum allowed ${SOVRA_MAX_PAYLOAD_LENGTH}`));
  }

  const expectedTotalLength = SOVRA_HEADER_LENGTH + payloadLength + SOVRA_SIGNATURE_LENGTH;
  if (buffer.length < expectedTotalLength) {
    return err(new Error(`Incomplete frame: buffer has ${buffer.length} bytes, expected ${expectedTotalLength}`));
  }

  const payload = buffer.subarray(SOVRA_HEADER_LENGTH, SOVRA_HEADER_LENGTH + payloadLength);
  const signatureOffset = SOVRA_HEADER_LENGTH + payloadLength;
  const signature = buffer.subarray(signatureOffset, signatureOffset + SOVRA_SIGNATURE_LENGTH);

  // Optional cryptographic Ed25519 verification
  if (senderPubKey) {
    if (senderPubKey.length !== 32) {
      return err(new Error(`Invalid Ed25519 public key length: expected 32, got ${senderPubKey.length}`));
    }
    const commitBytes = buffer.subarray(0, signatureOffset);
    const isSigValid = verifyEd25519(senderPubKey, commitBytes, signature);
    if (!isSigValid) {
      return err(new Error('Wire frame cryptographic signature verification failed: invalid Ed25519 signature'));
    }
  }

  return ok({
    magic,
    version,
    msgType,
    payloadLength,
    payload,
    signature,
  });
}

/**
 * Verifies the Ed25519 signature of an already parsed wire frame.
 */
export function verifyWireFrameSignature(
  frame: SovraWireFrame,
  senderPubKey: Uint8Array,
): boolean {
  if (senderPubKey.length !== 32) return false;

  const commitLength = SOVRA_HEADER_LENGTH + frame.payloadLength;
  const commitBuffer = new Uint8Array(commitLength);
  const view = new DataView(commitBuffer.buffer, commitBuffer.byteOffset, commitBuffer.byteLength);

  view.setUint32(0, frame.magic, false);
  view.setUint8(4, frame.version);
  view.setUint16(5, frame.msgType, false);
  view.setUint32(7, frame.payloadLength, false);

  if (frame.payloadLength > 0) {
    commitBuffer.set(frame.payload, SOVRA_HEADER_LENGTH);
  }

  return verifyEd25519(senderPubKey, commitBuffer, frame.signature);
}

/**
 * Continuous streaming buffer decoder for TCP streams and WebSocket chunks.
 * Handles partial frames and frame aggregation with zero-copy where possible.
 */
export class SovraWireFrameDecoder {
  private buffer = new Uint8Array(0);

  /**
   * Appends incoming chunk and extracts all complete canonical frames.
   */
  public pushChunk(chunk: Uint8Array): SovraWireFrame[] {
    // Append chunk to internal buffer
    const newBuf = new Uint8Array(this.buffer.length + chunk.length);
    newBuf.set(this.buffer, 0);
    newBuf.set(chunk, this.buffer.length);
    this.buffer = newBuf;

    const frames: SovraWireFrame[] = [];

    while (this.buffer.length >= SOVRA_MIN_FRAME_LENGTH) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const magic = view.getUint32(0, false);

      // Desynchronization recovery: find next magic bytes if stream corrupted
      if (magic !== SOVRA_WIRE_MAGIC) {
        let syncOffset = -1;
        for (let i = 1; i <= this.buffer.length - 4; i++) {
          if (view.getUint32(i, false) === SOVRA_WIRE_MAGIC) {
            syncOffset = i;
            break;
          }
        }
        if (syncOffset !== -1) {
          this.buffer = this.buffer.subarray(syncOffset);
          continue;
        } else {
          // No magic found, keep at most 3 bytes for partial magic match
          this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 3));
          break;
        }
      }

      const payloadLength = view.getUint32(7, false);
      if (payloadLength > SOVRA_MAX_PAYLOAD_LENGTH) {
        // Corrupt frame length, skip magic and resync
        this.buffer = this.buffer.subarray(4);
        continue;
      }

      const totalFrameSize = SOVRA_HEADER_LENGTH + payloadLength + SOVRA_SIGNATURE_LENGTH;
      if (this.buffer.length < totalFrameSize) {
        // Need more bytes to complete frame
        break;
      }

      const frameBytes = this.buffer.subarray(0, totalFrameSize);
      const decodeRes = decodeWireFrame(frameBytes);
      if (decodeRes.ok) {
        frames.push(decodeRes.value);
      }

      this.buffer = this.buffer.subarray(totalFrameSize);
    }

    return frames;
  }

  public get pendingBytes(): number {
    return this.buffer.length;
  }

  public clear(): void {
    this.buffer = new Uint8Array(0);
  }
}
