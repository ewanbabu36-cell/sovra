/**
 * @file packages/protocol/src/envelope.ts
 * Transport-Neutral Protocol Message Envelope.
 *
 * Decouples Sovra application protocol events from physical transports:
 * Bluetooth Low Energy (BLE), OS TCP Sockets, WebSockets, WebRTC DataChannels,
 * or Local memory queues.
 */

import { SovraProtocolEvent } from './protocol-event.js';
import { canonicalizeJson } from './serialization.js';

export type TransportType = 'LOCAL' | 'BLE' | 'TCP' | 'WEBSOCKET' | 'WEBRTC';

export interface TransportEnvelope<T = unknown> {
  readonly envelopeVersion: number;
  readonly transportType: TransportType;
  readonly senderPeerId: string;
  readonly recipientPeerId?: string | undefined; // undefined = mesh broadcast
  readonly event: SovraProtocolEvent<T>;
  readonly hopCount: number;
  readonly maxHops: number;
  readonly relayedBy: readonly string[];
  readonly sentAt: number;
  readonly transportMetadata?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Creates a new transport-neutral envelope for a protocol event.
 */
export function wrapInTransportEnvelope<T>(
  event: SovraProtocolEvent<T>,
  senderPeerId: string,
  transportType: TransportType = 'LOCAL',
  options?: {
    recipientPeerId?: string | undefined;
    maxHops?: number | undefined;
    transportMetadata?: Record<string, unknown> | undefined;
  },
): TransportEnvelope<T> {
  return {
    envelopeVersion: 1,
    transportType,
    senderPeerId,
    recipientPeerId: options?.recipientPeerId,
    event,
    hopCount: 0,
    maxHops: options?.maxHops ?? 7,
    relayedBy: [],
    sentAt: Date.now(),
    transportMetadata: options?.transportMetadata,
  };
}

/**
 * Advances hop count when relaying an envelope through a peer.
 */
export function relayTransportEnvelope<T>(
  envelope: TransportEnvelope<T>,
  relayPeerId: string,
): TransportEnvelope<T> | null {
  if (envelope.hopCount >= envelope.maxHops) {
    return null; // Exceeded maximum TTL/hop budget
  }

  return {
    ...envelope,
    hopCount: envelope.hopCount + 1,
    relayedBy: [...envelope.relayedBy, relayPeerId],
  };
}

/**
 * Serializes transport envelope to canonical JSON bytes.
 */
export function serializeTransportEnvelope<T>(envelope: TransportEnvelope<T>): Uint8Array {
  const jsonStr = canonicalizeJson(envelope);
  return new TextEncoder().encode(jsonStr);
}

/**
 * Deserializes transport envelope from bytes.
 */
export function deserializeTransportEnvelope<T = unknown>(bytes: Uint8Array): TransportEnvelope<T> {
  const jsonStr = new TextDecoder().decode(bytes);
  return JSON.parse(jsonStr) as TransportEnvelope<T>;
}
