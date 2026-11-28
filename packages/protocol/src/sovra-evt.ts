import {
  bytesToHex,
  canonicalCborDecode,
  canonicalCborEncode,
  hexToBytes,
  sha256,
  signEd25519,
  verifyEd25519,
} from '@sovra/crypto';
import { isValidSovraIdentityId } from '@sovra/identity';
import { Result, err, ok } from '@sovra/shared';
import { InvalidEventError, SignatureVerificationFailedError } from './errors.js';

export const SOVRA_EVT_DOMAIN_TAG = 'SOVRA-EVT-v1';
export const SOVRA_EVT_SIG_TAG = 'SOVRA-EVT-SIG-v1';

export const SOVRA_EVENT_REGISTRY = [
  'identity.create',
  'identity.rotate',
  'device.authorize',
  'device.revoke',
  'profile.update',
  'social.post',
  'social.comment',
  'social.reaction',
  'social.follow',
  'social.delete',
  'market.listing',
  'market.order',
  'market.accept',
  'market.status',
  'business.create',
  'governance.proposal',
  'governance.vote',
] as const;

export type KnownSovraEventType = (typeof SOVRA_EVENT_REGISTRY)[number];
export type SovraEventType = KnownSovraEventType | (string & {});

const KNOWN_EVENT_TYPE_SET = new Set<string>(SOVRA_EVENT_REGISTRY);
const SECURITY_CRITICAL_PREFIXES = ['identity.', 'device.', 'governance.', 'auth.', 'security.'];

const textEncoder = new TextEncoder();

function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export interface UnsignedSovraSpecEvent<T = Record<string, unknown>> {
  readonly protocol: 'sovra';
  readonly version: 1;
  readonly identity_id: string;
  readonly device_id: string;
  readonly event_type: SovraEventType;
  readonly created_at: number;
  readonly sequence: number;
  readonly key_epoch: number;
  readonly payload: T;
  readonly references: readonly string[];
  readonly content_cid: string | null;
  readonly critical?: boolean | undefined;
}

export interface SovraSpecEvent<T = Record<string, unknown>> extends UnsignedSovraSpecEvent<T> {
  readonly event_id: string;
  readonly signature: string;
}

export function isKnownSovraEventType(eventType: string): eventType is KnownSovraEventType {
  return KNOWN_EVENT_TYPE_SET.has(eventType);
}

export function isSecurityCriticalEventType(eventType: string, criticalFlag?: boolean): boolean {
  if (criticalFlag === true) return true;
  return SECURITY_CRITICAL_PREFIXES.some((prefix) => eventType.startsWith(prefix));
}

export function extractUnsignedSpecEvent<T>(event: UnsignedSovraSpecEvent<T>): UnsignedSovraSpecEvent<T> {
  const base: UnsignedSovraSpecEvent<T> = {
    protocol: 'sovra',
    version: 1,
    identity_id: event.identity_id,
    device_id: event.device_id,
    event_type: event.event_type,
    created_at: event.created_at,
    sequence: event.sequence,
    key_epoch: event.key_epoch,
    payload: event.payload,
    references: [...event.references],
    content_cid: event.content_cid ?? null,
    ...(event.critical !== undefined ? { critical: event.critical } : {}),
  };
  return base;
}

/**
 * Encodes an unsigned SovraSpecEvent into RFC 8949 Deterministic CBOR.
 */
export function encodeUnsignedSovraSpecEventCbor<T>(event: UnsignedSovraSpecEvent<T>): Uint8Array {
  return canonicalCborEncode(extractUnsignedSpecEvent(event));
}

/**
 * Encodes a complete signed SovraSpecEvent into RFC 8949 Deterministic CBOR.
 */
export function encodeSovraSpecEventCbor<T>(event: SovraSpecEvent<T>): Uint8Array {
  return canonicalCborEncode({
    ...extractUnsignedSpecEvent(event),
    event_id: event.event_id,
    signature: event.signature,
  });
}

export function decodeSovraSpecEventCbor<T = Record<string, unknown>>(bytes: Uint8Array): SovraSpecEvent<T> {
  return canonicalCborDecode<SovraSpecEvent<T>>(bytes, { strictDeterministic: true });
}

/**
 * Computes domain-separated event_id = SHA-256("SOVRA-EVT-v1" || deterministic_cbor(unsigned)).
 */
export function computeSovraSpecEventId<T>(event: UnsignedSovraSpecEvent<T>): string {
  const cbor = encodeUnsignedSovraSpecEventCbor(event);
  return bytesToHex(sha256(concatBytes(textEncoder.encode(SOVRA_EVT_DOMAIN_TAG), cbor)));
}

export function createAndSignSovraSpecEvent<T = Record<string, unknown>>(
  params: {
    identity_id: string;
    device_id: string;
    event_type: SovraEventType;
    payload: T;
    sequence: number;
    key_epoch?: number | undefined;
    created_at?: number | undefined;
    references?: readonly string[] | undefined;
    content_cid?: string | null | undefined;
    critical?: boolean | undefined;
  },
  signingPrivateKey: Uint8Array,
): SovraSpecEvent<T> {
  if (!isValidSovraIdentityId(params.identity_id)) {
    throw new InvalidEventError(`Invalid sovra1 identity_id '${params.identity_id}'`);
  }
  if (!params.device_id || params.sequence < 1) {
    throw new InvalidEventError('SOVRA-EVT requires non-empty device_id and sequence >= 1');
  }

  const unsigned: UnsignedSovraSpecEvent<T> = {
    protocol: 'sovra',
    version: 1,
    identity_id: params.identity_id,
    device_id: params.device_id,
    event_type: params.event_type,
    created_at: params.created_at ?? Math.floor(Date.now() / 1000),
    sequence: params.sequence,
    key_epoch: params.key_epoch ?? 1,
    payload: params.payload,
    references: params.references ?? [],
    content_cid: params.content_cid ?? null,
    ...(params.critical !== undefined ? { critical: params.critical } : {}),
  };

  const event_id = computeSovraSpecEventId(unsigned);
  const sigMsg = concatBytes(textEncoder.encode(SOVRA_EVT_SIG_TAG), hexToBytes(event_id));
  const signature = bytesToHex(signEd25519(signingPrivateKey, sigMsg));

  return {
    ...unsigned,
    event_id,
    signature,
  };
}

export type VerifiedEventStatus = 'ACCEPTED' | 'ACCEPTED_UNKNOWN_OPTIONAL';

export const SOVRA_EVENT_SCHEMA_VERSIONS: Record<KnownSovraEventType, { schemaVersion: number; requiredKeys: readonly string[] }> = {
  'identity.create': { schemaVersion: 1, requiredKeys: [] },
  'identity.rotate': { schemaVersion: 1, requiredKeys: [] },
  'device.authorize': { schemaVersion: 1, requiredKeys: ['deviceId'] },
  'device.revoke': { schemaVersion: 1, requiredKeys: ['deviceId'] },
  'profile.update': { schemaVersion: 1, requiredKeys: [] },
  'social.post': { schemaVersion: 1, requiredKeys: ['text'] },
  'social.comment': { schemaVersion: 1, requiredKeys: ['text'] },
  'social.reaction': { schemaVersion: 1, requiredKeys: [] },
  'social.follow': { schemaVersion: 1, requiredKeys: [] },
  'social.delete': { schemaVersion: 1, requiredKeys: ['target_event_id'] },
  'market.listing': { schemaVersion: 1, requiredKeys: ['title'] },
  'market.order': { schemaVersion: 1, requiredKeys: ['listingId', 'quantity'] },
  'market.accept': { schemaVersion: 1, requiredKeys: ['orderId'] },
  'market.status': { schemaVersion: 1, requiredKeys: ['orderId', 'status'] },
  'business.create': { schemaVersion: 1, requiredKeys: ['name'] },
  'governance.proposal': { schemaVersion: 1, requiredKeys: ['title'] },
  'governance.vote': { schemaVersion: 1, requiredKeys: ['proposalId', 'decision'] },
};

/**
 * Validates versioned payload schemas for known canonical event types (IA-01 Sec 6).
 */
export function validateSovraEventPayloadSchema(
  eventType: string,
  payload: unknown,
): { valid: boolean; schemaVersion?: number | undefined; reason?: string | undefined } {
  if (!isKnownSovraEventType(eventType)) {
    return { valid: true };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: `Payload for '${eventType}' must be a non-null record object` };
  }
  const spec = SOVRA_EVENT_SCHEMA_VERSIONS[eventType];
  const rec = payload as Record<string, unknown>;
  if (rec['schemaVersion'] !== undefined && rec['schemaVersion'] !== spec.schemaVersion) {
    return { valid: false, reason: `Unsupported payload schemaVersion '${String(rec['schemaVersion'])}' for '${eventType}'` };
  }
  for (const key of spec.requiredKeys) {
    if (rec[key] === undefined || rec[key] === null || rec[key] === '') {
      return { valid: false, schemaVersion: spec.schemaVersion, reason: `Missing required field '${key}' in '${eventType}'` };
    }
  }
  return { valid: true, schemaVersion: spec.schemaVersion };
}

export function verifySovraSpecEvent<T>(
  event: SovraSpecEvent<T>,
  signingPublicKey: Uint8Array,
  options: {
    isDeviceRevoked?: (identityId: string, deviceId: string, createdAt: number) => boolean;
    expectedMinSequence?: number;
  } = {},
): Result<VerifiedEventStatus, InvalidEventError | SignatureVerificationFailedError> {
  if (!event || event.protocol !== 'sovra' || event.version !== 1) {
    return err(new InvalidEventError('Unsupported protocol or event version'));
  }
  if (!isValidSovraIdentityId(event.identity_id)) {
    return err(new InvalidEventError(`Invalid identity_id '${event.identity_id}'`));
  }
  if (!event.device_id || event.sequence < 1 || event.key_epoch < 1 || event.created_at <= 0) {
    return err(new InvalidEventError('Malformed device_id, sequence, key_epoch, or created_at'));
  }

  // Unknown security-critical event types MUST be rejected (Section 7.3)
  if (!isKnownSovraEventType(event.event_type) && isSecurityCriticalEventType(event.event_type, event.critical)) {
    return err(
      new InvalidEventError(
        `Rejected unrecognized security-critical event type '${event.event_type}'`,
        { eventType: event.event_type },
      ),
    );
  }

  // Versioned payload schema check for known canonical types (IA-01 Sec 6)
  const schemaCheck = validateSovraEventPayloadSchema(event.event_type, event.payload);
  if (!schemaCheck.valid) {
    return err(
      new InvalidEventError(schemaCheck.reason ?? `Invalid payload schema for '${event.event_type}'`, {
        eventType: event.event_type,
      }),
    );
  }

  if (options.isDeviceRevoked && options.isDeviceRevoked(event.identity_id, event.device_id, event.created_at)) {
    return err(
      new SignatureVerificationFailedError(`Device '${event.device_id}' is revoked for identity '${event.identity_id}'`),
    );
  }

  if (options.expectedMinSequence !== undefined && event.sequence < options.expectedMinSequence) {
    return err(
      new InvalidEventError(
        `Sequence ${event.sequence} regresses below minimum expected ${options.expectedMinSequence}`,
      ),
    );
  }

  const expectedEventId = computeSovraSpecEventId(event);
  if (expectedEventId !== event.event_id) {
    return err(
      new InvalidEventError(`Event ID mismatch: expected '${expectedEventId}', got '${event.event_id}'`),
    );
  }

  try {
    const sigMsg = concatBytes(textEncoder.encode(SOVRA_EVT_SIG_TAG), hexToBytes(event.event_id));
    const sigValid = verifyEd25519(signingPublicKey, sigMsg, hexToBytes(event.signature));
    if (!sigValid) {
      return err(new SignatureVerificationFailedError('Invalid Ed25519 signature over SOVRA-EVT digest'));
    }
  } catch {
    return err(new SignatureVerificationFailedError('Malformed hex signature or public key'));
  }

  if (!isKnownSovraEventType(event.event_type)) {
    return ok('ACCEPTED_UNKNOWN_OPTIONAL');
  }
  return ok('ACCEPTED');
}

export interface EventQueryFilter {
  readonly identity_id?: string;
  readonly event_type?: string;
  readonly reference_id?: string;
  readonly include_retracted?: boolean;
  readonly limit?: number;
}

/**
 * Implements Section 17.4 Event APIs (create, sign, verify, publish, query, get, retract)
 * with immutable storage, tombstone tracking, duplicate conflict rejection, and sequence tracking.
 */
export class SovraEventEngine {
  private readonly eventsById = new Map<string, SovraSpecEvent<unknown>>();
  private readonly orderedIds: string[] = [];
  private readonly retractedTargets = new Map<string, string>(); // targetEventId -> tombstoneEventId
  private readonly maxSequences = new Map<string, number>(); // `${identity_id}:${device_id}` -> seq
  private readonly publicKeys = new Map<string, Uint8Array>(); // `${identity_id}:${device_id}` -> pubkey
  private readonly revokedDevices = new Set<string>(); // `${identity_id}:${device_id}`

  public registerAuthorizedSigner(identity_id: string, device_id: string, publicKey: Uint8Array): void {
    this.publicKeys.set(`${identity_id}:${device_id}`, publicKey);
  }

  public markDeviceRevoked(identity_id: string, device_id: string): void {
    this.revokedDevices.add(`${identity_id}:${device_id}`);
  }

  public create<T = Record<string, unknown>>(params: {
    identity_id: string;
    device_id: string;
    event_type: SovraEventType;
    payload: T;
    sequence?: number | undefined;
    key_epoch?: number | undefined;
    created_at?: number | undefined;
    references?: readonly string[] | undefined;
    content_cid?: string | null | undefined;
    critical?: boolean | undefined;
  }): UnsignedSovraSpecEvent<T> {
    const key = `${params.identity_id}:${params.device_id}`;
    const nextSeq = params.sequence ?? (this.maxSequences.get(key) ?? 0) + 1;
    return {
      protocol: 'sovra',
      version: 1,
      identity_id: params.identity_id,
      device_id: params.device_id,
      event_type: params.event_type,
      created_at: params.created_at ?? Math.floor(Date.now() / 1000),
      sequence: nextSeq,
      key_epoch: params.key_epoch ?? 1,
      payload: params.payload,
      references: params.references ?? [],
      content_cid: params.content_cid ?? null,
      ...(params.critical !== undefined ? { critical: params.critical } : {}),
    };
  }

  public sign<T>(unsigned: UnsignedSovraSpecEvent<T>, signingPrivateKey: Uint8Array): SovraSpecEvent<T> {
    return createAndSignSovraSpecEvent(unsigned, signingPrivateKey);
  }

  public verify<T>(
    event: SovraSpecEvent<T>,
    signingPublicKey?: Uint8Array,
  ): Result<VerifiedEventStatus, InvalidEventError | SignatureVerificationFailedError> {
    const pub = signingPublicKey ?? this.publicKeys.get(`${event.identity_id}:${event.device_id}`);
    if (!pub) {
      return err(
        new SignatureVerificationFailedError(
          `No registered public key for signer '${event.identity_id}:${event.device_id}'`,
        ),
      );
    }
    return verifySovraSpecEvent(event, pub, {
      isDeviceRevoked: (id, dev) => this.revokedDevices.has(`${id}:${dev}`),
    });
  }

  public publish<T>(
    event: SovraSpecEvent<T>,
    signingPublicKey?: Uint8Array,
  ): Result<{ status: VerifiedEventStatus; duplicate: boolean }, InvalidEventError | SignatureVerificationFailedError> {
    const ver = this.verify(event, signingPublicKey);
    if (!ver.ok) return ver;

    const existing = this.eventsById.get(event.event_id);
    if (existing) {
      if (existing.signature !== event.signature) {
        return err(new InvalidEventError(`Conflicting signature on duplicate event '${event.event_id}'`));
      }
      return ok({ status: ver.value, duplicate: true });
    }

    const seqKey = `${event.identity_id}:${event.device_id}`;
    const prevSeq = this.maxSequences.get(seqKey) ?? 0;
    if (event.sequence <= prevSeq) {
      return err(
        new InvalidEventError(
          `Replay/stale sequence rejected: received ${event.sequence}, latest is ${prevSeq}`,
        ),
      );
    }

    this.eventsById.set(event.event_id, event as SovraSpecEvent<unknown>);
    this.orderedIds.push(event.event_id);
    this.maxSequences.set(seqKey, event.sequence);

    if (event.event_type === 'social.delete') {
      for (const refId of event.references) {
        const target = this.eventsById.get(refId);
        if (!target || target.identity_id === event.identity_id) {
          this.retractedTargets.set(refId, event.event_id);
        }
      }
    }

    return ok({ status: ver.value, duplicate: false });
  }

  public get(eventId: string, includeRetracted = true): SovraSpecEvent<unknown> | undefined {
    if (!includeRetracted && this.retractedTargets.has(eventId)) return undefined;
    return this.eventsById.get(eventId);
  }

  public isRetracted(eventId: string): boolean {
    return this.retractedTargets.has(eventId);
  }

  public query(filter: EventQueryFilter = {}): readonly SovraSpecEvent<unknown>[] {
    const out: SovraSpecEvent<unknown>[] = [];
    for (const id of this.orderedIds) {
      if (!filter.include_retracted && this.retractedTargets.has(id)) continue;
      const ev = this.eventsById.get(id)!;
      if (filter.identity_id && ev.identity_id !== filter.identity_id) continue;
      if (filter.event_type && ev.event_type !== filter.event_type) continue;
      if (filter.reference_id && !ev.references.includes(filter.reference_id)) continue;
      out.push(ev);
      if (filter.limit && out.length >= filter.limit) break;
    }
    return out;
  }

  public retract(params: {
    targetEventId: string;
    identity_id: string;
    device_id: string;
    reason?: string;
    signingPrivateKey: Uint8Array;
    signingPublicKey?: Uint8Array;
  }): Result<SovraSpecEvent, InvalidEventError | SignatureVerificationFailedError> {
    const target = this.eventsById.get(params.targetEventId);
    if (target && target.identity_id !== params.identity_id) {
      return err(new SignatureVerificationFailedError('Only event author may issue social.delete tombstone'));
    }
    const unsigned = this.create({
      identity_id: params.identity_id,
      device_id: params.device_id,
      event_type: 'social.delete',
      references: [params.targetEventId],
      payload: { target_event_id: params.targetEventId, reason: params.reason ?? 'user_deleted' },
    });
    const signed = this.sign(unsigned, params.signingPrivateKey);
    const pubRes = this.publish(signed, params.signingPublicKey);
    if (!pubRes.ok) return pubRes;
    return ok(signed as SovraSpecEvent<Record<string, unknown>>);
  }
}
