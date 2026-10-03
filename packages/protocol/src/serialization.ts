import { Result, ok, err } from '@sovra/shared';
import { UnsignedSovraEvent, SovraEvent } from './events.js';
import { InvalidEventError } from './errors.js';

/**
 * Deterministic Canonical JSON Serializer (RFC 8785 Compatible)
 * Guarantees that identical payloads always serialize to identical byte arrays
 * regardless of runtime object key insertion order.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(item => canonicalizeJson(item)).join(',')}]`;
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map(key => {
    const value = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalizeJson(value)}`;
  });

  return `{${pairs.join(',')}}`;
}

export interface CanonicalSerializer {
  serializeUnsignedEvent(event: UnsignedSovraEvent): string;
  serializeSignedEvent(event: SovraEvent): string;
}

export class DefaultCanonicalSerializer implements CanonicalSerializer {
  serializeUnsignedEvent(event: UnsignedSovraEvent): string {
    return canonicalizeJson({
      content: event.content,
      createdAt: event.createdAt,
      kind: event.kind,
      media: event.media ?? [],
      pubkey: event.pubkey,
      tags: event.tags,
    });
  }

  serializeSignedEvent(event: SovraEvent): string {
    return canonicalizeJson({
      content: event.content,
      createdAt: event.createdAt,
      id: event.id,
      kind: event.kind,
      media: event.media ?? [],
      pubkey: event.pubkey,
      sig: event.sig,
      tags: event.tags,
    });
  }
}

export interface EventValidator {
  validateEventStructure(event: unknown): Result<SovraEvent, InvalidEventError>;
  isTimestampAcceptable(timestampSeconds: number, maxDriftSeconds?: number): boolean;
}

export class DefaultEventValidator implements EventValidator {
  validateEventStructure(event: unknown): Result<SovraEvent, InvalidEventError> {
    if (!event || typeof event !== 'object') {
      return err(new InvalidEventError('Event must be a non-null object'));
    }

    const candidate = event as Record<string, unknown>;
    if (typeof candidate['id'] !== 'string' || candidate['id'].length === 0) {
      return err(new InvalidEventError('Event missing valid id'));
    }
    if (typeof candidate['pubkey'] !== 'string' || candidate['pubkey'].length === 0) {
      return err(new InvalidEventError('Event missing valid pubkey'));
    }
    if (typeof candidate['createdAt'] !== 'number' || candidate['createdAt'] <= 0) {
      return err(new InvalidEventError('Event missing valid createdAt timestamp'));
    }
    if (typeof candidate['kind'] !== 'number') {
      return err(new InvalidEventError('Event missing valid kind'));
    }
    if (!Array.isArray(candidate['tags'])) {
      return err(new InvalidEventError('Event tags must be an array'));
    }
    if (typeof candidate['sig'] !== 'string' || candidate['sig'].length === 0) {
      return err(new InvalidEventError('Event missing valid signature'));
    }

    return ok(event as SovraEvent);
  }

  isTimestampAcceptable(timestampSeconds: number, maxDriftSeconds = 300): boolean {
    const currentSeconds = Math.floor(Date.now() / 1000);
    const diff = Math.abs(currentSeconds - timestampSeconds);
    return diff <= maxDriftSeconds;
  }
}
